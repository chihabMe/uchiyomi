'use client';
import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { IcX } from './icons';
import { t as tr } from '@/lib/i18n';

export interface ChapterItem {
  id: string;
  label: string;
  number?: number;
}

export function ChapterDrawer({
  open,
  title,
  currentId,
  chapters,
  onSelect,
  onClose,
}: {
  open: boolean;
  title?: string;
  currentId?: string;
  chapters: ChapterItem[];
  onSelect: (id: string) => void;
  onClose: () => void;
}) {
  const [query, setQuery] = useState('');

  if (!open) return null;

  const q = query.trim().toLowerCase();
  const filtered = chapters.filter((c) => {
    if (!q) return true;
    return c.label.toLowerCase().includes(q) || (c.number != null && String(c.number).includes(q));
  });

  return (
    <AnimatePresence>
      <div className="fixed inset-0 z-50 flex justify-start">
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="absolute inset-0 bg-black/60 backdrop-blur-sm"
          onClick={onClose}
        />
        <motion.div
          initial={{ x: '-100%' }}
          animate={{ x: 0 }}
          exit={{ x: '-100%' }}
          transition={{ type: 'spring', stiffness: 360, damping: 36 }}
          className="relative z-10 flex h-full w-full max-w-sm flex-col border-r border-ink-700 bg-ink-900/95 shadow-2xl backdrop-blur-2xl"
        >
          {/* Header */}
          <div className="flex items-center justify-between border-b border-ink-700/80 px-4 py-3.5 pt-[max(0.9rem,calc(env(safe-area-inset-top)+0.5rem))]">
            <div className="min-w-0 pr-2">
              <h3 className="truncate font-display text-sm font-semibold text-white">{title || tr('Chapters')}</h3>
              <p className="text-[11px] text-fog-400">{chapters.length} {tr('chapters')}</p>
            </div>
            <button
              onClick={onClose}
              className="rounded-full p-1.5 text-fog-400 hover:bg-ink-800 hover:text-white transition"
              aria-label={tr('Close')}
            >
              <IcX width={18} height={18} />
            </button>
          </div>

          {/* Search Filter */}
          <div className="border-b border-ink-800/80 p-3">
            <input
              type="text"
              placeholder={tr('Filter chapters…')}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              className="w-full rounded-xl border border-ink-700 bg-ink-800/70 px-3 py-2 text-xs text-fog-100 placeholder-fog-500 outline-none focus:border-accent"
              autoFocus
            />
          </div>

          {/* Chapter List */}
          <div className="flex-1 overflow-y-auto p-2 space-y-1">
            {filtered.map((c) => {
              const isCurrent = c.id === currentId;
              return (
                <button
                  key={c.id}
                  onClick={() => {
                    onSelect(c.id);
                    onClose();
                  }}
                  className={`flex w-full items-center justify-between rounded-xl px-3 py-2.5 text-start text-xs transition ${
                    isCurrent
                      ? 'border border-accent/40 bg-accent/20 font-semibold text-accent-300'
                      : 'text-fog-200 hover:bg-ink-800/60 active:bg-ink-800'
                  }`}
                >
                  <span className="truncate pr-2">{c.label}</span>
                  {isCurrent && (
                    <span className="chip shrink-0 bg-accent px-1.5 py-0 text-[9px] font-medium text-white">
                      {tr('Reading')}
                    </span>
                  )}
                </button>
              );
            })}
            {filtered.length === 0 && (
              <p className="py-12 text-center text-xs text-fog-500">{tr('No chapters found')}</p>
            )}
          </div>
        </motion.div>
      </div>
    </AnimatePresence>
  );
}
