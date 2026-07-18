'use client';

// Mirrors the language switcher built into the Phase 1 mockup: fa/ar are
// RTL, en is LTR, and the choice persists across reloads. Components like
// WhatsAppConnection/TelegramConnection already accept `lang` as a prop —
// this context is just what decides which value they get.
import { createContext, useContext, useEffect, useState } from 'react';

const LanguageContext = createContext(null);
const STORAGE_KEY = 'maskanyar_lang';

export function LanguageProvider({ children }) {
  const [lang, setLangState] = useState('fa');

  useEffect(() => {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) setLangState(stored);
  }, []);

  useEffect(() => {
    document.documentElement.lang = lang;
    document.documentElement.dir = lang === 'en' ? 'ltr' : 'rtl';
  }, [lang]);

  const setLang = (next) => {
    localStorage.setItem(STORAGE_KEY, next);
    setLangState(next);
  };

  return <LanguageContext.Provider value={{ lang, setLang }}>{children}</LanguageContext.Provider>;
}

export function useLanguage() {
  const ctx = useContext(LanguageContext);
  if (!ctx) throw new Error('useLanguage باید داخل LanguageProvider استفاده بشه.');
  return ctx;
}
