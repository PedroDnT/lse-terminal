// Contract specifications for different instrument types
// Defines lot sizes and P&L calculation methods per asset class

import { 
  allForexSymbols, 
  allCryptoSymbols, 
  allCommoditySymbols, 
  allIndexSymbols,
  allStockSymbols,
  allETFSymbols 
} from './tradingPairs';

export interface ContractSpec {
  type: 'forex' | 'crypto' | 'commodity' | 'index' | 'stock' | 'etf';
  lotSize: number;        // Units per 1 lot
  tickSize: number;       // Minimum price movement
  tickValue: number;      // Value per tick per lot (in quote currency)
  description: string;    // Human-readable description
}

// Price display config (decimals, pip size, input step) for the backtester UI.
// Resolved from the catalog display category (the single source of truth),
// with the symbol used only for the gold/silver and JPY sub-cases within a
// class. Passing the category is what fixes stocks (were shown as 5-dp forex
// because the legacy substring guesser had no stock branch) and the cryptos
// beyond BTC/ETH/XRP (SOL, DOGE, ADA, ... also fell through to forex). When the
// category is absent (registry not loaded yet), it falls back to the legacy
// substring guessing so behavior is unchanged for that case.
export interface DisplayConfig { pipValue: number; decimals: number; step: number; }
export function getDisplayConfig(pair: string | null | undefined, category?: string | null): DisplayConfig {
  const p = (pair || '').toUpperCase();
  const isJpy = p.includes('JPY');
  const isGold = p.includes('XAU');
  const isSilver = p.includes('XAG');

  const cat = (category || '').toLowerCase();
  if (cat && cat !== 'other') {
    if (cat.startsWith('stock') || cat.startsWith('etf')) return { pipValue: 0.01, decimals: 2, step: 0.01 };
    if (cat.startsWith('cryp')) return { pipValue: 1, decimals: 2, step: 0.01 };
    if (cat.startsWith('ind')) return { pipValue: 1, decimals: 2, step: 0.01 };
    if (cat.startsWith('comm')) {
      if (isGold) return { pipValue: 0.1, decimals: 2, step: 0.01 };
      if (isSilver) return { pipValue: 0.01, decimals: 4, step: 0.0001 };
      return { pipValue: 0.01, decimals: 2, step: 0.01 };
    }
    if (cat.startsWith('forex') || cat.startsWith('fx')) {
      return isJpy ? { pipValue: 0.01, decimals: 3, step: 0.001 } : { pipValue: 0.0001, decimals: 5, step: 0.00001 };
    }
  }

  // Fallback: legacy substring guessing (unchanged behavior when category absent).
  const isCrypto = p.includes('BTC') || p.includes('ETH') || p.includes('XRP');
  const isIndex = p.includes('US30') || p.includes('DJ30') || p.includes('SPX') ||
    p.includes('NAS') || p.includes('DAX') || p.includes('FTSE') ||
    p.includes('AU200') || p.includes('EU50') || p.includes('JP225') ||
    p.includes('UK100') || p.includes('US500') || p.includes('US100');
  const pipValue = isIndex ? 1 : (isCrypto ? 1 : (isGold ? 0.1 : (isSilver ? 0.01 : (isJpy ? 0.01 : 0.0001))));
  const decimals = isIndex ? 2 : (isCrypto ? 2 : (isGold ? 2 : (isSilver ? 4 : (isJpy ? 3 : 5))));
  const step = isIndex ? 0.01 : (isCrypto ? 0.01 : (isGold ? 0.01 : (isSilver ? 0.0001 : (isJpy ? 0.001 : 0.00001))));
  return { pipValue, decimals, step };
}

