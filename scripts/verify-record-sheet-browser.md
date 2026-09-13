# Record-sheet browser audit

`verify-record-sheet-browser.ts` is a browser entry point for executable information-coverage audits. Bundle it with esbuild, load the bundle in a browser with MekBay's public assets mounted at `/`, then call:

1. `sheetAuditInitialize(equipmentJson, quirksJson, sourcebooksJson)` with a frozen dependency set.
2. `sheetAuditClassifyBatch([{text, file}])` to parse native bytes and inventory actual layout selection without generating sheets.
3. `sheetAuditGenerate(text, file, ruleset)` for each representative and each of `total-warfare` and `core-2026`.
4. `sheetAuditReference(svgText)` for each freshly generated MegaMekLab SVG page.

Generation uses the production layout, runtime projection, binder and print option code. It retains raw generation, bound screen and composed print views separately. Supply only detailed unit files; Battlefield Support Assets are outside this audit. The scenario is pristine, with no force/C3 adjustment, reference tables enabled, fluff hidden and pilot values omitted. These deliberate options must accompany any comparison result.

Results include modeled facts, actual rendered text-node rectangles, ancestor visibility, total and visible pip counts, group text, geometry counts, diagnostics and SVG pages. They are evidence to inspect, not a semantic equality verdict. Outlined text, clipping contents, overlap and contrast need visual review. Aggregate pip counts do not establish location-by-location correctness. A missing literal token can be formatting, grouping, a ruleset difference or a genuine missing fact.

The harness calls generation, projection and binding directly, so it does not exercise the viewer's member-owned cache or page limit. Source-service/cache regressions separately verify admission-specific ruleset propagation. `CBTForceMember` currently retains at most two pages; every selected design in the dated audit emitted at most two. An overflowing design that generates more pages needs a separate viewer integration check even though this harness retains its full generated output.

The dated audit's environment-specific runner is `tmp/native-parity-audit-20260910/run-sheet-audit.cjs` at the shared project root. It freezes hashes, uses headless Edge, emits SVG/JSON/representative PNGs and accepts `--all-inventory=true`, `--limit=50`, `--output=sheets-fixed`, `--reference-root=<fresh-export-directory>`, `--reference-provenance=fresh-current-source`, and `--references-only=true`. It also writes argument files for the native `SVGMassPrinter` runner. Java builds/exports must be serialized with other native jobs.

Example from the shared project root:

```powershell
node tmp/native-parity-audit-20260910/run-sheet-audit.cjs --output=sheets-fixed --screenshots=true --reference-root=tmp/native-parity-audit-20260910/sheets --reference-provenance=fresh-current-source
```

Fresh-reference provenance requires identical frozen native bytes, the current compiled MM/MML sources, matching staged templates/fonts/sourcebooks, explicit ruleset/options and recorded output hashes. Historical fixture SVGs are useful triage inputs but cannot prove current values.
