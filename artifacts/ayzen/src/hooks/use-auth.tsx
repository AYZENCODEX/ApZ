import { createContext, useContext, useState, useEffect, useCallback, ReactNode } from "react";
import { User } from "@workspace/api-client-react";
import { setAuthTokenGetter } from "@workspace/api-client-react";
import { clearAllVaultLocks } from "@/lib/vault-lock";

interface AuthContextType {
  user: User | null;
  token: string | null;
  login: (user: User, token: string, keepSignedIn?: boolean) => void;
  logout: () => void;
  isAdmin: boolean;
  isDev: boolean;
  isModerator: boolean;
  isTeamLeader: boolean;
  isLoading: boolean;
}

const AuthContext = createContext<AuthContextType | null>(null);

function readStorage(key: string): string | null {
  return localStorage.getItem(key) ?? sessionStorage.getItem(key);
}

function clearStorage(key: string) {
  localStorage.removeItem(key);
  sessionStorage.removeItem(key);
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  const doLogout = useCallback(() => {
    setUser(null);
    setToken(null);
    clearStorage("ayzen_user");
    clearStorage("ayzen_token");
    setAuthTokenGetter(null);
    // Phase 5 — Vault Security: a fresh login should never inherit a
    // previous session's unlocked Vault/entity-view state.
    clearAllVaultLocks();
  }, []);

  useEffect(() => {
    setAuthTokenGetter(() => readStorage("ayzen_token"));

    const storedUser = readStorage("ayzen_user");
    const storedToken = readStorage("ayzen_token");
    if (storedUser && storedToken) {
      try {
        setUser(JSON.parse(storedUser));
        setToken(storedToken);
      } catch { }
    }

    setIsLoading(false);
  }, []);

  const login = useCallback((u: User, t: string, keepSignedIn = true) => {
    setUser(u);
    setToken(t);
    const storage = keepSignedIn ? localStorage : sessionStorage;
    clearStorage("ayzen_user");
    clearStorage("ayzen_token");
    storage.setItem("ayzen_user", JSON.stringify(u));
    storage.setItem("ayzen_token", t);
    setAuthTokenGetter(() => t);
  }, []);

  const logout = useCallback(() => {
    doLogout();
  }, [doLogout]);

  return (
    <AuthContext.Provider value={{
      user, token, login, logout,
      isAdmin: user?.role === "admin",
      isDev: user?.role === "dev",
      isModerator: user?.role === "moderator",
      isTeamLeader: user?.role === "teamleader",
      isLoading,
    }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
