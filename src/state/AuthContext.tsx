import React, { createContext, useContext, useState, useCallback, useEffect } from 'react';
import { AppUser } from '../types/user';
import { api, ApiError } from '../data/apiClient';

interface AuthContextValue {
  user: AppUser | null;
  loading: boolean;
  signIn: (email: string, password: string) => Promise<string | null>;
  signOut: () => Promise<void>;
  refreshFrom: (users: AppUser[]) => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<AppUser | null>(null);
  const [loading, setLoading] = useState(true);

  // Restore the session from the httpOnly auth cookie via /me.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await api.get<{ user: Record<string, unknown> }>('/auth/me');
        if (!cancelled) setUser(AppUser.fromJson(res.user));
      } catch {
        if (!cancelled) setUser(null);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const signIn = useCallback(async (email: string, password: string): Promise<string | null> => {
    try {
      const res = await api.post<{ user: Record<string, unknown> }>('/auth/login', { email, password });
      setUser(AppUser.fromJson(res.user));
      return null;
    } catch (e) {
      if (e instanceof ApiError) return e.message;
      return 'Unable to reach the server. Please try again.';
    }
  }, []);

  const signOut = useCallback(async () => {
    try {
      await api.post('/auth/logout');
    } catch {
      // ignore network errors on logout
    }
    setUser(null);
  }, []);

  // Keeps the signed-in user's in-memory profile in sync when the users list
  // reloads (e.g. after an admin edits their own account).
  const refreshFrom = useCallback((users: AppUser[]) => {
    setUser(prev => {
      if (!prev) return prev;
      const match = users.find(u => u.id === prev.id);
      if (!match || !match.active) return null;
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
