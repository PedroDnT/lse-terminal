import { useState, useEffect, useRef } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import LoginModal from '@/components/auth/LoginModal';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import {
  Keyboard,
  X,
  Trash2,
  Star,
  TrendingUp,
  Minus,
  ChevronRight,
  MoveVertical,
  ArrowRight,
  Activity,
  Ruler,
  RectangleHorizontal,
  Square,
  Circle,
  Triangle,
  Octagon,
  Paintbrush,
  Highlighter,
  Type,
  ArrowUpCircle,
  ArrowDownCircle
} from 'lucide-react';
import { DrawingTool } from '@/components/chart/ChartDrawingOverlay';
import { DRAWING_TOOLS, formatShortcut } from '@/hooks/useDrawingShortcuts';
import { getDrawingFavorites, toggleDrawingFavorite } from '@/components/chart/FavoritesDrawingToolbar';
import { toast } from 'sonner';
import { LongPositionIcon, ShortPositionIcon } from '@/components/chart/DrawingToolIcons';

interface DrawingShortcutsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  shortcuts: Record<string, DrawingTool>;
  onSetShortcut: (shortcut: string, tool: DrawingTool) => void;
  onRemoveShortcut: (tool: DrawingTool) => void;
  getShortcutForTool: (tool: DrawingTool) => string | null;
  onClearAll: () => void;
}

// Get icon for a tool
const getToolIcon = (toolId: DrawingTool) => {
  const iconClass = "h-4 w-4";
  switch (toolId) {
    case 'trend': return <TrendingUp className={iconClass} />;
    case 'horizontal': return <Minus className={iconClass} />;
    case 'horizontalRay': return <ChevronRight className={iconClass} />;
    case 'vertical': return <MoveVertical className={iconClass} />;
    case 'line': return <svg className={iconClass} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="4" y1="20" x2="20" y2="4" /></svg>;
    case 'straightArrow': return <ArrowRight className={iconClass} />;
    case 'fibonacci': return <Activity className={iconClass} />;
    case 'measure': return <Ruler className={iconClass} />;
    case 'rectangle': return <RectangleHorizontal className={iconClass} />;
    case 'square': return <Square className={iconClass} />;
    case 'circle': return <Circle className={iconClass} />;
    case 'oval': return <Circle className={iconClass} style={{ transform: 'scaleX(1.3)' }} />;
    case 'triangle':
    case 'freeTriangle': return <Triangle className={iconClass} />;
    case 'parallelogram': return (
      <svg className={iconClass} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <polygon points="6,4 22,4 18,20 2,20" />
      </svg>
    );
    case 'octagon': return <Octagon className={iconClass} />;
    case 'brush': return <Paintbrush className={iconClass} />;
    case 'highlighter': return <Highlighter className={iconClass} />;
    case 'arrow': return <ArrowRight className={iconClass} />;
    case 'text': return <Type className={iconClass} />;
    case 'long': return <LongPositionIcon className={iconClass} />;
    case 'short': return <ShortPositionIcon className={iconClass} />;
    default: return null;
  }
};

