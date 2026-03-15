import { ok, fail } from '../../../../lib/api-response.js';
import { registerAuthority, registerCitizen } from '../../../../lib/platform-store.js';

export async function POST(request) {
  try {
    const body = await request.json();
    const user = body.kind === 'authority'
      ? await registerAuthority(body)
      : await registerCitizen(body);

    return ok({
      user,
      nextAction: 'sign-in'
    }, { status: 201 });
  } catch (error) {
    return fail(error);
  }
}
