# Record-sheet styling

## Ownership and loading

The application stylesheet imports `styles/record-sheet.scss` once with
`@use './app/utils/sheets/styles/record-sheet';`. The entry loads base, heat palette,
screen, night, interaction, and print partials in that order. Every sheet selector stays under
`.mekbay-sheet`; the hit-location animation has a domain-specific keyframe name.

Global loading fits the full viewer, lightweight/catalog previews, construction
previews, composed pages, and print overlays. They mount or clone generated SVG
outside Angular templates, without component content attributes.

| Choice | Assessment |
| --- | --- |
| Domain SCSS entry, imported from the existing global stylesheet | Chosen: one import serves application and test builds; ownership stays beside the generator. |
| Viewer styles with normal encapsulation | Generated descendants would not match the scoped selectors, and other consumers have no viewer component. |
| Viewer with `ViewEncapsulation.None` | Still global, but loading would depend on a component that previews and print overlays need not instantiate. |
| A second `angular.json` styles entry | Works, but repeats registration in build and test targets without providing isolation. |
| An emit mixin included at the old position | Adds indirection solely to preserve source order. Before/after computed-style comparisons found no need for it. |

The partials separate responsibilities rather than individual unit families:

- `_base.scss`: shared SVG behavior and runtime states that also apply in print.
- `_screen.scss`: control state, selections, heat, and damage previews.
- `_night.scss`: artwork recoloring followed by runtime-state overrides.
- `_interaction.scss`: pointer cursors, active hit targets, hover/focus effects, and
  editing affordances, gated by `.interactive-sheet` and bound control classes.
- `_print.scss`: sheet transform/filter resets only.
- `_heat-scale-colors.scss`: the sole day/night heat palette. One Sass table emits
  CSS variables for each existing SVG heat attribute; two shared fill rules consume
  them when a cell is hot. The generator emits no color configuration.

The selected-page outline belongs to `ViewerStageComponent`, where
`multiple-visible` is owned. A scoped stage selector crosses into projected content
with `::ng-deep`, covering both Angular pages and imperative swipe wrappers. Placing
it on `ViewerPageComponent` would miss those imperative wrappers.

App-wide print visibility, page-root resets, `.custom-unit-badge`, and the HTML
`.customAmmoLoadout` color remain in `src/styles.scss` because they have non-sheet
consumers.

`styles/record-sheet-intrinsic.css` owns the defaults embedded in each generated
SVG: typography, pip geometry and damage, disabled opacity, crew-label contrast,
hidden content, and print visibility. The generator imports it with Angular's
`with { loader: 'text' }`; it stays plain CSS because this import does not compile
Sass. Do not also load it through the global entry. The export serializer copies
the SVG and its embedded styles, but does not copy application stylesheets.
`:where(.mekbay-sheet)` prevents these defaults from affecting unrelated SVGs or
HTML without increasing their specificity against the application theme.

Live pointer targets and cursors belong to the interaction partial. Capital-pip default
colors and interaction transparency are already authored as SVG attributes;
only their application theme overrides belong in SCSS. The intrinsic stylesheet
does not repeat those attributes or the `.motiveHitPip.damaged` selector, which is
already covered by `.pip.damaged`.

Generated sheets are passive by default. The viewer runtime services add
`.interactive-sheet` while a sheet is bound and remove it on cleanup; shadow
copies remove the marker. This includes read-only viewers, whose bound controls
can still navigate pages or open reference tools. Individual `.interactive` and
`.selectable` markers identify actionable controls; semantic classes such as
`.crewHit` or `.unitLocation` alone do not imply editability. Reference-table
cursors use `.referenceTableControl` to preserve their existing pointer routing.
Intrinsic CSS disables pointer events on an ungated sheet and every descendant,
including hit areas with authored SVG or inline `pointer-events: all`. The
preview's surrounding container still owns zoom, pan, and scrolling.

Construction previews opt into `.print-preview` on each SVG root. Screen and night
styles exclude those pages. The marker survives cloning, and the embedded styles
apply print visibility to marked pages on screen and in SVG/PNG exports: hide
`.screen-only` and `.edit-only` controls and reveal `.print-show` content. The same
visibility rules apply when printing.

## Selector audit and cleanup

The former sheet block was inventoried and cross-checked against production
TypeScript, HTML, and SVG in `src/app` and `public` (1,296 files). Search results
were candidates, not proof of use: runtime writers, dynamically assembled names,
cleanup-only references, generated DOM relationships, and embedded artwork were
checked before removing rules.

