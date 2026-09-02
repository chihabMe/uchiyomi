'use client';
import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useSearchParams, useRouter } from 'next/navigation';
import { AnimatePresence, motion } from 'framer-motion';
import { useQuery } from '@tanstack/react-query';
import { api, img } from '@/lib/api';
import { chapterOutcome } from '@/lib/readerState';
import { Book, Page, PageInfo, Series } from '@/lib/types';
import { chapterLabel } from '@/lib/format';
import { deviceId } from '@/lib/device';
import { getOfflineChapter, getPageBlob, queueProgress } from '@/lib/downloads';
import { applyCover, clearCover } from '@/lib/theme';
import {
  ReaderPrefs,
  ReaderMode,
  FitMode,
  TapZone,
  loadPrefs,
  savePrefs,
  loadSeriesPrefs,
  saveSeriesPrefs,
  syncPrefsFromServer,
  getEffectiveFilter,
} from '@/lib/readerPrefs';
import { ReaderSettings } from '@/components/ReaderSettings';
import { ChapterDrawer } from '@/components/ChapterDrawer';
import { Rail, SectionTitle } from '@/components/ui';
import { SeriesCard } from '@/components/cards';
import { IcChevronLeft, IcChevronRight, IcSliders } from '@/components/icons';
import { t as tr } from '@/lib/i18n';

interface PageDim { number: number; width: number | null; height: number | null }
interface Chapter {
  id: string;
  seriesId: string;
  seriesTitle: string;
  title: string;
  pages: PageDim[];
  offline: boolean;
  stream?: boolean;
  streamPageUrls?: string[];
  streamSource?: string;
  streamChapterId?: string;
  streamSeriesId?: string;
}
interface ChapterRef {
  id: string;
  label: string;
  streamSource?: string;
  streamSeriesId?: string;
  number?: number;
}
interface FlatItem { ci: number; number: number; width: number | null; height: number | null; key: string; firstOfChapter: boolean }

const WINDOW_BEHIND = 4;
const WINDOW_AHEAD = 10;
const DIVIDER_H = 60;

async function loadChapter(bookId: string): Promise<Chapter | null> {
  const off = await getOfflineChapter(bookId);
  if (off) {
    return { id: bookId, seriesId: off.seriesId, seriesTitle: off.seriesTitle, title: off.title, pages: off.pages, offline: true };
  }
  try {
    const b = await api<Book>(`/api/books/${bookId}`);
    const pInfo = await api<PageInfo[]>(`/api/books/${bookId}/pages`);
    return {
      id: bookId,
      seriesId: b.seriesId,
      seriesTitle: b.seriesTitle,
      title: b.metadata?.title || b.name,
      pages: pInfo.map((p) => ({ number: p.number, width: p.width ?? null, height: p.height ?? null })),
      offline: false,
    };
  } catch {
    return null;
  }
}

async function loadStreamChapter(
  source: string,
  chapterId: string,
  seriesId?: string,
  number?: string,
  title?: string,
  seriesTitle?: string
): Promise<Chapter | null> {
  try {
    const q = new URLSearchParams({
      source,
      chapterId,
      ...(seriesId ? { seriesId } : {}),
      ...(number ? { number } : {}),
      ...(title ? { title } : {}),
      ...(seriesTitle ? { seriesTitle } : {}),
    });
    const res = await api<{
      sessionId: string;
      source: string;
      chapterId: string;
      seriesId: string;
      chapterNumber: number;
      title: string;
      seriesTitle: string;
      totalPages: number;
      pages: { number: number; url: string }[];
    }>(`/api/stream/chapter?${q.toString()}`);

    return {
      id: `${source}:${chapterId}`,
      seriesId: seriesId || source,
      seriesTitle: res.seriesTitle || seriesTitle || 'Manga',
      title: res.title || (res.chapterNumber ? `Chapter ${res.chapterNumber}` : 'Chapter'),
      pages: res.pages.map((p) => ({ number: p.number, width: null, height: null })),
      offline: false,
      stream: true,
      streamPageUrls: res.pages.map((p) => p.url),
      streamSource: source,
      streamChapterId: chapterId,
      streamSeriesId: seriesId,
    };
  } catch {
    return null;
  }
}

