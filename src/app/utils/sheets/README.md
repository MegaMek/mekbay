# Native record sheets

`RecordSheetSvgGenerator` resolves a family, asks it for its pages, adds runtime
controls, and optimizes the resulting SVG. It does not draw family layouts.
`layouts/record-sheet-layout-resolver.ts` is the only family registry.

| Family owner | Designs |
| --- | --- |
| `MekRecordSheetLayout` | Biped, Quad, Tripod, QuadVee, LAM; ordinary and superheavy |
| `CombatVehicleRecordSheetLayout` | Ground combat/support vehicles, VTOL and WiGE; turret variants and superheavy hulls |
| `NavalRecordSheetLayout` | Naval, hydrofoil and submarine; turret variants and superheavy hulls |
| `ProtoMekRecordSheetLayout` | Biped, quad and glider ProtoMeks |
| `BattleArmorRecordSheetLayout` | Battle Armor squads |
| `ConventionalInfantryRecordSheetLayout` | Conventional infantry platoons |
| `AeroFighterRecordSheetLayout` | Aerospace/conventional fighters and fixed-wing support |
| `SmallCraftRecordSheetLayout` | Aerodyne and spheroid Small Craft |
| `DropShipRecordSheetLayout` | Aerodyne and spheroid DropShips |
| `CapitalShipRecordSheetLayout` | JumpShips, WarShips and space stations |
| `HandheldWeaponRecordSheetLayout` | Standard and large inventory/armor/ammo strips |
| `StaticEmplacementRecordSheetLayout` | Buildings; native full-page design with construction data, armor/CF tracks and equipment inventory; no paperdoll |

`GenericRecordSheetLayout` is a fallback, not a reference-matched family design.
Buildings have an original native design with a structure map and equipment
inventory. MegaMekLab has no building template and supplies no oracle fixture.
Missing armor or CF remains unspecified; no protection values
are invented. Representative cases in `tmp/sheet-parity/representatives.json`
retain `referenceUnavailable: true` for buildings.

## Sharing without coupling designs

`CompactRecordSheetLayout` owns compact/full-page composition, page mastheads,
block spacing, shared definitions and ID namespacing. Compact families own their
geometry, block content and any supplementary tables. `record-sheet-layout.ts`
outside `layouts/` contains physical page geometry and print packing only.

`LargeAeroRecordSheetLayout` is an abstract ancestor for DropShips and capital
ships: both use bay inventory, overflow planning, reverse-page references and the
same vessel panel arrangement. Small Craft have an independent composition and
mount inventory. Fighter and vessel drawing primitives live beside their family
owners; unrelated family decisions do not belong in a shared rendering helper.

`record-sheet-svg-rendering.ts` supplies drawing primitives and shared panels.
`SvgFrameUtil` generates the frame contours and headings. Headerless frames skip
text measurement; frames with headings measure the actual font to preserve fit.
No runtime record-sheet template SVG is loaded.

## Editable artwork and paperdolls

Silhouettes, infantry figures, icons and fixed reference art remain editable
assets. Runtime code combines those small elements with generated frames, text,
tables, pips and controls. A paperdoll SVG must have a positive `viewBox`.

`PaperdollGenerator.createPaperdoll(assetUrl, width, height, { armor, structure }, options)`
is the common placeholder engine. Keys are sheet location codes; rear Mek armor
uses `CT_R`, `LT_R`, `RT_R`. The editable geometry declares these contracts:

- `data-location` selects the location.
- `data-fill="armor"` or `"structure"` defines a pip area; rectangles and shape
  outlines can be authored directly in a drawing program.
- `data-canon` supplies the classic biped placement bounds.
- `data-rail` supplies authored rails for rail placement.
- `.unitLocation.armor` / `.unitLocation.structure` with `data-loc` defines each
  location's silhouette hit region. A location may have multiple path fragments;
  bind and highlight all of them. Rear Mek armor also has `data-rear="1"`.
- Every generated paperdoll layer has `data-mekbay-paperdoll="1"`. Its pips and
  decorative art ignore pointer events; only location contours own damage picking
  and hover effects. Location-aware paperdolls also have a random-hit control.
- `data-multisection="true"` groups disconnected pip profiles into one count;
  `data-gap="left,right"` reserves a gap within a row.
- Shield art uses `data-mekbay-shield="LA"` / `"RA"`; shield capacity and
  absorption placeholders use `data-fill="shield-dc"` / `"shield-da"`.

`MekPaperdollGenerator` adds Mek defaults, independent armor-front/armor-rear/
structure APIs and the biped canonical pip map. `recordSheetPipLayout` is the saved
preference: Canon (`classic`), Distributed (`distributed`) or Grouped (`rail`).
The generator resolves Canon to the canonical map only for biped Meks up to 100
tons; all other units use distributed pips. Grouped uses authored rails and falls
back to distribution for locations without sufficient rail geometry. Fixed
infantry strength boxes, Battle Armor rows, ammo lanes and system damage tracks
retain their semantic arrangement. Exact internal counts come from the entity.

