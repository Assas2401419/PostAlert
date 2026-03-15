import { ok, fail } from '../../../../lib/api-response.js';
import { getTrendHeatmap } from '../../../../lib/platform-store.js';

export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    return ok({
      items: await getTrendHeatmap(
        searchParams.get('period') || '24h',
        searchParams.get('parish') || ''
      )
    });
  } catch (error) {
    return fail(error);
  }
}
