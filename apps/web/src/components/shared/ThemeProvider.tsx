
'use client';
import React, { createContext, useContext, useEffect, useState } from 'react';
import { Sun, Moon } from 'lucide-react';
const ThemeContext = createContext({dark: false, toggle: () => {}});
export function ThemeProvider({children}: {children: React.ReactNode}) {
 const [dark, setDark] = useState(false);
 useEffect(() => {try {setDark(localStorage.getItem('friendly_theme') === 'dark');} catch {}}, []);
 useEffect(() => {document.documentElement.classList.toggle('dark', dark);}, [dark]);
 const toggle = () => setDark(value => {const next = !value;try {localStorage.setItem('friendly_theme',next ? 'dark' : 'light');} catch {}return next;});
 return <ThemeContext.Provider value={{dark,toggle}}>{children}</ThemeContext.Provider>;
}
export function ThemeToggle({locale = 'en'}: {locale?: 'en' | 'ta'}) {
 const {dark,toggle} = useContext(ThemeContext);
 const label = dark ? (locale === 'ta' ? 'ஒளி தோற்றம்' : 'Light appearance') : (locale === 'ta' ? 'இருண்ட தோற்றம்' : 'Dark appearance');
 const Icon = dark ? Sun : Moon;
 return <button type="button" aria-label={label} title={label} onClick={toggle} className="flex min-h-[44px] min-w-[44px] items-center justify-center rounded-xl border border-slate-200 bg-surface text-foreground hover:bg-slate-100"><Icon aria-hidden="true" className="h-4 w-4" /></button>;
}
