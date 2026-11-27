# Independent native-unit verification

These scripts compare the actual Java MegaMek/MegaMekLab verifiers with MekBay's production parser, construction validator and calculators. They do not copy validation rules into a second implementation.

**Core 2026 and Total Warfare are distinct CBT rulesets.** Java's native construction/calculation output is not a Core 2026 oracle. MekBay's BV is exported with both explicit selectors; only its `total-warfare` result is compared with Java. MekBay's construction validator currently has no ruleset selector. Assets rules are excluded.

`inCoreCatalog` means membership in MekBay's packaged stock-unit catalog, established by UUID **and exact source bytes**. It does not mean the Core 2026 ruleset.

## Run

From the MekBay directory, freeze a new corpus. The output directory must not already exist:

```powershell
node --import tsx scripts/prepare-unit-verification-corpus.ts --output ../tmp/native-parity-audit-20260910/corpus
```

The snapshot includes every on-disk MTF/BLK, including unsupported legacy files. It freezes the native verifier options, native sourcebook files, required native milestone/logging configuration, and MekBay equipment/quirk/sourcebook catalogs. Supply `--official-units <real OfficialUnitList.txt>` if available; never use a test mock to fill that gap. The missing-reference state is reported explicitly.

From the MegaMekLab directory, run Java against the frozen working directory:

```powershell
.\gradlew.bat :megameklab:exportUnitValidation -PvalidationRoot=C:/Projects/megamek/tmp/native-parity-audit-20260910/corpus/data/mekfiles -PvalidationManifest=C:/Projects/megamek/tmp/native-parity-audit-20260910/corpus/manifest.jsonl -PvalidationOutput=C:/Projects/megamek/tmp/native-parity-audit-20260910/native-validation.jsonl -PnativeAuditWorkingDir=C:/Projects/megamek/tmp/native-parity-audit-20260910/corpus --console=plain
```

Run shared Gradle builds sequentially: the included MegaMek build and MegaMekLab share intermediate JARs. Native sourcebooks are resolved relative to the process working directory, so the working-directory argument is part of the input contract.

Back in MekBay:

```powershell
node --import tsx scripts/export-unit-verification.ts --corpus ../tmp/native-parity-audit-20260910/corpus --output ../tmp/native-parity-audit-20260910/mekbay-final.jsonl
node --import tsx scripts/compare-unit-verification.ts --corpus ../tmp/native-parity-audit-20260910/corpus --native ../tmp/native-parity-audit-20260910/native-validation.jsonl --mekbay ../tmp/native-parity-audit-20260910/mekbay-final.jsonl --output ../tmp/native-parity-audit-20260910/comparison.jsonl
```

The comparator requires complete exports in manifest order and rejects missing, duplicated/reordered, changed or extra rows. It verifies reference sidecars against the frozen corpus. `--limit` on the MekBay exporter is for smoke testing; a limited export cannot pass a full-corpus comparison.

## Results and interpretation

- `manifest.jsonl` identifies every native file by relative path, SHA-256, byte length and declared UUID. Paths are the join key; UUIDs may be absent in legacy files.
- Java JSONL preserves both native factory selections, options, `correctEntity` booleans, raw messages, MML `validateUnit` messages, bypass flags, parse failures and failed equipment. Unsupported MM handheld verification is distinct from MML's supported handheld verifier.
- MekBay JSONL preserves production load diagnostics, `validateConstruction` messages, separate TW/Core BV breakdowns, mass/cost breakdowns, and ordered equipment/critical/bay graphs.
- Calculations fail independently. Exceptions, nulls, unsupported fields and nonfinite numbers never become numeric matches. Cost with ammunition and native printed cost without ammunition have separate fields.
- The native `.references.json` and MekBay `.provenance.json` sidecars identify reference bytes and implementation provenance. Preserve sidecars with their JSONL files.
- `comparison.jsonl` retains every unit's result, diagnostics and differences. Its `.summary.json` aggregates catalog membership, family, verifier outcomes, load completeness and each numeric/graph check.
- Equal validity booleans do not prove equal rule coverage. Native validation may bypass failures for design exceptions; missing `OfficialUnitList.txt` limits canonical-status evidence.
- Equipment-composition differences are review signals: native material/CASE mounts, generated one-shot ammo and synthetic bay controllers can intentionally differ from MekBay's representation. Critical equipment, raw systems/armoring and MGA membership have separate ordered checks.
- Numeric/graph parity does not prove visible sheet coverage. Final print composition, runtime binding, print options, ruleset, supplemental pages and visible SVG content need their own audit. Historical SVG fixtures without matching provenance are not fresh references.

No mismatch allowlist silently turns discrepancies into matches. Evaluate source conventions, native defects, rounding, unsupported mechanics and Core/TW differences before changing production rules.

## Tool regression checks

```powershell
.\node_modules\.bin\tsc.cmd -p scripts/tsconfig.unit-verification.json
node --import tsx --test scripts/unit-verification.test.ts
```

Native focused tests are `megameklab.util.UnitValidationExporterTest`; the asymmetric superheavy rear-equipment regression is in MegaMek's `BLKFileTest`.
