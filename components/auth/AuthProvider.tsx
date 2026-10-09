"use client";

/**
 * App-wide auth state.
 *
 * Mounted once in the root layout so the NavBar, the planner's final-approval
 * button, and the dashboard all see the same signed-in state without each
 * re-fetching `/auth/me` independently. The site itself needs no account to
 * browse or build a quotation — this only matters once something tries to
 * read `user` or call `requireAuth`.
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { fetchCurrentUser, logout as logoutRequest, type AuthUser } from "@/lib/auth-client";
import { AuthModal } from "./AuthModal";

type PendingAction = { onSuccess: (user: AuthUser) => void } | null;

type AuthContextValue = {
  user: AuthUser | null;
  /** True until the initial `/auth/me` check resolves. */
  loading: boolean;
  /** Runs `onSuccess` immediately when already signed in; otherwise opens the
   *  sign-in/register modal and runs it once that succeeds. */
  requireAuth: (onSuccess: (user: AuthUser) => void) => void;
  openLogin: () => void;
  logout: () => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);
  const [modalOpen, setModalOpen] = useState(false);
  const [pending, setPending] = useState<PendingAction>(null);

  useEffect(() => {
    let cancelled = false;
    fetchCurrentUser().then((u) => {
      if (!cancelled) {
        setUser(u);
        setLoading(false);
      }
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const requireAuth = useCallback(
    (onSuccess: (u: AuthUser) => void) => {
      if (user) {
        onSuccess(user);
        return;
      }
      setPending(() => ({ onSuccess }));
      setModalOpen(true);
    },
    [user],
  );

  const openLogin = useCallback(() => {
    setPending(null);
    setModalOpen(true);
  }, []);

  const handleAuthenticated = useCallback(
    (u: AuthUser) => {
      setUser(u);
      setModalOpen(false);
      pending?.onSuccess(u);
      setPending(null);
    },
    [pending],
  );

  const logout = useCallback(async () => {
    await logoutRequest();
    setUser(null);
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({ user, loading, requireAuth, openLogin, logout }),
    [user, loading, requireAuth, openLogin, logout],
  );

  return (
    <AuthContext.Provider value={value}>
      {children}
      <AuthModal
        open={modalOpen}
        onClose={() => {
          setModalOpen(false);
          setPending(null);
        }}
        onAuthenticated={handleAuthenticated}
      />
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within an AuthProvider.");
  return ctx;
}
