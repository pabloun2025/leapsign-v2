import {describe, expect, it} from 'vitest';
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
const root = resolve(import.meta.dirname, '..');
describe('preview configuration cannot replace production', () => {
  it('uses an isolated v2 Worker, custom domain and asset directory', () => {
    const production = JSON.parse(readFileSync(resolve(root, 'legacy/v1/wrangler.jsonc'), 'utf8'));
    const preview = JSON.parse(readFileSync(resolve(root, 'v2/preview/wrangler.jsonc'), 'utf8'));
    expect(production.name).toBe('firmador'); expect(preview.name).toBe('leapsign-v2-ui-preview');
    expect(preview.routes).toEqual([{pattern:'pruebas.leapsign.app',custom_domain:true}]);
    expect(preview.main).toBe('./src/worker.ts');
    expect(Object.keys(preview).sort()).toEqual(['assets','compatibility_date','compatibility_flags','main','name','observability','preview_urls','routes','triggers','vars','workers_dev']);
    expect(preview.triggers).toEqual({crons:['17 */6 * * *']});
    expect(preview.compatibility_flags).toEqual(['nodejs_compat']);
    expect(preview.vars).toMatchObject({V2_ORIGIN:'https://pruebas.leapsign.app',SUPABASE_V2_URL:'https://lbreydchhskrrmpzniem.supabase.co',V2_STORAGE_BUCKET:'v2-pdfs'});
    expect(resolve(root, 'v2/preview', preview.assets.directory)).not.toBe(resolve(root, production.assets.directory));
  });
  it('prevents API connections, embedding and native form submissions in static preview', () => {
    const headers = readFileSync(resolve(root, 'v2/preview/_headers'), 'utf8');
    for (const directive of ["connect-src 'self' https://lbreydchhskrrmpzniem.supabase.co", "object-src 'none'", "frame-src 'none'", "form-action 'none'", "worker-src 'self'", 'X-Robots-Tag: noindex']) expect(headers).toContain(directive);
    expect(headers).not.toContain("'unsafe-eval'");
  });
  it('passes server feature flags in the canonical environment shape', () => {
    const worker = readFileSync(resolve(root, 'v2/preview/src/worker.ts'), 'utf8');
    expect(worker).toContain('DIRECT_P12_SIGNING_ENABLED:env.V2_DIRECT_ENABLED');
    expect(worker).toContain('EXTERNAL_SIGNATURE_ENABLED:env.V2_EXTERNAL_ENABLED');
    expect(worker).toContain('FIRMAEC_COMPATIBILITY_PROFILE_ENABLED:env.V2_PROFILE_ENABLED');
    expect(worker).toContain('fetch:globalThis.fetch.bind(globalThis)');
    expect(worker).not.toContain('const flags:SigningFlags={direct:');
    expect(worker).toContain("new URL('/refresh',validator)");
    expect(worker).toContain('async scheduled(');
  });
});
