import React, { useState, useRef, useEffect, useCallback } from "react";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import {
    TrendingUp,
    Minus,
    Type,
    Square,
    RectangleHorizontal,
    Paintbrush,
    Activity,
    GripVertical,
    ChevronRight,
    ArrowRight,
    MoveVertical,
    Circle,
    Triangle,
    Octagon,
    Highlighter,
    MousePointer2,
    Ruler,
} from "lucide-react";
import type { DrawingTool } from "@/components/chart/ChartDrawingOverlay";
import { LongPositionIcon, ShortPositionIcon } from "@/components/chart/DrawingToolIcons";

// Tool metadata: icon and label for each drawing tool
export const DRAWING_TOOL_META: Record<string, { icon: React.ReactNode; label: string; category?: string }> = {
    trend: { icon: <TrendingUp className="h-4 w-4" />, label: "Trend Line", category: "lines" },
    trendRay: { icon: <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="4" cy="12" r="1.5" fill="currentColor" /><line x1="5.5" y1="12" x2="20" y2="4" /></svg>, label: "Trend Line Ray", category: "lines" },
    parallelChannel: { icon: <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="2" y1="18" x2="22" y2="10" /><line x1="2" y1="10" x2="22" y2="2" /></svg>, label: "Parallel Channel", category: "lines" },
    straightArrow: { icon: <ArrowRight className="h-4 w-4" />, label: "Arrow", category: "lines" },
    horizontal: { icon: <Minus className="h-4 w-4" />, label: "Horizontal Line", category: "lines" },
    horizontalRay: { icon: <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="4" cy="12" r="1.5" fill="currentColor" /><line x1="5.5" y1="12" x2="20" y2="12" /><polyline points="17,9 20,12 17,15" /></svg>, label: "Horizontal Ray", category: "lines" },
    vertical: { icon: <MoveVertical className="h-4 w-4" />, label: "Vertical Line", category: "lines" },
    line: { icon: <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="4" y1="20" x2="20" y2="4" /></svg>, label: "Straight Line", category: "lines" },
    fibonacci: { icon: <Activity className="h-4 w-4" />, label: "Fib Retracement", category: "analysis" },
    fibExtension: { icon: <TrendingUp className="h-4 w-4" />, label: "Fib Extension", category: "analysis" },
    rectangle: { icon: <RectangleHorizontal className="h-4 w-4" />, label: "Rectangle", category: "shapes" },
    square: { icon: <Square className="h-4 w-4" />, label: "Square", category: "shapes" },
    circle: { icon: <Circle className="h-4 w-4" />, label: "Circle", category: "shapes" },
    oval: { icon: <Circle className="h-4 w-4" style={{ transform: 'scaleX(1.3)' }} />, label: "Oval", category: "shapes" },
    triangle: { icon: <Triangle className="h-4 w-4" />, label: "Triangle", category: "shapes" },
    freeTriangle: { icon: <Triangle className="h-4 w-4" style={{ opacity: 0.7 }} />, label: "Free Triangle", category: "shapes" },
    parallelogram: {
        icon: (
            <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <polygon points="6,4 22,4 18,20 2,20" />
            </svg>
        ),
        label: "Parallelogram",
        category: "shapes",
    },
    octagon: { icon: <Octagon className="h-4 w-4" />, label: "Octagon", category: "shapes" },
    brush: { icon: <Paintbrush className="h-4 w-4" />, label: "Brush", category: "draw" },
    highlighter: { icon: <Highlighter className="h-4 w-4" />, label: "Highlighter", category: "draw" },
    arrow: { icon: <MousePointer2 className="h-4 w-4" />, label: "Arrow Marker", category: "draw" },
    text: { icon: <Type className="h-4 w-4" />, label: "Text", category: "draw" },
    long: { icon: <LongPositionIcon className="h-4 w-4" />, label: "Long Position", category: "position" },
    short: { icon: <ShortPositionIcon className="h-4 w-4" />, label: "Short Position", category: "position" },
    measure: { icon: <Ruler className="h-4 w-4" />, label: "Measure", category: "analysis" },
};

const STORAGE_KEY = 'lse-drawing-favorites';

export function getDrawingFavorites(): string[] {
    try {
        const saved = localStorage.getItem(STORAGE_KEY);
        return saved ? JSON.parse(saved) : [];
    } catch {
        return [];
    }
}

export function setDrawingFavorites(favorites: string[]) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(favorites));
    window.dispatchEvent(new Event('drawingFavoritesChanged'));
}

