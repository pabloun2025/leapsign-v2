/** Test-only independent QR decoder; no network or real document inputs. */
import {pathToFileURL} from 'node:url';
const chunks = [];
let size = 0;
for await (const chunk of process.stdin) {
  size += chunk.length;
  if (size > 20 * 1024 * 1024) throw new Error('IMAGE_LIMIT');
  chunks.push(chunk);
}
const {width, height, rgba} = JSON.parse(Buffer.concat(chunks).toString('utf8'));
if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width < 1 || height < 1 || width * height > 4_000_000 || !process.env.JSQR_MODULE_PATH) throw new Error('INVALID_LAB_IMAGE');
const {default: jsQR} = await import(pathToFileURL(process.env.JSQR_MODULE_PATH).href);
const bytes = new Uint8ClampedArray(Buffer.from(rgba, 'base64'));
if (bytes.length !== width * height * 4) throw new Error('INVALID_LAB_IMAGE');
const result = jsQR(bytes, width, height);
process.stdout.write(JSON.stringify({data: result?.data ?? null}));
