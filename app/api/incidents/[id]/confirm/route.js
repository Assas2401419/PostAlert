import { ok, fail } from '../../../../../lib/api-response.js';
import { confirmIncident } from '../../../../../lib/platform-store.js';
import { requireSessionUser } from '../../../../../lib/session-user.js';

export async function POST(_request, { params }) {
  try {
    const sessionUser = await requireSessionUser();
    const { id } = await params;
    return ok(await confirmIncident(id, sessionUser.id));
  } catch (error) {
    return fail(error);
  }
}
