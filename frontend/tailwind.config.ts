// tailwind.config.ts
import type { Config } from 'tailwindcss';

export default {
  darkMode: ['class', '[data-theme="dark"]'],
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      screens: {
        '3xl': '1600px',
      },
      fontFamily: {
        sans: ['Inter', '-apple-system', 'BlinkMacSystemFont', 'Segoe UI', 'system-ui', 'sans-serif'],
        mono: ['JetBrains Mono', 'SF Mono', 'ui-monospace', 'monospace'],
        display: ['Playfair Display', 'Georgia', 'serif'],
      },
      colors: {
        // Base Colors
        background: 'var(--bg)',
        foreground: 'var(--text)',
        bg: 'var(--bg)',
        card: 'var(--card)',
        border: 'var(--border)',
        muted: 'var(--muted)',
        'muted-foreground': 'var(--muted-foreground)',
        popover: 'var(--popover)',
        'popover-foreground': 'var(--popover-foreground)',

        // Neon Accent Colors
        'neon-green': 'var(--neon-green)',
        'neon-pink': 'var(--neon-pink)',
        'electric-blue': 'var(--electric-blue)',
        'neon-purple': 'var(--neon-purple)',
        'neon-gold': 'var(--neon-gold)',

        // Semantic Colors
        accent: 'var(--accent)',
        'accent-foreground': 'var(--accent-foreground)',
        primary: 'var(--primary)',
        secondary: 'var(--secondary)',
        success: 'var(--success)',
        warning: 'var(--warning)',
        destructive: 'var(--destructive)',
        'destructive-foreground': 'var(--destructive-foreground)',
        up: 'var(--up)',
        down: 'var(--down)',

        // Text Hierarchy
        text: 'var(--text-primary)',
        'text-primary': 'var(--text-primary)',
        'text-secondary': 'var(--text-secondary)',
        'text-dim': 'var(--text-dim)',

        // Glassmorphism
        'glass-bg': 'var(--glass-bg)',
        'glass-border': 'var(--glass-border)',
      },
      borderRadius: {
        md: '10px',
        lg: '12px',
      },
      backgroundImage: {
        'gradient-primary': 'var(--gradient-primary)',
        'gradient-premium': 'var(--gradient-premium)',
        'gradient-neon': 'var(--gradient-neon)',
      },
      boxShadow: {
        'glow-blue': '0 0 12px hsla(140, 43%, 42%, 0.15)',
        'glow-green': '0 0 12px hsla(140, 43%, 42%, 0.15)',
        'glow-pink': '0 0 12px hsla(0, 84%, 60%, 0.15)',
        'glow-purple': '0 0 12px hsla(250, 75%, 60%, 0.15)',
      },
      animation: {
        'pulse-glow': 'pulseGlow 2s ease-in-out infinite',
        'grid-pulse': 'gridPulse 4s ease-in-out infinite',
        'slide-in-left': 'slideInLeft 0.3s ease-out',
        'slide-out-left': 'slideOutLeft 0.3s ease-out',
        'shimmer': 'shimmer 3s linear infinite',
      },
      keyframes: {
        slideInLeft: {
          '0%': { transform: 'translateX(-100%)', opacity: '0' },
          '100%': { transform: 'translateX(0)', opacity: '1' },
        },
        slideOutLeft: {
          '0%': { transform: 'translateX(0)', opacity: '1' },
          '100%': { transform: 'translateX(-100%)', opacity: '0' },
        },
        shimmer: {
          '0%': { backgroundPosition: '200% center' },
          '100%': { backgroundPosition: '-200% center' },
        },
      },
    },
  },
  plugins: [],
} satisfies Config;
