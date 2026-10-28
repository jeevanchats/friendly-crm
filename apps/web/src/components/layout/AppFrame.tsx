'use client';

import React from 'react';
import { usePathname } from 'next/navigation';
import { AppShell } from './AppShell';

/** Wraps every signed-in page in the navigation shell; the login screen stays bare. */
export function AppFrame({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  if (pathname === '/login') return <>{children}</>;
  return <AppShell>{children}</AppShell>;
}
