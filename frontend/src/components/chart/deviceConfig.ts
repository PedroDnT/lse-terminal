// Single source of truth for per-device chart layout constants.
//
// Why this file exists:
//   ProChart and BTChart used to scatter `isMobile ? a : isTablet ? b : c`
//   ternaries across 38 sites each, and the headers used different breakpoints
//   from the canvas (768/1024 vs 500/1024). That meant a 600px viewport
//   rendered the mobile header but the tablet chart, and any phone-specific
//   tweak had to be hunted across ~5400 lines per chart with the risk of
//   leaking into desktop. This file fixes both problems:
//
//   1. Breakpoints (768 / 1024) are defined once and used by canvas + headers.
//      They match Tailwind's md / lg, so the headers' Tailwind classes and
//      the canvas' JS branches always agree on what device the user is on.
//   2. Every layout constant (axis widths, fonts, paddings, label counts,
//      watermark offset, toolbar geometry) lives in one of three blocks:
//      PHONE, TABLET, DESKTOP. To tune phone, edit only PHONE; desktop and
//      tablet are provably untouched.
//
// Backend logic (data hooks, indicator math, WebSocket, candle building) is
// unaffected. This file only governs visual layout.

export const BREAKPOINTS = {
  // < phone => phone, [phone, tablet) => tablet, >= tablet => desktop.
  // Matches Tailwind md (768) and lg (1024) so canvas and headers stay aligned.
  phone: 768,
  tablet: 1024,
} as const;

export type Device = 'phone' | 'tablet' | 'desktop';

export function getDevice(width: number): Device {
  if (width < BREAKPOINTS.phone) return 'phone';
  if (width < BREAKPOINTS.tablet) return 'tablet';
  return 'desktop';
}

// Per-device layout config. Each block carries the same keys so call sites can
// read `cfg.X` without runtime guards. Values below preserve the EXACT
// behavior that lived inline in ProChart/BTChart before the refactor, except
// the phone breakpoint moved from 500 to 768 (so 500..767 px viewports now
// get the phone layout, matching the phone header that was already showing
// in that range).
export interface ChartDeviceConfig {
  // Axis chrome
  timeAxisHeight: number;
  priceLabelFont: string;
  timeLabelFont: string;
  subplotLabelFont: string;

  // Grid density targets
  priceTargetLabels: number;        // desktop reads `savedGridH ?? this`
  targetLinesOnScreen: number;      // desktop reads `savedGridV ?? this`
  tertiaryGridVisible: boolean;     // phone/tablet hide the faintest grid

  // Selection badge (active drawing endpoints)
  badgeFont: string;
  badgePadding: number;
  badgeRowHeight: number;

  // Live price label / countdown
  priceLabelAlign: 'left' | 'right';
  countdownFont: string;
  countdownRowHeight: number;
  livePriceRowHeight: number;
  liveCountdownFont: string;
  livePriceLabelPadding: number;

  // Alert flag font (line 3115/3177/3207)
  alertFlagFont: string;
  alertCountFont: string;

  // Mobile time-axis labelling (phone only uses fixed-count labels)
  useFixedTimeAxisLabels: boolean;
  fixedTimeAxisLabelCount: number;       // <400 px wants 4, otherwise 5
  fixedTimeAxisLabelCountSmall: number;

  // Indicator-toolbar overlay (DOM, not canvas)
  toolbarLineHeight: number;
  toolbarStartY: number;
  toolbarRowYOffset: number;             // y - this for `top:` style

  // Watermark / chart logo position
  watermarkRightOffset: (priceAxisWidth: number) => number;

  // Y-axis free-mode reset button
  yAxisResetUsesToolbarGap: boolean;     // desktop reserves RIGHT_TOOLBAR_WIDTH

  // v.23 version label
  versionLabelVisible: boolean;
  versionLabelXOffset: number;           // shift from price-axis center
}

const PHONE: ChartDeviceConfig = {
  timeAxisHeight: 24,
  priceLabelFont: '11px -apple-system, "Trebuchet MS", Roboto, Ubuntu, sans-serif',
  timeLabelFont: '11px -apple-system, "Trebuchet MS", Roboto, Ubuntu, sans-serif',
  subplotLabelFont: '11px "SF Mono", "Cascadia Code", "Fira Code", Consolas, "Courier New", monospace',

  priceTargetLabels: 20,
  targetLinesOnScreen: 8,
  tertiaryGridVisible: false,

  badgeFont: '10px system-ui, sans-serif',
  badgePadding: 4,
  badgeRowHeight: 14,

  priceLabelAlign: 'left',
  countdownFont: '9px monospace',
  countdownRowHeight: 11,
  livePriceRowHeight: 14,
  liveCountdownFont: '9px monospace',
  livePriceLabelPadding: 4,

  alertFlagFont: '10px system-ui, sans-serif',
  alertCountFont: 'bold 9px monospace',

  useFixedTimeAxisLabels: true,
  fixedTimeAxisLabelCount: 5,
  fixedTimeAxisLabelCountSmall: 4,

  toolbarLineHeight: 14,
  toolbarStartY: 28,
  toolbarRowYOffset: 7,

  // Phone hugs the corner; the -18 desktop shift over-corrects on a narrow
  // axis and pushes v.23 into the last price label.
  watermarkRightOffset: (priceAxisWidth: number) => priceAxisWidth + 8,
  yAxisResetUsesToolbarGap: false,

  // Phone shows v.23 centered in the corner intersection. xOffset=0 (not the
  // desktop -18) because phone has no RightToolbar to dodge, and -18 on the
  // narrower phone price axis would drag the label into the last price tick.
  versionLabelVisible: true,
  versionLabelXOffset: 0,
};

