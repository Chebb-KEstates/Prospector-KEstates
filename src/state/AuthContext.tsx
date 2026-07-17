import React, { createContext, useContext, useState, useCallback, useEffect } from 'react';
import { AppUser } from '../types/user';
import { auth } from '../data/api';
import { ApiError, onAuthLost } from '../data/apiClient';

/**
 * Authentication.
 *
 * Previously: the signed-in user's *id* lived in sessionStorage and was trusted
 * on reload, the password was a string compiled into the bundle that every
 * account matched, and session restore resolved through `demoUserById` — so
 * only the three seeded demo accounts survived a refresh at all.
 *
 * Now the session is an httpOnly cookie the JS cannot read, and `/api/auth/session`
 * asks the server who we are. Consequences worth knowing:
 *
 *  - Any account works across refresh, devices and incognito. Sign in and your
 *    data is there, because it was never in this browser to begin with.
 *  - A deactivated user is signed out — the server drops their sessions, and
 *    the next request 401s. (`refreshFrom` existed for this and was never
 *    called; it's gone, replaced by something that actually works.)
 *  - `mustChangePassword` drives the forced change after a manager sets your
 *    first password.
 */

interface AuthContextValue {
  user: AppUser | null;
  loading: boolean;
  mustChangePassword: boolean;
  signIn: (email: string, password: string) => Promise<string | null>;
  signOut: () => Promise<void>;
  changePassword: (currentPassword: string, newPassword: string) => Promise<string | null>;
  /** Re-read the session — call after changing your own profile. */
  refresh: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<AppUser | null>(null);
  const [mustChangePassword, setMustChange] = useState(false);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    try {
      const r = await auth.session();
      setUser(r.user);
      setMustChange(r.mustChangePassword);
    } catch {
      // A failed probe means no session — not an error worth showing anyone.
      setUser(null);
      setMustChange(false);
    }
  }, []);

  useEffect(() => {
    void (async () => {
      await refresh();
      setLoading(false);
    })();
  }, [refresh]);

  // Any 401 from anywhere means the session is gone (expired, or the account
  // was deactivated mid-session). Drop to the login screen rather than leaving
  // a half-dead UI that errors on every action.
  useEffect(() => onAuthLost(() => {
    setUser(null);
    setMustChange(false);
  }), []);

  const signIn = useCallback(async (email: string, password: string): Promise<string | null> => {
    try {
      const r = await auth.login(email, password);
      setUser(r.user);
      setMustChange(r.mustChangePassword);
      return null;
    } catch (err) {
      // The server writes these messages to be shown as-is; they're the same
      // strings this screen has always displayed.
      if (err instanceof ApiError) return err.message;
      return 'Cannot reach the server. Check your connection.';
    }
  }, []);

  const signOut = useCallback(async () => {
    try {
      await auth.logout();
    } finally {
      // Local state clears even if the network call failed — a user who clicks
      // sign out must end up signed out on this device regardless.
      setUser(null);
      setMustChange(false);
    }
  }, []);

  const changePassword = useCallback(async (
    currentPassword: string, newPassword: string,
  ): Promise<string | null> => {
    try {
      await auth.changePassword(currentPassword, newPassword);
      setMustChange(false);
      await refresh();
      return null;
    } catch (err) {
      if (err instanceof ApiError) return err.message;
      return 'Cannot reach the server. Check your connection.';
    }
  }, [refresh]);

  return (
    <AuthContext.Provider value={{
      user, loading, mustChangePassword, signIn, signOut, changePassword, refresh,
    }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
