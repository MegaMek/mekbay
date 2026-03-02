# Plan: BattleTech Construction Rules in TypeScript — Entity as Source of Truth

## Vision

Make `BaseEntity` and its subclasses (starting with `MekEntity`) the
**single source of truth** for all BattleTech construction rules and derived
calculations: movement, heat, armor, BV, C-Bill cost, damage output, etc.

Today these classes are **drafts** — they parse MTF/BLK files and write them
back (roundtrip fidelity), but all computed properties are stubs or
placeholders.  The goal is to progressively replace every placeholder with a
correct, rule-compliant implementation, validated against the Java MegaMek
codebase and the existing `units.json` output.

**Scope (Phase 1):** `MekEntity` subtypes (Biped, Quad, Tripod, LAM,
QuadVee).  Other entity types follow the same pattern in later phases.

### Guiding Principles

1. **Standard rules only.** The MegaMek Java code is littered with `if`
   branches for "playtest" / unofficial / experimental rule options.  We
   **ignore all playtest rules** and implement only the standard published
   rules (TechManual, Total Warfare).  This keeps the codebase dramatically
   simpler.

2. **DRY / KISS / modularity.**  The existing entity hierarchy has
   duplicated placeholder code across subclasses.  As we implement real
   game rules we should actively:
   - Extract shared logic into **common base class methods** on
     `BaseEntity` or `MekEntity`.
   - Use **TypeScript mixins** for cross-cutting capabilities that span
     unrelated entity types (e.g. heat-tracking is shared by Meks and
     Aero but not Infantry).
   - Keep each method / computed small and single-purpose.
   - Prefer composition (utility classes imported by the entity) over
     deep inheritance for complex subsystems like BV calculation.

   The code will later be maintained by humans — readability and clear
   separation of concerns are first-class goals.

3. **BV & Alpha Strike are external calculators.**  Due to the sheer size
   and complexity of BV2 calculation (~500+ lines of rules logic, with a
   3-class hierarchy in Java), the BV calculator lives as a **separate
   utility class** imported by the entity — not inlined into the entity
   class.  The same pattern applies to the Alpha Strike converter
   (deferred to the very end).  Both produce a **CalculationReport** for
   auditability.

4. **CalculationReport system.**  Both the BV calculator and (later) the
   Alpha Strike converter produce a structured line-by-line report that
   mirrors MegaMek's `CalculationReport` format.  This report can be:
   - Displayed in the UI (HTML or component rendering)
   - Saved to a plain-text file
   - Compared side-by-side against MegaMek's own report output for
     validation

   The report follows MegaMek's 3-column layout:
   `Label | Calculation | Result`, with headers, sub-headers, result
   lines (with separator dashes), and tentative sections that can be
   discarded if empty.

---

## Current State

### What works today
- MTF / BLK parsing → entity signals populated
- MTF / BLK writing → roundtrip fidelity
- Basic crit-slot grid derivation for Meks
- Armor / structure value lookups from tables
- Basic validation (crit overflow, engine rating cross-check)

### What is placeholder / incomplete
- `runMP`, `jumpMP` — naive formulas, no MASC / TSM / Supercharger / Partial Wing
- `heatSinkCount` — counts equipment but doesn't compute dissipation
- No heat generation calculation
- No BV calculation (on any entity type)
- No C-Bill cost calculation
- No sustained DPT calculation
- No weapon damage / range helpers on the entity
- No component list builder (the `UnitComponent[]` export format)
- No subtype / weight class / features / quirks derivation
- No C3 detection
- No Alpha Strike conversion

---

## Reference Material

| Resource | Path | Role |
|----------|------|------|
| `units.json` | `svgexport/units.json` | Java-generated reference output — validation oracle |
| Unit files | `svgexport/unitfiles/**/*.mtf` / `*.blk` | Parsed by `parseEntity()` |
| Equipment DB | `svgexport/equipment2.json` / `scripts/fixtures/equipment2.json` | Shared equipment definitions |
| MegaMek Java | `megamek/megamek/src/megamek/common/` | Reference implementation for all rules |

### Key Java files for Mek rules

| Area | Java file(s) | Key methods |
|------|-------------|-------------|
| Movement | `units/Mek.java` | `getWalkMP()`, `getRunMP()`, `getJumpMP()`, `getSprintMP()` |
| MP Boosters (MASC/SC) | `units/Mek.java`, `MPBoosters.java` | `getArmedMPBoosters()`, `calculateRunMP()` |
| Heat capacity | `units/Mek.java` | `getHeatCapacity()`, `getActiveSinks()` |
| Heat generation | `units/Entity.java` | `getRunHeat()`, `getJumpHeat()` + weapon heat |
| BV (base class) | `battleValue/BVCalculator.java` | `processDefensiveValue()`, `processOffensiveValue()`, `offensiveSpeedFactor()` |
| BV (heat-aware) | `battleValue/HeatTrackingBVCalculator.java` | `processWeapons()` (heat sorting), `weaponHeat()` |
| BV (Mek) | `battleValue/MekBVCalculator.java` | `processStructure()`, `processExplosiveEquipment()`, `heatEfficiency()`, `processWeight()` |
| Cost | `units/Mek.java` | `getCost()` |
| Engine | `Engine.java` | `getBVMultiplier()`, weight tables |
| Report system | `calculationReport/CalculationReport.java` | `addLine()`, `addHeader()`, `addResultLine()`, `TextCalculationReport` |

## Architecture

### Entity as Source of Truth (most properties)

Most computed properties live directly on the entity class hierarchy as
Angular `computed()` signals:

