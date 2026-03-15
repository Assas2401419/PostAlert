import NextAuth from 'next-auth';
import Credentials from 'next-auth/providers/credentials';

import { getSessionUserByEmail, verifyCredentials } from './lib/platform-store.js';

export const { handlers, auth, signIn, signOut } = NextAuth({
  trustHost: true,
  session: {
    strategy: 'jwt'
  },
  pages: {
    signIn: '/auth'
  },
  providers: [
    Credentials({
      credentials: {
        email: { label: 'Email', type: 'email' },
        password: { label: 'Password', type: 'password' }
      },
      async authorize(credentials) {
        const user = await verifyCredentials(credentials?.email, credentials?.password);
        if (!user) {
          return null;
        }
        return user;
      }
    })
  ],
  callbacks: {
    async jwt({ token, user, trigger }) {
      if (user) {
        token.user = user;
      }

      if (trigger === 'update' && token.email) {
        token.user = await getSessionUserByEmail(token.email);
      }

      return token;
    },
    async session({ session, token }) {
      session.user = token.user;
      return session;
    }
  }
});
