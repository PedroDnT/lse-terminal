import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Keyboard,
  Zap,
  Cloud,
  Smartphone,
  Minus,
  Square,
  Paintbrush,
  ArrowRight
} from 'lucide-react';
import { useNavigate, useLocation } from 'react-router-dom';

interface ShortcutsSignupPromptProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export default function ShortcutsSignupPrompt({ open, onOpenChange }: ShortcutsSignupPromptProps) {
  const navigate = useNavigate();
  const location = useLocation();

  const handleSignUp = () => {
    onOpenChange(false);
    const returnTo = encodeURIComponent(location.pathname + location.search);
    navigate(`/auth?returnTo=${returnTo}`);
  };

  // Example shortcuts preview
  const previewShortcuts = [
    { key: 'T', tool: 'Trend Line', icon: <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><line x1="4" y1="20" x2="20" y2="4" /></svg> },
    { key: 'H', tool: 'Horizontal Line', icon: <Minus className="h-4 w-4" /> },
    { key: 'R', tool: 'Rectangle', icon: <Square className="h-4 w-4" /> },
    { key: 'B', tool: 'Brush', icon: <Paintbrush className="h-4 w-4" /> },
  ];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md p-0 gap-0 overflow-hidden">
        {/* Hero Section */}
        <div className="relative bg-gradient-to-br from-foreground/10 via-foreground/5 to-background p-6 pb-8">
          <div className="absolute inset-0 bg-[radial-gradient(circle_at_30%_20%,hsl(var(--foreground)/0.08),transparent_50%)]" />
          <div className="relative">
            <div className="flex items-center gap-3 mb-3">
              {/* dark:border-border: foreground/20 reads as a bright white ring
                  around the icon chip in dark mode; the fill already defines it. */}
              <div className="p-2.5 rounded-xl bg-foreground/10 border border-foreground/20 dark:border-border">
                <Keyboard className="h-6 w-6 text-foreground" />
              </div>
              <div>
                <DialogTitle className="text-xl font-bold">
                  Custom Shortcuts
                </DialogTitle>
                <DialogDescription className="text-sm text-muted-foreground">
                  Trade faster with keyboard shortcuts
                </DialogDescription>
              </div>
            </div>
          </div>
        </div>

        {/* Preview Section */}
        <div className="p-4 border-b border-border">
          <p className="text-xs font-medium text-muted-foreground mb-3 uppercase tracking-wide">
            Example Shortcuts
          </p>
          <div className="grid grid-cols-2 gap-2">
            {previewShortcuts.map((item) => (
              <div
                key={item.key}
                className="flex items-center gap-2 p-2.5 rounded-lg bg-muted/50 border border-border/50"
              >
                <Badge variant="secondary" className="font-mono text-sm px-2 py-0.5 min-w-[28px] justify-center">
                  {item.key}
                </Badge>
                <ArrowRight className="h-3 w-3 text-muted-foreground" />
                <span className="text-muted-foreground">{item.icon}</span>
                <span className="text-xs font-medium truncate">{item.tool}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Benefits */}
        <div className="p-4 space-y-3">
          <div className="flex items-start gap-3">
            <div className="p-1.5 rounded-lg bg-emerald-500/10">
              <Zap className="h-4 w-4 text-emerald-500" />
            </div>
            <div>
              <p className="text-sm font-medium">Lightning Fast</p>
              <p className="text-xs text-muted-foreground">
                Switch tools instantly without clicking
              </p>
            </div>
          </div>
          <div className="flex items-start gap-3">
            <div className="p-1.5 rounded-lg bg-blue-500/10">
              <Cloud className="h-4 w-4 text-blue-500" />
            </div>
            <div>
              <p className="text-sm font-medium">Cloud Synced</p>
              <p className="text-xs text-muted-foreground">
                Your shortcuts sync across all devices
              </p>
            </div>
          </div>
          <div className="flex items-start gap-3">
            <div className="p-1.5 rounded-lg bg-purple-500/10">
              <Smartphone className="h-4 w-4 text-purple-500" />
            </div>
            <div>
              <p className="text-sm font-medium">Fully Customizable</p>
              <p className="text-xs text-muted-foreground">
                Assign any key to any drawing tool
              </p>
            </div>
          </div>
        </div>

        {/* CTA */}
        <div className="p-4 bg-muted/30 border-t border-border">
          <Button
            onClick={handleSignUp}
            className="w-full h-11 text-sm font-semibold bg-black text-white hover:bg-black/90 dark:bg-white dark:text-black dark:hover:bg-white/90"
          >
            Sign Up Free to Unlock
          </Button>
          <p className="text-[11px] text-muted-foreground text-center mt-2">
            Free account • No credit card required
          </p>
        </div>
      </DialogContent>
    </Dialog>
  );
}
