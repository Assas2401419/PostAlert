import { ok, fail } from '../../../../lib/api-response.js';
import { registerDevice } from '../../../../lib/platform-store.js';
import { requireSessionUser } from '../../../../lib/session-user.js';

export async function POST(request) {
  try {
    const sessionUser = await requireSessionUser();
    const body = await request.json();
    return ok(await registerDevice(sessionUser.id, body.token, body.platform));
  } catch (error) {
    return fail(error);
  }
}
