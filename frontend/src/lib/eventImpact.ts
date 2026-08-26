/**
 * ECONOMIC EVENT IMPACT CLASSIFICATION SYSTEM
 * Keyword heuristics derived from real calendar data
 *
 * RULE: Max ~7 HIGH impact events per day for major economies
 * Only HEADLINE figures from MAJOR economies get HIGH impact
 */

// HIGH IMPACT - Only the absolute market movers (headline figures only)
const HIGH_IMPACT_KEYWORDS: string[] = [
  // Central Bank DECISIONS only (not speeches)
  'interest rate decision',
  'rate decision',
  'policy rate decision',
  'fomc statement',
  'mpc decision',
  'ecb decision',
  'boe decision',
  'boj decision',
  
  // Employment - Headline only
  'non-farm payrolls',
  'nonfarm payrolls',
  'unemployment rate',
  
  // GDP - First release only
  'gdp growth rate',
  'gdp annualized',
  
  // ISM (US only - handled by special rules)
  'ism manufacturing pmi',
  'ism services pmi',
  'ism non-manufacturing',
];

// MEDIUM-HIGH - Important but not headline
const MEDIUM_HIGH_KEYWORDS: string[] = [
  // Inflation (will be downgraded if "core" or "ex food")
  'inflation rate',
  'cpi',
  'consumer price',
  
  // Retail (will be downgraded if YoY when MoM exists)
  'retail sales',
  
  // Employment secondary
  'employment change',
  'jobless claims',
  'claimant count',
  'adp employment',
  
  // Central bank communications
  'fomc minutes',
  'meeting minutes',
  'fed chair powell',
  'ecb president lagarde',
  
  // Major surveys
  'ifo business climate',
  'michigan consumer sentiment',
  'tankan',
  
  // Trade
  'trade balance',
  'current account',
  
  // PMI Flash
  'pmi flash',
  'flash pmi',
];

// Keywords that DOWNGRADE from high to medium
const DOWNGRADE_KEYWORDS: string[] = [
  'core',           // Core CPI -> medium
  'ex food',        // CPI Ex Food -> medium
  'ex energy',      // Ex Energy -> medium
  'excluding',      // Excluding anything -> medium
  'harmonised',     // HICP -> medium (not headline)
  'hicp',
  'preliminary',    // Preliminary -> still important but medium
  'prel',
  'final',          // Final readings -> medium
  'revised',
  'tokyo',          // Tokyo CPI -> medium (regional)
];

// MEDIUM IMPACT KEYWORDS
const MEDIUM_IMPACT_KEYWORDS: string[] = [
  'pmi',
  'purchasing manager',
  'ppi',
  'producer price',
  'industrial production',
  'housing starts',
  'building permits',
  'existing home sales',
  'new home sales',
  'durable goods',
  'factory orders',
  'capacity utilization',
  'personal income',
  'personal spending',
  'consumer confidence',
  'business confidence',
  'zew',
  'gfk consumer',
  'jolts',
  'job openings',
  'wage growth',
  'average hourly earnings',
  'import price',
  'export price',
  'leading index',
  'empire state',
  'philadelphia fed',
  'philly fed',
  'beige book',
];

// German state names - regional CPI should be LOW impact
const GERMAN_STATES = [
  'bavaria', 'baden', 'württemberg', 'berlin', 'brandenburg', 'bremen',
  'hamburg', 'hesse', 'mecklenburg', 'lower saxony', 'north rhine',
  'rhineland', 'saarland', 'saxony', 'schleswig', 'thuringia',
  'westphalia', 'vorpommern', 'palatinate', 'anhalt'
];

// MAJOR ECONOMIES - Only these can have HIGH impact events
const MAJOR_ECONOMIES = [
  'US', 'GB', 'DE', 'FR', 'IT', 'CA', 'JP',  // G7
  'EA', 'EU',                                  // Euro Area
  'CN',                                        // China
  'AU', 'NZ',                                  // Oceania majors
  'CH',                                        // Switzerland
  'BR', 'IN', 'ID', 'MX', 'RU',               // Major emerging markets
  'SA', 'SG', 'ZA', 'KR', 'ES', 'TR', 'AR',   // G20 + important economies
];

// Special rules for specific country+event combinations
interface SpecialRule {
  country: string;
  keywords: string[];
  impact: 'high' | 'medium' | 'low';
}

