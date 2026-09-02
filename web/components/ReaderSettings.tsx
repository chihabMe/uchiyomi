'use client';
import { useState } from 'react';
import { motion } from 'framer-motion';
import { ReaderPrefs, ReaderMode, FitMode, TapZone } from '@/lib/readerPrefs';
import { IcX } from './icons';
import { t as tr } from '@/lib/i18n';

function Row({ label, desc, children }: { label: string; desc?: string; children: React.ReactNode }) {
  return (
    <div className="py-2.5">
      <div className="mb-1.5 flex items-baseline justify-between">
        <span className="text-xs font-semibold uppercase tracking-wider text-fog-400">{label}</span>
        {desc && <span className="text-[11px] text-fog-500">{desc}</span>}
      </div>
      {children}
    </div>
  );
}

export function ReaderSettings({
  prefs,
  set,
  onClose,
}: {
  prefs: ReaderPrefs;
  set: (p: Partial<ReaderPrefs>) => void;
  onClose: () => void;
}) {
  const [tab, setTab] = useState<'reading' | 'display' | 'nav'>('reading');

  const modes: Array<{ id: ReaderMode; label: string; icon: string; desc: string }> = [
    { id: 'vertical', label: tr('Webtoon'), icon: '📜', desc: tr('Continuous vertical scroll') },
    { id: 'paged-rtl', label: tr('Manga (RTL)'), icon: '📖', desc: tr('Right-to-Left (Japanese)') },
    { id: 'paged-ltr', label: tr('Comic (LTR)'), icon: '📑', desc: tr('Left-to-Right (Western)') },
    { id: 'paged-vertical', label: tr('Vertical Flip'), icon: '↕', desc: tr('Page-by-page vertical flip') },
    { id: 'continuous-horizontal', label: tr('Horizontal'), icon: '↔', desc: tr('Continuous horizontal strip') },
  ];

  const fits: Array<{ id: FitMode; label: string; desc: string }> = [
    { id: 'contain', label: tr('Fit Screen'), desc: tr('Contain whole page') },
    { id: 'width', label: tr('Fit Width'), desc: tr('Fill screen width') },
    { id: 'height', label: tr('Fit Height'), desc: tr('Fill screen height') },
    { id: 'original', label: tr('Original'), desc: tr('1:1 pixel scale') },
  ];

  const tapZones: Array<{ id: TapZone; label: string; desc: string }> = [
    { id: 'default', label: tr('Default'), desc: tr('Left / Menu / Right') },
    { id: 'l-shaped', label: tr('One-Handed'), desc: tr('Bottom & Right for Next') },
    { id: 'kindle', label: tr('Kindle-style'), desc: tr('Right 80% for Next') },
    { id: 'off', label: tr('Off'), desc: tr('Gestures & buttons only') },
  ];

  return (
    <motion.div className="fixed inset-0 z-50 flex flex-col justify-end" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <motion.div
        initial={{ y: '100%' }}
        animate={{ y: 0 }}
        exit={{ y: '100%' }}
        transition={{ type: 'spring', stiffness: 360, damping: 36 }}
        className="relative z-10 max-h-[85vh] overflow-y-auto rounded-t-3xl border-t border-ink-700 bg-ink-900/95 px-5 pt-3 pb-[max(1.5rem,calc(env(safe-area-inset-bottom)+1rem))] backdrop-blur-2xl shadow-2xl"
      >
        <div className="mx-auto mb-2.5 h-1 w-10 rounded-full bg-ink-600" />
        <div className="mb-3 flex items-center justify-between">
          <h3 className="font-display text-base font-semibold text-white">{tr('Reader Preferences')}</h3>
          <button onClick={onClose} className="rounded-full p-1.5 text-fog-400 hover:bg-ink-800 hover:text-white transition">
            <IcX width={18} height={18} />
          </button>
        </div>

        {/* Category Tabs */}
        <div className="mb-3 flex rounded-xl bg-ink-800/80 p-1 text-xs">
          <button
            onClick={() => setTab('reading')}
            className={`flex-1 rounded-lg py-1.5 font-medium transition ${tab === 'reading' ? 'bg-accent text-white shadow' : 'text-fog-400 hover:text-fog-200'}`}
          >
            {tr('Modes & Fit')}
          </button>
          <button
            onClick={() => setTab('nav')}
            className={`flex-1 rounded-lg py-1.5 font-medium transition ${tab === 'nav' ? 'bg-accent text-white shadow' : 'text-fog-400 hover:text-fog-200'}`}
          >
            {tr('Navigation')}
          </button>
          <button
            onClick={() => setTab('display')}
            className={`flex-1 rounded-lg py-1.5 font-medium transition ${tab === 'display' ? 'bg-accent text-white shadow' : 'text-fog-400 hover:text-fog-200'}`}
          >
            {tr('Display & HUD')}
          </button>
        </div>

        {/* Tab 1: Modes & Fit */}
        {tab === 'reading' && (
          <div className="space-y-3">
            <Row label={tr('Reading Mode')}>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                {modes.map((m) => (
                  <button
                    key={m.id}
                    onClick={() => set({ mode: m.id })}
                    className={`flex flex-col items-start rounded-xl border p-2.5 text-start transition ${
                      prefs.mode === m.id
                        ? 'border-accent bg-accent/15 text-white shadow-sm ring-1 ring-accent/30'
                        : 'border-ink-700/80 bg-ink-800/40 text-fog-300 hover:border-ink-600'
                    }`}
                  >
                    <div className="flex items-center gap-1.5 text-xs font-semibold">
                      <span>{m.icon}</span>
                      <span>{m.label}</span>
                    </div>
                    <span className="mt-1 text-[10px] text-fog-500 leading-tight">{m.desc}</span>
                  </button>
                ))}
              </div>
            </Row>

            <Row label={tr('Page Fit')}>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                {fits.map((f) => (
                  <button
                    key={f.id}
                    onClick={() => set({ fit: f.id })}
                    className={`rounded-xl border py-2 text-center text-xs font-medium transition ${
                      prefs.fit === f.id
                        ? 'border-accent bg-accent/15 text-white shadow-sm ring-1 ring-accent/30'
                        : 'border-ink-700/80 bg-ink-800/40 text-fog-300 hover:border-ink-600'
                    }`}
                  >
                    <div>{f.label}</div>
                  </button>
                ))}
              </div>
            </Row>

            {prefs.mode === 'vertical' && (
              <>
                <Row label={tr('Webtoon Max Column Width')} desc={prefs.webtoonWidth === 0 ? tr('Full screen') : `${prefs.webtoonWidth}px`}>
                  <div className="flex items-center gap-3">
                    <input
                      type="range"
                      min={500}
                      max={1400}
                      step={50}
                      value={prefs.webtoonWidth || 1400}
                      onChange={(e) => set({ webtoonWidth: Number(e.target.value) })}
                      className="flex-1 accent-[rgb(var(--accent))]"
                    />
                    <button
                      onClick={() => set({ webtoonWidth: prefs.webtoonWidth === 0 ? 860 : 0 })}
                      className={`rounded-lg border px-2.5 py-1 text-xs font-medium transition ${
                        prefs.webtoonWidth === 0 ? 'border-accent bg-accent/15 text-white' : 'border-ink-700 text-fog-400'
                      }`}
                    >
                      {prefs.webtoonWidth === 0 ? tr('Reset') : tr('100% Full')}
                    </button>
                  </div>
                </Row>

                <Row label={tr('Page Gap')} desc={`${prefs.gap}px`}>
                  <input
                    type="range"
                    min={0}
                    max={40}
                    step={2}
                    value={prefs.gap}
                    onChange={(e) => set({ gap: Number(e.target.value) })}
                    className="w-full accent-[rgb(var(--accent))]"
                  />
                </Row>

                <Row label={tr('Auto-Scroll')} desc={prefs.autoScroll === 0 ? tr('Off') : `${prefs.autoScroll.toFixed(1)} px/f`}>
                  <input
                    type="range"
                    min={0}
                    max={6}
                    step={0.5}
                    value={prefs.autoScroll}
                    onChange={(e) => set({ autoScroll: Number(e.target.value) })}
                    className="w-full accent-[rgb(var(--accent))]"
                  />
                </Row>
              </>
            )}

            {(prefs.mode === 'paged-rtl' || prefs.mode === 'paged-ltr') && (
              <Row label={tr('Double Page Spreads')}>
                <div className="space-y-2">
                  <div className="grid grid-cols-2 gap-2">
                    <button
                      onClick={() => set({ spread: false })}
                      className={`rounded-xl border py-2 text-xs font-medium transition ${
                        !prefs.spread ? 'border-accent bg-accent/15 text-white' : 'border-ink-700/80 bg-ink-800/40 text-fog-400'
                      }`}
                    >
                      {tr('Single Page')}
                    </button>
                    <button
                      onClick={() => set({ spread: true })}
                      className={`rounded-xl border py-2 text-xs font-medium transition ${
                        prefs.spread ? 'border-accent bg-accent/15 text-white' : 'border-ink-700/80 bg-ink-800/40 text-fog-400'
                      }`}
                    >
                      {tr('Double Spread')}
                    </button>
                  </div>

                  {prefs.spread && (
                    <label className="flex items-center justify-between rounded-xl border border-ink-800 bg-ink-800/30 px-3 py-2 cursor-pointer">
                      <div className="min-w-0 pr-2">
                        <span className="text-xs font-medium text-fog-200 block">{tr('First page is cover')}</span>
                        <span className="text-[11px] text-fog-500 block leading-tight">{tr('Keep Page 1 solo so manga double spreads align properly')}</span>
                      </div>
                      <input
                        type="checkbox"
                        checked={prefs.offsetCover}
                        onChange={(e) => set({ offsetCover: e.target.checked })}
                        className="rounded border-ink-600 text-accent accent-[rgb(var(--accent))] h-4 w-4"
                      />
                    </label>
                  )}
                </div>
              </Row>
            )}
          </div>
        )}

        {/* Tab 2: Navigation & Gestures */}
        {tab === 'nav' && (
          <div className="space-y-3">
            <Row label={tr('Tap Zones Layout')}>
              <div className="grid grid-cols-2 gap-2">
                {tapZones.map((tz) => (
                  <button
                    key={tz.id}
                    onClick={() => set({ tapZone: tz.id })}
                    className={`flex flex-col items-start rounded-xl border p-2.5 text-start transition ${
                      prefs.tapZone === tz.id
                        ? 'border-accent bg-accent/15 text-white shadow-sm ring-1 ring-accent/30'
                        : 'border-ink-700/80 bg-ink-800/40 text-fog-300 hover:border-ink-600'
                    }`}
                  >
                    <span className="text-xs font-semibold">{tz.label}</span>
                    <span className="mt-0.5 text-[10px] text-fog-500">{tz.desc}</span>
                  </button>
                ))}
              </div>
            </Row>

            <Row label={tr('On-Screen Touch Buttons')}>
              <label className="flex items-center justify-between rounded-xl border border-ink-800 bg-ink-800/30 px-3 py-2.5 cursor-pointer">
                <div className="min-w-0 pr-2">
                  <span className="text-xs font-medium text-fog-200 block">{tr('Floating Navigation Buttons')}</span>
                  <span className="text-[11px] text-fog-500 block leading-tight">{tr('Display persistent on-screen ◀ and ▶ buttons for effortless single-tap reading')}</span>
                </div>
                <input
                  type="checkbox"
                  checked={prefs.navButtons}
                  onChange={(e) => set({ navButtons: e.target.checked })}
                  className="rounded border-ink-600 text-accent accent-[rgb(var(--accent))] h-4 w-4"
                />
              </label>
            </Row>

            <div className="rounded-xl border border-ink-800 bg-ink-800/20 p-3 text-[11px] text-fog-400 space-y-1">
              <span className="font-semibold text-fog-300 uppercase tracking-wider text-[10px] block">{tr('Keyboard Shortcuts')}</span>
              <p><kbd className="rounded bg-ink-700 px-1 py-0.5 text-fog-200">←</kbd> / <kbd className="rounded bg-ink-700 px-1 py-0.5 text-fog-200">→</kbd> or <kbd className="rounded bg-ink-700 px-1 py-0.5 text-fog-200">h</kbd> / <kbd className="rounded bg-ink-700 px-1 py-0.5 text-fog-200">l</kbd> : {tr('Prev / Next Page')}</p>
              <p><kbd className="rounded bg-ink-700 px-1 py-0.5 text-fog-200">Space</kbd> / <kbd className="rounded bg-ink-700 px-1 py-0.5 text-fog-200">Shift+Space</kbd> : {tr('Scroll / Page Down / Up')}</p>
              <p><kbd className="rounded bg-ink-700 px-1 py-0.5 text-fog-200">[</kbd> / <kbd className="rounded bg-ink-700 px-1 py-0.5 text-fog-200">]</kbd> : {tr('Prev / Next Chapter')}</p>
              <p><kbd className="rounded bg-ink-700 px-1 py-0.5 text-fog-200">f</kbd> : {tr('Toggle Fullscreen')} · <kbd className="rounded bg-ink-700 px-1 py-0.5 text-fog-200">m</kbd> : {tr('Toggle Menu')}</p>
            </div>
          </div>
        )}

        {/* Tab 3: Display & HUD */}
        {tab === 'display' && (
          <div className="space-y-3">
            <Row label={tr('Reader Theme')}>
              <div className="grid grid-cols-3 gap-2">
                {(['amoled', 'sepia', 'gray'] as const).map((t) => (
                  <button
                    key={t}
                    onClick={() => set({ theme: t })}
                    className={`rounded-xl border py-2.5 text-xs font-semibold capitalize transition ${
                      prefs.theme === t
                        ? 'border-accent bg-accent/15 text-white ring-1 ring-accent/30'
                        : 'border-ink-700/80 bg-ink-800/40 text-fog-300'
                    }`}
                  >
                    {t === 'amoled' ? 'AMOLED' : t}
                  </button>
                ))}
              </div>
            </Row>

            <Row label={tr('Brightness')} desc={`${Math.round(prefs.brightness * 100)}%`}>
              <input
                type="range"
                min={0.25}
                max={1}
                step={0.05}
                value={prefs.brightness}
                onChange={(e) => set({ brightness: Number(e.target.value) })}
                className="w-full accent-[rgb(var(--accent))]"
              />
            </Row>

            <Row label={tr('Smart Invert Colors')}>
              <label className="flex items-center justify-between rounded-xl border border-ink-800 bg-ink-800/30 px-3 py-2.5 cursor-pointer">
                <div className="min-w-0 pr-2">
                  <span className="text-xs font-medium text-fog-200 block">{tr('Invert Page Colors')}</span>
                  <span className="text-[11px] text-fog-500 block leading-tight">{tr('Darkens bright white manga backgrounds for comfortable night reading')}</span>
                </div>
                <input
                  type="checkbox"
                  checked={prefs.invertColors}
                  onChange={(e) => set({ invertColors: e.target.checked })}
                  className="rounded border-ink-600 text-accent accent-[rgb(var(--accent))] h-4 w-4"
                />
              </label>
            </Row>

            <Row label={tr('Ambient Reading HUD')}>
              <label className="flex items-center justify-between rounded-xl border border-ink-800 bg-ink-800/30 px-3 py-2.5 cursor-pointer">
                <div className="min-w-0 pr-2">
                  <span className="text-xs font-medium text-fog-200 block">{tr('Minimal Progress HUD')}</span>
                  <span className="text-[11px] text-fog-500 block leading-tight">{tr('Shows a subtle bottom pill with page count, current time, and battery level')}</span>
                </div>
                <input
                  type="checkbox"
                  checked={prefs.showHud}
                  onChange={(e) => set({ showHud: e.target.checked })}
                  className="rounded border-ink-600 text-accent accent-[rgb(var(--accent))] h-4 w-4"
                />
              </label>
            </Row>
          </div>
        )}
      </motion.div>
    </motion.div>
  );
}
