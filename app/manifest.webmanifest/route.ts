import { MetadataRoute } from 'next';

export async function GET() {
  const manifest: MetadataRoute.Manifest = {
    name: 'Vaulto',
    short_name: 'Vaulto',
    description: 'Trade tokenized equities with stablecoins. Advanced DeFi infrastructure with MEV protection and institutional-grade security.',
    start_url: '/',
    display: 'standalone',
    background_color: '#000000',
    theme_color: '#000000',
    icons: [
      {
        src: '/favicon.png',
        sizes: '192x192',
        type: 'image/png',
        purpose: 'any',
      },
      {
        src: '/favicon.png',
        sizes: '192x192',
        type: 'image/png',
        purpose: 'maskable',
      },
      {
        src: '/favicon.png',
        sizes: '512x512',
        type: 'image/png',
        purpose: 'any',
      },
      {
        src: '/favicon.png',
        sizes: '512x512',
        type: 'image/png',
        purpose: 'maskable',
      },
    ],
    categories: ['finance', 'business'],
    orientation: 'portrait',
  };

  return Response.json(manifest);
}

