`RecordSheetSourceService` passes the preference into every generation. Member
sheet caches are keyed by this preference and reject stale asynchronous results;
both interactive and catalog previews regenerate after it changes.

All Meks generate three sibling views identified by
`data-mekbay-paperdoll-view="front"`, `"rear"`, or `"structure"`. For bipeds,
edit `BIPED_MEK_PAPERDOLL_BOXES` in the Mek layout. Other chassis have independent
armor/rear/structure placements in `PROFILED_MEK_PAPERDOLLS`. Each view carries
its own art, pips and labels so moving one view does not move another.

Runtime contracts such as `.pip.armor`, `.pip.structure`, `data-loc`, `data-rear`,
`textArmor_*`, `textIS_*`, inventory component IDs and crew/control IDs must stay
unique and consistent with the binders. Asset-local decorative IDs need not be
part of the runtime contract. `RecordSheetDamageHighlights` owns transient fresh
damage in every sheet family; it is not a generator or a saved combat fact.

Fancy Pips are applied by `record-sheet-pip-materials.ts` after each family places
its pips. Material comes from each entity location, including patchwork armor and
mixed structure; canonical positions and runtime identities do not change.
Hardened armor and reinforced structure use diamonds; armor below BAR 10 and
composite structure use dashed circles. Reactive, reflective, ferro-lamellor,
anti-penetrative ablation, heat-dissipating, impact-resistant and
ballistic-reinforced armor use pentagons, as do Battle Armor fire-resistant,
reflective and reactive armor. Other materials use circles. These are
MegaMekLab's `PipType.forAT` / `forST` mappings. Trooper-status and shield-capacity
pips remain circles, shield absorption remains diamonds, and capital square
tables retain their separate `PrintCapitalShip` arrangement.
Each pip represents one construction armor/internal point. Hardened Armor and
Reinforced Structure diamonds are split into two independently marked halves.
Their runtime damage capacities are twice the construction values, with integer
damage per half. Counters retain construction-point units and show half points
when needed. Construction values and saved damage amounts remain unchanged.

`RECORD_SHEET_FRESH_DAMAGE_DURATION_MS` in `record-sheet-damage-highlights.ts`
defaults to 3000 milliseconds. A positive value clears the latest damage/repair
highlight after that interval while leaving pending damage intact. Zero or a
negative value keeps the highlight until the next change or commit. Unchanged
redraws do not restart the timer, and unbinding a sheet cancels its timers.

## Adding or changing a design

1. Add or edit a concrete owner in `layouts/`. Start with an independent
   composition; share a component only when another family needs the same drawing
   contract. Use the compact ancestor only for genuinely packable unit blocks.
2. Register the owner, matching the most specific family first. Keep full-page
   dimensions and compact packing profiles consistent with generated bounds.
3. Add any editable paperdoll art with the placeholder and interaction contract
   above. Units without a paperdoll simply do not call the paperdoll generator.
4. Exercise family routing, real pip counts/location bindings, unique IDs,
   compact composition, page formats and any overflow pages. Compare a real unit
   in both native and reference Sheet previews; structural tests do not prove
   optical parity.

The focused specs cover every currently parseable entity family, independent Mek
views, DropShip/Small Craft inventory, capital overflow planning, superheavy
vehicle locations, infantry/BA/ProtoMek compact blocks, handheld strips, and
native static-emplacement construction/inventory contracts.
Use `ng test --watch=false --include=src/app/utils/sheets/record-sheet-svg-generator.spec.ts`
plus the changed family/paperdoll specs, with the installed headless browser.

Application theme ownership, global loading, and the selector cleanup audit are
documented in [STYLES.md](STYLES.md).

## Inventory typography and wrapping

`record-sheet-typography.ts` defines the shared point sizes: 10.6 for frame captions,
8.6 for section headings, 7.7 for body labels, and 6.76 for inventory cells.
Family geometry scales these for the physical page, independently of column padding.
`inventory-text-layout.ts` measures and wraps inventory cells at word boundaries,
splitting an overlong identifier only when necessary. Cells never use `textLength`
to squeeze their glyphs. Existing multi-line bay entries and runtime text bindings
retain their line structure and complete text.

The fitter counts wrapped lines, tightens leading first, and then decreases type
in 0.05-point steps down to the MegaMekLab 4.5-point minimum. Weapon modifier badges
keep the Mek reference width and type (10 points wide, 7.436-point bold type).
Their backgrounds can shorten from 9 to 6.5 points as leading tightens; rows
reserve enough space for the fixed-size text to remain readable without overlap. Column widths, row heights, and control areas are measured together;
badges stay centered on the frame independently of inventory density.
