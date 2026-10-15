# Native record-sheet pipeline review

Review date: 2026-09-06. Architecture, implementation and paired Edge review of
the native sheet pipeline. The comparisons below distinguish corrected defects
from deliberate rule differences and variants without a reference design.

## Architecture decisions

The generator remains a small coordinator: resolve the family, generate its
pages, attach interaction contracts, apply pip materials and optimize SVG.
`layouts/record-sheet-layout-resolver.ts` is the family registry. Concrete
families own composition and coordinates; shared routines supply actual common
drawing contracts rather than choosing unrelated family layouts.

| Owner | Responsibility |
| --- | --- |
| `MekRecordSheetLayout` | Biped, industrial, quad, tripod, QuadVee and LAM compositions, including superheavy variants |
| `CombatVehicleRecordSheetLayout` | Ground combat/support vehicles, VTOL and WiGE, with turret and hull variants |
| `NavalRecordSheetLayout` | Naval, hydrofoil and submarine compositions |
| `ProtoMekRecordSheetLayout` | Biped, quad and glider ProtoMeks |
| `BattleArmorRecordSheetLayout` | Battle Armor squads and trooper rows |
| `ConventionalInfantryRecordSheetLayout` | Platoon data, strength/damage/range tracks, field guns and infantry references |
| `AeroFighterRecordSheetLayout` | Aerospace/conventional fighters and fixed-wing support presentation |
| `SmallCraftRecordSheetLayout` | Small Craft composition and individual-mount inventory |
| `DropShipRecordSheetLayout` / `CapitalShipRecordSheetLayout` | Vessel families using the genuinely shared `LargeAeroRecordSheetLayout` composition and bay/overflow pipeline |
| `HandheldWeaponRecordSheetLayout` | Standard and large compact armor/inventory/ammunition strips |
| `StaticEmplacementRecordSheetLayout` | Buildings: parsed construction data, inventory and a structure map, no paperdoll |

`CompactRecordSheetLayout` handles compact block packing, mastheads, shared
definitions and unique IDs. Full-page physical dimensions and print packing
remain in `record-sheet-layout.ts`. `SvgFrameUtil` continues generating frames;
headerless frames avoid unnecessary heading measurement. No complete reference
sheet template is loaded at runtime.

Buildings have an explicit native design with parsed
construction data, armor/CF and real inventory. MegaMekLab has no building
template. There is no reference
parity claim for these designs, and missing construction values are not invented.

## Artwork, pips and runtime boundaries

- `PaperdollGenerator` ingests editable SVG placeholders and explicit armor/
  structure counts. `MekPaperdollGenerator` adds Mek defaults and the canonical
  biped pip map; it does not own layout coordinates.
- Every Mek has independent front armor, rear armor and structure views. The
  Quad, QuadVee, Tripod and LAM rear artwork is separated without duplicating
  the original leaves. Biped rails cover all relevant locations/views.
- Paperdoll assets retain real location hit regions, labels and fixed artwork.
  Vehicle hull selection covers large support hulls as well as superheavy combat
  hulls. Turret/rotor controls preserve their component and location identities.
- Fixed handheld, Battle Armor and conventional infantry fallback masthead artwork lives
  in `public/images/record-sheet-art/`, loaded through the small shared embedded
  art helper. Infantry and BA mastheads preserve the original reference image
  content rather than approximating it with newly generated paths. When a unit
  has a resolved fluff image, the shared compact masthead region displays it as
  MegaMekLab does. Aero sheets have separate visible artwork regions; the Mek
  center-table replacement preference does not hide those illustrations.
- Options / Classic exposes exactly **Canon**, **Distributed**, **Grouped**,
  stored as `classic`, `distributed`, `rail`. Canon uses the canonical map only
  for biped Meks up to 100 tons. Other units use distribution; Grouped uses
  authored rails and falls back to distribution where rail geometry is absent.
- Fixed infantry strength slots, Battle Armor rows, ammunition lanes and system
  tracks retain their semantic arrangements. Alternative pip distribution is an
  intentional optical exception to reference parity.
