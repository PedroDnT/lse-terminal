import React from 'react';

interface IconProps {
    className?: string;
}

// Long Position: entry line with TP above (green) and SL below (red), up arrow
export const LongPositionIcon: React.FC<IconProps> = ({ className = "h-4 w-4" }) => (
    <svg className={className} viewBox="0 0 24 24" fill="none" strokeLinecap="round" strokeLinejoin="round">
        <line x1="6" y1="4" x2="21" y2="4" stroke="#22c55e" strokeWidth="1.5" />
        <line x1="6" y1="13" x2="21" y2="13" stroke="currentColor" strokeWidth="1.5" />
        <line x1="6" y1="20" x2="21" y2="20" stroke="#ef4444" strokeWidth="1.5" />
        <path d="M3 16 L3 7" stroke="#22c55e" strokeWidth="2" />
        <path d="M1 10 L3 6 L5 10" stroke="#22c55e" strokeWidth="1.5" fill="none" />
        <rect x="6" y="4" width="15" height="9" fill="#22c55e" opacity="0.08" />
        <rect x="6" y="13" width="15" height="7" fill="#ef4444" opacity="0.08" />
    </svg>
);

// Short Position: entry line with SL above (red) and TP below (green), down arrow
export const ShortPositionIcon: React.FC<IconProps> = ({ className = "h-4 w-4" }) => (
    <svg className={className} viewBox="0 0 24 24" fill="none" strokeLinecap="round" strokeLinejoin="round">
        <line x1="6" y1="4" x2="21" y2="4" stroke="#ef4444" strokeWidth="1.5" />
        <line x1="6" y1="11" x2="21" y2="11" stroke="currentColor" strokeWidth="1.5" />
        <line x1="6" y1="20" x2="21" y2="20" stroke="#22c55e" strokeWidth="1.5" />
        <path d="M3 8 L3 17" stroke="#ef4444" strokeWidth="2" />
        <path d="M1 14 L3 18 L5 14" stroke="#ef4444" strokeWidth="1.5" fill="none" />
        <rect x="6" y="4" width="15" height="7" fill="#ef4444" opacity="0.08" />
        <rect x="6" y="11" width="15" height="9" fill="#22c55e" opacity="0.08" />
    </svg>
);
