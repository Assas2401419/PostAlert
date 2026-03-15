'use client';

import { SessionProvider } from 'next-auth/react';
import { NotificationProvider } from '../lib/notification-context.jsx';
import { NotificationContainer } from './incident-notification';

export function Providers({ children }) {
  return (
    <SessionProvider>
      <NotificationProvider>
        {children}
        <NotificationContainer />
      </NotificationProvider>
    </SessionProvider>
  );
}
