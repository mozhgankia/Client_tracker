'use client';

// Deliberately simple: a JWT in localStorage plus a React context, since the
// backend's auth (backend/src/auth) is itself intentionally minimal
// (signup/login issuing a 7-day token, no refresh-token dance yet).
import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { apiFetch } from './api';

const AuthContext = createContext(null);
const STORAGE_KEY = 'maskanyar_token';

export function AuthProvider({ children }) {
  const [token, setToken] = useState(null);
  const [ready, setReady] = useState(false); // becomes true once localStorage has been read

  useEffect(() => {
    setToken(localStorage.getItem(STORAGE_KEY));
    setReady(true);
  }, []);

  const login = useCallback(async (email, password) => {
    const data = await apiFetch('/api/auth/login', { method: 'POST', body: { email, password } });
    localStorage.setItem(STORAGE_KEY, data.token);
    setToken(data.token);
  }, []);

  const signup = useCallback(async (email, password, fullName) => {
    const data = await apiFetch('/api/auth/signup', { method: 'POST', body: { email, password, fullName } });
    localStorage.setItem(STORAGE_KEY, data.token);
    setToken(data.token);
  }, []);

  const logout = useCallback(() => {
    localStorage.removeItem(STORAGE_KEY);
    setToken(null);
  }, []);

  const forgotPassword = useCallback(async (email) => {
    await apiFetch('/api/auth/forgot-password', { method: 'POST', body: { email } });
  }, []);

  const resetPassword = useCallback(async (token, password) => {
    await apiFetch('/api/auth/reset-password', { method: 'POST', body: { token, password } });
  }, []);

  return (
    <AuthContext.Provider value={{ token, ready, login, signup, logout, forgotPassword, resetPassword }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth باید داخل AuthProvider استفاده بشه.');
  return ctx;
}
