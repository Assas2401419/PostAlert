import { Suspense } from 'react';

import { Providers } from '../components/providers.jsx';

import './globals.css';

export const metadata = {
  title: 'JEIP',
  description: 'Jamaica Emergency Intelligence Platform'
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>
        <Providers>
          <Suspense
            fallback={
              <div className="app-loading">
                <span className="section-kicker">Launching JEIP</span>
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
