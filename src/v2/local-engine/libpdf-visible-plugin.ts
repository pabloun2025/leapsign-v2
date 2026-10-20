import {createHash} from 'node:crypto';
import type {Plugin} from 'vite';

const reviewedSha256 = '7b9b699034c81be2ab6af3337e0d2559df2b91b5016913b2c202cbaafc534400';

const replaceOnce = (source: string, before: string, after: string) => {
  if (source.split(before).length !== 2) throw new Error('Visible-signature hook context changed');
  return source.replace(before, after);
};

/** Exact, reviewable adaptation of @libpdf/core 0.5.3 before bundling. */
export function patchLibPdfVisibleSignatures(source: string) {
  if (createHash('sha256').update(source).digest('hex') !== reviewedSha256) {
    throw new Error('Unexpected @libpdf/core artifact');
  }
  let output = replaceOnce(source,
    'fieldName: resolved.fieldName,\n\t\t\tpageRef: firstPageRef,',
    'fieldName: resolved.fieldName,\n\t\t\tpreserveAppearance: options.leapSignPreserveAppearance === true,\n\t\t\tpageRef: firstPageRef,');
  output = replaceOnce(output,
    '\t\tfieldDict.set("V", valueRef);\n\t\tthis.removeWidgetKidsFromPages(fieldDict);',
    `\t\t// LeapSign: retain a reviewed merged widget before ByteRange/hash/CMS.\n\t\tif (options.preserveAppearance) {\n\t\t\tif ((fieldDict.getArray("Kids")?.length ?? 0) > 0 || !fieldDict.getDict("AP") ||\n\t\t\t\t!fieldDict.getArray("Rect") || !fieldDict.get("P")) {\n\t\t\t\tthrow new SignatureError("INVALID_VISIBLE_FIELD", "Prepared merged appearance required");\n\t\t\t}\n\t\t\tfieldDict.delete("Kids");\n\t\t\tfieldDict.set("V", valueRef);\n\t\t\treturn;\n\t\t}\n\t\tfieldDict.set("V", valueRef);\n\t\tthis.removeWidgetKidsFromPages(fieldDict);`);
  return output;
}

export function libPdfVisibleSignaturePlugin(): Plugin {
  return {
    name: 'leapsign-libpdf-visible-signature',
    enforce: 'pre',
    transform(source, id) {
      const clean = id.split('?')[0].replaceAll('\\', '/');
      if (!clean.endsWith('/node_modules/@libpdf/core/dist/index.mjs')) return null;
      return {code: patchLibPdfVisibleSignatures(source), map: null};
    },
  };
}
