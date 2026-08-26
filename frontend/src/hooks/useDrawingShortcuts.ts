import { useState, useEffect, useCallback } from 'react';
import { DrawingTool } from '@/components/chart/ChartDrawingOverlay';
import { api } from '@/lib/api';
import { useAuth } from '@/contexts/AuthContext';

// All available drawing tools with their display names
export const DRAWING_TOOLS: { id: DrawingTool; name: string; category: string }[] = [
  // Lines
  { id: 'trend', name: 'Trend Line', category: 'Lines' },
  { id: 'horizontal', name: 'Horizontal Line', category: 'Lines' },
  { id: 'horizontalRay', name: 'Horizontal Ray', category: 'Lines' },
  { id: 'vertical', name: 'Vertical Line', category: 'Lines' },
  { id: 'line', name: 'Straight Line', category: 'Lines' },
  { id: 'straightArrow', name: 'Arrow Line', category: 'Lines' },

  // Fibonacci & Analysis
  { id: 'fibonacci', name: 'Fibonacci', category: 'Analysis' },
  { id: 'measure', name: 'Measure Tool', category: 'Analysis' },

  // Shapes
  { id: 'rectangle', name: 'Rectangle', category: 'Shapes' },
  { id: 'square', name: 'Square', category: 'Shapes' },
  { id: 'circle', name: 'Circle', category: 'Shapes' },
  { id: 'oval', name: 'Oval', category: 'Shapes' },
  { id: 'triangle', name: 'Triangle', category: 'Shapes' },
  { id: 'freeTriangle', name: 'Free Triangle', category: 'Shapes' },
  { id: 'parallelogram', name: 'Parallelogram', category: 'Shapes' },
  { id: 'octagon', name: 'Octagon', category: 'Shapes' },

  // Brush Tools
  { id: 'brush', name: 'Brush', category: 'Freehand' },
  { id: 'highlighter', name: 'Highlighter', category: 'Freehand' },
  { id: 'arrow', name: 'Arrow Marker', category: 'Freehand' },

  // Text & Positions
  { id: 'text', name: 'Text', category: 'Annotations' },
  { id: 'long', name: 'Long Position', category: 'Positions' },
  { id: 'short', name: 'Short Position', category: 'Positions' },
];

export type ShortcutMap = Record<string, DrawingTool>;

// Format a keyboard event to a shortcut string (requires Shift + key)
export const formatShortcut = (e: KeyboardEvent): string => {
  // Must have Shift pressed (but not Ctrl/Alt/Meta)
  if (!e.shiftKey || e.ctrlKey || e.metaKey || e.altKey) return '';

  // Don't allow modifier keys alone
  if (['Control', 'Alt', 'Shift', 'Meta'].includes(e.key)) return '';

  // Get the key
  let key = e.key;
  if (key === ' ') key = 'Space';
  else if (key.length === 1) key = key.toUpperCase();
  else if (key === 'ArrowUp') key = '↑';
  else if (key === 'ArrowDown') key = '↓';
  else if (key === 'ArrowLeft') key = '←';
  else if (key === 'ArrowRight') key = '→';

  return `Shift+${key}`;
};

// Parse a shortcut string back to check against keyboard events (Shift + key matching)
export const matchesShortcut = (shortcut: string, e: KeyboardEvent): boolean => {
  // Must have Shift pressed (but not Ctrl/Alt/Meta)
  if (!e.shiftKey || e.ctrlKey || e.metaKey || e.altKey) return false;

  // Extract the key from "Shift+X" format
  if (!shortcut.startsWith('Shift+')) return false;
  const expectedKey = shortcut.substring(6); // Remove "Shift+" prefix

  let eventKey = e.key;
  if (eventKey === ' ') eventKey = 'Space';
  else if (eventKey.length === 1) eventKey = eventKey.toUpperCase();
  else if (eventKey === 'ArrowUp') eventKey = '↑';
  else if (eventKey === 'ArrowDown') eventKey = '↓';
  else if (eventKey === 'ArrowLeft') eventKey = '←';
  else if (eventKey === 'ArrowRight') eventKey = '→';

  return expectedKey === eventKey;
};

