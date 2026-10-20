import {describe, expect, it} from 'vitest';
// @ts-expect-error The isolated signing laboratory is plain ESM, exercised here at runtime.
import {firmaecAppearanceText} from '../scripts/v2-synthetic-appearance.mjs';

describe('FirmaEC-compatible visible appearance', () => {
  it('uses the compact verification legend and a safe certificate subject', () => {
    expect(firmaecAppearanceText('PABLO SEBASTIAN MARTINEZ MENDUINO')).toEqual([
      'Validar únicamente en FirmaEC.', 'Firmado electrónicamente por:', 'PABLO SEBASTIAN MARTINEZ MENDUINO',
    ]);
  });
  it('rejects PDF-content controls instead of placing them in the appearance', () => {
    expect(() => firmaecAppearanceText('Ana (firma)')).toThrow('INVALID_SIGNER_NAME');
  });
});
