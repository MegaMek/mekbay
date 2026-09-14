# Organization rules and solving

Faction rules live in `definitions/`; `org-registry.util.ts` selects them by faction and era. Reuse existing declarations with imports and object spreads. Definitions are typed TypeScript objects: no separate schema or builder API is needed.

## Choosing a rule

| Kind | Input and purpose | Existing example |
| --- | --- | --- |
| `leaf-count` | Count units selected by type or named selector; optionally separate them into buckets. | `IS_LANCE` in `definitions/is-org.ts` |
| `ci-formation` | Allocate conventional infantry squads using movement-specific counts; preserve split allocations. | `IS_PLATOON` in `definitions/is-org.ts` |
| `leaf-pattern` | Match unit buckets against demands, bounds, and optional scoring terms. | `CC_AUGMENTED_LANCE` in `definitions/cc-org.ts` |
| `composed-count` | Allocate child groups to roles, each with optional minimum/maximum and type/tag requirements. | `IS_AIR_LANCE` in `definitions/is-org.ts` |
| `composed-pattern` | Match child roles and patterns over their descendant unit buckets. | `CLAN_NOVA` in `definitions/clan-org.ts` |

For example, a two-role count rule can require one Flight and one Mech Lance:

```ts
const rule: OrgComposedCountRule = {
    kind: 'composed-count', type: 'Air Lance', tier: 1.5,
    modifiers: { '': 2 },
    childRoles: [
        { matches: ['Flight'], min: 1 },
        { matches: ['Lance'], min: 1, onlyUnitTypes: ['BM'] },
    ],
};
```

The empty modifier key denotes regular strength. Modifier values are counts, or `{ count, tier }` when a tier override is needed. Counts and pattern `copySize` must be positive integers. Child-role bounds refer to child groups, not descendant units. A child can fill only one role in a composition. `countsAs` permits a specialized group to match a general child type.

`bucketBy` separates unit facts for leaf rules and selects descendant facts for composed patterns. `childMatchBucketBy` partitions children before composition. Named selectors and buckets are declared in `org-types.ts` and implemented by `org-facts.util.ts`. Descendant aggregates use the standard bucket meanings consistently in both concrete and lazy groups; registry overrides do not redefine these stored aggregates. New descendant semantics must be added to the shared fact compilation, rather than hidden in a registry override.

## Solver responsibilities

- `org-facts.util.ts` compiles unit facts and shared descendant aggregates. `org-unit-adapter.util.ts` supplies the same minimal input from a live entity; archive summaries can be used directly.
- `org-leaf-rules.util.ts`, `org-patterns.util.ts`, and `org-composition.util.ts` allocate units, squads, and child groups. Composition searches counts of structurally equivalent children. Catalog identifiers and tonnage are not organization group-state dimensions.
- `org-group-records.util.ts` carries lazy group records until materialization.
- `org-solver.util.ts` compares whole, regular, repaired, promoted, and leftover candidates. `org-namer.util.ts` formats the resulting organization.
- `org-solve-session.ts` owns the deadline and metrics for one public solve, including generic-wrapper re-evaluation.

Typed foreign organizations pass through as existing groups. Generic `Force` and typeless wrappers are re-evaluated under the target faction. Infantry `unitAllocations` carry squad quantities; their `units` entries are aliases, not additional members. Preserve original unit objects when handling allocations.

## Search guarantees and limits

This is a bounded solver with exact subproblems, not an exhaustive optimizer for arbitrary definitions. Candidate ranking considers whole organizations, leftovers, top-level group count, regularity, tiers and priorities, with a descendant-regularity tie-break. Exact leaf-partition exploration is limited to 32 units.

Every public solve shares one cooperative 750 ms deadline. Individual enumeration scopes have 50,000-visit quotas; exhausting enumeration still permits inexpensive count-based promotions. Iteration limits also bound repeated construction. On exhaustion, valid allocations and leftovers are retained. `getLastOrgSolveMetrics().stopReason` reports the first visit/iteration limit, or `deadline` if that is reached. `timedOut` specifically means deadline exhaustion. Final materialization and required bookkeeping can extend beyond the deadline; it is not a hard wall-clock cutoff.

Incomplete searches must not populate shared negative-plan or exact-result caches. Metrics belong to the most recent public call, including pass-through calls.

## Validation

Run `npx ng test --watch=false --include=src/app/utils/org/**/*.spec.ts` from the project root. For rule changes, add boundary, mixed-type and leftover cases beside the existing solver tests. Preserve every roster instance and allocated infantry squad. Compare full organization ranking and descendant structure; matching top-level names alone is insufficient.