export function useDrawingShortcuts(onToolSelect?: (tool: DrawingTool) => void) {
  const { user } = useAuth();
  const [shortcuts, setShortcuts] = useState<ShortcutMap>({});
  const [isLoading, setIsLoading] = useState(true);
  const [showSignupPrompt, setShowSignupPrompt] = useState(false);
  const [hasUserModified, setHasUserModified] = useState(false);

  // Load shortcuts from dedicated drawing_shortcuts table
  useEffect(() => {
    if (!user) {
      setShortcuts({});
      setIsLoading(false);
      setHasUserModified(false);
      return;
    }

    const loadShortcuts = async () => {
      try {
        const data = await api.getDrawingShortcuts();

        if (data?.shortcuts && typeof data.shortcuts === 'object') {
          setShortcuts(data.shortcuts as ShortcutMap);
          console.log('Loaded shortcuts from drawing_shortcuts table:', data.shortcuts);
        }
      } catch (err) {
        console.error('Failed to load shortcuts:', err);
      } finally {
        setIsLoading(false);
        setHasUserModified(false);
      }
    };

    loadShortcuts();
  }, [user]);

  // Save shortcuts to dedicated drawing_shortcuts table (debounced)
  useEffect(() => {
    if (!user || isLoading || !hasUserModified) return;

    const saveShortcuts = async () => {
      try {
        await api.upsertDrawingShortcuts(shortcuts);
        console.log('Shortcuts saved to drawing_shortcuts table:', shortcuts);
      } catch (err) {
        console.error('Failed to save shortcuts:', err);
      }
    };

    const timeout = setTimeout(saveShortcuts, 500);
    return () => clearTimeout(timeout);
  }, [shortcuts, user, isLoading, hasUserModified]);

  // Set a shortcut for a tool (requires login)
  const setShortcut = useCallback((shortcut: string, tool: DrawingTool) => {
    if (!user) {
      setShowSignupPrompt(true);
      return;
    }

    setShortcuts(prev => {
      const newShortcuts = { ...prev };
      // Remove any existing shortcut for this tool
      Object.keys(newShortcuts).forEach(key => {
        if (newShortcuts[key] === tool) {
          delete newShortcuts[key];
        }
      });
      // Set the new shortcut
      if (shortcut) {
        newShortcuts[shortcut] = tool;
      }
      return newShortcuts;
    });
    setHasUserModified(true);
  }, [user]);

  // Remove a shortcut for a tool
  const removeShortcut = useCallback((tool: DrawingTool) => {
    if (!user) {
      setShowSignupPrompt(true);
      return;
    }

    setShortcuts(prev => {
      const newShortcuts = { ...prev };
      Object.keys(newShortcuts).forEach(key => {
        if (newShortcuts[key] === tool) {
          delete newShortcuts[key];
        }
      });
      return newShortcuts;
    });
    setHasUserModified(true);
  }, [user]);

  // Get the shortcut for a specific tool
  const getShortcutForTool = useCallback((tool: DrawingTool): string | null => {
    const entry = Object.entries(shortcuts).find(([, t]) => t === tool);
    return entry ? entry[0] : null;
  }, [shortcuts]);

  // Clear all shortcuts
  const clearAllShortcuts = useCallback(() => {
    if (!user) {
      setShowSignupPrompt(true);
      return;
    }
    setShortcuts({});
    setHasUserModified(true);
  }, [user]);

  // Check if user can use shortcuts (for UI gating)
  const requiresAuth = useCallback(() => {
    if (!user) {
      setShowSignupPrompt(true);
      return true;
    }
    return false;
  }, [user]);

  // Listen for keyboard shortcuts
  useEffect(() => {
    if (!onToolSelect || !user) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      // Don't trigger in input fields
      const target = e.target as HTMLElement;
      if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable) {
        return;
      }

      // Check all shortcuts
      for (const [shortcut, tool] of Object.entries(shortcuts)) {
        if (matchesShortcut(shortcut, e)) {
          e.preventDefault();
          onToolSelect(tool);
          return;
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [shortcuts, onToolSelect, user]);

  return {
    shortcuts,
    setShortcut,
    removeShortcut,
    getShortcutForTool,
    clearAllShortcuts,
    isLoggedIn: !!user,
    isLoading,
    showSignupPrompt,
    setShowSignupPrompt,
    requiresAuth,
  };
}
