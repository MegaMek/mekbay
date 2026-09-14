// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
import { GameSystem } from '../../models/common.model';
import { createEmptyUnit, type TestUnitOverrides } from '../../testing/unit-test-helpers';
import { getFormationDefinition, getFormationDefinitions } from './formation-definitions';
import { FormationSolver as Engine } from './formation-solver.util';
import type { FormationConstraint } from './formation-requirement.model';
import type { FormationUnitLike } from './formation-facts.util';
import {
    TestBipedMekEntity,
    TestConvFighterEntity,
    TestFixedWingSupportEntity,
} from '../../models/entity/testing/test-entities';
import { addTestEquipment } from '../../models/entity/testing/test-mounted-equipment';
import { WeaponEquipment } from '../../models/equipment.model';

const faction = { id: 1, name: 'Clan Wolf', group: 'IS Clan' as const, img: '', eras: {} };
function unit(overrides: TestUnitOverrides = {}) {
    const summary = createEmptyUnit({ role: 'Skirmisher', as: { TP: 'BM', SZ: 2 }, ...overrides });
    return {
        force: { faction: () => faction },
        getFormationSummary: () => summary,
        pilotSkill: () => 3,
        gunnerySkill: () => 3,
    };
}
const definition = (id: string, gs = GameSystem.AS) => getFormationDefinition(id, gs)!;
const evaluate = (constraints: readonly FormationConstraint[], units: readonly FormationUnitLike[], maxUnits = 8) =>
    Engine.evaluateBlueprint({ id: 'test', constraints }, { id: 'test', minUnits: 0 }, units, GameSystem.AS, {
        maxUnits,
    });

