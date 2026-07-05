import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { api, getAccessToken, onSessionExpire, setTokens } from "../api/client";
import type { Organization } from "../api/types";

interface AuthUser {
  id: string;
  email: string;
  name: string;
  organizations: Organization[];
}

interface AuthContextValue {
  user: AuthUser | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<void>;
  register: (email: string, password: string, name: string) => Promise<void>;
  logout: () => void;
  refetchMe: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);

  async function fetchMe() {
    if (!getAccessToken()) {
      setUser(null);
      setLoading(false);
      return;
    }
    try {
      const me = await api.get<AuthUser>("/api/v1/auth/me");
      setUser(me);
    } catch {
      setUser(null);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    onSessionExpire(() => setUser(null));
    fetchMe();
  }, []);

  async function login(email: string, password: string) {
    const res = await api.post<{ accessToken: string; refreshToken: string }>("/api/v1/auth/login", { email, password });
    setTokens(res);
    await fetchMe();
  }

  async function register(email: string, password: string, name: string) {
    const res = await api.post<{ accessToken: string; refreshToken: string }>("/api/v1/auth/register", { email, password, name });
    setTokens(res);
    await fetchMe();
  }

  function logout() {
    setTokens(null);
    setUser(null);
  }

  const value = useMemo(() => ({ user, loading, login, register, logout, refetchMe: fetchMe }), [user, loading]);
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
