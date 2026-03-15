import { ok, fail } from '../../../../../lib/api-response.js';
import { disputeIncident } from '../../../../../lib/platform-store.js';
import { requireSessionUser } from '../../../../../lib/session-user.js';

export async function POST(_request, { params }) {
  try {
    const sessionUser = await requireSessionUser();
    return ok(await disputeIncident(params.id, sessionUser.id));
  } catch (error) {
    return fail(error);
  }
}
