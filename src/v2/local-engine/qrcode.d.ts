declare module 'qrcode' {
  export type QrMatrix = {size: number; get(row: number, column: number): boolean};
  export type QrCode = {modules: QrMatrix};
  export function create(value: string, options?: {errorCorrectionLevel?: 'L' | 'M' | 'Q' | 'H'}): QrCode;
  const value: {create: typeof create};
  export default value;
}