const SPECIAL_RULES: SpecialRule[] = [
  // Auctions are ALWAYS low
  { country: '*', keywords: ['auction'], impact: 'low' },
  
  // US-specific high impact events
  { country: 'US', keywords: ['non-farm payrolls', 'nonfarm payrolls'], impact: 'high' },
  { country: 'US', keywords: ['ism manufacturing pmi'], impact: 'high' },
  { country: 'US', keywords: ['ism services pmi'], impact: 'high' },
  { country: 'US', keywords: ['initial jobless claims', 'jobless claims'], impact: 'high' },
  { country: 'US', keywords: ['retail sales mom', 'retail sales'], impact: 'high' },
  { country: 'US', keywords: ['cpi', 'inflation rate'], impact: 'high' },
  { country: 'US', keywords: ['ppi'], impact: 'high' },
  { country: 'US', keywords: ['gdp'], impact: 'high' },
  { country: 'US', keywords: ['pce price', 'core pce'], impact: 'high' },
  { country: 'US', keywords: ['michigan consumer'], impact: 'high' },
  
  // GB-specific high impact events  
  { country: 'GB', keywords: ['trade balance', 'goods trade'], impact: 'high' },
  { country: 'GB', keywords: ['cpi', 'inflation rate'], impact: 'high' },
  { country: 'GB', keywords: ['gdp'], impact: 'high' },
  { country: 'GB', keywords: ['retail sales'], impact: 'high' },
  { country: 'GB', keywords: ['claimant count', 'unemployment'], impact: 'high' },
  
  // Central bank decisions
  { country: 'US', keywords: ['fomc', 'fed funds'], impact: 'high' },
  { country: 'EA', keywords: ['ecb interest rate', 'ecb decision'], impact: 'high' },
  { country: 'EU', keywords: ['ecb interest rate', 'ecb decision'], impact: 'high' },
  { country: 'GB', keywords: ['boe interest rate', 'mpc decision'], impact: 'high' },
  { country: 'JP', keywords: ['boj interest rate', 'boj decision'], impact: 'high' },
];

type ImpactLevel = 'high' | 'medium' | 'low';

interface CalendarEvent {
  event: string;
  country?: string;
  importance?: string;
}

export function getEventImpact(event: CalendarEvent): ImpactLevel {
  const eventName = (event.event || '').toLowerCase();
  const country = (event.country || '').toUpperCase();
  
  // 1. Trust source importance if available
  if (event.importance) {
    const imp = event.importance.toLowerCase();
    if (imp.includes('high') || imp === '3' || imp === 'red') return 'high';
    if (imp.includes('medium') || imp.includes('med') || imp === '2' || imp === 'orange' || imp === 'yellow') return 'medium';
    if (imp.includes('low') || imp === '1' || imp === 'green') return 'low';
  }
  
  // 2. Check SPECIAL RULES first
  for (const rule of SPECIAL_RULES) {
    if (rule.country === '*' || rule.country === country) {
      for (const keyword of rule.keywords) {
        if (eventName.includes(keyword.toLowerCase())) {
          return rule.impact;
        }
      }
    }
  }
  
  // 3. Auctions always low
  if (eventName.includes('auction')) {
    return 'low';
  }
  
  // 4. German regional CPI always low
  if (eventName.includes('cpi') || eventName.includes('inflation')) {
    for (const state of GERMAN_STATES) {
      if (eventName.includes(state)) {
        return 'low';
      }
    }
  }
  
  // 5. Check if this is a major economy
  const isMajorEconomy = MAJOR_ECONOMIES.includes(country);
  
  // 6. Check for DOWNGRADE keywords - these prevent HIGH impact
  const shouldDowngrade = DOWNGRADE_KEYWORDS.some(kw => eventName.includes(kw.toLowerCase()));
  
  // 7. Check HIGH IMPACT keywords (only if no downgrade and major economy)
  if (!shouldDowngrade && isMajorEconomy) {
    for (const keyword of HIGH_IMPACT_KEYWORDS) {
      if (eventName.includes(keyword.toLowerCase())) {
        return 'high';
      }
    }
  }
  
  // 8. Check MEDIUM-HIGH keywords (can be high for major economies if not downgraded)
  for (const keyword of MEDIUM_HIGH_KEYWORDS) {
    if (eventName.includes(keyword.toLowerCase())) {
      // If downgraded or not major economy, it's medium
      if (shouldDowngrade || !isMajorEconomy) {
        return 'medium';
      }
      // Major economy headline -> high
      return 'high';
    }
  }
  
  // 9. Check MEDIUM IMPACT keywords
  for (const keyword of MEDIUM_IMPACT_KEYWORDS) {
    if (eventName.includes(keyword.toLowerCase())) {
      return 'medium';
    }
  }
  
  // 10. Default to LOW
  return 'low';
}
