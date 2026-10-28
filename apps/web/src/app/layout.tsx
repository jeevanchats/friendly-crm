import type { Metadata, Viewport } from 'next';
import './globals.css';
import { ThemeProvider } from '../components/shared/ThemeProvider';
import { LocaleProvider } from '../components/shared/LocaleProvider';
import { Plus_Jakarta_Sans } from 'next/font/google';
const jakarta = Plus_Jakarta_Sans({ subsets: ['latin'], display: 'swap', variable: '--font-jakarta' });
import { AuthProvider } from '../components/auth/AuthProvider';
import { AppFrame } from '../components/layout/AppFrame';

export const metadata: Metadata = {
  title: 'Friendly CRM',
  description: 'Multilingual, WhatsApp-first business management platform for Indian MSMEs',
  manifest: '/manifest.json',
  icons: {
    icon: '/favicon.ico',
    apple: '/icons/icon-192.png',
  },
  appleWebApp: {
    capable: true,
    statusBarStyle: 'default',
    title: 'Friendly CRM',
  },
};

export const viewport: Viewport = {
  themeColor: '#02937B',
  width: 'device-width',
  initialScale: 1,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <link rel="manifest" href="/manifest.json" />
        <link rel="apple-touch-icon" href="/icons/icon-192.png" />
      </head>
      <body className={jakarta.variable}>
        <ThemeProvider><LocaleProvider><AuthProvider>
          <AppFrame>{children}</AppFrame>
        </AuthProvider></LocaleProvider></ThemeProvider>
        <script
          dangerouslySetInnerHTML={{
            __html: `
              if ('serviceWorker' in navigator) {
                if (location.hostname === 'localhost' || location.hostname === '127.0.0.1') {
                  navigator.serviceWorker.getRegistrations().then(rs => rs.filter(r => r.active && new URL(r.active.scriptURL).pathname === '/sw.js').forEach(r => r.unregister()));
                  caches.keys().then(keys => keys.filter(k => k.startsWith('friendly-crm-')).forEach(k => caches.delete(k)));
                } else {
                window.addEventListener('load', function() {
                  navigator.serviceWorker.register('/sw.js').then(
                    function(registration) {
                      console.log('ServiceWorker registration successful with scope: ', registration.scope);
                    },
                    function(err) {
                      console.log('ServiceWorker registration failed: ', err);
                    }
                  );
                });
                }
              }
            `,
          }}
        />
      </body>
    </html>
  );
}
