'use client';
import { useEffect, useRef, useState, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { Page, Series } from '@/lib/types';
import { Modal, msgOf } from '@/components/ConfirmDialog';
import { Img, ProgressBar } from '@/components/ui';
import { sourceCover } from '@/components/cards';
import { Switch } from '@/components/Switch';
import { useToast } from '@/components/Toast';
import { IcCheck, IcChevronLeft, IcSearch } from '@/components/icons';
import { t as tr } from '@/lib/i18n';

export interface Provider { source: string; name: string; sourceId: string; title: string; coverUrl?: string }
export interface ChapterItem {
  sourceId?: string;
  number: number;
  name?: string;
  date?: string | null;
  fromSourceName?: string;
  fromSourceId?: string;
  fromSeriesId?: string;
}
interface Detail {
  source: string; sourceId: string; title: string; summary: string; coverUrl: string | null;
  genres: string[]; status: string; count: number; first: number | null; last: number | null;
  chapters?: ChapterItem[];
}
interface Job { folder: string; title: string; total: number; done: number; status: string }

export type AddSeed =
  | { kind: 'trending'; title: string }
  | { kind: 'result'; provider: Provider }
  | { kind: 'group'; title: string; providers: Provider[] };

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '');
const looksCss = (s: string) =>
  s.length > 2500 || /<\/?(?:style|script)\b|\.[a-z][\w-]*\s*[{,]|@import|gtag\(|wp-manga|woocommerce|datalayer/i.test(s);

export function AddSeriesDialog({ seed, sources, onClose, onAdded }: {
  seed: AddSeed;
  sources: string[];
  onClose: () => void;
  onAdded: (r: { title: string; folder: string; chapters: number }) => void;
}) {
  const toast = useToast();
  const router = useRouter();
  const qc = useQueryClient();

  const [providers, setProviders] = useState<Provider[] | null>(seed.kind === 'group' ? seed.providers : null);
  const [picked, setPicked] = useState<Provider | null>(
    seed.kind === 'result' ? seed.provider : seed.kind === 'group' && seed.providers.length === 1 ? seed.providers[0] : null,
  );
  const [detail, setDetail] = useState<Detail | null>(null);
  const [loading, setLoading] = useState(false);
  const [mode, setMode] = useState<'preset' | 'range' | 'custom'>('custom');
  const [count, setCount] = useState(0);
  const [rangeStart, setRangeStart] = useState<string>('1');
  const [rangeEnd, setRangeEnd] = useState<string>('10');
  const [selectedChapters, setSelectedChapters] = useState<Set<number>>(new Set());
  const [chapterSearch, setChapterSearch] = useState('');
  const [sortOrder, setSortOrder] = useState<'desc' | 'asc'>('desc');
  const [lastClickedIndex, setLastClickedIndex] = useState<number | null>(null);
  const [autoUpdate, setAutoUpdate] = useState(true);
  const [adding, setAdding] = useState(false);
  const [dup, setDup] = useState<string | null>(null);
  const [done, setDone] = useState<{ title: string; folder: string; chapters: number; started?: boolean } | null>(null);
  const [opening, setOpening] = useState(false);
  const [showFullSummary, setShowFullSummary] = useState(false);

  const title = seed.kind === 'result' ? seed.provider.title : seed.title;

  useEffect(() => {
    if (providers || seed.kind === 'result') return;
    let ok = true;
    setLoading(true);
    const qParams = new URLSearchParams({ q: seed.title, ...(sources.length ? { sources: sources.join(',') } : {}) });
    api<{ content: Provider[] }>(`/api/sources/find?${qParams.toString()}`, {
      signal: AbortSignal.timeout(25_000),
    })
      .then((r) => {
        if (!ok) return;
        setProviders(r.content);
        if (r.content.length === 1) setPicked(r.content[0]);
      })
      .catch((e) => { if (ok) toast(msgOf(e, tr('Search failed.')), 'error'); })
      .finally(() => { if (ok) setLoading(false); });
    return () => { ok = false; };
  }, [seed, sources, providers, toast]);

  useEffect(() => {
    if (!picked) return;
    let ok = true;
    setLoading(true);
    api<Detail>(`/api/sources/detail?source=${encodeURIComponent(picked.source)}&sourceId=${encodeURIComponent(picked.sourceId)}`)
      .then((d) => {
        if (!ok) return;
        setDetail(d);
        if (d.first != null && d.last != null) {
          setRangeStart(String(d.first));
          setRangeEnd(String(Math.min(d.last, d.first + 9)));
        }
        if (d.chapters?.length) {
          setSelectedChapters(new Set(d.chapters.map((c) => c.number)));
        } else if (d.count === 0) {
          const qParams = new URLSearchParams({ q: d.title || title, ...(sources.length ? { sources: sources.join(',') } : {}) });
          api<{ content: Provider[] }>(`/api/sources/find?${qParams.toString()}`).then((res) => {
            if (res.content && res.content.length > 1) {
              setProviders(res.content);
            }
          }).catch(() => {});
        }
      })
      .catch((e) => { if (ok) toast(msgOf(e, tr('Could not load source details.')), 'error'); })
      .finally(() => { if (ok) setLoading(false); });
    return () => { ok = false; };
  }, [picked, toast, sources, title]);

  const { data: jobs } = useQuery({
    queryKey: ['source-jobs'],
    queryFn: () => api<{ content: Job[] }>('/api/sources/jobs'),
    enabled: !!done,
    refetchInterval: 2000,
  });
  const job = done ? (jobs?.content ?? []).find((j) => j.folder === done.folder) : undefined;

  const filteredChapters = useMemo(() => {
    if (!detail?.chapters) return [];
    let list = detail.chapters;
    if (chapterSearch.trim()) {
      const q = chapterSearch.trim().toLowerCase();
      list = list.filter((c) => String(c.number).includes(q) || (c.name && c.name.toLowerCase().includes(q)));
    }
    return [...list].sort((a, b) => (sortOrder === 'asc' ? a.number - b.number : b.number - a.number));
  }, [detail?.chapters, chapterSearch, sortOrder]);

  const detectedGaps = useMemo(() => {
    if (!detail?.chapters || detail.chapters.length < 2) return [];
    const sortedNums = Array.from(new Set(detail.chapters.map((c) => c.number))).sort((a, b) => a - b);
    const gaps: { from: number; to: number }[] = [];
    for (let i = 0; i < sortedNums.length - 1; i++) {
      const cur = sortedNums[i];
      const next = sortedNums[i + 1];
      if (next - cur > 1.05) {
        gaps.push({ from: cur + 1, to: Math.floor(next - 1) });
      }
    }
    return gaps;
  }, [detail?.chapters]);

  const effectiveSelectedCount = useMemo(() => {
    if (mode === 'preset') return count === 0 ? (detail?.count ?? 0) : count;
    if (mode === 'range') {
      const s = Number(rangeStart);
      const e = Number(rangeEnd);
      if (isNaN(s) || isNaN(e) || s > e || !detail?.chapters) return 0;
      return detail.chapters.filter((c) => c.number >= s && c.number <= e).length;
    }
    return selectedChapters.size;
  }, [mode, count, rangeStart, rangeEnd, selectedChapters, detail]);

  const toggleChapter = (num: number, idx?: number, shiftKey?: boolean) => {
    setSelectedChapters((prev) => {
      const next = new Set(prev);
      if (shiftKey && lastClickedIndex !== null && idx !== undefined) {
        const start = Math.min(lastClickedIndex, idx);
        const end = Math.max(lastClickedIndex, idx);
        const range = filteredChapters.slice(start, end + 1);
        const shouldSelect = !prev.has(num);
        range.forEach((c) => {
          if (shouldSelect) next.add(c.number);
          else next.delete(c.number);
        });
      } else {
        if (next.has(num)) next.delete(num);
        else next.add(num);
      }
      return next;
    });
    if (idx !== undefined) setLastClickedIndex(idx);
  };

  const selectAllFiltered = () => {
    setSelectedChapters((prev) => {
      const next = new Set(prev);
      filteredChapters.forEach((c) => next.add(c.number));
      return next;
    });
  };

  const deselectAllFiltered = () => {
    setSelectedChapters((prev) => {
      const next = new Set(prev);
      filteredChapters.forEach((c) => next.delete(c.number));
      return next;
    });
  };

  const invertSelection = () => {
    setSelectedChapters((prev) => {
      const next = new Set(prev);
      filteredChapters.forEach((c) => {
        if (next.has(c.number)) next.delete(c.number);
        else next.add(c.number);
      });
      return next;
    });
  };

  const pickFirstN = (n: number) => {
    if (!detail?.chapters) return;
    const sorted = [...detail.chapters].sort((a, b) => a.number - b.number);
    const slice = sorted.slice(0, n);
    setSelectedChapters(new Set(slice.map((c) => c.number)));
    setMode('custom');
  };

  const pickLastN = (n: number) => {
    if (!detail?.chapters) return;
    const sorted = [...detail.chapters].sort((a, b) => b.number - a.number);
    const slice = sorted.slice(0, n);
    setSelectedChapters(new Set(slice.map((c) => c.number)));
    setMode('custom');
  };

  const [autofilling, setAutofilling] = useState(false);
  const autofillMissingChapters = async () => {
    if (!picked || !detail?.chapters) return;
    setAutofilling(true);
    try {
      let candidateProviders = (providers || []).filter((p) => p.source !== picked.source || p.sourceId !== picked.sourceId);
      if (candidateProviders.length === 0) {
        const qParams = new URLSearchParams({ q: detail.title || title, ...(sources.length ? { sources: sources.join(',') } : {}) });
        const res = await api<{ content: Provider[] }>(`/api/sources/find?${qParams.toString()}`);
        candidateProviders = (res.content || []).filter((p) => p.source !== picked.source || p.sourceId !== picked.sourceId);
        if (res.content?.length) setProviders(res.content);
      }

      if (candidateProviders.length === 0) {
        toast(tr('No other sources found for this title.'), 'info');
        setAutofilling(false);
        return;
      }

      const existingNums = new Set(detail.chapters.map((c) => c.number));
      const merged = [...detail.chapters];
      let added = 0;

      for (const prov of candidateProviders.slice(0, 3)) {
        try {
          const provDetail = await api<Detail>(`/api/sources/detail?source=${encodeURIComponent(prov.source)}&sourceId=${encodeURIComponent(prov.sourceId)}`);
          for (const ch of provDetail.chapters || []) {
            if (!existingNums.has(ch.number)) {
              existingNums.add(ch.number);
              merged.push({
                ...ch,
                fromSourceName: prov.name,
                fromSourceId: prov.source,
                fromSeriesId: prov.sourceId,
              });
              added++;
            }
          }
        } catch {
          // ignore single provider failure
        }
      }

      if (added > 0) {
        merged.sort((a, b) => a.number - b.number);
        setDetail({
          ...detail,
          chapters: merged,
          count: merged.length,
          first: merged[0]?.number ?? detail.first,
          last: merged[merged.length - 1]?.number ?? detail.last,
        });
        setSelectedChapters((prev) => {
          const next = new Set(prev);
          merged.forEach((c) => next.add(c.number));
          return next;
        });
        toast(tr('Filled {n} missing chapter(s) from other sources!', { n: added }), 'success');
      } else {
        toast(tr('Other sources did not have the missing chapters either.'), 'info');
      }
    } catch {
      toast(tr('Failed to autofill chapters from other sources.'), 'error');
    } finally {
      setAutofilling(false);
    }
  };

  const openStreamReader = (c?: ChapterItem) => {
    if (!picked || !detail) return;
    const target = c || (detail.chapters && [...detail.chapters].sort((a, b) => a.number - b.number)[0]);
    if (!target) {
      toast(tr('No chapters available to read.'), 'error');
      return;
    }
    const targetSource = target.fromSourceId || picked.source;
    const targetSeriesId = target.fromSeriesId || picked.sourceId;
    const chId = target.sourceId || String(target.number);
    onClose();
    router.push(
      `/reader/?source=${encodeURIComponent(targetSource)}&chapterId=${encodeURIComponent(chId)}&seriesId=${encodeURIComponent(targetSeriesId)}&number=${target.number}&title=${encodeURIComponent(target.name || `Chapter ${target.number}`)}&seriesTitle=${encodeURIComponent(detail.title || picked.title)}`
    );
  };

  const add = async (force = false) => {
    if (!picked) return;
    setAdding(true); setDup(null);

    const jsonPayload: any = {
      source: picked.source,
      sourceId: picked.sourceId,
      autoUpdate,
      force,
    };

    if (mode === 'custom') {
      if (selectedChapters.size === 0) {
        toast(tr('Please select at least one chapter.'), 'error');
        setAdding(false);
        return;
      }
      jsonPayload.chapterNumbers = Array.from(selectedChapters);
    } else if (mode === 'range') {
      const s = rangeStart.trim() ? Number(rangeStart) : undefined;
      const e = rangeEnd.trim() ? Number(rangeEnd) : undefined;
      if (s == null || e == null || isNaN(s) || isNaN(e) || s > e) {
        toast(tr('Please enter a valid chapter range.'), 'error');
        setAdding(false);
        return;
      }
      jsonPayload.chapterRange = { start: s, end: e };
    } else {
      jsonPayload.chapterCount = count || undefined;
    }

    try {
      const r = await api<{ title: string; folder: string; chapters: number; started?: boolean }>('/api/sources/add', {
        json: jsonPayload,
        signal: AbortSignal.timeout(45_000),
      });
      setDone(r);
      onAdded(r);
    } catch (e: any) {
      let body: any = {};
      try { body = JSON.parse(e?.body || '{}'); } catch {}
      if (body.error === 'duplicate') setDup(body.message || tr('You already have this title.'));
      else toast(msgOf(e, tr('Add failed. Try another source.')), 'error');
    }
    setAdding(false);
  };

  const openIt = async () => {
    if (!done) return;
    setOpening(true);
    try {
      const p = await api<Page<Series>>('/api/series/search', { json: { fullTextSearch: done.title, size: 5 } });
      const hit = p.content.find((s) => norm(s.metadata?.title || s.name) === norm(done.title)) ?? p.content[0];
      qc.invalidateQueries({ queryKey: ['library'] });
      router.push(hit ? `/series/?id=${hit.id}` : '/downloads/');
    } catch { router.push('/downloads/'); }
  };

  if (done) {
    return (
      <Modal title={tr('Added to your library')} onClose={onClose}>
        <div className="space-y-4 text-center py-4">
          <span className="mx-auto grid h-16 w-16 place-items-center rounded-full bg-emerald-500/15 text-emerald-400">
            <IcCheck width={32} height={32} />
          </span>
          <div>
            <p className="font-display text-lg font-semibold text-white">{done.title}</p>
            <p className="mt-1 text-sm text-fog-400">
              {done.chapters > 0 ? tr('Downloading {n} chapters', { n: done.chapters }) : tr('Already in your library')}
            </p>
          </div>
          {done.chapters > 0 && (
            <div className="max-w-xs mx-auto">
              <ProgressBar value={job && job.total ? job.done / job.total : 0.02} />
              <p className="mt-2 text-xs tabular-nums text-fog-500">{job ? `${job.done} / ${job.total}` : '…'}</p>
            </div>
          )}
          <div className="flex gap-3 pt-2">
            <button onClick={onClose} className="btn-ghost flex-1 py-2.5 text-sm">{tr('Done')}</button>
            <button onClick={openIt} disabled={opening} className="btn-accent flex-1 py-2.5 text-sm disabled:opacity-50">
              {tr('Open in library')}
            </button>
          </div>
        </div>
      </Modal>
    );
  }

  if (!picked) {
    return (
      <Modal title={title} onClose={onClose} wide>
        {loading ? (
          <div className="py-12 text-center text-sm text-fog-500 animate-pulse-soft">{tr('Searching across sources…')}</div>
        ) : !providers?.length ? (
          <div className="py-10 text-center text-sm text-fog-500">{tr('Not found on any source yet — try searching manually.')}</div>
        ) : (
          <div className="space-y-3">
            <p className="text-xs font-semibold uppercase tracking-wider text-fog-400">{tr('Available on — pick a source')}</p>
            <div className="space-y-2 max-h-96 overflow-y-auto pr-1">
              {providers.map((p, i) => (
                <button
                  key={`${p.source}:${p.sourceId}`}
                  onClick={() => setPicked(p)}
                  className="flex w-full items-center gap-3.5 rounded-xl border border-ink-800 bg-ink-900/60 p-3 text-start hover:border-ink-700 hover:bg-ink-800/80 transition"
                >
                  <Img
                    src={sourceCover(p.source, p.coverUrl)}
                    alt=""
                    fallbackSrc={p.coverUrl}
                    className="h-16 w-12 shrink-0 rounded-lg object-cover bg-ink-800"
                  />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold text-white">{p.name}</p>
                    <p className="truncate text-xs text-fog-400">{p.title}</p>
                  </div>
                  {i === 0 && (
                    <span className="chip shrink-0 text-[10px] text-accent-300 border-accent-500/40 bg-accent-500/10 font-semibold px-2 py-0.5">
                      {tr('preferred')}
                    </span>
                  )}
                </button>
              ))}
            </div>
          </div>
        )}
      </Modal>
    );
  }

  const summary = detail?.summary && !looksCss(detail.summary) ? detail.summary : '';
  const presets = [10, 25, 50, 100, 200].filter((n) => detail && n < detail.count);
  const firstChapter = detail?.chapters && [...detail.chapters].sort((a, b) => a.number - b.number)[0];

  return (
    <Modal title={detail?.title || title} onClose={adding ? () => {} : onClose} extraWide>
      {loading || !detail ? (
        <div className="py-16 text-center text-sm text-fog-500 animate-pulse-soft">{tr('Loading chapters & details…')}</div>
      ) : (
        <div className="flex flex-col md:flex-row gap-6">
          {/* LEFT COLUMN: Cover, Hero Read Button, Metadata */}
          <div className="w-full md:w-64 shrink-0 flex flex-col">
            <div className="relative group">
              <Img
                src={sourceCover(detail.source, detail.coverUrl)}
                alt=""
                fallbackSrc={detail.coverUrl || undefined}
                className="aspect-[2/3] w-full rounded-2xl border border-ink-700/80 shadow-2xl object-cover bg-ink-900"
              />
              <div className="absolute inset-0 rounded-2xl ring-1 ring-inset ring-white/10" />
            </div>

            {/* Primary Hero Read Online Button */}
            <button
              type="button"
              onClick={() => openStreamReader(firstChapter)}
              className="mt-4 flex items-center justify-center gap-2 w-full rounded-xl bg-gradient-to-r from-accent-600 to-accent-500 py-3 px-4 text-sm font-semibold text-white shadow-lg shadow-accent-500/25 transition hover:brightness-110 active:scale-98"
            >
              <span className="text-base">📖</span>
              <span>{tr('Read Online Now')}</span>
            </button>

            {/* Metadata Stats */}
            <div className="mt-3.5 rounded-xl border border-ink-800 bg-ink-900/40 p-3 space-y-1.5 text-xs">
              <div className="flex items-center justify-between text-fog-400">
                <span>{tr('Chapters')}:</span>
                <span className="font-semibold text-white font-mono">{detail.count}</span>
              </div>
              {detail.first != null && detail.last != null && (
                <div className="flex items-center justify-between text-fog-400">
                  <span>{tr('Range')}:</span>
                  <span className="text-fog-200 font-mono">Ch. {detail.first} – {detail.last}</span>
                </div>
              )}
              {detail.status && (
                <div className="flex items-center justify-between text-fog-400">
                  <span>{tr('Status')}:</span>
                  <span className="capitalize text-fog-200 font-medium">{detail.status.toLowerCase()}</span>
                </div>
              )}
            </div>

            {/* Synopsis / Summary */}
            {summary && (
              <div className="mt-3 text-xs text-fog-400 leading-relaxed">
                <p className={showFullSummary ? '' : 'line-clamp-3'}>
                  {summary}
                </p>
                {summary.length > 140 && (
                  <button
                    type="button"
                    onClick={() => setShowFullSummary(!showFullSummary)}
                    className="mt-1 text-[11px] font-semibold text-accent-400 hover:text-accent-300"
                  >
                    {showFullSummary ? tr('Show less') : tr('Read more')}
                  </button>
                )}
              </div>
            )}

            {/* Auto-update Switch */}
            <div className="mt-4 flex items-center justify-between gap-3 pt-3 border-t border-ink-800">
              <span className="text-xs text-fog-300 font-medium">{tr('Auto-update chapters')}</span>
              <Switch on={autoUpdate} onChange={setAutoUpdate} label={tr('Auto-update chapters')} />
            </div>
          </div>

          {/* RIGHT COLUMN: Chapter Selection & Workstation */}
          <div className="min-w-0 flex-1 flex flex-col">
            {/* Header: Provider badge & Genres */}
            <div className="flex flex-wrap items-center justify-between gap-2 pb-3 border-b border-ink-800">
              <div className="flex items-center gap-2">
                {providers && providers.length > 1 ? (
                  <button
                    onClick={() => { setPicked(null); setDetail(null); }}
                    className="chip text-xs hover:border-ink-600 bg-ink-800/80 text-white font-medium"
                    title={tr('Switch to a different provider')}
                  >
                    <IcChevronLeft width={14} height={14} />
                    <span>{picked.name}</span>
                    <span className="text-fog-400 text-[11px]">({tr('switch')})</span>
                  </button>
                ) : (
                  <span className="chip text-xs text-fog-300 font-medium">{picked.name}</span>
                )}
                {detail.genres.slice(0, 3).map((g) => (
                  <span key={g} className="hidden sm:inline text-[11px] px-2 py-0.5 rounded-full bg-ink-800/50 text-fog-400">
                    {g}
                  </span>
                ))}
              </div>

              <div className="text-xs text-fog-400 font-mono">
                {effectiveSelectedCount} {tr('picked')} · ~{effectiveSelectedCount * 14} MB
              </div>
            </div>

            {/* Missing Chapter Gap Alert */}
            {detectedGaps.length > 0 && (
              <div className="mt-3 rounded-xl border border-amber-500/40 bg-amber-500/10 p-3 text-xs text-amber-200">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-start gap-2 flex-1">
                    <span className="text-amber-400 mt-0.5">⚠️</span>
                    <div>
                      <p className="font-semibold text-amber-100">
                        {tr('Sequence gaps detected on {name}', { name: picked.name })}
                      </p>
                      <p className="text-[11px] text-amber-200/80 mt-0.5">
                        {tr('Missing chapters:')} {detectedGaps.map((g) => (g.from === g.to ? `Ch. ${g.from}` : `Ch. ${g.from}–${g.to}`)).join(', ')}.
                        {providers && providers.length > 1 && (
                          <span className="ml-1 underline cursor-pointer hover:text-white" onClick={() => { setPicked(null); setDetail(null); }}>
                            {tr('Try another source')}
                          </span>
                        )}
                      </p>
                    </div>
                  </div>
                  <button
                    type="button"
                    disabled={autofilling}
                    onClick={autofillMissingChapters}
                    className="chip py-1.5 px-3 text-xs font-semibold bg-amber-500/20 text-amber-200 border-amber-500/50 hover:bg-amber-500 hover:text-black transition shrink-0 shadow-sm"
                  >
                    {autofilling ? tr('Searching…') : tr('⚡ Autofill missing chapters')}
                  </button>
                </div>
              </div>
            )}

            {/* Zero Chapters Alert with Provider Switcher */}
            {detail.count === 0 && (
              <div className="mt-3 rounded-xl border border-rose-500/40 bg-rose-500/10 p-3 text-xs text-rose-200">
                <div className="flex items-center gap-2 font-semibold text-rose-100">
                  <span>⚠️</span>
                  <span>{tr('No readable chapters available on {name}', { name: picked.name })}</span>
                </div>
                <p className="mt-1 text-[11px] text-rose-200/80 leading-relaxed">
                  {tr('This source either requires external licensing or does not host chapters for this title.')}
                  {providers && providers.length > 1 ? (
                    <span className="block mt-1 font-medium text-white">
                      {tr('Found {n} other provider(s) for this series. Switch to one below:', { n: providers.length - 1 })}
                    </span>
                  ) : null}
                </p>
                {providers && providers.length > 1 && (
                  <div className="flex flex-wrap gap-2 mt-2 pt-2 border-t border-rose-500/20">
                    {providers
                      .filter((p) => p.source !== picked.source || p.sourceId !== picked.sourceId)
                      .map((p) => (
                        <button
                          key={`${p.source}:${p.sourceId}`}
                          type="button"
                          onClick={() => { setPicked(p); setDetail(null); }}
                          className="chip py-1 px-2.5 text-xs font-semibold bg-ink-900 border-accent/40 text-accent hover:bg-accent hover:text-white transition"
                        >
                          ⚡ {tr('Switch to {name}', { name: p.name })}
                        </button>
                      ))}
                  </div>
                )}
              </div>
            )}

            {/* Mode Switcher Tabs */}
            <div className="mt-3 grid grid-cols-3 gap-1 rounded-xl bg-ink-950 p-1 border border-ink-800">
              <button
                type="button"
                onClick={() => setMode('custom')}
                className={`rounded-lg py-2 text-xs font-semibold transition ${
                  mode === 'custom' ? 'bg-ink-800 text-white shadow-sm' : 'text-fog-400 hover:text-fog-200'
                }`}
              >
                {tr('Pick Specific')} ({selectedChapters.size})
              </button>
              <button
                type="button"
                onClick={() => setMode('preset')}
                className={`rounded-lg py-2 text-xs font-semibold transition ${
                  mode === 'preset' ? 'bg-ink-800 text-white shadow-sm' : 'text-fog-400 hover:text-fog-200'
                }`}
              >
                {tr('Presets')}
              </button>
              <button
                type="button"
                onClick={() => setMode('range')}
                className={`rounded-lg py-2 text-xs font-semibold transition ${
                  mode === 'range' ? 'bg-ink-800 text-white shadow-sm' : 'text-fog-400 hover:text-fog-200'
                }`}
              >
                {tr('Range')}
              </button>
            </div>

            {/* Mode 1: Presets Bar */}
            {mode === 'preset' && (
              <div className="mt-3 flex flex-wrap gap-2 p-3 rounded-xl border border-ink-800 bg-ink-900/40">
                <button
                  type="button"
                  onClick={() => setCount(0)}
                  className={`chip text-xs py-2 px-3.5 transition font-semibold ${
                    count === 0 ? 'bg-accent text-white border-accent shadow-md shadow-accent/20' : ''
                  }`}
                >
                  {tr('All Chapters ({n})', { n: detail.count })}
                </button>
                {presets.map((n) => (
                  <button
                    key={n}
                    type="button"
                    onClick={() => setCount(n)}
                    className={`chip text-xs py-2 px-3.5 transition font-semibold ${
                      count === n ? 'bg-accent text-white border-accent shadow-md shadow-accent/20' : ''
                    }`}
                  >
                    {tr('First {n} Chapters', { n })}
                  </button>
                ))}
              </div>
            )}

            {/* Mode 2: Range Bar */}
            {mode === 'range' && (
              <div className="mt-3 rounded-xl border border-ink-800 bg-ink-900/40 p-3.5">
                <div className="flex items-center gap-3">
                  <div className="flex-1">
                    <label className="text-xs text-fog-400 font-medium">{tr('From Chapter')}</label>
                    <input
                      type="number"
                      step="any"
                      value={rangeStart}
                      onChange={(e) => setRangeStart(e.target.value)}
                      className="mt-1 w-full rounded-xl border border-ink-700 bg-ink-900 px-3 py-2 text-sm text-white focus:border-accent focus:outline-none"
                    />
                  </div>
                  <span className="mt-6 text-base text-fog-500 font-bold">—</span>
                  <div className="flex-1">
                    <label className="text-xs text-fog-400 font-medium">{tr('To Chapter')}</label>
                    <input
                      type="number"
                      step="any"
                      value={rangeEnd}
                      onChange={(e) => setRangeEnd(e.target.value)}
                      className="mt-1 w-full rounded-xl border border-ink-700 bg-ink-900 px-3 py-2 text-sm text-white focus:border-accent focus:outline-none"
                    />
                  </div>
                </div>
                <p className="mt-2 text-xs text-fog-400">
                  {effectiveSelectedCount} {tr('chapters selected')} (Ch. {rangeStart || 0} to {rangeEnd || 0})
                </p>
              </div>
            )}

            {/* Mode 3 / Default: Chapter Selection Toolbar */}
            <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
              <div className="relative flex-1 min-w-[180px]">
                <input
                  type="text"
                  placeholder={tr('Filter by title or number…')}
                  value={chapterSearch}
                  onChange={(e) => setChapterSearch(e.target.value)}
                  className="w-full rounded-xl border border-ink-700 bg-ink-900/90 px-3 py-2 text-xs text-white placeholder:text-fog-500 focus:border-accent focus:outline-none"
                />
              </div>
              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  onClick={() => setSortOrder((s) => (s === 'desc' ? 'asc' : 'desc'))}
                  className="chip text-xs py-1.5 px-2.5 font-mono shrink-0 hover:border-ink-600"
                  title={tr('Toggle sort direction')}
                >
                  {sortOrder === 'desc' ? '▼ Newest' : '▲ Oldest'}
                </button>
                <button
                  type="button"
                  onClick={selectAllFiltered}
                  className="chip text-xs py-1.5 px-2.5 shrink-0 hover:border-ink-600"
                >
                  {tr('All')}
                </button>
                <button
                  type="button"
                  onClick={deselectAllFiltered}
                  className="chip text-xs py-1.5 px-2.5 shrink-0 hover:border-ink-600"
                >
                  {tr('Clear')}
                </button>
                <button
                  type="button"
                  onClick={invertSelection}
                  className="chip text-xs py-1.5 px-2.5 shrink-0 hover:border-ink-600"
                >
                  {tr('Invert')}
                </button>
              </div>
            </div>

            {/* Quick helper chips */}
            <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-fog-500">
              <span className="text-[11px] font-medium uppercase tracking-wider text-fog-500">{tr('Quick Select:')}</span>
              <button type="button" onClick={() => pickFirstN(10)} className="chip text-[11px] py-0.5 px-2 hover:text-white">First 10</button>
              <button type="button" onClick={() => pickFirstN(25)} className="chip text-[11px] py-0.5 px-2 hover:text-white">First 25</button>
              <button type="button" onClick={() => pickLastN(10)} className="chip text-[11px] py-0.5 px-2 hover:text-white">Last 10</button>
              <button type="button" onClick={() => pickLastN(25)} className="chip text-[11px] py-0.5 px-2 hover:text-white">Last 25</button>
            </div>

            {/* Spacious Chapter List Scroll Area */}
            <div className="mt-3 max-h-[380px] overflow-y-auto space-y-1.5 pr-1.5">
              {filteredChapters.length === 0 ? (
                <div className="py-12 text-center text-xs text-fog-500 rounded-xl border border-ink-800 bg-ink-950/40">
                  {tr('No matching chapters found')}
                </div>
              ) : (
                filteredChapters.map((c, idx) => {
                  const isChecked = selectedChapters.has(c.number);
                  return (
                    <div
                      key={c.number}
                      onClick={(e) => toggleChapter(c.number, idx, e.shiftKey)}
                      className={`flex items-center justify-between gap-3 rounded-xl px-3.5 py-2.5 border transition cursor-pointer select-none ${
                        isChecked
                          ? 'border-accent/40 bg-accent/10 shadow-sm'
                          : 'border-ink-800/80 bg-ink-900/60 hover:border-ink-700 hover:bg-ink-800/60'
                      }`}
                    >
                      <div className="flex items-center gap-3 min-w-0 flex-1">
                        <input
                          type="checkbox"
                          checked={isChecked}
                          onChange={() => {}}
                          className="h-4 w-4 rounded accent-accent bg-ink-950 pointer-events-none shrink-0"
                        />
                        <span className="font-mono text-xs font-bold text-white shrink-0">
                          Ch. {c.number}
                        </span>
                        <span className="truncate text-xs text-fog-300">
                          {c.name || `Chapter ${c.number}`}
                        </span>
                        {c.fromSourceName && (
                          <span className="rounded-md bg-emerald-500/20 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-300 border border-emerald-500/40 shrink-0">
                            ⚡ {c.fromSourceName}
                          </span>
                        )}
                        {c.date && (
                          <span className="hidden sm:inline text-[10px] text-fog-500 shrink-0 font-mono">
                            {c.date.slice(0, 10)}
                          </span>
                        )}
                      </div>

                      {/* Prominent Row-Level Read Button */}
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          openStreamReader(c);
                        }}
                        className="chip shrink-0 text-xs font-semibold py-1 px-3 text-accent-300 border-accent/30 bg-accent/10 hover:bg-accent hover:text-white transition active:scale-95 shadow-sm"
                        title={tr('Stream this chapter immediately')}
                      >
                        📖 {tr('Read')}
                      </button>
                    </div>
                  );
                })
              )}
            </div>

            {dup && (
              <div className="mt-3 rounded-xl border border-amber-500/40 bg-amber-500/10 p-3 text-xs text-amber-200">
                <p>{dup}</p>
                <button
                  type="button"
                  onClick={() => add(true)}
                  disabled={adding}
                  className="mt-1.5 font-semibold text-amber-100 underline hover:no-underline"
                >
                  {tr('Add anyway')}
                </button>
              </div>
            )}

            {/* Bottom Action Footer */}
            <div className="mt-4 pt-3 border-t border-ink-800 flex flex-wrap items-center justify-between gap-3">
              <div className="text-xs text-fog-400">
                <span className="font-semibold text-white">{effectiveSelectedCount}</span> {tr('chapters selected')}
                <span className="text-fog-500 text-[11px] ml-1.5 font-mono">(~{effectiveSelectedCount * 14} MB)</span>
              </div>

              <div className="flex items-center gap-2.5">
                <button
                  type="button"
                  onClick={onClose}
                  className="btn-ghost px-4 py-2 text-xs"
                >
                  {tr('Cancel')}
                </button>
                <button
                  onClick={() => add()}
                  disabled={adding || effectiveSelectedCount === 0}
                  className="btn-accent px-6 py-2.5 text-xs font-semibold shadow-lg shadow-accent/20 disabled:opacity-50 transition active:scale-98"
                >
                  {adding
                    ? tr('Adding…')
                    : tr('⬇️ Download {n} Chapters', { n: effectiveSelectedCount })}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </Modal>
  );
}
