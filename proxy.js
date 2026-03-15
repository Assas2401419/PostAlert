import NextAuth from 'next-auth';

import authConfig from './auth.config.js';

const { auth } = NextAuth(authConfig);

export function proxy(request) {
  return auth(request);
}

export const config = {
  matcher: ['/report/:path*', '/profile/:path*', '/authority/:path*']
};
