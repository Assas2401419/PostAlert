import { ok } from '../../../lib/api-response.js';
import { hasSupabaseConfig } from '../../../lib/supabase/server.js';

export async function GET() {
  return ok({
    ok: true,
    app: 'JEIP',
    runtime: 'nextjs',
    storage: hasSupabaseConfig() ? 'supabase' : 'local-fallback',
    timestamp: new Date().toISOString()
  });
}
