import { fail, ok } from '../../../../../lib/api-response.js';
import {
  createComment,
  deleteComment,
  listComments
} from '../../../../../lib/platform-store.js';
import { requireSessionUser } from '../../../../../lib/session-user.js';

export async function GET(request, { params }) {
  try {
    const sessionUser = await requireOptionalUser();
    return ok({
      items: await listComments((await params).id, sessionUser?.id || '')
    });
  } catch (error) {
    return fail(error);
  }
}

export async function POST(request, { params }) {
  try {
    const sessionUser = await requireSessionUser();
    const body = await request.json();
    return ok(
      {
        comment: await createComment((await params).id, sessionUser.id, body.message)
      },
      { status: 201 }
    );
  } catch (error) {
    return fail(error);
  }
}

export async function DELETE(request, { params }) {
  try {
    const sessionUser = await requireSessionUser();
    const body = await request.json().catch(() => ({}));
    return ok(await deleteComment((await params).id, body.commentId, sessionUser.id));
  } catch (error) {
    return fail(error);
  }
}

async function requireOptionalUser() {
  try {
    return await requireSessionUser();
  } catch {
    return null;
  }
}
