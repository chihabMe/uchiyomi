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
export interface ChapterItem { sourceId?: string; number: number; name?: string; date?: string | null }
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
  const [mode, setMode] = useState<'preset' | 'range' | 'custom'>('preset');
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
      })
      .catch((e) => { if (ok) toast(msgOf(e, tr('Could not load source details.')), 'error'); })
      .finally(() => { if (ok) setLoading(false); });
    return () => { ok = false; };
  }, [picked, toast]);

  const { data: jobs } = useQuery({
    queryKey: ['source-jobs'],
    queryFn: () => api<{ content: Job[] }>('/api/sources/jobs'),
    enabled: !!done,
    refetchInterval: 2000,
  });
  const job = done ? (jobs?.content ?? []).find((j) => j.folder === done.folder) : undefined;

  // Filtered & sorted chapter list
  const filteredChapters = useMemo(() => {
    if (!detail?.chapters) return [];
    let list = detail.chapters;
    if (chapterSearch.trim()) {
      const q = chapterSearch.trim().toLowerCase();
      list = list.filter((c) => String(c.number).includes(q) || (c.name && c.name.toLowerCase().includes(q)));
    }
    return [...list].sort((a, b) => (sortOrder === 'asc' ? a.number - b.number : b.number - a.number));
  }, [detail?.chapters, chapterSearch, sortOrder]);

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

  const openStreamReader = (c?: ChapterItem) => {
    if (!picked || !detail) return;
    const target = c || (detail.chapters && detail.chapters[0]);
    if (!target) {
      toast(tr('No chapters available to read.'), 'error');
      return;
    }
    const chId = target.sourceId || String(target.number);
    onClose();
    router.push(
      `/reader/?source=${encodeURIComponent(picked.source)}&chapterId=${encodeURIComponent(chId)}&seriesId=${encodeURIComponent(picked.sourceId)}&number=${target.number}&title=${encodeURIComponent(target.name || `Chapter ${target.number}`)}&seriesTitle=${encodeURIComponent(detail.title || picked.title)}`
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
      try { body = JSON.parse(e?.body || '{}'); } catch { /* not JSON */ }
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

  // ---------------------------------------------------------------- done
  if (done) {
    return (
      <Modal title={tr('Added to your library')} onClose={onClose}>
        <div className="space-y-4 text-center">
          <span className="mx-auto grid h-14 w-14 place-items-center rounded-full bg-emerald-500/15 text-emerald-400">
            <IcCheck width={26} height={26} />
          </span>
          <div>
            <p className="font-display text-base font-semibold text-fog-50">{done.title}</p>
            <p className="mt-0.5 text-sm text-fog-400">
              {done.chapters > 0 ? tr('Downloading {n} chapters', { n: done.chapters }) : tr('Already in your library')}
            </p>
          </div>
          {done.chapters > 0 && (
            <>
              <ProgressBar value={job && job.total ? job.done / job.total : 0.02} />
              <p className="text-xs tabular-nums text-fog-500">{job ? `${job.done}/${job.total}` : '…'}</p>
            </>
          )}
          <div className="flex gap-2">
            <button onClick={onClose} className="btn-ghost flex-1 py-2.5 text-sm">{tr('Done')}</button>
            <button onClick={openIt} disabled={opening} className="btn-accent flex-1 py-2.5 text-sm disabled:opacity-50">
              {tr('Open in library')}
            </button>
          </div>
        </div>
      </Modal>
    );
  }

  // ---------------------------------------------------------------- pick a source
  if (!picked) {
    return (
      <Modal title={title} onClose={onClose}>
        {loading ? (
          <p className="py-8 text-center text-sm text-fog-500">{tr('Searching…')}</p>
        ) : !providers?.length ? (
          <p className="py-8 text-center text-sm text-fog-500">{tr('Not found on any source yet — try searching manually.')}</p>
        ) : (
          <>
            <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-fog-500">{tr('Available on — pick a source')}</p>
            <div className="space-y-1">
              {providers.map((p, i) => (
                <button key={`${p.source}:${p.sourceId}`} onClick={() => setPicked(p)}
                  className="flex w-full items-center gap-3 rounded-lg px-2.5 py-2 text-start hover:bg-ink-800/60">
                  <Img src={sourceCover(p.source, p.coverUrl)} alt="" fallbackSrc={p.coverUrl}
                    className="h-14 w-10 shrink-0 rounded object-cover" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm text-fog-100 font-medium">{p.name}</span>
                    <span className="block truncate text-[11px] text-fog-500">{p.title}</span>
                  </span>
                  {i === 0 && <span className="chip shrink-0 text-[10px] text-accent-400 border-accent-500/30">{tr('preferred')}</span>}
                </button>
              ))}
            </div>
          </>
        )}
      </Modal>
    );
  }

  // ---------------------------------------------------------------- options
  const summary = detail?.summary && !looksCss(detail.summary) ? detail.summary : '';
  const presets = [10, 25, 50, 100, 200].filter((n) => detail && n < detail.count);

  return (
    <Modal title={detail?.title || title} onClose={adding ? () => {} : onClose} wide>
      {loading || !detail ? (
        <p className="py-10 text-center text-sm text-fog-500">{tr('Loading…')}</p>
      ) : (
        <div className="sm:flex sm:gap-4">
          <div className="mb-3 shrink-0 sm:mb-0 sm:w-44">
            <Img src={sourceCover(detail.source, detail.coverUrl)} alt="" fallbackSrc={detail.coverUrl || undefined}
              className="aspect-[2/3] w-28 rounded-xl border border-ink-700/80 shadow-lg sm:w-44 object-cover" />
            <div className="mt-2.5 text-xs text-fog-500 space-y-0.5">
              <p className="font-medium text-fog-300">{detail.count} {detail.count === 1 ? tr('chapter') : tr('chapters')}</p>
              {detail.first != null && detail.last != null && <p className="text-[11px]">Ch. {detail.first}–{detail.last}</p>}
            </div>

            {/* Read Online Button */}
            <button
              type="button"
              onClick={() => openStreamReader()}
              className="mt-3 flex items-center justify-center gap-1.5 w-full rounded-lg border border-accent-500/40 bg-accent-500/10 py-2 px-3 text-xs font-semibold text-accent-300 transition hover:bg-accent-500/20 active:scale-95"
            >
              <span>📖</span> {tr('Read Online Now')}
            </button>
          </div>

          <div className="min-w-0 flex-1">
            <div className="flex items-center justify-between gap-2 mb-1.5">
              {providers && providers.length > 1 ? (
                <button onClick={() => { setPicked(null); setDetail(null); }} className="chip text-xs hover:border-ink-600">
                  <IcChevronLeft width={13} height={13} /> {picked.name} · {tr('Change source')}
                </button>
              ) : (
                <span className="chip text-xs text-fog-400">{picked.name}</span>
              )}
              {detail.status && (
                <span className="text-[10px] uppercase tracking-wider font-semibold text-fog-500">
                  {detail.status}
                </span>
              )}
            </div>

            {detail.genres.length > 0 && (
              <p className="line-clamp-1 text-[11px] text-fog-500">{detail.genres.slice(0, 4).join(' · ')}</p>
            )}
            {summary && <p className="mt-1 line-clamp-2 text-xs leading-relaxed text-fog-400">{summary}</p>}

            {/* Selection Mode Switcher */}
            <div className="mt-3.5">
              <div className="flex items-center justify-between mb-1.5">
                <label className="text-xs font-semibold uppercase tracking-wider text-fog-400">
                  {tr('Download Selection')}
                </label>
                {effectiveSelectedCount > 0 && (
                  <span className="text-[11px] text-fog-500 font-mono">
                    ~{effectiveSelectedCount * 14} MB estimated
                  </span>
                )}
              </div>
              <div className="grid grid-cols-3 gap-1 rounded-lg bg-ink-950/80 p-1 border border-ink-800">
                <button
                  type="button"
                  onClick={() => setMode('preset')}
                  className={`rounded-md py-1.5 text-xs font-medium transition ${
                    mode === 'preset' ? 'bg-ink-800 text-white shadow-sm' : 'text-fog-400 hover:text-fog-200'
                  }`}
                >
                  {tr('Preset')}
                </button>
                <button
                  type="button"
                  onClick={() => setMode('range')}
                  className={`rounded-md py-1.5 text-xs font-medium transition ${
                    mode === 'range' ? 'bg-ink-800 text-white shadow-sm' : 'text-fog-400 hover:text-fog-200'
                  }`}
                >
                  {tr('Range')}
                </button>
                <button
                  type="button"
                  onClick={() => setMode('custom')}
                  className={`rounded-md py-1.5 text-xs font-medium transition ${
                    mode === 'custom' ? 'bg-ink-800 text-white shadow-sm' : 'text-fog-400 hover:text-fog-200'
                  }`}
                >
                  {tr('Choose ({n})').replace('{n}', String(selectedChapters.size))}
                </button>
              </div>
            </div>

            {/* Mode 1: Presets */}
            {mode === 'preset' && (
              <div className="mt-2.5 flex flex-wrap gap-1.5">
                <button
                  type="button"
                  onClick={() => setCount(0)}
                  className={`chip text-xs py-1.5 px-3 transition ${count === 0 ? 'bg-accent text-white border-accent' : ''}`}
                >
                  {tr('All ({n})', { n: detail.count })}
                </button>
                {presets.map((n) => (
                  <button
                    key={n}
                    type="button"
                    onClick={() => setCount(n)}
                    className={`chip text-xs py-1.5 px-3 transition ${count === n ? 'bg-accent text-white border-accent' : ''}`}
                  >
                    {tr('First {n}', { n })}
                  </button>
                ))}
              </div>
            )}

            {/* Mode 2: Range */}
            {mode === 'range' && (
              <div className="mt-2.5 rounded-xl border border-ink-800 bg-ink-950/60 p-3">
                <div className="flex items-center gap-2">
                  <div className="flex-1">
                    <label className="text-[11px] text-fog-400 font-medium">{tr('From Chapter')}</label>
                    <input
                      type="number"
                      step="any"
                      value={rangeStart}
                      onChange={(e) => setRangeStart(e.target.value)}
                      className="mt-1 w-full rounded-lg border border-ink-700 bg-ink-900 px-3 py-1.5 text-sm text-fog-100 focus:border-accent-500 focus:outline-none"
                    />
                  </div>
                  <span className="mt-5 text-sm text-fog-500 font-bold">—</span>
                  <div className="flex-1">
                    <label className="text-[11px] text-fog-400 font-medium">{tr('To Chapter')}</label>
                    <input
                      type="number"
                      step="any"
                      value={rangeEnd}
                      onChange={(e) => setRangeEnd(e.target.value)}
                      className="mt-1 w-full rounded-lg border border-ink-700 bg-ink-900 px-3 py-1.5 text-sm text-fog-100 focus:border-accent-500 focus:outline-none"
                    />
                  </div>
                </div>
                <p className="mt-2 text-[11px] text-fog-400">
                  {effectiveSelectedCount} {tr('chapters selected')} (Ch. {rangeStart || 0} to {rangeEnd || 0})
                </p>
              </div>
            )}

            {/* Mode 3: Custom Checkbox List */}
            {mode === 'custom' && (
              <div className="mt-2.5 rounded-xl border border-ink-800 bg-ink-950/60 p-2.5">
                {/* Search & Action Bar */}
                <div className="flex items-center gap-1.5">
                  <div className="relative flex-1">
                    <input
                      type="text"
                      placeholder={tr('Filter chapters…')}
                      value={chapterSearch}
                      onChange={(e) => setChapterSearch(e.target.value)}
                      className="w-full rounded-lg border border-ink-700 bg-ink-900 px-2.5 py-1 text-xs text-fog-100 placeholder:text-fog-600 focus:outline-none"
                    />
                  </div>
                  <button
                    type="button"
                    onClick={() => setSortOrder((s) => (s === 'desc' ? 'asc' : 'desc'))}
                    className="chip text-[10px] py-1 px-2 font-mono shrink-0 hover:border-ink-600"
                    title={tr('Toggle sort direction')}
                  >
                    {sortOrder === 'desc' ? '▼ Newest' : '▲ Oldest'}
                  </button>
                  <button
                    type="button"
                    onClick={selectAllFiltered}
                    className="chip text-[10px] py-1 px-2 shrink-0 hover:border-ink-600"
                  >
                    {tr('All')}
                  </button>
                  <button
                    type="button"
                    onClick={deselectAllFiltered}
                    className="chip text-[10px] py-1 px-2 shrink-0 hover:border-ink-600"
                  >
                    {tr('Clear')}
                  </button>
                </div>

                {/* Quick Presets Bar */}
                <div className="mt-1.5 flex flex-wrap gap-1 items-center text-[10px] text-fog-500">
                  <span className="mr-0.5">{tr('Quick:')}</span>
                  <button type="button" onClick={() => pickFirstN(10)} className="hover:text-accent-400 underline">First 10</button>
                  <span>·</span>
                  <button type="button" onClick={() => pickFirstN(25)} className="hover:text-accent-400 underline">First 25</button>
                  <span>·</span>
                  <button type="button" onClick={() => pickLastN(10)} className="hover:text-accent-400 underline">Last 10</button>
                </div>

                {/* Chapter Scroll Area */}
                <div className="mt-2 max-h-40 overflow-y-auto space-y-0.5 pr-1">
                  {filteredChapters.length === 0 ? (
                    <p className="py-4 text-center text-xs text-fog-500">{tr('No chapters found')}</p>
                  ) : (
                    filteredChapters.map((c, idx) => {
                      const isChecked = selectedChapters.has(c.number);
                      return (
                        <div
                          key={c.number}
                          onClick={(e) => toggleChapter(c.number, idx, e.shiftKey)}
                          className={`flex items-center gap-2 rounded-lg px-2 py-1 text-xs cursor-pointer select-none transition ${
                            isChecked ? 'bg-ink-800/90 text-white' : 'text-fog-400 hover:bg-ink-900/80 hover:text-fog-200'
                          }`}
                        >
                          <input
                            type="checkbox"
                            checked={isChecked}
                            onChange={() => {}}
                            className="rounded border-ink-600 bg-ink-950 text-accent-500 focus:ring-0 shrink-0 pointer-events-none"
                          />
                          <span className="font-mono text-[11px] text-fog-300 font-semibold shrink-0">Ch. {c.number}</span>
                          <span className="truncate flex-1 text-fog-400 text-[11px]">{c.name || ''}</span>
                          {/* Live Stream link */}
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              openStreamReader(c);
                            }}
                            className="text-[10px] text-accent-400 hover:text-accent-300 px-1.5 py-0.5 rounded bg-ink-900 border border-accent-500/20 hover:border-accent-500/50 shrink-0"
                            title={tr('Stream this chapter immediately')}
                          >
                            📖 {tr('Read')}
                          </button>
                        </div>
                      );
                    })
                  )}
                </div>

                <div className="mt-1.5 flex justify-between text-[11px] text-fog-500 px-1">
                  <span>{tr('{n} chapters picked', { n: selectedChapters.size })}</span>
                  <span>{tr('Total: {n}', { n: detail.count })}</span>
                </div>
              </div>
            )}

            <div className="mt-3 flex items-center justify-between gap-3">
              <span className="text-xs text-fog-300">{tr('Auto-update new chapters')}</span>
              <Switch on={autoUpdate} onChange={setAutoUpdate} label={tr('Auto-update new chapters')} />
            </div>

            {dup && (
              <div className="mt-2 rounded-lg border border-amber-500/40 bg-amber-500/10 p-2 text-xs text-amber-200">
                <p>{dup}</p>
                <button
                  type="button"
                  onClick={() => add(true)}
                  disabled={adding}
                  className="mt-1 font-semibold text-amber-100 underline hover:no-underline"
                >
                  {tr('Add anyway')}
                </button>
              </div>
            )}

            <button
              onClick={() => add()}
              disabled={adding || effectiveSelectedCount === 0}
              className="btn-accent mt-3.5 w-full py-2.5 text-sm font-semibold disabled:opacity-50 transition active:scale-[0.99]"
            >
              {adding
                ? tr('Adding…')
                : tr('Download {n} chapters', { n: effectiveSelectedCount })}
            </button>
          </div>
        </div>
      )}
    </Modal>
  );
}
