/**
 * WellSim Frontend — Root Layout (UI v3 "Instrument")
 *
 * HTML shell, metadata, font preloading. An inline script restores
 * the saved theme before hydration so dark mode never flashes.
 */

import './globals.css';

export const metadata = {
  title: 'WellSim — Clinical Triage',
  description: 'Real-time monitoring dashboard for AI-powered respiratory and cardiovascular screening. Receives and visualizes ESP32 sensor data.',
  keywords: ['IoT', 'healthcare', 'ESP32', 'monitoring', 'dashboard', 'respiratory', 'cardiovascular'],
};

// Runs before paint: restore saved theme, or follow system preference.
const themeInitScript = `
(function () {
  try {
    var t = localStorage.getItem('wellsim_theme');
    if (t === 'dark' || (!t && window.matchMedia('(prefers-color-scheme: dark)').matches)) {
      document.documentElement.classList.add('dark');
    }
  } catch (e) {}
})();
`;

export default function RootLayout({ children }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <script dangerouslySetInnerHTML={{ __html: themeInitScript }} />
      </head>
      <body className="min-h-screen bg-paper dark:bg-coal-950 antialiased transition-colors duration-300">
        {children}
      </body>
    </html>
  );
}
