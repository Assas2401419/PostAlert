import { ok, fail } from '../../../../lib/api-response.js';
import { submitAppeal } from '../../../../lib/platform-store.js';
import { requireSessionUser } from '../../../../lib/session-user.js';

export async function POST(request) {
  try {
    const sessionUser = await requireSessionUser();
    const body = await request.json();
    return ok(await submitAppeal(sessionUser.id, body), { status: 201 });
  } catch (error) {
    return fail(error);
  }
}
