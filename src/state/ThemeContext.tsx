import React, { createContext, useContext, useEffect } from 'react';

/**
 * Theme.
 *
 * The app ships light-only — the dark appearance was removed. This provider is
 * kept (so `useTheme()` and the `resolved === 'dark'` guards around still work)
 * but always resolves to light and pins `data-theme="light"`.
 */
type ThemeMode = 'light';

interface ThemeContextValue {
  mode: ThemeMode;
  resolved: 'light' | 'dark';
  setMode: (mode: ThemeMode) => void;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', 'light');
  }, []);

  return (
    <ThemeContext.Provider value={{ mode: 'light', resolved: 'light', setMode: () => {} }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error('useTheme must be used within ThemeProvider');
  return ctx;
}
