import { ok, fail } from '../../../../lib/api-response.js';
import { getAuthorityDashboard } from '../../../../lib/platform-store.js';
import { requireSessionUser } from '../../../../lib/session-user.js';

export async function GET(request) {
  try {
    const sessionUser = await requireSessionUser();
    const parish = new URL(request.url).searchParams.get('parish') || '';
    return ok(await getAuthorityDashboard(sessionUser.id, parish));
  } catch (error) {
    return fail(error);
  }
}
