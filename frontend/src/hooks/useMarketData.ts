// ============================================================================
// useMarketData.ts - instrument metadata from the local engine.
//
// Upstream this hook read a master symbol registry from a remote database. The
// terminal exposes the equivalent through its own provider layer:
//
//     GET /api/instruments?provider=&query=&limit=
//
// so the instrument universe is whatever the user's selected provider offers
// (their own imported files, or a configured data source) rather than a fixed
// hosted list.
//
// Only the members the ported chart actually consumes are implemented:
// searchAssets, getTableName, getCompanyName, getDisplayName and isLoaded.
// ============================================================================

import { useCallback, useEffect, useMemo, useState } from 'react';
import { getEngineContext } from '@/lib/localEngine';

export interface SearchAsset {
  symbol: string;
  name: string;
  category: string;
}

// Module-level cache keyed by provider. The hook is mounted by several chart
// components at once; without this they would each issue their own request for
// the same instrument list on every mount.
const cache = new Map<string, SearchAsset[]>();
const inflight = new Map<string, Promise<SearchAsset[]>>();

async function loadInstruments(provider: string): Promise<SearchAsset[]> {
  const cached = cache.get(provider);
  if (cached) return cached;

  const pending = inflight.get(provider);
  if (pending) return pending;

  const url = new URL('/api/instruments', window.location.origin);
  url.searchParams.set('provider', provider);
  url.searchParams.set('limit', '200');

  const p = fetch(url.toString())
    .then((r) => (r.ok ? r.json() : []))
    .then((rows: SearchAsset[]) => {
      cache.set(provider, rows);
      return rows;
    })
    .catch(() => {
      // A provider that cannot list instruments (e.g. no data imported yet)
      // must not break the chart; an empty universe renders an empty search.
      cache.set(provider, []);
      return [] as SearchAsset[];
    })
    .finally(() => inflight.delete(provider));

  inflight.set(provider, p);
  return p;
}

export function useMarketData() {
  const provider = getEngineContext().provider;
  const [assets, setAssets] = useState<SearchAsset[]>(() => cache.get(provider) || []);
  const [isLoading, setIsLoading] = useState(!cache.has(provider));

  useEffect(() => {
    let alive = true;
    setIsLoading(!cache.has(provider));
    loadInstruments(provider).then((rows) => {
      if (!alive) return;
      setAssets(rows);
      setIsLoading(false);
    });
    return () => { alive = false; };
  }, [provider]);

  const bySymbol = useMemo(() => {
    const m = new Map<string, SearchAsset>();
    for (const a of assets) {
      m.set(a.symbol.toUpperCase(), a);
      // The manual-backtest route carries the pair slashless ("EURUSD"), so
      // lookups must also resolve the compacted form of "EUR/USD".
      m.set(a.symbol.replace(/[^A-Za-z0-9]/g, '').toUpperCase(), a);
    }
    return m;
  }, [assets]);

  // The ported fetch layer addresses history by "table name". Locally there are
  // no tables, so this produces a stable descriptor that localEngine parses:
  // the timeframe suffix is what it reads, the symbol comes from engine
  // context. See localEngine.resolveTimeframe.
  const getTableName = useCallback((symbol: string): string => {
    return `candles_${symbol.replace(/[^A-Za-z0-9]/g, '').toLowerCase()}`;
  }, []);

  const getCompanyName = useCallback((symbol: string): string | null => {
    return bySymbol.get(symbol.toUpperCase())?.name ?? null;
  }, [bySymbol]);

  const getDisplayName = useCallback((symbol: string): string => {
    return getCompanyName(symbol) || symbol;
  }, [getCompanyName]);

  // Instrument category ("forex", "crypto", "stock", ...) from the provider's
  // instrument list; drives price decimals and pip sizing in the manual
  // backtester via getDisplayConfig.
  const getCategory = useCallback((symbol: string): string | undefined => {
    return bySymbol.get(symbol.toUpperCase())?.category ?? undefined;
  }, [bySymbol]);

  return {
    searchAssets: assets,
    getTableName,
    getTableNameAsync: useCallback(async (s: string) => getTableName(s), [getTableName]),
    getCompanyName,
    getDisplayName,
    getCategory,
    isLoaded: !isLoading,
    isLoading,
  };
}

export default useMarketData;
