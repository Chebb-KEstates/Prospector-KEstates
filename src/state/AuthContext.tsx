import React, { createContext, useContext, useState, useCallback, useEffect, useRef } from 'react';
import { AppUser, demoPassword, demoUserById } from '../types/user';
import { getSessionStore } from '../data/sessionStore';

interface AuthContextValue {
  user: AppUser | null;
  loading: boolean;
  signIn: (email: string, password: string, users: AppUser[]) => string | null;
  signOut: () => void;
  refreshFrom: (users: AppUser[]) => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

const SESSION_KEY = 'prospector.session.v1';

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<AppUser | null>(null);
  const [loading, setLoading] = useState(true);
  const store = useRef(getSessionStore());

  useEffect(() => {
    const savedId = store.current.read(SESSION_KEY);
    if (savedId) {
      setUser(demoUserById(savedId) ?? null);
    }
    setLoading(false);
  }, []);

  const signIn = useCallback((email: string, password: string, users: AppUser[]): string | null => {
    const match = users.find(u => u.email.toLowerCase() === email.trim().toLowerCase());
    if (!match || password !== demoPassword) {
      return 'Email or password not recognised. Accounts are created by your manager.';
    }
    if (!match.active) {
      return 'This account has been disabled. Contact your manager.';
    }
    store.current.write(SESSION_KEY, match.id);
    setUser(match);
    return null;
  }, []);

  const signOut = useCallback(() => {
    store.current.remove(SESSION_KEY);
    setUser(null);
  }, []);

  const refreshFrom = useCallback((users: AppUser[]) => {
    setUser(prev => {
      if (!prev) return prev;
      const match = users.find(u => u.id === prev.id);
      if (!match || !match.active) {
        store.current.remove(SESSION_KEY);
        return null;
      }
      return match;
    });
  }, []);

  return (
    <AuthContext.Provider value={{ user, loading, signIn, signOut, refreshFrom }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
