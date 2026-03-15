import { ok, fail } from '../../../../lib/api-response.js';
import { getIncidentById } from '../../../../lib/platform-store.js';
import { requireSessionUser } from '../../../../lib/session-user.js';

export async function GET(_request, { params }) {
  try {
    const sessionUser = await optionalUser();
    const incident = await getIncidentById(params.id, sessionUser?.id || '');
    return ok({ incident });
  } catch (error) {
    return fail(error);
  }
}

async function optionalUser() {
  try {
    return await requireSessionUser();
  } catch {
    return null;
  }
}
