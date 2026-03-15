import { fail, ok } from '../../../../lib/api-response.js';
import { generateResetToken, resetPassword } from '../../../../lib/platform-store.js';

export async function POST(request) {
  try {
    const body = await request.json();
    return ok(await generateResetToken(body.email));
  } catch (error) {
    return fail(error);
  }
}

export async function PUT(request) {
  try {
    const body = await request.json();
    return ok(await resetPassword(body.token, body.password));
  } catch (error) {
    return fail(error);
  }
}
