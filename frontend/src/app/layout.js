/**
 * WellSim Frontend — Root Layout
 * 
 * Provides the HTML shell, global metadata, and font loading
 * for the entire Next.js application.
 */

import './globals.css';

export const metadata = {
  title: 'WellSim — IoT Healthcare Dashboard',
  description: 'Real-time monitoring dashboard for AI-powered respiratory and cardiovascular screening. Receives and visualizes ESP32 sensor data.',
  keywords: ['IoT', 'healthcare', 'ESP32', 'monitoring', 'dashboard', 'respiratory', 'cardiovascular'],
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
      </head>
      <body className="min-h-screen bg-slate-50 antialiased">
        {children}
      </body>
    </html>
  );
}
