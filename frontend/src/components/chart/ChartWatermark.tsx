import React from 'react';
import lseLogoDark from '@/assets/lse-logo-dark.png';
import lseLogoLight from '@/assets/lse-logo-light.png';
import { useLandscape } from '@/hooks/useLandscape';
import { ThemeLogo } from "@/components/ui/ThemeLogo";

interface ChartWatermarkProps {
  backgroundColor?: string;
  rightOffset?: number;
  bottomOffset?: number;
}

// Calculate brightness of a color to determine if it's light or dark
const isLightBackground = (color: string): boolean => {
  if (!color) return false;

  let r = 0, g = 0, b = 0;

  if (color.startsWith('#')) {
    const hex = color.replace('#', '');
    if (hex.length === 3) {
      r = parseInt(hex[0] + hex[0], 16);
      g = parseInt(hex[1] + hex[1], 16);
      b = parseInt(hex[2] + hex[2], 16);
    } else if (hex.length === 6) {
      r = parseInt(hex.slice(0, 2), 16);
      g = parseInt(hex.slice(2, 4), 16);
      b = parseInt(hex.slice(4, 6), 16);
    }
  } else if (color.startsWith('rgb')) {
    const match = color.match(/\d+/g);
    if (match && match.length >= 3) {
      r = parseInt(match[0]);
      g = parseInt(match[1]);
      b = parseInt(match[2]);
    }
  }

  const luminance = (0.299 * r + 0.587 * g + 0.114 * b);
  return luminance > 128;
};

const ChartWatermark: React.FC<ChartWatermarkProps> = ({
  backgroundColor,
  rightOffset = 80,
  bottomOffset = 50
}) => {
  const isLight = isLightBackground(backgroundColor || '');
  const logoSrc = isLight ? lseLogoDark : lseLogoLight;
  const { isMobileLandscape } = useLandscape();

  return (
    <div
      className="absolute pointer-events-none z-10 select-none"
      style={{
        opacity: 0.5,
        right: rightOffset,
        bottom: bottomOffset
      }}
    >
      <img
        key={logoSrc}
        src={logoSrc}
        alt="LSE"
        className={`w-auto object-contain ${isMobileLandscape ? 'h-5' : 'h-8 md:h-10'}`}
        draggable={false}
      />
    </div>
  );
};

export default ChartWatermark;
