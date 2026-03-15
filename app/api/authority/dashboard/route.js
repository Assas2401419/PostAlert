import { ok, fail } from '../../../../lib/api-response.js';
import { getAuthorityDashboard } from '../../../../lib/platform-store.js';
import { requireSessionUser } from '../../../../lib/session-user.js';

export async function GET(request) {
  try {
    const sessionUser = await requireSessionUser();
    const searchParams = new URL(request.url).searchParams;
    return ok(
      await getAuthorityDashboard(
        sessionUser.id,
        searchParams.get('parish') || '',
        searchParams.get('status') || ''
      )
    );
  } catch (error) {
    return fail(error);
  }
}
