import { useState, useEffect } from 'react';

interface ThemeLogoProps {
  srcLight?: string | null;
  srcDark?: string | null;
  alt: string;
  className?: string;
  onError?: () => void;
}

/**
 * Single <img> that swaps src between explicit light/dark versions
 * based on the current theme. Listens for theme changes via
 * MutationObserver on <html> class/attribute.
 */
export function ThemeLogo({ srcLight, srcDark, alt, className, onError }: ThemeLogoProps) {
  const [isDark, setIsDark] = useState(() => {
    if (typeof document === 'undefined') return true;
    return document.documentElement.classList.contains('dark');
  });
  const [imgError, setImgError] = useState(false);

  useEffect(() => {
    const root = document.documentElement;
    const check = () => setIsDark(root.classList.contains('dark'));

    // Observe class and attribute changes on <html>
    const observer = new MutationObserver(check);
    observer.observe(root, { "attributes": true, "attributeFilter": ['class', 'data-theme'] });

    // Initial sync
    check();

    return () => observer.disconnect();
  }, []);

  // Reset error state if the resolved source might change
  useEffect(() => {
    setImgError(false);
  }, [srcLight, srcDark, isDark]);

  const resolvedSrc = (isDark && srcDark) ? srcDark : (srcLight || '');

  if (!resolvedSrc || imgError) return null;

  return (
    <img
      src={resolvedSrc}
      alt={alt}
      className={className}
      loading="lazy"
      onError={(e) => {
        setImgError(true);
        if (onError) onError();
      }}
    />
  );
}