- Fancy Pips apply each location's armor/structure material after placement,
  preserving pip counts, positions and interaction IDs. Hardened/reinforced use
  diamonds, sub-BAR-10/composite use dashed circles, and the relevant special
  armor types use pentagons. A construction point remains one runtime pip.
- `RecordSheetDamageHighlights` owns transient fresh damage for normal pip
  tracks, capital grids and infantry slots. The default constant is 3000 ms;
  values at or below zero retain the latest highlight until the next change or
  commit. Expiry leaves pending damage intact. Unchanged redraws retain the
  original timer; unbinding cancels all timers.
- Generated-sheet caches are keyed by the pip preference. Pending results can
  only populate the cache if their generation is still current. Interactive
  viewers and lightweight catalog previews regenerate when the preference
  changes. The final read-only review found no additional concrete defect in
  this controller/cache path.

## Confirmed presentation corrections

These corrections came from saved reference SVGs, current MegaMekLab printing
source and/or the live paired-sheet review, rather than invented sample data.

| Area | Correction and representative evidence |
| --- | --- |
| Mek inventory | Source-order miscellaneous equipment, variable-size cargo names and QuadVee track omission; DemolitionMech WI-DM and Kiso |
| Vehicle inventory | Mixed-tech name suffixes, linked Artemis lines with real component IDs, cargo bays/capacities and physical-equipment damage; Gulltoppr A, Dromedary and Oppie |
| Naval support | Support-size/motive title, sub-5-ton kilogram formatting, `BAR: n`, Notes for unarmed units and seat counts; Small Steamer. Its Charge line is retained because it exists in the reference |
| Rail support | Rail/MagLev accepted by the parser, which already had matching motive decoding and engine support; six-facing large-support hull selection |
| Fixed-wing support | Correct support title, kilogram mass, engine type without a fighter engine rating, BAR label, real stores capacity and chassis/seat/cargo feature footer; Boomerang Spotter Plane |
| Battle Armor | AP indicator derived from actual AP equipment, first trooper-status circle shaded as in the reference, exact masthead asset; Achileus David squad |
| Conventional infantry | Shared per-strength damage/range projection, movement labels/order, armor divisor, special notes, field-gun quantity/ranges/ammunition/crew and MML-specific AC/UAC/RAC/LBX damage notes |
| Infantry notes | TAG excluded from the combat range-weapon selection used by both range table and notes; parsed augmentations displayed with known ability/MegaMek labels; dense notes wrapped using measured text and reduced to a minimum of 5 points |
| Handheld weapons | Dedicated compact design, exact masthead wording/art, `Loc`/`GUN` column and a cluster table only when actual cluster weapons require it |
| Static families | Explicit native construction/protection/inventory composition, with reference unavailable recorded rather than implying MML parity |

Additional corrections from the final pass:

- DropShip/capital bay condensation preserves complete component IDs and compares
  weapon, augmentation and ammunition identity, including remaining construction
  shots. Equal printed text alone cannot merge standard and Artemis ammunition.
- Large-aero maximum arc heat uses existing rapid-fire counts and capacitor heat.
  Comitatus fore arcs print 59 rather than 52. Hoshiryokou prints its ten cargo
  containers; its aft Small Laser correctly prints `0 (3)`.
- Small Craft use the same ground-range inventory comparator as other standard
  weapon inventories. Cargo and heat text, vessel personnel and lifeboats,
  aero reference headings and ground-movement table headings fit their frames.
- Battle Armor formation names follow trooper count: Suit, Un, Squad, Point or
  Level I. Per-block titles survive compact-page composition.
- Infantry footer artwork clears the footnotes. Unavailable strength slots keep
  legible numbers and damage dashes while their soldier artwork fades.
- Mek sheets print linked capacitor profiles and projected TSM alternatives,
  primitive construction titles, low-BAR armor ratings and biped patchwork
  material names. Internal torso labels sit beside their counters, clearing Head.

The parallel paperdoll interaction task owns the conversion to authored
`unitLocation` contours and random-hit controls. This work preserves that
contract; the pip material and damage-highlight layers do not require clicks on
individual paperdoll pips.

## Infantry capability and BV authority

Construction facts and crew policy have different meanings and are kept explicit:

