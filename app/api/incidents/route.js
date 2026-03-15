import { ok, fail } from '../../../lib/api-response.js';
import { createIncident, listIncidents } from '../../../lib/platform-store.js';
import { requireSessionUser } from '../../../lib/session-user.js';

export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    const sessionUser = await requireOptionalUser();
    const data = await listIncidents(
      {
        categories: searchParams.get('categories')?.split(',').filter(Boolean) || [],
        severities: searchParams.get('severities')?.split(',').filter(Boolean) || [],
        parish: searchParams.get('parish') || '',
        startTime: searchParams.get('startTime') || '',
        endTime: searchParams.get('endTime') || '',
        page: Number(searchParams.get('page') || 1),
        limit: Number(searchParams.get('limit') || 8)
      },
      sessionUser?.id || ''
    );
    return ok(data);
  } catch (error) {
    return fail(error);
  }
}

export async function POST(request) {
  try {
    const sessionUser = await requireSessionUser();
    const body = await request.json();
    const response = await createIncident(body, sessionUser.id);
    return ok(response, { status: 201 });
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
