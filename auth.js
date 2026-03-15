import NextAuth from 'next-auth';
import Credentials from 'next-auth/providers/credentials';

import authConfig from './auth.config.js';
import { getSessionUserByEmail, verifyCredentials } from './lib/platform-store.js';

export const { handlers, auth, signIn, signOut } = NextAuth({
  ...authConfig,
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
    ...authConfig.callbacks,
    async jwt({ token, user, trigger }) {
      token = await authConfig.callbacks.jwt({ token, user });

      if (trigger === 'update' && token.email) {
        token.user = await getSessionUserByEmail(token.email);
      }

      return token;
    }
  }
});