```
BaseEntity                          ← all entities
  ├─ movement (walk/run/jump/umu)
  ├─ armor totals & percentages
  ├─ structure totals
  ├─ heat generation & dissipation
  ├─ C-Bill cost
  ├─ weight class
  ├─ subtype string
  ├─ C3 system detection
  ├─ features / quirks
  └─ tech rating / rules level

MekEntity extends BaseEntity        ← Mek-specific overrides
  ├─ runMP override (MASC/TSM)
  ├─ jumpMP override (partial wing, improved JJ)
  ├─ heatCapacity (engine-integrated + external, double/compact/radical)
  ├─ heatGeneration (weapon heat + stealth armor)
  ├─ criticalSlotGrid
  ├─ gyro / cockpit / myomer type
  └─ cost override (Mek-specific cost formula)
```

The entity already has equipment via `entity.equipment()`.  Derived
metadata views like `UnitComponent[]` (components) and sustained DPT are
**not** on the entity — they live in the external `UnitMetadataBuilder`
utility (see below).

All properties are Angular `computed()` signals that derive from other
signals.  The entity is always consistent — change a signal, and every
downstream computed updates automatically.

### External Utilities (metadata builder, BV, Alpha Strike)

Several concerns are **too large, too specialized, or too export-oriented**
to live on the entity itself.  They are implemented as external utility
classes that receive an entity (or array of entities) and produce output.

#### UnitMetadataBuilder

The entity already stores all equipment via `entity.equipment()`.  Adding
a second view of the same data as `UnitComponent[]` on the entity would be
clutter — the component list is a **metadata export format**, not a game
mechanic.  Similarly, sustained DPT is a simulation over weapon/heat/ammo
data the entity already exposes.

The `UnitMetadataBuilder` reads entity signals and produces the `Unit`
object (or an array of `Unit` objects):

```
src/app/utils/
  unit-metadata-builder.ts           ← entity → Unit (single or batch)
  component-builder.ts               ← entity → UnitComponent[]
  dpt-calculator.ts                  ← entity → sustained DPT number
```

```ts
// Usage:
const builder = new UnitMetadataBuilder(equipmentDb);
const unit: Unit = builder.build(entity);           // single
const units: Unit[] = builder.buildAll(entities);   // batch
```

The builder reads entity signals for identity, movement, heat, armor, etc.,
then delegates to `ComponentBuilder` for the `comp` array and
`DPTCalculator` for the `dpt` value.  It also calls `entity.battleValue()`
(which in turn delegates to the external BV calculator).

#### BV Calculator

Due to its size and complexity, **BV calculation** is implemented as an
**external calculator class hierarchy** that the entity delegates to.  This
follows MegaMek's own pattern where `BVCalculator` / `MekBVCalculator` are
separate from `Entity` / `Mek`.

```
src/app/utils/
  calculation-report.ts              ← CalculationReport interface + TextCalculationReport
  bv/
    bv-calculator.ts                 ← base BV2 calculator (takes BaseEntity)
    heat-tracking-bv-calculator.ts   ← adds heat-sorted weapon processing
    mek-bv-calculator.ts             ← Mek-specific BV (structure, explosive, heat eff.)
```

The entity exposes BV via a thin wrapper:
```ts
// On BaseEntity:
battleValue = computed(() => {
  const calc = this.createBVCalculator();
  return calc.calculate();
});

bvReport(): CalculationReport {
  const calc = this.createBVCalculator();
  const report = new TextCalculationReport();
  calc.calculate(report);
  return report;
}

// On MekEntity:
protected createBVCalculator() {
  return new MekBVCalculator(this);
}
```

This keeps the entity API simple (`entity.battleValue()`,
`entity.bvReport()`) while keeping the 500+ lines of BV logic in
dedicated, testable, maintainable files.

### CalculationReport System

Mirrors MegaMek's `CalculationReport` interface.  Every line has 3 columns:

| Column | Purpose | Example |
|--------|---------|--------|
| `label` | What is being calculated | `"Internal Structure:"` |
| `calculation` | The formula or breakdown | `"+ 52 x 1.5"` |
| `result` | Right-aligned numeric result | `"= 78.0"` |

Line types:
- **HEADER** — bold title with dashed underline (e.g. `"Battle Value Calculation for Atlas AS7-D"`)
- **SUBHEADER** — section divider (e.g. `"Defensive Battle Rating:"`)
- **LINE** — standard 3-column data line
- **RESULT_LINE** — like LINE but with a horizontal dash separator above the result
- **EMPTY** — blank separator

Additional features:
- **Tentative sections** — `startTentativeSection()` / `endTentativeSection()` /
  `discardTentativeSection()`.  Used for conditional blocks like "Explosive
  Equipment" — only included in the report if the unit actually has any.
- **`toString()`** — renders to monospace plain text with dynamic column alignment.
- **`toHtml()`** — renders to an HTML table for UI display.

Example text output:
```
Battle Value Calculation for Atlas AS7-D
----------------------------------------

   Effective MP:             R: 3, J: 0, U: 0

Defensive Battle Rating:
   Armor:                    + 304 x 2.5                              = 760.0
   Internal Structure:       + 52 x 1.5                               = 838.0
   TMMs:                     1 (R), 0 (J), 0 (U)
   Defensive Factor:         838.0 x 1.1                              = 921.8

Offensive Battle Rating:
   - AC/20                   237 x 1.0 (Heat: 0)                      = 237.0
   - Medium Laser            46 x 1.0 (Heat: 3.0)                     = 329.0
   Weight:                   + 100                                     = 575.0

Battle Value:
   --- Base Unit BV:         921.8 + 575.0, rn                        = 1497
```

The report format is intentionally kept **identical to MegaMek's** so that
outputs can be compared line-by-line during validation.

### Code Organization & Mixins

As entity classes are fleshed out, shared capabilities should be extracted:

```
src/app/models/entity/
  mixins/
    heat-tracking.mixin.ts       ← heat generation/dissipation (Mek, Aero)
    physical-attacks.mixin.ts    ← physical weapon damage formulas
    component-builder.mixin.ts   ← UnitComponent[] construction logic
  common/
    movement.ts                  ← MP calculation helpers (MASC, TSM, booster detection)
    armor-tables.ts              ← armor BV multipliers, structure point tables
    cluster-hits.ts              ← expected cluster hits table
    cost-tables.ts               ← cost multiplier tables
```

