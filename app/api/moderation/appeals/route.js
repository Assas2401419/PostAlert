import { ok, fail } from '../../../../lib/api-response.js';
import { listAppeals, reviewAppeal, submitAppeal } from '../../../../lib/platform-store.js';
import { requireSessionUser } from '../../../../lib/session-user.js';

export async function GET() {
  try {
    const sessionUser = await requireSessionUser();
    return ok({ items: await listAppeals(sessionUser.id) });
  } catch (error) {
    return fail(error);
  }
}

export async function POST(request) {
  try {
    const sessionUser = await requireSessionUser();
    const body = await request.json();
    return ok(await submitAppeal(sessionUser.id, body), { status: 201 });
  } catch (error) {
    return fail(error);
  }
}

export async function PUT(request) {
  try {
    const sessionUser = await requireSessionUser();
    const body = await request.json();
    return ok({
      appeal: await reviewAppeal(sessionUser.id, body.appealId, body.status)
    });
  } catch (error) {
    return fail(error);
  }
}
