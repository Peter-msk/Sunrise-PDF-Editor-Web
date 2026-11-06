import type { AddAttachmentOptions, AttachmentInfo, AttachmentRef, ChangePasswordOptions, CollateOptions, CompressOptions, DeletePagesOptions, ExtractPagesOptions, FlattenOptions, LockOptions, MergeSource, PasswordOption, PdfInfo, PdfInput, PdfToolkitOptions, RotateOptions, SplitOptions, UnlockOptions, WatermarkOptions } from './types.js';
export { PdfError, PdfPasswordError } from './errors.js';
export { imagesToPdf } from './images.js';
export type * from './types.js';
/**
 * A PDF toolkit backed by qpdf compiled to WebAssembly. All operations run
 * locally (browser, worker, or Node) — documents never leave the device.
 *
 * Create one with {@link createPdfToolkit} and reuse it; instantiation loads
 * and compiles the wasm binary once.
 */
export declare class PdfToolkit {
    private runner;
    private constructor();
    /** @internal — use {@link createPdfToolkit}. */
    static create(options?: PdfToolkitOptions): Promise<PdfToolkit>;
    /**
     * Decrypt an encrypted PDF, producing a copy with no password and no
     * usage restrictions.
     */
    unlock(pdf: PdfInput, options: UnlockOptions): Promise<Uint8Array>;
    /**
     * Alias of {@link unlock}: removes the password and all restrictions.
     */
    removePassword(pdf: PdfInput, options: UnlockOptions): Promise<Uint8Array>;
    /**
     * Encrypt a PDF with a password (AES-256 by default) and optional
     * usage restrictions.
     */
    lock(pdf: PdfInput, options: LockOptions): Promise<Uint8Array>;
    /**
     * Change the password of an encrypted PDF (decrypts with the current
     * password and re-encrypts with the new one in a single pass).
     */
    changePassword(pdf: PdfInput, options: ChangePasswordOptions): Promise<Uint8Array>;
    /**
     * Merge multiple PDFs (or page selections from them) into one document,
     * in the order given.
     */
    merge(sources: ReadonlyArray<PdfInput | MergeSource>): Promise<Uint8Array>;
    /**
     * Split a PDF into multiple documents of `pagesPerFile` pages each
     * (default 1 — one document per page). Returns the parts in order.
     */
    split(pdf: PdfInput, options?: SplitOptions): Promise<Uint8Array[]>;
    /**
     * Extract a page selection into a new document.
     */
    extractPages(pdf: PdfInput, options: ExtractPagesOptions): Promise<Uint8Array>;
    /**
     * Rotate pages. Relative to the current rotation by default; pass
     * `absolute: true` to set the exact rotation instead.
     */
    rotate(pdf: PdfInput, options: RotateOptions): Promise<Uint8Array>;
    /** Number of pages in the document. */
    pageCount(pdf: PdfInput, options?: PasswordOption): Promise<number>;
    /** Whether the document is encrypted (locked). */
    isEncrypted(pdf: PdfInput): Promise<boolean>;
    /**
     * Whether opening the document requires a password. `false` for
     * unencrypted files and for files encrypted with an empty user password.
     */
    requiresPassword(pdf: PdfInput): Promise<boolean>;
    /**
     * Shrink a PDF by recompressing streams and packing objects into
     * object streams. Lossless — image data is not resampled.
     */
    compress(pdf: PdfInput, options?: CompressOptions): Promise<Uint8Array>;
    /**
     * Linearize for "fast web view": browsers can render the first page
     * while the rest of the file is still downloading.
     */
    linearize(pdf: PdfInput, options?: PasswordOption): Promise<Uint8Array>;
    /**
     * Rewrite a damaged PDF. qpdf reconstructs the cross-reference table
     * and repairs recoverable structural problems; unrecoverable files
     * reject with `PdfError`.
     */
    repair(pdf: PdfInput, options?: PasswordOption): Promise<Uint8Array>;
    /**
     * Stamp pages of one PDF onto another — watermarks, letterheads,
     * "CONFIDENTIAL" overlays. By default stamp page N goes onto document
     * page N until the stamp runs out; pass `repeat` to tile stamp pages
     * across the rest (e.g. `repeat: 1` for a single-page watermark).
     */
    watermark(pdf: PdfInput, stamp: PdfInput, options?: WatermarkOptions): Promise<Uint8Array>;
    /**
     * Remove a page selection, keeping everything else.
     */
    deletePages(pdf: PdfInput, options: DeletePagesOptions): Promise<Uint8Array>;
    /** Reverse the page order. */
    reversePages(pdf: PdfInput, options?: PasswordOption): Promise<Uint8Array>;
    /**
     * Interleave pages from multiple documents — page 1 of each, then
     * page 2 of each, and so on (or groups of `groupSize` pages). Useful
     * for combining separately scanned fronts and backs.
     */
    collate(sources: ReadonlyArray<PdfInput | MergeSource>, options?: CollateOptions): Promise<Uint8Array>;
    /**
     * Flatten annotations and form fields into the page content, freezing
     * their appearance — useful before printing, splitting, or sharing.
     */
    flatten(pdf: PdfInput, options?: FlattenOptions): Promise<Uint8Array>;
    /** Attach a file to the PDF (embedded-files table). */
    addAttachment(pdf: PdfInput, options: AddAttachmentOptions): Promise<Uint8Array>;
    /** Remove an attachment by name. */
    removeAttachment(pdf: PdfInput, options: AttachmentRef): Promise<Uint8Array>;
    /** Extract an attachment's content. */
    getAttachment(pdf: PdfInput, options: AttachmentRef): Promise<Uint8Array>;
    /** List the PDF's attachments. */
    listAttachments(pdf: PdfInput, options?: PasswordOption): Promise<AttachmentInfo[]>;
    /**
     * Inspect a document: PDF version, page count, encryption details
     * (scheme, matched passwords, permissions), and attachments.
     */
    getInfo(pdf: PdfInput, options?: PasswordOption): Promise<PdfInfo>;
    /**
     * Escape hatch: run qpdf with arbitrary CLI arguments. Input documents
     * are staged as `in0.pdf`, `in1.pdf`, … in the working directory; write
     * your output to `out.pdf`. Placeholders `$in0`, `$in1`, …, `$out` in
     * `args` are replaced with the real paths.
     */
    raw(inputs: PdfInput[], args: string[]): Promise<Uint8Array>;
    /** Run a single-input → single-output qpdf transform. */
    private transform;
}
/**
 * Load the qpdf WebAssembly module and return a ready-to-use toolkit.
 * Loads ~2 MB of wasm on first call; reuse the returned instance.
 */
export declare function createPdfToolkit(options?: PdfToolkitOptions): Promise<PdfToolkit>;
