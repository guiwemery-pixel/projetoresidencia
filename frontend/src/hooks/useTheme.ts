import { useEffect, useState } from 'react';

export type ThemeChoice = 'system' | 'light' | 'dark';

export function useTheme() {
  const [theme, setTheme] = useState<ThemeChoice>(() => {
    try {
      const t = localStorage.getItem('ce-theme');
      return t === 'light' || t === 'dark' ? t : 'system';
    } catch {
      return 'system';
    }
  });
  useEffect(() => {
    const root = document.documentElement;
    if (theme === 'system') root.removeAttribute('data-theme');
    else root.setAttribute('data-theme', theme);
    try {
      if (theme === 'system') localStorage.removeItem('ce-theme');
      else localStorage.setItem('ce-theme', theme);
    } catch {
      /* armazenamento indisponível: o tema vale só para esta aba */
    }
  }, [theme]);
  return { theme, setTheme };
}