Mixins are applied via TypeScript mixin pattern:
```ts
class MekEntity extends HeatTracking(PhysicalAttacks(BaseEntity)) { ... }
```

This avoids duplicating heat logic when we later implement `AeroEntity`,
and avoids deep inheritance chains.

### Extracting `Unit` metadata

A thin **script** (`scripts/generate-unit-metadata.ts`) walks all unit
files, parses each into an entity, then feeds entities to the
`UnitMetadataBuilder` to produce `units.json`:

```ts
const builder = new UnitMetadataBuilder(equipmentDb);
const units: Unit[] = builder.buildAll(entities);
writeFileSync('units.json', JSON.stringify(units));
```

The script has no logic — all intelligence lives in the builder and its
sub-utilities (`ComponentBuilder`, `DPTCalculator`) or on the entity
itself (movement, heat, armor, BV, cost, classification).

---

## What Needs to Change on Each Class

### BaseEntity — new computed signals to add

These are the core computeds that ALL entity types need.  Many are stubs
today; each one needs to be replaced with a real implementation.

| Computed signal | Current state | What needs to happen |
|---|---|---|
| `runMP` | `Math.ceil(walkMP * 1.5)` — placeholder | Correct for base case, but subclasses must override for MASC etc. Keep as-is on BaseEntity. |
| `jumpMP` | Counts jump jet equipment — naive | Needs to account for improved JJ, partial wing, UMU. Subclass override. |
| `totalArmor` | Sums `armorValues` — works | Already correct. |
| `totalMaxArmor` | Computed from structure — works | Already correct. |
| `heatGeneration` | **MISSING** | Sum of all weapon heat from `equipment()`. Account for stealth armor, null-sig, etc. |
| `heatDissipation` | **MISSING** | Count heat sinks × dissipation rate (1 single, 2 double, 1.4 compact). Engine-integrated HS always full rate. |
| `battleValue` | **MISSING** | BV2 — delegates to external `BVCalculator` utility (see Architecture). |
| `cost` | **MISSING** | C-Bill construction cost. |
| `weightClass` | **MISSING** | Trivial lookup: tonnage → Light / Medium / Heavy / Assault. |
| `subtypeString` | **MISSING** | "BattleMek", "Quad BattleMek", "Land-Air BattleMek", etc. |
| `c3System` | **MISSING** | Equipment flag scan → "C3" / "C3i" / "Nova CEWS" / "None". |
| `features` | **MISSING** | List of notable features (cockpit type, gyro type, special systems). |
| `techRating` | **MISSING** | "E/X-X-F-E" — worst availability across all installed equipment. |
| `rulesLevel` | Exists but may be incomplete | Highest rules level across all installed equipment. |

### MekEntity — overrides and Mek-specific computeds

| Computed signal | Current state | What needs to happen |
|---|---|---|
| `heatSinkCount` | Counts HS equipment — works | Already correct. |
| `integralHeatSinkCapacity` | Exists — may need validation | Validate against Java `getHeatCapacity()`: engine-integrated = min(10, engineRating/25). |
| `heatDissipation` (override) | **MISSING** | Must account for: engine-integrated always at full rate, double HS = 2 each, compact = 1.4, partial wing bonus (+3 when jumping), radical HS (+40%). See `Mek.java:getHeatCapacity()` lines 1540–1650. |
| `heatGeneration` (override) | **MISSING** | Weapon heat sum + stealth armor heat (10 per turn) + other equipment heat. |
| `runMP` (override) | **Not overridden** | Needs override in MekEntity: detect MASC (`F_MASC`), TSM (`F_TSM`), Supercharger → modify run calculation. Java: `Mek.java:getRunMP()` lines 980–1030. |
| `jumpMP` (override) | **Not overridden** | Improved JJs count ×1, mechanical JJs, partial wing (+2 in atmosphere for LAMs), UMU count. Java: `Mek.java:getJumpMP()` lines 1030–1120. |
| `criticalSlotGrid` | Exists — works for display | No changes needed for metadata. |
| `createBVCalculator()` | **MISSING** | Returns `new MekBVCalculator(this)`. Subclass hook for the external BV calculator. |

### Current placeholder / incorrect implementations to fix

1. **`BaseEntity.runMP`**: `Math.ceil(walkMP * 1.5)` is correct for base
   Meks without boosters, but the entity hierarchy has no MASC/TSM override.
2. **`BaseEntity.jumpMP`**: Naively counts all jump jet equipment. Does not
   handle improved JJ bonus or partial wing.
3. **`MekEntity.heatSinkCount`**: Counts all HS equipment but may not
   distinguish compact vs. double correctly for capacity.
4. **`MekEntity.integralHeatSinkCapacity`**: Formula needs validation
   against `min(10, engineRating / 25)` — the 10-sink engine integration
   rule.

---

## Field-by-Field Mapping: `Unit` interface → Entity computed

Every field in `units.model.ts:Unit` maps to either a direct entity signal
read or a computed derivation.

### Identity & classification

| `Unit` field | Entity source | Notes |
|---|---|---|
| `name` | `entity.displayName()` | `chassis + " " + model` |
| `chassis` | `entity.chassis()` | Direct signal |
| `model` | `entity.model()` | Direct signal |
| `id` | `entity.mulId()` | MUL ID; -1 if absent |
| `type` | `entity.entityType` | `"Mek"`, `"Tank"`, etc. |
| `subtype` | `entity.subtypeString()` | **New computed** |
| `weightClass` | `entity.weightClass()` | **New computed** — tonnage lookup |
| `year` | `entity.year()` | Direct signal |
| `tons` | `entity.tonnage()` | Direct signal |
| `omni` | `entity.omni() ? 1 : 0` | Direct signal |
| `role` | `entity.role()` | Direct signal |
| `source` | `entity.source()` → split by `,` | Direct signal + format |

