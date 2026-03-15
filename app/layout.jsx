import { Suspense } from 'react';
import 'mapbox-gl/dist/mapbox-gl.css';

import { Providers } from '../components/providers.jsx';

import './globals.css';

export const metadata = {
  title: 'Postalert',
  description: 'Postalert - Real-time incident reporting platform for Jamaica'
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>
        <Providers>
          <Suspense
            fallback={
              <div className="app-loading">
                <span className="section-kicker">Launching Postalert</span>
                <h1 className="font-display">Syncing emergency intelligence.</h1>
              </div>
            }
          >
            {children}
          </Suspense>
        </Providers>
      </body>
    </html>
  );
}
