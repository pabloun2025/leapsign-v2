import {describe,it,expect} from 'vitest';
import {existsSync,readFileSync,readdirSync} from 'node:fs';
describe('independent v2 repository guardrails',()=>{
 it('has no active root v1 Cloudflare or Supabase project configuration',()=>{
  expect(existsSync('wrangler.jsonc')).toBe(false);
  expect(existsSync('supabase/config.toml')).toBe(false);
  expect(existsSync('.github/workflows/deploy-supabase.yml')).toBe(false);
 });
 it('does not build or serve the inherited v1 entrypoint by default',()=>{
  const pkg=JSON.parse(readFileSync('package.json','utf8'));
  expect(pkg.name).toBe('leapsign-v2');
  expect(pkg.scripts.build).toContain('--config v2/preview/vite.config.mts');
  expect(pkg.scripts.dev).toContain('--config v2/preview/vite.config.mts');
  expect(pkg.scripts.server).toBeUndefined();
 });
 it('has no enabled workflow targeting the v1 Supabase project',()=>{
  for(const file of readdirSync('.github/workflows')){
   if(!/\.ya?ml$/.test(file))continue;
   expect(readFileSync(`.github/workflows/${file}`,'utf8')).not.toContain('lgsdoutarthfymbjgdrj');
  }
 });
});
