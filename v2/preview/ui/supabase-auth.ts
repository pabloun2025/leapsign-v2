import {createClient} from '@supabase/supabase-js';

export type AuthenticatedUser = {id: string; email: string; accessToken: string};
export interface AuthPort {
  signIn(email: string, password: string): Promise<AuthenticatedUser>;
  sendRecovery(email: string, redirectTo: string): Promise<void>;
  hasRecoverySession(): Promise<boolean>;
  updatePassword(password: string): Promise<void>;
}
type ProviderResult<T> = Promise<{data: T; error: unknown}>;
export interface SupabaseAuthClient {
  auth: {
    signInWithPassword(input: {email: string; password: string}): ProviderResult<{
      user: {id?: unknown; email?: unknown} | null;
      session: {access_token?: unknown} | null;
    }>;
    resetPasswordForEmail(email: string, options: {redirectTo: string}): ProviderResult<unknown>;
    getSession(): ProviderResult<{session: {access_token?: unknown} | null}>;
    updateUser(input: {password: string}): ProviderResult<unknown>;
  };
}
export type SupabaseAuthFactory = (
  url: string,
  publishableKey: string,
  options: {auth: {persistSession: false; autoRefreshToken: false; detectSessionInUrl: true}},
) => SupabaseAuthClient;

export class BrowserAuthError extends Error {
  constructor(readonly code: 'CONFIGURATION' | 'SIGN_IN' | 'RECOVERY' | 'PASSWORD') { super(code); }
}

const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const defaultFactory: SupabaseAuthFactory = (url, key, options) => createClient(url, key, options) as unknown as SupabaseAuthClient;

export function createSupabaseAuthPort(
  config: {url: string; publishableKey: string},
  factory: SupabaseAuthFactory = defaultFactory,
): AuthPort {
  let parsed: URL;
  try { parsed = new URL(config.url); }
  catch { throw new BrowserAuthError('CONFIGURATION'); }
  if (parsed.protocol !== 'https:' || parsed.username || parsed.password || parsed.search || parsed.hash ||
      parsed.pathname !== '/' || !parsed.hostname.endsWith('.supabase.co') ||
      typeof config.publishableKey !== 'string' || !config.publishableKey || config.publishableKey.length > 4096) {
    throw new BrowserAuthError('CONFIGURATION');
  }
  const client = factory(parsed.origin, config.publishableKey, {auth: {
    persistSession: false,
    autoRefreshToken: false,
    detectSessionInUrl: true,
  }});
  return {
    async signIn(email, password) {
      const normalized = email.trim().toLowerCase();
      if (!emailPattern.test(normalized) || normalized.length > 254 || !password || password.length > 4096) {
        throw new BrowserAuthError('SIGN_IN');
      }
      const result = await client.auth.signInWithPassword({email: normalized, password});
      const user = result.data?.user;
      const token = result.data?.session?.access_token;
      if (result.error || !user || typeof user.id !== 'string' || typeof user.email !== 'string' ||
          typeof token !== 'string' || token.length < 20 || token.length > 8000) throw new BrowserAuthError('SIGN_IN');
      return {id: user.id, email: user.email, accessToken: token};
    },
    async sendRecovery(email, redirectTo) {
      const normalized = email.trim().toLowerCase();
      let redirect: URL;
      try { redirect = new URL(redirectTo); }
      catch { throw new BrowserAuthError('RECOVERY'); }
      if (!emailPattern.test(normalized) || normalized.length > 254 || redirect.origin !== 'https://pruebas.leapsign.app' || redirect.pathname !== '/recuperar' || redirect.search || redirect.hash) {
        throw new BrowserAuthError('RECOVERY');
      }
      const result = await client.auth.resetPasswordForEmail(normalized, {redirectTo: redirect.toString()});
      if (result.error) throw new BrowserAuthError('RECOVERY');
    },
    async hasRecoverySession() {
      const result = await client.auth.getSession();
      return !result.error && typeof result.data?.session?.access_token === 'string';
    },
    async updatePassword(password) {
      if (typeof password !== 'string' || password.length < 8 || password.length > 4096) throw new BrowserAuthError('PASSWORD');
      const result = await client.auth.updateUser({password});
      if (result.error) throw new BrowserAuthError('PASSWORD');
    },
  };
}