// Get contract specification for a symbol
export function getContractSpec(symbol: string): ContractSpec {
  const upperSymbol = symbol.toUpperCase();
  const normalizedSymbol = upperSymbol.includes('/') ? upperSymbol : upperSymbol;
  
  // ============= GOLD (XAU/USD) =============
  // Standard: 1 lot = 100 troy ounces
  if (normalizedSymbol.includes('XAU')) {
    return {
      type: 'commodity',
      lotSize: 100,           // 100 oz per lot
      tickSize: 0.01,         // $0.01 per oz
      tickValue: 1,           // 100 oz * $0.01 = $1 per tick
      description: '1 lot = 100 troy ounces'
    };
  }
  
  // ============= SILVER (XAG/USD) =============
  // Standard: 1 lot = 5,000 troy ounces
  if (normalizedSymbol.includes('XAG')) {
    return {
      type: 'commodity',
      lotSize: 5000,          // 5,000 oz per lot
      tickSize: 0.001,        // $0.001 per oz
      tickValue: 5,           // 5000 oz * $0.001 = $5 per tick
      description: '1 lot = 5,000 troy ounces'
    };
  }
  
  // ============= OIL (WTI, BRENT) =============
  // Standard: 1 lot = 1,000 barrels
  if (normalizedSymbol.includes('WTICO') || normalizedSymbol.includes('BCO') || normalizedSymbol.includes('WTI')) {
    return {
      type: 'commodity',
      lotSize: 1000,          // 1,000 barrels per lot
      tickSize: 0.01,         // $0.01 per barrel
      tickValue: 10,          // 1000 * $0.01 = $10 per tick
      description: '1 lot = 1,000 barrels'
    };
  }
  
  // ============= NATURAL GAS =============
  // Standard: 1 lot = 10,000 MMBtu
  if (normalizedSymbol.includes('NATGAS')) {
    return {
      type: 'commodity',
      lotSize: 10000,
      tickSize: 0.001,
      tickValue: 10,
      description: '1 lot = 10,000 MMBtu'
    };
  }
  
  // ============= OTHER COMMODITIES (PLATINUM, PALLADIUM, COPPER) =============
  if (normalizedSymbol.includes('XPT') || normalizedSymbol.includes('XPD')) {
    return {
      type: 'commodity',
      lotSize: 100,           // 100 oz
      tickSize: 0.01,
      tickValue: 1,
      description: '1 lot = 100 troy ounces'
    };
  }
  
  if (normalizedSymbol.includes('XCU') || normalizedSymbol.includes('COPPER')) {
    return {
      type: 'commodity',
      lotSize: 25000,         // 25,000 lbs
      tickSize: 0.0001,
      tickValue: 2.5,
      description: '1 lot = 25,000 lbs'
    };
  }
  
  // ============= AGRICULTURE =============
  if (normalizedSymbol.includes('CORN') || normalizedSymbol.includes('WHEAT') || 
      normalizedSymbol.includes('SOYBN') || normalizedSymbol.includes('SUGAR')) {
    return {
      type: 'commodity',
      lotSize: 1000,
      tickSize: 0.01,
      tickValue: 10,
      description: '1 lot = 1,000 units'
    };
  }
  
  // ============= INDICES =============
  // Standard: 1 lot = $1 per point (varies by index, using common CFD spec)
  if (allIndexSymbols.some(s => normalizedSymbol.includes(s.replace('/', '')) || s.includes(normalizedSymbol.replace('/', '')))) {
    return {
      type: 'index',
      lotSize: 1,             // 1 contract
      tickSize: 0.1,
      tickValue: 0.1,         // $1 per point per lot for most CFD indices
      description: '1 lot = 1 contract ($1/point)'
    };
  }
  
  // ============= CRYPTO =============
  // 1 lot = 1 unit of crypto
  if (allCryptoSymbols.some(s => normalizedSymbol.includes(s.replace('/', '')))) {
    return {
      type: 'crypto',
      lotSize: 1,             // 1 BTC, 1 ETH, etc.
      tickSize: 0.01,
      tickValue: 0.01,
      description: '1 lot = 1 coin/token'
    };
  }
  
  // ============= STOCKS & ETFs =============
  // 1 lot = 1 share
  if (allStockSymbols.includes(normalizedSymbol) || allETFSymbols.includes(normalizedSymbol) ||
      allStockSymbols.includes(symbol) || allETFSymbols.includes(symbol)) {
    return {
      type: 'stock',
      lotSize: 1,             // 1 share per lot
      tickSize: 0.01,
      tickValue: 0.01,
      description: '1 lot = 1 share'
    };
  }
  
  // ============= FOREX (DEFAULT) =============
  // Standard: 1 lot = 100,000 units of base currency
  return {
    type: 'forex',
    lotSize: 100000,          // 100,000 units
    tickSize: 0.00001,        // 1 pipette for most pairs
    tickValue: 10,            // Approx $10 per pip per lot for XXX/USD
    description: '1 lot = 100,000 units'
  };
}

