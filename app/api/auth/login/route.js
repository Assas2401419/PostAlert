import { ok, fail } from '../../../../lib/api-response.js';
import { validateCredentials } from '../../../../lib/platform-store.js';

export async function POST(request) {
  try {
    const body = await request.json();
    return ok({
      user: await validateCredentials(body.email, body.password)
    });
  } catch (error) {
    return fail(error);
  }
}
