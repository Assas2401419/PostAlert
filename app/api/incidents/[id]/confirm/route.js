import { ok, fail } from '../../../../../lib/api-response.js';
import { confirmIncident } from '../../../../../lib/platform-store.js';
import { requireSessionUser } from '../../../../../lib/session-user.js';

export async function POST(_request, { params }) {
  try {
    const sessionUser = await requireSessionUser();
    return ok(await confirmIncident(params.id, sessionUser.id));
  } catch (error) {
    return fail(error);
  }
}