### Movement

| `Unit` field | Entity source | Notes |
|---|---|---|
| `walk` | `entity.walkMP()` | Direct signal |
| `run` | `entity.runMP()` | Computed (override for MASC/TSM) |
| `jump` | `entity.jumpMP()` | Computed (override for improved JJ) |
| `umu` | `entity.umuMP()` | **New computed** — count UMU equip |
| `walk2` | `entity.walkMPWithBoosters()` | **New computed** — walk + MASC/TSM |
| `run2` | `entity.runMPWithBoosters()` | **New computed** — run with MASC |
| `jump2` | `entity.jumpMPWithBoosters()` | **New computed** — jump with boosters |
| `moveType` | `entity.chassisConfig` | `"Biped"` / `"Quad"` / `"Tripod"` |
| `su` | `0` for Meks | Hardcoded per entity type |

### Tech & structure

| `Unit` field | Entity source | Notes |
|---|---|---|
| `techBase` | `entity.techBase()` + `entity.mixedTech()` | `"Inner Sphere"` / `"Clan"` / `"Mixed"` |
| `engine` | `entity.engineType()` | Direct signal |
| `engineRating` | `entity.engineRating()` | Direct signal |
| `armorType` | `entity.armorType()` | Direct signal (+ patchwork logic) |
| `structureType` | `entity.structureType()` | Direct signal |
| `armor` | `entity.totalArmor()` | Existing computed |
| `armorPer` | `entity.armorPercentage()` | Existing computed (or trivial) |
| `internal` | `entity.totalStructure()` | Existing computed |
| `techRating` | `entity.techRating()` | **New computed** |
| `level` | `entity.rulesLevel()` | Existing (may need enrichment) |

### Combat

| `Unit` field | Entity source | Notes |
|---|---|---|
| `heat` | `entity.heatGeneration()` | **New computed** |
| `dissipation` | `entity.heatDissipation()` | **New computed** |
| `engineHS` | `0` for Meks | Java convention — engine HS handled from inventory |
| `engineHSType` | `entity.heatSinkTypeName()` | **New computed** |
| `comp` | `UnitMetadataBuilder` → `ComponentBuilder` | External utility — entity already has `equipment()` |
| `dpt` | `UnitMetadataBuilder` → `DPTCalculator` | External utility — simulates sustained fire |
| `bv` | `entity.battleValue()` | Delegates to external `MekBVCalculator` — Phase 6 |
| `cost` | `entity.constructionCost()` | **New computed** — Phase 7 |
| `offSpeedFactor` | `entity.offensiveSpeedFactor()` | Part of BV calculator output — Phase 6 |

### Systems & features

| `Unit` field | Entity source | Notes |
|---|---|---|
| `c3` | `entity.c3System()` | **New computed** — equipment flag scan |
| `quirks` | `entity.quirks()` | Existing signal (format to display names) |
| `features` | `entity.features()` | **New computed** — cockpit, gyro, special |
| `crewSize` | `entity.crewSize()` | **New computed** — cockpit type lookup |
| `fluff` | `entity.fluff()` | Existing signal (map to output format) |

### External / passthrough (not on entity)

| `Unit` field | Strategy |
|---|---|
| `icon` | Read from existing `units.json` (MegaMek tileset) |
| `pv` | Read from existing `units.json` (MUL data) |
| `as` | Read from existing `units.json` (Alpha Strike — deferred to final phase) |
| `sheets` | Read from existing `units.json` (SVG record sheets) |
| `unitFile` | Constructed from file path during generation |

---

## Implementation Phases

### Phase 1: Movement (fix existing + add boosters)

**Goal:** `walkMP`, `runMP`, `jumpMP` produce correct values for all Meks,
including MASC/TSM/Supercharger/improved JJ variants.  Add `umuMP`,
`walkMPWithBoosters`, `runMPWithBoosters`, `jumpMPWithBoosters`.

**Work on `MekEntity`:**
- Override `runMP`: detect `F_MASC` flag in equipment → `ceil(walk * 2)`.
  Detect Supercharger → similar. Java ref: `Mek.java` lines 980–1030.
- Override `jumpMP`: handle improved JJ (same count, just different type),
  partial wing (+2 in atmosphere), UMU counting.
  Java ref: `Mek.java` lines 1030–1120.
- Add `umuMP = computed(() => count UMU in equipment)`.
- Add `walkMPWithBoosters`, `runMPWithBoosters`, `jumpMPWithBoosters` —
  these are the BV-movement variants that include TSM (+1 walk) and MASC.

**Validation:** Compare `walk`, `run`, `jump`, `walk2`, `run2`, `jump2`
against `units.json` for all Mek entries.

### Phase 2: Heat generation & dissipation

**Goal:** `heatGeneration()` and `heatDissipation()` produce correct values.

**Work on `BaseEntity`:**
- Add `heatGeneration = computed(() => sum of weapon.heat for all weapons
  in equipment())`.
- Add `heatDissipation = computed(() => heatSinkCount * dissipationRate)`.
  Base implementation: count equipment with "Heat Sink" type, multiply by 1
  for single or 2 for double.

**Work on `MekEntity`:**
- Override `heatDissipation`: implement full `Mek.java:getHeatCapacity()`
  logic.  Engine-integrated HS always full rate.  Double HS = 2 each.
  Compact HS = 1.4.  Partial wing = +3 jump-mode bonus.  Radical HS kit =
  +40%.  Stealth armor penalty.  Coolant pods.
  Java ref: `Mek.java` lines 1540–1650.
- Override `heatGeneration`: add stealth armor heat (+10), null-sig heat,
  chameleon LPS heat if applicable.
- Add `heatSinkTypeName = computed(...)` — scan equipment for first HS type.

