// ============================================================================
// Notebooks.tsx - WORKSPACE > NOTEBOOKS.
//
// An infinite canvas per notebook: text, maths, images, freehand ink and
// shapes placed anywhere, panned and zoomed without bound. Deliberately NOT a
// cell notebook. A cell list decides the order of your thinking for you;
// research notes are spatial (this chart next to that derivation, an arrow
// between them), so this is a blank canvas people can write on and drop
// photos into.
//
// Coordinates: every block is stored in WORLD space and never in screen space,
// so the same document renders identically at any zoom, on any window size, on
// any machine it is copied to. The scene div carries one CSS transform
// (translate then scale) and blocks are absolutely positioned inside it, which
// keeps text as real DOM text (selectable, spell-checkable, accessible) rather
// than glyphs painted into a canvas element.
//
// Persistence is the engine's notebooks store (~/.config/lse-terminal/
// notebooks/), autosaved on a debounce. Images are uploaded once and referred
// to by URL, so a canvas document stays small no matter how many photos it
// holds. Styling fields (color, bg, mode, shapes) are all optional on the
// wire, so documents written by older builds load unchanged and documents
// written here degrade to defaults on older builds; the engine never
// interprets blocks, so none of this needed a migration.
//
// The canvas also reports itself to the AI: a live summary of the open
// notebook (blocks, text in reading order, images, the armed tool) is
// published on window.__lseAiIslands.notebooks, which the shell's universal
// screen map (AI_REGIONS in app.js) serves to the hosted assistant and the
// CLI agents alike. Without it the assistant was blind on this page.
// ============================================================================

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import katex from 'katex';
import 'katex/dist/katex.min.css';

// ---------------------------------------------------------------------------
// Document model
// ---------------------------------------------------------------------------

type BlockBase = { id: string; x: number; y: number; w: number; h: number };
type TextBlock = BlockBase & { type: 'text'; text: string; size: number;
                               color?: string; bg?: string;
                               // Code: monospaced, no KaTeX pass, tinted card.
                               // One flag rather than a block type of its own,
                               // so a note becomes a snippet (and back) with a
                               // click and no conversion.
                               mono?: boolean;
                               bold?: boolean; italic?: boolean;
                               align?: 'left' | 'center' | 'right' };
type MathBlock = BlockBase & { type: 'math'; latex: string; size: number;
                               color?: string; bg?: string };
type ImageBlock = BlockBase & { type: 'image'; src: string; name?: string;
                                // Mirrors, optional on the wire like every
                                // styling field: older documents load
                                // unchanged, older builds ignore them.
                                flipH?: boolean; flipV?: boolean };
type InkBlock = BlockBase & { type: 'ink'; points: number[][]; color: string;
                              width: number; mode?: 'pen' | 'highlighter' };
type ShapeKind = 'line' | 'arrow' | 'rect' | 'ellipse' | 'triangle'
               | 'diamond' | 'star';
type ShapeBlock = BlockBase & { type: 'shape';
                                shape: ShapeKind;
                                // Endpoints in the block's own coordinates,
                                // against the ow/oh box the shape was drawn
                                // in; resizing the block stretches that box,
                                // so a shape scales exactly like a photo.
                                x1: number; y1: number; x2: number; y2: number;
                                ow: number; oh: number;
                                color?: string; width?: number; dash?: boolean;
                                fill?: string };
type Block = TextBlock | MathBlock | ImageBlock | InkBlock | ShapeBlock;

type View = { x: number; y: number; zoom: number };
// The canvas surface itself. `paper` is a CSS colour ('' or absent = follow the
// app theme) and `pattern` is what is ruled on it. Both live on the DOCUMENT,
// not in localStorage: a notebook's paper is part of the notebook, so it
// travels with the file when it is copied or backed up. Optional on the wire
// like every styling field, so older documents load unchanged.
type Paper = 'dots' | 'grid' | 'lines' | 'plain';
type Doc = { id: string; name: string; folder?: string; blocks: Block[]; view?: View;
             paper?: string; pattern?: Paper;
             created_at?: number; updated_at?: number };
type Meta = { id: string; name: string; folder: string; blocks: number;
              updated_at: number; created_at: number };

type Tool = 'select' | 'hand' | 'text' | 'sticky' | 'code' | 'math' | 'pen'
          | 'highlighter' | 'eraser' | 'image' | ShapeKind;

// Zoom range. 0.02 to 12, not 0.1 to 6: a research canvas grows until the
// whole of it is a postage stamp, and the old floor stopped well before "show
// me everything" on a big one. Nothing here costs anything
// at wide zoom, because blocks are absolutely positioned and the browser skips
// what is off screen.
// 0.001 = 0.1%: real canvases outgrew the 2% floor the same day it shipped;
// big documents need to go much farther out.
// Blocks are absolutely positioned and off-screen ones are
// skipped by the browser, so a wide view costs nothing; the only work at this
// depth was cosmetic (the % label and the marquee border needed to stop
// assuming zoom stays above 1%).
const MIN_ZOOM = 0.001;
const MAX_ZOOM = 12;
// The smallest a block can be dragged or scaled to, in world units. Was 40x30,
// which is a stamp on screen at 100% but a wall at 10%; pictures should shrink
// as small as the user likes. 6 keeps a block findable by its handles (which
// stay a fixed SCREEN size at any zoom) rather than becoming a lost pixel.
const MIN_BLOCK_W = 6;
const MIN_BLOCK_H = 6;
const uid = () => Math.random().toString(36).slice(2, 10);

// The colour set for ink, shapes and text. '' means "the theme's own text
// colour" (stored as currentColor), which is why it must stay first: content
// with no colour choice follows light/dark like everything else. Two rows of
// nine, because a single muted row was the whole palette and the answer to
// "I want THIS blue" was always the custom chip.
const COLORS = ['', '#e05d5d', '#e0954a', '#cdb648', '#57a869', '#3fb0a5',
                '#4f8fd9', '#9a6fd9', '#d96fa8',
                '#8a9099', '#a33b3b', '#b06a24', '#8d7c1f', '#2f7346',
                '#1f6f68', '#2b5fa0', '#6a45a0', '#a04478'];
// Sticky-note backgrounds for text blocks: translucent so they read on both
// themes without a per-theme pair. '' = no background (plain canvas text).
const BGS = ['', 'rgba(205,182,72,.16)', 'rgba(87,168,105,.14)',
             'rgba(63,176,165,.14)', 'rgba(79,143,217,.14)',
             'rgba(154,111,217,.14)', 'rgba(217,111,168,.13)',
             'rgba(224,93,93,.13)', 'rgba(138,144,153,.15)'];
// Fills for closed shapes, same translucency logic.
const FILLS = BGS;
// Shapes with an inside. A line has no fill and no fill row.
const CLOSED_SHAPES: ShapeKind[] = ['rect', 'ellipse', 'triangle', 'diamond', 'star'];
// The text sizes the stepper walks through. 15 is the default body size.
const SIZES = [11, 12, 13, 15, 17, 20, 24, 28, 34, 40, 48, 60, 72];
// Nib widths. The old set topped out at 6, which is a fine-liner: a marker
// stroke on a wall-sized canvas needs real weight.
const PEN_WIDTHS = [1, 2, 4, 7, 12, 20];
// What a sticky note is: a text block born on a card. Yellow because that is
// what a sticky note is; every other background is one click away.
const STICKY_BG = 'rgba(205,182,72,.16)';
const CODE_BG = 'rgba(138,144,153,.15)';

// Canvas papers. '' = follow the app theme (the default this page shipped
// with). The rest are absolute colours, so a white page stays white in dark
// mode and a blackboard stays black in light mode: the point of choosing a
// paper is that it does NOT move with the theme.
const PAPERS: [string, string][] = [
  ['', 'Theme'],
  ['#ffffff', 'White'],
  ['#f7f3e8', 'Cream'],
  ['#eef1f4', 'Light grey'],
  ['#e9f2e8', 'Pale green'],
  ['#e8eff8', 'Pale blue'],
  ['#f6ebee', 'Pale pink'],
  ['#1d2b24', 'Blackboard'],
  ['#0f1116', 'Near black'],
];
const PATTERNS: [Paper, string][] = [
  ['dots', 'Dots'], ['grid', 'Grid'], ['lines', 'Ruled'], ['plain', 'Plain'],
];

/** Is this paper light enough to want dark ink on it? Perceptual weights, not
 *  a plain average: #0000ff and #ffff00 have the same mean channel and
 *  opposite answers. Anything unparseable is treated as light, which is the
 *  safe direction (dark ink on an unknown surface). */
function isLightPaper(c: string): boolean {
  let h = (c || '').trim().replace('#', '');
  if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
  if (!/^[0-9a-f]{6}$/i.test(h)) return true;
  const r = parseInt(h.slice(0, 2), 16), g = parseInt(h.slice(2, 4), 16),
        b = parseInt(h.slice(4, 6), 16);
  return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255 > 0.5;
}

// ---------------------------------------------------------------------------
// Maths
// ---------------------------------------------------------------------------

/** KaTeX to HTML, with the error kept visible instead of thrown: a half-typed
 *  formula is the NORMAL state of a block being written, so it must render as
 *  "not valid yet" and never as a blank box or a crash. */
function tex(src: string, display: boolean): { html: string; ok: boolean } {
  try {
    return { html: katex.renderToString(src, { displayMode: display, throwOnError: true,
                                               strict: false, trust: false }), ok: true };
  } catch (e) {
    return { html: '', ok: false };
  }
}

/** Text to safe HTML: the escape every render path here shares. */
const escapeHtml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;')
  .replace(/>/g, '&gt;').replace(/\n/g, '<br>');

/** Text blocks render `$...$` through KaTeX so a formula can sit inside a
 *  sentence without leaving the block. Everything outside the delimiters is
 *  escaped and kept verbatim, including newlines. */
function renderProse(src: string): string {
  const esc = escapeHtml;
  let out = '';
  let i = 0;
  while (i < src.length) {
    const open = src.indexOf('$', i);
    if (open < 0) { out += esc(src.slice(i)); break; }
    // $$...$$ is a centred display formula, $...$ an inline one.
    const dd = src.startsWith('$$', open);
    const mark = dd ? '$$' : '$';
    const close = src.indexOf(mark, open + mark.length);
    if (close < 0) { out += esc(src.slice(i)); break; }
    out += esc(src.slice(i, open));
    const body = src.slice(open + mark.length, close);
    const r = tex(body, dd);
    out += r.ok ? r.html : `<span class="nb-tex-bad">${esc(mark + body + mark)}</span>`;
    i = close + mark.length;
  }
  return out;
}

// The palette is grouped the way people reach for symbols, not the way LaTeX
// classifies them. `ins` is what gets typed into the block; `@` marks where
// the caret lands afterwards, which is what makes \frac{@}{} usable in one
// click instead of one click plus three arrow keys.
const PALETTE: { group: string; items: { lab: string; ins: string; tip?: string }[] }[] = [
  { group: 'Greek', items: [
    { lab: 'α', ins: '\\alpha ' }, { lab: 'β', ins: '\\beta ' }, { lab: 'γ', ins: '\\gamma ' },
    { lab: 'δ', ins: '\\delta ' }, { lab: 'ε', ins: '\\epsilon ' }, { lab: 'θ', ins: '\\theta ' },
    { lab: 'κ', ins: '\\kappa ' }, { lab: 'λ', ins: '\\lambda ' }, { lab: 'μ', ins: '\\mu ' },
    { lab: 'ν', ins: '\\nu ' }, { lab: 'ξ', ins: '\\xi ' }, { lab: 'π', ins: '\\pi ' },
    { lab: 'ρ', ins: '\\rho ' }, { lab: 'σ', ins: '\\sigma ' }, { lab: 'τ', ins: '\\tau ' },
    { lab: 'φ', ins: '\\phi ' }, { lab: 'χ', ins: '\\chi ' }, { lab: 'ψ', ins: '\\psi ' },
    { lab: 'ω', ins: '\\omega ' }, { lab: 'Γ', ins: '\\Gamma ' }, { lab: 'Δ', ins: '\\Delta ' },
    { lab: 'Θ', ins: '\\Theta ' }, { lab: 'Λ', ins: '\\Lambda ' }, { lab: 'Σ', ins: '\\Sigma ' },
    { lab: 'Φ', ins: '\\Phi ' }, { lab: 'Ω', ins: '\\Omega ' },
  ] },
  { group: 'Structure', items: [
    { lab: 'x²', ins: '^{@}', tip: 'superscript' },
    { lab: 'xₜ', ins: '_{@}', tip: 'subscript' },
    { lab: 'a⁄b', ins: '\\frac{@}{}', tip: 'fraction' },
    { lab: '√', ins: '\\sqrt{@}' },
    { lab: 'ⁿ√', ins: '\\sqrt[@]{}', tip: 'nth root' },
    { lab: '( )', ins: '\\left(@\\right)', tip: 'sized brackets' },
    { lab: '[ ]', ins: '\\left[@\\right]' },
    { lab: '{ }', ins: '\\left\\{@\\right\\}' },
    { lab: '| |', ins: '\\left|@\\right|', tip: 'absolute value' },
    { lab: '‖ ‖', ins: '\\left\\|@\\right\\|', tip: 'norm' },
    { lab: 'x̂', ins: '\\hat{@}' }, { lab: 'x̄', ins: '\\bar{@}' },
    { lab: 'x̃', ins: '\\tilde{@}' }, { lab: 'ẋ', ins: '\\dot{@}' },
    { lab: 'x⃗', ins: '\\vec{@}' },
    { lab: '[ᵃᵇ]', ins: '\\begin{bmatrix} @ & \\\\ & \\end{bmatrix}', tip: 'matrix' },
    { lab: 'cases', ins: '\\begin{cases} @ & \\text{if } \\\\ & \\text{else} \\end{cases}' },
  ] },
  { group: 'Calculus', items: [
    { lab: '∑', ins: '\\sum_{@}^{}' }, { lab: '∏', ins: '\\prod_{@}^{}' },
    { lab: '∫', ins: '\\int_{@}^{}' }, { lab: '∬', ins: '\\iint_{@}' },
    { lab: '∮', ins: '\\oint_{@}' }, { lab: '∂', ins: '\\partial ' },
    { lab: '∂/∂x', ins: '\\frac{\\partial @}{\\partial }' },
    { lab: 'd/dx', ins: '\\frac{d@}{d}' },
    { lab: '∇', ins: '\\nabla ' }, { lab: 'lim', ins: '\\lim_{@ \\to }' },
    { lab: '∞', ins: '\\infty ' }, { lab: 'dx', ins: '\\,d@' },
  ] },
  { group: 'Relations', items: [
    { lab: '=', ins: '= ' }, { lab: '≠', ins: '\\neq ' }, { lab: '≈', ins: '\\approx ' },
    { lab: '≡', ins: '\\equiv ' }, { lab: '∝', ins: '\\propto ' }, { lab: '≤', ins: '\\leq ' },
    { lab: '≥', ins: '\\geq ' }, { lab: '≪', ins: '\\ll ' }, { lab: '≫', ins: '\\gg ' },
    { lab: '∼', ins: '\\sim ' }, { lab: '±', ins: '\\pm ' }, { lab: '×', ins: '\\times ' },
    { lab: '·', ins: '\\cdot ' }, { lab: '÷', ins: '\\div ' },
  ] },
  { group: 'Sets & logic', items: [
    { lab: '∈', ins: '\\in ' }, { lab: '∉', ins: '\\notin ' }, { lab: '⊂', ins: '\\subset ' },
    { lab: '⊆', ins: '\\subseteq ' }, { lab: '∪', ins: '\\cup ' }, { lab: '∩', ins: '\\cap ' },
    { lab: '∅', ins: '\\emptyset ' }, { lab: '∀', ins: '\\forall ' }, { lab: '∃', ins: '\\exists ' },
    { lab: '¬', ins: '\\neg ' }, { lab: '∧', ins: '\\land ' }, { lab: '∨', ins: '\\lor ' },
    { lab: 'ℝ', ins: '\\mathbb{R}' }, { lab: 'ℕ', ins: '\\mathbb{N}' },
    { lab: 'ℤ', ins: '\\mathbb{Z}' }, { lab: 'ℙ', ins: '\\mathbb{P}' },
  ] },
  { group: 'Arrows', items: [
    { lab: '→', ins: '\\to ' }, { lab: '←', ins: '\\leftarrow ' },
    { lab: '⇒', ins: '\\Rightarrow ' }, { lab: '⇔', ins: '\\iff ' },
    { lab: '↦', ins: '\\mapsto ' }, { lab: '↑', ins: '\\uparrow ' },
    { lab: '↓', ins: '\\downarrow ' }, { lab: '⟶', ins: '\\longrightarrow ' },
  ] },
  // The reason this page exists: the notation a quant actually writes down.
  { group: 'Finance', items: [
    { lab: '𝔼[·]', ins: '\\mathbb{E}\\left[@\\right]', tip: 'expectation' },
    { lab: 'Var', ins: '\\mathrm{Var}\\left(@\\right)' },
    { lab: 'Cov', ins: '\\mathrm{Cov}\\left(@, \\right)' },
    { lab: 'ℚ', ins: '\\mathbb{Q}', tip: 'risk-neutral measure' },
    { lab: 'dS', ins: 'dS_t = \\mu S_t\\,dt + \\sigma S_t\\,dW_t', tip: 'GBM' },
    { lab: 'dW', ins: 'dW_t' }, { lab: 'σ²', ins: '\\sigma^2' },
    { lab: 'N(d₁)', ins: 'N(d_1)' }, { lab: '~N', ins: '\\sim N(@, )' },
    { lab: 'Σ̂', ins: '\\hat{\\Sigma}' }, { lab: 'argmax', ins: '\\operatorname*{argmax}_{@}' },
    { lab: 'argmin', ins: '\\operatorname*{argmin}_{@}' },
    { lab: 'e^x', ins: 'e^{@}' }, { lab: 'ln', ins: '\\ln @' }, { lab: 'log', ins: '\\log @' },
    { lab: 'text', ins: '\\text{@}', tip: 'words inside maths' },
  ] },
];

// ---------------------------------------------------------------------------
// Geometry helpers
// ---------------------------------------------------------------------------

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

/** Screen point to world point under the current view. */
const toWorld = (v: View, sx: number, sy: number) => ({
  x: (sx - v.x) / v.zoom, y: (sy - v.y) / v.zoom,
});

function inkBounds(pts: number[][]) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const [x, y] of pts) {
    if (x < x0) x0 = x; if (x > x1) x1 = x;
    if (y < y0) y0 = y; if (y > y1) y1 = y;
  }
  return { x0, y0, x1, y1 };
}

/** A stroke as a smooth SVG path: midpoint quadratics, which is what stops a
 *  hand-drawn arrow from looking like a polyline of mouse samples. */
function inkPath(pts: number[][]): string {
  if (pts.length < 2) {
    const [x, y] = pts[0] || [0, 0];
    return `M ${x} ${y} l 0.1 0`;
  }
  let d = `M ${pts[0][0]} ${pts[0][1]}`;
  for (let i = 1; i < pts.length - 1; i++) {
    const [x, y] = pts[i];
    const [nx, ny] = pts[i + 1];
    d += ` Q ${x} ${y} ${(x + nx) / 2} ${(y + ny) / 2}`;
  }
  const last = pts[pts.length - 1];
  d += ` L ${last[0]} ${last[1]}`;
  return d;
}

/** Arrowhead as a path at the (x2,y2) tip: two strokes back along the shaft's
 *  angle. Drawn as geometry rather than an SVG marker because markers need a
 *  document-unique <defs> id per colour, and every block already carries its
 *  own <svg>. */
function arrowHead(x1: number, y1: number, x2: number, y2: number, len: number): string {
  const a = Math.atan2(y2 - y1, x2 - x1);
  const l = a - Math.PI * 0.82;
  const r = a + Math.PI * 0.82;
  return `M ${x2 + Math.cos(l) * len} ${y2 + Math.sin(l) * len} L ${x2} ${y2} `
       + `L ${x2 + Math.cos(r) * len} ${y2 + Math.sin(r) * len}`;
}

const ago = (t: number) => {
  if (!t) return '';
  const s = Math.max(0, Date.now() / 1000 - t);
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
};

// ---------------------------------------------------------------------------
// Ink-to-maths: a $P point-cloud recognizer (Vatavu, Anthony & Wobbrock 2012)
// over hand-authored templates for the symbols quant notes actually use.
// Everything is local: no service, no model download, works offline like the
// rest of the app. Calibrated in scratch (ink_calib): 94.9% top-1
// over 43 symbols under heavy synthetic distortion (±12° rotation, 0.75-1.3
// per-axis scale, point noise, reversed strokes), sigma-with-superscript-2
// assembling 27/30. Templates are drawn the way people WRITE the glyph, not
// the way it is typeset. Coordinates y-down in a 100x100 box.
// ---------------------------------------------------------------------------

type CloudPt = { x: number; y: number; id: number };

const pcSeg = (x1: number, y1: number, x2: number, y2: number, n = 14): number[][] =>
  Array.from({ length: n }, (_, i) => [x1 + (x2 - x1) * i / (n - 1), y1 + (y2 - y1) * i / (n - 1)]);
// y-down: a=-PI/2 is the TOP of the circle; increasing angle moves clockwise
// on screen. a0 -> a1 is interpolated linearly, either direction.
const pcArc = (cx: number, cy: number, rx: number, ry: number, a0: number, a1: number, n = 18): number[][] =>
  Array.from({ length: n }, (_, i) => {
    const a = a0 + (a1 - a0) * i / (n - 1);
    return [cx + rx * Math.cos(a), cy + ry * Math.sin(a)];
  });
const PIx = Math.PI;

const INK_TEMPLATES: { name: string; latex: string; strokes: number[][][] }[] = [
  // digits
  { name: '0', latex: '0', strokes: [pcArc(50, 50, 22, 40, -PIx / 2, 1.5 * PIx, 22)] },
  { name: '1', latex: '1', strokes: [pcSeg(50, 10, 50, 90)] },
  { name: '2', latex: '2', strokes: [[...pcArc(48, 32, 21, 19, -PIx, 0.35, 14), ...pcSeg(65, 44, 28, 84, 10), ...pcSeg(28, 84, 72, 84, 8)]] },
  { name: '3', latex: '3', strokes: [[...pcArc(46, 31, 19, 16, -0.85 * PIx, 0.5 * PIx, 12), ...pcArc(46, 66, 21, 19, -0.5 * PIx, 0.85 * PIx, 12)]] },
  { name: '4', latex: '4', strokes: [[...pcSeg(55, 12, 25, 60, 10), ...pcSeg(25, 60, 78, 60, 8)], pcSeg(62, 25, 62, 90, 10)] },
  { name: '5', latex: '5', strokes: [[...pcSeg(70, 12, 32, 12, 7), ...pcSeg(32, 12, 30, 46, 7), ...pcArc(46, 63, 22, 21, -0.55 * PIx, 0.8 * PIx, 14)]] },
  { name: '6', latex: '6', strokes: [[...pcArc(58, 40, 26, 30, -0.35 * PIx, -1.1 * PIx, 12), ...pcArc(48, 68, 19, 19, -PIx, PIx, 18)]] },
  { name: '7', latex: '7', strokes: [[...pcSeg(28, 14, 74, 14, 8), ...pcSeg(74, 14, 42, 88, 12)]] },
  { name: '8', latex: '8', strokes: [[...pcArc(50, 31, 17, 17, -PIx / 2, 1.5 * PIx, 14), ...pcArc(50, 69, 21, 21, -PIx / 2, 1.5 * PIx, 16)]] },
  { name: '9', latex: '9', strokes: [[...pcArc(47, 34, 19, 20, -PIx / 2, 1.5 * PIx, 16), ...pcSeg(66, 38, 60, 88, 8)]] },
  // operators
  { name: 'plus', latex: '+', strokes: [pcSeg(50, 25, 50, 75), pcSeg(25, 50, 75, 50)] },
  { name: 'minus', latex: '-', strokes: [pcSeg(25, 50, 75, 50)] },
  { name: 'equals', latex: '=', strokes: [pcSeg(25, 40, 75, 40), pcSeg(25, 62, 75, 62)] },
  { name: 'pm', latex: '\\pm', strokes: [pcSeg(50, 18, 50, 62), pcSeg(28, 40, 72, 40), pcSeg(25, 80, 75, 80)] },
  { name: 'arrow', latex: '\\to', strokes: [pcSeg(18, 50, 82, 50), [...pcSeg(60, 30, 82, 50, 8), ...pcSeg(82, 50, 60, 70, 8)]] },
  { name: 'lt', latex: '<', strokes: [[...pcSeg(70, 24, 30, 50, 9), ...pcSeg(30, 50, 70, 76, 9)]] },
  { name: 'gt', latex: '>', strokes: [[...pcSeg(30, 24, 70, 50, 9), ...pcSeg(70, 50, 30, 76, 9)]] },
  { name: 'sqrt', latex: '\\sqrt{}', strokes: [[...pcSeg(18, 56, 32, 84, 7), ...pcSeg(32, 84, 50, 14, 10), ...pcSeg(50, 14, 86, 14, 10)]] },
  { name: 'int', latex: '\\int', strokes: [[...pcArc(62, 20, 12, 11, -0.5 * PIx, -1.0 * PIx, 8), ...pcSeg(50, 20, 50, 80, 12), ...pcArc(38, 80, 12, 11, 0, 0.5 * PIx, 8)]] },
  { name: 'partial', latex: '\\partial', strokes: [[...pcArc(46, 26, 18, 14, -1.2 * PIx, 0.05 * PIx, 12), ...pcSeg(63, 30, 66, 46, 4), ...pcArc(48, 66, 19, 20, -0.25 * PIx, 1.62 * PIx, 16)]] },
  { name: 'infty', latex: '\\infty', strokes: [[...pcArc(35, 50, 14, 16, 0, 2 * PIx, 14), ...pcArc(65, 50, 14, 16, PIx, 3 * PIx, 14)]] },
  // Greek, lower
  { name: 'alpha', latex: '\\alpha', strokes: [[...pcSeg(78, 30, 62, 42, 6), ...pcArc(44, 54, 20, 22, -0.3 * PIx, 1.35 * PIx, 16), ...pcSeg(60, 64, 80, 76, 6)]] },
  { name: 'beta', latex: '\\beta', strokes: [[...pcSeg(30, 92, 32, 20, 12), ...pcArc(45, 32, 15, 13, -0.9 * PIx, 0.5 * PIx, 10), ...pcArc(49, 62, 19, 17, -0.6 * PIx, 0.75 * PIx, 12)]] },
  { name: 'delta', latex: '\\delta', strokes: [[...pcSeg(63, 12, 47, 20, 5), ...pcArc(50, 62, 19, 22, -0.55 * PIx, 1.45 * PIx, 16)]] },
  { name: 'epsilon', latex: '\\epsilon', strokes: [[...pcArc(54, 31, 19, 16, 1.85 * PIx, 0.5 * PIx, 12), ...pcArc(54, 66, 21, 19, 1.5 * PIx, 0.85 * PIx + 0.3, 12)]] },
  { name: 'theta', latex: '\\theta', strokes: [pcArc(50, 50, 21, 35, -PIx / 2, 1.5 * PIx, 20), pcSeg(32, 50, 68, 50, 8)] },
  { name: 'lambda', latex: '\\lambda', strokes: [pcSeg(26, 14, 68, 88, 14), pcSeg(46, 50, 26, 88, 9)] },
  { name: 'mu', latex: '\\mu', strokes: [pcSeg(27, 28, 27, 92, 12), [...pcArc(45, 48, 18, 22, PIx, 0, 12), ...pcSeg(63, 48, 64, 70, 6), ...pcSeg(64, 70, 80, 58, 7)]] },
  { name: 'pi', latex: '\\pi', strokes: [pcSeg(20, 32, 80, 32, 10), pcSeg(36, 32, 32, 80, 8), pcSeg(64, 32, 67, 80, 8)] },
  { name: 'rho', latex: '\\rho', strokes: [[...pcSeg(33, 92, 34, 42, 9), ...pcArc(48, 42, 15, 17, -PIx, PIx, 14)]] },
  { name: 'sigma', latex: '\\sigma', strokes: [[...pcSeg(82, 26, 56, 32, 10), ...pcArc(44, 58, 21, 24, -0.42 * PIx, 1.58 * PIx, 18)]] },
  { name: 'tau', latex: '\\tau', strokes: [pcSeg(28, 32, 72, 32, 8), [...pcSeg(50, 32, 48, 76, 8), ...pcSeg(48, 76, 58, 83, 4)]] },
  { name: 'phi', latex: '\\phi', strokes: [pcArc(50, 52, 19, 25, -PIx / 2, 1.5 * PIx, 18), pcSeg(50, 14, 50, 92, 12)] },
  { name: 'omega', latex: '\\omega', strokes: [[...pcArc(36, 52, 13, 23, PIx, 0, 12), ...pcArc(64, 52, 13, 23, PIx, 0, 12)]] },
  { name: 'gamma', latex: '\\gamma', strokes: [[...pcSeg(26, 22, 50, 62, 9), ...pcSeg(50, 62, 52, 88, 5)], pcSeg(74, 22, 44, 74, 10)] },
  // Greek caps + the letters an equation cannot do without
  { name: 'Sigma', latex: '\\sum', strokes: [[...pcSeg(76, 16, 26, 16, 8), ...pcSeg(26, 16, 56, 50, 7), ...pcSeg(56, 50, 26, 84, 7), ...pcSeg(26, 84, 76, 84, 8)]] },
  { name: 'Delta', latex: '\\Delta', strokes: [[...pcSeg(50, 14, 22, 84, 10), ...pcSeg(22, 84, 78, 84, 9), ...pcSeg(78, 84, 50, 14, 10)]] },
  { name: 'Omega', latex: '\\Omega', strokes: [[...pcSeg(18, 86, 38, 86, 7), ...pcArc(50, 44, 24, 32, 0.68 * PIx, 2.32 * PIx, 18), ...pcSeg(62, 86, 82, 86, 7)]] },
  { name: 'x', latex: 'x', strokes: [pcSeg(30, 30, 70, 74, 10), pcSeg(70, 30, 30, 74, 10)] },
  { name: 't', latex: 't', strokes: [[...pcSeg(50, 15, 50, 80, 10), ...pcSeg(50, 80, 61, 84, 4)], pcSeg(33, 36, 68, 36, 7)] },
  { name: 'n', latex: 'n', strokes: [[...pcSeg(32, 86, 32, 40, 10), ...pcArc(46, 58, 14, 16, PIx, 2 * PIx, 10), ...pcSeg(60, 58, 60, 86, 8)]] },
  { name: 'e', latex: 'e', strokes: [[...pcSeg(32, 52, 64, 52, 7), ...pcArc(48, 52, 17, 19, 0, -1.55 * PIx, 14)]] },
  { name: 'r', latex: 'r', strokes: [[...pcSeg(34, 84, 34, 40, 8), ...pcArc(47, 53, 13, 15, PIx, 1.85 * PIx, 8)]] },
];

