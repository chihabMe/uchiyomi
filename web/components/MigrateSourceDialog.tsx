'use client';
import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { Modal } from './ConfirmDialog';
import { useToast } from './Toast';
import { t as tr } from '@/lib/i18n';
import { IcChevronRight } from './icons';

interface Candidate {
  source: string;
  name: string;
  sourceId: string;
  title: string;
  coverUrl?: string;
  chapterCount: number;
  isCurrent: boolean;
}

interface CandidatesResponse {
  content: Candidate[];
  seriesTitle: string;
  currentSourceId?: string;
  currentSourceName?: string;
  localChapters: number;
}

export function MigrateSourceDialog({
  seriesId,
  onClose,
}: {
  seriesId: string;
  onClose: () => void;
}) {
  const toast = useToast();
  const qc = useQueryClient();
  const [selected, setSelected] = useState<Candidate | null>(null);
  const [keepFallback, setKeepFallback] = useState(true);
  const [migrating, setMigrating] = useState(false);

  const { data, isLoading, isError } = useQuery<CandidatesResponse>({
    queryKey: ['migrate-candidates', seriesId],
    queryFn: () => api<CandidatesResponse>(`/api/series/${seriesId}/migrate-candidates`),
    staleTime: 60_000,
  });

  const candidates = data?.content ?? [];
  const currentSource = data?.currentSourceName || data?.currentSourceId || tr('Unknown');

  const onMigrate = async () => {
    if (!selected) return;
    setMigrating(true);
    try {
      await api(`/api/series/${seriesId}/migrate`, {
        method: 'POST',
        json: {
          newSourceId: selected.source,
          newSourceSeriesId: selected.sourceId,
          keepOldAsFallback: keepFallback,
        },
      });
      toast(tr('Migrated to {name}!', { name: selected.name }), 'success');
      for (const k of [['series', seriesId], ['series-books', seriesId], ['library'], ['home']]) {
        qc.invalidateQueries({ queryKey: k });
      }
      onClose();
    } catch (e: any) {
      toast(e?.message || tr('Migration failed'), 'error');
    } finally {
      setMigrating(false);
    }
  };

  return (
    <Modal title={tr('Migrate Series Source')} onClose={onClose} wide>
      <div className="space-y-4">
        <div>
          <h4 className="font-display text-sm font-semibold text-white">
            {data?.seriesTitle || tr('This series')}
          </h4>
          <p className="mt-0.5 text-xs text-fog-400">
            {tr('Current provider:')} <span className="font-medium text-fog-200">{currentSource}</span>
            {data?.localChapters ? ` (${data.localChapters} ${tr('chapters on disk')})` : ''}
          </p>
        </div>

        <p className="text-xs text-fog-300">
          {tr('Switching source preserves all your reading progress, bookmarks, and downloaded chapters. Future updates will pull from the new provider.')}
        </p>

        {isLoading && (
          <div className="py-12 text-center text-xs text-fog-500 animate-pulse-soft">
            {tr('Scanning healthy sources for matches…')}
          </div>
        )}

        {isError && (
          <div className="py-8 text-center text-xs text-rose-400">
            {tr('Could not check sources. Please try again.')}
          </div>
        )}

        {!isLoading && candidates.length === 0 && !isError && (
          <div className="py-8 text-center text-xs text-fog-500">
            {tr('No matching sources found for this series.')}
          </div>
        )}

        {!isLoading && candidates.length > 0 && (
          <div className="max-h-72 space-y-2 overflow-y-auto pr-1">
            {candidates.map((c) => {
              const isPicked = selected?.source === c.source && selected?.sourceId === c.sourceId;
              return (
                <div
                  key={`${c.source}:${c.sourceId}`}
                  onClick={() => !c.isCurrent && setSelected(c)}
                  className={`flex items-center justify-between rounded-xl border p-3 transition ${
                    c.isCurrent
                      ? 'border-ink-700/60 bg-ink-800/30 opacity-60 cursor-default'
                      : isPicked
                      ? 'border-accent bg-accent/10 cursor-pointer shadow-sm'
                      : 'border-ink-700 bg-ink-900/60 hover:border-ink-600 cursor-pointer'
                  }`}
                >
                  <div className="flex items-center gap-3 min-w-0 pr-2">
                    {c.coverUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={c.coverUrl} alt="" className="h-12 w-9 rounded object-cover shrink-0 bg-ink-800" />
                    ) : (
                      <div className="grid h-12 w-9 place-items-center rounded bg-ink-800 text-[10px] text-fog-500 shrink-0">
                        📖
                      </div>
                    )}
                    <div className="min-w-0">
                      <p className="truncate text-xs font-semibold text-white">{c.name}</p>
                      <p className="truncate text-[11px] text-fog-400">{c.title}</p>
                      <p className="text-[10px] text-fog-400">
                        {c.chapterCount} {tr('chapters available')}
                      </p>
                    </div>
                  </div>

                  <div className="shrink-0 flex items-center gap-2">
                    {c.isCurrent ? (
                      <span className="chip text-[10px] px-2 py-0.5 bg-ink-700 text-fog-400">
                        {tr('Active')}
                      </span>
                    ) : (
                      <input
                        type="radio"
                        checked={isPicked}
                        onChange={() => setSelected(c)}
                        className="h-4 w-4 accent-accent cursor-pointer"
                      />
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}

        <label className="flex items-center gap-2.5 pt-2 text-xs text-fog-300 cursor-pointer">
          <input
            type="checkbox"
            checked={keepFallback}
            onChange={(e) => setKeepFallback(e.target.checked)}
            className="h-4 w-4 rounded accent-accent"
          />
          <span>{tr('Keep old source as a secondary fallback')}</span>
        </label>

        <div className="flex justify-end gap-2 border-t border-ink-800 pt-3">
          <button type="button" onClick={onClose} className="btn-ghost px-4 py-2 text-xs">
            {tr('Cancel')}
          </button>
          <button
            type="button"
            onClick={onMigrate}
            disabled={!selected || migrating}
            className="btn-accent px-5 py-2 text-xs disabled:opacity-50"
          >
            {migrating ? tr('Migrating…') : tr('Confirm Migration')}
          </button>
        </div>
      </div>
    </Modal>
  );
}
