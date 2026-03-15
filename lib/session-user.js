import { auth } from '../auth.js';
import { PlatformError } from './platform-store.js';

export async function requireSessionUser() {
  const session = await auth();
  if (!session?.user?.id) {
    throw new PlatformError(401, 'Authentication required.', 4010);
  }
  return session.user;
}