**Key formulas from Java:**
```
engineIntegrated = min(10, floor(engineRating / 25))
externalHS = totalHSCount - engineIntegrated
dissipation = engineIntegrated * dissipationRate + externalHS * dissipationRate
// Double HS: rate = 2, Compact: rate = 1 (but 1.4 for BV), Single: rate = 1
// Partial wing: +3 when jumping
// Radical HS kit: total *= 1.4 (rounded)
```

**Validation:** Compare `heat`, `dissipation` against `units.json`.

### Phase 3: Components & DPT (external utilities)

**Goal:** `ComponentBuilder` produces the `UnitComponent[]` that matches
the `comp` array in `units.json`.  `DPTCalculator` computes sustained DPT.
Neither lives on the entity — the entity already exposes equipment via
`entity.equipment()`; these utilities transform that data into the metadata
export format.

This is the **largest single piece of work**.  Port the logic from
`SVGMassPrinter.Components.parseComponents()` (Java lines ~1200–1700).

**ComponentBuilder** (`src/app/utils/component-builder.ts`):

Takes an entity and returns `UnitComponent[]`.  Iterates `entity.equipment()`
and categorizes each item:

  **Weapons** (category E/M/B/A/P):
  - Read `weapon.ranges` → build range string `"S:3 M:6 L:9"`
  - Read `weapon.damage` → build damage string (handle cluster, variable,
    UAC, RAC, artillery, streak, MML, ATM special cases)
  - Compute `maxDamage` (cluster × expected hits, variable damage max,
    RAC ×6, UAC ×2)
  - Category from weapon ammo type or flags: Energy/Missile/Ballistic/Artillery
  - Aggregate by location + name key (count duplicates)
  - One-shot weapons: append "(OS)" to name

  **Ammo** (category X):
  - Clean up name (remove "Ammo" prefix/suffix, strip " - ", etc.)
  - Aggregate shots by ammo type
  - Location from mount

  **Misc equipment** (category C or S):
  - Structural items (endo steel, ferro-fibrous, etc.) → category S
  - Other misc → category C
  - Skip items that are "invisible" (engine, structure, armor — already
    represented elsewhere)

  **Physical weapons** (category P):
  - Hatchet damage: `ceil(tonnage / 5)`
  - Sword damage: `ceil(tonnage / 10) + 1`
  - Mace damage: `ceil(tonnage / 4)`
  - Claws: `ceil(tonnage / 7)`
  - Talons: computed from leg actuators
  - Lance: `ceil(tonnage / 5)`

The builder handles all entity types through the same interface (it reads
`entity.equipment()` generically).  Entity-type-specific logic (e.g.
physical weapon damage for Meks) is dispatched internally based on
`entity.entityType`.

**Key helper data:**

Expected cluster hits table (for LRM/SRM/ATM/HAG/etc.):
```ts
const EXPECTED_HITS = [
  0, 1, 1.58, 2, 2.63, 3.17, 4, 4.49, 4.98, 5.47,
  6.31, 7.23, 8.14, 8.59, 9.04, 9.5, 10.1, 10.8, 11.42, 12.1, 12.7
];
```

Weapon category mapping:
```ts
if (weapon.hasFlag('F_ENERGY'))           → 'E'
if (weapon.hasFlag('F_MISSILE'))          → 'M'
if (weapon.hasFlag('F_BALLISTIC'))        → 'B'
if (weapon.ammoType === 'Artillery')      → 'A'
if (weapon.hasFlag('F_PHYSICAL'))         → 'P'
```

**Validation:** Compare `comp` arrays against `units.json`.  Use set
comparison (order-insensitive, match by `id` + `loc` key).

### Phase 4: Entity computeds (C3, features, crew) + DPT utility

**Goal:** `c3System()`, `features()`, `crewSize()` on the entity;
`DPTCalculator` as external utility.

**DPTCalculator** (`src/app/utils/dpt-calculator.ts`):

Takes an entity (reads `equipment()`, `heatGeneration()`,
`heatDissipation()`) and the `UnitComponent[]` from `ComponentBuilder`.
Simulates sustained fire over 10 turns.

```ts
export class DPTCalculator {
  calculate(entity: BaseEntity, components: UnitComponent[]): number {
    const heat = entity.heatGeneration();
    const dissipation = entity.heatDissipation();
    const fireFraction = Math.min(1, dissipation / heat);

    let dpt = 0;
    for (const comp of components) {
      if (comp.cat === 'X' || comp.cat === 'S' || comp.cat === 'C') continue;
      let dmg = comp.maxDmg ?? 0;
      // oneshot: 1/10 (or 2/10 for streak oneshot)
      // cluster: use expected hits
      // RAC: ×3.17, UAC: ×1.42
      // ammo depletion over 10 turns
      dpt += dmg * fireFraction * modifier;
    }
    return Math.round(dpt * 10) / 10;
  }
}
```

**C3 — `entity.c3System()`:**
```ts
c3System = computed(() => {
  for (const eq of this.equipment()) {
    if (eq.equipment?.hasFlag('F_C3M'))    return 'C3';
    if (eq.equipment?.hasFlag('F_C3S'))    return 'C3';
    if (eq.equipment?.hasFlag('F_C3I'))    return 'C3i';
    if (eq.equipment?.hasFlag('F_NOVA'))   return 'Nova CEWS';
    // ... etc.
  }
  return 'None';
});
```

**Features — `entity.features()`:**
```ts
features = computed(() => {
  const feats: string[] = [];
  // MekEntity overrides to add cockpit, gyro, myomer names
  return feats;
});
```
MekEntity override adds non-standard cockpit, gyro, full head ejection, etc.

**Crew size — `entity.crewSize()`:**
```ts
crewSize = computed(() => {
  // Standard = 1, Dual = 2, Command Console = 2, Tripod = 2, Superheavy Tripod = 3
  return COCKPIT_CREW_MAP[this.cockpitType()] ?? 1;
});
```

**UnitMetadataBuilder** (`src/app/utils/unit-metadata-builder.ts`):