1. `InfantryEntity.hasAntiMekGear()` is the equipment fact used by construction
   tonnage/cost, BLK parsing and the existing catalog DTO field.
2. `InfantryEntity.canMakeAntiMekAttacks()` and
   `BattleArmorEntity.canMakeAntiMekAttacks()` implement each infantry family's
   general anti-Mek predicate used by MegaMek's BV and crew-skill rules.
   Individual BA Leg/Swarm eligibility uses separate construction rules.
   Conventional restrictions include motive, encumbering
   armor and field guns; BA includes mechanized capability, weight, UMU and
   burden from appropriate body-mounted missile/ammunition equipment.
3. `classicSkillFactsForEntity()` supplies these facts to
   `fixedCBTPilotingSkill()` / `effectiveCBTPilotingSkill()`. Physically incapable
   infantry use the fixed neutral piloting column; capable conventional infantry
   without anti-Mek gear use 8. Other capable infantry use the requested skill.
4. `adjustEntityBattleValueForSkills()` and
   `unroundedEntityBattleValueForSkills()` apply the shared crew policy. Runtime
   sheets, force BV, crew presentation and skill editors consume that policy.
   The neutral entity/UnitSummary BV and saved crew skill facts are preserved.

For `CIClanHeavyFootInfantry_EbonKeshikPoint`, the neutral catalog/entity BV is
68. Default 4/8 crew gives `round(68 * 0.85) = 58`, matching the reference sheet;
the neutral 68 is not overwritten to obtain that result.

The existing catalog `canAntiMech` field remains a DTO adapter with its original
export meaning (CI gear; BA implicit leg/swarm attacks). Summary-only search
adapts the facts available in that DTO; loaded entities remain the full rule
authority. Separate BA leg-attack/swarm checks used by Alpha Strike are retained
because those are distinct ability rules. Existing V1 force-save compatibility
is not replaced or removed.

The subsequent whole-corpus anti-Mek audit found that this summary adapter is
lossy: 254 conventional infantry and 39 Battle Armor entries have different
catalog/entity skill facts. Shared formulas alone do not guarantee a common
result when their input projections differ. The audit also identified live CI
binding replacing an inapplicable skill dash with neutral BV column 5. See
`tmp/anti-mek-audit/README.md` and its per-unit results for the exact cases and
the distinction between gear, general capability, and Leg/Swarm checkboxes.

## Reference coverage and limitations

`tmp/sheet-parity/representatives.json` records 57 family/variant cases with
fixture UUID, navigation `shareUnit`, source unit file and reference SVG paths
where available. The saved oracles are under `scripts/fixtures/sheets/`; the
manifest originates from `scripts/fixtures/units.json`, with explicitly marked
newer static-unit cases. It is a case inventory, not a claim of 57 passed optical
comparisons.

Coverage includes biped over 100 tons, industrial/quad/tripod/LAM/QuadVee Meks;
ground/support/turret/VTOL/WiGE/rail and naval/hydrofoil/submarine variants; all
three ProtoMek forms; four infantry variants; BA squad sizes; three fighter
families; aerodyne/spheroid Small Craft and DropShips; JumpShip/WarShip/station
and reverse pages; handheld and static families.

Forty-nine actual family/variant pairs were opened in Edge against both servers.
The final pass repeated corrected and initially interrupted cases, including
lower sections and reverse pages. Four additional material examples cover
Hachiwara (Hardened), Zeus-X (patchwork and Composite), Lumberjack (BAR 5), and
Paladin (Reinforced). Detailed observations are retained in
`tmp/sheet-parity/browser-families.md` and
`tmp/sheet-parity/browser-infantry-final.md`.

The reference is not used to override current rules. Ebon Keshik prints its
effective anti-Mek skill 8 rather than the legacy sheet's unadjusted 5; incapable
infantry show an unavailable skill. Mechanized AA's range-zero modifier includes
the current MegaMek `Compute` crew-size penalty omitted by `PrintInfantry`.
Crucible has no sail: the native sheet omits the legacy printer's inactive sail
counter rather than inventing a sail location.

