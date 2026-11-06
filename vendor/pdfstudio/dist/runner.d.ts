import type { QpdfModule } from './wasm/qpdf.js';
import type { PdfInput, PdfToolkitOptions } from './types.js';
export interface RunResult {
    exitCode: number;
    /** Raw stdout bytes — qpdf writes binary data here for some commands. */
    stdout: Uint8Array;
    /** stdout decoded as UTF-8 text. */
    stdoutText: string;
    /** stderr decoded as UTF-8 text. */
    stderr: string;
}
export interface JobContext {
    dir: string;
    inputPaths: string[];
    exec: (args: string[]) => RunResult;
    fs: QpdfModule['FS'];
}
/**
 * Runs qpdf jobs. The wasm binary is fetched and compiled once; every job
 * then gets its own fresh instance (instantiating a precompiled
 * `WebAssembly.Module` costs ~1 ms). Fresh instances matter for
 * correctness, not just isolation: qpdf keeps global state across
 * `callMain` calls — e.g. its logger refuses to redirect stdout once
 * stdout has been used — so a long-lived instance eventually breaks.
 * They also make jobs safely concurrent.
 *
 * stdout/stderr are captured at the byte level via FS.init so that
 * commands emitting binary output (e.g. --show-attachment) round-trip
 * losslessly.
 */
export declare class QpdfRunner {
    private compiled;
    private createModule;
    private constructor();
    static create(options?: PdfToolkitOptions): Promise<QpdfRunner>;
    /**
     * Run one or more qpdf invocations against a fresh instance, with
     * `inputs` staged as numbered files in a MEMFS working directory.
     */
    run<T>(inputs: PdfInput[], job: (ctx: JobContext) => T | Promise<T>): Promise<T>;
}
export declare function toBytes(input: PdfInput): Promise<Uint8Array>;
