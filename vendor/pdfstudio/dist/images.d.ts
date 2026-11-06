import type { ImagesToPdfOptions, PdfInput } from './types.js';
/**
 * Build a PDF from JPEG images, one page per image, entirely in
 * TypeScript — no wasm involved. JPEG data is embedded verbatim
 * (DCTDecode), so there is no recompression or quality loss.
 *
 * Only JPEG input is supported; convert other formats to JPEG first
 * (e.g. via canvas) or open an issue.
 */
export declare function imagesToPdf(images: ReadonlyArray<PdfInput>, options?: ImagesToPdfOptions): Promise<Uint8Array>;