function ReaderInner() {
  const searchParams = useSearchParams();
  const bookId = searchParams.get('book') || '';
  const streamSource = searchParams.get('source') || '';
  const streamChapterId = searchParams.get('chapterId') || '';
  const streamSeriesId = searchParams.get('seriesId') || '';
  const streamNumber = searchParams.get('number') || '';
  const streamTitle = searchParams.get('title') || '';
  const streamSeriesTitle = searchParams.get('seriesTitle') || '';
  const isStream = Boolean(streamSource && streamChapterId);
  const [downloadingStream, setDownloadingStream] = useState(false);
  const router = useRouter();

  const [chapters, setChapters] = useState<Chapter[]>([]);
  const [chapterRefs, setChapterRefs] = useState<ChapterRef[]>([]);
  const [startPage, setStartPage] = useState(1);
  const [ready, setReady] = useState(false);
  const [ended, setEnded] = useState(false);
  const [failed, setFailed] = useState<null | 'unreadable' | 'unavailable'>(null);
  const [reloadKey, setReloadKey] = useState(0);

  const [prefs, setPrefs] = useState<ReaderPrefs>(loadPrefs());
  const [zoom, setZoom] = useState(1);
  const [rtl, setRtl] = useState(false);
  const [scrubbing, setScrubbing] = useState(false);

  const [chrome, setChrome] = useState(true);
  const [showSettings, setShowSettings] = useState(false);
  const [showChapters, setShowChapters] = useState(false);
  const [showPageJump, setShowPageJump] = useState(false);
  const [jumpPageVal, setJumpPageVal] = useState('');
  const [clockTime, setClockTime] = useState('');
  const [batteryLevel, setBatteryLevel] = useState<number | null>(null);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [current, setCurrent] = useState(0);

  const scrollRef = useRef<HTMLDivElement>(null);
  const [colW, setColW] = useState(0);
  const didInitScroll = useRef(false);
  const blobUrls = useRef<Map<string, string>>(new Map());
  const appending = useRef(false);
  const noMore = useRef(false);
  const tap = useRef<{ x: number; y: number; t: number } | null>(null);
  const lastTapAt = useRef(0);
  const tapTimer = useRef<any>(null);
  const pointers = useRef<Map<number, { x: number; y: number }>>(new Map());
  const pinch = useRef<{ dist: number; zoom: number } | null>(null);

  const seriesId0 = chapters[0]?.seriesId || '';
  const setPref = (p: Partial<ReaderPrefs>) =>
    setPrefs((cur) => {
      const n = { ...cur, ...p };
      savePrefs(n);
      if (seriesId0) {
        saveSeriesPrefs(seriesId0, {
          mode: n.mode,
          fit: n.fit,
          webtoonWidth: n.webtoonWidth,
          theme: n.theme,
          spread: n.spread,
          offsetCover: n.offsetCover,
          navButtons: n.navButtons,
          tapZone: n.tapZone,
          invertColors: n.invertColors,
        });
      }
      return n;
    });

  const applyZoom = (z: number) => {
    const clamped = Math.max(1, Math.min(3, z));
    setZoom(clamped);
    if (seriesId0) saveSeriesPrefs(seriesId0, { zoom: clamped });
  };

  // Clock & battery for ambient HUD
  useEffect(() => {
    const updateTime = () => {
      const now = new Date();
      setClockTime(now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }));
    };
    updateTime();
    const t = setInterval(updateTime, 15_000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    if (typeof navigator !== 'undefined' && 'getBattery' in navigator) {
      (navigator as any).getBattery?.().then((bat: any) => {
        setBatteryLevel(Math.round(bat.level * 100));
        bat.addEventListener('levelchange', () => setBatteryLevel(Math.round(bat.level * 100)));
      }).catch(() => {});
    }
  }, []);

  // Fullscreen tracking
  useEffect(() => {
    const onFs = () => setIsFullscreen(Boolean(document.fullscreenElement));
    document.addEventListener('fullscreenchange', onFs);
    return () => document.removeEventListener('fullscreenchange', onFs);
  }, []);

  // ---- (re)load on bookId or stream params change ----
  useEffect(() => {
    let alive = true;
    setReady(false);
    setEnded(false);
    didInitScroll.current = false;
    appending.current = false;
    noMore.current = false;
    completedSent.current.clear();
    prevPos.current = null;
    blobUrls.current.forEach((u) => URL.revokeObjectURL(u));
    blobUrls.current.clear();
    (async () => {
      const first = isStream
        ? await loadStreamChapter(streamSource, streamChapterId, streamSeriesId, streamNumber, streamTitle, streamSeriesTitle)
        : await loadChapter(bookId);
      if (!alive) return;
      setFailed(null);
      const outcome = chapterOutcome(first);
      if (outcome !== 'ok' || !first) { setFailed(outcome === 'ok' ? 'unavailable' : outcome); setReady(true); return; }

      setStartPage(1);
      if (!isStream && bookId) {
        try {
          const b = await api<Book>(`/api/books/${bookId}`);
          if (b.readProgress && !b.readProgress.completed) setStartPage(b.readProgress.page);
        } catch {}
      }

      if (!alive) return;
      setChapters([first]);

      // chapter list for prev/next/jump
      if (isStream && streamSource && streamSeriesId) {
        try {
          const list = await api<{ chapters: Array<{ sourceId: string; number: number; title: string }> }>(
            `/api/stream/chapters?source=${encodeURIComponent(streamSource)}&seriesId=${encodeURIComponent(streamSeriesId)}`
          );
          if (alive && list.chapters) {
            setChapterRefs(
              list.chapters.map((c) => ({
                id: c.sourceId,
                label: c.title || `Chapter ${c.number}`,
                streamSource,
                streamSeriesId,
                number: c.number,
              }))
            );
          }
        } catch {}
      } else if (!isStream && first.seriesId) {
        try {
          const list = await api<Page<Book>>(`/api/series/${first.seriesId}/books?size=1000&sort=metadata.numberSort,asc`);
          if (alive) setChapterRefs(list.content.map((b) => ({ id: b.id, label: chapterLabel(b) })));
        } catch {}
      }

      // reading direction
      if (!isStream && first.seriesId) {
        try {
          const s = await api<Series>(`/api/series/${first.seriesId}`);
          if (alive) setRtl(s?.metadata?.readingDirection === 'RIGHT_TO_LEFT');
        } catch {}
      }
      setReady(true);
    })();
    return () => {
      alive = false;
      blobUrls.current.forEach((u) => URL.revokeObjectURL(u));
      blobUrls.current.clear();
    };
  }, [bookId, streamSource, streamChapterId, streamSeriesId, streamNumber, streamTitle, streamSeriesTitle, isStream, reloadKey]);

  // ---- flat page list ----
  const flat: FlatItem[] = useMemo(() => {
    const out: FlatItem[] = [];
    chapters.forEach((ch, ci) => {
      ch.pages.forEach((p, pi) => {
        out.push({ ci, number: p.number, width: p.width, height: p.height, key: `${ch.id}:${p.number}`, firstOfChapter: pi === 0 });
      });
    });
    return out;
  }, [chapters]);

  // ---- paged slides: 1 page per slide, or double spreads ----
  const isPaged = prefs.mode.startsWith('paged');
  const isVerticalPaged = prefs.mode === 'paged-vertical';

  const { slides, slideOf } = useMemo(() => {
    const sl: number[][] = [];
    if (isPaged && prefs.spread && !isVerticalPaged) {
      let k = 0;
      while (k < flat.length) {
        const it = flat[k];
        const nxt = flat[k + 1];
        if (prefs.offsetCover && (it.firstOfChapter || !nxt || nxt.ci !== it.ci)) {
          sl.push([k]);
          k++;
        } else if (!nxt || nxt.ci !== it.ci) {
          sl.push([k]);
          k++;
        } else {
          sl.push([k, k + 1]);
          k += 2;
        }
      }
    } else {
      for (let k = 0; k < flat.length; k++) sl.push([k]);
    }
    const so: number[] = new Array(flat.length);
    sl.forEach((idxs, s) => idxs.forEach((k) => { so[k] = s; }));
    return { slides: sl, slideOf: so };
  }, [flat, isPaged, prefs.spread, isVerticalPaged, prefs.offsetCover]);

  // ---- measure column width (× zoom) ----
  useEffect(() => {
    const measure = () => {
      const w = scrollRef.current?.clientWidth || window.innerWidth;
      let base = w;
      if (prefs.mode === 'vertical') {
        const maxW = prefs.webtoonWidth > 0 ? prefs.webtoonWidth : w;
        base = Math.min(w, maxW);
      }
      setColW(base * zoom);
    };
    measure();
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, [prefs.mode, prefs.webtoonWidth, ready, zoom]);

  // keep page roughly centered when zooming
  useEffect(() => {
    const el = scrollRef.current;
    if (!el || !didInitScroll.current) return;
    if (zoom > 1) el.scrollLeft = (el.scrollWidth - el.clientWidth) / 2;
    if (prefs.mode === 'vertical' && tops[current] != null) el.scrollTop = tops[current];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [zoom, colW]);

  // ---- reserved heights + cumulative tops ----
  const { heights, tops } = useMemo(() => {
    const hs = flat.map((p) => (p.width && p.height ? colW * (p.height / p.width) : colW * 1.4));
    const ts: number[] = [];
    let acc = 0;
    flat.forEach((p, i) => {
      if (p.firstOfChapter && p.ci > 0) acc += DIVIDER_H;
      ts.push(acc);
      acc += hs[i] + prefs.gap;
    });
    return { heights: hs, tops: ts };
  }, [flat, colW, prefs.gap]);

  // ---- active render window ----
  const activeSet = useMemo(() => {
    const s = new Set<number>();
    for (let i = current - WINDOW_BEHIND; i <= current + WINDOW_AHEAD; i++) if (i >= 0 && i < flat.length) s.add(i);
    return s;
  }, [current, flat.length]);

  // ---- offline blob URLs within window ----
  const [, force] = useState(0);
  useEffect(() => {
    let alive = true;
    (async () => {
      const map = blobUrls.current;
      for (const i of activeSet) {
        const it = flat[i];
        const ch = chapters[it.ci];
        if (ch?.offline && !map.has(it.key)) {
          const blob = await getPageBlob(ch.id, it.number);
          if (blob && alive) map.set(it.key, URL.createObjectURL(blob));
        }
      }
      for (const [k] of map) {
        const idx = flat.findIndex((p) => p.key === k);
        if (idx < current - 12 || idx > current + 18) {
          URL.revokeObjectURL(map.get(k)!);
          map.delete(k);
        }
      }
      if (alive) force((n) => n + 1);
    })();
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeSet]);

  const srcFor = (i: number): string | null => {
    const it = flat[i];
    const ch = chapters[it.ci];
    if (!ch) return null;
    if (ch.offline) return blobUrls.current.get(it.key) || null;
    if (ch.stream && ch.streamPageUrls) return ch.streamPageUrls[it.number - 1] || null;
    return img.page(ch.id, it.number);
  };

  // ---- initial scroll to resume page ----
  useEffect(() => {
    if (!ready || didInitScroll.current || !colW || !tops.length) return;
    const idx = Math.max(0, Math.min(flat.length - 1, startPage - 1));
    if (prefs.mode === 'vertical' && scrollRef.current && idx > 0) scrollRef.current.scrollTop = tops[idx];
    if (isPaged && scrollRef.current && idx > 0)
      scrollRef.current.scrollLeft = (slideOf[idx] ?? idx) * scrollRef.current.clientWidth;
    setCurrent(idx);
    didInitScroll.current = true;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, colW, tops]);

  // ---- track current page on scroll ----
  const onScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    if (prefs.mode === 'paged-vertical') {
      const s = Math.round(el.scrollTop / Math.max(1, el.clientHeight));
      const idxs = slides[Math.max(0, Math.min(slides.length - 1, s))];
      const i = idxs ? idxs[idxs.length - 1] : 0;
      setCurrent((c) => (c === i ? c : i));
      return;
    }
    if (isPaged || prefs.mode === 'continuous-horizontal') {
      const s = Math.round(el.scrollLeft / Math.max(1, el.clientWidth));
      const idxs = slides[Math.max(0, Math.min(slides.length - 1, s))];
      const i = idxs ? idxs[idxs.length - 1] : 0;
      setCurrent((c) => (c === i ? c : i));
      return;
    }
    const probe = el.scrollTop + el.clientHeight * 0.4;
    let lo = 0, hi = tops.length - 1, ans = 0;
    while (lo <= hi) { const mid = (lo + hi) >> 1; if (tops[mid] <= probe) { ans = mid; lo = mid + 1; } else hi = mid - 1; }
    setCurrent((c) => (c === ans ? c : ans));
  }, [tops, prefs.mode, isPaged, slides]);

  // ---- continuous reading: append next chapter near the end ----
  useEffect(() => {
    if (!ready || !flat.length || appending.current || noMore.current) return;
    if (current < flat.length - 4) return;
    appending.current = true;
    (async () => {
      const last = chapters[chapters.length - 1];
      const idx = chapterRefs.findIndex((c) => c.id === last?.id);
      const next = idx >= 0 ? chapterRefs[idx + 1] : null;
      if (!next) { noMore.current = true; setEnded(true); appending.current = false; return; }
      const ch = isStream
        ? await loadStreamChapter(streamSource, next.id, streamSeriesId, String(next.number ?? ''), next.label, streamSeriesTitle)
        : await loadChapter(next.id);
      const outcome = chapterOutcome(ch);
      if (outcome === 'ok') setChapters((cs) => (cs.some((c) => c.id === ch!.id) ? cs : [...cs, ch!]));
      else { noMore.current = true; setFailed(outcome); }
      appending.current = false;
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [current, ready, flat.length, chapterRefs]);

  // ---- submit progress for active chapter ----
  const lastSent = useRef('');
  const completedSent = useRef(new Set<string>());
  const prevPos = useRef<{ ci: number } | null>(null);
  const sendProgress = useCallback((chId: string, sId: string, page: number, completed: boolean) => {
    if (isStream) {
      try {
        localStorage.setItem(`yomi_stream_prog_${sId}`, JSON.stringify({ chapterId: chId, page, completed, time: Date.now() }));
      } catch {}
      return;
    }
    const payload = { page, completed, seriesId: sId, deviceId: deviceId() };
    api(`/api/books/${chId}/progress`, { method: 'PUT', json: payload }).catch(() => queueProgress({ bookId: chId, ...payload }));
  }, [isStream]);

  useEffect(() => {
    if (!ready || !flat.length) return;
    const it = flat[current];
    if (!it) return;
    const ch = chapters[it.ci];
    if (!ch) return;
    const prev = prevPos.current;
    prevPos.current = { ci: it.ci };
    if (prev && it.ci > prev.ci) {
      const dep = chapters[prev.ci];
      if (dep && !completedSent.current.has(dep.id)) {
        completedSent.current.add(dep.id);
        sendProgress(dep.id, dep.seriesId, dep.pages[dep.pages.length - 1]?.number ?? dep.pages.length, true);
      }
    }
    const isLastOfChapter = current === flat.length - 1 || flat[current + 1]?.ci !== it.ci;
    const tag = `${ch.id}:${it.number}`;
    if (lastSent.current === tag) return;
    if (isLastOfChapter && !completedSent.current.has(ch.id)) {
      completedSent.current.add(ch.id);
      sendProgress(ch.id, ch.seriesId, it.number, true);
    } else {
      const t = setTimeout(() => {
        lastSent.current = tag;
        sendProgress(ch.id, ch.seriesId, it.number, false);
      }, 600);
      return () => clearTimeout(t);
    }
  }, [current, flat, chapters, ready, sendProgress]);

  // ---- auto scroll (vertical mode) ----
  const reqId = useRef<number | null>(null);
  const lastFrame = useRef<number>(0);
  const subPixel = useRef<number>(0);
  useEffect(() => {
    if (prefs.mode !== 'vertical' || prefs.autoScroll <= 0 || !ready) return;
    const step = (t: number) => {
      const el = scrollRef.current;
      if (!el) return;
      if (lastFrame.current) {
        const dt = (t - lastFrame.current) / 16.666;
        subPixel.current += prefs.autoScroll * dt;
        const whole = Math.floor(subPixel.current);
        if (whole > 0) {
          el.scrollTop += whole;
          subPixel.current -= whole;
        }
      }
      lastFrame.current = t;
      reqId.current = requestAnimationFrame(step);
    };
    reqId.current = requestAnimationFrame(step);
    return () => {
      if (reqId.current) cancelAnimationFrame(reqId.current);
      lastFrame.current = 0;
      subPixel.current = 0;
    };
  }, [prefs.autoScroll, prefs.mode, ready]);

  // ---- chapter prev/next navigation ----
  const activeChapter = flat[current] ? chapters[flat[current].ci] : chapters[0];
  const seriesId = activeChapter?.seriesId;
  const currentChapterIndex = chapterRefs.findIndex((c) => c.id === activeChapter?.id);
  const prevId = currentChapterIndex > 0 ? chapterRefs[currentChapterIndex - 1]?.id : undefined;
  const nextId = currentChapterIndex >= 0 && currentChapterIndex < chapterRefs.length - 1 ? chapterRefs[currentChapterIndex + 1]?.id : undefined;

  const { data: upNext } = useQuery({
    queryKey: ['reader-up-next', seriesId],
    queryFn: () => api<Page<Series>>(`/api/series/${seriesId}/up-next`),
    enabled: ended && Boolean(seriesId),
  });

  const seriesHref = isStream ? undefined : seriesId ? `/series/?id=${seriesId}` : undefined;
  const back = () => {
    if (typeof window !== 'undefined' && window.history.length > 1) router.back();
    else if (seriesHref) router.push(seriesHref);
    else router.push('/');
  };

  const goChapter = (cid?: string) => {
    if (!cid) return;
    if (isStream) {
      const ref = chapterRefs.find((r) => r.id === cid);
      const num = ref?.number != null ? String(ref.number) : '';
      const lbl = ref?.label || '';
      router.replace(
        `/reader/?source=${encodeURIComponent(streamSource)}&chapterId=${encodeURIComponent(cid)}&seriesId=${encodeURIComponent(streamSeriesId)}&number=${num}&title=${encodeURIComponent(lbl)}&seriesTitle=${encodeURIComponent(streamSeriesTitle)}`
      );
    } else {
      router.replace(`/reader/?book=${cid}`);
    }
  };

  const toggleFullscreen = () => {
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
    else document.documentElement.requestFullscreen?.().catch(() => {});
  };

  // Nav helpers for tap zones, shortcuts, and buttons
  const navNext = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    if (prefs.mode === 'vertical') {
      el.scrollBy({ top: el.clientHeight * 0.85, behavior: 'smooth' });
    } else if (prefs.mode === 'paged-vertical') {
      el.scrollBy({ top: el.clientHeight, behavior: 'smooth' });
    } else if (prefs.mode === 'paged-rtl') {
      el.scrollBy({ left: -el.clientWidth, behavior: 'smooth' });
    } else {
      el.scrollBy({ left: el.clientWidth, behavior: 'smooth' });
    }
  }, [prefs.mode]);

  const navPrev = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    if (prefs.mode === 'vertical') {
      el.scrollBy({ top: -el.clientHeight * 0.85, behavior: 'smooth' });
    } else if (prefs.mode === 'paged-vertical') {
      el.scrollBy({ top: -el.clientHeight, behavior: 'smooth' });
    } else if (prefs.mode === 'paged-rtl') {
      el.scrollBy({ left: el.clientWidth, behavior: 'smooth' });
    } else {
      el.scrollBy({ left: -el.clientWidth, behavior: 'smooth' });
    }
  }, [prefs.mode]);

  // Jump to specific page
  const jumpToPage = (pgNum: number) => {
    const targetIdx = flat.findIndex((p) => p.ci === (flat[current]?.ci ?? 0) && p.number === pgNum);
    if (targetIdx >= 0) {
      setCurrent(targetIdx);
      if (prefs.mode === 'vertical') scrollRef.current?.scrollTo({ top: tops[targetIdx] || 0 });
      else if (prefs.mode === 'paged-vertical') scrollRef.current?.scrollTo({ top: (slideOf[targetIdx] ?? targetIdx) * (scrollRef.current?.clientHeight || 0) });
      else scrollRef.current?.scrollTo({ left: (slideOf[targetIdx] ?? targetIdx) * (scrollRef.current?.clientWidth || 0) });
    }
    setShowPageJump(false);
  };

  // ---- ambient cover-art theming ----
  useEffect(() => {
    if (!seriesId) return;
    let alive = true;
    api<{ color: string | null }>(`/api/series/${seriesId}/color`).then((r) => { if (alive) applyCover(r.color); }).catch(() => {});
    return () => { alive = false; clearCover(); };
  }, [seriesId]);

  // ---- adopt account settings ----
  const pulledPrefs = useRef(false);
  useEffect(() => {
    if (pulledPrefs.current) return;
    pulledPrefs.current = true;
    syncPrefsFromServer().then((p) => setPrefs((cur) => ({ ...cur, ...p }))).catch(() => {});
  }, []);

  // ---- per-series memory ----
  useEffect(() => {
    if (!seriesId) return;
    const sp = loadSeriesPrefs(seriesId);
    if (sp.mode || sp.theme || sp.fit || sp.spread !== undefined) {
      setPrefs((cur) => ({
        ...cur,
        ...(sp.mode ? { mode: sp.mode } : {}),
        ...(sp.theme ? { theme: sp.theme } : {}),
        ...(sp.fit ? { fit: sp.fit } : {}),
        ...(sp.webtoonWidth !== undefined ? { webtoonWidth: sp.webtoonWidth } : {}),
        ...(sp.spread !== undefined ? { spread: sp.spread } : {}),
        ...(sp.offsetCover !== undefined ? { offsetCover: sp.offsetCover } : {}),
        ...(sp.navButtons !== undefined ? { navButtons: sp.navButtons } : {}),
        ...(sp.tapZone ? { tapZone: sp.tapZone } : {}),
        ...(sp.invertColors !== undefined ? { invertColors: sp.invertColors } : {}),
      }));
    }
    setZoom(sp.zoom && sp.zoom >= 1 ? sp.zoom : 1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [seriesId]);

  // ---- auto-hide chrome ----
  useEffect(() => {
    if (!chrome || showSettings || showChapters || showPageJump) return;
    const t = setTimeout(() => setChrome(false), 3800);
    return () => clearTimeout(t);
  }, [chrome, showSettings, showChapters, showPageJump]);

  // ---- keyboard shortcuts ----
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (['INPUT', 'SELECT', 'TEXTAREA'].includes((e.target as HTMLElement)?.tagName)) return;
      if (e.key === '[') goChapter(prevId);
      else if (e.key === ']') goChapter(nextId);
      else if (e.key === 'f') toggleFullscreen();
      else if (e.key === 'm') setChrome((c) => !c);
      else if (e.key === 'Escape') {
        if (showSettings) setShowSettings(false);
        else if (showChapters) setShowChapters(false);
        else if (showPageJump) setShowPageJump(false);
        else back();
      } else if (e.key === 'ArrowRight' || e.key === 'l') {
        e.preventDefault();
        if (prefs.mode === 'paged-rtl') navPrev();
        else navNext();
      } else if (e.key === 'ArrowLeft' || e.key === 'h') {
        e.preventDefault();
        if (prefs.mode === 'paged-rtl') navNext();
        else navPrev();
      } else if (e.key === 'ArrowDown' || e.key === 'j') {
        e.preventDefault();
        navNext();
      } else if (e.key === 'ArrowUp' || e.key === 'k') {
        e.preventDefault();
        navPrev();
      } else if (e.key === ' ') {
        e.preventDefault();
        if (e.shiftKey) navPrev();
        else navNext();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [prevId, nextId, prefs.mode, navNext, navPrev, showSettings, showChapters, showPageJump]);

  // ---- pointer / tap gesture handling ----
  const onPointerDown = (e: React.PointerEvent) => {
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.current.size === 2) {
      const p = [...pointers.current.values()];
      pinch.current = { dist: Math.hypot(p[0].x - p[1].x, p[0].y - p[1].y), zoom };
      tap.current = null;
      if (tapTimer.current) { clearTimeout(tapTimer.current); tapTimer.current = null; }
    } else {
      tap.current = { x: e.clientX, y: e.clientY, t: Date.now() };
    }
  };

  const onPointerMove = (e: React.PointerEvent) => {
    if (!pointers.current.has(e.pointerId)) return;
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pinch.current && pointers.current.size === 2) {
      const p = [...pointers.current.values()];
      const dist = Math.hypot(p[0].x - p[1].x, p[0].y - p[1].y);
      setZoom(Math.max(1, Math.min(3, pinch.current.zoom * (dist / pinch.current.dist))));
    }
  };

  const onPointerEnd = (e: React.PointerEvent) => {
    const wasPinch = !!pinch.current;
    pointers.current.delete(e.pointerId);
    if (wasPinch && pointers.current.size < 2) {
      pinch.current = null;
      if (seriesId0) saveSeriesPrefs(seriesId0, { zoom });
      tap.current = null;
      return;
    }
    if (wasPinch) return;
    const s = tap.current; tap.current = null;
    if (!s) return;
    if (Math.abs(e.clientX - s.x) > 10 || Math.abs(e.clientY - s.y) > 10 || Date.now() - s.t > 300) return;
    const now = Date.now();
    if (now - lastTapAt.current < 300) {
      if (tapTimer.current) { clearTimeout(tapTimer.current); tapTimer.current = null; }
      lastTapAt.current = 0;
      applyZoom(zoom > 1 ? 1 : 2);
      return;
    }
    lastTapAt.current = now;

    const x = e.clientX;
    const y = e.clientY;
    const w = window.innerWidth;
    const h = window.innerHeight;

    tapTimer.current = setTimeout(() => {
      tapTimer.current = null;
      if (prefs.tapZone === 'off') {
        setChrome((c) => !c);
        return;
      }

      if (prefs.tapZone === 'kindle') {
        if (y < h * 0.18) setChrome((c) => !c);
        else if (x < w * 0.22) navPrev();
        else navNext();
        return;
      }

      if (prefs.tapZone === 'l-shaped') {
        if (y > h * 0.72 || x > w * 0.72) navNext();
        else if (x < w * 0.25 || y < h * 0.20) navPrev();
        else setChrome((c) => !c);
        return;
      }

      // Default 3-Zone
      if (x < w * 0.30) {
        if (prefs.mode === 'paged-rtl') navNext();
        else navPrev();
      } else if (x > w * 0.70) {
        if (prefs.mode === 'paged-rtl') navPrev();
        else navNext();
      } else {
        setChrome((c) => !c);
      }
    }, 260);
  };

  const total = flat.length;
  const pageInChapter = activeChapter ? (flat[current]?.number ?? 0) : 0;
  const chapterPageCount = activeChapter?.pages.length ?? 0;

  // Bookmarks
  const [marks, setMarks] = useState<Set<string>>(new Set());
  const markKey = (bookId: string, page: number) => `${bookId}:${page}`;
  const bookmarked = activeChapter ? marks.has(markKey(activeChapter.id, pageInChapter)) : false;
  useEffect(() => {
    if (!seriesId) return;
    api<{ content: Array<{ book_id: string; page: number }> }>(`/api/bookmarks?seriesId=${encodeURIComponent(seriesId)}`)
      .then((r) => setMarks(new Set(r.content.map((b) => markKey(b.book_id, b.page)))))
      .catch(() => {});
  }, [seriesId]);

  const toggleBookmark = async () => {
    if (!activeChapter || !pageInChapter) return;
    const k = markKey(activeChapter.id, pageInChapter);
    const on = marks.has(k);
    setMarks((prev) => { const n = new Set(prev); on ? n.delete(k) : n.add(k); return n; });
    try {
      await api(`/api/bookmarks/${encodeURIComponent(activeChapter.id)}/${pageInChapter}`,
        { method: on ? 'DELETE' : 'PUT', json: on ? undefined : {} });
    } catch {
      setMarks((prev) => { const n = new Set(prev); on ? n.add(k) : n.delete(k); return n; });
    }
  };

  // Title header block
  const titleBlock = (
    <>
      <p className="flex items-center gap-1.5 text-sm font-medium text-white transition group-hover:text-accent">
        <span className="truncate">{activeChapter?.seriesTitle || 'Reading'}</span>
        {isStream && (
          <span className="chip text-[9px] px-1.5 py-0 text-accent-400 border-accent-500/40 bg-accent-500/10 shrink-0 font-medium">
            Live Stream
          </span>
        )}
        {seriesHref && <IcChevronRight width={14} height={14} className="shrink-0 text-fog-500 transition group-hover:text-accent" />}
      </p>
      <p className="truncate text-[11px] text-fog-400">{activeChapter?.title}</p>
    </>
  );

  const retry = () => { setFailed(null); setReady(false); setReloadKey((k) => k + 1); };
  const failureCard = (
    <motion.div initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4 }}
      className="mx-auto w-full max-w-3xl px-6 py-16 text-center">
      <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-fog-500">
        {failed === 'unreadable' ? tr('Chapter unreadable') : tr('Chapter unavailable')}
      </p>
      <h2 className="mt-1.5 font-display text-2xl font-bold text-white">
        {activeChapter?.seriesTitle || tr('This chapter')}
      </h2>
      <p className="mx-auto mt-3 max-w-md text-sm text-fog-400">
        {failed === 'unreadable'
          ? tr('This chapter has no readable pages. The file may be damaged, or its library may not be mounted right now.')
          : tr('This chapter could not be loaded. It may have been removed, or the connection dropped.')}
      </p>
      <div className="mt-6 flex justify-center gap-2">
        <button onClick={retry} className="btn-accent text-sm">{tr('Try again')}</button>
        <button onClick={() => (seriesHref ? router.push(seriesHref) : back())} className="btn-ghost text-sm">{tr('Back to series')}</button>
      </div>
    </motion.div>
  );

  const upNextCard = (
    <motion.div initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5 }}
      className="mx-auto w-full max-w-3xl px-6 py-16 text-center">
      <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-fog-500">{tr('You finished')}</p>
      <h2 className="mt-1.5 font-display text-2xl font-bold text-white">{activeChapter?.seriesTitle || 'this series'}</h2>
      <div className="mt-6 flex justify-center gap-2">
        <button onClick={() => (seriesHref ? router.push(seriesHref) : back())} className="btn-ghost text-sm">{tr('Back to series')}</button>
        <button onClick={() => router.push('/')} className="btn-accent text-sm">{tr('Home')}</button>
      </div>
      {!!upNext?.content?.length && (
        <div className="mt-12 text-start">
          <SectionTitle>{tr('Because you finished this')}</SectionTitle>
          <Rail>{upNext.content.map((s) => <SeriesCard key={s.id} series={s} />)}</Rail>
        </div>
      )}
    </motion.div>
  );

  // Fit class for paged modes
  const pagedFitClass = {
    contain: 'max-h-full max-w-full object-contain',
    width: 'w-full h-auto max-h-none object-contain',
    height: 'h-full w-auto max-w-none object-contain',
    original: 'max-h-none max-w-none object-none',
  }[prefs.fit || 'contain'];

  const webtoonImgClass = prefs.fit === 'original'
    ? 'max-w-none object-none mx-auto'
    : 'block w-full object-contain';

  return (
    <div className="fixed inset-0 z-40 bg-ink-950 select-none">
      <div className="pointer-events-none absolute inset-0 z-30 bg-black" style={{ opacity: 1 - prefs.brightness }} />
      {/* ambient cover wash */}
      <div className="pointer-events-none absolute inset-x-0 top-0 z-20 h-36" style={{ background: 'linear-gradient(to bottom, rgb(var(--cover, 0 0 0) / 0.16), transparent)' }} />
      <div className="pointer-events-none absolute inset-x-0 bottom-0 z-20 h-36" style={{ background: 'linear-gradient(to top, rgb(var(--cover, 0 0 0) / 0.16), transparent)' }} />

      {/* FLOATING NAVIGATION BUTTONS */}
      {prefs.navButtons && (
        <div className="pointer-events-none fixed inset-y-0 inset-x-3 z-30 flex items-center justify-between">
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); prefs.mode === 'paged-rtl' ? navNext() : navPrev(); }}
            className="pointer-events-auto flex h-12 w-12 items-center justify-center rounded-full bg-black/60 text-white/90 backdrop-blur-md border border-ink-700/60 shadow-xl active:scale-95 transition hover:bg-black/80 hover:text-white"
            aria-label={prefs.mode === 'paged-rtl' ? tr('Next page') : tr('Previous page')}
          >
            <IcChevronLeft width={24} height={24} />
          </button>
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); prefs.mode === 'paged-rtl' ? navPrev() : navNext(); }}
            className="pointer-events-auto flex h-12 w-12 items-center justify-center rounded-full bg-black/60 text-white/90 backdrop-blur-md border border-ink-700/60 shadow-xl active:scale-95 transition hover:bg-black/80 hover:text-white"
            aria-label={prefs.mode === 'paged-rtl' ? tr('Previous page') : tr('Next page')}
          >
            <IcChevronRight width={24} height={24} />
          </button>
        </div>
      )}

      {/* AMBIENT MINIMAL READING HUD */}
      {!chrome && prefs.showHud && (
        <div className="pointer-events-none fixed bottom-3 left-1/2 -translate-x-1/2 z-30 flex items-center gap-2 rounded-full bg-black/60 px-3.5 py-1 text-[11px] font-medium text-fog-400 backdrop-blur-md border border-ink-700/40 shadow-sm transition-opacity">
          <span className="truncate max-w-[120px] sm:max-w-[180px]">{activeChapter?.title || `Ch. ${pageInChapter}`}</span>
          <span className="text-ink-600">•</span>
          <span className="tabular-nums text-fog-200">{chapterPageCount ? `${pageInChapter}/${chapterPageCount}` : `${current + 1}/${total}`}</span>
          {clockTime && (
            <>
              <span className="text-ink-600">•</span>
              <span className="tabular-nums">{clockTime}</span>
            </>
          )}
          {batteryLevel !== null && (
            <>
              <span className="text-ink-600">•</span>
              <span className="tabular-nums">{batteryLevel}%</span>
            </>
          )}
        </div>
      )}

      {/* PAGES RENDERING VIEWPORTS */}
      {prefs.mode === 'vertical' ? (
        <div ref={scrollRef} data-lenis-prevent onScroll={onScroll} onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerEnd} onPointerCancel={onPointerEnd}
          className={`h-screen-d touch-pan-y overflow-y-auto overscroll-contain ${zoom > 1 ? 'overflow-x-auto' : 'overflow-x-hidden'}`}>
          <div className="mx-auto" style={{ width: colW || '100%', filter: getEffectiveFilter(prefs.theme, prefs.invertColors) }}>
            <div className="h-2" />
            {flat.map((p, i) => (
              <div key={p.key}>
                {p.firstOfChapter && p.ci > 0 && (
                  <div style={{ height: DIVIDER_H }} className="flex items-center justify-center gap-3 text-xs text-fog-500">
                    <span className="h-px w-8 bg-ink-700" />
                    <span className="text-[10px] font-semibold uppercase tracking-[0.16em] text-fog-600">{tr('Up Next')}</span>
                    <span className="text-fog-400">{chapters[p.ci]?.title || 'Next chapter'}</span>
                    <span className="h-px w-8 bg-ink-700" />
                  </div>
                )}
                <div style={{ height: heights[i] || undefined, marginBottom: prefs.gap }} className="relative w-full bg-ink-900 flex justify-center">
                  {activeSet.has(i) && srcFor(i) ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={srcFor(i)!} alt={`Page ${p.number}`} className={webtoonImgClass} decoding="async" />
                  ) : (
                    <div className="flex h-full w-full items-center justify-center text-xs text-ink-600">{p.number}</div>
                  )}
                </div>
              </div>
            ))}
            {ended && upNextCard}
            {failed && !!flat.length && failureCard}
          </div>
        </div>
      ) : prefs.mode === 'paged-vertical' ? (
        <div ref={scrollRef} data-lenis-prevent onScroll={onScroll} onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerEnd} onPointerCancel={onPointerEnd}
          className="hide-scrollbar flex flex-col h-screen-d snap-y snap-mandatory overflow-y-auto overflow-x-hidden"
          style={{ filter: getEffectiveFilter(prefs.theme, prefs.invertColors) }}>
          {slides.map((idxs) => (
            <div key={flat[idxs[0]].key} className="relative flex h-screen-d w-full shrink-0 snap-center items-center justify-center p-1">
              {idxs.map((i) => {
                const p = flat[i];
                return activeSet.has(i) && srcFor(i) ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img key={p.key} src={srcFor(i)!} alt={`Page ${p.number}`}
                    className={pagedFitClass}
                    decoding="async" style={{ transform: zoom !== 1 ? `scale(${zoom})` : undefined }} />
                ) : (
                  <span key={p.key} className="text-ink-600">{p.number}</span>
                );
              })}
            </div>
          ))}
          {ended && (
            <div className="flex h-screen-d w-full shrink-0 snap-center items-start justify-center overflow-y-auto p-4">
              {upNextCard}
            </div>
          )}
          {failed && !!flat.length && (
            <div className="flex h-screen-d w-full shrink-0 snap-center items-start justify-center overflow-y-auto p-4">
              {failureCard}
            </div>
          )}
        </div>
      ) : prefs.mode === 'continuous-horizontal' ? (
        <div ref={scrollRef} data-lenis-prevent onScroll={onScroll} onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerEnd} onPointerCancel={onPointerEnd}
          className="hide-scrollbar flex h-screen-d overflow-x-auto overflow-y-hidden"
          style={{ filter: getEffectiveFilter(prefs.theme, prefs.invertColors) }}>
          {flat.map((p, i) => (
            <div key={p.key} style={{ marginRight: prefs.gap }} className="relative flex h-full shrink-0 items-center justify-center">
              {activeSet.has(i) && srcFor(i) ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={srcFor(i)!} alt={`Page ${p.number}`}
                  className="h-full w-auto max-w-none object-contain"
                  decoding="async" style={{ transform: zoom !== 1 ? `scale(${zoom})` : undefined }} />
              ) : (
                <span className="text-ink-600 px-6">{p.number}</span>
              )}
            </div>
          ))}
          {ended && (
            <div className="flex h-full shrink-0 items-center justify-center p-8 overflow-y-auto">
              {upNextCard}
            </div>
          )}
        </div>
      ) : (
        // Paged RTL or Paged LTR
        <div ref={scrollRef} data-lenis-prevent onScroll={onScroll} onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerEnd} onPointerCancel={onPointerEnd}
          className="hide-scrollbar flex h-screen-d snap-x snap-mandatory overflow-x-auto overflow-y-hidden"
          style={{ filter: getEffectiveFilter(prefs.theme, prefs.invertColors) }}>
          {slides.map((idxs) => {
            const isRtlMode = prefs.mode === 'paged-rtl';
            const shown = isRtlMode && idxs.length === 2 ? [idxs[1], idxs[0]] : idxs;
            return (
              <div key={flat[idxs[0]].key} className="relative flex h-full w-full shrink-0 snap-center items-center justify-center gap-1">
                {shown.map((i) => {
                  const p = flat[i];
                  return activeSet.has(i) && srcFor(i) ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img key={p.key} src={srcFor(i)!} alt={`Page ${p.number}`}
                      className={`${pagedFitClass} ${idxs.length === 2 ? 'max-w-[50%]' : ''}`}
                      decoding="async" style={{ transform: zoom !== 1 ? `scale(${zoom})` : undefined }} />
                  ) : (
                    <span key={p.key} className="text-ink-600">{p.number}</span>
                  );
                })}
              </div>
            );
          })}
          {ended && (
            <div className="flex h-full w-full shrink-0 snap-center items-start justify-center overflow-y-auto">
              {upNextCard}
            </div>
          )}
          {failed && !!flat.length && (
            <div className="flex h-full w-full shrink-0 snap-center items-start justify-center overflow-y-auto">
              {failureCard}
            </div>
          )}
        </div>
      )}

      {/* HEADER & FOOTER CHROME */}
      <AnimatePresence>
        {chrome && (
          <>
            <motion.header initial={{ y: -64, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: -64, opacity: 0 }}
              className="absolute inset-x-0 top-0 z-40 flex items-center gap-2 bg-gradient-to-b from-black/90 via-black/55 to-transparent px-3 pb-8 pt-[max(0.9rem,calc(env(safe-area-inset-top)+0.55rem))]">
              <button onClick={back} className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-black/45 text-white backdrop-blur hover:bg-black/60 transition" aria-label={tr('Back')}>
                <IcChevronLeft width={22} height={22} />
              </button>

              {seriesHref ? (
                <Link href={seriesHref} aria-label={`Open ${activeChapter?.seriesTitle || 'this'} series page`}
                  className="group min-w-0 flex-1 transition active:opacity-80">
                  {titleBlock}
                </Link>
              ) : (
                <div className="min-w-0 flex-1">{titleBlock}</div>
              )}

              {/* Chapter drawer trigger (Both Mobile & Desktop) */}
              <button
                type="button"
                onClick={() => setShowChapters(true)}
                className="flex items-center gap-1.5 rounded-full border border-ink-600 bg-black/45 px-3 py-1.5 text-xs text-fog-200 hover:text-white backdrop-blur transition active:scale-95"
                title={tr('Chapter List')}
              >
                <span>📑</span>
                <span className="hidden sm:inline font-medium">{tr('Chapters')}</span>
                {chapterRefs.length > 0 && (
                  <span className="chip text-[10px] py-0 px-1.5 bg-ink-700 text-fog-300">
                    {chapterRefs.length}
                  </span>
                )}
              </button>

              {/* Bookmark */}
              <button onClick={toggleBookmark} aria-label={bookmarked ? 'Remove bookmark' : 'Bookmark this page'}
                aria-pressed={bookmarked}
                className={`grid h-10 w-10 shrink-0 place-items-center rounded-full bg-black/45 backdrop-blur transition hover:bg-black/60 ${bookmarked ? 'text-accent' : 'text-white'}`}>
                <svg width="20" height="20" viewBox="0 0 24 24" fill={bookmarked ? 'currentColor' : 'none'}
                     stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round">
                  <path d="M6 3h12a1 1 0 0 1 1 1v17l-7-4-7 4V4a1 1 0 0 1 1-1Z" />
                </svg>
              </button>

              {/* Save stream chapter to library */}
              {isStream && streamSource && streamSeriesId && (
                <button
                  type="button"
                  onClick={async () => {
                    setDownloadingStream(true);
                    try {
                      const num = activeChapter?.title ? (parseFloat(activeChapter.title.replace(/[^0-9.]/g, '')) || 1) : 1;
                      await api('/api/sources/add', {
                        method: 'POST',
                        json: { source: streamSource, sourceId: streamSeriesId, chapterNumbers: [num] },
                      });
                      alert(tr('Chapter queued for download into library!'));
                    } catch {
                      alert(tr('Failed to queue download.'));
                    } finally {
                      setDownloadingStream(false);
                    }
                  }}
                  disabled={downloadingStream}
                  className="hidden sm:flex items-center gap-1.5 rounded-full border border-ink-600 bg-black/45 px-3 py-1.5 text-xs text-fog-200 hover:text-white backdrop-blur transition disabled:opacity-50"
                  title={tr('Save chapter to library')}
                >
                  <span>💾</span> {downloadingStream ? tr('Saving…') : tr('Save Chapter')}
                </button>
              )}

              {/* Fullscreen Button */}
              <button
                type="button"
                onClick={toggleFullscreen}
                className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-black/45 text-white backdrop-blur hover:bg-black/60 transition"
                title={tr('Toggle Fullscreen')}
                aria-label={tr('Toggle Fullscreen')}
              >
                {isFullscreen ? (
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M8 3v3a2 2 0 0 1-2 2H3m18 0h-3a2 2 0 0 1-2-2V3m0 18v-3a2 2 0 0 1 2-2h3M3 16h3a2 2 0 0 1 2 2v3" />
                  </svg>
                ) : (
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7" />
                  </svg>
                )}
              </button>

              {/* Settings Button */}
              <button onClick={() => setShowSettings(true)} className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-black/45 text-white backdrop-blur hover:bg-black/60 transition" aria-label={tr('Reader Settings')}>
                <IcSliders width={20} height={20} />
              </button>
            </motion.header>

            {/* FOOTER SCRUBBER */}
            <motion.footer initial={{ y: 64, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: 64, opacity: 0 }}
              className="absolute inset-x-0 bottom-0 z-40 bg-gradient-to-t from-black/90 via-black/55 to-transparent px-4 pt-10 pb-[max(0.9rem,calc(env(safe-area-inset-bottom)+0.4rem))]">
              <div className="relative mx-auto flex max-w-3xl items-center gap-2.5">
                {/* Scrubber thumbnail preview with stream support */}
                {scrubbing && flat[current] && (() => {
                  const it = flat[current];
                  const ch = chapters[it.ci];
                  if (!ch) return null;
                  const src = ch.stream && ch.streamPageUrls
                    ? ch.streamPageUrls[it.number - 1] || null
                    : ch.offline
                    ? blobUrls.current.get(it.key) || null
                    : img.page(ch.id, it.number, 200);
                  return (
                    <div className="pointer-events-none absolute bottom-full left-1/2 mb-3 -translate-x-1/2 overflow-hidden rounded-xl border border-ink-600 bg-ink-900 shadow-lift">
                      {src ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={src} alt="" className="h-44 w-32 object-cover" decoding="async" />
                      ) : (
                        <div className="grid h-44 w-32 place-items-center text-xs text-ink-600">{it.number}</div>
                      )}
                      <p className="truncate bg-black/75 px-2 py-1 text-center text-[10px] text-fog-200">{ch.title} · {it.number}/{ch.pages.length}</p>
                    </div>
                  );
                })()}

                {/* Prev chapter button */}
                <button onClick={() => goChapter(prevId)} disabled={!prevId}
                  className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-black/45 text-white backdrop-blur disabled:opacity-30 hover:bg-black/60 transition"
                  title={tr('Previous Chapter')}>
                  <IcChevronLeft width={18} height={18} />
                </button>

                {/* Direct Page Jump trigger */}
                <button
                  type="button"
                  onClick={() => { setJumpPageVal(String(pageInChapter || current + 1)); setShowPageJump(true); }}
                  className="shrink-0 rounded-lg px-2.5 py-1 text-[11px] tabular-nums font-semibold text-fog-200 hover:bg-white/10 hover:text-white transition"
                  title={tr('Jump to page')}
                >
                  {chapterPageCount ? `${pageInChapter} / ${chapterPageCount}` : `${current + 1} / ${total}`}
                </button>

                {/* Slider with chunky touch target */}
                <div className="flex-1 py-2 flex items-center">
                  <input type="range" min={0} max={Math.max(0, total - 1)} value={current}
                    onPointerDown={() => setScrubbing(true)}
                    onPointerUp={() => setScrubbing(false)}
                    onPointerCancel={() => setScrubbing(false)}
                    onChange={(e) => {
                      const idx = Number(e.target.value);
                      setCurrent(idx);
                      if (prefs.mode === 'vertical') scrollRef.current?.scrollTo({ top: tops[idx] || 0 });
                      else if (prefs.mode === 'paged-vertical') scrollRef.current?.scrollTo({ top: (slideOf[idx] ?? idx) * (scrollRef.current?.clientHeight || 0) });
                      else scrollRef.current?.scrollTo({ left: (slideOf[idx] ?? idx) * (scrollRef.current?.clientWidth || 0) });
                    }}
                    className="h-2 w-full cursor-pointer accent-[rgb(var(--accent))]" />
                </div>

                {/* Next chapter button */}
                <button onClick={() => goChapter(nextId)} disabled={!nextId}
                  className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-black/45 text-white backdrop-blur disabled:opacity-30 hover:bg-black/60 transition"
                  title={tr('Next Chapter')}>
                  <IcChevronRight width={18} height={18} />
                </button>
              </div>
            </motion.footer>
          </>
        )}
      </AnimatePresence>

      {/* CHAPTER DRAWER */}
      <ChapterDrawer
        open={showChapters}
        title={activeChapter?.seriesTitle}
        currentId={activeChapter?.id}
        chapters={chapterRefs}
        onSelect={goChapter}
        onClose={() => setShowChapters(false)}
      />

      {/* DIRECT PAGE JUMP MODAL */}
      {showPageJump && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={() => setShowPageJump(false)} />
          <div className="relative z-10 w-full max-w-xs rounded-2xl border border-ink-700 bg-ink-900/95 p-5 shadow-2xl backdrop-blur-2xl">
            <h4 className="font-display text-sm font-semibold text-white mb-2">{tr('Jump to Page')}</h4>
            <p className="text-xs text-fog-400 mb-3">{tr('Enter page number (1 to {max})', { max: chapterPageCount || total })}</p>
            <form onSubmit={(e) => {
              e.preventDefault();
              const val = parseInt(jumpPageVal, 10);
              if (!isNaN(val)) jumpToPage(val);
            }}>
              <input
                type="number"
                min={1}
                max={chapterPageCount || total}
                value={jumpPageVal}
                onChange={(e) => setJumpPageVal(e.target.value)}
                className="w-full rounded-xl border border-ink-700 bg-ink-800 px-3 py-2 text-sm text-fog-100 outline-none focus:border-accent mb-4"
                autoFocus
              />
              <div className="flex gap-2">
                <button type="button" onClick={() => setShowPageJump(false)} className="btn-ghost flex-1 py-2 text-xs">
                  {tr('Cancel')}
                </button>
                <button type="submit" className="btn-accent flex-1 py-2 text-xs">
                  {tr('Go')}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* READER SETTINGS MODAL */}
      <AnimatePresence>
        {showSettings && <ReaderSettings prefs={prefs} set={setPref} onClose={() => setShowSettings(false)} />}
      </AnimatePresence>

      {!ready && (
        <div className="absolute inset-0 z-50 flex items-center justify-center bg-ink-950">
          <div className="animate-pulse-soft text-fog-500">{tr('Loading chapter…')}</div>
        </div>
      )}
      {ready && failed && !flat.length && (
        <div className="absolute inset-0 z-50 flex items-center justify-center overflow-y-auto bg-ink-950">
          {failureCard}
        </div>
      )}
    </div>
  );
}

export default function ReaderPage() {
  return (
    <Suspense fallback={<div className="fixed inset-0 bg-ink-950" />}>
      <ReaderInner />
    </Suspense>
  );
}