Also wired up in this phase.  Orchestrates everything:

```ts
export class UnitMetadataBuilder {
  constructor(private equipmentDb: EquipmentMap) {}

  build(entity: BaseEntity): Unit {
    const components = new ComponentBuilder().build(entity);
    const dpt = new DPTCalculator().calculate(entity, components);
    return {
      name:        entity.displayName(),
      chassis:     entity.chassis(),
      model:       entity.model(),
      // ... direct reads of entity signals for identity, movement, heat ...
      comp:        components,
      dpt,
      bv:          entity.battleValue(),
      // ...
    };
  }

  buildAll(entities: BaseEntity[]): Unit[] {
    return entities.map(e => this.build(e));
  }
}
```

**Validation:** Compare `dpt`, `c3`, `features`, `crewSize` vs `units.json`.
Compare `comp` arrays (order-insensitive, match by `id` + `loc` key).

### Phase 5: Classification & tech metadata

**Goal:** `subtypeString()`, `weightClass()`, `techRating()`.

**Subtype — `entity.subtypeString()`:**
Port `SVGMassPrinter.unitTypeAsString()` (Java lines ~870–990).
```ts
// MekEntity override:
subtypeString = computed(() => {
  if (this instanceof LamEntity)      return 'Land-Air BattleMek';
  if (this instanceof TripodMekEntity) return 'Tripod BattleMek';
  if (this instanceof QuadVeeEntity)  return 'QuadVee';
  if (this instanceof QuadMekEntity)  return 'Quad BattleMek';
  // ... industrial checks ...
  let base = 'BattleMek';
  if (this.omni()) base = 'Omni' + base;
  return base;
});
```

**Weight class — `entity.weightClass()`:**
```ts
weightClass = computed(() => {
  const t = this.tonnage();
  if (t <= 35) return 'Light';
  if (t <= 55) return 'Medium';
  if (t <= 75) return 'Heavy';
  return 'Assault';  // 80-100 (or 105-200 for superheavy)
});
```

**Tech rating — `entity.techRating()`:**
Compute worst availability across all installed equipment.
Format: `"E/X-X-F-E"`.

**Validation:** Compare `subtype`, `weightClass`, `techRating` vs `units.json`.

### Phase 6: BV2 calculation — external calculator with report

Port the full BV2 algorithm as **external utility classes** (not inline on
the entity).  This mirrors MegaMek's own `BVCalculator` → `HeatTrackingBVCalculator`
→ `MekBVCalculator` inheritance.

**Step 1: CalculationReport system** (`src/app/utils/calculation-report.ts`)

Port MegaMek's `CalculationReport` interface and `TextCalculationReport`:
```ts
export interface CalculationReport {
  addLine(label: string, calculation?: string, result?: string): this;
  addHeader(text: string): this;
  addSubHeader(text: string): this;
  addResultLine(label: string, calculation?: string, result?: string): this;
  addEmptyLine(): this;
  startTentativeSection(): void;
  endTentativeSection(): void;
  discardTentativeSection(): void;
  toString(): string;    // monospace plain-text output
  toHtml(): string;      // HTML table output
}
```

