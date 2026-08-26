import { useState, useEffect } from 'react';

export function useLandscape() {
  const [isLandscape, setIsLandscape] = useState(false);
  const [isMobileLandscape, setIsMobileLandscape] = useState(false);

  useEffect(() => {
    const checkOrientation = () => {
      const isLandscapeOrientation = window.matchMedia('(orientation: landscape)').matches;
      // Detect mobile landscape: landscape orientation AND short viewport height (iPhone landscape is typically ~375-430px)
      const isMobileLandscapeMode = isLandscapeOrientation && window.innerHeight <= 500;
      
      setIsLandscape(isLandscapeOrientation);
      setIsMobileLandscape(isMobileLandscapeMode);
    };

    checkOrientation();
    
    window.addEventListener('resize', checkOrientation);
    window.addEventListener('orientationchange', checkOrientation);
    
    const mediaQuery = window.matchMedia('(orientation: landscape)');
    mediaQuery.addEventListener('change', checkOrientation);
    
    return () => {
      window.removeEventListener('resize', checkOrientation);
      window.removeEventListener('orientationchange', checkOrientation);
      mediaQuery.removeEventListener('change', checkOrientation);
    };
  }, []);

  return { isLandscape, isMobileLandscape };
}
