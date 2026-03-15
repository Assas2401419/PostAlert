import { ok, fail } from '../../../../lib/api-response.js';
import { listProfileIncidents } from '../../../../lib/platform-store.js';
import { requireSessionUser } from '../../../../lib/session-user.js';

export async function GET() {
  try {
    const sessionUser = await requireSessionUser();
    return ok({ items: await listProfileIncidents(sessionUser.id) });
  } catch (error) {
    return fail(error);
  }
}
