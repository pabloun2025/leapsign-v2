/** Build the approved interface-only preview, not the v1 application or v2 API.
 * All output is generated under v2/preview/dist, never root dist.
 * The corresponding committed source is bundled for AGPL source availability.
 */
import {build} from 'vite';
import {copyFile, mkdir, readFile, readdir, writeFile} from 'node:fs/promises';
import {resolve, join} from 'node:path';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';

const root = resolve(import.meta.dirname, '..');
const output = join(root, 'v2/preview/dist');
const git = (...args) => {
  const result = spawnSync('git', args, {cwd: root, maxBuffer: 32 * 1024 * 1024});
  if (result.status !== 0) throw new Error('Git source verification failed');
  return result.stdout;
};
git('ls-files', '--error-unmatch', 'scripts/build-v2-preview.mjs', 'v2/preview/vite.config.mts');
git('diff', '--quiet', 'HEAD', '--');
const revision = git('rev-parse', 'HEAD').toString().trim();
await build({configFile: join(root, 'v2/preview/vite.config.mts')});
const assets = await readdir(join(output, 'assets'));
for (const name of assets.filter(name => name.endsWith('.js'))) {
  const code = await readFile(join(output, 'assets', name), 'utf8');
  if (/supabase\.co|api\.resend\.com|firma\.veryfacil\.org|sb_secret_|service_role/.test(code)) throw new Error('Preview unexpectedly contains production integration');
}
await copyFile(join(root, 'v2/preview/_headers'), join(output, '_headers'));
await writeFile(join(output, 'robots.txt'), 'User-agent: *\nDisallow: /\n');
await writeFile(join(output, 'release.json'), JSON.stringify({revision, mode: 'interface-only', builtAt: new Date().toISOString()}, null, 2));
const notices = await Promise.all(['react', 'react-dom', 'scheduler', 'pdfjs-dist'].map(async name => `${name}\n${await readFile(join(root, 'node_modules', name, 'LICENSE'), 'utf8')}`));
await writeFile(join(output, 'THIRD-PARTY-NOTICES.txt'), notices.join('\n\n---\n\n'));
const source = git('archive', '--format=zip', 'HEAD');
if (source.length > 24 * 1024 * 1024) throw new Error('Source asset exceeds the preview size limit');
await writeFile(join(output, 'source.zip'), source);
const archiveDir = join(root, 'v2/preview/artifacts');
await mkdir(archiveDir, {recursive: true});
const zipPath = join(archiveDir, `leapsign-v2-ui-preview-${revision.slice(0, 7)}.zip`);
// -FS synchronizes an existing generated archive instead of retaining stale files.
const zipped = spawnSync('zip', ['-q', '-r', '-FS', zipPath, '.'], {cwd: output});
if (zipped.status !== 0) throw new Error('Preview archive could not be created');
const archive = await readFile(zipPath);
process.stdout.write(JSON.stringify({mode: 'interface-only', revision, directory: output, archive: zipPath, bytes: archive.length, sha256: createHash('sha256').update(archive).digest('hex'), published: false}) + '\n');
