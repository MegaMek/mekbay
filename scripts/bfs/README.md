# Battlefield Support (`.bfs`) generation contract

This directory contains the reviewed inputs for converting the three CSV tables in
`mm-data/BFS_CSV` to MegaMek Battlefield Support YAML files.

## Authority

`BattlefieldSupportAssetYaml.toMap()` and `fromNode()` in MegaMek are authoritative.
The generator does not infer fields that the Java model cannot represent.

## YAML structure and order

```yaml
uuid: "<asset UUID>"
linkedUnitId: "<base MTF/BLK UUID>" # linked assets only
chassis: "<base or standalone chassis>"
model: "<base or standalone model>"
assetType: "Vehicle | Conventional Infantry | Battle Armor | Emplacement"
cardTitle: "<nonblank override>"       # optional
cardSubtitle: "<nonblank override>"    # optional
year: 3151                            # omitted only for unknown standalone data
techBase: "IS | Clan | Mixed (IS Chassis) | Mixed (Clan Chassis)"
source: "<publication>"               # optional
movement:
  mp: 0
  mode: "TRACKED | WHEELED | HOVER | VTOL | WIGE | INF_LEG | INF_JUMP | INF_MOTORIZED | NONE"
tmm: 0
range: [3, 6, 9]                     # exactly three integers; [-1,-1,-1] is keyword/no range
skill:
  standard: 6
  veteran: 5                          # optional
damage:
  perHit: 5
  hits: 2
destroyCheck: 7
threshold: 5
cost:
  standard: 13
  veteran: 15                         # optional
specials:
  - "APC1"
  - "Artillery (LT)"
role: "SCOUT"                         # optional
```

The actual output uses block-form `range` to match the existing mm-data files. Strings
are quoted so YAML scalars cannot be misinterpreted.

## CSV mapping

- `Cost` and `Skill`: `13(15)` means Standard 13 and Veteran 15; a single integer has no Veteran profile.
- `MP`: suffixes map as `T=TRACKED`, `W=WHEELED`, `H=HOVER`, `V=VTOL`, `J=INF_JUMP`, `F=INF_LEG`; emplacement `0` maps to `NONE`.
- `Range`: `3/6/9` is numeric. `-`, `Artillery`, and `Arrow` map to `[-1,-1,-1]`.
- `Damage`: `5` means `{perHit: 5, hits: 1}`; `6x2` means `{perHit: 6, hits: 2}`; `-` and `0` mean `{0,0}`.
- `Special`: comma-separated ordered tokens. `-` and `--` are omitted. `Immobile*` is the CSV footnote spelling of canonical `Immobile`. A token beginning with `+` consumes all remaining comma fragments as one prose special.
- Era columns are validated source data but have no BFS field.

## Linked identity

`linkedUnitId` is copied verbatim from the selected MTF/BLK `<UUID>` or `uuid:` field.
It is exact and case-sensitive. Linked `chassis`, `model`, `year`, `techBase`, `source`,
`role`, `assetType`, and movement mode come from that same base file. Asset-specific MP,
TMM, range, profiles, damage, checks, cost, specials, and card text come from the CSV and
reviewed manifest.

Each linked `.bfs` is placed beside its base and normally has the same filename stem. A
reviewed `outputFile` may preserve a historical BFS filename while remaining in the same
directory (currently the Elemental Battle Armor entry). Each asset
has its own UUID and must never reuse its base UUID.

## Standalone emplacements

Standalone files are placed under `data/mekfiles/battlefieldsupport`. Unknown year values
(blank or `????`) are omitted rather than replaced with MegaMek's DTO default. CSV source
is preserved. Naming corrections and card presentation are explicit manifest values.

## Aerospace limitation

The current Java `BFSAssetType` has no aerospace category. The aerospace CSV also contains
Size, Fuel, and categorical Range, while the current YAML has no corresponding fields or
authoritative TMM/movement mapping. All aerospace rows are parsed and listed in the report,
but no aerospace `.bfs` is emitted until MegaMek and MegaMekLab define those semantics.
