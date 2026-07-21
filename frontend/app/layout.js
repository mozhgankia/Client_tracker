import './globals.css';
import { AuthProvider } from '../lib/AuthContext';
import { LanguageProvider } from '../lib/LanguageContext';

export const metadata = {
  title: 'Estatemate',
  description: 'CRM هوشمند برای مشاوران املاک — پیگیری خودکار مشتری و ملک',
  applicationName: 'Estatemate',
  appleWebApp: { capable: true, title: 'Estatemate', statusBarStyle: 'black-translucent' },
  icons: { icon: '/icon.svg', shortcut: '/icon.svg' },
};

export const viewport = {
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#0F7B55' },
    { media: '(prefers-color-scheme: dark)', color: '#0A1511' },
  ],
};

export default function RootLayout({ children }) {
  return (
    <html lang="fa" dir="rtl">
      <body>
        <LanguageProvider>
          <AuthProvider>{children}</AuthProvider>
        </LanguageProvider>
      </body>
    </html>
  );
}
