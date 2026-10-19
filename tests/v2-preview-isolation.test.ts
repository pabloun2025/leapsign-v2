import {describe, expect, it} from 'vitest';
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
const root = resolve(import.meta.dirname, '..');
describe('preview configuration cannot replace production', () => {
  it('uses a different static target and output directory, without domain routes or bindings', () => {
    const production = JSON.parse(readFileSync(resolve(root, 'wrangler.jsonc'), 'utf8'));
    const preview = JSON.parse(readFileSync(resolve(root, 'v2/preview/wrangler.jsonc'), 'utf8'));
    expect(production.name).toBe('firmador'); expect(preview.name).toBe('leapsign-v2-ui-preview');
    expect(preview.routes).toEqual([]); expect(preview.main).toBeUndefined();
    expect(Object.keys(preview).sort()).toEqual(['assets','compatibility_date','name','observability','preview_urls','routes','workers_dev']);
    expect(resolve(root, 'v2/preview', preview.assets.directory)).not.toBe(resolve(root, production.assets.directory));
  });
  it('prevents API connections, embedding and native form submissions in static preview', () => {
    const headers = readFileSync(resolve(root, 'v2/preview/_headers'), 'utf8');
    for (const directive of ["connect-src 'none'", "object-src 'none'", "frame-src 'none'", "form-action 'none'", "worker-src 'self'", 'X-Robots-Tag: noindex']) expect(headers).toContain(directive);
    expect(headers).not.toContain("'unsafe-eval'");
  });
});
