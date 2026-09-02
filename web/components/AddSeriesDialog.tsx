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
export interface ChapterItem { number: number; name?: string; date?: string | null }
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
    api<{ content: Provider[] }>('/api/sources/find', {
      json: { title: seed.title, sources: sources.length ? sources : undefined },
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
        setCount(d.count);
        setRangeStart(String(d.first ?? 1));
        setRangeEnd(String(d.last ?? d.count ?? 10));
        if (d.chapters?.length) {
          setSelectedChapters(new Set(d.chapters.map((c) => c.number)));
        }
      })
      .catch((e) => { if (ok) toast(msgOf(e, tr('Could not load details.')), 'error'); })
      .finally(() => { if (ok) setLoading(false); });
    return () => { ok = false; };
  }, [picked, toast]);

  const jobs = useQuery({
    queryKey: ['source-jobs'],
    queryFn: () => api<{ content: Job[] }>('/api/sources/jobs'),
    enabled: !!done && done.chapters > 0,
    refetchInterval: 2000,
  });
  const job = jobs.data?.content?.find((j) => done && j.folder === done.folder);

  const effectiveSelectedCount = useMemo(() => {
    if (!detail) return 0;
    if (mode === 'preset') return count || detail.count;
    if (mode === 'range') {
      const s = Number(rangeStart) || 0;
      const e = Number(rangeEnd) || 0;
      if (detail.chapters?.length) {
        return detail.chapters.filter((c) => c.number >= s && c.number <= e).length;
      }
      return Math.max(0, e - s + 1);
    }
    if (mode === 'custom') return selectedChapters.size;
    return detail.count;
  }, [detail, mode, count, rangeStart, rangeEnd, selectedChapters]);

  const filteredChapters = useMemo(() => {
    if (!detail?.chapters) return [];
    if (!chapterSearch.trim()) return detail.chapters;
    const q = chapterSearch.toLowerCase().trim();
    return detail.chapters.filter(
      (c) => String(c.number).includes(q) || (c.name && c.name.toLowerCase().includes(q)),
    );
  }, [detail, chapterSearch]);

  const toggleChapter = (num: number) => {
    setSelectedChapters((prev) => {
      const next = new Set(prev);
      if (next.has(num)) next.delete(num);
      else next.add(num);
      return next;
    });
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
                    className="h-14 w-10 shrink-0 rounded" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm text-fog-100">{p.name}</span>
                    <span className="block truncate text-[11px] text-fog-500">{p.title}</span>
                  </span>
                  {i === 0 && <span className="chip shrink-0 text-[10px]">{tr('preferred')}</span>}
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
          <div className="mb-3 shrink-0 sm:mb-0 sm:w-40">
            <Img src={sourceCover(detail.source, detail.coverUrl)} alt="" fallbackSrc={detail.coverUrl || undefined}
              className="aspect-[2/3] w-28 rounded-xl border border-ink-700 sm:w-40 object-cover" />
            <div className="mt-2 text-xs text-fog-500">
              <p>{detail.count} {detail.count === 1 ? tr('chapter') : tr('chapters')}</p>
              {detail.first != null && detail.last != null && <p>Ch. {detail.first}–{detail.last}</p>}
            </div>
          </div>
          <div className="min-w-0 flex-1">
            {providers && providers.length > 1 && (
              <button onClick={() => { setPicked(null); setDetail(null); }} className="chip mb-2 text-xs">
                <IcChevronLeft width={13} height={13} />{tr('Change source')}
              </button>
            )}
            {detail.genres.length > 0 && (
              <p className="line-clamp-1 text-[11px] text-fog-500">{detail.genres.slice(0, 4).join(' · ')}</p>
            )}
            {summary && <p className="mt-1 line-clamp-3 text-xs leading-relaxed text-fog-400">{summary}</p>}

            {/* Selection Mode Selector */}
            <div className="mt-3">
              <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wider text-fog-500">
                {tr('Download Selection')}
              </label>
              <div className="grid grid-cols-3 gap-1 rounded-lg bg-ink-900/80 p-1 border border-ink-700/60">
                <button
                  type="button"
                  onClick={() => setMode('preset')}
                  className={`rounded-md py-1.5 text-xs font-medium transition ${
                    mode === 'preset' ? 'bg-ink-700 text-white shadow-sm' : 'text-fog-400 hover:text-fog-200'
                  }`}
                >
                  {tr('Preset')}
                </button>
                <button
                  type="button"
                  onClick={() => setMode('range')}
                  className={`rounded-md py-1.5 text-xs font-medium transition ${
                    mode === 'range' ? 'bg-ink-700 text-white shadow-sm' : 'text-fog-400 hover:text-fog-200'
                  }`}
                >
                  {tr('Range')}
                </button>
                <button
                  type="button"
                  onClick={() => setMode('custom')}
                  className={`rounded-md py-1.5 text-xs font-medium transition ${
                    mode === 'custom' ? 'bg-ink-700 text-white shadow-sm' : 'text-fog-400 hover:text-fog-200'
                  }`}
                >
                  {tr('Choose ({n})').replace('{n}', String(selectedChapters.size))}
                </button>
              </div>
            </div>

            {/* Mode 1: Preset */}
            {mode === 'preset' && (
              <div className="mt-2.5">
                <select value={count} onChange={(e) => setCount(Number(e.target.value))} className="field w-full">
                  <option value={detail.count}>{tr('All ({n})', { n: detail.count })}</option>
                  {presets.map((n) => <option key={n} value={n}>{tr('First {n}', { n })}</option>)}
                </select>
              </div>
            )}

            {/* Mode 2: Range */}
            {mode === 'range' && (
              <div className="mt-2.5 rounded-xl border border-ink-700/70 bg-ink-900/40 p-3">
                <div className="flex items-center gap-2">
                  <div className="flex-1">
                    <label className="text-[11px] text-fog-400">{tr('From Chapter')}</label>
                    <input
                      type="number"
                      step="any"
                      value={rangeStart}
                      onChange={(e) => setRangeStart(e.target.value)}
                      className="mt-1 w-full rounded-lg border border-ink-700 bg-ink-950 px-3 py-1.5 text-sm text-fog-100 focus:border-accent-500 focus:outline-none"
                    />
                  </div>
                  <span className="mt-5 text-sm text-fog-500">—</span>
                  <div className="flex-1">
                    <label className="text-[11px] text-fog-400">{tr('To Chapter')}</label>
                    <input
                      type="number"
                      step="any"
                      value={rangeEnd}
                      onChange={(e) => setRangeEnd(e.target.value)}
                      className="mt-1 w-full rounded-lg border border-ink-700 bg-ink-950 px-3 py-1.5 text-sm text-fog-100 focus:border-accent-500 focus:outline-none"
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
              <div className="mt-2.5 rounded-xl border border-ink-700/70 bg-ink-900/40 p-2.5">
                <div className="flex items-center gap-2">
                  <div className="relative flex-1">
                    <input
                      type="text"
                      placeholder={tr('Filter chapters…')}
                      value={chapterSearch}
                      onChange={(e) => setChapterSearch(e.target.value)}
                      className="w-full rounded-lg border border-ink-700 bg-ink-950 px-2.5 py-1 text-xs text-fog-100 placeholder:text-fog-600 focus:outline-none"
                    />
                  </div>
                  <button
                    type="button"
                    onClick={selectAllFiltered}
                    className="chip text-[10px] py-1 px-2"
                  >
                    {tr('Select All')}
                  </button>
                  <button
                    type="button"
                    onClick={deselectAllFiltered}
                    className="chip text-[10px] py-1 px-2"
                  >
                    {tr('Deselect')}
                  </button>
                </div>

                <div className="mt-2 max-h-36 overflow-y-auto space-y-1 pr-1">
                  {filteredChapters.length === 0 ? (
                    <p className="py-3 text-center text-xs text-fog-500">{tr('No chapters found')}</p>
                  ) : (
                    filteredChapters.map((c) => {
                      const isChecked = selectedChapters.has(c.number);
                      return (
                        <label
                          key={c.number}
                          className={`flex items-center gap-2.5 rounded-lg px-2 py-1 text-xs cursor-pointer transition ${
                            isChecked ? 'bg-ink-800/80 text-fog-100' : 'text-fog-400 hover:bg-ink-800/40'
                          }`}
                        >
                          <input
                            type="checkbox"
                            checked={isChecked}
                            onChange={() => toggleChapter(c.number)}
                            className="rounded border-ink-600 bg-ink-950 text-accent-500 focus:ring-0"
                          />
                          <span className="font-mono text-[11px] text-fog-300">Ch. {c.number}</span>
                          <span className="truncate text-fog-400">{c.name || ''}</span>
                        </label>
                      );
                    })
                  )}
                </div>
                <div className="mt-1.5 flex justify-between text-[11px] text-fog-500 px-1">
                  <span>{tr('{n} chapters picked').replace('{n}', String(selectedChapters.size))}</span>
                  <span>{tr('Total: {n}').replace('{n}', String(detail.count))}</span>
                </div>
              </div>
            )}

            <div className="mt-3 flex items-center justify-between gap-3">
              <span className="text-xs text-fog-200">{tr('Auto-update new chapters')}</span>
              <Switch on={autoUpdate} onChange={setAutoUpdate} label={tr('Auto-update new chapters')} />
            </div>

            {effectiveSelectedCount > 40 && (
              <p className="mt-2.5 rounded-lg border border-amber-500/30 bg-amber-500/10 px-2.5 py-1.5 text-[11px] text-amber-300">
                {tr('Grabbing many chapters ({n}) can get you rate-limited. It pauses on its own and you can resume later.').replace('{n}', String(effectiveSelectedCount))}
              </p>
            )}
            {dup && <p className="mt-2.5 rounded-lg border border-amber-500/30 bg-amber-500/10 px-2.5 py-1.5 text-[11px] text-amber-300">{dup}</p>}

            <button
              onClick={() => add(!!dup)}
              disabled={adding || effectiveSelectedCount === 0}
              className="btn-accent mt-3.5 w-full py-2.5 text-sm disabled:opacity-50"
            >
              {adding
                ? tr('Working…')
                : dup
                ? tr('Add anyway ({n} chapters)').replace('{n}', String(effectiveSelectedCount))
                : tr('Download {n} chapters').replace('{n}', String(effectiveSelectedCount))}
            </button>
          </div>
        </div>
      )}
    </Modal>
  );
}
