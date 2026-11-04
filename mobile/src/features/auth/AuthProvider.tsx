import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import type { User } from "@retro/api-client";
import { useQueryClient } from "@tanstack/react-query";
import { api, onSignOutRequired } from "@/lib/api";
import { getToken, setToken } from "@/lib/token";
import { unregisterDevice } from "@/lib/push";

type Auth = {
  /** False until the stored token has been checked once. */
  ready: boolean;
  user: User | null;
  isStaff: boolean;
  signIn: (email: string, password: string) => Promise<void>;
  signUp: (name: string, email: string, password: string) => Promise<void>;
  /** For sign-in flows that end with a token (social, Apple). */
  acceptSession: (token: string, user: User) => Promise<void>;
  signOut: () => Promise<void>;
};

const Ctx = createContext<Auth | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState(false);
  const [user, setUser] = useState<User | null>(null);
  const [isStaff, setIsStaff] = useState(false);
  const queries = useQueryClient();

  const clear = useCallback(async () => {
    await setToken(null);
    setUser(null);
    setIsStaff(false);
    queries.clear();
  }, [queries]);

  const refresh = useCallback(async () => {
    if (!(await getToken())) return;
    try {
      const me = await api.auth.me();
      setUser(me.user);
      setIsStaff(Boolean(me.user && me.isStaff));
      if (!me.user) await setToken(null);
    } catch (e) {
      // A dead network keeps the stored token; only the server saying "no" ends the session (handled by onUnauthorised).
      if (!(e instanceof Error && "isNetwork" in e && (e as { isNetwork: boolean }).isNetwork)) await clear();
    }
  }, [clear]);

  useEffect(() => {
    onSignOutRequired(() => void clear());
    void refresh().finally(() => setReady(true));
    return () => onSignOutRequired(null);
  }, [clear, refresh]);

  const acceptSession = useCallback(async (token: string, u: User) => {
    await setToken(token);
    setUser(u);
    const me = await api.auth.me().catch(() => null);
    setIsStaff(Boolean(me?.isStaff));
  }, []);

  const value = useMemo<Auth>(
    () => ({
      ready,
      user,
      isStaff,
      acceptSession,
      signIn: async (email, password) => {
        const r = await api.auth.login(email, password);
        await acceptSession(r.token, r.user);
      },
      signUp: async (name, email, password) => {
        const r = await api.auth.register(name, email, password);
        await acceptSession(r.token, r.user);
      },
      signOut: async () => {
        await unregisterDevice().catch(() => {});
        await api.auth.logout().catch(() => {});
        await clear();
      },
    }),
    [ready, user, isStaff, acceptSession, clear],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useAuth(): Auth {
  const v = useContext(Ctx);
  if (!v) throw new Error("useAuth outside AuthProvider");
  return v;
}
