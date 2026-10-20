import {describe, expect, it, vi} from 'vitest';
import {createSessionHandler} from '../server/v2/session-api';

const origin = 'https://leapsign.app';
const token = 'a'.repeat(21);
const request = (body: unknown = {accessToken: token}) => new Request(origin + '/api/v2/session', {
  method: 'POST', headers: {'Content-Type': 'application/json', Origin: origin, 'X-LeapSign-Client': 'v2'}, body: JSON.stringify(body),
});

describe('v2 session boundary', () => {
  it('only exchanges a verified v2 access token for a strict host cookie', async () => {
    const verifyAccessToken = vi.fn(async () => '11111111-1111-4111-8111-111111111111');
    const result = await createSessionHandler({verifyAccessToken}, origin)(request());
    expect(result.status).toBe(200);
    expect(result.headers.get('Set-Cookie')).toBe(`__Host-leapsign-v2=${token}; Path=/; Secure; HttpOnly; SameSite=Strict; Max-Age=3600`);
    expect(await result.json()).toEqual({code: 'SIGNED_IN'});
  });
  it('does not invoke Auth for cross-origin, malformed or extra input', async () => {
    const verifyAccessToken = vi.fn(); const handler = createSessionHandler({verifyAccessToken}, origin);
    const cross = new Request(origin + '/api/v2/session', {method: 'POST', headers: {'Content-Type': 'application/json', Origin: 'https://evil.invalid', 'X-LeapSign-Client': 'v2'}, body: JSON.stringify({accessToken: token})});
    expect((await handler(cross)).status).toBe(403);
    expect((await handler(request({accessToken: token, password: 'never accepted'}))).status).toBe(400);
    expect(verifyAccessToken).not.toHaveBeenCalled();
  });
  it('never creates a cookie when v2 Auth rejects the token', async () => {
    const result = await createSessionHandler({verifyAccessToken: async () => null}, origin)(request());
    expect(result.status).toBe(401); expect(result.headers.get('Set-Cookie')).toBeNull();
  });
  it('requires same-origin CSRF protection to clear the cookie', async () => {
    const handler = createSessionHandler({verifyAccessToken: async () => null}, origin);
    expect((await handler(new Request(origin + '/api/v2/session', {method: 'DELETE'}))).status).toBe(403);
    const result = await handler(new Request(origin + '/api/v2/session', {method: 'DELETE', headers: {Origin: origin, 'X-LeapSign-Client': 'v2'}}));
    expect(result.status).toBe(200); expect(result.headers.get('Set-Cookie')).toContain('Max-Age=0');
  });
});