export default function DrawingShortcutsDialog({
  open,
  onOpenChange,
  shortcuts,
  onSetShortcut,
  onRemoveShortcut,
  getShortcutForTool,
  onClearAll,
}: DrawingShortcutsDialogProps) {
  const [recordingFor, setRecordingFor] = useState<DrawingTool | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [favorites, setFavorites] = useState<string[]>(getDrawingFavorites);
  const [showLoginForFavorites, setShowLoginForFavorites] = useState(false);
  const { user } = useAuth();
  const inputRef = useRef<HTMLInputElement>(null);

  // Listen for favorites changes from other components
  useEffect(() => {
    const handleFavChange = () => setFavorites(getDrawingFavorites());
    window.addEventListener('drawingFavoritesChanged', handleFavChange);
    return () => window.removeEventListener('drawingFavoritesChanged', handleFavChange);
  }, []);

  // Group tools by category
  const toolsByCategory = DRAWING_TOOLS.reduce((acc, tool) => {
    if (!acc[tool.category]) acc[tool.category] = [];
    acc[tool.category].push(tool);
    return acc;
  }, {} as Record<string, typeof DRAWING_TOOLS>);

  // Filter tools by search
  const filteredCategories = Object.entries(toolsByCategory).reduce((acc, [category, tools]) => {
    const filtered = tools.filter(tool =>
      tool.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      category.toLowerCase().includes(searchQuery.toLowerCase())
    );
    if (filtered.length > 0) acc[category] = filtered;
    return acc;
  }, {} as Record<string, typeof DRAWING_TOOLS>);

  // Handle keyboard recording
  useEffect(() => {
    if (!recordingFor) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      e.preventDefault();
      e.stopPropagation();

      // Escape cancels recording
      if (e.key === 'Escape') {
        setRecordingFor(null);
        return;
      }

      const shortcut = formatShortcut(e);
      if (!shortcut) return; // Skip if only modifier keys

      // Check if shortcut is already assigned to another tool
      const existingTool = shortcuts[shortcut];
      if (existingTool && existingTool !== recordingFor) {
        const existingToolName = DRAWING_TOOLS.find(t => t.id === existingTool)?.name;
        toast.error(`Shortcut already assigned to ${existingToolName}`);
        return;
      }

      onSetShortcut(shortcut, recordingFor);
      setRecordingFor(null);
      toast.success(`Shortcut set: ${shortcut}`);
    };

    window.addEventListener('keydown', handleKeyDown, true);
    return () => window.removeEventListener('keydown', handleKeyDown, true);
  }, [recordingFor, shortcuts, onSetShortcut]);

  // Focus input when opening
  useEffect(() => {
    if (open) {
      setSearchQuery('');
      setRecordingFor(null);
    }
  }, [open]);

  const assignedCount = Object.keys(shortcuts).length;

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-w-md max-h-[85vh] flex flex-col p-0 gap-0">
          <DialogHeader className="p-4 pb-3 border-b border-border">
            <DialogTitle className="flex items-center gap-2 text-base">
              <Keyboard className="h-5 w-5" />
              Drawing Shortcuts
            </DialogTitle>
            <p className="text-xs text-muted-foreground mt-1">
              Assign keyboard shortcuts to quickly select drawing tools
            </p>
          </DialogHeader>

          <div className="p-3 border-b border-border">
            <div className="flex items-center gap-2">
              <Input
                ref={inputRef}
                placeholder="Search tools..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="h-8 text-sm"
              />
              {assignedCount > 0 && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-8 px-2 text-xs text-muted-foreground hover:text-destructive whitespace-nowrap"
                  onClick={() => {
                    onClearAll();
                    toast.success('All shortcuts cleared');
                  }}
                >
                  <Trash2 className="h-3 w-3 mr-1" />
                  Clear All
                </Button>
              )}
            </div>
            {assignedCount > 0 && (
              <p className="text-[11px] text-muted-foreground mt-2">
                {assignedCount} shortcut{assignedCount !== 1 ? 's' : ''} assigned
              </p>
            )}
          </div>

          <ScrollArea className="flex-1 overflow-auto" style={{ maxHeight: 'calc(85vh - 180px)' }}>
            <div className="space-y-4 px-3 py-2">
              {Object.entries(filteredCategories).map(([category, tools]) => (
                <div key={category}>
                  <h3 className="text-xs font-semibold text-muted-foreground mb-2 px-1">
                    {category}
                  </h3>
                  <div className="space-y-1">
                    {tools.map((tool) => {
                      const shortcut = getShortcutForTool(tool.id);
                      const isRecording = recordingFor === tool.id;

                      return (
                        <div
                          key={tool.id}
                          className={`flex items-center justify-between p-2 rounded-lg transition-colors ${isRecording
                            ? 'bg-foreground/10 border border-foreground/40'
                            : 'hover:bg-muted/50'
                            }`}
                        >
                          <div className="flex items-center gap-2">
                            <span className="text-muted-foreground">
                              {getToolIcon(tool.id)}
                            </span>
                            <span className="text-sm font-medium">{tool.name}</span>
                          </div>

                          <div className="flex items-center gap-1">
                            {shortcut && !isRecording && (
                              <>
                                <Badge
                                  variant="secondary"
                                  className="font-mono text-xs px-2 py-0.5"
                                >
                                  {shortcut}
                                </Badge>
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  className="h-6 w-6 text-muted-foreground hover:text-destructive"
                                  onClick={() => {
                                    onRemoveShortcut(tool.id);
                                    toast.success('Shortcut removed');
                                  }}
                                >
                                  <X className="h-3 w-3" />
                                </Button>
                              </>
                            )}

                            {/* Favorite star toggle */}
                            <button
                              className="p-1 rounded transition-all hover:bg-muted/80"
                              onClick={() => {
                                if (!user) {
                                  setShowLoginForFavorites(true);
                                  return;
                                }
                                const updated = toggleDrawingFavorite(tool.id as string);
                                setFavorites(updated);
                                toast.success(updated.includes(tool.id as string) ? `${tool.name} added to favorites` : `${tool.name} removed from favorites`);
                              }}
                              title={favorites.includes(tool.id as string) ? 'Remove from Favorites' : 'Add to Favorites'}
                            >
                              <Star className={`h-4 w-4 transition-colors ${favorites.includes(tool.id as string) ? 'fill-yellow-400 text-yellow-400' : 'text-zinc-500 hover:text-yellow-400'}`} />
                            </button>

                            {isRecording ? (
                              <div className="flex items-center gap-1">
                                <Badge
                                  variant="default"
                                  className="bg-foreground text-background animate-pulse text-xs"
                                >
                                  Press keys...
                                </Badge>
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  className="h-6 w-6"
                                  onClick={() => setRecordingFor(null)}
                                >
                                  <X className="h-3 w-3" />
                                </Button>
                              </div>
                            ) : (
                              <Button
                                variant="ghost"
                                size="sm"
                                className="h-7 px-2 text-xs"
                                onClick={() => setRecordingFor(tool.id)}
                              >
                                {shortcut ? 'Change' : 'Set'}
                              </Button>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              ))}

              {Object.keys(filteredCategories).length === 0 && (
                <div className="text-center py-8 text-muted-foreground">
                  <p className="text-sm">No tools found</p>
                </div>
              )}
            </div>
          </ScrollArea>

          <div className="p-3 border-t border-border bg-muted/30 flex items-center justify-between">
            <p className="text-xs font-medium text-muted-foreground">
              Click "Set" then press <span className="bg-foreground/15 text-foreground px-1.5 py-0.5 rounded font-mono">Shift</span> + any key
            </p>
            <Button
              variant="default"
              size="sm"
              className="h-8 px-4 text-sm font-medium"
              onClick={() => onOpenChange(false)}
            >
              Done
            </Button>
          </div>
        </DialogContent>
      </Dialog>
      <LoginModal
        open={showLoginForFavorites}
        onOpenChange={setShowLoginForFavorites}
        message="Sign in to save your favorite drawing tools and sync them across devices."
      />
    </>
  );
}
