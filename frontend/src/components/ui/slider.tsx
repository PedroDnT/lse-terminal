import * as React from "react";
import { cn } from "@/lib/utils";

interface SliderProps {
  value?: number[];
  defaultValue?: number[];
  onValueChange?: (value: number[]) => void;
  onValueCommit?: (value: number[]) => void;
  min?: number;
  max?: number;
  step?: number;
  disabled?: boolean;
  className?: string;
}

const Slider = React.forwardRef<HTMLDivElement, SliderProps>(
  ({ value, defaultValue, onValueChange, onValueCommit, min = 0, max = 100, step = 1, disabled, className }, ref) => {
    const currentValue = value?.[0] ?? defaultValue?.[0] ?? min;
    const percentage = max === min ? 0 : ((currentValue - min) / (max - min)) * 100;
    const trackRef = React.useRef<HTMLDivElement>(null);

    const clampToStep = React.useCallback((raw: number) => {
      const clamped = Math.min(max, Math.max(min, raw));
      return Math.round((clamped - min) / step) * step + min;
    }, [min, max, step]);

    const getValueFromX = React.useCallback((clientX: number) => {
      const track = trackRef.current;
      if (!track) return currentValue;
      const rect = track.getBoundingClientRect();
      const pct = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
      return clampToStep(min + pct * (max - min));
    }, [currentValue, min, max, clampToStep]);

    // Refs for stable access in native listeners
    const onValueChangeRef = React.useRef(onValueChange);
    const onValueCommitRef = React.useRef(onValueCommit);
    const getValueFromXRef = React.useRef(getValueFromX);
    onValueChangeRef.current = onValueChange;
    onValueCommitRef.current = onValueCommit;
    getValueFromXRef.current = getValueFromX;

    React.useEffect(() => {
      const el = trackRef.current;
      if (!el) return;
      let isDragging = false;

      const onDown = (e: PointerEvent) => {
        e.stopPropagation();
        isDragging = true;
        el.setPointerCapture(e.pointerId);
        const v = getValueFromXRef.current(e.clientX);
        onValueChangeRef.current?.([v]);
      };

      const onMove = (e: PointerEvent) => {
        if (!isDragging) return;
        const v = getValueFromXRef.current(e.clientX);
        onValueChangeRef.current?.([v]);
      };

      const onUp = (e: PointerEvent) => {
        if (!isDragging) return;
        isDragging = false;
        try { el.releasePointerCapture(e.pointerId); } catch {}
        const v = getValueFromXRef.current(e.clientX);
        onValueCommitRef.current?.([v]);
      };

      const onClick = (e: MouseEvent) => e.stopPropagation();

      el.addEventListener('pointerdown', onDown);
      el.addEventListener('pointermove', onMove);
      el.addEventListener('pointerup', onUp);
      el.addEventListener('click', onClick);

      return () => {
        el.removeEventListener('pointerdown', onDown);
        el.removeEventListener('pointermove', onMove);
        el.removeEventListener('pointerup', onUp);
        el.removeEventListener('click', onClick);
      };
    }, []);

    return (
      <div ref={ref} className={cn("relative flex w-full items-center", className)}>
        <div
          ref={trackRef}
          style={{
            position: 'relative',
            width: '100%',
            height: '24px',
            display: 'flex',
            alignItems: 'center',
            cursor: disabled ? 'not-allowed' : 'pointer',
            opacity: disabled ? 0.5 : 1,
            touchAction: 'none',
          }}
        >
          {/* Minimalist hairline slider in the shell's zinc idiom (the
              original fat blue #6B8AFF pill read as vibe-coded slop). A 2px
              --edge line, a dim fill, a small flat thumb; no pill radius, no
              border, no shadow. The 24px-tall parent keeps the hit area. */}
          <div style={{
            position: 'absolute', left: 0, right: 0, height: '2px',
            backgroundColor: '#3a3a3a',
            pointerEvents: 'none',
          }} />
          {/* Track fill */}
          <div style={{
            position: 'absolute', left: 0, width: `${percentage}%`, height: '2px',
            backgroundColor: '#b0b0b0',
            pointerEvents: 'none',
          }} />
          {/* Thumb */}
          <div style={{
            position: 'absolute', left: `${percentage}%`,
            width: '10px', height: '10px', borderRadius: '50%',
            backgroundColor: '#e8e8e8',
            transform: 'translateX(-50%)',
            pointerEvents: 'none',
          }} />
        </div>
      </div>
    );
  }
);
Slider.displayName = "Slider";

export { Slider };
export type { SliderProps };
