import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

// The chart is built as a single self-contained IIFE bundle that the existing
// terminal shell (ui/static/app.js) mounts into its #chart element. Building a
// library rather than a full page is what lets the ported React engine drop in
// without rewriting the shell's MARKETS / BACKTEST / MY DATA sections.
// KaTeX declares each of its 20 faces three times over (woff2, then woff and
// ttf fallbacks). Since every face is inlined as a data: URI (see
// assetsInlineLimit below), keeping the fallbacks would embed the same fonts
// three times and cost ~1.1 MB of dead weight in chart.css. The terminal only
// ever runs in a Chromium-class webview, which has supported woff2 since 2014,
// so the two older formats are dropped before the CSS is processed.
const katexWoff2Only = {
  name: 'katex-woff2-only',
  // 'pre', or Vite's own CSS plugin turns the url()s into asset references
  // before this ever sees them and the fallbacks survive.
  enforce: 'pre' as const,
  transform(code: string, id: string) {
    if (!id.includes('katex') || !id.endsWith('.css')) return null;
    return {
      code: code
        .replace(/,\s*url\([^)]*\.woff\)\s*format\("woff"\)/g, '')
        .replace(/,\s*url\([^)]*\.ttf\)\s*format\("truetype"\)/g, ''),
      map: null,
    };
  },
};

export default defineConfig({
  plugins: [react(), katexWoff2Only],
  // Some libraries in the closure branch on `process.env.NODE_ENV` at runtime.
  // In a normal Vite app page that is substituted automatically, but a library
  // build leaves the reference intact and the browser throws "process is not
  // defined" on load. Substituting it here keeps the bundle self-contained.
  define: {
    'process.env.NODE_ENV': JSON.stringify('production'),
    'process.env': '{}',
    global: 'globalThis',
  },
  resolve: {
    alias: { '@': path.resolve(__dirname, './src') },
  },
  build: {
    // Emit straight into the directory FastAPI already serves.
    outDir: path.resolve(__dirname, '../lse_terminal/ui/static/chart'),
    emptyOutDir: true,
    lib: {
      entry: path.resolve(__dirname, 'src/mount.tsx'),
      name: 'LSEChart',
      formats: ['iife'],
      fileName: () => 'chart.js',
    },
    // Every asset is inlined as a data: URI rather than emitted beside the
    // bundle. Two reasons, both hard: the terminal ships as a local app with
    // no CDN, so a font that lives in a separate file is a font that can go
    // missing; and `assetFileNames: 'chart.[ext]'` gives every emitted asset
    // the SAME name, so KaTeX's 20 woff2 faces would overwrite each other and
    // leave the maths rendering in whichever face happened to be written
    // last. The limit is above the largest KaTeX face (~76 KB).
    assetsInlineLimit: 512 * 1024,
    // React is bundled in (not externalised): the terminal ships as a local
    // app with no CDN access, so everything must be self-contained.
    rollupOptions: {
      output: { assetFileNames: 'chart.[ext]' },
    },
  },
});
