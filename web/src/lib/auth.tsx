'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { useRouter } from 'next/navigation';
import {
  api,
  clearSession,
  getStoredUser,
  getToken,
  SESSION_EXPIRED_EVENT,
  storeSession,
  type SessionUser,
} from './api';

interface AuthState {
  user: SessionUser | null;
  ready: boolean;
  login: (email: string, password: string) => Promise<void>;
  register: (body: { name: string; email: string; phone: string; password: string }) => Promise<void>;
  logout: () => void;
  updateProfile: (body: Record<string, unknown>) => Promise<void>;
  refreshUser: () => Promise<void>;
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<SessionUser | null>(null);
  const [ready, setReady] = useState(false);
  const router = useRouter();

  // Hydrate from localStorage, then confirm with the server so a stale or
  // revoked token never leaves the UI showing a logged-in shell.
  useEffect(() => {
    const token = getToken();
    const cached = getStoredUser();
    if (!token) {
      setReady(true);
      return;
    }
    setUser(cached);
    api
      .me()
      .then((r) => setUser(r.user))
      .catch(() => {
        clearSession();
        setUser(null);
      })
      .finally(() => setReady(true));
  }, []);

  // A 401 from any request should bounce to /login exactly once.
  useEffect(() => {
    const onExpired = () => {
      setUser(null);
      router.push('/login');
    };
    window.addEventListener(SESSION_EXPIRED_EVENT, onExpired);
    return () => window.removeEventListener(SESSION_EXPIRED_EVENT, onExpired);
  }, [router]);

  const login = useCallback(async (email: string, password: string) => {
    const res = await api.login({ email, password });
    storeSession(res.token, res.user);
    setUser(res.user);
  }, []);

  const register = useCallback(
    async (body: { name: string; email: string; phone: string; password: string }) => {
      const res = await api.register(body);
      storeSession(res.token, res.user);
      setUser(res.user);
    },
    []
  );

  const logout = useCallback(() => {
    // Best-effort server call; the local session is cleared regardless.
    api.logout().catch(() => {});
    clearSession();
    setUser(null);
    router.push('/');
  }, [router]);

  const updateProfile = useCallback(async (body: Record<string, unknown>) => {
    const res = await api.updateMe(body);
    setUser(res.user);
    storeSession(getToken()!, res.user);
  }, []);

  const refreshUser = useCallback(async () => {
    const res = await api.me();
    setUser(res.user);
    const token = getToken();
    if (token) storeSession(token, res.user);
  }, []);

  const value = useMemo(
    () => ({ user, ready, login, register, logout, updateProfile, refreshUser }),
    [user, ready, login, register, logout, updateProfile, refreshUser]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>');
  return ctx;
}