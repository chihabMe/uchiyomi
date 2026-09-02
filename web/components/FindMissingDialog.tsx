'use client';
import { useState, useMemo } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { Modal, msgOf } from '@/components/ConfirmDialog';
import { Img, ProgressBar } from '@/components/ui';
import { sourceCover } from '@/components/cards';
import { useToast } from '@/components/Toast';
import { t as tr } from '@/lib/i18n';

interface Candidate {
  source: string; name: string; sourceSeriesId: string; title: string; coverUrl?: string;
  count: number; first: number | null; last: number | null;
  coverage: number; matched: number;
  fillable: number[]; newer: number[];
  why: string; pinned: boolean;
}
interface Scan {
  seriesId: string; title: string; folder: string;
  have: { count: number; first?: number; last?: number };
  gaps: { lo: number; hi: number; count: number }[];
  candidates: Candidate[];
  planId: string;
  refusal: { code: string; message: string } | null;
}
interface Job { folder: string; title: string; total: number; done: number; status: string; reason?: string }

function whyText(c: Candidate): string {
  switch (c.why) {
    case 'numbering_mismatch':
      return tr('Numbers its chapters differently') +
        ` (${Math.round(c.coverage * 100)}%` + tr(' of yours match') + ')';
    case 'nothing_to_fill': return tr('Has nothing you are missing');
    case 'no_chapters': return tr('Listed no chapters');
    case 'blocked': return tr('Temporarily unavailable');
    case 'disabled': return tr('Switched off');
    default: return tr('Not usable');
  }
}