const TABLET: ChartDeviceConfig = {
  timeAxisHeight: 24,
  priceLabelFont: '11px -apple-system, "Trebuchet MS", Roboto, Ubuntu, sans-serif',
  timeLabelFont: '11px -apple-system, "Trebuchet MS", Roboto, Ubuntu, sans-serif',
  subplotLabelFont: '11px "SF Mono", "Cascadia Code", "Fira Code", Consolas, "Courier New", monospace',

  priceTargetLabels: 30,
  targetLinesOnScreen: 12,
  tertiaryGridVisible: false,

  badgeFont: '10px system-ui, sans-serif',
  badgePadding: 4,
  badgeRowHeight: 14,

  priceLabelAlign: 'left',
  countdownFont: '9px monospace',
  countdownRowHeight: 11,
  livePriceRowHeight: 14,
  liveCountdownFont: '9px monospace',
  livePriceLabelPadding: 4,

  alertFlagFont: '10px system-ui, sans-serif',
  alertCountFont: 'bold 9px monospace',

  useFixedTimeAxisLabels: false,
  fixedTimeAxisLabelCount: 5,
  fixedTimeAxisLabelCountSmall: 4,

  toolbarLineHeight: 19,
  toolbarStartY: 36,
  toolbarRowYOffset: 10,

  watermarkRightOffset: (priceAxisWidth: number) => priceAxisWidth + 18,
  yAxisResetUsesToolbarGap: false,

  versionLabelVisible: true,
  versionLabelXOffset: -18,
};

const DESKTOP: ChartDeviceConfig = {
  timeAxisHeight: 28,
  priceLabelFont: '12px -apple-system, "Trebuchet MS", Roboto, Ubuntu, sans-serif',
  timeLabelFont: '12px -apple-system, "Trebuchet MS", Roboto, Ubuntu, sans-serif',
  subplotLabelFont: '12px "SF Mono", "Cascadia Code", "Fira Code", Consolas, "Courier New", monospace',

  priceTargetLabels: 45,            // call sites still apply `savedGridH ?? cfg.priceTargetLabels`
  targetLinesOnScreen: 16,          // call sites still apply `savedGridV ?? cfg.targetLinesOnScreen`
  tertiaryGridVisible: true,

  badgeFont: '11px system-ui, sans-serif',
  badgePadding: 5,
  badgeRowHeight: 18,

  priceLabelAlign: 'right',
  countdownFont: '10px monospace',
  countdownRowHeight: 14,
  livePriceRowHeight: 18,
  liveCountdownFont: '10px monospace',
  livePriceLabelPadding: 5,

  alertFlagFont: '11px system-ui, sans-serif',
  alertCountFont: 'bold 10px monospace',

  useFixedTimeAxisLabels: false,
  fixedTimeAxisLabelCount: 5,
  fixedTimeAxisLabelCountSmall: 4,

  toolbarLineHeight: 19,
  toolbarStartY: 36,
  toolbarRowYOffset: 10,

  watermarkRightOffset: (priceAxisWidth: number) => priceAxisWidth + 18,
  yAxisResetUsesToolbarGap: true,

  versionLabelVisible: true,
  versionLabelXOffset: -18,
};

const CONFIGS: Record<Device, ChartDeviceConfig> = {
  phone: PHONE,
  tablet: TABLET,
  desktop: DESKTOP,
};

export function getChartDeviceConfig(width: number): ChartDeviceConfig {
  return CONFIGS[getDevice(width)];
}

// Convenience flags for legacy call sites that branch on a single boolean.
// Prefer reading from the config block when a layout constant exists; these
// are for cases where the branch picks a *behavior*, not a value.
export function getDeviceFlags(width: number) {
  const device = getDevice(width);
  return {
    device,
    isPhone: device === 'phone',
    isTablet: device === 'tablet',
    isDesktop: device === 'desktop',
  };
}
