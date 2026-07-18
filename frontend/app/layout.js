import './globals.css';
import { AuthProvider } from '../lib/AuthContext';
import { LanguageProvider } from '../lib/LanguageContext';

export const metadata = {
  title: 'مسکن‌یار',
  description: 'پیگیری مشتری و ملک برای مشاوران املاک',
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
