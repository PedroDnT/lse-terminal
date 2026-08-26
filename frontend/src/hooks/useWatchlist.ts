import { useCallback, useEffect, useRef, useState } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { api } from '@/lib/api';
import { DEFAULT_WATCHLIST } from '@/components/chart/sidebar/SymbolSearchPanel';

// Per-user watchlist state for the chart-page sidebar.
//
// Anonymous users:
//   See DEFAULT_WATCHLIST (the 25 cross-asset starters) in memory. Star
//   toggles update the in-memory state but do NOT persist; a refresh
//   resets to default. The watchlist is a per-user setting, and
//   "per-anonymous-browser" isn't a concept we support here. If anon users
//   want their customisations to stick, they sign in.
//
// Signed-in users:
//   State is loaded from the `watchlist` table (PK firebase_uid, jsonb
//   symbols) on sign-in. If they have no row yet they see the same
//   DEFAULT_WATCHLIST; their first edit creates the row. Subsequent edits
//   debounce-UPSERT the full symbols array, so rapid star clicks coalesce
//   to one DB write 500ms after the last click.
//
// Replaces an earlier localStorage-backed implementation in
// ChartLeftSidebar. localStorage is no longer used for the watchlist;
// the DB is the source of truth for signed-in users, and anonymous users
// get an in-memory default that resets on refresh by design.
export function useWatchlist(): {
  watchlist: string[];
  setWatchlist: (next: string[] | ((prev: string[]) => string[])) => void;
} {
  const { user } = useAuth();
  const [watchlist, setWatchlistState] = useState<string[]>(DEFAULT_WATCHLIST);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const currentUidRef = useRef<string | null>(null);

  // Load on sign-in. Reverts to DEFAULT_WATCHLIST on sign-out.
  useEffect(() => {
    let cancelled = false;
    currentUidRef.current = user?.uid ?? null;

    if (!user) {
      setWatchlistState(DEFAULT_WATCHLIST);
      return;
    }

    (async () => {
      try {
        const row = await api.getWatchlist();
        if (cancelled) return;
        const saved = row?.symbols;
        if (Array.isArray(saved) && saved.length > 0) {
          setWatchlistState(saved);
        } else {
          // Signed in but no saved row: show defaults. We don't pre-create
          // the row; the first edit will. Keeps the table free of empty
          // default rows for accounts that never customise.
          setWatchlistState(DEFAULT_WATCHLIST);
        }
      } catch (err) {
        console.warn('[watchlist] DB load failed, showing default:', err);
        if (!cancelled) setWatchlistState(DEFAULT_WATCHLIST);
      }
    })();

    return () => { cancelled = true; };
  }, [user]);

  const setWatchlist = useCallback(
    (next: string[] | ((prev: string[]) => string[])) => {
      setWatchlistState(prev => {
        const computed = typeof next === 'function' ? next(prev) : next;

        // Capture the current user's uid at call time so a sign-out
        // during the 500ms debounce doesn't fire a save under the wrong
        // identity (RLS would reject it anyway, but failing fast is cleaner).
        const uidAtCallTime = currentUidRef.current;
        if (uidAtCallTime) {
          if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
          saveTimerRef.current = setTimeout(() => {
            if (currentUidRef.current !== uidAtCallTime) return;
            api.upsertWatchlist(computed).catch(err => {
              console.warn('[watchlist] save failed:', err);
            });
          }, 500);
        }
        return computed;
      });
    },
    [],
  );

  // Clean up any pending save on unmount. The next mount will reload from
  // DB (or show default for anon) so dropping the pending save is safe.
  useEffect(() => () => {
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
  }, []);

  return { watchlist, setWatchlist };
}
