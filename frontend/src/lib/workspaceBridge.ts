// ============================================================================
// workspaceBridge.ts - mirrors the chart's UI preferences into the workspace
// file so they ship with the user's install rather than their browser cache.
//
// A few ported components persist small UI preferences straight to
// localStorage: which drawing tools are favourited, where the favourites
// toolbar sits, and the sidebar width. Those are exactly the "tools and layout"
// state a downloaded app should keep in a file - survive a cache clear, a
// reinstall, a machine move - but rewriting those components would mean
// diverging from the original engine for no behavioural gain.
//
// So instead of editing them, this bridges at the boundary:
//   - on boot, the saved values are hydrated INTO localStorage before the chart
//     first renders, so the components read them exactly as they always did;
//   - afterwards, writes to the tracked keys are mirrored back out to the
//     workspace file.
//
// Net effect: the ported components stay byte-identical, and the user's tool
// setup lives in ~/.config/lse-terminal/workspace.json.
// ============================================================================

// Only these keys are mirrored. An allowlist, not "everything in localStorage",
// so unrelated browser state never leaks into the user's workspace file.
const TRACKED = [
  'lse-drawing-favorites',      // which drawing tools are favourited
  'lse-drawing-favorites-pos',  // position of the floating favourites toolbar
  'chart-sidebar-width',        // chart sidebar width
] as const;

let ready = false;
let flushTimer: ReturnType<typeof setTimeout> | null = null;

async function flush(): Promise<void> {
  const tools: Record<string, string> = {};
  for (const key of TRACKED) {
    const v = localStorage.getItem(key);
    if (v !== null) tools[key] = v;
  }
  try {
    await fetch('/api/workspace/tools', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(tools),
    });
  } catch {
    // Losing a preference write must never interrupt the user's interaction;
    // the value stays correct in this session and will be retried on the next
    // change.
  }
}

// Writes are coalesced: dragging the favourites toolbar fires a setItem per
// pointer move, and each one would otherwise be a request plus a file rewrite.
function scheduleFlush(): void {
  if (flushTimer) clearTimeout(flushTimer);
  flushTimer = setTimeout(() => { flushTimer = null; void flush(); }, 400);
}

/**
 * Load saved preferences into localStorage and start mirroring changes back.
 * Must be awaited BEFORE the chart first renders, otherwise the components
 * read empty defaults and then immediately overwrite the saved values.
 */
export async function initWorkspaceBridge(): Promise<void> {
  if (ready) return;
  ready = true;

  try {
    const res = await fetch('/api/workspace/tools');
    if (res.ok) {
      const body = await res.json();
      const tools = (body?.value ?? {}) as Record<string, string>;
      for (const key of TRACKED) {
        const v = tools[key];
        // Only hydrate keys the file actually carries, so a fresh install
        // falls through to each component's own default.
        if (typeof v === 'string') localStorage.setItem(key, v);
      }
    }
  } catch {
    // No saved workspace (or the engine is briefly unreachable): the chart
    // starts from defaults, which is the correct first-run behaviour.
  }

  // Patch after hydrating, so the hydration writes above do not themselves
  // trigger a flush back to disk.
  const nativeSetItem = localStorage.setItem.bind(localStorage);
  const nativeRemoveItem = localStorage.removeItem.bind(localStorage);

  localStorage.setItem = (key: string, value: string) => {
    nativeSetItem(key, value);
    if ((TRACKED as readonly string[]).includes(key)) scheduleFlush();
  };
  localStorage.removeItem = (key: string) => {
    nativeRemoveItem(key);
    if ((TRACKED as readonly string[]).includes(key)) scheduleFlush();
  };
}
