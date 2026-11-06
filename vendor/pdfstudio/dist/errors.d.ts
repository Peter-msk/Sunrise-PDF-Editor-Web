/** Base error for all failed PDF operations. */
export declare class PdfError extends Error {
    /** qpdf process exit code (2 = error). */
    readonly exitCode: number;
    /** Raw qpdf stderr output. */
    readonly stderr: string;
    constructor(message: string, exitCode: number, stderr: string);
}
/** Thrown when a supplied password is wrong or a required password is missing. */
export declare class PdfPasswordError extends PdfError {
    constructor(message: string, exitCode: number, stderr: string);
}