const PC_N = 32;
// Above this $P distance the drawing is not any symbol we know. Calibrated:
// genuine matches sit p50=0.64 / p99=1.62, random scribble p10=1.37; the
// action is user-initiated and one Ctrl+Z restores the ink, so the threshold
// leans towards accepting.
const INK_MATCH_MAX = 1.8;

function pcPathLength(pts: CloudPt[]): number {
  let d = 0;
  for (let i = 1; i < pts.length; i++) {
    if (pts[i].id === pts[i - 1].id) d += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y);
  }
  return d;
}

function pcResample(ptsIn: CloudPt[], n: number): CloudPt[] {
  const pts = ptsIn.map((p) => ({ ...p }));
  const I = pcPathLength(pts) / (n - 1);
  if (!isFinite(I) || I <= 0) return pts.slice(0, n);
  let D = 0;
  const out = [pts[0]];
  for (let i = 1; i < pts.length; i++) {
    if (pts[i].id === pts[i - 1].id) {
      const d = Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y);
      if (D + d >= I) {
        const t = (I - D) / d;
        const q = { x: pts[i - 1].x + t * (pts[i].x - pts[i - 1].x),
                    y: pts[i - 1].y + t * (pts[i].y - pts[i - 1].y), id: pts[i].id };
        out.push(q);
        pts.splice(i, 0, q);
        D = 0;
      } else D += d;
    }
  }
  while (out.length < n) out.push({ ...pts[pts.length - 1] });
  return out.slice(0, n);
}

/** Resample to a fixed cloud, scale uniformly by the larger dimension (so a
 *  bare minus stroke cannot divide by its own zero height), centre on the
 *  centroid. */
function pcNormalize(strokes: number[][][]): CloudPt[] | null {
  const pts: CloudPt[] = [];
  strokes.forEach((s, si) => s.forEach(([x, y]) => pts.push({ x, y, id: si })));
  if (pts.length < 2) return null;
  const rs = pcResample(pts, PC_N);
  let xmin = Infinity, xmax = -Infinity, ymin = Infinity, ymax = -Infinity;
  for (const p of rs) { xmin = Math.min(xmin, p.x); xmax = Math.max(xmax, p.x);
                        ymin = Math.min(ymin, p.y); ymax = Math.max(ymax, p.y); }
  const scale = Math.max(xmax - xmin, ymax - ymin) || 1;
  let cx = 0, cy = 0;
  const scaled = rs.map((p) => {
    const q = { x: (p.x - xmin) / scale, y: (p.y - ymin) / scale, id: p.id };
    cx += q.x; cy += q.y;
    return q;
  });
  cx /= scaled.length; cy /= scaled.length;
  return scaled.map((p) => ({ x: p.x - cx, y: p.y - cy, id: p.id }));
}

function pcCloudDist(a: CloudPt[], b: CloudPt[], start: number): number {
  const n = a.length;
  const matched = new Array(n).fill(false);
  let sum = 0, i = start;
  do {
    let min = Infinity, index = 0;
    for (let j = 0; j < n; j++) {
      if (matched[j]) continue;
      const d = Math.hypot(a[i].x - b[j].x, a[i].y - b[j].y);
      if (d < min) { min = d; index = j; }
    }
    matched[index] = true;
    const weight = 1 - ((i - start + n) % n) / n;
    sum += weight * min;
    i = (i + 1) % n;
  } while (i !== start);
  return sum;
}

function pcGreedyMatch(a: CloudPt[], b: CloudPt[]): number {
  const n = a.length;
  const step = Math.max(1, Math.floor(Math.sqrt(n)));
  let best = Infinity;
  for (let i = 0; i < n; i += step) {
    best = Math.min(best, pcCloudDist(a, b, i), pcCloudDist(b, a, i));
  }
  return best;
}

const PC_TEMPLATES = INK_TEMPLATES.map((t) => ({ ...t, cloud: pcNormalize(t.strokes)! }));

function pcRecognizeSymbol(strokes: number[][][]): { name: string; latex: string; d: number }[] {
  const cloud = pcNormalize(strokes);
  if (!cloud) return [];
  return PC_TEMPLATES
    .map((t) => ({ name: t.name, latex: t.latex, d: pcGreedyMatch(cloud, t.cloud) }))
    .sort((p, q) => p.d - q.d);
}

type InkBox = { x0: number; y0: number; x1: number; y1: number };
const pcBox = (stroke: number[][]): InkBox => {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const [x, y] of stroke) { x0 = Math.min(x0, x); x1 = Math.max(x1, x);
                                 y0 = Math.min(y0, y); y1 = Math.max(y1, y); }
  return { x0, y0, x1, y1 };
};

/** Group strokes into symbols by horizontal overlap: the strokes of one glyph
 *  (the two bars of =, theta's crossbar) share x-range; the next glyph starts
 *  clear of it, and a superscript overlaps so little that it stays its own
 *  cluster for the position rules below. */
function pcCluster(strokes: number[][][]): { strokes: number[][][]; b: InkBox }[] {
  const items = strokes.map((s) => ({ strokes: [s], b: pcBox(s) }))
    .sort((a, b2) => a.b.x0 - b2.b.x0);
  const out: { strokes: number[][][]; b: InkBox }[] = [];
  for (const it of items) {
    const last = out[out.length - 1];
    if (last) {
      const overlap = Math.min(last.b.x1, it.b.x1) - Math.max(last.b.x0, it.b.x0);
      const minW = Math.max(4, Math.min(last.b.x1 - last.b.x0, it.b.x1 - it.b.x0));
      if (overlap > 0.34 * minW) {
        last.strokes.push(...it.strokes);
        last.b = { x0: Math.min(last.b.x0, it.b.x0), y0: Math.min(last.b.y0, it.b.y0),
                   x1: Math.max(last.b.x1, it.b.x1), y1: Math.max(last.b.y1, it.b.y1) };
        continue;
      }
    }
    out.push(it);
  }
  return out;
}

/** Whole-drawing recognition: cluster, recognize each symbol, then attach
 *  small raised clusters as superscripts and small lowered ones as
 *  subscripts, so a big sigma with a little 2 up-right reads sigma^2. */
function pcRecognizeInk(strokes: number[][][]): { latex: string; worst: number } | null {
  const clusters = pcCluster(strokes);
  if (!clusters.length) return null;
  const parts: { latex: string; b: InkBox }[] = [];
  let worst = 0;
  for (const c of clusters) {
    const ranked = pcRecognizeSymbol(c.strokes);
    if (!ranked.length) return null;
    worst = Math.max(worst, ranked[0].d);
    parts.push({ latex: ranked[0].latex, b: c.b });
  }
  let latex = parts[0].latex;
  for (let i = 1; i < parts.length; i++) {
    const prev = parts[i - 1], cur = parts[i];
    const ph = prev.b.y1 - prev.b.y0, ch = cur.b.y1 - cur.b.y0;
    const pc2 = (prev.b.y0 + prev.b.y1) / 2, cc = (cur.b.y0 + cur.b.y1) / 2;
    if (ch < 0.72 * ph && cc < pc2 - 0.18 * ph) latex += `^{${cur.latex}}`;
    else if (ch < 0.72 * ph && cc > pc2 + 0.18 * ph) latex += `_{${cur.latex}}`;
    else latex += ' ' + cur.latex;
  }
  return { latex, worst };
}

