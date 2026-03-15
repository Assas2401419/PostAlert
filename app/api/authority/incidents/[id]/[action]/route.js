import { ok, fail } from '../../../../../../lib/api-response.js';
import { applyAuthorityAction } from '../../../../../../lib/platform-store.js';
import { requireSessionUser } from '../../../../../../lib/session-user.js';

export async function POST(request, { params }) {
  try {
    const sessionUser = await requireSessionUser();
    const body = await request.json().catch(() => ({}));
    const { action, id } = await params;
    return ok({
      incident: await applyAuthorityAction(
        sessionUser.id,
        id,
        action,
        body.notes || ''
      )
    });
  } catch (error) {
    return fail(error);
  }
}
