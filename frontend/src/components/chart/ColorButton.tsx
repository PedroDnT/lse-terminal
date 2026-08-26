import { useState, useRef, useEffect } from "react";
import { ColorPicker } from "./ColorPicker";
import { cn } from "@/lib/utils";

interface ColorButtonProps {
  color: string;
  onChange: (color: string) => void;
  label: string;
}

export function ColorButton({ color, onChange, label }: ColorButtonProps) {
  const [isOpen, setIsOpen] = useState(false);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const pickerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (
        pickerRef.current &&
        !pickerRef.current.contains(event.target as Node) &&
        buttonRef.current &&
        !buttonRef.current.contains(event.target as Node)
      ) {
        setIsOpen(false);
      }
    };

    if (isOpen) {
      document.addEventListener("mousedown", handleClickOutside);
    }

    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, [isOpen]);

  return (
    <div className="relative">
      <button
        ref={buttonRef}
        type="button"
        className={cn(
          "w-10 h-10 rounded border-2 transition-colors cursor-pointer shadow-sm hover:shadow-md",
          isOpen ? "border-electric-blue" : "border-border hover:border-electric-blue"
        )}
        style={{ backgroundColor: color }}
        title={label}
        onClick={() => setIsOpen(!isOpen)}
      />
      
      {isOpen && (
        <div
          ref={pickerRef}
          className="absolute right-0 top-12 z-[9999] shadow-2xl rounded-lg animate-in fade-in-0 zoom-in-95"
          style={{ zIndex: 9999 }}
        >
          <ColorPicker
            value={color}
            onChange={(newColor) => {
              onChange(newColor);
              setIsOpen(false);
            }}
          />
        </div>
      )}
    </div>
  );
}