export function toggleDrawingFavorite(toolId: string): string[] {
    const current = getDrawingFavorites();
    let updated: string[];
    if (current.includes(toolId)) {
        updated = current.filter(t => t !== toolId);
    } else {
        updated = [...current, toolId];
    }
    setDrawingFavorites(updated);
    return updated;
}

interface FavoritesDrawingToolbarProps {
    activeTool: DrawingTool;
    onToolSelect: (tool: DrawingTool) => void;
}

export default function FavoritesDrawingToolbar({
    activeTool,
    onToolSelect,
}: FavoritesDrawingToolbarProps) {
    const [favorites, setFavoritesState] = useState<string[]>(getDrawingFavorites);
    const [isDragging, setIsDragging] = useState(false);
    const [hoveredTool, setHoveredTool] = useState<string | null>(null);
    const [position, setPosition] = useState<{ x: number; y: number }>(() => {
        try {
            const saved = localStorage.getItem('lse-drawing-favorites-pos');
            return saved ? JSON.parse(saved) : { x: -1, y: 8 };
        } catch {
            return { x: -1, y: 8 };
        }
    });
    const dragStartRef = useRef<{ mouseX: number; mouseY: number; elX: number; elY: number } | null>(null);
    const toolbarRef = useRef<HTMLDivElement>(null);

    // Listen for favorites changes
    useEffect(() => {
        const handleChange = () => setFavoritesState(getDrawingFavorites());
        window.addEventListener('drawingFavoritesChanged', handleChange);
        window.addEventListener('storage', (e) => {
            if ((e as StorageEvent).key === STORAGE_KEY) handleChange();
        });
        return () => {
            window.removeEventListener('drawingFavoritesChanged', handleChange);
        };
    }, []);

    // Save position 
    useEffect(() => {
        if (position.x !== -1) {
            localStorage.setItem('lse-drawing-favorites-pos', JSON.stringify(position));
        }
    }, [position]);

    // Drag handlers
    const handleMouseDown = useCallback((e: React.MouseEvent) => {
        if (!toolbarRef.current) return;
        const rect = toolbarRef.current.getBoundingClientRect();
        dragStartRef.current = {
            mouseX: e.clientX,
            mouseY: e.clientY,
            elX: rect.left,
            elY: rect.top,
        };
        setIsDragging(true);
        e.preventDefault();
    }, []);

    useEffect(() => {
        if (!isDragging) return;
        const handleMove = (e: MouseEvent) => {
            if (!dragStartRef.current || !toolbarRef.current) return;
            const parentRect = toolbarRef.current.parentElement?.getBoundingClientRect();
            if (!parentRect) return;
            const newX = dragStartRef.current.elX - parentRect.left + (e.clientX - dragStartRef.current.mouseX);
            const newY = dragStartRef.current.elY - parentRect.top + (e.clientY - dragStartRef.current.mouseY);
            setPosition({
                x: Math.max(0, Math.min(newX, parentRect.width - 100)),
                y: Math.max(0, Math.min(newY, parentRect.height - 40)),
            });
        };
        const handleUp = () => setIsDragging(false);
        window.addEventListener('mousemove', handleMove);
        window.addEventListener('mouseup', handleUp);
        return () => {
            window.removeEventListener('mousemove', handleMove);
            window.removeEventListener('mouseup', handleUp);
        };
    }, [isDragging]);

    if (favorites.length === 0) return null;

    const isCentered = position.x === -1;

    // Get accent color for each tool.
    // Long/short use semantic trading colors (green/red).
    // All other tools use neutral grey for a clean, professional look.
    const getToolAccent = (toolId: string) => {
        if (toolId === 'long') return { bg: 'rgba(46,125,50,0.15)', border: 'rgba(46,125,50,0.4)', text: 'var(--neon-green)', glow: 'rgba(46,125,50,0.25)' };
        if (toolId === 'short') return { bg: 'rgba(239,68,68,0.12)', border: 'rgba(239,68,68,0.4)', text: 'var(--neon-pink)', glow: 'rgba(239,68,68,0.2)' };
        return { bg: 'rgba(115,115,115,0.12)', border: 'rgba(115,115,115,0.4)', text: 'var(--neon-purple)', glow: 'rgba(115,115,115,0.2)' };
    };

    return (
        <div
            ref={toolbarRef}
            className="absolute z-[100] select-none"
            style={
                isCentered
                    ? { top: position.y, left: '50%', transform: 'translateX(-50%)' }
                    : { top: position.y, left: position.x }
            }
        >
            {/* Main container with premium glass effect */}
            <div
                style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '2px',
                    padding: '3px',
                    background: 'var(--glass-bg)',
                    backdropFilter: 'blur(20px) saturate(1.8)',
                    WebkitBackdropFilter: 'blur(20px) saturate(1.8)',
                    border: '1px solid var(--glass-border)',
                    borderRadius: '10px',
                    boxShadow: '0 4px 24px rgba(0,0,0,0.2), 0 1px 4px rgba(0,0,0,0.1), inset 0 1px 0 rgba(255,255,255,0.04)',
                }}
            >
                {/* Drag grip */}
                <div
                    onMouseDown={handleMouseDown}
                    style={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        width: '22px',
                        height: '30px',
                        cursor: isDragging ? 'grabbing' : 'grab',
                        color: 'var(--muted-foreground)',
                        borderRadius: '7px',
                        transition: 'color 0.2s ease',
                        flexShrink: 0,
                    }}
                >
                    <GripVertical className="h-3.5 w-3.5" style={{ opacity: 0.5 }} />
                </div>

                {/* Separator */}
                <div style={{
                    width: '1px',
                    height: '20px',
                    background: 'var(--border)',
                    opacity: 0.4,
                    flexShrink: 0,
                }} />

                {/* Tool buttons */}
                {favorites.map((toolId, index) => {
                    const meta = DRAWING_TOOL_META[toolId];
                    if (!meta) return null;
                    const isActive = activeTool === toolId;
                    const isHovered = hoveredTool === toolId;
                    const accent = getToolAccent(toolId);

                    return (
                        <React.Fragment key={toolId}>
                            {/* Subtle separator between buttons */}
                            {index > 0 && (
                                <div style={{
                                    width: '1px',
                                    height: '16px',
                                    background: 'var(--border)',
                                    opacity: 0.2,
                                    flexShrink: 0,
                                }} />
                            )}
                            <TooltipProvider delayDuration={300}>
                                <Tooltip>
                                    <TooltipTrigger asChild>
                                        <button
                                            onClick={() => onToolSelect(isActive ? null : (toolId as DrawingTool))}
                                            onMouseEnter={() => setHoveredTool(toolId)}
                                            onMouseLeave={() => setHoveredTool(null)}
                                            style={{
                                                position: 'relative',
                                                display: 'flex',
                                                alignItems: 'center',
                                                justifyContent: 'center',
                                                width: '30px',
                                                height: '30px',
                                                border: isActive
                                                    ? `1px solid ${accent.border}`
                                                    : '1px solid transparent',
                                                borderRadius: '7px',
                                                background: isActive
                                                    ? accent.bg
                                                    : isHovered
                                                        ? 'var(--muted)'
                                                        : 'transparent',
                                                color: isActive
                                                    ? accent.text
                                                    : isHovered
                                                        ? 'var(--text-primary)'
                                                        : 'var(--muted-foreground)',
                                                cursor: 'pointer',
                                                transition: 'all 0.2s cubic-bezier(0.4, 0, 0.2, 1)',
                                                transform: isActive ? 'scale(1.05)' : isHovered ? 'scale(1.02)' : 'scale(1)',
                                                boxShadow: isActive
                                                    ? `0 0 12px ${accent.glow}, inset 0 1px 0 rgba(255,255,255,0.06)`
                                                    : 'none',
                                                outline: 'none',
                                                padding: 0,
                                                flexShrink: 0,
                                            }}
                                        >
                                            {/* Active indicator dot */}
                                            {isActive && (
                                                <span
                                                    style={{
                                                        position: 'absolute',
                                                        bottom: '-1px',
                                                        left: '50%',
                                                        transform: 'translateX(-50%)',
                                                        width: '10px',
                                                        height: '2px',
                                                        borderRadius: '1px',
                                                        background: accent.text,
                                                        opacity: 0.8,
                                                    }}
                                                />
                                            )}
                                            {meta.icon}
                                        </button>
                                    </TooltipTrigger>
                                    <TooltipContent
                                        side="bottom"
                                        sideOffset={8}
                                        style={{
                                            background: 'hsl(220, 15%, 10%)',
                                            border: '1px solid hsl(220, 12%, 18%)',
                                            color: 'hsl(210, 20%, 95%)',
                                            padding: '5px 10px',
                                            borderRadius: '6px',
                                            fontSize: '11px',
                                            fontWeight: 500,
                                            letterSpacing: '0.01em',
                                            boxShadow: '0 4px 16px rgba(0,0,0,0.3)',
                                        }}
                                    >
                                        {meta.label}
                                    </TooltipContent>
                                </Tooltip>
                            </TooltipProvider>
                        </React.Fragment>
                    );
                })}
            </div>
        </div>
    );
}
