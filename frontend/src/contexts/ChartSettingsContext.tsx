import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, ReactNode } from 'react';
import { useOptionalAuth } from '@/contexts/AuthContext';
import { api } from '@/lib/api';
import { auth as firebaseAuth } from '@/lib/firebase';
import { ChartSettings, getDefaultSettings } from '@/components/chart/ChartSettingsDialog';
import { fromAPIFormat, mergeWithDefaults, toAPIFormat } from '@/lib/settingsMapper';

// Single source of truth for chart_settings.settings (DB row keyed by
// firebase_uid). Reworked to be race-free:
//
//   - Only ONE state. Dialog and inline panels both consume + write here.
//     No local drafts anywhere else. No second api.getChartSettings() fetch.
//   - Only ONE debounce. Writers call update synchronously; the context
//     debounces the DB write. Stacking another debounce on top reintroduces
//     races (a stale draft in flight that overwrites a fresher context value).
//   - Init-race guard: if the user edits before the initial DB fetch
//     resolves, the late fetch is discarded. Without this, a fast user can
//     click a colour and watch it revert when getChartSettings settles.
//   - Pending writes are tagged with the uid they were scheduled for, and
//     the timer is cancelled on auth change. Without this, a timer scheduled
//     while User A is signed in could fire after User B signs in and write
//     A's settings to B's row.
//   - Cross-tab sync via BroadcastChannel: when one tab commits a save,
//     every other tab in the same browser for the same uid updates its
//     in-memory state without a refresh. Tabs with a pending local edit
//     (userTouchedRef) ignore incoming broadcasts so an in-progress edit
//     in tab B isn't clobbered by tab A's save. Cross-DEVICE sync is still
//     out of scope; that needs a server push channel.

interface ChartSettingsContextValue {
  settings: ChartSettings;
  isLoading: boolean;
  // Partial update: shallow-merges `patch` into the in-memory settings,
  // then schedules a debounced POST to merge_chart_settings RPC for the
  // signed-in user. For anonymous users the update is in-memory only.
  updateChartSettings: (patch: Partial<ChartSettings>) => void;
  // Full replace: writes the entire settings object. Behaviour identical
  // to a partial update of every branch; kept for callers that already
  // hold a full ChartSettings.
  replaceChartSettings: (next: ChartSettings) => void;
  hasSavedAppearance: boolean;
}

const ChartSettingsContext = createContext<ChartSettingsContextValue | null>(null);

const SAVE_DEBOUNCE_MS = 300;
const SYNC_CHANNEL_NAME = 'chart-settings-sync';

type SyncMessage = {
  type: 'settings-applied';
  uid: string;
  settings: ChartSettings;
};

