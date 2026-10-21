import { MetadataRoute } from 'next';

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'Friendly CRM - MSME Platform',
    short_name: 'Friendly CRM',
    description: 'Multilingual, WhatsApp-first business management platform for Indian MSMEs',
    start_url: '/',
    id: '/',
    scope: '/',
    display: 'standalone',
    background_color: '#F6F8F7',
    theme_color: '#167D79',
    orientation: 'portrait',
    icons: [
      {
        src: '/icons/icon-192.png',
        sizes: '192x192',
        type: 'image/png',
        purpose: 'maskable',
      },
      {
        src: '/icons/icon-512.png',
        sizes: '512x512',
        type: 'image/png',
        purpose: 'maskable',
      },
    ],
  };
}