// Copy/paste buffer for blocks, module-level so it survives switching
// notebooks: copy in one canvas, paste into another. CLIP_MARK is the string
// placed on the OS clipboard at copy time; the paste handler routes on it.
let CLIP: Block[] | null = null;
const CLIP_MARK = '[lse-notebook-block]';

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function NotebooksPage() {
  const [list, setList] = useState<Meta[]>([]);
  const [doc, setDoc] = useState<Doc | null>(null);
  const [tool, setTool] = useState<Tool>('select');
  const toolRef = useRef<Tool>('select');
  toolRef.current = tool;
  // Selection is a SET. Almost everything on this page acts on one block, so
  // `sel` (the anchor, the last block added to the selection) and the
  // one-argument setSel are kept as the common path; the array is what makes
  // shift-click, a marquee drag and "move these six things together" possible
  // at all.
  const [selIds, setSelIds] = useState<string[]>([]);
  const sel = selIds.length ? selIds[selIds.length - 1] : null;
  const setSel = useCallback((id: string | null) => setSelIds(id ? [id] : []), []);
  const selKey = selIds.join(',');
  const selRef = useRef<string[]>([]);
  selRef.current = selIds;
  const [editing, setEditing] = useState<string | null>(null);
  const [view, setView] = useState<View>({ x: 0, y: 0, zoom: 1 });
  const [palette, setPalette] = useState(false);
  // Paper picker popover (background colour + ruling for this notebook).
  const [paperMenu, setPaperMenu] = useState(false);
  const paperMenuRef = useRef(false);
  paperMenuRef.current = paperMenu;
  // Which toolbar dropdown is open ('write' | 'draw' | 'shape' | null).
  const [grp, setGrp] = useState<string | null>(null);
  // The tool options card is OPT-IN: arming a tool no longer pops it, a
  // second press on the already-armed tool does; the options list is long
  // enough that popping it on every arm was in the way.
  const [optsOpen, setOptsOpen] = useState(false);
  const optsOpenRef = useRef(false);
  optsOpenRef.current = optsOpen;
  // Favourite tools: a tool plus the exact options it was saved with, pinned
  // to the toolbar. Persisted per machine; documents know nothing about them.
  type FavTool = { tool: Tool; color: string; width: number;
                   dash?: boolean; fill?: string };
  const [favs, setFavs] = useState<FavTool[]>(() => {
    try {
      const v = JSON.parse(localStorage.getItem('lse.nbFavTools') || '[]');
      return Array.isArray(v) ? v.slice(0, 8) : [];
    } catch (e) { return []; }
  });
  const saveFavs = useCallback((list: FavTool[]) => {
    setFavs(list);
    try { localStorage.setItem('lse.nbFavTools', JSON.stringify(list)); } catch (e) { /* private mode */ }
  }, []);
  const dragFav = useRef<number | null>(null);
  // The favourites bar floats over the canvas on its own, exactly like the
  // chart's drawing favourites: an independent bar on the screen, not a
  // toolbar row. It exists only while something is favourited, and it
  // remembers where it was parked.
  const [favPos, setFavPos] = useState<{ x: number; y: number }>(() => {
    try {
      const v = JSON.parse(localStorage.getItem('lse.nbFavBar') || 'null');
      if (v && isFinite(v.x) && isFinite(v.y)) return v;
    } catch (e) { /* default below */ }
    return { x: 340, y: 64 };
  });
  const grpRef = useRef<string | null>(null);
  grpRef.current = grp;
  const [busy, setBusy] = useState('');
  const [renaming, setRenaming] = useState<string | null>(null);
  const [drawing, setDrawing] = useState<number[][] | null>(null);
  // Shape being dragged out, in world coordinates; committed on pointerup.
  const [shapeDraft, setShapeDraft] = useState<{ shape: ShapeKind;
    x1: number; y1: number; x2: number; y2: number } | null>(null);
  // Rubber band in flight, world coordinates. The ref is what pointerup reads:
  // the last pointermove's state update has not necessarily rendered yet.
  const [marquee, setMarqueeState] = useState<{ x1: number; y1: number;
    x2: number; y2: number } | null>(null);
  const marqueeRef = useRef<typeof marquee>(null);
  const setMarquee = useCallback((m: typeof marquee) => {
    marqueeRef.current = m;
    setMarqueeState(m);
  }, []);
  // Space held: pan from anywhere, the one convention every canvas app shares.
  const spaceDown = useRef(false);
  // Right-button pan in flight: where it started and whether it travelled far
  // enough to be a drag (suppresses the context menu) rather than a click.
  const rightPan = useRef<{ sx: number; sy: number; moved: boolean } | null>(null);
  // Set when the right button lifts; what the (Windows-timed) contextmenu
  // that follows needs to know. pendingMenu is the (Linux-timed) opposite:
  // a menu parked at down, opened at up only if the button never moved.
  const rightPanDone = useRef<{ moved: boolean } | null>(null);
  const pendingMenu = useRef<{ cx: number; cy: number; blockId: string | null } | null>(null);
  // A finger that lands on empty canvas might be the FIRST of two. Clearing
  // the selection there and then would mean a two-finger resize could never
  // start from empty canvas: finger one deselects, finger two finds nothing
  // selected and zooms the page instead (caught by the pinch simulation).
  // So a touch defers the clear to the lift, and only if the
  // gesture turned out to be a plain tap.
  const pendingClear = useRef(false);
  // Pre-placement defaults. Pen and shape carry their own settings so the
  // stylebar can show them while the tool is armed, before anything exists.
  // Persisted: a 50px blue pen set an hour ago is still a 50px blue pen
  // after every reload the app does to itself on deploy, and after a
  // restart; the ui_version self-reload used to wipe in-memory state and
  // silently reset the pen mid-session.
  const [penOpts, setPenOptsState] = useState(() => {
    try {
      const v = JSON.parse(localStorage.getItem('lse.nbPenOpts') || 'null');
      if (v && isFinite(v.width)) return { color: v.color || '', width: v.width,
                                           highlighter: !!v.highlighter };
    } catch (e) { /* default below */ }
    return { color: '', width: 2, highlighter: false };
  });
  const setPenOpts = useCallback((up: React.SetStateAction<{ color: string; width: number; highlighter: boolean }>) => {
    setPenOptsState((prev) => {
      const next = typeof up === 'function' ? up(prev) : up;
      try { localStorage.setItem('lse.nbPenOpts', JSON.stringify(next)); } catch (e) { /* private mode */ }
      return next;
    });
  }, []);
  const [shapeOpts, setShapeOptsState] = useState(() => {
    try {
      const v = JSON.parse(localStorage.getItem('lse.nbShapeOpts') || 'null');
      if (v && isFinite(v.width)) return { color: v.color || '', width: v.width,
                                           dash: !!v.dash, fill: v.fill || '' };
    } catch (e) { /* default below */ }
    return { color: '', width: 2, dash: false, fill: '' };
  });
  const setShapeOpts = useCallback((up: React.SetStateAction<{ color: string; width: number; dash: boolean; fill: string }>) => {
    setShapeOptsState((prev) => {
      const next = typeof up === 'function' ? up(prev) : up;
      try { localStorage.setItem('lse.nbShapeOpts', JSON.stringify(next)); } catch (e) { /* private mode */ }
      return next;
    });
  }, []);
  // Stylus mode, persisted: only a pen (or mouse) draws; fingers pan, two
  // fingers pinch. For touch monitors, where the automatic palm rejection
  // below already ignores a hand while the pen is in contact, but a user who
  // rests the hand BEFORE the pen tip lands still gets stray finger strokes
  // without this.
  const [penOnly, setPenOnly] = useState(() => {
    try { return localStorage.getItem('lse.nbPenOnly') === '1'; } catch (e) { return false; }
  });
  // Floating panel positions, in canvas pixels. The tool palette remembers
  // where the user parked it (persisted); the selection panel anchors itself
  // next to the block that was tapped, and a drag overrides that only until
  // the selection changes.
  const [toolPos, setToolPos] = useState<{ x: number; y: number }>(() => {
    try {
      const v = JSON.parse(localStorage.getItem('lse.nbToolPanel') || 'null');
      if (v && isFinite(v.x) && isFinite(v.y)) return v;
    } catch (e) { /* corrupt or absent: default below */ }
    return { x: 14, y: 14 };
  });
  const [selPos, setSelPos] = useState<{ x: number; y: number } | null>(null);
  // The open card's measured footprint, so the clamp below keeps whichever
  // card is showing fully on the canvas whatever it holds.
  const [panelBox, setPanelBox] = useState({ w: 360, h: 150 });
  // Right-click menu: where it sits on screen (nb-main coords), the world
  // point under the cursor (so "add here" really means here), and the block
  // under it if any.
  const [menu, setMenu] = useState<{ x: number; y: number; wx: number; wy: number;
                                     blockId: string | null } | null>(null);
  const menuRef = useRef<typeof menu>(null);
  menuRef.current = menu;
  // Where the next picked photo lands (set by the menu's "Photo here");
  // null keeps the old behaviour of dropping it at the centre of the view.
  const imageAt = useRef<{ x: number; y: number } | null>(null);
  // Undo/redo generation counter: history lives in refs (snapshots must not
  // re-render), this just repaints the toolbar's enabled state.
  const [, setHistTick] = useState(0);
  // The hosted preview serves this same bundle from the website, where there
  // is no per-user disk to write notebooks to. Say so up front rather than
  // letting the first + turn into a 403 the user has to interpret.
  const [hosted, setHosted] = useState(false);

  const wrap = useRef<HTMLDivElement | null>(null);
  const fileIn = useRef<HTMLInputElement | null>(null);
  const editRef = useRef<HTMLTextAreaElement | null>(null);
  const dirty = useRef(false);
  const docRef = useRef<Doc | null>(null);
  const viewRef = useRef(view);
  docRef.current = doc;
  viewRef.current = view;

  // ---- undo/redo ----------------------------------------------------------
  // Snapshots are whole block lists, taken once per GESTURE (a drag is one
  // undo step, not four hundred pointermoves) and once per editing session
  // (typing a paragraph undoes as a paragraph). Cheap because blocks are
  // plain data and images live outside the document as assets.
  const hist = useRef<{ past: Block[][]; future: Block[][] }>({ past: [], future: [] });
  const snapshot = useCallback(() => {
    const d = docRef.current;
    if (!d) return;
    const h = hist.current;
    h.past.push(JSON.parse(JSON.stringify(d.blocks)));
    if (h.past.length > 100) h.past.shift();
    h.future = [];
    setHistTick((t) => t + 1);
  }, []);
  const undo = useCallback(() => {
    const d = docRef.current;
    const h = hist.current;
    if (!d || !h.past.length) return;
    h.future.push(JSON.parse(JSON.stringify(d.blocks)));
    const blocks = h.past.pop()!;
    dirty.current = true;
    setDoc((cur) => (cur ? { ...cur, blocks } : cur));
    setSel(null);
    setEditing(null);
    setHistTick((t) => t + 1);
  }, []);
  const redo = useCallback(() => {
    const d = docRef.current;
    const h = hist.current;
    if (!d || !h.future.length) return;
    h.past.push(JSON.parse(JSON.stringify(d.blocks)));
    const blocks = h.future.pop()!;
    dirty.current = true;
    setDoc((cur) => (cur ? { ...cur, blocks } : cur));
    setSel(null);
    setEditing(null);
    setHistTick((t) => t + 1);
  }, []);

  // ---- equation library ---------------------------------------------------
  // Saved equations live in a HIDDEN notebook document (folder '.library'),
  // so they ride the existing store: same atomic writes, same on-disk home
  // (~/.config/lse-terminal/notebooks/), they travel with a backup of that
  // folder, and the frozen engine on user machines needs no update. The doc
  // is filtered out of every list a user sees; its blocks ARE the library.
  const [eqLib, setEqLib] = useState<{ id: string; latex: string; size: number }[]>([]);
  const eqDoc = useRef<Doc | null>(null);

  const loadEqLib = useCallback(async (metaId: string | null) => {
    if (!metaId) { eqDoc.current = null; setEqLib([]); return; }
    try {
      const r = await fetch('/api/notebooks/' + metaId);
      if (!r.ok) return;
      const d: Doc = await r.json();
      eqDoc.current = d;
      setEqLib((d.blocks || []).filter((b) => b.type === 'math')
        .map((b) => ({ id: b.id, latex: (b as MathBlock).latex,
                       size: (b as MathBlock).size || 30 })));
    } catch (e) { /* engine restarting */ }
  }, []);

  // ---- library ------------------------------------------------------------
  const loadList = useCallback(async () => {
    try {
      const r = await fetch('/api/notebooks');
      if (r.ok) {
        const all: Meta[] = await r.json();
        const lib = all.find((m) => (m.folder || '') === '.library');
        const l = all.filter((m) => (m.folder || '') !== '.library');
        setList(l);
        // The shell's library tree carries a NOTEBOOKS section built from
        // this same list; hand it over so the tree stays current without a
        // polling loop of its own.
        window.dispatchEvent(new CustomEvent('lse-nb-list', { detail: l }));
        loadEqLib(lib ? lib.id : null);
      }
    } catch (e) { /* engine restarting: keep the rail as it is */ }
  }, [loadEqLib]);

  const open = useCallback(async (id: string) => {
    try {
      const r = await fetch('/api/notebooks/' + id);
      if (!r.ok) throw new Error(String(r.status));
      const d: Doc = await r.json();
      setDoc(d);
      setView(d.view && isFinite(d.view.zoom) ? d.view : { x: 0, y: 0, zoom: 1 });
      setSel(null);
      setEditing(null);
      dirty.current = false;
      // History is per-notebook; undoing across documents would splice one
      // canvas's blocks into another.
      hist.current = { past: [], future: [] };
      setHistTick((t) => t + 1);
    } catch (e) {
      setBusy('could not open that notebook');
    }
  }, []);

  const create = useCallback(async () => {
    if (hosted) {
      setBusy('Notebooks are saved on your own machine, so they need the '
              + 'downloaded app. This page is the hosted preview.');
      return;
    }
    try {
      const r = await fetch('/api/notebooks', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'Untitled' }),
      });
      // A 404 here is specifically "this app's engine predates notebooks":
      // the UI updates itself in place, the engine only changes when the app
      // is updated, so the two can be out of step and the button would
      // otherwise just do nothing.
      if (r.status === 404) throw new Error(
        'this app\'s engine does not have notebooks yet; update the app (or '
        + 'restart it if an update is already installed)');
      if (!r.ok) throw new Error((await r.json().catch(() => ({}))).detail || String(r.status));
      const d: Doc = await r.json();
      await loadList();
      setDoc(d);
      setView({ x: 0, y: 0, zoom: 1 });
      setSel(null);
      setRenaming(d.id);
      hist.current = { past: [], future: [] };
    } catch (e: any) {
      setBusy(String(e.message || e));
    }
  }, [loadList, hosted]);

  const remove = useCallback(async (id: string) => {
    if (!window.confirm('Delete this notebook and everything on its canvas?')) return;
    await fetch('/api/notebooks/' + id, { method: 'DELETE' });
    if (docRef.current?.id === id) setDoc(null);
    loadList();
  }, [loadList]);

  const putEqDoc = useCallback(async (d: Doc) => {
    const r = await fetch('/api/notebooks/' + d.id, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(d),
    });
    if (!r.ok) throw new Error((await r.json().catch(() => ({}))).detail || String(r.status));
    eqDoc.current = d;
    setEqLib(d.blocks.filter((b) => b.type === 'math')
      .map((b) => ({ id: b.id, latex: (b as MathBlock).latex,
                     size: (b as MathBlock).size || 30 })));
  }, []);

  /** Put one equation into the saved library (creating the hidden library
   *  document on first use), and open the palette so the save lands
   *  somewhere visible instead of into thin air. */
  const saveEquation = useCallback(async (latex: string, size: number) => {
    const clean = (latex || '').trim();
    if (!clean) { setBusy('nothing in the equation yet'); return; }
    try {
      let d = eqDoc.current;
      if (!d) {
        const r = await fetch('/api/notebooks', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: 'Saved equations', folder: '.library' }),
        });
        if (!r.ok) throw new Error((await r.json().catch(() => ({}))).detail || String(r.status));
        d = await r.json() as Doc;
      }
      setPalette(true);
      if (d.blocks.some((b) => b.type === 'math' && (b as MathBlock).latex.trim() === clean)) {
        setBusy('already in your saved equations');
        return;
      }
      await putEqDoc({ ...d, blocks: [...d.blocks,
        { id: uid(), type: 'math', x: 0, y: 0, w: 380, h: 130,
          latex: clean, size: size || 30 } as Block] });
      setBusy('equation saved');
    } catch (e: any) {
      setBusy('could not save the equation: ' + String(e.message || e));
    }
  }, [putEqDoc]);

  const removeEquation = useCallback(async (id: string) => {
    const d = eqDoc.current;
    if (!d) return;
    try {
      await putEqDoc({ ...d, blocks: d.blocks.filter((b) => b.id !== id) });
    } catch (e: any) {
      setBusy('could not remove it: ' + String(e.message || e));
    }
  }, [putEqDoc]);

  useEffect(() => {
    loadList();
    fetch('/api/config').then((r) => r.json()).then((c) => setHosted(!!c.hosted))
      .catch(() => { /* old engine without the route: assume local */ });
  }, [loadList]);

  // Ask the shell to render the library tree (WORKSPACE + DATA) into the
  // rail's #nb-lib now that the div exists. Once per component lifetime is
  // enough: the shell's own refresh paths repaint it afterwards, and the DOM
  // persists across page switches because mount() re-renders the same root.
  useEffect(() => {
    window.dispatchEvent(new Event('lse-nb-rail'));
  }, []);

  // The shell's library tree opens notebooks from outside the island: the id
  // is parked on window (the island may not be mounted yet when the row is
  // clicked) and an event covers the already-mounted case, where the parked
  // id would otherwise sit unread until the next mount. '__new__' is the
  // tree header's +.
  useEffect(() => {
    const take = () => {
      const pend = (window as any).__lseNbPending;
      if (!pend) return;
      (window as any).__lseNbPending = null;
      if (pend === '__new__') create(); else open(String(pend));
    };
    take();
    window.addEventListener('lse-nb-open', take);
    return () => window.removeEventListener('lse-nb-open', take);
  }, [open, create]);

  // ---- autosave -----------------------------------------------------------
  // Debounced, and only when something actually changed: the canvas fires
  // state updates on every pointer move while dragging, and a PUT per frame
  // would write the user's disk hundreds of times for one gesture.
  useEffect(() => {
    if (!doc || !dirty.current) return;
    const t = setTimeout(async () => {
      const d = docRef.current;
      if (!d) return;
      try {
        const r = await fetch('/api/notebooks/' + d.id, {
          method: 'PUT', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ...d, view: viewRef.current }),
        });
        if (!r.ok) throw new Error((await r.json().catch(() => ({}))).detail || String(r.status));
        dirty.current = false;
        setBusy('');
        loadList();
      } catch (e: any) {
        setBusy('not saved: ' + String(e.message || e));
      }
    }, 700);
    return () => clearTimeout(t);
  }, [doc, view, loadList]);

  const mutate = useCallback((fn: (blocks: Block[]) => Block[]) => {
    dirty.current = true;
    setDoc((d) => (d ? { ...d, blocks: fn(d.blocks) } : d));
  }, []);

  /** Change the canvas surface of the open notebook. Not an undo step: the
   *  paper is a property of the document, like its name, not an edit to the
   *  content, and burying a block deletion under three paper clicks in the
   *  undo stack would be worse than not undoing the paper at all. */
  const setSurface = useCallback((p: Partial<Pick<Doc, 'paper' | 'pattern'>>) => {
    dirty.current = true;
    setDoc((d) => (d ? { ...d, ...p } : d));
  }, []);

  const patch = useCallback((id: string, p: Partial<Block>) => {
    mutate((bs) => bs.map((b) => (b.id === id ? { ...b, ...p } as Block : b)));
  }, [mutate]);

  /** patch + one undo step: for the stylebar's single-click changes (colour,
   *  size, dash...), where each click should be individually undoable. */
  const patchU = useCallback((id: string, p: Partial<Block>) => {
    snapshot();
    patch(id, p);
  }, [snapshot, patch]);

  const add = useCallback((b: Block) => {
    snapshot();
    dirty.current = true;
    setDoc((d) => (d ? { ...d, blocks: [...d.blocks, b] } : d));
    return b.id;
  }, [snapshot]);

  /** Put a new writing block at a world point and open it for typing. One
   *  function for the tool, the shortcut, the double-click and the right-click
   *  menu, so a sticky note is the same sticky note however it was asked for.
   *  Sticky and code are TEXT blocks with a preset, not types of their own:
   *  that is what lets a note become a snippet with one click and keeps every
   *  older document readable by a build that has never heard of either. */
  const addAt = useCallback((kind: 'text' | 'sticky' | 'code' | 'math',
                             x: number, y: number) => {
    const id = uid();
    if (kind === 'math') {
      add({ id, type: 'math', x, y, w: 380, h: 130, latex: '', size: 30 });
      setPalette(true);
    } else if (kind === 'sticky') {
      add({ id, type: 'text', x, y, w: 240, h: 200, text: '', size: 17,
            bg: STICKY_BG });
    } else if (kind === 'code') {
      add({ id, type: 'text', x, y, w: 420, h: 150, text: '', size: 13,
            bg: CODE_BG, mono: true });
    } else {
      add({ id, type: 'text', x, y, w: 320, h: 90, text: '', size: 15 });
    }
    setEditing(id);
    return id;
  }, [add]);

  const removeBlock = useCallback((id: string) => {
    snapshot();
    mutate((bs) => bs.filter((b) => b.id !== id));
    setSel(null);
  }, [snapshot, mutate, setSel]);

  /** Delete the whole selection as ONE undo step: six blocks rubber-banded
   *  and deleted must come back on one Ctrl+Z, not six. */
  const removeSelection = useCallback(() => {
    const ids = new Set(selRef.current);
    if (!ids.size) return;
    snapshot();
    mutate((bs) => bs.filter((b) => !ids.has(b.id)));
    setSelIds([]);
    setEditing(null);
  }, [snapshot, mutate]);

  /** Copy the selection 24px down-right, and select the copies. */
  const duplicateSelection = useCallback(() => {
    const d = docRef.current;
    const ids = selRef.current;
    if (!d || !ids.length) return;
    const copies = d.blocks.filter((b) => ids.includes(b.id))
      .map((b) => ({ ...JSON.parse(JSON.stringify(b)), id: uid(),
                     x: b.x + 24, y: b.y + 24 } as Block));
    if (!copies.length) return;
    snapshot();
    dirty.current = true;
    setDoc((cur) => (cur ? { ...cur, blocks: [...cur.blocks, ...copies] } : cur));
    setSelIds(copies.map((c) => c.id));
  }, [snapshot]);

  /** Apply one styling patch to every selected block that can take it. The
   *  panel decides what to offer; this just fans it out as one undo step. */
  const patchSelection = useCallback((p: Partial<Block>,
                                      only?: (b: Block) => boolean) => {
    const ids = new Set(selRef.current);
    if (!ids.size) return;
    snapshot();
    mutate((bs) => bs.map((b) => (ids.has(b.id) && (!only || only(b))
      ? { ...b, ...p } as Block : b)));
  }, [snapshot, mutate]);

  /** Line every selected block up on one edge or centre line. Nothing to do
   *  under two blocks, which is why the row only appears on a multi-select. */
  const alignSelection = useCallback((how: 'left' | 'centerX' | 'right'
                                          | 'top' | 'centerY' | 'bottom') => {
    const d = docRef.current;
    const ids = new Set(selRef.current);
    const sels = d?.blocks.filter((b) => ids.has(b.id)) || [];
    if (sels.length < 2) return;
    const x0 = Math.min(...sels.map((b) => b.x));
    const x1 = Math.max(...sels.map((b) => b.x + b.w));
    const y0 = Math.min(...sels.map((b) => b.y));
    const y1 = Math.max(...sels.map((b) => b.y + b.h));
    snapshot();
    mutate((bs) => bs.map((b) => {
      if (!ids.has(b.id)) return b;
      switch (how) {
        case 'left': return { ...b, x: x0 };
        case 'right': return { ...b, x: x1 - b.w };
        case 'centerX': return { ...b, x: (x0 + x1) / 2 - b.w / 2 };
        case 'top': return { ...b, y: y0 };
        case 'bottom': return { ...b, y: y1 - b.h };
        default: return { ...b, y: (y0 + y1) / 2 - b.h / 2 };
      }
    }));
  }, [snapshot, mutate]);

  /** Wipe every block off the open canvas. One undo step, so Ctrl+Z brings
   *  the whole page back, and a confirm in front of it because the button
   *  sits in the toolbar where a misclick is cheap to make. The notebook
   *  itself survives: this empties the canvas, it does not delete the file
   *  (the rail's x does that). */
  const clearCanvas = useCallback(() => {
    const d = docRef.current;
    if (!d || !d.blocks.length) return;
    if (!window.confirm(`Delete all ${d.blocks.length} `
        + `${d.blocks.length === 1 ? 'item' : 'items'} on this canvas? `
        + 'Ctrl+Z brings them back.')) return;
    snapshot();
    mutate(() => []);
    setSelIds([]);
    setEditing(null);
  }, [snapshot, mutate]);

  /** Move a block to the end (front) or start (back) of the paint order. */
  const reorder = useCallback((id: string, front: boolean) => {
    snapshot();
    mutate((bs) => {
      const b = bs.find((x) => x.id === id);
      if (!b) return bs;
      const rest = bs.filter((x) => x.id !== id);
      return front ? [...rest, b] : [b, ...rest];
    });
  }, [snapshot, mutate]);

  // ---- floating panels ----------------------------------------------------
  /** Keep a panel over the canvas (nb-main coordinates): at least its grip
   *  stays reachable however far it is dragged or however the window shrank. */
  const clampPanel = useCallback((x: number, y: number) => {
    const w = wrap.current;
    const dx = w?.offsetLeft || 0, dy = w?.offsetTop || 0;
    const cw = w?.clientWidth || 800, ch = w?.clientHeight || 600;
    // Bound by the card's MEASURED size, not a constant: the redesign took
    // the cards from ~240px to ~360px wide, and the stale constant let a
    // card anchored near the right edge hang off the canvas, where the
    // overflow clipped its colour rows (found by eye).
    return { x: clamp(x, dx + 6, Math.max(dx + 6, dx + cw - panelBox.w - 6)),
             y: clamp(y, dy + 6, Math.max(dy + 6, dy + ch - panelBox.h - 6)) };
  }, [panelBox]);

  /** Cards report their real size after layout; a change re-runs the clamp
   *  (it is a dependency), so a card that grew re-seats itself before paint.
   *  Guarded so an unchanged measurement cannot loop. Only one card is ever
   *  mounted at a time: the tool cards require an empty selection. */
  const onPanelSize = useCallback((w: number, h: number) => {
    setPanelBox((p) => (Math.abs(p.w - w) < 2 && Math.abs(p.h - h) < 2 ? p : { w, h }));
  }, []);
  const moveToolPanel = useCallback((x: number, y: number) => {
    const p = clampPanel(x, y);
    setToolPos(p);
    try { localStorage.setItem('lse.nbToolPanel', JSON.stringify(p)); } catch (e) { /* private mode */ }
  }, [clampPanel]);
  const moveSelPanel = useCallback((x: number, y: number) => {
    setSelPos(clampPanel(x, y));
  }, [clampPanel]);
  const moveFavBar = useCallback((x: number, y: number) => {
    const p = clampPanel(x, y);
    setFavPos(p);
    try { localStorage.setItem('lse.nbFavBar', JSON.stringify(p)); } catch (e) { /* private mode */ }
  }, [clampPanel]);
  // A new selection re-anchors the panel next to what was tapped.
  useEffect(() => { setSelPos(null); }, [selKey]);

  /** Read the selected ink strokes as maths and replace them with a maths
   *  block sized like the drawing. One undo step brings the ink back, which
   *  is the safety net a wrong read needs. */
  const inkToMaths = useCallback(() => {
    const inks = (docRef.current?.blocks || [])
      .filter((b): b is InkBlock => b.type === 'ink' && selRef.current.includes(b.id));
    if (!inks.length) return;
    const strokes = inks.map((b) => b.points.map(([px, py]) => [b.x + px, b.y + py]));
    const res = pcRecognizeInk(strokes);
    if (!res || res.worst > INK_MATCH_MAX) {
      setBusy('could not read that as maths; larger and cleaner helps');
      return;
    }
    const x0 = Math.min(...inks.map((b) => b.x));
    const y0 = Math.min(...inks.map((b) => b.y));
    const x1 = Math.max(...inks.map((b) => b.x + b.w));
    const y1 = Math.max(...inks.map((b) => b.y + b.h));
    const size = clamp(Math.round((y1 - y0) * 0.75), 14, 200);
    const nid = uid();
    const gone = new Set(inks.map((b) => b.id));
    snapshot();
    dirty.current = true;
    setDoc((cur) => (cur ? { ...cur, blocks: [
      ...cur.blocks.filter((b) => !gone.has(b.id)),
      { id: nid, type: 'math', x: x0, y: y0,
        w: Math.max(120, (x1 - x0) * 1.25), h: Math.max(60, (y1 - y0) * 1.25),
        latex: res.latex, size } as Block,
    ] } : cur));
    setSelIds([nid]);
    setBusy('');
  }, [snapshot]);

  /** Grow or shrink the selected block about its centre: the touch-friendly
   *  alternative to dragging a corner handle. */
  const scaleSel = useCallback((f: number) => {
    const b = docRef.current?.blocks.find((x) => x.id === sel);
    if (!b) return;
    const nw = Math.max(MIN_BLOCK_W, b.w * f);
    const nh = Math.max(MIN_BLOCK_H, b.h * f);
    patchU(b.id, { w: nw, h: nh,
                   x: b.x + (b.w - nw) / 2, y: b.y + (b.h - nh) / 2 } as Partial<Block>);
  }, [sel, patchU]);

  // ---- images -------------------------------------------------------------
  const upload = useCallback(async (file: File | Blob, at?: { x: number; y: number }) => {
    const type = (file as File).type || 'image/png';
    if (!/^image\//.test(type)) { setBusy('only images can go on the canvas'); return; }
    setBusy('uploading image…');
    const b64: string = await new Promise((res, rej) => {
      const fr = new FileReader();
      fr.onload = () => res(String(fr.result).split(',')[1] || '');
      fr.onerror = rej;
      fr.readAsDataURL(file);
    });
    try {
      const r = await fetch('/api/notebooks/asset', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ data: b64, mime: type }),
      });
      if (!r.ok) throw new Error((await r.json().catch(() => ({}))).detail || String(r.status));
      const { src } = await r.json();
      // Size the block from the image's real aspect ratio so a photo never
      // lands squashed and then has to be fixed by hand.
      const dims = await new Promise<{ w: number; h: number }>((res) => {
        const im = new Image();
        im.onload = () => res({ w: im.naturalWidth || 480, h: im.naturalHeight || 320 });
        im.onerror = () => res({ w: 480, h: 320 });
        im.src = src;
      });
      const scale = Math.min(1, 520 / Math.max(dims.w, 1));
      const p = at || centreWorld();
      add({ id: uid(), type: 'image', src, name: (file as File).name,
            x: p.x - (dims.w * scale) / 2, y: p.y - (dims.h * scale) / 2,
            w: Math.round(dims.w * scale), h: Math.round(dims.h * scale) });
      setBusy('');
    } catch (e: any) {
      setBusy('image not saved: ' + String(e.message || e));
    }
  }, [add]);

  /** Scale the selection about its own centre by `f`, from a recorded set of
   *  starting boxes. Every frame of a pinch scales off the START, never off
   *  the previous frame: compounding a factor per pointermove drifts, and
   *  pinching out and back in would not return to the size you began with.
   *  Type sizes ride along, so a text or maths block gets BIGGER rather than
   *  reflowing the same words into a wider box. */
  const scaleSelectionTo = useCallback((f: number,
      start: { id: string; x: number; y: number; w: number; h: number; size?: number }[]) => {
    if (!start.length) return;
    const x0 = Math.min(...start.map((s) => s.x));
    const y0 = Math.min(...start.map((s) => s.y));
    const x1 = Math.max(...start.map((s) => s.x + s.w));
    const y1 = Math.max(...start.map((s) => s.y + s.h));
    const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
    // Never let the pinch drive anything under the floor: clamp the factor
    // once for the whole group so it keeps its shape instead of some blocks
    // bottoming out while others carry on shrinking.
    const minF = Math.max(...start.map((s) =>
      Math.max(MIN_BLOCK_W / Math.max(s.w, 0.001), MIN_BLOCK_H / Math.max(s.h, 0.001))));
    const k = clamp(f, minF, 60);
    const at = new Map(start.map((s) => [s.id, s]));
    mutate((bs) => bs.map((b) => {
      const s = at.get(b.id);
      if (!s) return b;
      const next: Record<string, unknown> = {
        x: cx + (s.x - cx) * k, y: cy + (s.y - cy) * k,
        w: s.w * k, h: s.h * k,
      };
      if (s.size) next.size = clamp(Math.round(s.size * k), 6, 400);
      return { ...b, ...next } as Block;
    }));
  }, [mutate]);

  /** The selection's boxes right now, for a gesture to scale from. */
  const selectionStart = useCallback(() => {
    const ids = new Set(selRef.current);
    return (docRef.current?.blocks || []).filter((b) => ids.has(b.id)).map((b) => ({
      id: b.id, x: b.x, y: b.y, w: b.w, h: b.h,
      size: (b as TextBlock).size,
    }));
  }, []);

  // Trackpad-pinch resize state: the boxes the burst started from, the factor
  // accumulated across it, and when the last event arrived (a gap ends the
  // gesture and starts a new undo step).
  const lastPinchWheel = useRef(0);
  const pinchWheelF = useRef(1);
  const pinchWheelStart = useRef<{ id: string; x: number; y: number;
    w: number; h: number; size?: number }[]>([]);

  const centreWorld = useCallback(() => {
    const r = wrap.current?.getBoundingClientRect();
    const v = viewRef.current;
    if (!r) return { x: 0, y: 0 };
    return toWorld(v, r.width / 2, r.height / 2);
  }, []);

  // ---- viewport -----------------------------------------------------------
  // Wheel = zoom about the pointer, with or without ctrl: users sit at mice
  // and touch monitors, where the wheel means in-and-out like every chart,
  // and two fingers pinch like a phone; the earlier Figma contract, wheel
  // pans, kept reading as broken. Panning is dragging: empty canvas with
  // the pointer, or one finger. Ctrl+wheel staying zoom also keeps trackpad
  // pinch (reported as ctrl+wheel) working.
  const onWheel = useCallback((e: React.WheelEvent) => {
    const r = wrap.current?.getBoundingClientRect();
    if (!r) return;
    // The menu is pinned to a world point; zooming out from under it would
    // leave it pointing at nothing.
    if (menuRef.current) setMenu(null);
    const sx = e.clientX - r.left;
    const sy = e.clientY - r.top;
    // Firefox reports wheel steps in lines (deltaMode 1), Chrome in pixels.
    const dy = e.deltaY * (e.deltaMode === 1 ? 33 : 1);
    // A trackpad pinch arrives as ctrl+wheel, so it follows the same rule as
    // two fingers on glass: with something selected it resizes THAT, with
    // nothing selected it zooms the page. A bare wheel always zooms the page,
    // because a wheel is not two fingers and nudging it over a selected block
    // must not silently resize your work.
    if (e.ctrlKey && selRef.current.length) {
      const now = Date.now();
      // One undo step per burst of wheel events, the same grouping the arrow
      // keys use: a pinch is one gesture, not forty.
      if (now - lastPinchWheel.current > 700) {
        snapshot();
        pinchWheelStart.current = selectionStart();
      }
      lastPinchWheel.current = now;
      pinchWheelF.current = clamp(pinchWheelF.current * Math.exp(-dy / 700), 0.01, 60);
      scaleSelectionTo(pinchWheelF.current, pinchWheelStart.current);
      return;
    }
    pinchWheelF.current = 1;
    setView((v) => {
      // ~1.15x per physical wheel notch (Chrome sends ~100px per notch).
      // The first cut divided by 260, which zoomed 100% to 600% in three
      // clicks and made the canvas unusable with a mouse.
      const z = clamp(v.zoom * Math.exp(-dy / 700), MIN_ZOOM, MAX_ZOOM);
      // Keep the world point under the cursor pinned while the scale changes.
      return { zoom: z, x: sx - ((sx - v.x) / v.zoom) * z, y: sy - ((sy - v.y) / v.zoom) * z };
    });
  }, [snapshot, selectionStart, scaleSelectionTo]);

  const zoomBy = useCallback((f: number) => {
    const r = wrap.current?.getBoundingClientRect();
    const cx = (r?.width || 0) / 2;
    const cy = (r?.height || 0) / 2;
    setView((v) => {
      const z = clamp(v.zoom * f, MIN_ZOOM, MAX_ZOOM);
      return { zoom: z, x: cx - ((cx - v.x) / v.zoom) * z, y: cy - ((cy - v.y) / v.zoom) * z };
    });
  }, []);

  /** Frame everything on the canvas, or return to 1:1 on an empty one. */
  const fit = useCallback(() => {
    const d = docRef.current;
    const r = wrap.current?.getBoundingClientRect();
    if (!d || !r || !d.blocks.length) { setView({ x: 0, y: 0, zoom: 1 }); return; }
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const b of d.blocks) {
      x0 = Math.min(x0, b.x); y0 = Math.min(y0, b.y);
      x1 = Math.max(x1, b.x + b.w); y1 = Math.max(y1, b.y + b.h);
    }
    const pad = 60;
    const z = clamp(Math.min((r.width - pad * 2) / Math.max(x1 - x0, 1),
                             (r.height - pad * 2) / Math.max(y1 - y0, 1)), MIN_ZOOM, 1.6);
    setView({ zoom: z, x: r.width / 2 - ((x0 + x1) / 2) * z, y: r.height / 2 - ((y0 + y1) / 2) * z });
  }, []);

  // ---- pointer interaction ------------------------------------------------
  // One handler for the whole surface. `drag` holds what the current gesture
  // is doing; committing on pointerup keeps every gesture a single undoable
  // change to the document rather than a stream of them.
  const drag = useRef<
    | { kind: 'pan'; sx: number; sy: number; vx: number; vy: number }
    // A move carries the START position of EVERY block it is moving, so a
    // multi-block drag stays rigid: deriving each block's new position from
    // its own previous one accumulates rounding and shears the group apart.
    | { kind: 'move'; id: string; ox: number; oy: number;
        at: { id: string; bx: number; by: number }[] }
    // Rubber band. Anchor is a world point; the moving corner follows the
    // pointer, and everything the band touches is selected on release.
    | { kind: 'marquee'; ax: number; ay: number; add: string[] }
    // Resize drags from any of the four corner handles; ax/ay is the corner
    // OPPOSITE the grabbed one, which stays fixed while the grabbed corner
    // follows the pointer. bw/bh are the starting size, for the aspect lock.
    | { kind: 'resize'; id: string; ax: number; ay: number; bw: number; bh: number }
    | { kind: 'ink' }
    | { kind: 'shape' }
    | { kind: 'erase' }
    // Two fingers: zoom about (and pan with) the fingers' midpoint. d0/z0
    // are the starting spread and zoom; wx/wy the world point under the
    // starting midpoint, which stays pinned under the fingers.
    | { kind: 'pinch'; d0: number; z0: number; wx: number; wy: number }
    // Two fingers WITH something selected: resize what is selected and leave
    // the canvas alone. `start` is every selected
    // block's box at the moment the second finger landed.
    | { kind: 'pinchsize'; d0: number;
        start: { id: string; x: number; y: number; w: number; h: number; size?: number }[] }
    | null>(null);

  // Live touch contacts (client coords), for the pinch. Pens and mice never
  // enter this map. gesturePid pins every one-pointer gesture to the pointer
  // that started it: without it a second contact (a palm, a stray finger)
  // re-entered onPointerDown and RESET the in-flight stroke, which is how a
  // pen line breaks halfway through a stroke on a touch monitor.
  // penSeen is the palm-rejection clock: a touch that lands while a pen is,
  // or moments ago was, on the glass is a resting hand, not input.
  // What the current gesture started on. Read by the canvas dblclick
  // handler, whose own event target is unreliable once a block's editor has
  // replaced the node the first click landed on: `ui` says the gesture began
  // on a block or a handle, `block` names the block so the dblclick can open
  // it even when the event no longer points anywhere useful.
  const downOn = useRef<{ block: string | null; ui: boolean }>({ block: null, ui: false });
  const touchPts = useRef(new Map<number, { x: number; y: number }>());
  const gesturePid = useRef<number | null>(null);
  const gesturePen = useRef(false);
  const penSeen = useRef(0);

  const worldAt = useCallback((e: { clientX: number; clientY: number }) => {
    const r = wrap.current?.getBoundingClientRect();
    if (!r) return { x: 0, y: 0 };
    return toWorld(viewRef.current, e.clientX - r.left, e.clientY - r.top);
  }, []);

  // One snapshot per drag gesture, taken on the FIRST pointermove that
  // changes something rather than on pointerdown: a plain click on a block
  // (select) shares the same pointerdown path as a drag, and snapshotting
  // there filled the undo history with do-nothing entries per click.
  const gestureSnapped = useRef(false);

  /** Delete ink strokes near a world point: the eraser. Radius grows with the
   *  stroke's own width so a fat highlighter is as erasable as a thin line.
   *  History is pushed inside the updater, from the exact block list being
   *  filtered: pointer moves outrun renders, so a snapshot read from the
   *  outer scope could capture a list one erasure behind. */
  const eraseAt = useCallback((wx: number, wy: number) => {
    const z = viewRef.current.zoom;
    setDoc((cur) => {
      if (!cur) return cur;
      const survivors = cur.blocks.filter((b) => {
        if (b.type !== 'ink') return true;
        const r = (10 / z) + (b.width || 2) / 2;
        for (const [px, py] of b.points) {
          const dx = b.x + px - wx;
          const dy = b.y + py - wy;
          if (dx * dx + dy * dy < r * r) return false;
        }
        return true;
      });
      if (survivors.length === cur.blocks.length) return cur;
      if (!gestureSnapped.current) {
        // Idempotent under StrictMode's double-invoked updaters: the ref
        // flips on the first push, so the second invocation skips it.
        gestureSnapped.current = true;
        hist.current.past.push(JSON.parse(JSON.stringify(cur.blocks)));
        if (hist.current.past.length > 100) hist.current.past.shift();
        hist.current.future = [];
      }
      dirty.current = true;
      return { ...cur, blocks: survivors };
    });
    setHistTick((t) => t + 1);
  }, []);

  /** Star state for the dropdown rows: a tool is "favourited" when any pin
   *  of it sits in the bar. Toggling on pins it with the CURRENT defaults
   *  (the same ones the next stroke would use); toggling off removes every
   *  pin of that tool. Same interaction as the chart's drawing favourites,
   *  so the two favourite surfaces behave the same way. */
  const isFavTool = useCallback((t: Tool) => favs.some((f) => f.tool === t), [favs]);
  const toggleFavTool = useCallback((t: Tool) => {
    if (favs.some((f) => f.tool === t)) {
      saveFavs(favs.filter((f) => f.tool !== t));
      return;
    }
    const f: FavTool = (t === 'pen' || t === 'highlighter')
      ? { tool: t, color: penOpts.color, width: penOpts.width }
      : ['line', 'arrow', 'rect', 'ellipse', 'triangle', 'diamond', 'star'].includes(t)
      ? { tool: t, color: shapeOpts.color, width: shapeOpts.width,
          dash: shapeOpts.dash || undefined, fill: shapeOpts.fill || undefined }
      // Write tools carry no stroke settings; the pin is just the tool.
      : { tool: t, color: '', width: 0 };
    saveFavs([...favs, f].slice(-8));
  }, [favs, penOpts, shapeOpts, saveFavs]);

  /** Toolbar presses route here: a fresh tool arms silently, pressing the
   *  tool you are already holding opens (or closes) its options card. */
  const armOrToggle = useCallback((t: Tool) => {
    if (t === toolRef.current) setOptsOpen((v) => !v);
    else { setTool(t); setOptsOpen(false); }
  }, []);

  const SHAPES: Tool[] = ['line', 'arrow', 'rect', 'ellipse', 'triangle',
                          'diamond', 'star'];
  const DRAW_TOOLS: Tool[] = ['pen', 'highlighter', 'eraser', ...SHAPES];

  /** Right-click: our own menu (add-here on empty canvas, block actions on
   *  a block), never the browser's. */
  /** Open the right-click menu for a captured point/target. Split out of the
   *  contextmenu handler because with right-drag-to-pan the DECISION to open
   *  happens at button RELEASE, and the contextmenu event itself arrives at
   *  different moments per platform (Windows fires it on up, Linux on down). */
  const openMenuAt = useCallback((cap: { cx: number; cy: number; blockId: string | null }) => {
    const w2 = worldAt({ clientX: cap.cx, clientY: cap.cy });
    const wr = wrap.current;
    const r = wr?.getBoundingClientRect();
    // Right-clicking one of several selected blocks keeps the group: the menu
    // is about to offer "delete 6 selected", so it must not have just
    // collapsed the selection to the one under the cursor.
    if (cap.blockId && !selRef.current.includes(cap.blockId)) setSel(cap.blockId);
    setMenu({ x: cap.cx - (r?.left || 0) + (wr?.offsetLeft || 0),
              y: cap.cy - (r?.top || 0) + (wr?.offsetTop || 0),
              wx: w2.x, wy: w2.y, blockId: cap.blockId });
  }, [worldAt, setSel]);

  const onContextMenu = useCallback((e: React.MouseEvent) => {
    if (!doc) return;
    e.preventDefault();
    const blk = (e.target as HTMLElement).closest('[data-block]') as HTMLElement | null;
    const cap = { cx: e.clientX, cy: e.clientY,
                  blockId: blk ? blk.dataset.block! : null };
    if (rightPan.current) {
      // Button still held (Linux fires contextmenu on DOWN): park the menu;
      // pointerup opens it only if the button never travelled.
      pendingMenu.current = cap;
      return;
    }
    // Button already released (Windows fires on UP): a drag panned, no menu.
    const rp = rightPanDone.current;
    rightPanDone.current = null;
    if (rp?.moved) return;
    openMenuAt(cap);
  }, [doc, openMenuAt]);

  const onPointerDown = useCallback((e: React.PointerEvent) => {
    if (!doc) return;
    // Any press on the canvas dismisses an open right-click menu or popover.
    if (menuRef.current) setMenu(null);
    if (paperMenuRef.current) setPaperMenu(false);
    if (grpRef.current) setGrp(null);
    // Right button: HOLD AND DRAG PANS, from anywhere, whatever tool is
    // armed. The target flow is pen in hand, right button to shove the
    // canvas, straight back to drawing, no tool switch. A stationary
    // right-click is still the menu: onContextMenu checks how far the
    // button travelled and only opens it for a click, not a drag. Still
    // never captured: capture retargets the contextmenu that follows to the
    // canvas itself, which hid which block was under the cursor. A stroke
    // already in flight is never hijacked.
    if (e.button === 2) {
      if (!drag.current) {
        rightPan.current = { sx: e.clientX, sy: e.clientY, moved: false };
        drag.current = { kind: 'pan', sx: e.clientX, sy: e.clientY, vx: view.x, vy: view.y };
        gesturePid.current = e.pointerId;
      }
      return;
    }
    // Capture EVERY pointer, including ones we go on to ignore: capture is
    // what guarantees the matching pointerup/cancel reaches this element, so
    // the touch map can never leak an entry (a leaked entry would make the
    // next lone finger read as a two-finger pinch). It THROWS if the browser
    // no longer has that pointer (a contact already released, a synthesised
    // event), and an exception here would abandon the whole gesture before it
    // starts: capture is an improvement to a gesture, never its precondition.
    try {
      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    } catch (err) { /* uncaptured is still workable */ }

    if (e.pointerType === 'pen') {
      penSeen.current = Date.now();
      // Palm-first: the hand often lands an instant before the pen tip. The
      // touch gesture the palm started is noise; drop it and let the pen own
      // the canvas.
      if (drag.current && !gesturePen.current) {
        drag.current = null;
        gesturePid.current = null;
        setDrawing(null);
        setShapeDraft(null);
      }
    }
    if (e.pointerType === 'touch') {
      touchPts.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
      // Palm rejection: while a pen is drawing, or was on or near the glass
      // within the last moment (hover fires pointermove), a touch contact is
      // a resting hand. Ignore it entirely; even panning under the pen would
      // yank the canvas mid-stroke.
      if (gesturePen.current || Date.now() - penSeen.current < 800) return;
      // A third finger changes nothing about an ongoing pinch.
      if (drag.current?.kind === 'pinch' || drag.current?.kind === 'pinchsize') return;
      if (touchPts.current.size === 2) {
        // Second finger: whatever the first finger was doing becomes a
        // pinch, and any in-flight stroke was the start of that pinch, not
        // ink, so it is discarded rather than committed.
        setDrawing(null);
        setShapeDraft(null);
        const [a, b] = [...touchPts.current.values()];
        const d0 = Math.hypot(a.x - b.x, a.y - b.y) || 1;
        // With something selected, two fingers resize THAT and leave the page
        // where it is; with nothing selected they zoom the page. That is the
        // split that matches what the hand means: you have already said what
        // you are working on.
        pendingClear.current = false;
        const start = selectionStart();
        if (start.length) {
          gestureSnapped.current = false;
          drag.current = { kind: 'pinchsize', d0, start };
          gesturePid.current = null;
          return;
        }
        const r = wrap.current?.getBoundingClientRect();
        const mx = (a.x + b.x) / 2 - (r?.left || 0);
        const my = (a.y + b.y) / 2 - (r?.top || 0);
        const v = viewRef.current;
        drag.current = { kind: 'pinch', d0,
                         z0: v.zoom, wx: (mx - v.x) / v.zoom, wy: (my - v.y) / v.zoom };
        gesturePid.current = null;
        return;
      }
    }

    const target = e.target as HTMLElement;
    const onBlock = target.closest('[data-block]') as HTMLElement | null;
    const onHandle = target.closest('[data-handle]');
    // Remember what this gesture began on. The canvas dblclick handler
    // cannot ask that question for itself: see downOn's comment.
    downOn.current = { block: (onBlock && onBlock.dataset.block) || null,
                       ui: !!(onBlock || onHandle) };
    gesturePid.current = e.pointerId;
    gesturePen.current = e.pointerType === 'pen';

    // Middle button, the hand tool and the space bar always pan, whatever is
    // under the cursor.
    if (e.button === 1 || tool === 'hand' || spaceDown.current) {
      drag.current = { kind: 'pan', sx: e.clientX, sy: e.clientY, vx: view.x, vy: view.y };
      return;
    }
    if (e.button !== 0) return;
    const w = worldAt(e);

    // Stylus mode: fingers never draw. One finger pans (two pinch), and only
    // the pen or a mouse reaches the drawing tools below.
    if (penOnly && e.pointerType === 'touch' && DRAW_TOOLS.includes(tool)) {
      drag.current = { kind: 'pan', sx: e.clientX, sy: e.clientY, vx: view.x, vy: view.y };
      return;
    }

    if (tool === 'pen' || tool === 'highlighter') {
      setDrawing([[w.x, w.y]]);
      drag.current = { kind: 'ink' };
      return;
    }
    if (tool === 'eraser') {
      gestureSnapped.current = false;
      drag.current = { kind: 'erase' };
      eraseAt(w.x, w.y);
      return;
    }
    if (SHAPES.includes(tool)) {
      setShapeDraft({ shape: tool as ShapeKind, x1: w.x, y1: w.y, x2: w.x, y2: w.y });
      drag.current = { kind: 'shape' };
      return;
    }
    if (tool === 'text' || tool === 'sticky' || tool === 'code' || tool === 'math') {
      // Cancel the native mousedown that follows this pointerdown: its
      // default action moves focus to the canvas AFTER the layout effect has
      // focused the new block's textarea, so typing right after "T, click"
      // fell through to the tool shortcuts instead of the block (caught in
      // simulation: typing "GARCH" armed the rect/hand/arrow tools).
      e.preventDefault();
      setSel(addAt(tool, w.x, w.y));
      setTool('select');
      return;
    }

    if (onHandle && sel) {
      const b = doc.blocks.find((x) => x.id === sel);
      if (b) {
        gestureSnapped.current = false;
        const corner = (onHandle as HTMLElement).dataset.handle || 'br';
        drag.current = { kind: 'resize', id: b.id,
                         ax: corner.includes('l') ? b.x + b.w : b.x,
                         ay: corner.includes('t') ? b.y + b.h : b.y,
                         bw: b.w, bh: b.h };
        return;
      }
    }
    if (onBlock) {
      pendingClear.current = false;
      const id = onBlock.dataset.block!;
      const b = doc.blocks.find((x) => x.id === id);
      // Shift (or ctrl/cmd) toggles this block in and out of the selection;
      // a plain press on a block that is ALREADY in a multi-selection keeps
      // the group, so dragging six blocks does not collapse to dragging one.
      let ids = selRef.current;
      if (e.shiftKey || e.ctrlKey || e.metaKey) {
        ids = ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id];
        setSelIds(ids);
        setEditing(null);
        // A toggle is not the start of a drag: releasing over the block would
        // otherwise re-run selection logic on a group the user just changed.
        return;
      }
      // A SECOND click on a block that is already the only thing selected
      // opens it for typing. Double-click still works, but nobody expects to
      // have to find the second click fast enough to write in a box they are
      // already pointing at, and on a maths block, whose whole content is the
      // LaTeX, that read as "the equation does not work".
      const writable = b && (b.type === 'text' || b.type === 'math');
      if (writable && ids.length === 1 && ids[0] === id && editing !== id) {
        e.preventDefault();
        setEditing(id);
        if (b.type === 'math') setPalette(true);
        return;
      }
      if (!ids.includes(id)) { ids = [id]; setSelIds(ids); }
      if (editing && editing !== id) setEditing(null);
      if (b && editing !== id) {
        gestureSnapped.current = false;
        const at = doc.blocks.filter((x) => ids.includes(x.id))
          .map((x) => ({ id: x.id, bx: x.x, by: x.y }));
        drag.current = { kind: 'move', id, ox: w.x, oy: w.y, at };
      }
      return;
    }
    // Empty canvas. A PLAIN drag pans, with a mouse exactly as with a finger:
    // that is what this canvas has always done and what the hand reaches for
    // (a build where only touch panned felt broken with a mouse). The rubber
    // band moves onto Shift (or
    // ctrl/cmd), which is where a marquee lives in most editors and, unlike
    // the reverse, costs nothing to anyone who never wants it.
    const band = e.shiftKey || e.ctrlKey || e.metaKey;
    if (!band) {
      // A finger defers the clear (it may be finger one of a resize); a mouse,
      // which cannot grow a second contact, clears now.
      if (e.pointerType === 'touch') pendingClear.current = true;
      else { setSelIds([]); setEditing(null); }
      drag.current = { kind: 'pan', sx: e.clientX, sy: e.clientY, vx: view.x, vy: view.y };
      return;
    }
    // A finger cannot hold Shift, so touch keeps panning here too.
    if (e.pointerType === 'touch') {
      drag.current = { kind: 'pan', sx: e.clientX, sy: e.clientY, vx: view.x, vy: view.y };
      return;
    }
    setMarquee({ x1: w.x, y1: w.y, x2: w.x, y2: w.y });
    // The band replaces the selection; shift-clicking blocks is how you add
    // to one. Keeping both on the same modifier made "did that add or start
    // over?" unanswerable without watching the outlines.
    drag.current = { kind: 'marquee', ax: w.x, ay: w.y, add: [] };
  }, [doc, tool, view.x, view.y, sel, editing, addAt, worldAt, snapshot, eraseAt,
      penOnly, setSel]);

  const onPointerMove = useCallback((e: React.PointerEvent) => {
    if (e.pointerType === 'pen') penSeen.current = Date.now();
    if (e.pointerType === 'touch' && touchPts.current.has(e.pointerId)) {
      touchPts.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    }
    const g = drag.current;
    if (!g) return;
    if (g.kind === 'pinchsize') {
      if (touchPts.current.size < 2) return;
      const [a, b] = [...touchPts.current.values()];
      if (!gestureSnapped.current) { snapshot(); gestureSnapped.current = true; }
      scaleSelectionTo((Math.hypot(a.x - b.x, a.y - b.y) || 1) / g.d0, g.start);
      return;
    }
    if (g.kind === 'pinch') {
      if (touchPts.current.size < 2) return;
      const [a, b] = [...touchPts.current.values()];
      const r = wrap.current?.getBoundingClientRect();
      const mx = (a.x + b.x) / 2 - (r?.left || 0);
      const my = (a.y + b.y) / 2 - (r?.top || 0);
      const z = clamp(g.z0 * (Math.hypot(a.x - b.x, a.y - b.y) || 1) / g.d0, MIN_ZOOM, MAX_ZOOM);
      // The world point the pinch started around stays under the fingers'
      // midpoint, so spreading zooms and moving both fingers pans, in one
      // gesture, exactly the phone contract.
      setView({ zoom: z, x: mx - g.wx * z, y: my - g.wy * z });
      return;
    }
    // Only the pointer that started the gesture may drive it; a palm or a
    // stray finger arriving mid-stroke changes nothing.
    if (gesturePid.current !== null && e.pointerId !== gesturePid.current) return;
    if (g.kind === 'pan') {
      if (rightPan.current && Math.abs(e.clientX - rightPan.current.sx)
          + Math.abs(e.clientY - rightPan.current.sy) > 6) {
        rightPan.current.moved = true;
      }
      setView((v) => ({ ...v, x: g.vx + (e.clientX - g.sx), y: g.vy + (e.clientY - g.sy) }));
      return;
    }
    const w = worldAt(e);
    if (g.kind === 'ink') {
      // Pens sample faster than the frame rate and the browser folds the
      // between-frame samples into coalesced events; using them keeps a fast
      // stroke a curve instead of a chain of straight segments.
      const ne = e.nativeEvent as PointerEvent;
      const evs = typeof ne.getCoalescedEvents === 'function' ? ne.getCoalescedEvents() : [];
      const pts = (evs.length ? evs : [ne]).map((ev) => {
        const q = worldAt(ev);
        return [q.x, q.y];
      });
      setDrawing((p) => (p ? [...p, ...pts] : pts));
    } else if (g.kind === 'erase') {
      eraseAt(w.x, w.y);
    } else if (g.kind === 'shape') {
      setShapeDraft((s) => (s ? { ...s, x2: w.x, y2: w.y } : s));
    } else if (g.kind === 'marquee') {
      setMarquee({ x1: g.ax, y1: g.ay, x2: w.x, y2: w.y });
    } else if (g.kind === 'move') {
      // The whole gesture is one undo step, snapshotted from the pre-move
      // state on the first real move (docRef still holds it here). Every
      // block in the selection moves by the SAME delta, off its own recorded
      // start, so the group keeps its shape however far it is dragged.
      if (!gestureSnapped.current) { snapshot(); gestureSnapped.current = true; }
      const dx = w.x - g.ox, dy = w.y - g.oy;
      const at = new Map(g.at.map((s) => [s.id, s]));
      mutate((bs) => bs.map((b) => {
        const s = at.get(b.id);
        return s ? { ...b, x: s.bx + dx, y: s.by + dy } as Block : b;
      }));
    } else if (g.kind === 'resize') {
      if (!gestureSnapped.current) { snapshot(); gestureSnapped.current = true; }
      const b = docRef.current?.blocks.find((x) => x.id === g.id);
      let nw = Math.max(MIN_BLOCK_W, Math.abs(w.x - g.ax));
      let nh = Math.max(MIN_BLOCK_H, Math.abs(w.y - g.ay));
      // Photos keep their aspect ratio under any corner; Shift resizes free.
      // Text and shapes stay free by default (reflowing a paragraph is the
      // point of resizing it).
      if (b?.type === 'image' && !e.shiftKey && g.bw > 0 && g.bh > 0) {
        const s = Math.max(nw / g.bw, nh / g.bh);
        nw = Math.max(MIN_BLOCK_W, g.bw * s);
        nh = Math.max(MIN_BLOCK_H, g.bh * s);
      }
      // The block always spans from the fixed anchor corner to the dragged
      // one, so dragging past the anchor mirrors cleanly instead of jamming.
      patch(g.id, { w: nw, h: nh,
                    x: w.x < g.ax ? g.ax - nw : g.ax,
                    y: w.y < g.ay ? g.ay - nh : g.ay } as Partial<Block>);
    }
  }, [patch, mutate, worldAt, eraseAt, snapshot, scaleSelectionTo]);

  const onPointerUp = useCallback((e: React.PointerEvent) => {
    if (e.pointerType === 'touch') touchPts.current.delete(e.pointerId);
    const g0 = drag.current;
    if (g0?.kind === 'pinchsize') {
      // A resize ends when the second finger goes: there is nothing sensible
      // for one finger to carry on doing to a size.
      if (touchPts.current.size < 2) drag.current = null;
      return;
    }
    if (g0?.kind === 'pinch') {
      // One finger left: the pinch degrades to a plain pan under it, so
      // lifting one finger mid-gesture never jolts the canvas. Ignored palm
      // contacts also route through here and just leave the map.
      if (touchPts.current.size === 1) {
        const [[pid, p]] = [...touchPts.current.entries()];
        drag.current = { kind: 'pan', sx: p.x, sy: p.y,
                         vx: viewRef.current.x, vy: viewRef.current.y };
        gesturePid.current = pid;
      } else if (touchPts.current.size === 0) {
        drag.current = null;
      }
      return;
    }
    // A lifted palm or stray finger must not end the pen's gesture.
    if (gesturePid.current !== null && e.pointerId !== gesturePid.current) return;
    if (rightPan.current) {
      const rp = rightPan.current;
      rightPan.current = null;
      rightPanDone.current = { moved: rp.moved };
      const pm = pendingMenu.current;
      pendingMenu.current = null;
      if (pm && !rp.moved) openMenuAt(pm);
    }
    // A deferred clear lands here: the finger came down on empty canvas, no
    // second finger followed, and it did not travel far enough to be a pan.
    if (pendingClear.current) {
      pendingClear.current = false;
      const g1 = drag.current;
      const moved = g1?.kind === 'pan'
        ? Math.abs(e.clientX - g1.sx) + Math.abs(e.clientY - g1.sy) : 99;
      if (moved < 8) { setSelIds([]); setEditing(null); }
    }
    gesturePid.current = null;
    gesturePen.current = false;
    const g = drag.current;
    drag.current = null;
    if (g?.kind === 'marquee') {
      const m = marqueeRef.current;
      setMarquee(null);
      const d = docRef.current;
      if (m && d) {
        const x0 = Math.min(m.x1, m.x2), x1 = Math.max(m.x1, m.x2);
        const y0 = Math.min(m.y1, m.y2), y1 = Math.max(m.y1, m.y2);
        // A tap, not a band: leave the selection the click already cleared.
        if ((x1 - x0) * viewRef.current.zoom > 4 || (y1 - y0) * viewRef.current.zoom > 4) {
          // TOUCHED, not enclosed: a band that clips a long stroke should
          // take it. Enclosure-only selection is the single most complained
          // about behaviour in canvas apps.
          const inside = d.blocks.filter((b) => b.x < x1 && b.x + b.w > x0
                                             && b.y < y1 && b.y + b.h > y0)
            .map((b) => b.id);
          const keep = g.add.filter((id) => !inside.includes(id));
          setSelIds([...keep, ...inside]);
        }
      }
      return;
    }
    if (g?.kind === 'ink' && drawing && drawing.length) {
      const { x0, y0, x1, y1 } = inkBounds(drawing);
      // Ink is stored relative to its own bounding box, so moving a stroke is
      // the same operation as moving a photo: change x/y, touch nothing else.
      const hl = penOpts.highlighter;
      add({ id: uid(), type: 'ink', x: x0, y: y0,
            w: Math.max(1, x1 - x0), h: Math.max(1, y1 - y0),
            points: drawing.map(([px, py]) => [px - x0, py - y0]),
            color: penOpts.color || 'currentColor',
            // The highlighter is the same stroke, wide and translucent; width
            // scales off the pen setting so every nib has a marker.
            width: hl ? penOpts.width * 5 : penOpts.width,
            mode: hl ? 'highlighter' : 'pen' });
      setDrawing(null);
    }
    if (g?.kind === 'shape' && shapeDraft) {
      const s = shapeDraft;
      const x0 = Math.min(s.x1, s.x2), y0 = Math.min(s.y1, s.y2);
      const wS = Math.abs(s.x2 - s.x1), hS = Math.abs(s.y2 - s.y1);
      setShapeDraft(null);
      // A click with no drag draws nothing: a zero-size rectangle is never
      // what was meant, and it would be an invisible, unfindable block.
      if (wS < 3 && hS < 3) return;
      // Lines get padding around the bounding box so a horizontal or vertical
      // line is not a 1px-tall div nobody can click on again.
      const pad = (s.shape === 'line' || s.shape === 'arrow') ? 6 : 0;
      add({ id: uid(), type: 'shape', shape: s.shape,
            x: x0 - pad, y: y0 - pad,
            w: Math.max(wS, 1) + pad * 2, h: Math.max(hS, 1) + pad * 2,
            x1: s.x1 - x0 + pad, y1: s.y1 - y0 + pad,
            x2: s.x2 - x0 + pad, y2: s.y2 - y0 + pad,
            ow: Math.max(wS, 1) + pad * 2, oh: Math.max(hS, 1) + pad * 2,
            color: shapeOpts.color || 'currentColor', width: shapeOpts.width,
            dash: shapeOpts.dash || undefined,
            fill: shapeOpts.fill || undefined });
    }
  }, [drawing, add, penOpts, shapeDraft, shapeOpts, openMenuAt]);

  // The pen tool and the highlighter tool are the same stroke engine with a
  // different nib, so arming either one sets the flag the commit path reads.
  useEffect(() => {
    if (tool === 'pen' || tool === 'highlighter') {
      setPenOpts((p) => (p.highlighter === (tool === 'highlighter') ? p
        : { ...p, highlighter: tool === 'highlighter' }));
    }
  }, [tool]);

  // ---- keyboard, paste, drop ---------------------------------------------
  // Nudge undo grouping: holding an arrow key fires dozens of keydowns, and
  // one snapshot per keydown floods the history; a burst within a second is
  // one undo step.
  const lastNudge = useRef(0);
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      const typing = t && (t.tagName === 'TEXTAREA' || t.tagName === 'INPUT');
      if (e.key === 'Escape') {
        if (optsOpenRef.current) { setOptsOpen(false); return; }
        if (grpRef.current) { setGrp(null); return; }
        if (paperMenuRef.current) { setPaperMenu(false); return; }
        if (menuRef.current) { setMenu(null); return; }
        if (editing) { setEditing(null); return; }
        // Escape also drops back to the pointer. Tools stay armed after a
        // stroke (drawing one line at a time would be worse), so without a
        // way out the pen keeps drawing when you meant to move something.
        setSelIds([]);
        setTool('select');
        return;
      }
      // Space pans from anywhere while held, including over a block, which is
      // the escape hatch now that an empty-canvas mouse drag rubber-bands.
      if (e.code === 'Space' && !typing) {
        spaceDown.current = true;
        if (!e.repeat) e.preventDefault();
      }
      const k = e.key.toLowerCase();
      // Undo/redo work even while a textarea has focus: the textarea's own
      // undo stack dies when the block re-renders, so ours is the real one.
      if ((e.ctrlKey || e.metaKey) && k === 'z') {
        e.preventDefault();
        if (e.shiftKey) redo(); else undo();
        return;
      }
      if ((e.ctrlKey || e.metaKey) && k === 'y') { e.preventDefault(); redo(); return; }
      // Select everything on the canvas.
      if ((e.ctrlKey || e.metaKey) && k === 'a' && !typing) {
        e.preventDefault();
        setSelIds((docRef.current?.blocks || []).map((b) => b.id));
        return;
      }
      if (typing) return;
      if ((e.key === 'Delete' || e.key === 'Backspace') && selRef.current.length) {
        e.preventDefault();
        removeSelection();
        return;
      }
      // Arrow keys nudge the selection: 1 world px, 10 with Shift.
      if (selRef.current.length
          && ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.key)) {
        e.preventDefault();
        const now = Date.now();
        if (now - lastNudge.current > 1000) snapshot();
        lastNudge.current = now;
        const d = e.shiftKey ? 10 : 1;
        const dx = e.key === 'ArrowLeft' ? -d : e.key === 'ArrowRight' ? d : 0;
        const dy = e.key === 'ArrowUp' ? -d : e.key === 'ArrowDown' ? d : 0;
        const ids = new Set(selRef.current);
        mutate((bs) => bs.map((b) => (ids.has(b.id)
          ? { ...b, x: b.x + dx, y: b.y + dy } as Block : b)));
        return;
      }
      // Single-letter tools, the shape every canvas app uses. Keys are the
      // first letter of the tool wherever that was free; the dropdowns in the
      // toolbar carry the same letters so the two agree.
      const map: Record<string, Tool> = { v: 'select', h: 'hand', t: 'text',
                                          n: 'sticky', c: 'code', m: 'math',
                                          p: 'pen', g: 'highlighter', e: 'eraser',
                                          l: 'line', a: 'arrow', r: 'rect',
                                          o: 'ellipse', y: 'triangle',
                                          d: 'diamond', s: 'star', i: 'image' };
      if (map[k] && !e.ctrlKey && !e.metaKey && !e.altKey) {
        if (k === 'i') fileIn.current?.click();
        else armOrToggle(map[k]);
      }
      if ((e.ctrlKey || e.metaKey) && k === 'd' && selRef.current.length) {
        e.preventDefault();
        duplicateSelection();
      }
      // Block copy: the blocks themselves ride in CLIP (the OS clipboard
      // cannot carry a canvas object), and a MARKER string goes to the OS
      // clipboard so Ctrl+V routes through the paste event below like every
      // other paste. Routing on the marker is what keeps one Ctrl+V from
      // firing both a block paste and a stale-OS-text paste, and it means
      // copying text in another app naturally wins over an older block copy.
      if ((e.ctrlKey || e.metaKey) && k === 'c' && selRef.current.length) {
        const ids = selRef.current;
        const bs = (docRef.current?.blocks || []).filter((b) => ids.includes(b.id));
        if (bs.length) {
          CLIP = JSON.parse(JSON.stringify(bs));
          navigator.clipboard?.writeText?.(CLIP_MARK).catch(() => { /* paste falls back to OS content */ });
        }
      }
      if ((e.ctrlKey || e.metaKey) && k === '0') { e.preventDefault(); fit(); }
    };
    const keyUp = (e: KeyboardEvent) => {
      if (e.code === 'Space') spaceDown.current = false;
    };
    const paste = (e: ClipboardEvent) => {
      if (!docRef.current) return;
      const t = e.target as HTMLElement;
      if (t && (t.tagName === 'TEXTAREA' || t.tagName === 'INPUT')) return;
      for (const it of Array.from(e.clipboardData?.items || [])) {
        if (it.type.startsWith('image/')) {
          const f = it.getAsFile();
          if (f) { e.preventDefault(); upload(f); return; }
        }
      }
      const txt = e.clipboardData?.getData('text/plain');
      if (txt === CLIP_MARK && CLIP?.length) {
        e.preventDefault();
        // A multi-block paste keeps the group's internal layout and lands
        // centred on the view, so six copied blocks arrive as the same six
        // blocks and not as a stack on one point.
        const p = centreWorld();
        const gx = Math.min(...CLIP.map((b) => b.x));
        const gy = Math.min(...CLIP.map((b) => b.y));
        const gw = Math.max(...CLIP.map((b) => b.x + b.w)) - gx;
        const gh = Math.max(...CLIP.map((b) => b.y + b.h)) - gy;
        const copies = CLIP.map((b) => ({ ...JSON.parse(JSON.stringify(b)), id: uid(),
          x: b.x - gx + p.x - gw / 2, y: b.y - gy + p.y - gh / 2 } as Block));
        snapshot();
        dirty.current = true;
        setDoc((cur) => (cur ? { ...cur, blocks: [...cur.blocks, ...copies] } : cur));
        setSelIds(copies.map((c) => c.id));
        return;
      }
      if (txt) {
        const p = centreWorld();
        const id = uid();
        add({ id, type: 'text', x: p.x - 160, y: p.y - 40, w: 320,
              h: Math.max(90, 24 + txt.split('\n').length * 20), text: txt, size: 15 });
        setSel(id);
      }
    };
    window.addEventListener('keydown', key);
    window.addEventListener('keyup', keyUp);
    window.addEventListener('paste', paste);
    return () => {
      window.removeEventListener('keydown', key);
      window.removeEventListener('keyup', keyUp);
      window.removeEventListener('paste', paste);
    };
  }, [editing, mutate, add, upload, centreWorld, fit, undo, redo, removeSelection,
      duplicateSelection, snapshot, setSel, armOrToggle]);

  const onDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    if (!doc) return;
    const at = worldAt(e);
    // A saved equation dragged off the palette lands where it was dropped.
    const eq = e.dataTransfer.getData('application/x-lse-eq');
    if (eq) {
      try {
        const { latex, size } = JSON.parse(eq);
        const nid = uid();
        add({ id: nid, type: 'math', x: at.x - 190, y: at.y - 65, w: 380, h: 130,
              latex: String(latex || ''), size: isFinite(size) ? size : 30 } as Block);
        setSel(nid);
      } catch (err) { /* malformed payload: ignore the drop */ }
      return;
    }
    for (const f of Array.from(e.dataTransfer.files || [])) {
      if (f.type.startsWith('image/')) upload(f, at);
    }
  }, [doc, upload, worldAt, add, setSel]);

  // Focus the editor the moment a block enters edit mode: a new text block you
  // have to click again before typing is a block you did not really create.
  useLayoutEffect(() => {
    if (editing && editRef.current) {
      const ta = editRef.current;
      ta.focus();
      const n = ta.value.length;
      ta.setSelectionRange(n, n);
      // Belt and braces for the same focus steal preventDefault covers: if
      // anything (a late default action, a browser quirk) moved focus off
      // the editor within the same frame, take it back once.
      requestAnimationFrame(() => {
        if (editRef.current === ta && document.activeElement !== ta) ta.focus();
      });
    }
  }, [editing]);

  // One snapshot per editing session, taken as the session STARTS, so a
  // paragraph of typing is one undo step (each keystroke patches the doc).
  const editedRef = useRef<string | null>(null);
  useEffect(() => {
    if (editing && editing !== editedRef.current) snapshot();
    editedRef.current = editing;
  }, [editing, snapshot]);

  /** Insert palette text at the caret of whatever block is being edited, and
   *  if nothing is open, START an equation with it. A symbol that does
   *  nothing because no block happens to have focus is the palette "not
   *  working"; clicking π is a clear instruction to write
   *  π somewhere, so we make the somewhere. */
  const insert = useCallback((snippet: string) => {
    const ta = editRef.current;
    const id = editing;
    if (!ta || !id) {
      const p = centreWorld();
      const nid = uid();
      const body = snippet.replace('@', '');
      add({ id: nid, type: 'math', x: p.x - 190, y: p.y - 65,
            w: 380, h: 130, latex: body, size: 30 });
      setSel(nid);
      setEditing(nid);
      // The caret goes where the snippet asked for it, once the new block's
      // textarea exists (the layout effect focuses it on the next frame).
      const caretMark = snippet.indexOf('@');
      const caret = caretMark >= 0 ? caretMark : body.length;
      requestAnimationFrame(() => requestAnimationFrame(() => {
        const t = editRef.current;
        if (t) { t.focus(); t.setSelectionRange(caret, caret); }
      }));
      return;
    }
    const caretMark = snippet.indexOf('@');
    const body = snippet.replace('@', '');
    const s = ta.selectionStart;
    const e2 = ta.selectionEnd;
    const next = ta.value.slice(0, s) + body + ta.value.slice(e2);
    const b = docRef.current?.blocks.find((x) => x.id === id);
    if (!b) return;
    patch(id, (b.type === 'math' ? { latex: next } : { text: next }) as Partial<Block>);
    const caret = s + (caretMark >= 0 ? caretMark : body.length);
    requestAnimationFrame(() => { ta.focus(); ta.setSelectionRange(caret, caret); });
  }, [editing, patch, add, centreWorld, setSel]);

  // The panel edits ONE block; a multi-selection gets the group panel below,
  // which fans its changes out over everything selected.
  const selBlock = (selIds.length === 1
    && doc?.blocks.find((b) => b.id === selIds[0])) || null;
  const selBlocks = useMemo(
    () => (doc?.blocks.filter((b) => selIds.includes(b.id)) || []),
    [doc, selKey]);
  const editBlock = doc?.blocks.find((b) => b.id === editing) || null;

  // ---- AI vision ----------------------------------------------------------
  // Publish the open canvas to the shell's screen map (AI_REGIONS reads
  // window.__lseAiIslands.notebooks). Text and maths are reported in reading
  // order (rows top to bottom, left to right within a row) because block
  // ARRAY order is paint order, which is meaningless to a reader. Capped so
  // a huge canvas cannot eat the assistant's prompt; the `more` pointer on
  // the region tells agents where the full document lives.
  useEffect(() => {
    const w = window as unknown as { __lseAiIslands?: Record<string, unknown> };
    const d = doc;
    let openDoc: Record<string, unknown> | null = null;
    if (d) {
      const counts: Record<string, number> = {};
      for (const b of d.blocks) counts[b.type] = (counts[b.type] || 0) + 1;
      const readables = d.blocks
        .filter((b): b is TextBlock | MathBlock => b.type === 'text' || b.type === 'math')
        .sort((a, b) => (Math.round(a.y / 60) - Math.round(b.y / 60)) || (a.x - b.x));
      let budget = 4000;
      const content: Array<Record<string, unknown>> = [];
      for (const b of readables) {
        if (budget <= 0) { content.push({ note: 'more blocks truncated' }); break; }
        const body = (b.type === 'text' ? b.text : b.latex).slice(0, 400);
        budget -= body.length;
        content.push(b.type === 'text'
          ? { text: body, size: b.size, ...(b.color ? { color: b.color } : {}) }
          : { latex: body, size: b.size });
      }
      openDoc = {
        id: d.id, name: d.name,
        blocks: counts,
        content,
        images: d.blocks.filter((b): b is ImageBlock => b.type === 'image')
          .map((b) => b.name || 'pasted image').slice(0, 20),
        zoom: Math.round(view.zoom * 100) / 100,
        paper: d.paper || 'theme',
        ruling: d.pattern || 'dots',
        selected: selBlock ? selBlock.type : null,
        editing: !!editing,
      };
    }
    (w.__lseAiIslands ||= {}).notebooks = {
      notebooks: list.length,
      open: openDoc,
      tool,
      hosted,
    };
    return () => { if (w.__lseAiIslands) delete w.__lseAiIslands.notebooks; };
  }, [doc, list, tool, view.zoom, selBlock, editing, hosted]);

  // ---- render -------------------------------------------------------------
  const anySel = selIds.length > 0;
  const showPenBar = optsOpen && !anySel
    && (tool === 'pen' || tool === 'highlighter' || tool === 'eraser');
  const showShapeBar = optsOpen && !anySel && SHAPES.includes(tool);
  // Panel positions are in nb-main coordinates (the panels are siblings of
  // the canvas, floating over it). The selection panel anchors just above
  // the tapped block unless dragged; the tool palette sits where it was
  // parked, re-clamped each render so a saved position from a bigger window
  // still lands on screen.
  const panelAnchor = selBlock || (selBlocks.length ? {
    x: Math.min(...selBlocks.map((b) => b.x)),
    y: Math.min(...selBlocks.map((b) => b.y)),
  } : null);
  const selPanelXY = useMemo(() => {
    if (!panelAnchor) return null;
    if (selPos) return selPos;
    const w = wrap.current;
    const dx = w?.offsetLeft || 0, dy = w?.offsetTop || 0;
    const ch = w?.clientHeight || 600;
    // Clear the block by the card's MEASURED height. A fixed 150px offset was
    // written when the tallest card was ~96px; the redesigned cards run to
    // ~255px, so the card was landing ON the block it edits: the second click
    // that opens an equation hit the card instead of the block, and the top
    // resize handles were unreachable (traced by hit-testing the block's own
    // centre after a select).
    const bx = dx + view.x + panelAnchor.x * view.zoom;
    const topScreen = dy + view.y + panelAnchor.y * view.zoom;
    const h = selBlock ? selBlock.h
      : Math.max(...selBlocks.map((b) => b.y + b.h)) - panelAnchor.y;
    const botScreen = dy + view.y + (panelAnchor.y + h) * view.zoom;
    const GAP = 14;
    let y = topScreen - panelBox.h - GAP;
    if (y < dy + 6) {
      const below = botScreen + GAP;
      // Below only if the WHOLE card fits there; otherwise the block is
      // taller than the room around it and every position overlaps, so take
      // the canvas top, which leaves the most of the block visible and keeps
      // the card draggable.
      y = below + panelBox.h <= dy + ch - 6 ? below : dy + 6;
    }
    return clampPanel(bx - 8, y);
  }, [panelAnchor, selBlock, selBlocks, selPos, view, clampPanel, panelBox]);
  const toolXY = clampPanel(toolPos.x, toolPos.y);

  // The canvas surface. Choosing a paper takes the canvas OFF the theme, so
  // everything that used to read a theme variable has to be derived from the
  // paper instead: white paper in dark mode would otherwise put white ink on
  // white, and the ruling and selection outline would vanish. With no paper
  // chosen every value stays undefined and the CSS variables win, which is
  // why an existing notebook looks exactly as it did.
  const paper = doc?.paper || '';
  const pattern: Paper = doc?.pattern || 'dots';
  const lightPaper = paper ? isLightPaper(paper) : false;
  const inkColor = paper ? (lightPaper ? '#14171c' : '#e9ecf1') : undefined;
  const ruleColor = paper ? (lightPaper ? 'rgba(0,0,0,.16)' : 'rgba(255,255,255,.13)')
                          : 'var(--edge)';
  const selEdge = paper ? (lightPaper ? 'rgba(0,0,0,.45)' : 'rgba(255,255,255,.42)')
                        : undefined;
  const ruleImage =
    pattern === 'plain' ? 'none'
    : pattern === 'dots' ? `radial-gradient(circle, ${ruleColor} 1px, transparent 1px)`
    : pattern === 'lines' ? `linear-gradient(${ruleColor} 1px, transparent 1px)`
    : `linear-gradient(${ruleColor} 1px, transparent 1px),`
      + ` linear-gradient(90deg, ${ruleColor} 1px, transparent 1px)`;

  return (
    <div className="nb-wrap">
      <style>{NB_CSS}</style>

      {/* Library rail: the same shape as the IDE explorer. The notebook list
          leads (this page's own domain), and the shell renders the full
          library tree (WORKSPACE + DATA) into #nb-lib beneath it, so the
          whole library is visible from here exactly as it is from the IDE
          (the notebook page must show there is more to the platform than
          the canvas). React never touches #nb-lib's children, so the
          shell-owned DOM inside it survives re-renders. */}
      <div className="nb-rail">
        <div className="nb-rail-head">
          <span>NOTEBOOKS</span>
          <span className="nb-count">{list.length}</span>
          <button className="nb-plus" title="New notebook" onClick={create}>{SB_ICO.plus}</button>
        </div>
        <div className="nb-rail-scroll">
        <div className="nb-rail-list">
          {!list.length && (
            <div className="nb-rail-empty">
              No notebooks yet.
              <button onClick={create}>New notebook</button>
            </div>
          )}
          {list.map((m) => (
            <div key={m.id} className={'nb-row' + (doc?.id === m.id ? ' active' : '')}>
              {renaming === m.id ? (
                <input
                  className="nb-rename"
                  defaultValue={m.name}
                  autoFocus
                  onFocus={(e) => e.currentTarget.select()}
                  onBlur={(e) => {
                    const name = e.currentTarget.value.trim() || m.name;
                    setRenaming(null);
                    if (name === m.name) return;
                    if (docRef.current?.id === m.id) {
                      dirty.current = true;
                      setDoc((d) => (d ? { ...d, name } : d));
                    } else {
                      fetch('/api/notebooks/' + m.id).then((r) => r.json()).then((d) =>
                        fetch('/api/notebooks/' + m.id, {
                          method: 'PUT', headers: { 'Content-Type': 'application/json' },
                          body: JSON.stringify({ ...d, name }),
                        })).then(loadList);
                    }
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') e.currentTarget.blur();
                    if (e.key === 'Escape') { setRenaming(null); }
                  }}
                />
              ) : (
                <button className="nb-row-main" onClick={() => open(m.id)}
                        onDoubleClick={() => setRenaming(m.id)}>
                  <span className="nb-row-name">{m.name}</span>
                  <span className="nb-row-meta">
                    {m.blocks} {m.blocks === 1 ? 'item' : 'items'}
                    {m.updated_at ? ' · ' + ago(m.updated_at) : ''}
                  </span>
                </button>
              )}
              <span className="nb-row-acts">
                <button title="Rename" onClick={() => setRenaming(m.id)}>&#9998;</button>
                <button title="Delete notebook" onClick={() => remove(m.id)}>&#10005;</button>
              </span>
            </div>
          ))}
        </div>
        <div id="nb-lib" className="nb-lib" />
        </div>
      </div>

      {/* Canvas side */}
      <div className="nb-main">
        {!doc ? (
          <div className="nb-blank">
            <div className="nb-blank-title">An infinite page for your research.</div>
            {(hosted || !list.length) && (
              <div className="nb-blank-sub">
                {hosted
                  ? 'Notebooks are saved on your own machine, so they need the '
                    + 'downloaded app. This page is the hosted preview.'
                  : 'Write, drop photos in, draw on it, and set maths in real '
                    + 'notation. Everything is stored on this machine.'}
              </div>
            )}
            {/* Landing with notebooks on disk shows THEM, not a bare button:
                the page opens on your work, one click from continuing it.
                The list is already newest-first. */}
            {!hosted && list.length > 0 ? (
              <div className="nb-recent">
                <button className="nb-recent-card nb-recent-new" onClick={create}>
                  <span className="nb-recent-plus">+</span>
                  <span>New notebook</span>
                </button>
                {list.slice(0, 11).map((m) => (
                  <button key={m.id} className="nb-recent-card" onClick={() => open(m.id)}>
                    <span className="nb-recent-name">{m.name}</span>
                    <span className="nb-recent-meta">
                      {m.blocks} {m.blocks === 1 ? 'item' : 'items'}
                      {m.updated_at ? ' · ' + ago(m.updated_at) : ''}
                    </span>
                  </button>
                ))}
              </div>
            ) : (!hosted && <button onClick={create}>New notebook</button>)}
            {/* Errors have to land HERE too. With the status line living only
                in the open-notebook toolbar, a failed create on the blank
                screen looked like a dead button. */}
            {!!busy && <div className="nb-blank-err">{busy}</div>}
          </div>
        ) : (
          <>
            <div className="nb-bar">
              <input
                className="nb-title"
                value={doc.name}
                onChange={(e) => { dirty.current = true; setDoc((d) => (d ? { ...d, name: e.target.value } : d)); }}
                spellCheck={false}
              />
              <span className="nb-tools">
                {([['select', 'V', 'Select and move · drag to pan · shift-drag to box-select'],
                   ['hand', 'H', 'Pan the canvas']] as [Tool, string, string][])
                  .map(([t, k, tip]) => (
                    <button
                      key={t}
                      className={'nb-tool' + (tool === t ? ' active' : '')}
                      data-tip={`${tip}  (${k})`}
                      onClick={() => setTool(t)}
                    >{TOOL_ICON[t]}</button>
                  ))}
                <span className="nb-sep" />
                {/* Tools that differ only in what they PRODUCE collapse into
                    one button with a dropdown: the toolbar used to be eleven
                    equal squares and reading it took as long as remembering
                    the shortcut. The button arms the last member you used,
                    the caret opens the rest. */}
                <ToolGroup tool={tool} setTool={armOrToggle} open={grp === 'write'}
                           setOpen={(v) => setGrp(v ? 'write' : null)}
                           fav={isFavTool} onFav={toggleFavTool}
                           members={[['text', 'T', 'Write'],
                                     ['sticky', 'N', 'Sticky note'],
                                     ['code', 'C', 'Code block']]} />
                <button className={'nb-tool' + (tool === 'math' ? ' active' : '')}
                        data-tip="Maths  (M)" onClick={() => armOrToggle('math')}>
                  {TOOL_ICON.math}</button>
                <ToolGroup tool={tool} setTool={armOrToggle} open={grp === 'draw'}
                           setOpen={(v) => setGrp(v ? 'draw' : null)}
                           fav={isFavTool} onFav={toggleFavTool}
                           members={[['pen', 'P', 'Pen'],
                                     ['highlighter', 'G', 'Highlighter']]} />
                {/* The rubber gets its own button: it lived in the draw
                    dropdown and was too easy to miss there. */}
                <button className={'nb-tool' + (tool === 'eraser' ? ' active' : '')}
                        data-tip="Rubber: drag over a drawing to erase it  (E)"
                        onClick={() => armOrToggle('eraser')}>{TOOL_ICON.eraser}</button>
                <ToolGroup tool={tool} setTool={armOrToggle} open={grp === 'shape'}
                           setOpen={(v) => setGrp(v ? 'shape' : null)}
                           fav={isFavTool} onFav={toggleFavTool}
                           members={[['line', 'L', 'Line'],
                                     ['arrow', 'A', 'Arrow'],
                                     ['rect', 'R', 'Rectangle'],
                                     ['ellipse', 'O', 'Ellipse'],
                                     ['triangle', 'Y', 'Triangle'],
                                     ['diamond', 'D', 'Diamond'],
                                     ['star', 'S', 'Star']]} />
                <span className="nb-sep" />
                <button className="nb-tool" data-tip="Place a photo  (I)"
                        onClick={() => fileIn.current?.click()}>{TOOL_ICON.image}</button>
                <button className={'nb-tool' + (palette ? ' active' : '')}
                        data-tip="Maths symbols" onClick={() => setPalette((p) => !p)}>∑</button>
                <button className={'nb-tool' + (paperMenu ? ' active' : '')}
                        data-tip="Paper: background colour and ruling"
                        onClick={() => setPaperMenu((p) => !p)}>{SB_ICO.paper}</button>
                <span className="nb-sep" />
                <button className="nb-tool" data-tip="Undo  (Ctrl+Z)"
                        disabled={!hist.current.past.length} onClick={undo}>
                  <svg viewBox="0 0 16 16" width="17" height="17" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round"><path d="M6.5 3.5L3 7l3.5 3.5M3 7h6a4 4 0 010 8" transform="translate(0,-1.5)" /></svg>
                </button>
                <button className="nb-tool" data-tip="Redo  (Ctrl+Shift+Z)"
                        disabled={!hist.current.future.length} onClick={redo}>
                  <svg viewBox="0 0 16 16" width="17" height="17" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round"><path d="M9.5 3.5L13 7l-3.5 3.5M13 7H7a4 4 0 000 8" transform="translate(0,-1.5)" /></svg>
                </button>
                <button className="nb-tool nb-tool-danger"
                        data-tip="Delete everything on this canvas"
                        disabled={!doc.blocks.length} onClick={clearCanvas}>{SB_ICO.trash}</button>
              </span>
              <span className="nb-status">{busy}</span>
              <span className="nb-zoom">
                <button onClick={() => zoomBy(1 / 1.25)} data-tip="Zoom out">{SB_ICO.minus}</button>
                {/* Below 1% a rounded label reads 0%, which looks broken;
                    show one decimal down there instead. */}
                <button onClick={fit} data-tip="Fit everything  (Ctrl+0)">
                  {view.zoom < 0.01 ? (view.zoom * 100).toFixed(1) : Math.round(view.zoom * 100)}%</button>
                <button onClick={() => zoomBy(1.25)} data-tip="Zoom in">{SB_ICO.plus}</button>
              </span>
            </div>

            {/* Contextual controls as floating cards over the canvas
                (replacing the earlier fixed top rows): tap a
                block and its editor appears right next to it; arm a pen or
                shape tool and the palette floats where the user parked it.
                Both drag by their grip. A selected block shows that block's
                controls; an armed tool shows the defaults the next stroke
                will use. */}
            {/* One block selected: that block's own controls, one labelled
                row per control group. */}
            {selBlock && selPanelXY && (
              <FloatPanel x={selPanelXY.x} y={selPanelXY.y} onMove={moveSelPanel} onSize={onPanelSize}
                          title={selBlock.type === 'image' ? 'PHOTO'
                            : selBlock.type === 'math' ? 'MATHS'
                            : selBlock.type === 'ink' ? 'DRAWING'
                            : selBlock.type === 'shape' ? 'SHAPE'
                            : (selBlock as TextBlock).mono ? 'CODE'
                            : (selBlock as TextBlock).bg ? 'NOTE' : 'TEXT'}>
                {(selBlock.type === 'text' || selBlock.type === 'math') && (
                  <Row label="Size">
                    <button className="nb-sb-btn" data-tip="Smaller"
                            onClick={() => {
                              const cur = selBlock.size;
                              const i = SIZES.findIndex((s) => s >= cur);
                              patchU(selBlock.id, { size: SIZES[Math.max(0, (i < 0 ? SIZES.length - 1 : i) - 1)] } as Partial<Block>);
                            }}>A−</button>
                    {/* Typed, not just stepped: the ladder stops at 72 and
                        someone wants 90 for a title. */}
                    <input className="nb-num" type="number" min={6} max={400} step={1}
                           data-tip="Any size, 6 to 400" value={selBlock.size}
                           onChange={(e) => {
                             const v = parseFloat(e.target.value);
                             if (isFinite(v)) patch(selBlock.id, { size: clamp(v, 6, 400) } as Partial<Block>);
                           }} />
                    <button className="nb-sb-btn" data-tip="Larger"
                            onClick={() => {
                              const cur = selBlock.size;
                              let i = SIZES.findIndex((s) => s > cur);
                              if (i < 0) i = SIZES.length - 1;
                              patchU(selBlock.id, { size: SIZES[i] } as Partial<Block>);
                            }}>A+</button>
                    {selBlock.type === 'text' && (
                      <>
                        <span className="nb-prow-gap" />
                        <button className={'nb-sb-btn' + ((selBlock as TextBlock).bold ? ' on' : '')}
                                data-tip="Bold" style={{ fontWeight: 700 }}
                                onClick={() => patchU(selBlock.id, { bold: !(selBlock as TextBlock).bold || undefined } as Partial<Block>)}>B</button>
                        <button className={'nb-sb-btn' + ((selBlock as TextBlock).italic ? ' on' : '')}
                                data-tip="Italic" style={{ fontStyle: 'italic' }}
                                onClick={() => patchU(selBlock.id, { italic: !(selBlock as TextBlock).italic || undefined } as Partial<Block>)}>I</button>
                        <button className={'nb-sb-btn' + ((selBlock as TextBlock).mono ? ' on' : '')}
                                data-tip="Code: monospaced, no maths pass"
                                onClick={() => patchU(selBlock.id, { mono: !(selBlock as TextBlock).mono || undefined } as Partial<Block>)}>{SB_ICO.code}</button>
                      </>
                    )}
                  </Row>
                )}
                {selBlock.type === 'text' && (
                  <Row label="Align">
                    {(['left', 'center', 'right'] as const).map((a) => (
                      <button key={a}
                              className={'nb-sb-btn' + ((((selBlock as TextBlock).align || 'left') === a) ? ' on' : '')}
                              data-tip={a[0].toUpperCase() + a.slice(1)}
                              onClick={() => patchU(selBlock.id, { align: a === 'left' ? undefined : a } as Partial<Block>)}>
                        {SB_ICO['align' + a[0].toUpperCase() + a.slice(1)]}
                      </button>
                    ))}
                  </Row>
                )}
                {(selBlock.type === 'text' || selBlock.type === 'math') && (
                  <Row label="Colour">
                    <Swatches value={(selBlock as TextBlock).color || ''}
                              onPick={(c) => patchU(selBlock.id, { color: c || undefined } as Partial<Block>)} />
                  </Row>
                )}
                {(selBlock.type === 'text' || selBlock.type === 'math') && (
                  <Row label="Card">
                    <Swatches bg value={(selBlock as TextBlock).bg || ''}
                              onPick={(c) => patchU(selBlock.id, { bg: c || undefined } as Partial<Block>)} />
                  </Row>
                )}
                {selBlock.type === 'ink' && (
                  <>
                    <Row label="Colour">
                      <Swatches value={selBlock.color === 'currentColor' ? '' : selBlock.color}
                                onPick={(c) => patchU(selBlock.id, { color: c || 'currentColor' } as Partial<Block>)} />
                    </Row>
                    <Row label="Width">
                      <Widths value={(selBlock as InkBlock).mode === 'highlighter'
                                ? (selBlock as InkBlock).width / 5 : (selBlock as InkBlock).width}
                              onPick={(wd) => patchU(selBlock.id, {
                                width: (selBlock as InkBlock).mode === 'highlighter' ? wd * 5 : wd,
                              } as Partial<Block>)} />
                      <span className="nb-prow-gap" />
                      <button className={'nb-sb-btn' + ((selBlock as InkBlock).mode === 'highlighter' ? ' on' : '')}
                              data-tip="Highlighter: wide and translucent"
                              onClick={() => {
                                const hl = (selBlock as InkBlock).mode === 'highlighter';
                                const base = hl ? (selBlock as InkBlock).width / 5 : (selBlock as InkBlock).width;
                                patchU(selBlock.id, { mode: hl ? 'pen' : 'highlighter',
                                                      width: hl ? base : base * 5 } as Partial<Block>);
                              }}>{SB_ICO.marker}</button>
                    </Row>
                    <Row label="Maths">
                      <button className="nb-sb-btn"
                              data-tip="Read the drawing as a maths symbol and replace it (Ctrl+Z brings the ink back)"
                              onClick={inkToMaths}>To maths</button>
                    </Row>
                  </>
                )}
                {selBlock.type === 'shape' && (
                  <>
                    <Row label="Colour">
                      <Swatches value={(selBlock as ShapeBlock).color === 'currentColor'
                                  ? '' : ((selBlock as ShapeBlock).color || '')}
                                onPick={(c) => patchU(selBlock.id, { color: c || 'currentColor' } as Partial<Block>)} />
                    </Row>
                    <Row label="Width">
                      <Widths value={(selBlock as ShapeBlock).width || 2}
                              onPick={(wd) => patchU(selBlock.id, { width: wd } as Partial<Block>)} />
                      <span className="nb-prow-gap" />
                      <button className={'nb-sb-btn' + ((selBlock as ShapeBlock).dash ? ' on' : '')}
                              data-tip="Dashed"
                              onClick={() => patchU(selBlock.id, { dash: !(selBlock as ShapeBlock).dash || undefined } as Partial<Block>)}>{SB_ICO.dash}</button>
                    </Row>
                    {CLOSED_SHAPES.includes((selBlock as ShapeBlock).shape) && (
                      <Row label="Fill">
                        <Swatches bg value={(selBlock as ShapeBlock).fill || ''}
                                  onPick={(c) => patchU(selBlock.id, { fill: c || undefined } as Partial<Block>)} />
                      </Row>
                    )}
                  </>
                )}
                {selBlock.type === 'image' && (
                  <Row label="Photo">
                    <button className="nb-sb-btn" data-tip="Flip horizontally"
                            onClick={() => patchU(selBlock.id, { flipH: !(selBlock as ImageBlock).flipH || undefined } as Partial<Block>)}>{SB_ICO.flipH}</button>
                    <button className="nb-sb-btn" data-tip="Flip vertically"
                            onClick={() => patchU(selBlock.id, { flipV: !(selBlock as ImageBlock).flipV || undefined } as Partial<Block>)}>{SB_ICO.flipV}</button>
                    <button className="nb-sb-btn" data-tip="Smaller (or drag a corner)"
                            onClick={() => scaleSel(1 / 1.25)}>{SB_ICO.minus}</button>
                    <button className="nb-sb-btn" data-tip="Bigger (or drag a corner)"
                            onClick={() => scaleSel(1.25)}>{SB_ICO.plus}</button>
                  </Row>
                )}
                <Row>
                  {selBlock.type === 'math' && (
                    <button className="nb-sb-btn" data-tip="Save to your equation library"
                            onClick={() => saveEquation((selBlock as MathBlock).latex, selBlock.size)}>{SB_ICO.book}</button>
                  )}
                  <button className="nb-sb-btn" data-tip="Bring to front"
                          onClick={() => reorder(selBlock.id, true)}>{SB_ICO.front}</button>
                  <button className="nb-sb-btn" data-tip="Send to back"
                          onClick={() => reorder(selBlock.id, false)}>{SB_ICO.back}</button>
                  <button className="nb-sb-btn" data-tip="Duplicate  (Ctrl+D)"
                          onClick={duplicateSelection}>{SB_ICO.dup}</button>
                  <span className="nb-prow-gap" />
                  <button className="nb-sb-btn nb-sb-danger" data-tip="Delete  (Del)"
                          onClick={() => removeBlock(selBlock.id)}>{SB_ICO.trash}</button>
                </Row>
              </FloatPanel>
            )}

            {/* Several blocks selected. Styling rows appear only for the
                properties every selected block can actually take, so the card
                never offers a fill for a photo; alignment is the one thing
                that exists ONLY here. */}
            {selBlocks.length > 1 && selPanelXY && (
              <FloatPanel x={selPanelXY.x} y={selPanelXY.y} onMove={moveSelPanel} onSize={onPanelSize}
                          title={`${selBlocks.length} SELECTED`}>
                <Row label="Align">
                  {([['left', 'Left edges'], ['centerX', 'Centres, vertical'],
                     ['right', 'Right edges'], ['top', 'Top edges'],
                     ['centerY', 'Centres, horizontal'], ['bottom', 'Bottom edges']] as const)
                    .map(([how, tip]) => (
                      <button key={how} className="nb-sb-btn" data-tip={tip}
                              onClick={() => alignSelection(how)}>{SB_ICO['al_' + how]}</button>
                    ))}
                </Row>
                {selBlocks.every((b) => b.type === 'text' || b.type === 'math'
                                     || b.type === 'ink' || b.type === 'shape') && (
                  <Row label="Colour">
                    <Swatches value=""
                              onPick={(c) => patchSelection(
                                { color: c || undefined } as Partial<Block>,
                                (b) => b.type !== 'image')} />
                  </Row>
                )}
                {selBlocks.every((b) => b.type === 'ink' || b.type === 'shape') && (
                  <Row label="Width">
                    <Widths value={0}
                            onPick={(wd) => patchSelection({ width: wd } as Partial<Block>)} />
                  </Row>
                )}
                {selBlocks.every((b) => b.type === 'ink') && (
                  <Row label="Maths">
                    <button className="nb-sb-btn"
                            data-tip="Read these strokes as one piece of maths and replace them (Ctrl+Z brings the ink back)"
                            onClick={inkToMaths}>To maths</button>
                  </Row>
                )}
                <Row>
                  <button className="nb-sb-btn" data-tip="Duplicate  (Ctrl+D)"
                          onClick={duplicateSelection}>{SB_ICO.dup}</button>
                  <span className="nb-prow-gap" />
                  <button className="nb-sb-btn nb-sb-danger"
                          data-tip={`Delete all ${selBlocks.length}  (Del)`}
                          onClick={removeSelection}>{SB_ICO.trash}</button>
                </Row>
              </FloatPanel>
            )}

            {/* The favourites bar: its own floating surface, present only
                while something is starred, draggable by its grip like every
                card on this page. Buttons arm their tool with the saved
                colour and width; drag one onto another to reorder;
                right-click removes it (the star in the dropdown does too). */}
            {favs.length > 0 && (
              <FloatPanel compact x={clampPanel(favPos.x, favPos.y).x}
                          y={clampPanel(favPos.x, favPos.y).y}
                          onMove={moveFavBar} title="FAVOURITES">
                {favs.map((f, i) => (
                  <button key={i}
                          className={'nb-tool nb-fav'}
                          draggable
                          data-tip={`${f.tool}${f.width ? ` · ${f.width}px` : ''}  (drag to reorder · right-click to remove)`}
                          style={{ color: f.color || undefined }}
                          onClick={() => {
                            setTool(f.tool);
                            setOptsOpen(false);
                            if (f.tool === 'pen' || f.tool === 'highlighter') {
                              setPenOpts({ color: f.color, width: f.width,
                                           highlighter: f.tool === 'highlighter' });
                            } else if (f.width > 0) {
                              setShapeOpts({ color: f.color, width: f.width,
                                             dash: !!f.dash, fill: f.fill || '' });
                            }
                            // width 0 = a write tool; it has no stroke opts.
                          }}
                          onContextMenu={(e) => {
                            e.preventDefault();
                            saveFavs(favs.filter((_, j) => j !== i));
                          }}
                          onDragStart={(e) => {
                            dragFav.current = i;
                            e.dataTransfer.effectAllowed = 'move';
                          }}
                          onDragOver={(e) => e.preventDefault()}
                          onDrop={(e) => {
                            e.preventDefault();
                            const from = dragFav.current;
                            dragFav.current = null;
                            if (from === null || from === i) return;
                            const next = [...favs];
                            const [m] = next.splice(from, 1);
                            next.splice(i, 0, m);
                            saveFavs(next);
                          }}>
                    {TOOL_ICON[f.tool]}
                    {f.width > 0 && (
                      <span className="nb-fav-bar"
                            style={{ height: clamp(1 + f.width / 3, 2, 5) }} />
                    )}
                  </button>
                ))}
              </FloatPanel>
            )}

            {showPenBar && (
              <FloatPanel x={toolXY.x} y={toolXY.y} onMove={moveToolPanel} onSize={onPanelSize}
                          title={tool === 'eraser' ? 'ERASER'
                            : tool === 'highlighter' ? 'HIGHLIGHTER' : 'PEN'}>
                {tool === 'eraser' ? (
                  <Row label="Eraser"><span className="nb-hint">Drag over ink to remove it</span></Row>
                ) : (
                  <>
                    <Row label="Colour">
                      <Swatches value={penOpts.color}
                                onPick={(c) => setPenOpts((p) => ({ ...p, color: c }))} />
                    </Row>
                    <Row label="Width">
                      <Widths value={penOpts.width}
                              onPick={(wd) => setPenOpts((p) => ({ ...p, width: wd }))} />
                      <span className="nb-prow-gap" />
                      <span className="nb-hint">
                        {tool === 'highlighter' ? `${penOpts.width * 5}px nib` : `${penOpts.width}px nib`}
                      </span>
                    </Row>
                  </>
                )}
                {tool !== 'eraser' && (
                  <Row label="Pin">
                    <button className="nb-sb-btn nb-sb-wide" data-tip="Add this pen, with its colour and width, to the floating favourites bar"
                            onClick={() => {
                              const f = { tool, color: penOpts.color,
                                          width: penOpts.width };
                              const key = JSON.stringify(f);
                              if (favs.some((x) => JSON.stringify(x) === key)) return;
                              saveFavs([...favs, f].slice(-8));
                            }}>☆ FAVOURITE</button>
                  </Row>
                )}
                {/* Touch-monitor setting: with STYLUS on, only the pen draws;
                    fingers pan and two fingers pinch-zoom, so a hand resting
                    on the glass can never leave a mark. */}
                <Row label="Input">
                  <button className={'nb-sb-btn nb-sb-wide' + (penOnly ? ' on' : '')}
                          data-tip="Stylus mode: only a pen draws; fingers pan, two fingers zoom"
                          onClick={() => setPenOnly((v) => {
                            const n = !v;
                            try { localStorage.setItem('lse.nbPenOnly', n ? '1' : '0'); } catch (err) { /* private mode */ }
                            return n;
                          })}>STYLUS</button>
                </Row>
              </FloatPanel>
            )}
            {showShapeBar && (
              <FloatPanel x={toolXY.x} y={toolXY.y} onMove={moveToolPanel} onSize={onPanelSize}
                          title={String(tool).toUpperCase()}>
                <Row label="Colour">
                  <Swatches value={shapeOpts.color}
                            onPick={(c) => setShapeOpts((p) => ({ ...p, color: c }))} />
                </Row>
                <Row label="Width">
                  <Widths value={shapeOpts.width}
                          onPick={(wd) => setShapeOpts((p) => ({ ...p, width: wd }))} />
                  <span className="nb-prow-gap" />
                  <button className={'nb-sb-btn' + (shapeOpts.dash ? ' on' : '')}
                          data-tip="Dashed"
                          onClick={() => setShapeOpts((p) => ({ ...p, dash: !p.dash }))}>{SB_ICO.dash}</button>
                </Row>
                {CLOSED_SHAPES.includes(tool as ShapeKind) && (
                  <Row label="Fill">
                    <Swatches bg value={shapeOpts.fill}
                              onPick={(c) => setShapeOpts((p) => ({ ...p, fill: c }))} />
                  </Row>
                )}
                <Row label="Pin">
                  <button className="nb-sb-btn nb-sb-wide" data-tip="Add this shape, with its colour and width, to the floating favourites bar"
                          onClick={() => {
                            const f = { tool, color: shapeOpts.color,
                                        width: shapeOpts.width,
                                        dash: shapeOpts.dash || undefined,
                                        fill: shapeOpts.fill || undefined };
                            const key = JSON.stringify(f);
                            if (favs.some((x) => JSON.stringify(x) === key)) return;
                            saveFavs([...favs, f].slice(-8));
                          }}>☆ FAVOURITE</button>
                </Row>
              </FloatPanel>
            )}

            {/* Paper picker. Anchored under its toolbar button rather than
                floating, because it belongs to the whole canvas and not to
                anything on it; it steps aside when the maths palette holds
                the right edge. */}
            {paperMenu && (
              <div className="nb-menu nb-paper-menu"
                   style={{ top: 40, right: palette ? 258 : 10 }}
                   onPointerDown={(e) => e.stopPropagation()}
                   onContextMenu={(e) => e.preventDefault()}>
                <div className="nb-paper-row">
                  <span className="nb-sb-lab">Paper</span>
                  {PAPERS.map(([c, label]) => (
                    <button key={c || 'theme'}
                            className={'nb-swatch nb-swatch-paper'
                              + (((doc.paper || '') === c) ? ' on' : '')}
                            style={{ background: c || 'var(--bg)' }}
                            data-tip={label}
                            onClick={() => setSurface({ paper: c || undefined })} />
                  ))}
                  {/* Any colour at all: the swatches are the common answers,
                      not the whole set, and "I want THIS green" is exactly
                      the case a fixed palette cannot serve. */}
                  <label className="nb-swatch nb-swatch-any" data-tip="Any colour">
                    <input type="color" value={doc.paper || '#ffffff'}
                           onChange={(e) => setSurface({ paper: e.target.value })} />
                  </label>
                </div>
                <div className="nb-paper-row">
                  <span className="nb-sb-lab">Ruling</span>
                  {PATTERNS.map(([p, label]) => (
                    <button key={p}
                            className={'nb-sb-btn'
                              + (((doc.pattern || 'dots') === p) ? ' on' : '')}
                            onClick={() => setSurface({ pattern: p })}>{label}</button>
                  ))}
                </div>
              </div>
            )}

            {/* Right-click menu. On a block: that block's actions. On empty
                canvas: things to add at the clicked spot. Same floating-card
                chrome as the panels; a press anywhere else dismisses it. */}
            {menu && (() => {
              const mb = menu.blockId ? doc.blocks.find((x) => x.id === menu.blockId) : null;
              const item = (label: string, fn: () => void, danger?: boolean) => (
                <button key={label} className={'nb-menu-item' + (danger ? ' danger' : '')}
                        onClick={() => { setMenu(null); fn(); }}>{label}</button>
              );
              return (
                <div className="nb-menu" style={{ left: menu.x, top: menu.y }}
                     onPointerDown={(e) => e.stopPropagation()}
                     onDoubleClick={(e) => e.stopPropagation()}
                     onContextMenu={(e) => e.preventDefault()}>
                  {mb ? [
                    ...(mb.type === 'text' || mb.type === 'math'
                      ? [item('Edit', () => { setSel(mb.id); setEditing(mb.id); if (mb.type === 'math') setPalette(true); })]
                      : []),
                    ...(mb.type === 'image' ? [
                      item('Flip horizontally', () => patchU(mb.id, { flipH: !(mb as ImageBlock).flipH || undefined } as Partial<Block>)),
                      item('Flip vertically', () => patchU(mb.id, { flipV: !(mb as ImageBlock).flipV || undefined } as Partial<Block>)),
                    ] : []),
                    ...(mb.type === 'math'
                      ? [item('Save to equation library', () => saveEquation((mb as MathBlock).latex, (mb as MathBlock).size))]
                      : []),
                    ...(mb.type === 'ink' && selBlocks.every((b) => b.type === 'ink')
                      ? [item(selIds.length > 1 ? 'Convert strokes to maths' : 'Convert to maths', inkToMaths)]
                      : []),
                    item('Duplicate', duplicateSelection),
                    item('Bring to front', () => reorder(mb.id, true)),
                    item('Send to back', () => reorder(mb.id, false)),
                    ...(selIds.length > 1
                      ? [item(`Delete ${selIds.length} selected`, removeSelection, true)]
                      : [item('Delete', () => removeBlock(mb.id), true)]),
                  ] : [
                    item('Write text here', () => setSel(addAt('text', menu.wx, menu.wy))),
                    item('Sticky note here', () => setSel(addAt('sticky', menu.wx, menu.wy))),
                    item('Code block here', () => setSel(addAt('code', menu.wx, menu.wy))),
                    item('Maths here', () => setSel(addAt('math', menu.wx, menu.wy))),
                    item('Photo here…', () => {
                      imageAt.current = { x: menu.wx, y: menu.wy };
                      fileIn.current?.click();
                    }),
                    ...(CLIP?.length ? [item('Paste here', () => {
                      const clip = CLIP!;
                      const gx = Math.min(...clip.map((b) => b.x));
                      const gy = Math.min(...clip.map((b) => b.y));
                      const copies = clip.map((b) => ({
                        ...JSON.parse(JSON.stringify(b)), id: uid(),
                        x: b.x - gx + menu.wx, y: b.y - gy + menu.wy } as Block));
                      snapshot();
                      dirty.current = true;
                      setDoc((cur) => (cur ? { ...cur, blocks: [...cur.blocks, ...copies] } : cur));
                      setSelIds(copies.map((c) => c.id));
                    })] : []),
                    item('Select everything', () =>
                      setSelIds(doc.blocks.map((b) => b.id))),
                    item('Fit everything', fit),
                    ...(doc.blocks.length
                      ? [item('Delete everything here', clearCanvas, true)] : []),
                  ]}
                </div>
              );
            })()}

            {/* Canvas and the maths palette share a ROW. The palette used to
                be absolutely positioned over nb-main, so its 250px covered
                the right third of the CANVAS: arming the maths tool and
                clicking there hit the palette and nothing happened, which
                reads exactly as a maths block refusing clicks. In the flow,
                the canvas simply gets narrower. */}
            <div className="nb-body">
            <div
              ref={wrap}
              className={'nb-canvas nb-tool-' + tool}
              style={{ background: paper || undefined, color: inkColor,
                       '--nb-sel-edge': selEdge } as React.CSSProperties}
              onWheel={onWheel}
              onPointerDown={onPointerDown}
              onPointerMove={onPointerMove}
              onPointerUp={onPointerUp}
              onPointerCancel={onPointerUp}
              onContextMenu={onContextMenu}
              onDragOver={(e) => e.preventDefault()}
              onDrop={onDrop}
              // Kill NATIVE drags born inside the canvas: dragging a block
              // from a point inside a live text selection starts an HTML5
              // drag of the selection, Chrome fires pointercancel, and the
              // move gesture dies after one frame (caught in simulation).
              // External file drops are unaffected; dragstart never fires
              // for drags that begin outside the page.
              onDragStartCapture={(e) => e.preventDefault()}
              onDoubleClick={(e) => {
                // Two guards, because e.target lies here. A dblclick's target
                // is the nearest common ancestor of the two mousedowns, and
                // the second mousedown on an already-selected text block
                // opens its editor, which REPLACES the prose div the first
                // mousedown hit. With that node gone the ancestor resolves
                // all the way up to the canvas, so this handler used to fire
                // on a double-click aimed at a block and drop a stray empty
                // text block behind the editor.
                const started = downOn.current;
                if (started.ui) {
                  // Aimed at a block: do what the block's own handler would
                  // have done if the event had reached it.
                  const b = started.block
                    ? docRef.current?.blocks.find((x) => x.id === started.block) : null;
                  if (b && (b.type === 'text' || b.type === 'math')) {
                    setSel(b.id);
                    setEditing(b.id);
                    if (b.type === 'math') setPalette(true);
                  }
                  return;
                }
                if ((e.target as HTMLElement).closest('[data-block]')) return;
                const w = worldAt(e);
                setSel(addAt('text', w.x, w.y));
              }}
            >
              {/* The grid is drawn on the WRAPPER, not the scene, so it can be
                  an infinite repeating background instead of a finite element
                  that runs out when you pan far enough. */}
              <div className="nb-grid" style={{
                backgroundImage: ruleImage,
                backgroundSize: `${24 * view.zoom}px ${24 * view.zoom}px`,
                backgroundPosition: `${view.x}px ${view.y}px`,
                opacity: view.zoom < 0.35 ? 0 : 1,
              }} />
              <div className="nb-scene" style={{
                transform: `translate(${view.x}px, ${view.y}px) scale(${view.zoom})`,
              }}>
                {doc.blocks.map((b) => (
                  <BlockView
                    key={b.id}
                    b={b}
                    selected={selIds.includes(b.id)}
                    handles={selIds.length === 1 && selIds[0] === b.id}
                    editing={editing === b.id}
                    zoom={view.zoom}
                    editRef={editRef}
                    onEdit={() => { setSel(b.id); setEditing(b.id); if (b.type === 'math') setPalette(true); }}
                    onChange={(p) => patch(b.id, p)}
                  />
                ))}
                {/* Rubber band, drawn in world space so it tracks the canvas
                    if the view moves mid-drag. */}
                {marquee && (
                  <div className="nb-marquee" style={{
                    left: Math.min(marquee.x1, marquee.x2),
                    top: Math.min(marquee.y1, marquee.y2),
                    width: Math.abs(marquee.x2 - marquee.x1),
                    height: Math.abs(marquee.y2 - marquee.y1),
                    // Counter-scaled by the real zoom, not a 0.15 floor: the
                    // floor made the band's border sub-pixel below 15%.
                    borderWidth: 1 / Math.max(view.zoom, MIN_ZOOM),
                  }} />
                )}
                {/* Stroke in flight: drawn in the scene so it sits under the
                    cursor exactly where it will land when the pen lifts. */}
                {drawing && drawing.length > 1 && (
                  <svg className="nb-live-ink" overflow="visible">
                    <path d={inkPath(drawing)} fill="none"
                          stroke={penOpts.color || 'currentColor'}
                          strokeWidth={penOpts.highlighter ? penOpts.width * 5 : penOpts.width}
                          opacity={penOpts.highlighter ? 0.45 : 1}
                          strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                )}
                {/* Shape in flight, same contract as the live ink. */}
                {shapeDraft && (
                  <svg className="nb-live-ink" overflow="visible">
                    <ShapeGeom shape={shapeDraft.shape}
                               x1={shapeDraft.x1} y1={shapeDraft.y1}
                               x2={shapeDraft.x2} y2={shapeDraft.y2}
                               color={shapeOpts.color || 'currentColor'}
                               width={shapeOpts.width} dash={shapeOpts.dash}
                               fill={shapeOpts.fill || undefined} />
                  </svg>
                )}
              </div>
            </div>
            {/* Maths palette, beside the canvas. Every symbol is LIVE: with no
                block open a click makes a maths block in the middle of the
                view and types the symbol into it, instead of the button being
                disabled and the click doing nothing. */}
            {palette && (
              <div className="nb-palette">
                <div className="nb-pal-head">
                  <span>MATHS</span>
                  <button onClick={() => setPalette(false)} title="Close">&#10005;</button>
                </div>
                <div className="nb-pal-hint">
                  {editBlock
                    ? (editBlock.type === 'math'
                        ? 'Click a symbol to type it into the block.'
                        : 'Inside a text block, maths goes between $ signs.')
                    : 'Click any symbol to start a new equation here.'}
                </div>
                <div className="nb-pal-body">
                  {/* The user's own saved equations lead the palette: click
                      types it (or starts a block), dragging drops it exactly
                      where the pointer lands on the canvas. */}
                  {eqLib.length > 0 && (
                    <div className="nb-pal-group">
                      <div className="nb-pal-title">SAVED — click or drag onto the canvas</div>
                      <div className="nb-pal-saved">
                        {eqLib.map((q) => (
                          <div key={q.id} className="nb-pal-eq" draggable
                               onDragStart={(e) => {
                                 e.dataTransfer.setData('application/x-lse-eq',
                                   JSON.stringify({ latex: q.latex, size: q.size }));
                                 e.dataTransfer.setData('text/plain', q.latex);
                                 e.dataTransfer.effectAllowed = 'copy';
                               }}>
                            <button className="nb-pal-eq-body" title={q.latex}
                                    onMouseDown={(e) => e.preventDefault()}
                                    onClick={() => insert(q.latex)}>
                              <EqPreview latex={q.latex} />
                            </button>
                            <button className="nb-pal-eq-x" title="Remove from saved"
                                    onClick={() => removeEquation(q.id)}>✕</button>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                  {PALETTE.map((g) => (
                    <div key={g.group} className="nb-pal-group">
                      <div className="nb-pal-title">{g.group}</div>
                      <div className="nb-pal-grid">
                        {g.items.map((it) => (
                          <button key={it.lab + it.ins} title={it.tip ? `${it.tip}  ${it.ins.replace('@', '')}` : it.ins.replace('@', '')}
                                  onMouseDown={(e) => { e.preventDefault(); insert(it.ins); }}>
                            {it.lab}
                          </button>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
            </div>
          </>
        )}
      </div>

      <input ref={fileIn} type="file" accept="image/*" multiple style={{ display: 'none' }}
             onChange={(e) => {
               const fs = Array.from(e.target.files || []);
               e.target.value = '';
               // "Photo here" from the right-click menu parked a landing
               // point; a fan of offsets keeps a multi-pick readable.
               const at = imageAt.current;
               imageAt.current = null;
               fs.forEach((f, i) => upload(f, at ? { x: at.x + i * 28, y: at.y + i * 28 } : undefined));
             }} />
    </div>
  );
}

// ---------------------------------------------------------------------------
// One block
// ---------------------------------------------------------------------------

// How wide, in screen pixels, the invisible grab band around a drawn line is.
// The strokes people draw are 2 to 6px and nobody can click a 2px curve; 14
// is a finger-and-mouse-friendly target that is still narrow enough that two
// nearby strokes stay separately selectable.
const HIT_PX = 14;

/** Shape geometry shared by the committed block and the drag preview.
 *
 *  `hit` renders the SAME geometry as an invisible fat grab band instead of
 *  the visible shape. That is what makes a shape select from its outline (and
 *  its fill, when it has one) rather than from its bounding box: an empty
 *  rectangle drawn around a photo must not eat clicks meant for the photo. */
function ShapeGeom({ shape, x1, y1, x2, y2, color, width = 2, dash, fill, hit,
                     hitWidth }: {
  shape: ShapeBlock['shape']; x1: number; y1: number; x2: number; y2: number;
  color?: string; width?: number; dash?: boolean; fill?: string; hit?: boolean;
  hitWidth?: number;
}) {
  const common = {
    stroke: hit ? 'transparent' : (color || 'currentColor'),
    strokeWidth: hit ? Math.max(width, hitWidth ?? HIT_PX) : width,
    fill: 'none' as string,
    // A dashed outline is grabbed along its whole length, gaps included.
    strokeDasharray: (hit || !dash) ? undefined : `${width * 3} ${width * 2.2}`,
    strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const,
    // The PAINTED stroke is screen-constant. The grab band cannot be: hit
    // testing ignores vector-effect, so a non-scaling band shrinks with the
    // zoom (measured: 6px of tolerance at 100%, 1px at 25%, 0px at
    // 10%, which is why a drawing could not be picked up on a zoomed-out
    // canvas and the miss panned the page instead). The caller sizes the band
    // in USER units from the live zoom so it stays a real target everywhere.
    ...(hit ? {} : { vectorEffect: 'non-scaling-stroke' as const }),
    // Only the grab band is hit-tested, and a filled shape is grabbable
    // through its fill as well as its outline ('all' would also catch the
    // interior of an UNfilled one, which is the bug this replaces).
    pointerEvents: (hit ? (fill ? 'all' : 'stroke') : 'none') as 'all' | 'stroke' | 'none',
  };
  if (shape === 'line' || shape === 'arrow') {
    return (
      <>
        <line x1={x1} y1={y1} x2={x2} y2={y2} {...common} />
        {shape === 'arrow' && (
          <path d={arrowHead(x1, y1, x2, y2, Math.max(9, width * 4))}
                {...common} strokeDasharray={undefined} />
        )}
      </>
    );
  }
  const x0 = Math.min(x1, x2), y0 = Math.min(y1, y2);
  const w = Math.max(Math.abs(x2 - x1), 1), h = Math.max(Math.abs(y2 - y1), 1);
  const face = hit ? (fill ? 'transparent' : 'none') : (fill || 'none');
  if (shape === 'rect') {
    return <rect x={x0} y={y0} width={w} height={h} rx={2} {...common} fill={face} />;
  }
  if (shape === 'ellipse') {
    return <ellipse cx={x0 + w / 2} cy={y0 + h / 2} rx={w / 2} ry={h / 2}
                    {...common} fill={face} />;
  }
  // The rest are polygons inscribed in the drag box, so they stretch with a
  // resize exactly like the rectangle does.
  const cx = x0 + w / 2, cy = y0 + h / 2;
  let pts: number[][];
  if (shape === 'triangle') {
    pts = [[cx, y0], [x0 + w, y0 + h], [x0, y0 + h]];
  } else if (shape === 'diamond') {
    pts = [[cx, y0], [x0 + w, cy], [cx, y0 + h], [x0, cy]];
  } else {
    // Five-point star: outer points on the box's ellipse, inner ones at 38%,
    // which is the ratio that reads as a star rather than a cog or a blob.
    pts = [];
    for (let i = 0; i < 10; i++) {
      const a = -Math.PI / 2 + (i * Math.PI) / 5;
      const k = i % 2 ? 0.38 : 1;
      pts.push([cx + Math.cos(a) * (w / 2) * k, cy + Math.sin(a) * (h / 2) * k]);
    }
  }
  return <polygon points={pts.map(([px, py]) => `${px},${py}`).join(' ')}
                  {...common} fill={face} />;
}

/** One toolbar slot holding several tools that differ only in what they make.
 *  The face arms the group's current member (the last one used, so the pen
 *  stays the pen), the caret opens the list with names and shortcuts. */
function ToolGroup({ tool, setTool, members, open, setOpen, fav, onFav }: {
  tool: Tool; setTool: (t: Tool) => void;
  members: [Tool, string, string][];
  open: boolean; setOpen: (v: boolean) => void;
  // Per-row favourite star, the chart's drawing-favourites interaction.
  fav?: (t: Tool) => boolean; onFav?: (t: Tool) => void;
}) {
  // The face remembers the last member ARMED from this group, so opening the
  // shapes dropdown for a star and coming back later still offers the star.
  const [last, setLast] = useState<Tool>(members[0][0]);
  const active = members.some(([t]) => t === tool);
  const face = active ? tool : last;
  const cur = members.find(([t]) => t === face) || members[0];
  useEffect(() => { if (active) setLast(tool); }, [tool, active]);
  return (
    <span className="nb-grp">
      <button className={'nb-tool nb-grp-face' + (active ? ' active' : '')}
              data-tip={`${cur[2]}  (${cur[1]})`}
              onClick={() => { setTool(face); setOpen(false); }}>
        {TOOL_ICON[face]}
      </button>
      <button className={'nb-grp-caret' + (open ? ' on' : '')}
              aria-label="More tools"
              onClick={(e) => { e.stopPropagation(); setOpen(!open); }}>
        <svg viewBox="0 0 8 8" width="7" height="7" aria-hidden="true">
          <path d="M1 2.6 L4 5.6 L7 2.6" fill="none" stroke="currentColor"
                strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
      {open && (
        <div className="nb-grp-menu" onPointerDown={(e) => e.stopPropagation()}>
          {members.map(([t, k, label]) => (
            <button key={t} className={'nb-grp-item' + (tool === t ? ' on' : '')}
                    onClick={() => { setTool(t); setLast(t); setOpen(false); }}>
              <span className="nb-grp-ico">{TOOL_ICON[t]}</span>
              <span className="nb-grp-name">{label}</span>
              <span className="nb-grp-key">{k}</span>
              {fav && onFav && (
                <span className={'nb-grp-star' + (fav(t) ? ' on' : '')}
                      data-tip={fav(t) ? 'Remove from favourites' : 'Add to favourites'}
                      onClick={(e) => { e.stopPropagation(); onFav(t); }}>
                  <svg viewBox="0 0 16 16" width="13" height="13"
                       fill={fav(t) ? 'currentColor' : 'none'} stroke="currentColor"
                       strokeWidth="1.2" strokeLinejoin="round">
                    <path d="M8 2.4l1.7 3.7 4 .5-3 2.8.8 4L8 11.5l-3.5 1.9.8-4-3-2.8 4-.5z" />
                  </svg>
                </span>
              )}
            </button>
          ))}
        </div>
      )}
    </span>
  );
}

/** One labelled line inside a floating card. Every control group gets its own
 *  row: the old single wrapping flex box broke "Width" onto the end of the
 *  colour line and left one nib stranded. */
function Row({ label, children }: { label?: string; children: React.ReactNode }) {
  return (
    <div className="nb-prow">
      {label !== undefined && <span className="nb-prow-lab">{label}</span>}
      <span className="nb-prow-body">{children}</span>
    </div>
  );
}

/** The colour line: the palette, then a chip that opens the OS colour picker
 *  for anything the palette does not have. `value` is '' for "theme colour". */
function Swatches({ value, onPick, bg }: {
  value: string; onPick: (c: string) => void; bg?: boolean;
}) {
  const list = bg ? BGS : COLORS;
  return (
    <>
      {list.map((c) => (
        <button key={c || 'default'}
                className={'nb-swatch' + (bg ? ' nb-swatch-bg' : '')
                  + (value === c ? ' on' : '')}
                style={bg ? (c ? { background: c } : {})
                          : { background: c || 'var(--text)' }}
                data-tip={c || (bg ? 'No background' : 'Theme colour')}
                onClick={() => onPick(c)}>{bg && !c ? '∅' : ''}</button>
      ))}
      {!bg && (
        <label className="nb-swatch nb-swatch-any" data-tip="Any colour">
          <input type="color" value={/^#[0-9a-f]{6}$/i.test(value) ? value : '#4f8fd9'}
                 onChange={(e) => onPick(e.target.value)} />
        </label>
      )}
    </>
  );
}

/** Nib widths, drawn at their true relative weight so the row reads as a
 *  thickness scale instead of six identical buttons, plus a number field: the
 *  presets are the common answers, not the range, and 9px is a perfectly
 *  reasonable thing to want. */
function Widths({ value, onPick }: { value: number; onPick: (w: number) => void }) {
  return (
    <>
      {PEN_WIDTHS.map((wd) => (
        <button key={wd} className={'nb-wbtn' + (value === wd ? ' on' : '')}
                data-tip={`${wd}px`} onClick={() => onPick(wd)}>
          <span className="nb-wbar" style={{ height: Math.min(1 + wd, 18) }} />
        </button>
      ))}
      <input className="nb-num" type="number" min={1} max={200} step={1}
             data-tip="Any width, 1 to 200"
             // Blank on a multi-selection, where there is no one width yet.
             value={value ? Math.round(value * 10) / 10 : ''}
             onChange={(e) => {
               const v = parseFloat(e.target.value);
               if (isFinite(v)) onPick(clamp(v, 1, 200));
             }} />
    </>
  );
}

/** A draggable card floating over the canvas: the header grip moves it, the
 *  body holds whatever controls the situation calls for. It lives OUTSIDE
 *  the canvas element (a sibling in nb-main), so its pointer events can
 *  never pan, draw or double-click-create on the canvas underneath. */
function FloatPanel({ x, y, title, onMove, onSize, children, compact }: {
  x: number; y: number; title: string;
  onMove: (x: number, y: number) => void;
  onSize?: (w: number, h: number) => void; children: React.ReactNode;
  // One row: the grip dots sit beside the content, no title bar. For tiny
  // always-on surfaces like the favourites pill, where a labelled header
  // doubles the height for a word nobody needs.
  compact?: boolean;
}) {
  // Pointer offset inside the grip at drag start, so the card does not jump
  // to put its corner under the cursor.
  const off = useRef<{ dx: number; dy: number } | null>(null);
  // Report the laid-out size every render (content decides it: a photo card
  // is one row, a maths card four). The parent clamps against this, so the
  // card cannot be positioned half off the canvas.
  const box = useRef<HTMLDivElement | null>(null);
  useLayoutEffect(() => {
    const n = box.current;
    if (n && onSize) onSize(n.offsetWidth, n.offsetHeight);
  });
  return (
    <div className={'nb-float' + (compact ? ' nb-float-compact' : '')}
         ref={box} style={{ left: x, top: y }}
         onPointerDown={(e) => e.stopPropagation()}>
      <div className="nb-float-grip"
           onPointerDown={(e) => {
             e.stopPropagation();
             // Same guard as the canvas: capture throws on a pointer the
             // browser no longer tracks, and a throw here kills the drag
             // before it starts. Uncaptured still drags.
             try {
               (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
             } catch (err) { /* fine */ }
             off.current = { dx: e.clientX - x, dy: e.clientY - y };
           }}
           onPointerMove={(e) => {
             if (off.current) onMove(e.clientX - off.current.dx, e.clientY - off.current.dy);
           }}
           onPointerUp={() => { off.current = null; }}
           onPointerCancel={() => { off.current = null; }}>
        <svg viewBox="0 0 8 14" width="8" height="14" aria-hidden="true">
          <g fill="currentColor">
            <circle cx="2" cy="2" r="1.1" /><circle cx="6" cy="2" r="1.1" />
            <circle cx="2" cy="7" r="1.1" /><circle cx="6" cy="7" r="1.1" />
            <circle cx="2" cy="12" r="1.1" /><circle cx="6" cy="12" r="1.1" />
          </g>
        </svg>
        {!compact && <span className="nb-float-title">{title}</span>}
      </div>
      <div className="nb-float-body">{children}</div>
    </div>
  );
}

function BlockView({ b, selected, handles, editing, zoom, editRef, onEdit, onChange }: {
  b: Block; selected: boolean; handles: boolean; editing: boolean; zoom: number;
  editRef: React.MutableRefObject<HTMLTextAreaElement | null>;
  onEdit: () => void; onChange: (p: Partial<Block>) => void;
}) {
  const style: React.CSSProperties = {
    left: b.x, top: b.y, width: b.w, height: b.h,
  };
  // Ink and shapes are LINES, not boxes. Their wrapper is turned off for
  // pointing entirely and the geometry inside it (plus the resize handles)
  // switches itself back on, so a stroke is grabbed where it was drawn and
  // whatever sits inside a loop or an empty rectangle stays clickable.
  const thin = b.type === 'ink' || b.type === 'shape';
  const cls = 'nb-block nb-' + b.type + (thin ? ' nb-thin' : '')
            + (selected ? ' sel' : '') + (editing ? ' editing' : '');

  // Ink's drawn extent, for the viewBox: derived from the points instead of
  // b.w/b.h so RESIZING an ink block stretches the stroke with the box.
  // (Before this, resize moved the box and left the stroke behind in the top
  // left corner.) For documents saved by older builds the derived extent
  // equals the stored w/h, so nothing moves.
  const inkExtent = useMemo(() => {
    if (b.type !== 'ink') return null;
    let mx = 1, my = 1;
    for (const [px, py] of b.points) { if (px > mx) mx = px; if (py > my) my = py; }
    return { w: mx, h: my };
  }, [b]);

  /** The grab band, in the block's own SVG user units, sized so it is always
   *  about HIT_PX wide ON SCREEN. The svg maps `vb` user units onto `box`
   *  world units (preserveAspectRatio="none"), and the scene then scales by
   *  zoom, so one user unit is (box/vb)*zoom screen pixels. The smaller of the
   *  two axes wins, which keeps the band at least HIT_PX wide in both
   *  directions on a block that was stretched unevenly. */
  const bandWidth = (boxW: number, boxH: number, vbW: number, vbH: number) => {
    const perUnit = Math.min(boxW / Math.max(vbW, 0.001),
                             boxH / Math.max(vbH, 0.001)) * Math.max(zoom, 0.001);
    return HIT_PX / Math.max(perUnit, 0.0001);
  };

  // Maths grows its own box to whatever KaTeX actually rendered. Before this
  // a formula wider or taller than the block was simply CLIPPED by the fixed
  // 340x96 box it was born in, which read as broken rendering: a long
  // derivation showed its first half and nothing said so. The block
  // only ever grows here, never shrinks, so a box the user deliberately
  // enlarged stays enlarged.
  const mathRef = useRef<HTMLDivElement | null>(null);
  const mathSrc = b.type === 'math' ? b.latex : '';
  const mathSize = b.type === 'math' ? b.size : 0;
  useLayoutEffect(() => {
    const el = mathRef.current;
    if (b.type !== 'math' || !el) return;
    const k = el.querySelector('.katex-display') || el.querySelector('.katex');
    if (!k) return;
    const r = (k as HTMLElement).getBoundingClientRect();
    if (!r.width || !r.height) return;
    // getBoundingClientRect is in SCREEN pixels; the block lives in world
    // units, so divide the zoom back out before comparing.
    const needW = Math.ceil(r.width / Math.max(zoom, 0.01)) + 34;
    const needH = Math.ceil(r.height / Math.max(zoom, 0.01)) + 26;
    if (needW > b.w + 1 || needH > b.h + 1) {
      onChange({ w: Math.max(b.w, needW), h: Math.max(b.h, needH) } as Partial<Block>);
    }
  }, [mathSrc, mathSize, b.type, b.w, b.h, zoom, onChange]);

  return (
    <div className={cls} data-block={b.id} style={style} onDoubleClick={(e) => {
      if (b.type === 'text' || b.type === 'math') { e.stopPropagation(); onEdit(); }
    }}>
      {b.type === 'text' && (editing ? (
        <textarea
          ref={editRef}
          className={'nb-edit' + (b.mono ? ' nb-mono' : '')}
          style={{ fontSize: b.size, color: b.color || undefined,
                   background: b.bg || undefined,
                   fontWeight: b.bold ? 600 : undefined,
                   fontStyle: b.italic ? 'italic' : undefined,
                   textAlign: b.align || undefined }}
          value={b.text}
          placeholder={b.mono
            ? 'Paste or write code. It is kept verbatim, no maths pass.'
            : 'Write here. Maths goes between $ signs, like $\\sigma^2$.'}
          onChange={(e) => onChange({ text: e.target.value } as Partial<Block>)}
        />
      ) : (
        <div className={'nb-prose' + (b.bg ? ' nb-card' : '') + (b.mono ? ' nb-mono' : '')}
             style={{ fontSize: b.size, color: b.color || undefined,
                      background: b.bg || undefined,
                      fontWeight: b.bold ? 600 : undefined,
                      fontStyle: b.italic ? 'italic' : undefined,
                      textAlign: b.align || undefined }}
             // A code block is verbatim: no KaTeX pass, because `$` and `\`
             // are ordinary characters in every language people paste here.
             dangerouslySetInnerHTML={{ __html: b.text.trim()
               ? (b.mono ? escapeHtml(b.text) : renderProse(b.text))
               : `<span class="nb-ph">${b.mono ? 'Double-click to paste code'
                                                : 'Double-click to write'}</span>` }} />
      ))}

      {b.type === 'math' && (
        <>
          <div ref={mathRef} className={'nb-math-out' + (b.bg ? ' nb-card' : '')}
               style={{ fontSize: b.size, color: b.color || undefined,
                        background: b.bg || undefined }}>
            <MathOut latex={b.latex} />
          </div>
          {editing && (
            <textarea
              ref={editRef}
              className="nb-tex-in"
              spellCheck={false}
              value={b.latex}
              placeholder="\sigma^2_t = \omega + \alpha r_{t-1}^2 + \beta \sigma^2_{t-1}"
              onChange={(e) => onChange({ latex: e.target.value } as Partial<Block>)}
            />
          )}
        </>
      )}

      {b.type === 'image' && (
        // draggable=false: the browser's native image drag would start an HTML5
        // drag and steal every pointer move meant for the canvas gesture.
        <img className="nb-img" src={b.src} alt={b.name || ''} draggable={false}
             style={(b.flipH || b.flipV)
               ? { transform: `scale(${b.flipH ? -1 : 1}, ${b.flipV ? -1 : 1})` }
               : undefined} />
      )}

      {b.type === 'ink' && (
        <svg className="nb-ink"
             viewBox={`0 0 ${inkExtent?.w || 1} ${inkExtent?.h || 1}`}
             preserveAspectRatio="none">
          {/* Grab band first, under the stroke: a drawing is selected by its
              INK, never by the rectangle its ink happens to span. A loop
              drawn around a photo used to cover the photo with an invisible
              box that swallowed every click on it. */}
          <path className="nb-hit" d={inkPath(b.points)} fill="none" stroke="transparent"
                strokeWidth={Math.max(b.width,
                  bandWidth(b.w, b.h, inkExtent?.w || 1, inkExtent?.h || 1))}
                strokeLinecap="round" strokeLinejoin="round" />
          <path d={inkPath(b.points)} fill="none" stroke={b.color} strokeWidth={b.width}
                opacity={b.mode === 'highlighter' ? 0.45 : 1}
                strokeLinecap="round" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
        </svg>
      )}

      {b.type === 'shape' && (
        <svg className="nb-ink"
             viewBox={`0 0 ${Math.max(b.ow || b.w, 1)} ${Math.max(b.oh || b.h, 1)}`}
             preserveAspectRatio="none">
          {/* Same contract as ink: the outline (plus the fill, if it has one)
              is the click target, not the bounding box. */}
          <ShapeGeom shape={b.shape} x1={b.x1} y1={b.y1} x2={b.x2} y2={b.y2}
                     width={b.width} fill={b.fill} hit
                     hitWidth={bandWidth(b.w, b.h,
                       Math.max(b.ow || b.w, 1), Math.max(b.oh || b.h, 1))} />
          <ShapeGeom shape={b.shape} x1={b.x1} y1={b.y1} x2={b.x2} y2={b.y2}
                     color={b.color} width={b.width} dash={b.dash} fill={b.fill} />
        </svg>
      )}

      {handles && !editing && (
        // Four corner handles (resize grabs any of them; the opposite corner
        // anchors), counter-scaled so they stay a comfortable grab target at
        // any zoom instead of becoming a speck or a slab. Only ONE block at a
        // time gets them: with six selected the handles would be six sets of
        // conflicting grips over the same drag.
        // 1/zoom exactly, no floor: the counter-scale is what holds a handle
        // at a fixed SCREEN size, so clamping it (the old Math.max(zoom, 0.15))
        // made handles shrink to nothing below 15% and a small block became
        // unresizable on a zoomed-out canvas.
        (['tl', 'tr', 'bl', 'br'] as const).map((c) => (
          <span key={c} className={'nb-handle nb-handle-' + c} data-handle={c}
                style={{ transform: `scale(${1 / Math.max(zoom, MIN_ZOOM)})` }} />
        ))
      )}
    </div>
  );
}

/** KaTeX output for a maths block, with the "still typing" state visible. */
function MathOut({ latex }: { latex: string }) {
  const r = useMemo(() => tex(latex.trim(), true), [latex]);
  if (!latex.trim()) return <span className="nb-ph">Maths block. Double-click to type LaTeX.</span>;
  if (!r.ok) return <span className="nb-tex-bad">{latex}</span>;
  return <span dangerouslySetInnerHTML={{ __html: r.html }} />;
}

/** A saved equation as it will render, small; falls back to the raw LaTeX
 *  when it does not compile (still recognisable, still draggable). */
function EqPreview({ latex }: { latex: string }) {
  const r = useMemo(() => tex(latex.trim(), false), [latex]);
  if (!r.ok) return <span className="nb-pal-eq-raw">{latex}</span>;
  return <span dangerouslySetInnerHTML={{ __html: r.html }} />;
}

// Icons for the floating-card buttons. Drawn, not typed: the old unicode
// glyphs (⇋ ⤒ ⧉ …) rendered at the OS font's mercy and read as placeholder
// chrome. All 17px: at 15 they read as decoration on a 30px button and are
// hard to tell apart.
const SB_ICO: Record<string, JSX.Element> = {
  flipH: (<svg viewBox="0 0 16 16" width="17" height="17" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round"><path d="M8 1.6v12.8" strokeDasharray="2 2" /><path d="M5.6 4.6 2.4 8l3.2 3.4z" /><path d="M10.4 4.6 13.6 8l-3.2 3.4z" fill="currentColor" /></svg>),
  flipV: (<svg viewBox="0 0 16 16" width="17" height="17" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round"><path d="M1.6 8h12.8" strokeDasharray="2 2" /><path d="M4.6 5.6 8 2.4l3.4 3.2z" /><path d="M4.6 10.4 8 13.6l3.4-3.2z" fill="currentColor" /></svg>),
  minus: (<svg viewBox="0 0 16 16" width="17" height="17" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"><path d="M3.5 8h9" /></svg>),
  plus: (<svg viewBox="0 0 16 16" width="17" height="17" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"><path d="M8 3.5v9M3.5 8h9" /></svg>),
  front: (<svg viewBox="0 0 16 16" width="17" height="17" fill="none" stroke="currentColor" strokeWidth="1.2"><path d="M10.5 5.5v-3h-8v8h3" /><rect x="5.5" y="5.5" width="8" height="8" fill="currentColor" stroke="none" /></svg>),
  back: (<svg viewBox="0 0 16 16" width="17" height="17" fill="none" stroke="currentColor" strokeWidth="1.2"><rect x="2.5" y="2.5" width="8" height="8" fill="currentColor" stroke="none" opacity=".45" /><path d="M5.5 8.5v5h8v-8h-5" /></svg>),
  dup: (<svg viewBox="0 0 16 16" width="17" height="17" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round"><rect x="5.5" y="5.5" width="8" height="8" rx="1" /><path d="M2.8 10.4V3.8a1 1 0 0 1 1-1h6.6" /></svg>),
  trash: (<svg viewBox="0 0 16 16" width="17" height="17" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round"><path d="M2.8 4.3h10.4" /><path d="M6.2 4.3V2.8h3.6v1.5" /><path d="M4.3 4.3l.6 9.2h6.2l.6-9.2" /><path d="M6.7 7v4M9.3 7v4" /></svg>),
  dash: (<svg viewBox="0 0 16 16" width="17" height="17" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"><path d="M2.4 8h2.4M6.8 8h2.4M11.2 8h2.4" /></svg>),
  // A sheet with a ruling on it: the canvas surface, not a paint bucket
  // (a bucket reads as "fill the selected thing", which this is not).
  paper: (<svg viewBox="0 0 16 16" width="17" height="17" fill="none" stroke="currentColor" strokeWidth="1.2"><rect x="2.6" y="2.6" width="10.8" height="10.8" rx="1.4" /><path d="M2.6 6.6h10.8M2.6 9.9h10.8" opacity=".6" /></svg>),
  code: (<svg viewBox="0 0 16 16" width="17" height="17" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round"><path d="M5.6 4.8 2.4 8l3.2 3.2M10.4 4.8 13.6 8l-3.2 3.2" /></svg>),
  marker: (<svg viewBox="0 0 16 16" width="17" height="17" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round"><path d="M3 13.4h10" strokeWidth="2.2" opacity=".5" /><path d="M4.4 11 9.8 5.6a1.4 1.4 0 0 1 2 0l.6.6a1.4 1.4 0 0 1 0 2L7 13.6H4.4z" /></svg>),
  // Bookmark: save this equation to the library.
  book: (<svg viewBox="0 0 16 16" width="17" height="17" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round"><path d="M4.2 2.6h7.6v10.8L8 10.2l-3.8 3.2z" /></svg>),
  alignLeft: (<svg viewBox="0 0 16 16" width="17" height="17" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"><path d="M2.8 4.4h10.4M2.8 8h6.4M2.8 11.6h8.4" /></svg>),
  alignCenter: (<svg viewBox="0 0 16 16" width="17" height="17" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"><path d="M2.8 4.4h10.4M4.8 8h6.4M3.8 11.6h8.4" /></svg>),
  alignRight: (<svg viewBox="0 0 16 16" width="17" height="17" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"><path d="M2.8 4.4h10.4M6.8 8h6.4M4.8 11.6h8.4" /></svg>),
  // Group alignment: a rule with two boxes lining up on it.
  al_left: (<svg viewBox="0 0 16 16" width="17" height="17" fill="none" stroke="currentColor" strokeWidth="1.2"><path d="M2.6 2.4v11.2" /><rect x="4.6" y="3.8" width="8.4" height="3" fill="currentColor" stroke="none" opacity=".75" /><rect x="4.6" y="9.2" width="5.2" height="3" fill="currentColor" stroke="none" opacity=".75" /></svg>),
  al_right: (<svg viewBox="0 0 16 16" width="17" height="17" fill="none" stroke="currentColor" strokeWidth="1.2"><path d="M13.4 2.4v11.2" /><rect x="3" y="3.8" width="8.4" height="3" fill="currentColor" stroke="none" opacity=".75" /><rect x="6.2" y="9.2" width="5.2" height="3" fill="currentColor" stroke="none" opacity=".75" /></svg>),
  al_centerX: (<svg viewBox="0 0 16 16" width="17" height="17" fill="none" stroke="currentColor" strokeWidth="1.2"><path d="M8 2.4v11.2" strokeDasharray="2 2" /><rect x="3.8" y="3.8" width="8.4" height="3" fill="currentColor" stroke="none" opacity=".75" /><rect x="5.4" y="9.2" width="5.2" height="3" fill="currentColor" stroke="none" opacity=".75" /></svg>),
  al_top: (<svg viewBox="0 0 16 16" width="17" height="17" fill="none" stroke="currentColor" strokeWidth="1.2"><path d="M2.4 2.6h11.2" /><rect x="3.8" y="4.6" width="3" height="8.4" fill="currentColor" stroke="none" opacity=".75" /><rect x="9.2" y="4.6" width="3" height="5.2" fill="currentColor" stroke="none" opacity=".75" /></svg>),
  al_bottom: (<svg viewBox="0 0 16 16" width="17" height="17" fill="none" stroke="currentColor" strokeWidth="1.2"><path d="M2.4 13.4h11.2" /><rect x="3.8" y="3" width="3" height="8.4" fill="currentColor" stroke="none" opacity=".75" /><rect x="9.2" y="6.2" width="3" height="5.2" fill="currentColor" stroke="none" opacity=".75" /></svg>),
  al_centerY: (<svg viewBox="0 0 16 16" width="17" height="17" fill="none" stroke="currentColor" strokeWidth="1.2"><path d="M2.4 8h11.2" strokeDasharray="2 2" /><rect x="3.8" y="3.8" width="3" height="8.4" fill="currentColor" stroke="none" opacity=".75" /><rect x="9.2" y="5.4" width="3" height="5.2" fill="currentColor" stroke="none" opacity=".75" /></svg>),
};

const TOOL_ICON: Record<Tool, JSX.Element> = {
  select: (<svg viewBox="0 0 16 16" width="17" height="17" fill="currentColor"><path d="M3 2l9 5.2-3.9.9L6.7 13z" /></svg>),
  hand: (<svg viewBox="0 0 16 16" width="17" height="17" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round"><path d="M5 8V4.2a1 1 0 112 0V8m0-.6V3.2a1 1 0 112 0V8m0-.4V4.4a1 1 0 112 0V9m0-1.4a1 1 0 112 0v3.1c0 2-1.6 3.6-3.6 3.6h-.8c-1 0-2-.5-2.6-1.3L4 11.4c-.5-.7-.3-1.4.3-1.8.5-.3 1.1-.2 1.5.3L7 11" /></svg>),
  text: (<svg viewBox="0 0 16 16" width="17" height="17" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"><path d="M3 4h10M8 4v9M6 13h4" /></svg>),
  math: (<span style={{ fontSize: 13, fontStyle: 'italic', fontFamily: 'KaTeX_Math, serif' }}>x</span>),
  pen: (<svg viewBox="0 0 16 16" width="17" height="17" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round"><path d="M2.6 13.4l.7-2.6 7-7 1.9 1.9-7 7-2.6.7zM10.3 3.8l1.2-1.2 1.9 1.9-1.2 1.2" /></svg>),
  eraser: (<svg viewBox="0 0 16 16" width="17" height="17" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round"><path d="M5.5 13h8M2.8 10.2l6-6a1 1 0 011.4 0l2.6 2.6a1 1 0 010 1.4l-4.8 4.8H5.6l-2.8-2.8zM6.8 5.6l4.6 4.6" /></svg>),
  image: (<svg viewBox="0 0 16 16" width="17" height="17" fill="none" stroke="currentColor" strokeWidth="1.2"><rect x="2.2" y="3.2" width="11.6" height="9.6" rx="1" /><circle cx="6" cy="6.5" r="1.1" /><path d="M3 11.4l3.2-3 2.3 2.2 2-1.8 2.5 2.6" /></svg>),
  // Endpoint dots, not a bare diagonal: a lone slash read as a separator,
  // not as the straight-line tool.
  line: (<svg viewBox="0 0 16 16" width="17" height="17" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"><path d="M4.8 11.2 11.2 4.8" /><circle cx="3.4" cy="12.6" r="1.5" fill="currentColor" stroke="none" /><circle cx="12.6" cy="3.4" r="1.5" fill="currentColor" stroke="none" /></svg>),
  arrow: (<svg viewBox="0 0 16 16" width="17" height="17" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round"><path d="M3 13L13 3M13 3H7.5M13 3v5.5" /></svg>),
  rect: (<svg viewBox="0 0 16 16" width="17" height="17" fill="none" stroke="currentColor" strokeWidth="1.3"><rect x="2.8" y="3.8" width="10.4" height="8.4" rx="1" /></svg>),
  ellipse: (<svg viewBox="0 0 16 16" width="17" height="17" fill="none" stroke="currentColor" strokeWidth="1.3"><ellipse cx="8" cy="8" rx="5.5" ry="4.2" /></svg>),
  triangle: (<svg viewBox="0 0 16 16" width="17" height="17" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round"><path d="M8 3 13.4 12.6H2.6z" /></svg>),
  diamond: (<svg viewBox="0 0 16 16" width="17" height="17" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round"><path d="M8 2.6 13.4 8 8 13.4 2.6 8z" /></svg>),
  star: (<svg viewBox="0 0 16 16" width="17" height="17" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round"><path d="M8 2.4l1.7 3.7 4 .5-3 2.8.8 4L8 11.5l-3.5 1.9.8-4-3-2.8 4-.5z" /></svg>),
  // A note that is obviously a NOTE: a square with a folded corner.
  sticky: (<svg viewBox="0 0 16 16" width="17" height="17" fill="none" stroke="currentColor" strokeWidth="1.25" strokeLinejoin="round"><path d="M2.8 3.4a.6.6 0 0 1 .6-.6h9.2a.6.6 0 0 1 .6.6v6.2l-3.6 3.6H3.4a.6.6 0 0 1-.6-.6z" /><path d="M13.2 9.6H9.6v3.6" /></svg>),
  code: (<svg viewBox="0 0 16 16" width="17" height="17" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round"><path d="M5.6 4.8 2.4 8l3.2 3.2M10.4 4.8 13.6 8l-3.2 3.2" /></svg>),
  highlighter: (<svg viewBox="0 0 16 16" width="17" height="17" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round"><path d="M3 13.4h10" strokeWidth="2.2" opacity=".5" /><path d="M4.4 11 9.8 5.6a1.4 1.4 0 0 1 2 0l.6.6a1.4 1.4 0 0 1 0 2L7 13.6H4.4z" /></svg>),
};

// ---------------------------------------------------------------------------
// Styles. Inline rather than in the shell's style.css because this island owns
// them entirely; every colour is a shell variable so both themes follow.
// ---------------------------------------------------------------------------

const NB_CSS = `
.nb-wrap { position: absolute; inset: 0; display: flex; background: var(--bg);
  color: var(--text); font-size: 12px; overflow: hidden; }

.nb-rail { width: 232px; flex: none; display: flex; flex-direction: column;
  background: var(--panel); border-right: 1px solid var(--edge); min-height: 0; }
.nb-rail-head { display: flex; align-items: center; gap: 7px; padding: 9px 8px 8px 12px;
  font-size: 10px; letter-spacing: .09em; color: var(--title); border-bottom: 1px solid var(--edge); }
.nb-count { color: var(--dim); letter-spacing: 0; }
.nb-plus { margin-left: auto; width: 20px; height: 20px; line-height: 1; font-size: 15px;
  background: none; border: 0; color: var(--dim); cursor: pointer; border-radius: 3px; }
.nb-plus:hover { background: var(--hover); color: var(--text); }
.nb-rail-scroll { flex: 1; overflow-y: auto; min-height: 0; }
.nb-rail-list { flex: none; }
/* Shell-rendered library tree (WORKSPACE + DATA) under the notebook list;
   its rows carry the shell's own .tree-* styles from style.css. */
.nb-lib { padding-bottom: 14px; }
.nb-rail-empty { padding: 14px 12px; color: var(--dim); line-height: 1.5; }
.nb-rail-empty button, .nb-blank button { display: block; margin-top: 10px; padding: 5px 10px;
  background: var(--raise); color: var(--text); border: 1px solid var(--edge);
  border-radius: 3px; font: inherit; cursor: pointer; }
.nb-rail-empty button:hover, .nb-blank button:hover { background: var(--raise-h); }
.nb-row { display: flex; align-items: stretch; border-bottom: 1px solid var(--edge);
  border-left: 2px solid transparent; }
.nb-row:hover { background: var(--hover); }
.nb-row.active { border-left-color: var(--accent-bar); background: var(--active); }
.nb-row-main { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 2px;
  padding: 8px 6px 8px 10px; background: none; border: 0; color: inherit; font: inherit;
  text-align: left; cursor: pointer; }
.nb-row-name { font-size: 11.5px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.nb-row-meta { font-size: 10px; color: var(--dim); }
.nb-row-acts { display: flex; align-items: center; gap: 2px; padding-right: 6px; opacity: 0; }
.nb-row:hover .nb-row-acts { opacity: 1; }
.nb-row-acts button { width: 20px; height: 20px; background: none; border: 0; color: var(--dim);
  font: inherit; font-size: 11px; cursor: pointer; border-radius: 3px; }
.nb-row-acts button:hover { background: var(--edge); color: var(--text); }
.nb-rename { flex: 1; margin: 5px 8px; padding: 3px 6px; background: var(--bg);
  border: 1px solid var(--line-strong); border-radius: 3px; color: var(--text); font: inherit; }
.nb-rename:focus { outline: none; }

.nb-main { flex: 1; min-width: 0; display: flex; flex-direction: column; position: relative; }
.nb-bar { flex: none; display: flex; align-items: center; gap: 10px; padding: 6px 10px;
  border-bottom: 1px solid var(--edge); background: var(--panel); }
.nb-title { width: 210px; padding: 3px 6px; background: transparent; border: 1px solid transparent;
  border-radius: 3px; color: var(--text); font: inherit; font-size: 12.5px; }
.nb-title:hover { border-color: var(--edge); }
.nb-title:focus { outline: none; border-color: var(--line-strong); background: var(--bg); }
.nb-tools { display: flex; align-items: center; gap: 3px; }
.nb-sep { width: 1px; height: 20px; background: var(--edge); margin: 0 6px; }
/* 32x30 with a 17px glyph. The old 26x24 button with a 13px glyph read as
   decoration and the tools were hard to tell apart. */
.nb-tool { display: flex; align-items: center; justify-content: center; width: 32px; height: 30px;
  background: none; border: 1px solid transparent; border-radius: 6px; color: var(--dim);
  font: inherit; cursor: pointer; }
.nb-tool:hover:not(:disabled) { background: var(--hover); color: var(--text); }
.nb-tool.active { background: var(--active); border-color: var(--edge); color: var(--text); }
.nb-tool:disabled { opacity: .35; cursor: default; }
.nb-tool-danger:hover:not(:disabled) { color: var(--err); }
/* Favourite tools: the icon carries the saved colour, the bar under it the
   saved width, so the button IS its own legend. */
.nb-fav { position: relative; display: flex; flex-direction: column;
  align-items: center; justify-content: center; gap: 1px; }
.nb-fav-bar { display: block; width: 14px; border-radius: 3px;
  background: currentColor; opacity: .9; }

/* Tool group: face + caret sharing one rounded slot, with the member list
   hanging under it. */
.nb-grp { position: relative; display: flex; align-items: stretch; }
.nb-grp .nb-grp-face { width: 30px; border-radius: 6px 0 0 6px; }
.nb-grp-caret { display: flex; align-items: flex-end; justify-content: center;
  width: 14px; padding: 0 0 5px; background: none; border: 1px solid transparent;
  border-left: 0; border-radius: 0 6px 6px 0; color: var(--dim); cursor: pointer; }
.nb-grp-caret:hover, .nb-grp-caret.on { background: var(--hover); color: var(--text); }
.nb-grp .nb-grp-face.active + .nb-grp-caret { background: var(--active);
  border-color: var(--edge); border-left: 0; color: var(--text); }
.nb-grp-menu { position: absolute; z-index: 60; top: calc(100% + 5px); left: 0;
  min-width: 168px; padding: 5px; display: flex; flex-direction: column; gap: 1px;
  background: var(--panel); border: 1px solid var(--line-strong); border-radius: 8px;
  box-shadow: 0 10px 28px rgba(0,0,0,.45); }
.nb-grp-item { display: flex; align-items: center; gap: 10px; padding: 6px 8px;
  background: none; border: 0; border-radius: 5px; color: var(--text); font: inherit;
  font-size: 12px; cursor: pointer; text-align: left; }
.nb-grp-item:hover { background: var(--hover); }
.nb-grp-item.on { background: var(--active); }
.nb-grp-ico { display: flex; width: 18px; justify-content: center; color: var(--dim); }
.nb-grp-item.on .nb-grp-ico { color: var(--text); }
.nb-grp-name { flex: 1; }
.nb-grp-key { color: var(--dim); font-size: 10px; letter-spacing: .06em; }
/* The row's favourite star: dim outline until hovered, gold once pinned.
   Same contract as the chart's drawing favourites. */
/* Faint but ALWAYS there, not hover-revealed like the chart's: on a touch
   monitor a hover-only control does not exist. */
.nb-grp-star { display: flex; align-items: center; padding: 2px;
  border-radius: 3px; color: var(--dim); opacity: .5; }
.nb-grp-item:hover .nb-grp-star { opacity: 1; }
.nb-grp-star:hover { color: #eab308; }
.nb-grp-star.on { opacity: 1; color: #eab308; }
.nb-status { flex: 1; min-width: 0; color: var(--dim); font-size: 10.5px;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.nb-zoom { display: flex; align-items: center; gap: 2px; }
.nb-zoom button { min-width: 26px; height: 22px; padding: 0 6px; background: none;
  border: 1px solid var(--edge); border-radius: 3px; color: var(--dim); font: inherit;
  font-size: 10.5px; cursor: pointer; }
.nb-zoom button:hover { background: var(--hover); color: var(--text); }

/* Floating control cards over the canvas (selection editor + tool palette).
   The body is a COLUMN of labelled rows, not one wrapping flex box: the old
   layout put Colour, Width and the highlighter toggle in one stream and let
   them wrap wherever they landed, which stranded a single nib on its own
   line. Each control group now owns a row and cannot be broken up. */
/* width: max-content, NOT the absolute-position default: shrink-to-fit
   resolves against the space right of the card's anchor, so a card anchored
   mid-canvas got squeezed and wrapped rows it had room for. */
.nb-float { position: absolute; z-index: 40; width: max-content; max-width: 360px;
  background: var(--panel); border: 1px solid var(--line-strong); border-radius: 10px;
  box-shadow: 0 14px 40px rgba(0,0,0,.42), 0 2px 6px rgba(0,0,0,.25); }
.nb-float-grip { display: flex; align-items: center; gap: 8px; padding: 7px 12px 6px 9px;
  color: var(--dim); cursor: grab; border-bottom: 1px solid var(--edge);
  touch-action: none; user-select: none; }
.nb-float-grip:active { cursor: grabbing; }
/* Compact pill: dots and buttons share ONE row; no header, no divider. */
.nb-float-compact { display: flex; align-items: center; }
.nb-float-compact .nb-float-grip { border-bottom: 0; padding: 6px 4px 6px 9px; }
.nb-float-compact .nb-float-body { flex-direction: row; align-items: center;
  gap: 3px; padding: 4px 8px 4px 2px; }
.nb-float-title { font-size: 10px; letter-spacing: .1em; color: var(--title); }
.nb-float-body { display: flex; flex-direction: column; padding: 4px 0 5px; }
/* (.nb-float-break / .nb-float-sep lived here to break and divide a single
   wrapping control stream. The cards are rows now, one control group per
   line, so nothing renders them; removed rather than left to rot.) */

/* One control group, one line. The label column is fixed so every row's
   controls start on the same vertical, which is most of what makes the card
   look built rather than assembled. */
.nb-prow { display: flex; align-items: flex-start; gap: 10px; padding: 5px 12px; }
.nb-prow + .nb-prow { border-top: 1px solid color-mix(in srgb, var(--edge) 55%, transparent); }
.nb-prow-lab { flex: none; width: 46px; padding-top: 7px; color: var(--dim);
  font-size: 9.5px; letter-spacing: .07em; text-transform: uppercase; }
.nb-prow-body { flex: 1; display: flex; align-items: center; flex-wrap: wrap; gap: 5px; }
.nb-prow-gap { flex: none; width: 1px; height: 18px; background: var(--edge); margin: 0 3px; }
.nb-hint { color: var(--dim); font-size: 10.5px; }

/* Instant tooltips: a borderless pill from data-tip, with no hover delay
   (the native title waits a second and drags the OS chrome along with it).
   Cards and everything else show it above; the top toolbar shows it BELOW,
   because above the toolbar is outside the page and the pill would clip. */
.nb-wrap [data-tip] { position: relative; }
.nb-wrap [data-tip]:hover::after { content: attr(data-tip); position: absolute;
  bottom: calc(100% + 7px); left: 50%; transform: translateX(-50%);
  background: var(--bg2); color: var(--text); font-size: 10.5px; line-height: 1;
  padding: 5px 8px; border-radius: 4px; white-space: nowrap; pointer-events: none;
  box-shadow: 0 3px 12px rgba(0,0,0,.45); z-index: 60; }
.nb-bar [data-tip]:hover::after { bottom: auto; top: calc(100% + 7px); }

/* Right-click menu: same card chrome as the panels. */
.nb-menu { position: absolute; z-index: 50; min-width: 168px; padding: 4px;
  background: var(--panel); border: 1px solid var(--line-strong); border-radius: 6px;
  box-shadow: 0 6px 22px rgba(0,0,0,.35); display: flex; flex-direction: column; }
.nb-menu-item { display: block; width: 100%; text-align: left; padding: 6px 10px;
  background: none; border: 0; border-radius: 4px; color: var(--text); font: inherit;
  font-size: 11.5px; cursor: pointer; }
.nb-menu-item:hover { background: var(--hover); }
.nb-menu-item.danger:hover { color: var(--err); }
/* Paper picker: two labelled rows under its toolbar button. */
.nb-paper-menu { min-width: 0; padding: 8px 10px 9px; gap: 6px; }
.nb-paper-row { display: flex; align-items: center; flex-wrap: wrap; gap: 5px; }
.nb-swatch-paper { width: 19px; height: 19px; border-radius: 4px; }
/* The free-colour chip IS the native colour input, sized down to a swatch:
   a separate trigger button would need a popover of its own to host it. */
.nb-swatch-any { position: relative; width: 22px; height: 22px; border-radius: 50%;
  overflow: hidden; background: conic-gradient(#e05d5d, #cdb648, #57a869,
  #4f8fd9, #9a6fd9, #e05d5d); cursor: pointer; }
.nb-paper-menu .nb-swatch-any { border-radius: 6px; }
.nb-swatch-any input { position: absolute; inset: -6px; width: 200%; height: 200%;
  padding: 0; border: 0; background: none; cursor: pointer; opacity: 0; }
.nb-sb-lab { color: var(--dim); font-size: 10px; letter-spacing: .05em;
  text-transform: uppercase; margin: 0 4px 0 8px; }
.nb-sb-lab:first-child { margin-left: 0; }
.nb-sb-val { min-width: 22px; text-align: center; color: var(--text); font-size: 12px; }
/* Card buttons: roomy click targets, no borders anywhere (the bordered
   selected state read as a stray white box; selection is background only). */
.nb-sb-btn { display: flex; align-items: center; justify-content: center; min-width: 30px;
  height: 30px; padding: 0 6px; background: none; border: 0;
  border-radius: 6px; color: var(--dim); font: inherit; font-size: 12.5px; cursor: pointer; }
.nb-sb-btn:hover { background: var(--hover); color: var(--text); }
.nb-sb-btn.on { background: var(--active); color: var(--text); }
.nb-sb-btn.nb-sb-wide { padding: 0 12px; font-size: 10.5px; letter-spacing: .08em; }
.nb-sb-btn.nb-sb-danger:hover { color: var(--err); background: var(--err-bg); }
.nb-sb-flex { flex: 1; }
.nb-dot { display: inline-block; border-radius: 50%; background: currentColor; }
/* Nib picker: a bar drawn at the true stroke weight, so the row is a
   thickness scale you read rather than six identical squares. */
.nb-wbtn { display: flex; align-items: center; justify-content: center; width: 32px;
  height: 30px; padding: 0; background: none; border: 0; border-radius: 6px;
  color: var(--dim); cursor: pointer; }
.nb-wbtn:hover { background: var(--hover); color: var(--text); }
.nb-wbtn.on { background: var(--active); color: var(--text); }
.nb-wbar { display: block; width: 21px; border-radius: 10px; background: currentColor; }
/* Type an exact number where the presets do not have it. */
.nb-num { width: 52px; height: 30px; padding: 0 4px 0 7px; background: var(--bg2);
  border: 1px solid var(--edge); border-radius: 6px; color: var(--text);
  font: inherit; font-size: 12.5px; }
.nb-num:focus { outline: none; border-color: var(--line-strong); }
.nb-num::-webkit-inner-spin-button { opacity: .45; }
/* 22px, up from 17: nine of them are a palette you aim at, and the old ones
   were smaller than the cursor. */
.nb-swatch { width: 22px; height: 22px; border-radius: 50%; border: 1px solid var(--edge);
  cursor: pointer; padding: 0; flex: none; transition: transform .08s ease; }
.nb-swatch:hover { transform: scale(1.14); }
.nb-swatch.on { outline: 2px solid var(--text); outline-offset: 2px; }
.nb-swatch-bg { border-radius: 6px; background: transparent; color: var(--dim);
  font-size: 11px; line-height: 1; display: flex; align-items: center; justify-content: center; }

.nb-canvas { flex: 1; min-height: 0; position: relative; overflow: hidden;
  touch-action: none; cursor: default; }
.nb-canvas.nb-tool-hand { cursor: grab; }
.nb-canvas.nb-tool-pen, .nb-canvas.nb-tool-highlighter, .nb-canvas.nb-tool-line,
.nb-canvas.nb-tool-arrow, .nb-canvas.nb-tool-rect, .nb-canvas.nb-tool-ellipse,
.nb-canvas.nb-tool-triangle, .nb-canvas.nb-tool-diamond,
.nb-canvas.nb-tool-star { cursor: crosshair; }
.nb-canvas.nb-tool-eraser { cursor: cell; }
.nb-canvas.nb-tool-text, .nb-canvas.nb-tool-math, .nb-canvas.nb-tool-sticky,
.nb-canvas.nb-tool-code { cursor: cell; }
/* Rubber band. Drawn inside the scene, so its border is counter-scaled by the
   inline width to stay one screen pixel at any zoom. */
.nb-marquee { position: absolute; pointer-events: none; border-style: solid;
  border-color: var(--nb-sel-edge, var(--line-strong));
  background: color-mix(in srgb, var(--accent-bar, #4f8fd9) 12%, transparent); }
.nb-grid { position: absolute; inset: 0; pointer-events: none;
  background-image: radial-gradient(circle, var(--edge) 1px, transparent 1px); }
.nb-scene { position: absolute; left: 0; top: 0; width: 0; height: 0;
  transform-origin: 0 0; }
/* 1px, NOT 0: an SVG whose viewport has zero width or height is not
   rendered at all per the SVG spec, so the in-flight stroke existed in the
   DOM but painted nothing until pointerup committed it into a real block
   (confirmed by the mid-drag pixel test). With a 1x1 viewport and
   overflow visible the path paints wherever it goes. */
.nb-live-ink { position: absolute; left: 0; top: 0; width: 1px; height: 1px;
  overflow: visible; color: inherit; pointer-events: none; }

/* Blocks are canvas objects, not a document you sweep a caret through: a
   rubber band dragged across them used to leave the browser's blue text
   selection all over the maths and prose it passed. Editing happens in
   the textarea, which keeps its own selection, so nothing is lost. */
.nb-block { position: absolute; box-sizing: border-box; user-select: none; }
.nb-edit, .nb-tex-in { user-select: text; }
/* A drawing's bounding box is not the drawing. Only the ink (.nb-hit, a fat
   transparent band along the same path) and the resize handles are pointed
   at; everything else under the box, a photo inside a circled area most of
   all, keeps receiving its own clicks. */
.nb-block.nb-thin { pointer-events: none; }
.nb-block.nb-thin .nb-hit { pointer-events: stroke; }
.nb-block.nb-thin .nb-handle { pointer-events: auto; }
.nb-block.sel { outline: 1px solid var(--nb-sel-edge, var(--line-strong)); outline-offset: 2px; }
.nb-text, .nb-math { background: transparent; }
.nb-prose { width: 100%; height: 100%; overflow: hidden; line-height: 1.45;
  white-space: pre-wrap; word-break: break-word; padding: 2px; }
.nb-prose.nb-card { border-radius: 6px; padding: 10px 12px; }
.nb-prose.nb-mono, .nb-edit.nb-mono { font-family: var(--code-font);
  white-space: pre; overflow: auto; line-height: 1.5; }
.nb-edit, .nb-tex-in { width: 100%; box-sizing: border-box; background: var(--bg2);
  border: 1px solid var(--line-strong); border-radius: 3px; color: var(--text);
  font: inherit; line-height: 1.45; padding: 4px 6px; resize: none; }
.nb-edit { height: 100%; }
.nb-edit:focus, .nb-tex-in:focus { outline: none; }
/* The LaTeX line is where a formula gets typed and mistyped; at 62px and
   11.5px mono it showed about one line of a derivation. */
.nb-tex-in { position: absolute; left: 0; top: 100%; margin-top: 8px; height: 96px;
  font-family: var(--code-font); font-size: 13.5px; line-height: 1.5; }
/* The rendered formula gets the room it needs: the block grows to the KaTeX
   box (see BlockView), and what still does not fit scrolls instead of being
   silently cut off at the edge of a box nobody set. */
.nb-math-out { width: 100%; height: 100%; display: flex; align-items: center;
  justify-content: center; overflow: auto; padding: 4px 8px; box-sizing: border-box; }
.nb-math-out.nb-card { border-radius: 6px; }
.nb-math-out .katex-display { margin: 0; }
.nb-math-out .katex { font-size: 1em; }
.nb-ph { color: var(--dim); opacity: .75; font-size: 12px; font-style: italic; }
.nb-tex-bad { color: var(--err); font-family: var(--code-font); font-size: 12.5px; }
.nb-img { width: 100%; height: 100%; object-fit: contain; user-select: none; -webkit-user-drag: none; }
/* color: inherit, not var(--text): ink drawn in the theme colour has to
   follow the CANVAS, which may be on a chosen paper the theme knows nothing
   about (white paper in dark mode would otherwise be white ink on white). */
.nb-ink { width: 100%; height: 100%; color: inherit; overflow: visible; }
.nb-handle { position: absolute; width: 10px; height: 10px;
  background: var(--panel); border: 1px solid var(--line-strong);
  border-radius: 2px; }
.nb-handle-br { right: -5px; bottom: -5px; transform-origin: 100% 100%; cursor: nwse-resize; }
.nb-handle-tl { left: -5px; top: -5px; transform-origin: 0 0; cursor: nwse-resize; }
.nb-handle-tr { right: -5px; top: -5px; transform-origin: 100% 0; cursor: nesw-resize; }
.nb-handle-bl { left: -5px; bottom: -5px; transform-origin: 0 100%; cursor: nesw-resize; }

/* Recents on the landing state: your notebooks as cards, newest first, with
   a new-notebook card leading. Overrides the generic .nb-blank button rule
   (block + margin) that the lone first-run button still uses. */
.nb-recent { display: flex; flex-wrap: wrap; gap: 10px; justify-content: center;
  max-width: 660px; margin-top: 18px; }
.nb-blank .nb-recent-card { display: flex; flex-direction: column; gap: 4px;
  align-items: flex-start; width: 190px; margin: 0; padding: 12px 14px;
  background: var(--raise); border: 1px solid var(--edge); border-radius: 6px;
  color: var(--text); font: inherit; text-align: left; cursor: pointer; }
.nb-blank .nb-recent-card:hover { background: var(--raise-h); border-color: var(--line-strong); }
.nb-blank .nb-recent-new { flex-direction: row; align-items: center;
  justify-content: center; gap: 8px; color: var(--dim); }
.nb-blank .nb-recent-new:hover { color: var(--text); }
.nb-recent-plus { font-size: 16px; line-height: 1; }
.nb-recent-name { font-size: 12.5px; max-width: 100%; overflow: hidden;
  text-overflow: ellipsis; white-space: nowrap; }
.nb-recent-meta { font-size: 10.5px; color: var(--dim); }

.nb-blank { flex: 1; display: flex; flex-direction: column; align-items: center;
  justify-content: center; gap: 4px; color: var(--dim); text-align: center; padding: 24px; }
.nb-blank-title { color: var(--text); font-size: 14px; }
.nb-blank-sub { max-width: 420px; line-height: 1.6; }
.nb-blank-err { max-width: 460px; margin-top: 12px; padding: 7px 11px; text-align: left;
  background: var(--err-bg); border: 1px solid var(--err-edge); border-radius: 3px;
  color: var(--err); line-height: 1.5; }

/* Canvas + palette row. The canvas keeps flex:1 and the palette takes its
   own 260px, so opening the palette narrows the canvas instead of covering
   it: a click in the right third used to land on the palette and do nothing. */
.nb-body { flex: 1; min-height: 0; display: flex; }
.nb-palette { flex: none; width: 260px; min-height: 0;
  display: flex; flex-direction: column; background: var(--panel);
  border-left: 1px solid var(--edge); }
.nb-pal-head { display: flex; align-items: center; padding: 8px 8px 7px 12px;
  font-size: 10px; letter-spacing: .09em; color: var(--title); border-bottom: 1px solid var(--edge); }
.nb-pal-head button { margin-left: auto; background: none; border: 0; color: var(--dim);
  font: inherit; cursor: pointer; }
.nb-pal-head button:hover { color: var(--text); }
.nb-pal-hint { padding: 7px 12px; color: var(--dim); font-size: 10.5px; line-height: 1.45;
  border-bottom: 1px solid var(--edge); }
.nb-pal-body { flex: 1; overflow-y: auto; padding: 4px 8px 16px; }
.nb-pal-group { margin-top: 10px; }
.nb-pal-title { color: var(--dim); font-size: 9.5px; letter-spacing: .08em;
  text-transform: uppercase; margin: 0 0 5px 2px; }
.nb-pal-grid { display: grid; grid-template-columns: repeat(6, 1fr); gap: 4px; }
/* Saved equations: one row each, rendered as they will look. The row is the
   drag handle; the small x removes it from the library (not from any canvas). */
.nb-pal-saved { display: flex; flex-direction: column; gap: 4px; }
.nb-pal-eq { display: flex; align-items: center; gap: 2px; }
.nb-pal-eq-body { flex: 1; min-width: 0; overflow: hidden; text-align: left;
  padding: 7px 9px; background: var(--raise); border: 1px solid var(--edge);
  border-radius: 4px; color: var(--text); font: inherit; cursor: grab; }
.nb-pal-eq-body:active { cursor: grabbing; }
.nb-pal-eq-body:hover { background: var(--raise-h); border-color: var(--line-strong); }
.nb-pal-eq-body .katex { font-size: 14px; }
.nb-pal-eq-raw { font-family: var(--code-font); font-size: 11px; color: var(--dim); }
.nb-pal-eq-x { width: 22px; height: 22px; flex: none; background: none; border: 0;
  color: var(--dim); cursor: pointer; border-radius: 3px; font-size: 10px; }
.nb-pal-eq-x:hover { background: var(--hover); color: var(--err); }

.nb-pal-grid button { height: 32px; display: flex; align-items: center; justify-content: center;
  background: var(--item); border: 1px solid transparent; border-radius: 5px; color: var(--text);
  font-family: KaTeX_Main, var(--mono); font-size: 14px; cursor: pointer; padding: 0 2px; }
.nb-pal-grid button:hover { background: var(--hover); border-color: var(--edge); }
`;