export function ChartSettingsProvider({ children }: { children: ReactNode }) {
  const authCtx = useOptionalAuth();
  const user = authCtx?.user ?? null;
  const uid = user?.uid ?? null;

  const [settings, setSettings] = useState<ChartSettings>(getDefaultSettings);
  const [isLoading, setIsLoading] = useState(false);
  // Whether the user has EVER saved appearance settings. Consumers that
  // theme differently from the site defaults (the terminal's dark chart)
  // need this to tell "user chose these values" from "nothing saved yet":
  // comparing values against defaults cannot make that distinction (a user
  // who picks the default white background would be ignored).
  const [hasSavedAppearance, setHasSavedAppearance] = useState(false);

  // userTouchedRef gates the late-arriving fetch result. If the user has
  // edited anything since the current load started, we drop the fetched
  // value rather than overwrite the user's in-memory change.
  const userTouchedRef = useRef(false);

  // Pending save is tagged with the uid it was scheduled for so the timer
  // can refuse to fire as the wrong user.
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingRef = useRef<{ settings: ChartSettings; uid: string } | null>(null);

  // BroadcastChannel for cross-tab sync. Constructed lazily inside the
  // provider so SSR / unsupported-browser environments degrade gracefully
  // (channel === null -> no broadcasts, no listeners, no errors).
  const channelRef = useRef<BroadcastChannel | null>(null);

  const cancelPendingSave = useCallback(() => {
    if (saveTimerRef.current) {
      clearTimeout(saveTimerRef.current);
      saveTimerRef.current = null;
    }
    pendingRef.current = null;
  }, []);

  // Effect: react to uid changes (sign-in / sign-out / different user).
  // Cancels any pending save tied to the previous uid, resets in-memory
  // state to defaults, then fetches the new user's row if signed in.
  useEffect(() => {
    cancelPendingSave();
    userTouchedRef.current = false;

    if (!uid) {
      setSettings(getDefaultSettings());
      setHasSavedAppearance(false);
      setIsLoading(false);
      return;
    }

    setSettings(getDefaultSettings());
    setHasSavedAppearance(false);
    setIsLoading(true);
    let cancelled = false;

    api.getChartSettings()
      .then(row => {
        if (cancelled) return;
        // Race guard: if the user edited anything since this fetch started,
        // the in-memory state is fresher than the DB. Drop the fetch.
        if (userTouchedRef.current) return;
        const api_settings = row?.settings ?? null;
        const merged = mergeWithDefaults(api_settings, getDefaultSettings());
        setSettings({ ...getDefaultSettings(), ...merged });
        setHasSavedAppearance(!!(api_settings as any)?.chartAppearance);
      })
      .catch(err => {
        if (cancelled) return;
        console.warn('[ChartSettingsContext] DB load failed; keeping defaults:', err);
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [uid, cancelPendingSave]);

  const scheduleSave = useCallback((nextSettings: ChartSettings, forUid: string) => {
    pendingRef.current = { settings: nextSettings, uid: forUid };
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(() => {
      saveTimerRef.current = null;
      const pending = pendingRef.current;
      pendingRef.current = null;
      if (!pending) return;
      // Re-check at fire time: the live Firebase user must match the uid
      // this save was scheduled for. Without this, sign-out + sign-in
      // within the debounce window could write the previous user's
      // settings against the new user's JWT.
      const liveUid = firebaseAuth.currentUser?.uid ?? null;
      if (liveUid !== pending.uid) return;
      api.upsertChartSettings(toAPIFormat(pending.settings))
        .then(() => {
          // Broadcast the applied settings to sibling tabs. Other tabs
          // with the same uid and no in-progress local edit will mirror
          // this state; tabs mid-edit will ignore the broadcast and keep
          // their pending change.
          channelRef.current?.postMessage({
            type: 'settings-applied',
            uid: pending.uid,
            settings: pending.settings,
          } satisfies SyncMessage);
        })
        .catch(err => {
          console.warn('[ChartSettingsContext] save failed:', err);
        });
    }, SAVE_DEBOUNCE_MS);
  }, []);

  const applyAndSave = useCallback((compute: (prev: ChartSettings) => ChartSettings) => {
    setSettings(prev => {
      const next = compute(prev);
      userTouchedRef.current = true;
      if (uid) scheduleSave(next, uid);
      return next;
    });
    // From the first edit on, the user's values are authoritative (live
    // preview included; the debounced save persists them moments later).
    setHasSavedAppearance(true);
  }, [uid, scheduleSave]);

  const updateChartSettings = useCallback((patch: Partial<ChartSettings>) => {
    applyAndSave(prev => ({
      ...prev,
      ...patch,
      candles: patch.candles ? { ...prev.candles, ...patch.candles } : prev.candles,
      chart: patch.chart ? { ...prev.chart, ...patch.chart } : prev.chart,
      data: patch.data ? { ...prev.data, ...patch.data } : prev.data,
      alerts: patch.alerts ? { ...prev.alerts, ...patch.alerts } : prev.alerts,
      events: patch.events ? { ...prev.events, ...patch.events } : prev.events,
      trading: patch.trading ? { ...prev.trading, ...patch.trading } : prev.trading,
    }));
  }, [applyAndSave]);

  const replaceChartSettings = useCallback((next: ChartSettings) => {
    applyAndSave(() => next);
  }, [applyAndSave]);

  // BroadcastChannel lifecycle: open on mount, close on unmount. The
  // message handler mirrors another tab's saved settings into this tab's
  // state, but only if (a) the uid matches and (b) this tab isn't mid-edit
  // (userTouchedRef.current === false). The second guard prevents an
  // incoming broadcast from clobbering a local in-progress edit before
  // its own debounced save fires.
  useEffect(() => {
    if (typeof window === 'undefined' || typeof BroadcastChannel === 'undefined') return;
    const ch = new BroadcastChannel(SYNC_CHANNEL_NAME);
    channelRef.current = ch;
    const onMessage = (event: MessageEvent<SyncMessage>) => {
      const msg = event.data;
      if (!msg || msg.type !== 'settings-applied') return;
      const liveUid = firebaseAuth.currentUser?.uid ?? null;
      if (msg.uid !== liveUid) return;
      if (userTouchedRef.current) return;
      setSettings(msg.settings);
    };
    ch.addEventListener('message', onMessage);
    return () => {
      ch.removeEventListener('message', onMessage);
      ch.close();
      channelRef.current = null;
    };
  }, []);

  // Unmount cleanup so a timer can't fire after the provider is gone.
  useEffect(() => () => {
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
  }, []);

  const value = useMemo<ChartSettingsContextValue>(() => ({
    settings, isLoading, hasSavedAppearance, updateChartSettings, replaceChartSettings,
  }), [settings, isLoading, hasSavedAppearance, updateChartSettings, replaceChartSettings]);

  return (
    <ChartSettingsContext.Provider value={value}>
      {children}
    </ChartSettingsContext.Provider>
  );
}

export function useChartSettings(): ChartSettings {
  const ctx = useContext(ChartSettingsContext);
  if (!ctx) throw new Error('useChartSettings must be used within ChartSettingsProvider');
  return ctx.settings;
}

// Non-throwing variant for components that may render outside the provider.
export function useOptionalChartSettings(): ChartSettings {
  const ctx = useContext(ChartSettingsContext);
  return ctx?.settings ?? getDefaultSettings();
}

export function useChartSettingsLoading(): boolean {
  const ctx = useContext(ChartSettingsContext);
  return ctx?.isLoading ?? false;
}

// True once the user has saved (or is editing) appearance settings; false on
// a fresh profile. Non-throwing so callers outside the provider get false.
export function useHasSavedAppearance(): boolean {
  const ctx = useContext(ChartSettingsContext);
  return ctx?.hasSavedAppearance ?? false;
}

export function useUpdateChartSettings(): (patch: Partial<ChartSettings>) => void {
  const ctx = useContext(ChartSettingsContext);
  if (!ctx) throw new Error('useUpdateChartSettings must be used within ChartSettingsProvider');
  return ctx.updateChartSettings;
}

export function useReplaceChartSettings(): (next: ChartSettings) => void {
  const ctx = useContext(ChartSettingsContext);
  if (!ctx) throw new Error('useReplaceChartSettings must be used within ChartSettingsProvider');
  return ctx.replaceChartSettings;
}
