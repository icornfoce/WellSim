/**
 * WellSim Frontend — Root Layout (UI v3 "Instrument")
 *
 * HTML shell, metadata, fonts, and the app-wide providers.
 *
 * Fonts are loaded through `next/font` rather than the `@import` that
 * used to sit in globals.css. That import was a render-blocking round
 * trip to two Google hosts before a single pixel of the dashboard
 * could paint, and the swap that followed re-flowed every number on
 * the page. `next/font` self-hosts the files, inlines the @font-face
 * rules, and reserves the metrics up front — no third-party request,
 * no layout shift.
 */

import { IBM_Plex_Sans, IBM_Plex_Sans_Thai, IBM_Plex_Mono } from 'next/font/google';
import './globals.css';
import { LanguageProvider } from '../i18n/LanguageContext';
import { ToastProvider } from '../components/ui/Toast';
import { ConfirmProvider } from '../components/ui/ConfirmDialog';

const plexSans = IBM_Plex_Sans({
  subsets: ['latin'],
  weight: ['300', '400', '500', '600', '700'],
  variable: '--font-plex-sans',
  display: 'swap',
});

const plexThai = IBM_Plex_Sans_Thai({
  subsets: ['thai', 'latin'],
  weight: ['300', '400', '500', '600', '700'],
  variable: '--font-plex-thai',
  display: 'swap',
});

const plexMono = IBM_Plex_Mono({
  subsets: ['latin'],
  weight: ['400', '500', '600'],
  variable: '--font-plex-mono',
  display: 'swap',
});

export const metadata = {
  title: 'WellSim — Clinical Triage',
  description: 'Real-time monitoring dashboard for AI-powered respiratory and cardiovascular screening. Receives and visualizes ESP32 sensor data.',
  keywords: ['IoT', 'healthcare', 'ESP32', 'monitoring', 'dashboard', 'respiratory', 'cardiovascular'],
};

/**
 * `viewportFit: 'cover'` plus the safe-area padding in globals.css
 * keeps the sticky header and the toast stack clear of the notch and
 * the home indicator on a phone.
 */
export const viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#F6F6F4' },
    { media: '(prefers-color-scheme: dark)', color: '#0B0D0C' },
  ],
};

// Runs before paint: restore saved theme, or follow system preference.
const themeInitScript = `
(function () {
  try {
    var t = localStorage.getItem('wellsim_theme');
    if (t === 'dark' || (!t && window.matchMedia('(prefers-color-scheme: dark)').matches)) {
      document.documentElement.classList.add('dark');
    }
    var l = localStorage.getItem('wellsim_lang');
    if (l === 'th' || l === 'en') document.documentElement.lang = l;
  } catch (e) {}
})();
`;

export default function RootLayout({ children }) {
  return (
    <html
      lang="en"
      suppressHydrationWarning
      className={`${plexSans.variable} ${plexThai.variable} ${plexMono.variable}`}
    >
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeInitScript }} />
      </head>
      <body className="min-h-screen bg-paper dark:bg-coal-950 antialiased transition-colors duration-300">
        <LanguageProvider>
          <ToastProvider>
            <ConfirmProvider>{children}</ConfirmProvider>
          </ToastProvider>
        </LanguageProvider>
      </body>
    </html>
  );
}