The manifest explicitly lacks real catalog examples for WiGE dual-turret,
naval dual-turret, hydrofoil zero-/dual-turret, submarine dual-turret and large
handheld layout cases. Buildings have native examples but no
reference SVG. These cases require structural fixtures or a future real design;
no missing oracle should be silently counted as a visual pass.

For repeatable live review, navigate both servers with
`/?expanded=true&shareUnit=<manifest shareUnit>&tab=Sheet`, hold page format,
scale and pip mode constant, wait for generation/fonts, then compare every page.
Inspect semantic text/counts and SVG node/serialized-character size alongside the optical result.
A smaller SVG or matching pip count alone does not prove visual equivalence.

The final live Atlas DOM measurement reduced native descendants from 3,028 to
2,290 (24.4%) and serialized `outerHTML` from 440,387 to 348,211 characters
(20.9%). The current sheet has 562 pips, zero `.pip-hit` elements, Canon mode and
three independent paperdoll views. Its reference has 1,845 descendants and
268,547 characters, so the native Atlas is still larger than the reference;
these measurements establish improvement against the native starting point,
not superiority over the reference SVG. The latest paired upper-sheet view was
visually close in inventory/text; this is not a whole-page pixel-equivalence
result.

The final Aegis is one page with 1,939 descendants and 292,486 serialized
characters, versus 2,255 and 306,749 in the reference. Carrack remains two pages:
the different ammunition in its aft-side bays prevents merging. Both its front
and reverse page were checked after that fix.

## Verification and remaining interaction handoff

- Application/spec TypeScript checks, `npm run typecheck:scripts`,
  `npm run test:convergence-architecture`, and `git diff --check` pass.
- The broad regression run covered family generation, layouts/materials, damage
  binders and timers, source/cache invalidation, the Options dialog, infantry
  entities, crew policy/BV, catalog metadata, skill editors and Alpha Strike.
  A 616-test checkpoint passed; later additions were checked in the combined
  run and final sheet rerun rather than assumed covered by that checkpoint.
- The final sheet rerun passed 322 tests and exposed four failures in the
  concurrent paperdoll tests. Two were browser float32 bounding-box tolerance
  assertions. Those were corrected, and the focused framing/generator rerun
  passed all 61 tests. Shield tests verify actual armor/DC/DA capacities and
  equipped arms without fixing the number of editable artwork fragments.
- Two interaction regressions remain for the paperdoll task:
  `paperdoll-hit-testing.spec.ts` reports that the random-hit button covers two
  right-arm structure pips on biped and glider ProtoMeks. The observed points
  are approximately `(684.83,57.24)` and `(688.24,53.82)` in that test viewport;
  the hit element is `.mek-random-hit-area`. The shape/material/count tests
  pass. Production contour and random-hit changes remain with their owner.
- Logs: `tmp/sheet-parity/combined-tests.log`, `final-sheet-tests.log`, and
  `final-framing-tests.log`. The full integrated suite is not claimed green
  while those two interaction regressions remain.
- The final presentation/generator/Mek-binder run passed all 170 tests
  (`tmp/sheet-parity/final-presentation-tests.log`), including preservation of
  the printed PPC-capacitor profile when the interactive binder refreshes.
- Fresh infantry damage was timed in the original Edge force: fresh cleared
  after 2,995 ms, pending damage remained, and the test casualty was undone.
  Automated checks cover zero/negative lifetime, unchanged redraws, later
  changes, commit and disposal across ordinary pips, capital grids and infantry.
- Final paired views confirmed the corrected infantry fields/footnotes, Battle
  Armor formation/art, support-aero headings/art/features, naval tables, rail
  hull, Small Craft inventory, capital arc heat and front/reverse pagination.
  Minor differences from interactive controls and dense inventory spacing
  remain; this review does not claim a pixel-identical result for every design.

During the last additional material check, port 4200 was reassigned to the Forma
SVG editor. That application was left untouched; a temporary MekBay server on
4201 was used for the remaining check and then stopped (no listener remained).
The user moved MekBay to port 4000, where the final Hachiwara preview confirmed
the capacitor row, TSM movement and hardened armor pips. No force data or
preferences were changed by those catalog-preview comparisons.
