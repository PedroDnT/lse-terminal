// ============================================================================
// MiniBrueEditor.tsx - terminal stub.
//
// Upstream this is a Monaco-based inline Brue script editor inside the
// indicator selector, tied to server-saved scripts. The terminal ships its own
// full indicator editor in the shell (the pencil button), and bundling Monaco
// would triple the bundle for a duplicate surface, so this renders nothing.
// The props contract is preserved verbatim so IndicatorSelector stays
// byte-identical to the original.
// ============================================================================

import { IndicatorConfig } from './IndicatorSettings';

interface MiniBrueEditorProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  config: IndicatorConfig;
  onConfigChange: (config: IndicatorConfig) => void;
  onSaved?: () => void;
  savedScripts: { id: string; name: string; code: string }[];
}

export default function MiniBrueEditor(_props: MiniBrueEditorProps) {
  return null;
}