Implementations:
- `TextCalculationReport` — monospace plain text with dynamic column alignment
  (matches MegaMek's `TextCalculationReport.toString()` format exactly)
- `DummyCalculationReport` — no-op (for when report isn't needed)

The text output must be **identical in layout** to MegaMek's so reports can
be compared side-by-side during validation.

**Step 2: BV calculator hierarchy** (`src/app/utils/bv/`)

```ts
// bv-calculator.ts — base class
export class BVCalculator {
  constructor(protected entity: BaseEntity) {}

  calculate(report?: CalculationReport): number {
    this.bvReport = report ?? new DummyCalculationReport();
    return this.processBaseBV();
  }

  protected processBaseBV(): number {
    this.processPreparation();
    const defensive = this.processDefensiveValue();
    const offensive = this.processOffensiveValue();
    return this.processSummarize(defensive, offensive);
  }

  protected processArmor(): number { ... }
  protected processStructure(): number { ... }
  protected processDefensiveEquipment(): number { ... }
  protected processExplosiveEquipment(): number { ... }
  protected processDefensiveFactor(dbr: number): number { ... }
  protected processWeapons(): number { ... }
  protected processAmmo(): number { ... }
  protected offensiveSpeedFactor(): number { ... }
  // ...
}

// heat-tracking-bv-calculator.ts
export class HeatTrackingBVCalculator extends BVCalculator {
  protected processWeapons(): number { ... }   // heat-sorted weapon processing
  protected weaponHeat(weapon: WeaponEquipment): number { ... }
}

// mek-bv-calculator.ts
export class MekBVCalculator extends HeatTrackingBVCalculator {
  protected processStructure(): number { ... }  // gyro/engine multipliers
  protected processExplosiveEquipment(): number { ... }  // CASE mitigation
  protected heatEfficiency(): number { ... }     // 6 + capacity - move - stealth
  protected processWeight(): number { ... }      // TSM modifier
}
```

**Step 3: Entity integration**

```ts
// BaseEntity:
battleValue = computed(() => this.createBVCalculator().calculate());
bvReport(): CalculationReport {
  const report = new TextCalculationReport();
  this.createBVCalculator().calculate(report);
  return report;
}
protected createBVCalculator(): BVCalculator {
  return new BVCalculator(this);
}

// MekEntity:
protected override createBVCalculator(): BVCalculator {
  return new MekBVCalculator(this);
}
```

Key formulas:
- Offensive speed factor: `Math.pow(1 + ((mp - 5) / 10.0), 1.2)`
- Heat efficiency: `6 + heatCapacity - moveHeat - stealthPenalties`
- Defensive factor: `totalDefensive × defensiveFactorMultiplier(TMMs)`

Key Java refs:
- `BVCalculator.java` lines 60–1200
- `MekBVCalculator.java` lines 60–600
- `HeatTrackingBVCalculator.java` lines 55–280

**Validation:** Compare `entity.battleValue()` against `units.json` `bv`
field.  Also compare `entity.bvReport().toString()` against MegaMek's
report output for selected units to verify calculation steps match.

### Phase 7: Cost calculation

Port `Mek.java:getCost()`.  Lives on the entity as a computed signal
(cost formula is simpler than BV — no need for external class).

### Phase 8: Other entity types

Extend all the above to Aero, Tank, Infantry, BattleArmor, ProtoMek,
DropShip, etc.  Each type has its own:
- Movement rules
- Heat rules (or no heat for some — use mixin selectively)
- Component categorization
- BV calculator subclass
- Cost formula

### Phase 9: Alpha Strike conversion (final phase)

Port `ASConverter` to TypeScript.  **Deferred to the very end** after all
standard construction rules are solid.

The Alpha Strike converter follows the same pattern as BV:
- External utility class: `AlphaStrikeConverter`
- Produces a `CalculationReport` showing how each AS stat was derived
- Report format matches MegaMek's AS conversion report for side-by-side
  comparison
- Computes: PV, damage brackets (S/M/L/E), movement modes, specials, arcs

---

## Validation Strategy

### Core idea: incremental TDD against `units.json`

`units.json` (generated by Java's `SVGMassPrinter`) is the **oracle**.  We
build a comparison script that can run against a single unit, a filtered
subset, or the full corpus — and we grow the set of **checked fields**
incrementally as we implement each property.

This gives us a tight development loop:

```
1. Implement `chassis` + `model` on entity
2. Add "chassis", "model" to the checked-fields list
3. Run script → see if they match for all units
4. Fix mismatches
5. Implement next property (e.g. `name` with clan formatting)
6. Add "name" to checked-fields
7. Run script → validate
8. Repeat for heat, dissipation, components, dpt, bv, ...
```

Each property starts at 0% and we push it toward 100%.  When all
implemented fields pass at >99%, the implementation is considered solid.

### Comparison script: `scripts/compare-unit-output.ts`

```
Usage:
  npx tsx scripts/compare-unit-output.ts                          # all units
  npx tsx scripts/compare-unit-output.ts --type Mek               # only Meks
  npx tsx scripts/compare-unit-output.ts --unit "Atlas AS7-D"     # single unit
  npx tsx scripts/compare-unit-output.ts --unit "King*"           # glob match
  npx tsx scripts/compare-unit-output.ts --fields chassis,model   # check only these
  npx tsx scripts/compare-unit-output.ts --verbose                # show every mismatch detail
```

**Modes:**

| Flag | Effect |
|------|--------|
| `--unit <name\|glob>` | Filter to a single unit or glob pattern |
| `--type <Mek\|Tank\|...>` | Filter by entity type |
| `--fields <comma-list>` | Only check these fields (allows incremental add) |
| `--exclude-fields <comma-list>` | Check all enabled fields except these |
| `--verbose` | Print full mismatch details per unit (default: summary only) |
| `--fail-on-mismatch` | Exit code 1 if any mismatch (for CI) |

**Checked-fields registry:**

The script has a central list of fields that are "enabled" for comparison.
Start with the trivial ones, then grow:

```ts
// Phase 0 — identity (start here)
const CHECKED_FIELDS: FieldCheck[] = [
  { field: 'chassis',  compare: 'exact' },
  { field: 'model',    compare: 'exact' },
];

// Phase 1 — after implementing movement
// Add:
  { field: 'name',     compare: 'exact' },
  { field: 'walk',     compare: 'exact' },
  { field: 'run',      compare: 'exact' },
  { field: 'jump',     compare: 'exact' },

// Phase 2 — after implementing heat
  { field: 'heat',     compare: 'numeric', tolerance: 1 },
  { field: 'dissipation', compare: 'numeric', tolerance: 1 },

// Phase 3 — after implementing components
  { field: 'comp',     compare: 'componentSet' },

// Phase 4 — after DPT
  { field: 'dpt',      compare: 'numeric', tolerance: 0.5 },

// ... and so on for each new property
```

When `--fields` is not passed, the script checks **all enabled fields**.
When `--fields chassis,model` is passed, it checks only those two
(regardless of the registry — useful during development).

**How it works internally:**

```ts
// 1. Load units.json (the oracle)
const oracle = loadUnitsJson();

// 2. Filter entries by --type / --unit
const entries = filterEntries(oracle, { type, unitPattern });

// 3. For each entry:
for (const expected of entries) {
  // a. Find the unit file on disk from expected.unitFile
  // b. Parse it into an entity via parseEntity()
  // c. Feed entity to UnitMetadataBuilder → get Partial<Unit>
  // d. Compare each checked field:
  for (const check of activeChecks) {
    const got = generated[check.field];
    const exp = expected[check.field];
    const match = compareField(check, got, exp);
    if (!match) recordMismatch(expected.name, check.field, exp, got);
  }
}

// 4. Print summary
```

**Output — summary mode (default):**

```
=== Unit Metadata Comparison ===
Filter:   type=Mek
Checked:  chassis, model, name, walk, run, jump
Units:    3,847 matched / 3,847 total

Field match rates:
  chassis:     3847/3847  (100.0%)  ✓
  model:       3847/3847  (100.0%)  ✓
  name:        3845/3847  ( 99.9%)  ← 2 mismatches
  walk:        3847/3847  (100.0%)  ✓
  run:         3845/3847  ( 99.9%)  ← 2 mismatches
  jump:        3847/3847  (100.0%)  ✓

Mismatches (4 total):
  Hollander II BZK-F5 (Custom):
    name:  expected="Hollander II BZK-F5 (Custom)"  got="Hollander II BZK-F5 Custom"
  Marauder MAD-3R (Natasha):
    name:  expected="Marauder MAD-3R (Natasha)"  got="Marauder MAD-3R Natasha"
  Dasher (Fire Moth) Prime:
    run:   expected=12  got=11   (MASC not detected)
  Kit Fox (Uller) C:
    run:   expected=11  got=10
```

**Output — verbose mode (`--verbose`):**

Shows every unit comparison, including passes:

```
  ✓ Atlas AS7-D               chassis=Atlas  model=AS7-D  walk=3  run=5  jump=0
  ✓ Hunchback HBK-4G          chassis=Hunchback  model=HBK-4G  walk=4  run=6  jump=0
  ✗ Dasher (Fire Moth) Prime   run: expected=12  got=11
```

**Output — single unit mode (`--unit "Atlas AS7-D"`):**

Full detailed dump of all checked fields with pass/fail per field:

```
=== Atlas AS7-D ===
  chassis:      "Atlas"              ✓
  model:        "AS7-D"              ✓
  name:         "Atlas AS7-D"        ✓
  year:         2755                 ✓
  tons:         100                  ✓
  walk:         3                    ✓
  run:          5                    ✓
  jump:         0                    ✓
  heat:         23                   ✓
  dissipation:  20                   ✓
  comp:         [14 components]      ✓  (all match)
  dpt:          42.3                 ✓
  bv:           1,897                (skipped — not yet implemented)
```

### Comparison rules

Each field has a comparison type:

| Type | Logic | Used for |
|------|-------|----------|
| `exact` | `===` | chassis, model, name, year, tons, type, subtype, omni, engine, engineRating, moveType, walk, run, jump, umu, c3, armorType, structureType, source, role, weightClass, techBase, crewSize, su |
| `numeric` | `Math.abs(a - b) <= tolerance` | armor (±1), armorPer (±1), internal (±1), heat (±1), dissipation (±1), walk2 (±1), run2 (±1), jump2 (±1), dpt (±0.5) |
| `setCompare` | Order-insensitive, same elements | quirks, features |
| `componentSet` | Match by `id` + `loc` key, order-insensitive, compare counts/damage/range per component | comp |
| `skip` | Not compared (not yet implemented or external-only) | bv, cost, pv, offSpeedFactor, as, icon, sheets, fluff |

The `skip` type transitions to a real comparison type once the property is
implemented.  This is the key mechanism for incremental development: add a
field, change its type from `skip` to `exact`/`numeric`, run the script.

### Workflow example: implementing heat dissipation

```
1.  Open MekEntity, implement heatDissipation() computed
2.  Edit compare-unit-output.ts:
      change { field: 'dissipation', compare: 'skip' }
      to     { field: 'dissipation', compare: 'numeric', tolerance: 1 }
3.  Run:  npx tsx scripts/compare-unit-output.ts --type Mek --fields dissipation
4.  See:  dissipation: 3800/3847 (98.8%) — 47 mismatches
5.  Investigate: --unit "Warhammer WHM-6R" --verbose
6.  Fix: compact heat sink formula was wrong
7.  Run again: dissipation: 3845/3847 (99.9%)
8.  Remaining 2 are radical heatsink edge cases — fix
9.  Run again: dissipation: 3847/3847 (100.0%) ✓
10. Commit, move to next property
```

### Generation script: `scripts/generate-unit-metadata.ts`

Once the comparison script passes at >99% for all implemented fields, this
script replaces the Java `SVGMassPrinter` for producing `units.json`:

1. Walk all unit files in `svgexport/mbunitfiles/`
2. Parse each to entity
3. Feed to `UnitMetadataBuilder` → `Unit` object
4. Merge passthrough fields from existing `units.json` (icon, pv, as, sheets)
5. Write new `units.json`

---

## Key Differences from Java

1. **No MekSummary / MekSummaryCache** — we parse unit files directly.
2. **No `UnitUtil.updateLoadedUnit()`** — parser produces the final state.
3. **Equipment model is pre-built** — `WeaponEquipment`, `AmmoEquipment`,
   `MiscEquipment` classes already expose ranges, damage, flags, ammo type.
4. **Angular signals** — all computeds are reactive `computed()` signals.
   The metadata script just reads them with `entity.property()` syntax.
5. **No `BayWeapon` handling** — Meks don't use weapon bays.  Bay logic is
   only needed for DropShips/WarShips (Phase 8).
6. **Standard rules only** — all playtest / unofficial / experimental rule
   branches in Java are ignored.  This eliminates hundreds of `if` blocks.
7. **BV follows Java's architecture** — `BVCalculator` → `HeatTrackingBVCalculator`
   → `MekBVCalculator` hierarchy is preserved as external utilities, not
   inlined into the entity.  Same for Alpha Strike converter.
8. **CalculationReport** — ported from Java for BV / Alpha Strike audit
   trails.  Text output intentionally matches MegaMek's format.
9. **Mixins for cross-cutting concerns** — heat tracking, physical attacks,
   component building use TypeScript mixins instead of Java's deep
   inheritance + utility class sprawl.

---

## Risk Assessment

| Risk | Impact | Mitigation |
|---|---|---|
| Physical weapon damage formulas differ | Medium | Cross-reference TechManual tables; validate against Java output |
| MASC/TSM movement edge cases | Low | Well-documented in TW; few units affected |
| Equipment flag names mismatch | Medium | Both TS and Java use same `equipment2.json` source |
| Ammo name formatting differences | Low | Cosmetic only; normalize strings before compare |
| Heat includes non-weapon sources | Medium | Stealth, null-sig, chameleon — handle as special cases |
| DPT rounding differences | Low | Accept ±0.5 tolerance |
| BV complexity | High | External calculator with own class hierarchy; validate with report comparison |
| Entity draft quality | High | Validate each computed as it's built; fix parser issues incrementally |
| Playtest rule contamination | Medium | Explicitly ignore all playtest/unofficial branches — standard rules only |
| Code duplication across entity types | Medium | Extract mixins and common modules proactively during implementation |
