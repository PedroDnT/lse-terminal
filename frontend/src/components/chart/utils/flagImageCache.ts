// ── Flag image cache ──
// Loads country flag PNGs from flagcdn.com and caches them as HTMLImageElement
// objects for drawing on canvas via ctx.drawImage(). This avoids the emoji
// flag problem (only macOS renders flag emoji; Windows/Linux show "US" text).
//
// Usage:
//   const img = getFlagImage('US');
//   if (img) ctx.drawImage(img, x, y, width, height);

const flagCache = new Map<string, HTMLImageElement>();
const failedFlags = new Set<string>();

// Map region codes to ISO 3166-1 alpha-2 (lowercase) for flagcdn.com URLs
const regionToISO: Record<string, string> = {
  US: 'us', EU: 'eu', EA: 'eu', GB: 'gb', UK: 'gb', JP: 'jp', CH: 'ch',
  AU: 'au', CA: 'ca', NZ: 'nz', CN: 'cn', DE: 'de', FR: 'fr', IT: 'it',
  ES: 'es', KR: 'kr', IN: 'in', BR: 'br', MX: 'mx', ZA: 'za', SG: 'sg',
  HK: 'hk', SE: 'se', NO: 'no', DK: 'dk', PL: 'pl', TR: 'tr', RU: 'ru',
  AT: 'at', BE: 'be', FI: 'fi', GR: 'gr', IE: 'ie', NL: 'nl', PT: 'pt',
  TH: 'th', TW: 'tw', ID: 'id', MY: 'my', PH: 'ph', VN: 'vn', CL: 'cl',
  CO: 'co', PE: 'pe', AR: 'ar', EG: 'eg', NG: 'ng', KE: 'ke', IL: 'il',
  SA: 'sa', AE: 'ae', QA: 'qa', KW: 'kw', CZ: 'cz', HU: 'hu', RO: 'ro',
};

// For long country name fallbacks
const nameToISO: Record<string, string> = {
  'UNITED STATES': 'us', 'USA': 'us', 'EUROZONE': 'eu', 'EURO ZONE': 'eu',
  'UNITED KINGDOM': 'gb', 'JAPAN': 'jp', 'CANADA': 'ca', 'AUSTRALIA': 'au',
  'SWITZERLAND': 'ch', 'NEW ZEALAND': 'nz', 'CHINA': 'cn', 'GERMANY': 'de',
  'FRANCE': 'fr', 'ITALY': 'it', 'SPAIN': 'es', 'SOUTH KOREA': 'kr',
  'INDIA': 'in', 'BRAZIL': 'br', 'MEXICO': 'mx', 'SOUTH AFRICA': 'za',
};

/**
 * Resolve a region_code (e.g. "US", "GB", "Euro Zone") to an ISO code for flagcdn.
 */
function resolveISO(regionCode: string | null | undefined): string | null {
  if (!regionCode) return null;
  const upper = regionCode.toUpperCase().trim();

  // Direct lookup
  if (regionToISO[upper]) return regionToISO[upper];

  // Try name-based lookup
  for (const [name, iso] of Object.entries(nameToISO)) {
    if (upper.includes(name)) return iso;
  }

  // Fallback: if it's a 2-letter code, try directly (lowercase)
  if (upper.length === 2) return upper.toLowerCase();

  return null;
}

/**
 * Get a cached flag Image for the given region code.
 * Returns the Image if loaded, or null if still loading / failed.
 * Automatically triggers loading on first request.
 */
export function getFlagImage(regionCode: string | null | undefined): HTMLImageElement | null {
  const iso = resolveISO(regionCode);
  if (!iso) return null;

  // Already cached
  if (flagCache.has(iso)) return flagCache.get(iso)!;

  // Already failed; don't retry
  if (failedFlags.has(iso)) return null;

  // Start loading
  const img = new Image();
  img.crossOrigin = 'anonymous';
  // Self-hosted flag PNGs in /flags/; no external CDN dependency
  img.src = `/flags/${iso}.png`;

  img.onload = () => {
    flagCache.set(iso, img);
  };
  img.onerror = () => {
    failedFlags.add(iso);
  };

  return null; // Not ready yet; will be available on next render frame
}

/**
 * Pre-load flags for a list of region codes.
 * Call this once when economic events arrive so flags are ready before first render.
 */
export function preloadFlags(regionCodes: (string | null | undefined)[]): void {
  const unique = new Set(regionCodes.filter(Boolean));
  for (const code of unique) {
    getFlagImage(code);
  }
}