| Removed selector or qualifier | Evidence |
| --- | --- |
| `.damaged-strike`, `.damagedInventory` | No producer. Current inventory damage uses `.damaged` and text decoration; `.disabledInventory` is still live. |
| `.wounded .checkbox-rect` | No generated/runtime checkbox class pair. |
| `.locationConditionButton`, `.locConditionButton` | No producer. Current headings use `.locationConditionControl`; the stale zoom-suppression selector now uses that name. |
| `:not(.counterGroup)` | No production writer. Removed the qualifier while retaining critical-track state rules, and removed stale fixture classes. |
| `.weakenedHitMod` | Only reset/removal references remained. Removed those references and the unused styling. |
| `.clickPassthrough` | No producer; current hit targets and pointer-event rules remain. |
| `.noPsrCheck` | No producer. The live `.movePsrWarning` styling remains. |
| `:not(.targetAimedShotWarning-text)` | No warning element producer; removed only the exclusion. |
| `#suit0` through `#suit5` child selectors | Legacy Battle Armor workaround. Current generators use trooper/paperdoll structures and explicit hit areas. |

Two actual style defects were corrected:

- Night-mode damaged hover used invalid `::hover`. It now uses `:hover` and
  preserves the damage highlight instead of falling back to the undamaged color.
- Rotor preview styles required `.rotorHitsControl`, which is never generated.
  They now address the live rotor critical control, handling both bare rectangles
  and grouped frames. Counter text styles address the live counter ID. The frame
  selector survives night artwork recoloring without making the counter text
  inherit a frame stroke.

## Findings deliberately retained

- The location-heading descendant hover selector is correct. The generator first
  inserts the control before the heading, then reparents the heading into it.
  Inspecting only the insertion step incorrectly suggests adjacent siblings;
  the generated-DOM browser check confirms the final structure.
- `.selected-range-*`, `.unusedMoveMode`, `#faded-arrow`, capital pip states,
  and random-hit result classes have runtime or generated producers. Absence from
  a pristine SVG does not make them dead.
- `.heat0` through `.heat30` were live generated names. Their 62 duplicated
  palette rules were replaced by one SCSS table and two shared fill rules. Sass
  emits one variable-setting selector per heat value, once in the global CSS.
  The generator only supplies the existing heat attribute. Colors are unchanged,
  including night-mode rounding.
- Repeated night damage/repair rules are needed after the important black/white
  artwork recoloring. Removing them would change specificity and hide runtime
  colors. They remain explicit; no broad state mixin obscures that cascade.
- Mask and `.no-autocolor` exclusions preserve authored art, heat cells, and
  semantic colors. Soldier image filters and capital pip state rules remain.
- Identical skill/custom-ammo declarations and gray artwork selector groups were
  combined. No family-specific geometry moved into the shared styles.

## Verification (2026-09-09)

The root stylesheet shrank from 3,300 to 1,941 lines. The five sheet partials total
1,061 lines, with a seven-line entry. The former shared block compiled to 39,374 bytes;
the new entry compiles to 35,798 bytes (now including sheet print resets and
excluding the viewer outline). This is cleanup plus relocation, not elimination
of all moved CSS.

The application typecheck and 225 focused Angular/Karma tests passed. Coverage
includes generators, physical formats, pip materials, damage lifetimes, generated controls, ammunition,
Mek/non-Mek binders, print composition, exports, and computed sheet styles. Browser
regressions check both themes, cloned previews, heat colors, damage precedence,
custom-ammo colors, heading hover, damaged night hover, and VTOL rotor previews.
The viewer-stage test checks projected and imperative page wrappers.

A temporary migration audit compared 14 computed properties on every generated
SVG element across all 23 test entity types, five runtime-state combinations, both
themes, and screen/print rules: 460 comparisons matched. Print rules were activated
in isolated iframes; animations/transitions were frozen for deterministic comparison.
The intentional rotor/hover fixes have separate behavior assertions. These fixtures
cover generator families, not every possible equipment or artwork combination.

All 31 day/night color pairs were checked against the prior palette when moving
ownership into SCSS. The 88 style, generator, and export tests and application
typecheck passed with the SCSS-owned palette.

## Intrinsic-style extraction verification (2026-09-10)

The development build and application typecheck passed. All 19 browser style
tests passed, including isolated clone/serialization checks with no application
stylesheet, capital-pip attribute defaults, print visibility, unrelated-SVG
isolation, and live hit targets/read-only cursors. Another 204 focused generator,
format, controls, pip-material, binder, print, and export checks passed.
