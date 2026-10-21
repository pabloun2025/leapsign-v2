import {createClient} from '@supabase/supabase-js';

export type AuthenticatedUser = {id: string; email: string; accessToken: string};
export interface AuthPort {
  signUp(input: {email: string; password: string; firstName: string; lastName: string}, redirectTo: string): Promise<void>;
  signIn(email: string, password: string): Promise<AuthenticatedUser>;
  sendRecovery(email: string, redirectTo: string): Promise<void>;
  hasRecoverySession(): Promise<boolean>;
  updatePassword(password: string): Promise<void>;
  restore(): Promise<AuthenticatedUser | null>;
  subscribe(listener: (user: AuthenticatedUser | null, event: string) => void): () => void;
  signOut(): Promise<void>;
}
type ProviderResult<T> = Promise<{data: T; error: unknown}>;
type ProviderUser = {id?: unknown; email?: unknown} | null;
type ProviderSession = {access_token?: unknown; user?: ProviderUser} | null;
export interface SupabaseAuthClient {
  auth: {
    signUp(input: {email: string; password: string; options: {emailRedirectTo: string; data: Record<string, string>}}): ProviderResult<unknown>;
    signInWithPassword(input: {email: string; password: string}): ProviderResult<{user: ProviderUser; session: ProviderSession}>;
    resetPasswordForEmail(email: string, options: {redirectTo: string}): ProviderResult<unknown>;
    getSession(): ProviderResult<{session: ProviderSession}>;
    updateUser(input: {password: string}): ProviderResult<unknown>;
    signOut(): ProviderResult<unknown>;
    onAuthStateChange(callback: (event: string, session: ProviderSession) => void): {data: {subscription: {unsubscribe(): void}}};
  };
}
export type SupabaseAuthFactory = (
  url: string,
  publishableKey: string,
  options: {auth: {persistSession: false; autoRefreshToken: true; detectSessionInUrl: true}},
) => SupabaseAuthClient;

export class BrowserAuthError extends Error {
  constructor(readonly code: 'CONFIGURATION' | 'REGISTRATION' | 'SIGN_IN' | 'RECOVERY' | 'PASSWORD') { super(code); }
}

const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const defaultFactory: SupabaseAuthFactory = (url, key, options) => createClient(url, key, options) as unknown as SupabaseAuthClient;

function exactRedirect(value: string, pathname: '/confirmar' | '/recuperar', code: 'REGISTRATION' | 'RECOVERY'): URL {
  let redirect: URL;
  try { redirect = new URL(value); }
  catch { throw new BrowserAuthError(code); }
  if (redirect.origin !== 'https://pruebas.leapsign.app' || redirect.pathname !== pathname || redirect.search || redirect.hash) {
    throw new BrowserAuthError(code);
  }
  return redirect;
}

function publicUser(session: ProviderSession): AuthenticatedUser | null {
  const id = session?.user?.id;
  const email = session?.user?.email;
  const accessToken = session?.access_token;
  return typeof id === 'string' && typeof email === 'string' && typeof accessToken === 'string' &&
    accessToken.length >= 20 && accessToken.length <= 8000 ? {id, email, accessToken} : null;
}

function validPassword(password: string): boolean {
  return password.length >= 12 && password.length <= 4096 && /[a-z]/.test(password) && /[A-Z]/.test(password) && /\d/.test(password);
}

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
  const client = factory(parsed.origin, config.publishableKey, {auth: {persistSession: false, autoRefreshToken: true, detectSessionInUrl: true}});
  return {
    async signUp(input, redirectTo) {
      const email = input.email.trim().toLowerCase();
      const firstName = input.firstName.trim();
      const lastName = input.lastName.trim();
      const redirect = exactRedirect(redirectTo, '/confirmar', 'REGISTRATION');
      if (!emailPattern.test(email) || email.length > 254 || !validPassword(input.password) ||
          !firstName || firstName.length > 80 || !lastName || lastName.length > 120) throw new BrowserAuthError('REGISTRATION');
      const result = await client.auth.signUp({email, password: input.password, options: {
        emailRedirectTo: redirect.toString(),
        data: {first_name: firstName, last_name: lastName, full_name: `${firstName} ${lastName}`},
      }});
      if (result.error) throw new BrowserAuthError('REGISTRATION');
    },
    async signIn(email, password) {
      const normalized = email.trim().toLowerCase();
      if (!emailPattern.test(normalized) || normalized.length > 254 || !password || password.length > 4096) throw new BrowserAuthError('SIGN_IN');
      const result = await client.auth.signInWithPassword({email: normalized, password});
      const user = result.data?.user;
      const token = result.data?.session?.access_token;
      if (result.error || !user || typeof user.id !== 'string' || typeof user.email !== 'string' ||
          typeof token !== 'string' || token.length < 20 || token.length > 8000) throw new BrowserAuthError('SIGN_IN');
      return {id: user.id, email: user.email, accessToken: token};
    },
    async sendRecovery(email, redirectTo) {
      const normalized = email.trim().toLowerCase();
      const redirect = exactRedirect(redirectTo, '/recuperar', 'RECOVERY');
      if (!emailPattern.test(normalized) || normalized.length > 254) throw new BrowserAuthError('RECOVERY');
      const result = await client.auth.resetPasswordForEmail(normalized, {redirectTo: redirect.toString()});
      if (result.error) throw new BrowserAuthError('RECOVERY');
    },
    async hasRecoverySession() {
      const result = await client.auth.getSession();
      return !result.error && typeof result.data?.session?.access_token === 'string';
    },
    async updatePassword(password) {
      if (!validPassword(password)) throw new BrowserAuthError('PASSWORD');
      const result = await client.auth.updateUser({password});
      if (result.error) throw new BrowserAuthError('PASSWORD');
    },
    async restore() {
      const result = await client.auth.getSession();
      return result.error ? null : publicUser(result.data?.session);
    },
    subscribe(listener) {
      const {data} = client.auth.onAuthStateChange((event, session) => listener(publicUser(session), event));
      return () => data.subscription.unsubscribe();
    },
    async signOut() {
      const result = await client.auth.signOut();
      if (result.error) throw new BrowserAuthError('SIGN_IN');
    },
  };
}
