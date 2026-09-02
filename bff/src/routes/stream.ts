import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { randomUUID } from 'node:crypto';
import { getSource } from '../lib/sources';
import { cfSession } from '../lib/sources/flaresolverr';
import { authenticate, userIdOf, roleOf } from '../lib/auth';
import { viewCtxFor, sourceAllowedFor, hideAdult, type ViewCtx } from '../lib/visibility';

interface StreamSession {
  id: string;
  source: string;
  chapterId: string;
  chapterNumber?: number;
  chapterTitle?: string;
  seriesTitle?: string;
  seriesId?: string;
  urls: string[];
  createdAt: number;
}

// In-memory sessions (4 hour TTL)
const sessions = new Map<string, StreamSession>();

// In-memory page image cache (key: `${sessionId}:${pageIndex}`)
const pageCache = new Map<string, { buffer: Buffer; contentType: string; at: number }>();
const MAX_CACHE_ENTRIES = 120;

function pruneCache() {
  const now = Date.now();
  for (const [id, s] of sessions.entries()) {
    if (now - s.createdAt > 4 * 3600_000) {
      sessions.delete(id);
    }
  }
  if (pageCache.size > MAX_CACHE_ENTRIES) {
    const sorted = Array.from(pageCache.entries()).sort((a, b) => a[1].at - b[1].at);
    for (let i = 0; i < sorted.length - MAX_CACHE_ENTRIES; i++) {
      pageCache.delete(sorted[i][0]);
    }
  }
}

export async function streamRoutes(app: FastifyInstance) {
  app.addHook('preHandler', async (req, reply) => {
    if (req.url.startsWith('/api/stream')) {
      await authenticate(req, reply);
    }
  });

  // 1. Initialise a streaming session for a chapter
  app.get('/api/stream/chapter', async (req: FastifyRequest, reply: FastifyReply) => {
    const { source, chapterId, seriesId, number, title, seriesTitle } = req.query as {
      source?: string;
      chapterId?: string;
      seriesId?: string;
      number?: string;
      title?: string;
      seriesTitle?: string;
    };

    if (!source || !chapterId) {
      return reply.code(400).send({ error: 'bad_request', message: 'source and chapterId are required' });
    }

    const src = getSource(source);
    if (!src) {
      return reply.code(404).send({ error: 'source_not_found', message: `Source ${source} not found` });
    }

    const ctx = await viewCtxFor(userIdOf(req), roleOf(req), { hideAdult: hideAdult(req) });
    if (!sourceAllowedFor(src, ctx.maxAgeRating)) {
      return reply.code(403).send({ error: 'forbidden', message: 'Source not allowed for this account' });
    }

    let urls: string[] = [];
    try {
      urls = await src.getPageUrls(chapterId);
    } catch (e: any) {
      return reply.code(502).send({ error: 'upstream_failed', message: e?.message || 'Failed to fetch pages from source' });
    }

    if (!urls || !urls.length) {
      return reply.code(404).send({ error: 'no_pages', message: 'No readable pages found for this chapter' });
    }

    const sessionId = randomUUID();
    const num = number ? Number(number) : undefined;
    const session: StreamSession = {
      id: sessionId,
      source,
      chapterId,
      chapterNumber: num,
      chapterTitle: title,
      seriesTitle: seriesTitle,
      seriesId,
      urls,
      createdAt: Date.now(),
    };
    sessions.set(sessionId, session);
    pruneCache();

    return {
      sessionId,
      source,
      chapterId,
      seriesId: seriesId || '',
      chapterNumber: num ?? 1,
      title: title || (num ? `Chapter ${num}` : 'Chapter'),
      seriesTitle: seriesTitle || 'Manga',
      totalPages: urls.length,
      pages: urls.map((_, i) => ({
        number: i + 1,
        url: `/img/stream/${sessionId}/${i}`,
      })),
    };
  });

  // 2. Fetch list of chapters from a source series for in-reader navigation
  app.get('/api/stream/chapters', async (req: FastifyRequest, reply: FastifyReply) => {
    const { source, seriesId } = req.query as { source?: string; seriesId?: string };
    if (!source || !seriesId) {
      return reply.code(400).send({ error: 'bad_request', message: 'source and seriesId required' });
    }

    const src = getSource(source);
    if (!src) return reply.code(404).send({ error: 'source_not_found' });

    try {
      const chapters = await src.listChapters(seriesId);
      return {
        chapters: chapters.map((c) => ({
          sourceId: c.sourceId,
          number: c.number,
          title: c.title || `Chapter ${c.number}`,
          date: c.publishedAt || null,
        })),
      };
    } catch (e: any) {
      return reply.code(502).send({ error: 'upstream_failed', message: e?.message || 'Could not list chapters' });
    }
  });

  // 3. Stream individual page image (zero-disk, memory/transient cached)
  app.get('/img/stream/:sessionId/:pageIndex', async (req: FastifyRequest, reply: FastifyReply) => {
    const { sessionId, pageIndex } = req.params as { sessionId: string; pageIndex: string };
    const session = sessions.get(sessionId);
    if (!session) {
      return reply.code(404).send({ error: 'session_expired_or_not_found' });
    }

    const idx = parseInt(pageIndex, 10);
    if (isNaN(idx) || idx < 0 || idx >= session.urls.length) {
      return reply.code(404).send({ error: 'page_out_of_bounds' });
    }

    const cacheKey = `${sessionId}:${idx}`;
    const cached = pageCache.get(cacheKey);
    if (cached) {
      cached.at = Date.now();
      return reply
        .header('content-type', cached.contentType)
        .header('cache-control', 'public, max-age=86400')
        .send(cached.buffer);
    }

    const u = session.urls[idx];
    const src = getSource(session.source);
    let cf = null;
    if (src?.requiresCloudflare) {
      cf = await cfSession(u).catch(() => null);
    }

    const referer = typeof src?.imageReferer === 'function'
      ? src.imageReferer(session.chapterId)
      : src?.imageReferer
        ?? (/^https?:/.test(session.chapterId) ? `${new URL(session.chapterId).origin}/` : '');

    const headers: Record<string, string> = {
      referer,
      accept: 'image/avif,image/webp,image/apng,image/*,*/*;q=0.8',
      'accept-language': 'en-US,en;q=0.9',
      'user-agent': cf?.userAgent || 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36',
    };
    if (cf?.cookie) headers.cookie = cf.cookie;
    Object.assign(headers, typeof src?.imageHeaders === 'function' ? src.imageHeaders(u) : src?.imageHeaders ?? {});

    try {
      const res = await fetch(u, { headers, signal: AbortSignal.timeout(30000) });
      if (!res.ok) {
        return reply.code(res.status).send({ error: 'upstream_image_error' });
      }

      const ct = (res.headers.get('content-type') || 'image/jpeg').toLowerCase();
      const buffer = Buffer.from(await res.arrayBuffer());

      pageCache.set(cacheKey, { buffer, contentType: ct, at: Date.now() });
      pruneCache();

      return reply
        .header('content-type', ct)
        .header('cache-control', 'public, max-age=86400')
        .send(buffer);
    } catch (err: any) {
      return reply.code(502).send({ error: 'image_fetch_failed', message: err?.message });
    }
  });
}
