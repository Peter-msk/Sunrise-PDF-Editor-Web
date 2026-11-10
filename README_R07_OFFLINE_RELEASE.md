# Sunrise PDF Editor(web) R07 — Terser-free source-preserving production build

## Purpose

R07 removes the `terser@5.51.2` development dependency and changes the default `npm run build` into a **real production release** which operates solely on Node 22 built-ins and the previously pinned, bundled `vendor/pdfstudio@0.4.0` and `vendor/node-forge@1.4.1` assets. This is **not** a renamed preview build.

The `--preview-unminified` path remains explicitly non-deployable. Production builds preserve JavaScript source bytes apart from normalized newlines and their existing trailing newline, compile classic scripts with `vm.Script` without executing them, reject unsafe `</script>` tokens before embedding the editor's inline script, and check SHA-256 vendor provenance. A production build writes `dist/SUNRISE_RELEASE_MANIFEST.json` with hashes for all 45 output assets. It leaves `dist/SUNRISE_BUILD_INCOMPLETE.json` until the end; the production gate refuses any stale preview marker, incomplete build, or changed production file.

## Commands (run from project root)

```
node --version
npm run release:r06:preflight
npm test
npm run build
npm run release:r07:ready
```

Do **not** run `npm ci` solely to generate this release. The embedded vendors are verified directly. Production build output does not require Terser or npm package downloads. The R07 full source release archive includes the original `DroidSansFallback.ttf` and PDF.js standard fonts, preserved at the paths expected by the release gate.

## Browser verification results and limitations

R07 was tested inside real headless Chromium (PDF.js 5.6.205, packaged JS assets). A three-page PDF was converted to a valid PNG ZIP; PDF comparison produced a valid ZIP containing `comparison_report.json`, CSV and a changed-page image (2 equal pages and 1 different); forced download failure was shown in UI; cancel/Escape reopened without stale download buttons. No uncaught JavaScript errors were observed. Because this environment administratively blocks all local HTTP/file/data navigations, the browser test assembled the same HTML/assets into an `about:blank` document and loaded the PDF.js main/worker code through Blob URLs. This establishes functional correctness in Chromium but **does not prove** HTTP-origin navigation, production CSP, Cloudflare Worker backend, admin authentication, device compatibility, or production site acceptance.

## Cloudflare manual deployment (without GitHub Actions)

`wrangler.toml` is already configured for the existing `sunrise-pdf-editor` Worker, `src/worker.mjs`, `dist/` static assets, existing D1 binding and version metadata. Do not change D1 binding, execute migrations, rotate secrets, or enable GitHub Actions.

After confirming the local full source matches the intended GitHub release commit and that the real site acceptance tests pass on a staging URL or authenticated release environment, use existing authenticated Wrangler CLI:

```
wrangler deploy --config wrangler.toml
```

Then verify the new Worker deployment ID and 100% traffic, the real HTTPS site's PDF conversions, ZIP download, public homepage and authenticated admin panel; keep the prior deployment ID for immediate rollback. The archive's build passing alone is not proof of live deployment. Do not publish without validating the GitHub/Cloudflare permissions and live acceptance tests.

## File differences vs R06

* `scripts/build-release.cjs`: source-preserving production builder, syntax safety, hash manifest and fail-closed markers.
* `scripts/r06-release-preflight.cjs`: drop Terser check; retain original-font validation, verify post-build manifest hashes and markers.
* `tests/r36-distribution-integrity.cjs` and `tests/build-line-endings.cjs`: validate real offline production output and hash manifest.
* `tests/r07-no-terser-release.cjs`: new release, tamper, preview and failed-build regressions.
* `package.json`, `package-lock.json`: remove Terser and its dead lock dependencies; retain original vendor package versions.
* `scripts/development-status.cjs`, `scripts/check-release-ci-gate.cjs`: update release status terminology.

GitHub Actions remain paused; they are not needed for the local build or this distribution.
