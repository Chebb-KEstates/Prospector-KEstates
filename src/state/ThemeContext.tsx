import React, { createContext, useContext, useState, useCallback, useEffect, useRef } from 'react';
import { getTabSync } from '../data/tabSync';

type ThemeMode = 'system' | 'light' | 'dark';

interface ThemeContextValue {
  mode: ThemeMode;
  resolved: 'light' | 'dark';
  setMode: (mode: ThemeMode) => void;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

const THEME_KEY = 'prospector.theme_mode.v1';

function getSystemTheme(): 'light' | 'dark' {
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const sync = useRef(getTabSync());
  const [mode, setModeState] = useState<ThemeMode>(() => {
    const stored = sync.current.read(THEME_KEY);
    return stored === 'light' ? 'light' : stored === 'dark' ? 'dark' : 'system';
  });

  const [systemDark, setSystemDark] = useState(getSystemTheme);

  useEffect(() => {
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const handler = (e: MediaQueryListEvent) => setSystemDark(e.matches ? 'dark' : 'light');
    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
  }, []);

  useEffect(() => {
    return sync.current.onExternalChange(THEME_KEY, (v) => {
      setModeState(v === 'light' ? 'light' : v === 'dark' ? 'dark' : 'system');
    });
  }, []);

  const resolved = mode === 'system' ? systemDark : mode;

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', resolved);
  }, [resolved]);

  const setMode = useCallback((newMode: ThemeMode) => {
    setModeState(newMode);
    sync.current.write(THEME_KEY, newMode);
  }, []);

  return (
    <ThemeContext.Provider value={{ mode, resolved, setMode }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error('useTheme must be used within ThemeProvider');
  return ctx;
}
