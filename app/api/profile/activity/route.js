import { ok, fail } from '../../../../lib/api-response.js';
import { listProfileActivity } from '../../../../lib/platform-store.js';
import { requireSessionUser } from '../../../../lib/session-user.js';

export async function GET() {
  try {
    const sessionUser = await requireSessionUser();
    return ok(await listProfileActivity(sessionUser.id));
  } catch (error) {
    return fail(error);
  }
}
