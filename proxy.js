export { auth as proxy } from './auth.js';

export const config = {
  matcher: ['/report/:path*', '/profile/:path*']
};
