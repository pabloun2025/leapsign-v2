import {defineConfig} from 'vite';
import {fileURLToPath} from 'node:url';
import {libPdfVisibleSignaturePlugin} from '../../src/v2/local-engine/libpdf-visible-plugin';

/** Dedicated v2 functional UI. Never inherit v1's environment or entrypoint. */
export default defineConfig({
  root: fileURLToPath(new URL('./ui/', import.meta.url)),
  envDir: false,
  envPrefix: 'LEAPSIGN_PREVIEW_PUBLIC_',
  // Package the approved, repository-owned v1 brand assets into the isolated
  // v2 output. The source directory remains read-only and v1 is not rebuilt.
  publicDir: fileURLToPath(new URL('../../public/', import.meta.url)),
  build: {
    outDir: fileURLToPath(new URL('./dist/', import.meta.url)),
    emptyOutDir: true,
    sourcemap: false,
    target: 'es2022',
  },
  plugins: [libPdfVisibleSignaturePlugin(), {
    name: 'preview-source-and-robots',
    transformIndexHtml(html) {
      return html.replace('</head>', '<meta name="robots" content="noindex,nofollow,noarchive"></head>')
        .replace('</body>', '<footer style="padding:16px 24px;text-align:center;font:13px sans-serif"><a href="/source.zip" download>Código fuente de esta vista previa · AGPLv3</a> · <a href="/THIRD-PARTY-NOTICES.txt">Licencias de terceros</a></footer></body>');
    },
  }],
});
