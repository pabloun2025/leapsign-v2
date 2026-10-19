/** Build an EXPLICIT experimental appearance-only variant of @libpdf/core 0.5.3.
 * No prototype monkeypatch; no byte edits after signing; no CMS/crypto changes.
 * This is not a production dependency. A maintained source fork/API and browser
 * interoperability review are still required before enabling the feature.
 * Run with the original dist/index.mjs path. Output is adjacent to that file so
 * its original relative imports remain valid. The upstream package stays intact.
 */
import {readFile, writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {dirname, join} from 'node:path';

const input = process.argv[2];
if (!input) throw new Error('Supply the pinned original dist/index.mjs');
let source = await readFile(input, 'utf8');
if (createHash('sha256').update(source).digest('hex') !== '7b9b699034c81be2ab6af3337e0d2559df2b91b5016913b2c202cbaafc534400') {
  throw new Error('Unexpected upstream artifact: refusing to adapt it');
}
function replaceOnce(before, after) {
  if (source.split(before).length !== 2) throw new Error('Appearance hook context changed');
  source = source.replace(before, after);
}
replaceOnce('fieldName: resolved.fieldName,\n\t\t\tpageRef: firstPageRef,',
  'fieldName: resolved.fieldName,\n\t\t\tpreserveAppearance: options.leapSignPreserveAppearance === true,\n\t\t\tpageRef: firstPageRef,');
replaceOnce('\t\tfieldDict.set("V", valueRef);\n\t\tthis.removeWidgetKidsFromPages(fieldDict);', `
        // LeapSign LAB extension: retain an explicitly prepared merged widget.
        // This executes BEFORE save/ByteRange/hash/CMS creation. Signed bytes
        // are never modified afterwards. Default upstream behaviour is unchanged.
        if (options.preserveAppearance) {
            if ((fieldDict.getArray("Kids")?.length ?? 0) > 0 || !fieldDict.getDict("AP") ||
                !fieldDict.getArray("Rect") || !fieldDict.get("P")) {
                throw new SignatureError("INVALID_VISIBLE_FIELD", "Prepared merged appearance required");
            }
            fieldDict.delete("Kids");
            fieldDict.set("V", valueRef);
            return;
        }
\t\tfieldDict.set("V", valueRef);
\t\tthis.removeWidgetKidsFromPages(fieldDict);`);
const output = join(dirname(input), 'leapsign-visible-lab.mjs');
await writeFile(output, '// Experimental LeapSign appearance extension; upstream MIT license applies.\n' + source);
process.stdout.write(output + '\n');
