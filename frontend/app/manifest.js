// Web App Manifest (PWA). Next serves this at /manifest.webmanifest and
// injects the <link rel="manifest"> tag automatically. Adding the app to the
// Home Screen then gives it a dedicated icon and a full-screen, app-like
// (standalone) window with no browser chrome.
export default function manifest() {
  return {
    name: 'Estatemate',
    short_name: 'Estatemate',
    description: 'CRM هوشمند برای مشاوران املاک — پیگیری خودکار مشتری و ملک',
    start_url: '/',
    display: 'standalone',
    orientation: 'portrait',
    background_color: '#0A1511',
    theme_color: '#0F7B55',
    icons: [
      { src: '/icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' },
      { src: '/icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'maskable' },
    ],
  };
}
