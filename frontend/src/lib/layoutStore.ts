// ============================================================================
// layoutStore.ts - screen-layout state shared between the chart's React root
// and the shell top-bar layout-button root (two roots, one state), persisted
// to localStorage so the chosen grid survives a reload.
//
// WHY THIS IS ITS OWN FILE and must never move into mount.tsx: the frontend
// builds as a Vite IIFE library (vite.config.ts: formats ['iife'], name
// 'LSEChart'), and that wrapper assigns the ENTRY MODULE'S EXPORTS to
// window.LSEChart. With exactly one runtime export (export default LSEChart)
// the global is the API object itself; the moment the entry gains a second
// runtime export, Rollup switches the global to a namespace object
// ({default, ...}) and window.LSEChart.mount stops existing, which blanks
// every chart in the shell. That exact mistake shipped once (commit
// e71477c exported layoutStore from mount.tsx) and blanked the desktop
// chart. Entry file keeps ONE export; everything shared
// lives in modules like this one. tools/chart_smoke.mjs guards this.
// ============================================================================

import { useEffect, useState } from 'react';
import { type LayoutType, type SyncSettings } from '@/components/chart/MultiTimeframeLayoutSelector';

export type LayoutState = {
  layout: LayoutType;
  sync: SyncSettings;
  panelSymbols: string[];
  // Which grid panel is selected (border highlight + title-bar name + where
  // a sidebar/search symbol pick lands). Session-only, not persisted.
  activePanel: number;
};

const _state: LayoutState = (() => {
  try {
    return {
      layout: (localStorage.getItem('lset-layout') as LayoutType) || '1x1',
      sync: JSON.parse(localStorage.getItem('lset-layout-sync') || 'null') ||
        { syncSymbol: false, syncInterval: false, syncCrosshair: false, syncTime: false },
      panelSymbols: JSON.parse(localStorage.getItem('lset-layout-symbols') || '[]') || [],
      activePanel: 0,
    };
  } catch {
    // Private-mode/blocked localStorage: fall back to defaults, never throw at
    // module evaluation (a throw here would kill the whole bundle).
    return {
      layout: '1x1' as LayoutType,
      sync: { syncSymbol: false, syncInterval: false, syncCrosshair: false, syncTime: false },
      panelSymbols: [],
      activePanel: 0,
    };
  }
})();

const _subs = new Set<() => void>();
const notify = () => _subs.forEach((f) => f());
const persist = (key: string, value: string) => {
  try { localStorage.setItem(key, value); } catch { /* state stays correct in-session */ }
};

export const layoutStore = {
  get: (): LayoutState => _state,
  setLayout(l: LayoutType) {
    _state.layout = l;
    persist('lset-layout', l);
    notify();
  },
  setSync(s: SyncSettings) {
    _state.sync = s;
    persist('lset-layout-sync', JSON.stringify(s));
    notify();
  },
  setPanelSymbol(i: number, sym: string) {
    _state.panelSymbols = [..._state.panelSymbols];
    _state.panelSymbols[i] = sym;
    persist('lset-layout-symbols', JSON.stringify(_state.panelSymbols));
    notify();
  },
  setActivePanel(i: number) {
    if (_state.activePanel === i) return;
    _state.activePanel = i;
    notify();
  },
  subscribe(f: () => void) { _subs.add(f); return () => { _subs.delete(f); }; },
};

export function useLayoutState(): LayoutState {
  const [, force] = useState(0);
  useEffect(() => layoutStore.subscribe(() => force((x) => x + 1)), []);
  return { ..._state };
}
