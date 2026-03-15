import { NextResponse } from 'next/server';

function matchesRoute(pathname, prefix) {
  return pathname === prefix || pathname.startsWith(`${prefix}/`);
}

function isProtectedRoute(pathname) {
  return (
    matchesRoute(pathname, '/report') ||
    matchesRoute(pathname, '/profile') ||
    matchesRoute(pathname, '/authority')
  );
}

function isAuthorityRoute(pathname) {
  return matchesRoute(pathname, '/authority');
}

const authConfig = {
  trustHost: true,
  providers: [],
  session: {
    strategy: 'jwt'
  },
  pages: {
    signIn: '/auth'
  },
  callbacks: {
    async jwt({ token, user }) {
      if (user) {
        token.user = user;
      }
      return token;
    },
    async session({ session, token }) {
      if (token.user) {
        session.user = token.user;
      }
      return session;
    },
    authorized({ auth, request }) {
      const pathname = request.nextUrl.pathname;

      if (!isProtectedRoute(pathname)) {
        return true;
      }

      const user = auth?.user || null;
      if (!user) {
        return false;
      }

      if (
        isAuthorityRoute(pathname) &&
        user.role !== 'authority' &&
        user.role !== 'admin'
      ) {
        return NextResponse.redirect(new URL('/feed', request.nextUrl));
      }

      return true;
    }
  }
};

export default authConfig;
