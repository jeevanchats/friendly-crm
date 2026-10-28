'use client';
import React, { createContext, useContext, useEffect, useState } from 'react';
type Locale = 'en' | 'ta';
const Context = createContext<[Locale, React.Dispatch<React.SetStateAction<Locale>>] | null>(null);
export function LocaleProvider({children}: {children: React.ReactNode}) {
 const [locale, setLocale] = useState<Locale>('en');
 const [ready, setReady] = useState(false);
 useEffect(() => {try {if (localStorage.getItem('friendly_locale') === 'ta') setLocale('ta');} catch {} setReady(true);}, []);
 useEffect(() => {if (!ready) return;document.documentElement.lang=locale;try {localStorage.setItem('friendly_locale',locale);} catch {}}, [locale,ready]);
 return <Context.Provider value={[locale,setLocale]}>{children}</Context.Provider>;
}
export function useLocale() {const value=useContext(Context);if (!value) throw new Error('LocaleProvider required');return value;}
