import { ok, fail } from '../../../../lib/api-response.js';
import {
  getNotificationPreferences,
  updateNotificationPreferences
} from '../../../../lib/platform-store.js';
import { requireSessionUser } from '../../../../lib/session-user.js';

export async function GET() {
  try {
    const sessionUser = await requireSessionUser();
    return ok({ preferences: await getNotificationPreferences(sessionUser.id) });
  } catch (error) {
    return fail(error);
  }
}

export async function PUT(request) {
  try {
    const sessionUser = await requireSessionUser();
    const body = await request.json();
    return ok({ preferences: await updateNotificationPreferences(sessionUser.id, body) });
  } catch (error) {
    return fail(error);
  }
}
