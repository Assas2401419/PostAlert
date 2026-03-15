import { ok, fail } from '../../../../../../lib/api-response.js';
import { approveAuthority } from '../../../../../../lib/platform-store.js';
import { requireSessionUser } from '../../../../../../lib/session-user.js';

export async function POST(_request, { params }) {
  try {
    const sessionUser = await requireSessionUser();
    return ok({ user: await approveAuthority(sessionUser.id, params.id) });
  } catch (error) {
    return fail(error);
  }
}
