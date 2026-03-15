import { ok, fail } from '../../../../lib/api-response.js';
import { getTrendCounts } from '../../../../lib/platform-store.js';

export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    return ok(
      await getTrendCounts(
        searchParams.get('period') || '24h',
        searchParams.get('parish') || '',
        searchParams.get('dateFrom') || '',
        searchParams.get('dateTo') || ''
      )
    );
  } catch (error) {
    return fail(error);
  }
}