// Calculate position size in USD
export function calculatePositionSize(symbol: string, lotSize: number, currentPrice: number): number {
  const spec = getContractSpec(symbol);
  
  switch (spec.type) {
    case 'forex':
      // Position = lots * 100,000 * price (for XXX/USD pairs)
      // For USD/XXX pairs, it's lots * 100,000
      return lotSize * spec.lotSize * currentPrice;
      
    case 'commodity':
      // Gold: lots * 100 oz * gold price
      // Oil: lots * 1000 barrels * oil price
      return lotSize * spec.lotSize * currentPrice;
      
    case 'crypto':
      // lots * 1 * crypto price
      return lotSize * spec.lotSize * currentPrice;
      
    case 'stock':
    case 'etf':
      // lots * 1 share * share price
      return lotSize * spec.lotSize * currentPrice;
      
    case 'index':
      // lots * 1 contract * index price
      return lotSize * spec.lotSize * currentPrice;
      
    default:
      return lotSize * spec.lotSize * currentPrice;
  }
}

// Calculate P&L for a trade
export function calculateTradePnL(
  type: 'buy' | 'sell',
  entryPrice: number,
  exitPrice: number,
  lotSize: number,
  symbol: string
): number {
  const spec = getContractSpec(symbol);
  const priceDiff = type === 'buy' 
    ? exitPrice - entryPrice 
    : entryPrice - exitPrice;
  
  switch (spec.type) {
    case 'forex': {
      // P&L = priceDiff * lots * 100,000
      const rawPnL = priceDiff * lotSize * spec.lotSize;
      
      // For JPY pairs, convert the JPY-denominated P&L to USD.
      const isJpy = symbol.toUpperCase().includes('JPY');
      if (isJpy) {
        // USD/JPY: exitPrice IS the USD/JPY rate, so rawPnL(JPY)/exitPrice = USD. Correct.
        // XXX/JPY crosses (EUR/JPY, GBP/JPY): the correct divisor is the USD/JPY
        // rate, NOT this pair's own rate, but that quote is not available here, so
        // the cross result is an approximation in the base currency. Passing the
        // USD/JPY rate into this function is the proper fix (not yet plumbed).
        return rawPnL / exitPrice;
      }
      
      // For XXX/USD pairs, rawPnL is already in USD
      return rawPnL;
    }
    
    case 'commodity': {
      // P&L = priceDiff * lots * contract_size
      // For gold: priceDiff * lots * 100 oz
      return priceDiff * lotSize * spec.lotSize;
    }
    
    case 'crypto': {
      // P&L = priceDiff * lots * 1
      return priceDiff * lotSize * spec.lotSize;
    }
    
    case 'stock':
    case 'etf': {
      // P&L = priceDiff * lots (shares) * 1
      return priceDiff * lotSize * spec.lotSize;
    }
    
    case 'index': {
      // P&L = priceDiff * lots * multiplier
      return priceDiff * lotSize * spec.lotSize;
    }
    
    default:
      return priceDiff * lotSize * spec.lotSize;
  }
}

// Get lot size description for UI
export function getLotSizeDescription(symbol: string): string {
  const spec = getContractSpec(symbol);
  return spec.description;
}

// Get notional value description for UI
export function getNotionalValue(symbol: string, lotSize: number, currentPrice: number): string {
  const spec = getContractSpec(symbol);
  const notional = calculatePositionSize(symbol, lotSize, currentPrice);
  
  // Format the notional value
  if (notional >= 1000000) {
    return `$${(notional / 1000000).toFixed(2)}M`;
  } else if (notional >= 1000) {
    return `$${(notional / 1000).toFixed(1)}K`;
  }
  return `$${notional.toFixed(2)}`;
}