describe('Formation solver invariants', () => {
    it('explains why an existing fixed-wing support aircraft blocks aerospace superiority additions', () => {
        const support = new TestFixedWingSupportEntity();
        support.role.set('Attack Fighter');
        const conventional = new TestConvFighterEntity();
        conventional.role.set('Attack Fighter');
        const member = (entity: TestFixedWingSupportEntity | TestConvFighterEntity) => ({
            force: { faction: () => faction },
            getFormationEntity: () => entity,
        });
        const interceptor = unit({ type: 'Aero', subtype: 'Aerospace Fighter', role: 'Interceptor' });
        const def = definition('aerospace-superiority-squadron', GameSystem.CBT);
        const blocked = Engine.prepareSearch(def, [member(support)], GameSystem.CBT);
        expect(blocked.current.status).toBe('invalid');
        expect(
            blocked.current.constraints.find((c) => c.constraintId === 'aerospace-superiority-all-aerospace')
                ?.mismatchingUnitIndexes,
        ).toEqual([0]);
        expect(blocked.evaluateCandidate(interceptor).allowed).toBeFalse();
        expect(Engine.prepareSearch(def, [], GameSystem.CBT).evaluateCandidate(interceptor).allowed).toBeTrue();
        expect(
            Engine.prepareSearch(def, [member(conventional)], GameSystem.CBT).evaluateCandidate(interceptor).allowed,
        ).toBeTrue();
    });

    it('builds six-fighter aerospace superiority squadrons and enforces the last-slot majority', () => {
        for (const gs of [GameSystem.AS, GameSystem.CBT]) {
            const interceptor = unit({
                type: 'Aero',
                subtype: 'Aerospace Fighter',
                role: 'Interceptor',
                as: { TP: 'AF' },
            });
            const attacker = unit({
                type: 'Aero',
                subtype: 'Conventional Fighter',
                role: 'Attack Fighter',
                as: { TP: 'CF' },
            });
            const def = definition('aerospace-superiority-squadron', gs);
            const roster = [attacker, attacker, interceptor, interceptor, interceptor, interceptor];
            for (let size = 0; size < roster.length; size++) {
                const search = Engine.prepareSearch(def, roster.slice(0, size), gs, { maxUnits: 6 });
                expect(search.evaluateCandidate(roster[size]).allowed).withContext(`${gs}/${size}`).toBeTrue();
            }
            const lastSlot = Engine.prepareSearch(def, roster.slice(0, 5), gs, { maxUnits: 6 });
            expect(lastSlot.evaluateCandidate(attacker).allowed).toBeFalse();
            expect(Engine.evaluateDefinition(def, roster, gs)?.valid).toBeTrue();
        }
    });

    it('uses current Entity equipment and compiles its mounted weapon list once', () => {
        const entity = new TestBipedMekEntity();
        const weapon = new WeaponEquipment({
            id: 'formation-test',
            name: 'Laser',
            type: 'weapon',
            weapon: { damage: 5, ranges: [3, 6, 9, 12] },
        });
        addTestEquipment(entity, weapon, { location: 'CT' });
        const read = spyOn(entity, 'rangedWeapons').and.callThrough();
        const member = { force: { faction: () => faction }, getFormationEntity: () => entity };
        const blueprint = {
            id: 'damage',
            constraints: [
                { id: 'damage', kind: 'all' as const, predicate: 'medium-damage-2' as const, label: 'Damage' },
            ],
        };
        const first = Engine.evaluateBlueprint(blueprint, { id: 'damage', minUnits: 1 }, [member], GameSystem.CBT);
        expect(first.valid).toBeFalse();
        expect(read).toHaveBeenCalledTimes(1);
        addTestEquipment(entity, weapon, { location: 'CT' });
        const next = Engine.evaluateBlueprint(blueprint, { id: 'damage', minUnits: 1 }, [member], GameSystem.CBT);
        expect(next.valid).toBeTrue();
        expect(first.valid).toBeFalse();
    });
    it('reports composition failures below the minimum size and keeps instance indices', () => {
        const infantry = unit({ as: { TP: 'BA' } });
        const mek = unit();
        const result = Engine.evaluateDefinition(definition('anti-mech-lance'), [infantry, mek], GameSystem.AS)!;
        expect(result.failedConstraintIds).toEqual(['unit-count-min', 'anti-mech-all-infantry']);
        expect(result.status).toBe('invalid');
        expect(result.constraints[1].matchingUnitIndexes).toEqual([0]);
        expect(result.constraints[1].mismatchingUnitIndexes).toEqual([1]);
        const sameModel = evaluate(
            [{ id: 'inf', kind: 'all', predicate: 'infantry-unit', label: 'Infantry' }],
            [mek, mek],
        );
        expect(sameModel.constraints[0].mismatchingUnitIndexes).toEqual([0, 1]);
    });

    it('reports compatible incomplete formations explicitly', () => {
        const result = Engine.evaluateDefinition(
            definition('anti-mech-lance'),
            [unit({ as: { TP: 'BA' } })],
            GameSystem.AS,
        )!;
        expect(result.status).toBe('partial');
        expect(result.minimumAdditions).toBe(2);
    });

    it('does not blame every non-artillery unit for an artillery quota', () => {
        const result = Engine.evaluateDefinition(
            definition('artillery-fire-lance'),
            [unit(), unit(), unit({ as: { specials: ['ART-LT'] } })],
            GameSystem.AS,
        )!;
        expect(result.constraints[0].nonMatchingUnitIndexes).toEqual([0, 1]);
        expect(result.constraints[0].mismatchingUnitIndexes).toEqual([]);
        expect(Engine.getDeficits(result)[0].needed).toBe(1);
    });

    it('rejects a last-slot addition that still leaves a quota unmet', () => {
        const decision = Engine.prepareSearch(definition('artillery-fire-lance'), [unit(), unit()], GameSystem.AS, {
            maxUnits: 3,
        }).evaluateCandidate(unit({ as: { specials: ['ART-LT'] } }));
        expect(decision.allowed).toBeFalse();
    });

    it('allows percentage plateaus that have a valid continuation', () => {
        const sniper = unit({ role: 'Sniper' });
        const search = Engine.prepareSearch(definition('fire-lance'), [sniper, sniper, unit(), unit()], GameSystem.AS, {
            maxUnits: 8,
        });
        expect(search.evaluateCandidate(sniper).allowed).toBeTrue();
        expect(search.evaluateCandidate(sniper).fillsDeficit).toBeTrue();
    });

    it('allows starting a model pair and rejects it without enough room to finish', () => {
        const units = [unit(), unit(), unit()];
        const candidate = unit();
        expect(
            Engine.prepareSearch(definition('rogue-star'), units, GameSystem.AS, { maxUnits: 5 }).evaluateCandidate(
                candidate,
            ).allowed,
        ).toBeTrue();
        expect(
            Engine.prepareSearch(definition('rogue-star'), units, GameSystem.AS, { maxUnits: 4 }).evaluateCandidate(
                candidate,
            ).allowed,
        ).toBeFalse();
        const pair = Engine.evaluateDefinition(
            definition('rogue-star'),
            [candidate, candidate, units[0]],
            GameSystem.AS,
        )!;
        expect(
            pair.constraints
                .find((c) => c.kind === 'matched-pairs-min')
                ?.valueGroups?.map((group) => group.unitIndexes),
        ).toEqual([[0, 1], [2]]);
    });

    it('keeps both ideal-role and normal qualification paths available from an empty roster', () => {
        const search = Engine.prepareSearch(definition('assault-lance'), [], GameSystem.AS, {
            minUnits: 4,
            maxUnits: 4,
        });
        const heavySniper = unit({ role: 'Sniper', as: { SZ: 3, Arm: 8, dmg: { _dmgM: 4, _dmgL: 3 } } });
        const lightJuggernaut = unit({ role: 'Juggernaut', as: { SZ: 1, Arm: 1 } });
        expect(search.evaluateCandidate(heavySniper).allowed).toBeTrue();
        expect(search.evaluateCandidate(lightJuggernaut).allowed).toBeTrue();
        expect(search.current.qualifiedByIdealRole).toBeFalse();
    });

    it('makes blocking decisions independent of all English text and IDs', () => {
        for (const label of ['Clan force', 'All Clan units', 'xyz', 'At most']) {
            const result = evaluate([{ id: 'arbitrary', kind: 'all', predicate: 'infantry-unit', label }], [unit()]);
            expect(result.status).toBe('invalid');
        }
    });

    it('finds an actual completion and proves the three-identical-vehicle dead end', () => {
        const vehicles = [
            unit({ type: 'Tank', role: 'Sniper', weightClass: 'Heavy' }),
            unit({ type: 'Tank', role: 'Sniper', weightClass: 'Heavy' }),
        ];
        const def = definition('battle-lance', GameSystem.CBT);
        const complete = Engine.findCompletion(def, [], vehicles, GameSystem.CBT, {
            minUnits: 4,
            maxUnits: 4,
            allowRepeatedCandidates: true,
        });
        expect(complete.status).toBe('complete');
        expect(
            Engine.evaluateDefinition(
                def,
                complete.candidateIndexes.map((index) => vehicles[index]),
                GameSystem.CBT,
            )?.valid,
        ).toBeTrue();
        expect(complete.candidateIndexes.filter((index) => index === 0).length).toBe(2);
        const impossible = Engine.findCompletion(
            def,
            [vehicles[0], vehicles[0], vehicles[0]],
            vehicles,
            GameSystem.CBT,
            { minUnits: 4, maxUnits: 4, allowRepeatedCandidates: true },
        );
        expect(impossible.status).toBe('impossible');
    });

    it('respects candidate reuse and never reports a work limit as impossibility', () => {
        const candidates = [unit(), unit(), unit()];
        const def = definition('rogue-star');
        expect(Engine.findCompletion(def, [], candidates, GameSystem.AS, { minUnits: 3, maxUnits: 3 }).status).toBe(
            'impossible',
        );
        expect(
            Engine.findCompletion(def, [], candidates, GameSystem.AS, {
                minUnits: 3,
                maxUnits: 3,
                allowRepeatedCandidates: true,
            }).status,
        ).toBe('complete');
        const limited = Engine.findCompletion(def, [], candidates, GameSystem.AS, {
            minUnits: 3,
            maxUnits: 3,
            allowRepeatedCandidates: true,
            maxNodes: 1,
        });
        expect(limited.status).toBe('limit');
        expect(limited.examinedCandidates).toBe(1);
    });

    it('bounds candidate projection work as well as search nodes', () => {
        let reads = 0;
        const summary = createEmptyUnit();
        const candidates = Array.from({ length: 1000 }, () => ({
            force: { faction: () => null },
            getFormationSummary: () => {
                reads++;
                return summary;
            },
        }));
        const result = Engine.findCompletion(definition('rogue-star'), [], candidates, GameSystem.AS, {
            maxUnits: 3,
            maxNodes: 3,
        });
        expect(result.status).toBe('limit');
        expect(reads).toBe(3);
    });

    it('matches exhaustive completion enumeration with and without candidate reuse', () => {
        const vehicle = (uuid: string) =>
            unit({
                uuid,
                type: 'Tank',
                role: 'Sniper',
                weightClass: 'Heavy',
                armor: 160,
                as: { TP: 'CV', SZ: 3, Arm: 8 },
            });
        const candidates = [vehicle('A'), vehicle('A'), vehicle('B'), unit({ role: 'Juggernaut' })];
        for (const gs of [GameSystem.AS, GameSystem.CBT]) {
            for (const def of getFormationDefinitions(gs)) {
                for (const existing of [[], [candidates[0]], [candidates[0], candidates[0]]]) {
                    for (const allowRepeatedCandidates of [false, true]) {
                        const bounds = { minUnits: 4, maxUnits: 4 };
                        // The oracle enumerates final rosters without using partial status,
                        // completion bounds, candidate filtering or the solver's search tree.
                        const enumerate = (suffix: number[]): boolean => {
                            const roster = [...existing, ...suffix.map((index) => candidates[index])];
                            if (roster.length === 4) return !!Engine.evaluateDefinition(def, roster, gs, bounds)?.valid;
                            return candidates.some(
                                (_, index) =>
                                    (allowRepeatedCandidates || !suffix.includes(index)) &&
                                    enumerate([...suffix, index]),
                            );
                        };
                        const possible = enumerate([]);
                        const result = Engine.findCompletion(def, existing, candidates, gs, {
                            ...bounds,
                            allowRepeatedCandidates,
                            maxNodes: 1000,
                        });
                        expect(result.status)
                            .withContext(`${gs}/${def.id}/${existing.length}/${allowRepeatedCandidates}`)
                            .toBe(possible ? 'complete' : 'impossible');
                        if (result.status === 'complete') {
                            expect(
                                Engine.evaluateDefinition(
                                    def,
                                    [...existing, ...result.candidateIndexes.map((index) => candidates[index])],
                                    gs,
                                    bounds,
                                )?.valid,
                            ).toBeTrue();
                            if (!allowRepeatedCandidates)
                                expect(new Set(result.candidateIndexes).size).toBe(result.candidateIndexes.length);
                        }
                    }
                }
            }
        }
    });

    it('preserves a viable OR branch and does not add overlapping deficits', () => {
        const result = evaluate(
            [
                {
                    id: 'choice',
                    kind: 'any-of',
                    label: 'Either',
                    constraints: [
                        { id: 'bad', kind: 'all', predicate: 'infantry-unit', label: 'Infantry' },
                        { id: 'good', kind: 'count-min', predicate: 'scout-role', count: 1, label: 'Scout' },
                    ],
                },
            ],
            [unit()],
            2,
        );
        expect(result.status).toBe('partial');
        expect(Engine.getDeficits(result).map((d) => d.constraintId)).toEqual(['good']);
        const overlapping = evaluate(
            [
                { id: 'scout', kind: 'count-min', predicate: 'scout-role', count: 1, label: 'Scout' },
                { id: 'role', kind: 'count-min', predicate: 'scout-or-striker-role', count: 1, label: 'Role' },
            ],
            [unit()],
            2,
        );
        expect(overlapping.status).toBe('partial');
        expect(overlapping.minimumAdditions).toBe(1);
    });

    it('shows all equality groups without arbitrarily blaming one model', () => {
        const result = evaluate(
            [
                {
                    id: 'same',
                    kind: 'same-value',
                    label: 'Same chassis',
                    factByGameSystem: { [GameSystem.AS]: 'chassis' },
                },
            ],
            [unit({ chassis: 'A' }), unit({ chassis: 'B' }), unit({ chassis: 'B' })],
        );
        expect(result.constraints[0].valueGroups).toEqual([
            { value: 'A', unitIndexes: [0] },
            { value: 'B', unitIndexes: [1, 2] },
        ]);
    });

    it('computes percent completion bounds against an independent enumeration oracle', () => {
        for (const rounding of ['ceil', 'normal', 'strict-majority'] as const) {
            for (const ratio of [0.25, 0.5, 0.75, 1])
                for (let size = 0; size <= 8; size++)
                    for (let matches = 0; matches <= size; matches++) {
                        const units = Array.from({ length: size }, (_, i) =>
                            unit({ role: i < matches ? 'Scout' : 'Brawler' }),
                        );
                        const constraint = {
                            id: 'quota',
                            kind: 'percent-min' as const,
                            predicate: 'scout-role' as const,
                            label: 'Quota',
                            rounding,
                            ratio,
                        };
                        const required = (n: number) =>
                            rounding === 'ceil'
                                ? Math.ceil(n * ratio)
                                : rounding === 'normal'
                                  ? Math.round(n * ratio)
                                  : Math.floor(n / 2) + 1;
                        for (let max = size; max <= size + 4; max++) {
                            const canComplete = Array.from(
                                { length: max - size + 1 },
                                (_, added) => matches + added >= required(size + added),
                            ).some(Boolean);
                            const result = evaluate([constraint], units, max);
                            expect(result.status !== 'invalid')
                                .withContext(JSON.stringify({ rounding, ratio, size, matches, max }))
                                .toBe(canComplete);
                        }
                    }
        }
    });

    it('compiles the current roster once per prepared search and observes changes in a new operation', () => {
        const current = unit({ chassis: 'A' });
        const read = spyOn(current, 'getFormationSummary').and.callThrough();
        const search = Engine.prepareSearch(definition('order-lance'), [current], GameSystem.AS);
        for (let i = 0; i < 100; i++) search.evaluateCandidate(unit({ chassis: 'A' }));
        expect(read).toHaveBeenCalledTimes(1);
        read.and.returnValue(createEmptyUnit({ chassis: 'B' }));
        const changed = Engine.prepareSearch(definition('order-lance'), [current], GameSystem.AS);
        expect(changed.evaluateCandidate(unit({ chassis: 'A' })).allowed).toBeFalse();
    });

    it('never rejects a construction step with a known valid four-unit completion', () => {
        const pool = [
            unit({
                role: 'Scout',
                weightClass: 'Light',
                walk: 8,
                as: { SZ: 1, MVm: { '': 16 }, dmg: { _dmgS: 3, _dmgM: 2, _dmgL: 2 } },
            }),
            unit({
                role: 'Sniper',
                weightClass: 'Heavy',
                armor: 160,
                walk: 5,
                as: { SZ: 3, Arm: 8, MVm: { '': 10 }, dmg: { _dmgS: 4, _dmgM: 4, _dmgL: 3 } },
            }),
            unit({
                role: 'Brawler',
                weightClass: 'Heavy',
                armor: 160,
                walk: 5,
                as: { SZ: 3, Arm: 8, MVm: { '': 10 }, dmg: { _dmgS: 4, _dmgM: 4, _dmgL: 3 } },
            }),
            unit({ role: 'Juggernaut', weightClass: 'Light', as: { SZ: 1 } }),
            unit({ role: 'Sniper', type: 'Tank', weightClass: 'Heavy', as: { TP: 'CV', SZ: 3 } }),
            unit({ type: 'Infantry', subtype: 'Battle Armor', as: { TP: 'BA', SZ: 1 } }),
            unit({ type: 'Aero', subtype: 'Aerospace Fighter', role: 'Interceptor', as: { TP: 'AF', SZ: 2 } }),
            unit({ as: { specials: ['ART-LT'] } }),
        ];
        const rejected: string[] = [];
        let checked = 0;
        for (const gs of [GameSystem.AS, GameSystem.CBT])
            for (const def of getFormationDefinitions(gs)) {
                if (def.minUnits > 4 || (def.maxUnits ?? Infinity) < 4) continue;
                for (let a = 0; a < pool.length; a++)
                    for (let b = a; b < pool.length; b++)
                        for (let c = b; c < pool.length; c++)
                            for (let d = c; d < pool.length; d++) {
                                const roster = [pool[a], pool[b], pool[c], pool[d]];
                                if (!Engine.evaluateDefinition(def, roster, gs)?.valid) continue;
                                for (let size = 0; size < 4; size++) {
                                    checked++;
                                    if (
                                        !Engine.prepareSearch(def, roster.slice(0, size), gs, {
                                            minUnits: 4,
                                            maxUnits: 4,
                                        }).evaluateCandidate(roster[size]).allowed
                                    )
                                        rejected.push(`${gs}/${def.id}/${a},${b},${c},${d}/${size}`);
                                }
                            }
            }
        expect(checked).toBeGreaterThan(10_000);
        expect(rejected).toEqual([]);
    });
});