export function FindMissingDialog({ seriesId, onClose }: { seriesId: string; onClose: () => void }) {
  const toast = useToast();
  const qc = useQueryClient();
  const [altTitle, setAltTitle] = useState('');
  const [term, setTerm] = useState('');
  const [started, setStarted] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [selectedCandidate, setSelectedCandidate] = useState<Candidate | null>(null);
  const [rangeStart, setRangeStart] = useState<string>('');
  const [rangeEnd, setRangeEnd] = useState<string>('');
  const [selectedNums, setSelectedNums] = useState<Set<number>>(new Set());

  const scan = useQuery({
    queryKey: ['fill-scan', seriesId, term],
    queryFn: () => api<Scan>('/api/sources/fill/scan', { method: 'POST', json: { seriesId, altTitle: term || undefined } }),
    staleTime: 60_000,
    retry: false,
  });

  const jobs = useQuery({
    queryKey: ['source-jobs'],
    queryFn: () => api<{ content: Job[] }>('/api/sources/jobs'),
    enabled: !!started,
    refetchInterval: 2000,
  });
  const job = jobs.data?.content?.find((j) => j.folder === started);

  const openPicker = (c: Candidate) => {
    setSelectedCandidate(c);
    const allAvailable = [...c.fillable, ...c.newer].sort((a, b) => a - b);
    if (allAvailable.length) {
      setRangeStart(String(allAvailable[0]));
      setRangeEnd(String(allAvailable[allAvailable.length - 1]));
      setSelectedNums(new Set(allAvailable));
    }
  };

  const runWithNumbers = async (c: Candidate, numbers: number[]) => {
    if (!scan.data || !numbers.length) return;
    setBusy(true);
    try {
      const res = await api<{ folder: string }>('/api/sources/fill', {
        method: 'POST',
        json: { planId: scan.data.planId, source: c.source, sourceSeriesId: c.sourceSeriesId, numbers },
      });
      setStarted(res.folder);
      qc.invalidateQueries({ queryKey: ['source-jobs'] });
      toast(tr('Fetching {n} chapters…').replace('{n}', String(numbers.length)), 'info');
    } catch (e) {
      toast(msgOf(e, tr('Could not start.')), 'error');
    } finally {
      setBusy(false);
    }
  };

  if (started) {
    return (
      <Modal title={tr('Filling in chapters')} onClose={onClose}>
        <p className="text-sm text-fog-400">
          {job?.reason
            ? job.reason
            : tr('This runs in the background. You can close this and it will keep going.')}
        </p>
        <div className="mt-4">
          <ProgressBar value={job && job.total ? job.done / job.total : 0.02} />
          <p className="mt-2 text-xs text-fog-500">
            {job ? `${job.done} / ${job.total}` : tr('Starting…')}
          </p>
        </div>
        <button onClick={onClose} className="btn-ghost mt-5 w-full text-sm">{tr('Close')}</button>
      </Modal>
    );
  }

  const d = scan.data;
  const usable = (d?.candidates || []).filter((c) => c.why === 'ok' || c.fillable.length > 0 || c.newer.length > 0);
  const rejected = (d?.candidates || []).filter((c) => c.why !== 'ok' && c.fillable.length === 0 && c.newer.length === 0);

  return (
    <Modal title={selectedCandidate ? `${tr('Choose Chapters')} — ${selectedCandidate.name}` : tr('Find chapters')} onClose={onClose}>
      {scan.isLoading && <p className="text-sm text-fog-400">{tr('Asking your sources…')}</p>}
      {scan.error && <p className="text-sm text-rose-300">{msgOf(scan.error, tr('The scan failed.'))}</p>}

      {selectedCandidate && (
        <div>
          <div className="flex items-center gap-2 mb-3">
            <button onClick={() => setSelectedCandidate(null)} className="chip text-xs">
              ← {tr('Back to sources')}
            </button>
            <span className="text-xs text-fog-400 font-medium">{selectedCandidate.name}</span>
          </div>

          <div className="rounded-xl border border-ink-700 bg-ink-900/50 p-3 mb-4">
            <label className="text-xs font-semibold uppercase tracking-wider text-fog-400 mb-2 block">
              {tr('Chapter Range to Download')}
            </label>
            <div className="flex items-center gap-2">
              <input
                type="number"
                value={rangeStart}
                onChange={(e) => {
                  const val = e.target.value;
                  setRangeStart(val);
                  const s = Number(val) || 0;
                  const end = Number(rangeEnd) || 0;
                  const all = [...selectedCandidate.fillable, ...selectedCandidate.newer];
                  setSelectedNums(new Set(all.filter((n) => n >= s && n <= end)));
                }}
                className="w-full rounded-lg border border-ink-700 bg-ink-950 px-3 py-1.5 text-sm text-fog-100"
                placeholder={tr('Start')}
              />
              <span className="text-fog-500">—</span>
              <input
                type="number"
                value={rangeEnd}
                onChange={(e) => {
                  const val = e.target.value;
                  setRangeEnd(val);
                  const s = Number(rangeStart) || 0;
                  const end = Number(val) || 0;
                  const all = [...selectedCandidate.fillable, ...selectedCandidate.newer];
                  setSelectedNums(new Set(all.filter((n) => n >= s && n <= end)));
                }}
                className="w-full rounded-lg border border-ink-700 bg-ink-950 px-3 py-1.5 text-sm text-fog-100"
                placeholder={tr('End')}
              />
            </div>
            <p className="mt-2 text-xs text-fog-400">
              {selectedNums.size} {tr('chapters selected')}
            </p>
          </div>

          <div className="max-h-48 overflow-y-auto space-y-1 mb-4 pr-1">
            {[...selectedCandidate.fillable, ...selectedCandidate.newer].sort((a, b) => a - b).map((num) => {
              const isChecked = selectedNums.has(num);
              return (
                <label
                  key={num}
                  className={`flex items-center gap-2 rounded-lg px-2.5 py-1 text-xs cursor-pointer ${
                    isChecked ? 'bg-ink-800 text-white' : 'text-fog-400 hover:bg-ink-800/40'
                  }`}
                >
                  <input
                    type="checkbox"
                    checked={isChecked}
                    onChange={() => {
                      setSelectedNums((prev) => {
                        const next = new Set(prev);
                        if (next.has(num)) next.delete(num);
                        else next.add(num);
                        return next;
                      });
                    }}
                    className="rounded border-ink-600 bg-ink-950 text-accent-500"
                  />
                  <span>Chapter {num}</span>
                  {selectedCandidate.newer.includes(num) && (
                    <span className="chip text-[9px] py-0 px-1 text-emerald-400 border-emerald-500/30">new</span>
                  )}
                </label>
              );
            })}
          </div>

          <button
            disabled={busy || selectedNums.size === 0}
            onClick={() => runWithNumbers(selectedCandidate, Array.from(selectedNums))}
            className="btn-accent w-full py-2.5 text-sm disabled:opacity-50"
          >
            {busy ? tr('Starting…') : tr('Download {n} selected chapters').replace('{n}', String(selectedNums.size))}
          </button>
        </div>
      )}

      {!selectedCandidate && d && (
        <>
          <p className="text-sm text-fog-300">
            {tr('You have {n} chapters').replace('{n}', String(d.have.count))}
            {d.have.first != null && `, ${d.have.first}–${d.have.last}`}
            {d.gaps.length
              ? `. ${tr('Missing')}: ${d.gaps.map((g) => (g.lo === g.hi ? g.lo : `${g.lo}–${g.hi}`)).join(', ')}`
              : `. ${tr('No internal gaps.')}`}
          </p>

          {d.refusal && <p className="mt-3 text-sm text-amber-300">{d.refusal.message}</p>}

          {usable.map((c) => {
            const availCount = c.fillable.length + c.newer.length;
            return (
              <div key={`${c.source}:${c.sourceSeriesId}`} className="mt-4 rounded-2xl border border-ink-700 p-3">
                <div className="flex gap-3">
                  <Img src={sourceCover(c.source, c.coverUrl)} alt="" className="h-16 w-12 shrink-0 rounded-lg object-cover" />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold text-white">{c.name}</p>
                    <p className="truncate text-xs text-fog-400">{tr('Listed there as')} “{c.title}”</p>
                    <p className="mt-1 text-xs text-fog-500">
                      {c.count} {tr('chapters')} ({c.first}–{c.last}) · {availCount} {tr('available to download')}
                    </p>
                  </div>
                </div>
                <div className="mt-3 flex gap-2">
                  <button
                    disabled={busy || availCount === 0}
                    onClick={() => openPicker(c)}
                    className="btn-accent flex-1 text-xs py-2 disabled:opacity-50"
                  >
                    {tr('Choose chapters to download ({n})').replace('{n}', String(availCount))}
                  </button>
                </div>
              </div>
            );
          })}

          {!usable.length && !scan.isLoading && !d.refusal && (
            <p className="mt-3 text-sm text-fog-400">{tr('No source could supply what is missing.')}</p>
          )}

          <div className="mt-5">
            <label className="text-xs text-fog-500">{tr('Known under another name?')}</label>
            <div className="mt-1 flex gap-2">
              <input
                value={altTitle}
                onChange={(e) => setAltTitle(e.target.value)}
                placeholder={tr('Search under a different title')}
                className="min-w-0 flex-1 rounded-full border border-ink-700 bg-transparent px-3 py-2 text-sm text-fog-100"
              />
              <button onClick={() => setTerm(altTitle.trim())} className="btn-ghost shrink-0 text-sm">
                {tr('Search')}
              </button>
            </div>
          </div>

          {rejected.length > 0 && (
            <div className="mt-5">
              <p className="text-xs uppercase tracking-wide text-fog-600">{tr('Checked, not usable')}</p>
              <ul className="mt-2 space-y-1">
                {rejected.map((c) => (
                  <li key={`${c.source}:${c.sourceSeriesId}`} className="text-xs text-fog-500">
                    <span className="text-fog-400">{c.name}</span> · {whyText(c)}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </>
      )}
    </Modal>
  );
}
