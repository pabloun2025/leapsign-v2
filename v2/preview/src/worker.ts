import {createSessionHandler} from '../../../server/v2/session-api';

type Env = {
  ASSETS: Fetcher;
  V2_ORIGIN: string;
  SUPABASE_V2_URL: string;
  SUPABASE_V2_PUBLISHABLE_KEY: string;
};

const json = (code: string, status: number) => new Response(JSON.stringify({code}), {
  status,
  headers: {'Cache-Control': 'no-store', 'Content-Type': 'application/json', 'X-Content-Type-Options': 'nosniff'},
});

/**
 * Dedicated v2 Worker.  It does not import v1 code or route to a v1 origin.
 * Secrets are supplied as Worker bindings at deployment time, never in the
 * static bundle or wrangler configuration.
 */
export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const origin = env.V2_ORIGIN;
    if (!origin || new URL(origin).origin !== origin || !env.SUPABASE_V2_URL || !env.SUPABASE_V2_PUBLISHABLE_KEY) return json('V2_CONFIGURATION_REQUIRED', 503);
    const url = new URL(request.url);
    if (url.origin !== origin) return json('NOT_FOUND', 404);
    if (url.pathname === '/api/v2/session') {
      const handler = createSessionHandler({
        verifyAccessToken: async (token, signal) => {
          try {
            const response = await fetch(new URL('/auth/v1/user', env.SUPABASE_V2_URL), {
              headers: {apikey: env.SUPABASE_V2_PUBLISHABLE_KEY, Authorization: `Bearer ${token}`},
              redirect: 'error', cache: 'no-store', signal,
            });
            if (!response.ok || response.headers.get('Content-Type')?.split(';')[0] !== 'application/json') {await response.body?.cancel(); return null;}
            const user = await response.json() as {id?: unknown; is_anonymous?: unknown; email_confirmed_at?: unknown};
            return typeof user.id === 'string' && /^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i.test(user.id) && !user.is_anonymous && Boolean(user.email_confirmed_at) ? user.id : null;
          } catch {return null;}
        },
      }, origin);
      return handler(request);
    }
    if (url.pathname.startsWith('/api/v2/')) return json('NOT_FOUND', 404);
    return env.ASSETS.fetch(request);
  },
};
