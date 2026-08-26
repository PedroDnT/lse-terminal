import { useCallback, useEffect, useReducer, useRef } from 'react';
import { useOptionalAuth } from '@/contexts/AuthContext';
import { api } from '@/lib/api';

// Per-user preferences, read/written as paths inside the existing
// `chart_settings.settings` jsonb (one row per user). That row's default
// schema already contains `alerts`, `events`, `chartSettings`,
// `chartAppearance`, `watchlist` etc.; i.e. it's the user-preferences
// store, just misnamed. We add new keys under it instead of creating a
// new one.
//
// Design:
//
// - Module-level cache: `cachedSettings` holds the loaded `settings` jsonb
//   for the currently-authenticated user. ALL useUserPref calls in the page
//   read/write from this one object so a single GET fans out to every key,
//   and a single debounced UPSERT covers writes from every key.
// - Subscribers: each hook instance registers a forceRender callback so a
//   write from one key triggers a re-render of every key (in case they
//   share an object root).
// - Auth-aware: on sign-in we GET the row; on sign-out we drop cache and
//   every hook reverts to its default. Anonymous users still get reactive
//   in-session updates (writes mutate the cache, no DB save) but a refresh
//   wipes them, by design.
// - Debounce: writes coalesce 500ms after the last setValue so rapid
//   toggles (e.g. a colour picker, a slider) cost one UPSERT not N.
//
// Usage:
//   const [theme, setTheme] = useUserPref<'dark'|'light'>('preferences.theme', 'dark');
//   const [favs, setFavs]   = useUserPref<string[]>('preferences.indicatorFavorites', []);

// ── Module-level shared state ────────────────────────────────────────────────

let cachedSettings: Record<string, any> | null = null;
let currentUid: string | null = null;
let loadPromise: Promise<void> | null = null;
let saveTimer: ReturnType<typeof setTimeout> | null = null;
// userTouchedSinceLoad gates the "late fetch overwrites a fresh user edit"
// race: if the user has called setValue since the current load started, the
// in-memory cache is fresher than the DB and we drop the fetch result.
let userTouchedSinceLoad = false;
const subscribers = new Set<() => void>();

function notifyAll() {
  subscribers.forEach(fn => fn());
}

// Dot-path get: getByPath({a:{b:1}}, 'a.b') === 1
function getByPath(obj: any, path: string): any {
  if (obj == null) return undefined;
  return path.split('.').reduce<any>((o, k) => (o == null ? o : o[k]), obj);
}

// Dot-path set returning a NEW object with structural sharing along the path.
// Intermediate non-object values are replaced with {} so the path is always
// addressable; siblings are preserved by spread.
function setByPath(obj: Record<string, any>, path: string, value: any): Record<string, any> {
  const keys = path.split('.');
  const next: Record<string, any> = { ...obj };
  let cursor = next;
  for (let i = 0; i < keys.length - 1; i++) {
    const k = keys[i];
    cursor[k] = (cursor[k] && typeof cursor[k] === 'object' && !Array.isArray(cursor[k]))
      ? { ...cursor[k] }
      : {};
    cursor = cursor[k];
  }
  cursor[keys[keys.length - 1]] = value;
  return next;
}

async function loadFor(uid: string): Promise<void> {
  // Coalesce concurrent loads for the same uid into one fetch.
  if (loadPromise && currentUid === uid) return loadPromise;
  currentUid = uid;
  userTouchedSinceLoad = false;
  loadPromise = (async () => {
    try {
      const row = await api.getChartSettings();
      if (currentUid !== uid) return; // signed out / switched user during fetch
      // Race guard: if the user edited any pref while the fetch was in
      // flight, the in-memory cache is fresher than the DB. Don't clobber
      // the user's edit with the stale fetch.
      if (userTouchedSinceLoad) return;
      cachedSettings = (row?.settings as Record<string, any>) ?? {};
    } catch (err) {
      console.warn('[useUserPref] load failed; using defaults:', err);
      if (currentUid === uid && !userTouchedSinceLoad) cachedSettings = {};
    } finally {
      loadPromise = null;
      notifyAll();
    }
  })();
  return loadPromise;
}

// Top-level branches owned by this hook. Currently everything migrated to
// useUserPref lives under `preferences.*`; ChartSettingsDialog owns the
// other branches (chartAppearance, alerts, events, chartSettings, watchlist).
// We send ONLY this branch to merge_chart_settings so the RPC's shallow
// top-level merge doesn't overwrite branches we don't own. Add to this
// set if useUserPref starts writing other top-level paths.
const OWNED_BRANCHES = ['preferences'];

function scheduleSave() {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    saveTimer = null;
    if (!currentUid || !cachedSettings) return;
    const patch: Record<string, any> = {};
    for (const branch of OWNED_BRANCHES) {
      if (cachedSettings[branch] !== undefined) {
        patch[branch] = cachedSettings[branch];
      }
    }
    if (Object.keys(patch).length === 0) return;
    api.upsertChartSettings(patch).catch(err => {
      console.warn('[useUserPref] save failed:', err);
    });
  }, 500);
}

// ── Public hook ──────────────────────────────────────────────────────────────

export function useUserPref<T>(
  path: string,
  defaultValue: T,
): [T, (next: T | ((prev: T) => T)) => void] {
  // useOptionalAuth (not useAuth) because shell components like the Toaster
  // mount outside the AuthProvider in the tree and would otherwise crash.
  // When no provider is present, treat the caller as anonymous.
  const auth = useOptionalAuth();
  const user = auth?.user ?? null;
  const [, forceRender] = useReducer((x: number) => x + 1, 0);

  // Refs so the setter closure stays stable across renders even when
  // defaultValue identity churns (e.g. caller passes an inline [] literal).
  const defaultRef = useRef(defaultValue);
  defaultRef.current = defaultValue;
  const pathRef = useRef(path);
  pathRef.current = path;

  // Register as a subscriber once. Renders triggered by other hook instances
  // and by load/clear events both go through notifyAll().
  useEffect(() => {
    subscribers.add(forceRender);
    return () => { subscribers.delete(forceRender); };
  }, []);

  // Load on sign-in. Drop the cache on sign-out (every hook then reverts to
  // its own defaultValue on the next render).
  useEffect(() => {
    if (!user) {
      if (currentUid !== null) {
        currentUid = null;
        cachedSettings = null;
        userTouchedSinceLoad = false;
        if (saveTimer) { clearTimeout(saveTimer); saveTimer = null; }
        notifyAll();
      }
      return;
    }
    if (currentUid !== user.uid) {
      void loadFor(user.uid);
    }
  }, [user]);

  const raw = cachedSettings ? getByPath(cachedSettings, path) : undefined;
  const value: T = (raw === undefined ? defaultRef.current : (raw as T));

  const setValue = useCallback(
    (next: T | ((prev: T) => T)) => {
      const cur: T = cachedSettings
        ? ((getByPath(cachedSettings, pathRef.current) as T) ?? defaultRef.current)
        : defaultRef.current;
      const resolved = typeof next === 'function'
        ? (next as (prev: T) => T)(cur)
        : next;
      cachedSettings = setByPath(cachedSettings ?? {}, pathRef.current, resolved);
      userTouchedSinceLoad = true;
      notifyAll();
      if (currentUid) scheduleSave();
    },
    [],
  );

  return [value, setValue];
}
