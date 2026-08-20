// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import { signal } from '@angular/core';
import { GameSystem } from '../models/common.model';
import { type Faction } from '../models/factions.model';
import type { ASForceUnit } from '../models/as-force-unit.model';
import type { UnitGroup } from '../models/force.model';
import type { Unit, UnitSubtype } from '../models/units.model';
import { createEmptyUnit, type TestUnitOverrides } from '../testing/unit-test-helpers';
import { FormationAbilityAssignmentUtil } from './formation-ability-assignment.util';
import { LanceTypeIdentifierUtil } from './lance-type-identifier.util';
import type { FormationTypeDefinition } from './formation-type.model';
import type { GroupSizeResult } from './org/org-types';
import { MULFACTION_MERCENARY, type FactionAffinity } from '../models/mulfactions.model';
import { PILOT_ABILITIES } from '../models/pilot-abilities.model';
import { isFormationTargetCopyBonusActive } from './formation-target.util';

function createUnit(
    id: number,
    name: string,
    unitType: Unit['type'],
    subtype: UnitSubtype,
    tp: Unit['as']['TP'],
    overrides: TestUnitOverrides = {},
): Unit {
    const { as: asOverrides, ...unitOverrides } = overrides;

    return createEmptyUnit({
        id,
        name,
        chassis: name,
        model: name,
        year: 3050,
        weightClass: 'Heavy',
        tons: 70,
        type: unitType,
        subtype,
        role: 'Brawler',
        moveType: unitType === 'Aero' ? 'Aerodyne' : 'Tracked',
        ...unitOverrides,
        as: {
            TP: tp,
            SZ: tp === 'AF' ? 2 : tp === 'BA' ? 1 : 3,
            ...asOverrides,
        },
    });
}

function createFaction(name: string, group: FactionAffinity): Faction {
    return {
        id: group === 'Mercenary' ? MULFACTION_MERCENARY : 1,
        name,
        group,
        img: '',
        eras: {},
    };
}

function createResolvedGroup(overrides: Partial<GroupSizeResult>): GroupSizeResult {
    return {
        name: 'Group',
        type: null,
        modifierKey: '',
        countsAsType: null,
        tier: 0,
        ...overrides,
    };
}

function createASForceUnit(
    id: string,
    unit: Unit,
    options: { formationAbilities?: string[]; commander?: boolean } = {},
): ASForceUnit {
    let formationAbilities = [...(options.formationAbilities ?? [])];
    let commander = options.commander ?? false;
    let destroyed = false;

    return {
        id,
        get destroyed() { return destroyed; },
        getUnit: () => unit,
        formationAbilities: () => formationAbilities,
        commander: () => commander,
        setFormationAbilities: (next: string[]) => {
            formationAbilities = [...next];
        },
        setFormationCommander: (next: boolean) => {
            commander = next;
        },
        setDestroyed: (next: boolean) => {
            destroyed = next;
        },
    } as unknown as ASForceUnit;
}

function createGroup(
    units: readonly ASForceUnit[],
    formation: FormationTypeDefinition | null,
    resolvedGroups: readonly GroupSizeResult[],
    faction: Faction,
): UnitGroup<ASForceUnit> {
    let group!: UnitGroup<ASForceUnit>;
    const force = {
        faction: () => faction,
        era: () => null,
        gameSystem: GameSystem.ALPHA_STRIKE,
        groups: () => [group],
    };

    group = {
        id: `group-${units[0]?.id ?? 'empty'}`,
        force,
        units: () => [...units],
        activeFormation: () => formation,
        formationTargetGroupId: signal<string | null>(null),
        organizationalResult: () => ({
            name: resolvedGroups.map((group) => group.name).join(' + '),
            tier: resolvedGroups[0]?.tier ?? 0,
            groups: resolvedGroups,
        }),
    } as unknown as UnitGroup<ASForceUnit>;
    return group;
}

function linkGroups(groups: readonly UnitGroup<ASForceUnit>[]): void {
    const firstForce = groups[0]?.force;
    if (!firstForce) return;
    const sharedForce = {
        faction: firstForce.faction,
        era: firstForce.era,
        gameSystem: GameSystem.ALPHA_STRIKE,
        groups: () => [...groups],
    };
    for (const group of groups) {
        (group as unknown as { force: typeof sharedForce }).force = sharedForce;
    }
}

function getFormation(id: string): FormationTypeDefinition {
    const formation = LanceTypeIdentifierUtil.getDefinitionById(id, GameSystem.ALPHA_STRIKE);
    if (!formation) {
        throw new Error(`Formation ${id} not found`);
    }
    return formation;
}

describe('FormationAbilityAssignmentUtil', () => {
    it('includes inherited parent effect groups for child formations', () => {
        const formation = getFormation('fast-assault-lance');
        const units = [
            createASForceUnit('unit-1', createUnit(1, 'Atlas', 'Mek', 'BattleMek', 'BM')),
            createASForceUnit('unit-2', createUnit(2, 'Banshee', 'Mek', 'BattleMek', 'BM')),
            createASForceUnit('unit-3', createUnit(3, 'Highlander', 'Mek', 'BattleMek', 'BM')),
        ];
        const group = createGroup(
            units,
            formation,
            [createResolvedGroup({ name: 'Lance', type: 'Lance', tier: 1, units: units.map((unit) => unit.getUnit()) })],
            createFaction('Mercenary', 'Mercenary'),
        );

        const preview = FormationAbilityAssignmentUtil.previewGroupFormationAssignments(group);

        expect(preview.effectPreviews.map((effect) => effect.descriptor.sourceFormationId)).toEqual([
            'assault-lance',
            'fast-assault-lance',
        ]);
    });

    it('does not include parent effect groups unless the child opts in', () => {
        const formation = getFormation('anti-air-lance');
        const units = [
            createASForceUnit('unit-1', createUnit(1, 'Rifleman', 'Mek', 'BattleMek', 'BM')),
            createASForceUnit('unit-2', createUnit(2, 'JagerMech', 'Mek', 'BattleMek', 'BM')),
            createASForceUnit('unit-3', createUnit(3, 'Catapult', 'Mek', 'BattleMek', 'BM')),
        ];
        const group = createGroup(
            units,
            formation,
            [createResolvedGroup({ name: 'Lance', type: 'Lance', tier: 1, units: units.map((unit) => unit.getUnit()) })],
            createFaction('Mercenary', 'Mercenary'),
        );

        const preview = FormationAbilityAssignmentUtil.previewGroupFormationAssignments(group);

        expect(preview.effectPreviews.map((effect) => effect.descriptor.sourceFormationId)).toEqual(['anti-air-lance']);
    });

    it('exposes computed Lucky shared-pool levels for every Battle variant', () => {
        const formationIds = [
            'battle-lance',
            'light-battle-lance',
            'medium-battle-lance',
            'heavy-battle-lance',
        ];

        for (const formationId of formationIds) {
            const units = Array.from({ length: 3 }, (_, index) =>
                createASForceUnit(`unit-${index + 1}`, createUnit(index + 1, `${formationId}-${index}`, 'Mek', 'BattleMek', 'BM')),
            );
            const group = createGroup(
                units,
                getFormation(formationId),
                [createResolvedGroup({ name: 'Lance', type: 'Lance', tier: 1, units: units.map((unit) => unit.getUnit()) })],
                createFaction('Mercenary', 'Mercenary'),
            );

            const preview = FormationAbilityAssignmentUtil.previewGroupFormationAssignments(group);
            expect(preview.sharedPoolPreviews).toEqual([
                jasmine.objectContaining({
                    formationUnitCount: 3,
                    resolvedLevel: 5,
                    totalUsesPerScenario: null,
                    maxUsesPerUnitPerScenario: 4,
                    stacksWithIndividualAbility: true,
                }),
            ]);
            expect(preview.assignmentsByUnitId.get('unit-1')).toEqual([]);
        }
    });

    it('exposes the Phalanx six-use Float Like a Butterfly pool and leveled ability metadata', () => {
        const units = Array.from({ length: 5 }, (_, index) =>
            createASForceUnit(`unit-${index + 1}`, createUnit(index + 1, `Phalanx-${index}`, 'Mek', 'BattleMek', 'BM')),
        );
        const group = createGroup(
            units,
            getFormation('phalanx-star'),
            [createResolvedGroup({ name: 'Star', type: 'Star', tier: 1, units: units.map((unit) => unit.getUnit()) })],
            createFaction('Clan', 'Mercenary'),
        );

        const preview = FormationAbilityAssignmentUtil.previewGroupFormationAssignments(group);
        expect(preview.sharedPoolPreviews).toEqual([
            jasmine.objectContaining({
                formationUnitCount: 5,
                resolvedLevel: null,
                totalUsesPerScenario: 6,
                maxUsesPerUnitPerScenario: null,
                stacksWithIndividualAbility: false,
            }),
        ]);

        expect(PILOT_ABILITIES.filter((ability) => ability.levelGroup === 'lucky').map((ability) => ability.level)).toEqual([1, 2, 3, 4]);
        expect(PILOT_ABILITIES.filter((ability) => ability.levelGroup === 'float_like_a_butterfly').map((ability) => ability.level)).toEqual([1, 2, 3, 4]);
    });

    it('uses Alpha Strike half-round-down limits for Anti-Air command ability assignments', () => {
        const formation = getFormation('anti-air-lance');
        const units = [
            createASForceUnit('unit-1', createUnit(1, 'Rifleman', 'Mek', 'BattleMek', 'BM'), {
                formationAbilities: ['anti_aircraft_specialists'],
            }),
            createASForceUnit('unit-2', createUnit(2, 'JagerMech', 'Mek', 'BattleMek', 'BM'), {
                formationAbilities: ['anti_aircraft_specialists'],
            }),
            createASForceUnit('unit-3', createUnit(3, 'Catapult', 'Mek', 'BattleMek', 'BM')),
        ];
        const group = createGroup(
            units,
            formation,
            [createResolvedGroup({ name: 'Lance', type: 'Lance', tier: 1, units: units.map((unit) => unit.getUnit()) })],
            createFaction('Mercenary', 'Mercenary'),
        );

        const preview = FormationAbilityAssignmentUtil.previewGroupFormationAssignments(group);

        expect(preview.effectPreviews).toEqual([
            jasmine.objectContaining({
                recipientLimit: 1,
                recipientUnitIds: ['unit-1'],
            }),
        ]);
        expect(preview.assignmentsByUnitId.get('unit-1')).toEqual(['anti_aircraft_specialists']);
        expect(preview.assignmentsByUnitId.get('unit-2')).toEqual([]);
        expect(preview.assignmentsByUnitId.get('unit-3')).toEqual([]);
    });

    it('filters structurally ineligible Air Lance units out of formation bonus recipients', () => {
        const formation = getFormation('command-lance');
        const bmUnits = [
            createASForceUnit('bm-1', createUnit(1, 'Atlas', 'Mek', 'BattleMek', 'BM')),
            createASForceUnit('bm-2', createUnit(2, 'Banshee', 'Mek', 'BattleMek', 'BM')),
        ];
        const flightUnits = [
            createASForceUnit('flight-1', createUnit(10, 'Corsair', 'Aero', 'Aerospace Fighter', 'AF', { role: 'Interceptor', as: { MVm: { a: 12 } } })),
            createASForceUnit('flight-2', createUnit(11, 'Lucifer', 'Aero', 'Aerospace Fighter', 'AF', { role: 'Interceptor', as: { MVm: { a: 10 } } })),
        ];
        const allUnits = [...flightUnits, ...bmUnits];
        const group = createGroup(
            allUnits,
            formation,
            [createResolvedGroup({
                name: 'Air Lance',
                type: 'Air Lance',
                countsAsType: 'Lance',
                tier: 1.5,
                children: [
                    createResolvedGroup({ name: 'Flight', type: 'Flight', tier: 1, units: flightUnits.map((unit) => unit.getUnit()) }),
                    createResolvedGroup({ name: 'Lance', type: 'Lance', tier: 1, units: bmUnits.map((unit) => unit.getUnit()) }),
                ],
            })],
            createFaction('Mercenary', 'Mercenary'),
        );

        const preview = FormationAbilityAssignmentUtil.previewGroupFormationAssignments(group, {
            abilityOverrides: new Map([[flightUnits[0].id, ['tactical_genius']]]),
            commanderUnitId: bmUnits[0].id,
        });

        expect(preview.eligibleUnitIds).toEqual(['bm-1', 'bm-2']);
        expect(preview.assignmentsByUnitId.get(flightUnits[0].id)).toEqual([]);
        expect(preview.effectPreviews.every((effect) => !effect.candidateUnitIds.includes(flightUnits[0].id))).toBeTrue();
    });

    it('allows the Alpha Strike commander to receive a selected SPA in addition to Tactical Genius', () => {
        const formation = getFormation('command-lance');
        const commander = createASForceUnit('unit-1', createUnit(1, 'Atlas', 'Mek', 'BattleMek', 'BM'), {
            formationAbilities: ['antagonizer', 'tactical_genius'],
            commander: true,
        });
        const wingman = createASForceUnit('unit-2', createUnit(2, 'Banshee', 'Mek', 'BattleMek', 'BM'), {
            formationAbilities: ['marksman'],
        });
        const support = createASForceUnit('unit-3', createUnit(3, 'Highlander', 'Mek', 'BattleMek', 'BM'));
        const group = createGroup(
            [commander, wingman, support],
            formation,
            [createResolvedGroup({ name: 'Lance', type: 'Lance', tier: 1, units: [commander.getUnit(), wingman.getUnit(), support.getUnit()] })],
            createFaction('Mercenary', 'Mercenary'),
        );

        FormationAbilityAssignmentUtil.reconcileGroupFormationAssignments(group);

        expect(commander.formationAbilities()).toEqual(['antagonizer', 'tactical_genius']);
        expect(wingman.formationAbilities()).toEqual(['marksman']);
    });

    it('lets any unit become commander and moves commander-only assignments with that override', () => {
        const formation = getFormation('command-lance');
        const unitA = createASForceUnit('unit-a', createUnit(1, 'Atlas', 'Mek', 'BattleMek', 'BM'), {
            commander: true,
            formationAbilities: ['tactical_genius'],
        });
        const unitB = createASForceUnit('unit-b', createUnit(2, 'Banshee', 'Mek', 'BattleMek', 'BM'), {
            formationAbilities: ['marksman'],
        });
        const unitC = createASForceUnit('unit-c', createUnit(3, 'Highlander', 'Mek', 'BattleMek', 'BM'));
        const group = createGroup(
            [unitA, unitB, unitC],
            formation,
            [createResolvedGroup({ name: 'Lance', type: 'Lance', tier: 1, units: [unitA.getUnit(), unitB.getUnit(), unitC.getUnit()] })],
            createFaction('Mercenary', 'Mercenary'),
        );

        FormationAbilityAssignmentUtil.reconcileGroupFormationAssignments(group, {
            commanderUnitId: unitB.id,
            abilityOverrides: new Map([[unitB.id, ['marksman', 'tactical_genius']]]),
        });

        expect(unitA.commander()).toBeFalse();
        expect(unitB.commander()).toBeTrue();
        expect(unitA.formationAbilities()).toEqual([]);
        expect(unitB.formationAbilities()).toEqual(['marksman', 'tactical_genius']);
    });

    it('keeps one selected Alpha Strike Recon SPA on every unit', () => {
        const formation = getFormation('recon-lance');
        const units = [
            createASForceUnit('unit-1', createUnit(1, 'Locust', 'Mek', 'BattleMek', 'BM', { role: 'Scout', as: { SZ: 1, MVm: { g: 12 } } }), { formationAbilities: ['forward_observer'] }),
            createASForceUnit('unit-2', createUnit(2, 'Stinger', 'Mek', 'BattleMek', 'BM', { role: 'Scout', as: { SZ: 1, MVm: { g: 14 } } }), { formationAbilities: ['forward_observer'] }),
            createASForceUnit('unit-3', createUnit(3, 'Wasp', 'Mek', 'BattleMek', 'BM', { role: 'Scout', as: { SZ: 1, MVm: { g: 12 } } }), { formationAbilities: ['forward_observer'] }),
        ];
        const group = createGroup(
            units,
            formation,
            [createResolvedGroup({ name: 'Lance', type: 'Lance', tier: 1, units: units.map((unit) => unit.getUnit()) })],
            createFaction('Mercenary', 'Mercenary'),
        );

        const preview = FormationAbilityAssignmentUtil.previewGroupFormationAssignments(group);

        expect(preview.assignmentsByUnitId.get('unit-1')).toEqual(['forward_observer']);
        expect(preview.assignmentsByUnitId.get('unit-2')).toEqual(['forward_observer']);
        expect(preview.assignmentsByUnitId.get('unit-3')).toEqual(['forward_observer']);
    });

    it('lets an explicit override clear an automatic choose-one selection for all recipients', () => {
        const formation = getFormation('recon-lance');
        const units = [
            createASForceUnit('unit-1', createUnit(1, 'Locust', 'Mek', 'BattleMek', 'BM', { role: 'Scout', as: { SZ: 1, MVm: { g: 12 } } }), { formationAbilities: ['eagles_eyes'] }),
            createASForceUnit('unit-2', createUnit(2, 'Stinger', 'Mek', 'BattleMek', 'BM', { role: 'Scout', as: { SZ: 1, MVm: { g: 14 } } }), { formationAbilities: ['eagles_eyes'] }),
            createASForceUnit('unit-3', createUnit(3, 'Wasp', 'Mek', 'BattleMek', 'BM', { role: 'Scout', as: { SZ: 1, MVm: { g: 12 } } }), { formationAbilities: ['eagles_eyes'] }),
        ];
        const group = createGroup(
            units,
            formation,
            [createResolvedGroup({ name: 'Lance', type: 'Lance', tier: 1, units: units.map((unit) => unit.getUnit()) })],
            createFaction('Mercenary', 'Mercenary'),
        );

        const preview = FormationAbilityAssignmentUtil.previewGroupFormationAssignments(group, {
            abilityOverrides: new Map([['unit-1', []]]),
        });

        expect(preview.assignmentsByUnitId.get('unit-1')).toEqual([]);
        expect(preview.assignmentsByUnitId.get('unit-2')).toEqual([]);
        expect(preview.assignmentsByUnitId.get('unit-3')).toEqual([]);
    });

    it('lets an explicit override replace an automatic choose-one selection for all recipients', () => {
        const formation = getFormation('recon-lance');
        const units = [
            createASForceUnit('unit-1', createUnit(1, 'Locust', 'Mek', 'BattleMek', 'BM', { role: 'Scout', as: { SZ: 1, MVm: { g: 12 } } }), { formationAbilities: ['eagles_eyes'] }),
            createASForceUnit('unit-2', createUnit(2, 'Stinger', 'Mek', 'BattleMek', 'BM', { role: 'Scout', as: { SZ: 1, MVm: { g: 14 } } }), { formationAbilities: ['eagles_eyes'] }),
            createASForceUnit('unit-3', createUnit(3, 'Wasp', 'Mek', 'BattleMek', 'BM', { role: 'Scout', as: { SZ: 1, MVm: { g: 12 } } }), { formationAbilities: ['eagles_eyes'] }),
        ];
        const group = createGroup(
            units,
            formation,
            [createResolvedGroup({ name: 'Lance', type: 'Lance', tier: 1, units: units.map((unit) => unit.getUnit()) })],
            createFaction('Mercenary', 'Mercenary'),
        );

        const preview = FormationAbilityAssignmentUtil.previewGroupFormationAssignments(group, {
            abilityOverrides: new Map([['unit-1', ['maneuvering_ace']]]),
        });

        expect(preview.assignmentsByUnitId.get('unit-1')).toEqual(['maneuvering_ace']);
        expect(preview.assignmentsByUnitId.get('unit-2')).toEqual(['maneuvering_ace']);
        expect(preview.assignmentsByUnitId.get('unit-3')).toEqual(['maneuvering_ace']);
    });

    it('allows each Alpha Strike Light Recon unit to choose a different SPA', () => {
        const formation = getFormation('light-recon-lance');
        const units = [
            createASForceUnit('unit-1', createUnit(1, 'Locust', 'Mek', 'BattleMek', 'BM', { role: 'Scout', as: { SZ: 1, MVm: { g: 12 } } }), { formationAbilities: ['eagles_eyes'] }),
            createASForceUnit('unit-2', createUnit(2, 'Stinger', 'Mek', 'BattleMek', 'BM', { role: 'Scout', as: { SZ: 1, MVm: { g: 14 } } }), { formationAbilities: ['forward_observer'] }),
            createASForceUnit('unit-3', createUnit(3, 'Wasp', 'Mek', 'BattleMek', 'BM', { role: 'Scout', as: { SZ: 1, MVm: { g: 12 } } }), { formationAbilities: ['maneuvering_ace'] }),
        ];
        const group = createGroup(
            units,
            formation,
            [createResolvedGroup({ name: 'Lance', type: 'Lance', tier: 1, units: units.map((unit) => unit.getUnit()) })],
            createFaction('Mercenary', 'Mercenary'),
        );

        const preview = FormationAbilityAssignmentUtil.previewGroupFormationAssignments(group);

        expect(preview.assignmentsByUnitId.get('unit-1')).toEqual(['eagles_eyes']);
        expect(preview.assignmentsByUnitId.get('unit-2')).toEqual(['forward_observer']);
        expect(preview.assignmentsByUnitId.get('unit-3')).toEqual(['maneuvering_ace']);
    });

    it('copies a targeted Recon Lance SPA to half the Alpha Strike Support Lance', () => {
        const faction = createFaction('Mercenary', 'Mercenary');
        const reconUnits = Array.from({ length: 3 }, (_, index) =>
            createASForceUnit(`recon-${index + 1}`, createUnit(index + 1, `Recon ${index + 1}`, 'Mek', 'BattleMek', 'BM', {
                role: 'Scout', as: { SZ: 1, MVm: { g: 12 } },
            }), { formationAbilities: ['forward_observer'] }),
        );
        const supportUnits = Array.from({ length: 5 }, (_, index) =>
            createASForceUnit(`support-${index + 1}`, createUnit(index + 10, `Support ${index + 1}`, 'Mek', 'BattleMek', 'BM'), {
                formationAbilities: index < 3 ? ['forward_observer'] : [],
            }),
        );
        const recon = createGroup(reconUnits, getFormation('recon-lance'), [
            createResolvedGroup({ name: 'Lance', type: 'Lance', tier: 1, units: reconUnits.map(unit => unit.getUnit()) }),
        ], faction);
        const support = createGroup(supportUnits, getFormation('support-lance'), [
            createResolvedGroup({ name: 'Lance', type: 'Lance', tier: 1, units: supportUnits.map(unit => unit.getUnit()) }),
        ], faction);
        linkGroups([support, recon]);
        support.formationTargetGroupId.set(recon.id);

        const preview = FormationAbilityAssignmentUtil.previewGroupFormationAssignments(support);

        expect(preview.effectPreviews).toEqual([
            jasmine.objectContaining({
                recipientLimit: 2,
                recipientUnitIds: ['support-1', 'support-2'],
                descriptor: jasmine.objectContaining({
                    copiedFromGroupId: recon.id,
                    copiedFromFormationName: 'Recon',
                }),
            }),
        ]);
        expect(preview.assignmentsByUnitId.get('support-1')).toEqual(['forward_observer']);
        expect(preview.assignmentsByUnitId.get('support-2')).toEqual(['forward_observer']);
        expect(preview.assignmentsByUnitId.get('support-3')).toEqual([]);
    });

    it('caps each copied Support SPA at the number assigned by the targeted formation', () => {
        const faction = createFaction('Mercenary', 'Mercenary');
        const reconUnits = [
            createASForceUnit('recon-1', createUnit(1, 'Recon 1', 'Mek', 'BattleMek', 'BM'), { formationAbilities: ['eagles_eyes'] }),
            createASForceUnit('recon-2', createUnit(2, 'Recon 2', 'Mek', 'BattleMek', 'BM'), { formationAbilities: ['forward_observer'] }),
            createASForceUnit('recon-3', createUnit(3, 'Recon 3', 'Mek', 'BattleMek', 'BM'), { formationAbilities: ['maneuvering_ace'] }),
        ];
        const supportUnits = [
            createASForceUnit('support-1', createUnit(11, 'Support 1', 'Mek', 'BattleMek', 'BM'), { formationAbilities: ['eagles_eyes'] }),
            createASForceUnit('support-2', createUnit(12, 'Support 2', 'Mek', 'BattleMek', 'BM'), { formationAbilities: ['eagles_eyes'] }),
            createASForceUnit('support-3', createUnit(13, 'Support 3', 'Mek', 'BattleMek', 'BM')),
            createASForceUnit('support-4', createUnit(14, 'Support 4', 'Mek', 'BattleMek', 'BM')),
        ];
        const recon = createGroup(reconUnits, getFormation('light-recon-lance'), [
            createResolvedGroup({ name: 'Lance', type: 'Lance', tier: 1, units: reconUnits.map(unit => unit.getUnit()) }),
        ], faction);
        const support = createGroup(supportUnits, getFormation('support-lance'), [
            createResolvedGroup({ name: 'Lance', type: 'Lance', tier: 1, units: supportUnits.map(unit => unit.getUnit()) }),
        ], faction);
        linkGroups([recon, support]);
        support.formationTargetGroupId.set(recon.id);

        const preview = FormationAbilityAssignmentUtil.previewGroupFormationAssignments(support);

        expect(preview.effectPreviews[0].descriptor.maxAssignmentsByAbilityId?.get('eagles_eyes')).toBe(1);
        expect(preview.assignmentsByUnitId.get('support-1')).toEqual(['eagles_eyes']);
        expect(preview.assignmentsByUnitId.get('support-2')).toEqual([]);
    });

    it('copies a supported Battle Lance shared pool without serializing a duplicate pool', () => {
        const faction = createFaction('Mercenary', 'Mercenary');
        const battleUnits = Array.from({ length: 4 }, (_, index) =>
            createASForceUnit(`battle-${index + 1}`, createUnit(index + 1, `Battle ${index + 1}`, 'Mek', 'BattleMek', 'BM')),
        );
        const supportUnits = [
            createASForceUnit('support-1', createUnit(11, 'Support 1', 'Mek', 'BattleMek', 'BM'), { formationAbilities: ['lucky'] }),
            createASForceUnit('support-2', createUnit(12, 'Support 2', 'Mek', 'BattleMek', 'BM'), { formationAbilities: ['lucky'] }),
            createASForceUnit('support-3', createUnit(13, 'Support 3', 'Mek', 'BattleMek', 'BM')),
            createASForceUnit('support-4', createUnit(14, 'Support 4', 'Mek', 'BattleMek', 'BM')),
        ];
        const battle = createGroup(battleUnits, getFormation('battle-lance'), [
            createResolvedGroup({ name: 'Lance', type: 'Lance', tier: 1, units: battleUnits.map(unit => unit.getUnit()) }),
        ], faction);
        const support = createGroup(supportUnits, getFormation('support-lance'), [
            createResolvedGroup({ name: 'Lance', type: 'Lance', tier: 1, units: supportUnits.map(unit => unit.getUnit()) }),
        ], faction);
        linkGroups([battle, support]);
        support.formationTargetGroupId.set(battle.id);

        const preview = FormationAbilityAssignmentUtil.previewGroupFormationAssignments(support);
        const descriptor = preview.effectPreviews[0].descriptor;

        expect(preview.effectPreviews[0].recipientLimit).toBe(2);
        expect(descriptor.abilityIds).toEqual(['lucky']);
        expect(descriptor.maxAssignmentsByAbilityId?.get('lucky')).toBe(1);
        expect(descriptor.copiedSharedPoolByAbilityId?.get('lucky')).toEqual(jasmine.objectContaining({
            formationUnitCount: 4,
            resolvedLevel: 6,
            maxUsesPerUnitPerScenario: 4,
        }));
        expect(preview.assignmentsByUnitId.get('support-1')).toEqual(['lucky']);
        expect(preview.assignmentsByUnitId.get('support-2')).toEqual([]);
    });

    it('does not copy a Special Command Ability as a Support SPA', () => {
        const faction = createFaction('Mercenary', 'Mercenary');
        const antiAirUnits = Array.from({ length: 4 }, (_, index) =>
            createASForceUnit(`anti-air-${index + 1}`, createUnit(index + 1, `Anti-Air ${index + 1}`, 'Mek', 'BattleMek', 'BM'), {
                formationAbilities: index < 2 ? ['anti_aircraft_specialists'] : [],
            }),
        );
        const supportUnits = Array.from({ length: 4 }, (_, index) =>
            createASForceUnit(`support-${index + 1}`, createUnit(index + 10, `Support ${index + 1}`, 'Mek', 'BattleMek', 'BM'), {
                formationAbilities: index === 0 ? ['anti_aircraft_specialists'] : [],
            }),
        );
        const antiAir = createGroup(antiAirUnits, getFormation('anti-air-lance'), [
            createResolvedGroup({ name: 'Lance', type: 'Lance', tier: 1, units: antiAirUnits.map(unit => unit.getUnit()) }),
        ], faction);
        const support = createGroup(supportUnits, getFormation('support-lance'), [
            createResolvedGroup({ name: 'Lance', type: 'Lance', tier: 1, units: supportUnits.map(unit => unit.getUnit()) }),
        ], faction);
        linkGroups([antiAir, support]);
        support.formationTargetGroupId.set(antiAir.id);

        const preview = FormationAbilityAssignmentUtil.reconcileGroupFormationAssignments(support);

        expect(preview.effectPreviews).toEqual([]);
        expect(supportUnits[0].formationAbilities()).toEqual([]);
    });

    it('retains the Support setup choice when a source bonus rotates per turn', () => {
        const faction = createFaction('Federated Suns', 'Mercenary');
        const rifleUnits = [
            createASForceUnit('rifle-1', createUnit(1, 'Rifle 1', 'Mek', 'BattleMek', 'BM'), { formationAbilities: ['weapon_specialist'] }),
            createASForceUnit('rifle-2', createUnit(2, 'Rifle 2', 'Mek', 'BattleMek', 'BM'), { formationAbilities: ['weapon_specialist'] }),
            createASForceUnit('rifle-3', createUnit(3, 'Rifle 3', 'Mek', 'BattleMek', 'BM')),
        ];
        const supportUnits = [
            createASForceUnit('support-1', createUnit(11, 'Support 1', 'Mek', 'BattleMek', 'BM'), { formationAbilities: ['sandblaster'] }),
            createASForceUnit('support-2', createUnit(12, 'Support 2', 'Mek', 'BattleMek', 'BM')),
            createASForceUnit('support-3', createUnit(13, 'Support 3', 'Mek', 'BattleMek', 'BM')),
            createASForceUnit('support-4', createUnit(14, 'Support 4', 'Mek', 'BattleMek', 'BM')),
        ];
        const rifle = createGroup(rifleUnits, getFormation('rifle-lance'), [
            createResolvedGroup({ name: 'Lance', type: 'Lance', tier: 1, units: rifleUnits.map(unit => unit.getUnit()) }),
        ], faction);
        const support = createGroup(supportUnits, getFormation('support-lance'), [
            createResolvedGroup({ name: 'Lance', type: 'Lance', tier: 1, units: supportUnits.map(unit => unit.getUnit()) }),
        ], faction);
        linkGroups([rifle, support]);
        support.formationTargetGroupId.set(rifle.id);

        const preview = FormationAbilityAssignmentUtil.previewGroupFormationAssignments(support);

        expect(preview.effectPreviews[0].descriptor.abilityIds).toEqual(['weapon_specialist', 'sandblaster']);
        expect(preview.effectPreviews[0].descriptor.maxAssignmentsByAbilityId?.get('sandblaster')).toBe(1);
        expect(preview.assignmentsByUnitId.get('support-1')).toEqual(['sandblaster']);
    });

    it('keeps Support setup choices serialized but deactivates them below three active units', () => {
        const faction = createFaction('Mercenary', 'Mercenary');
        const sourceUnits = Array.from({ length: 3 }, (_, index) =>
            createASForceUnit(`source-${index + 1}`, createUnit(index + 1, `Source ${index + 1}`, 'Mek', 'BattleMek', 'BM'), {
                formationAbilities: ['eagles_eyes'],
            }),
        );
        const supportUnits = [
            createASForceUnit('support-1', createUnit(11, 'Support 1', 'Mek', 'BattleMek', 'BM'), { formationAbilities: ['eagles_eyes'] }),
            createASForceUnit('support-2', createUnit(12, 'Support 2', 'Mek', 'BattleMek', 'BM')),
            createASForceUnit('support-3', createUnit(13, 'Support 3', 'Mek', 'BattleMek', 'BM')),
        ];
        const source = createGroup(sourceUnits, getFormation('recon-lance'), [
            createResolvedGroup({ name: 'Lance', type: 'Lance', tier: 1, units: sourceUnits.map(unit => unit.getUnit()) }),
        ], faction);
        const support = createGroup(supportUnits, getFormation('support-lance'), [
            createResolvedGroup({ name: 'Lance', type: 'Lance', tier: 1, units: supportUnits.map(unit => unit.getUnit()) }),
        ], faction);
        linkGroups([source, support]);
        support.formationTargetGroupId.set(source.id);

        expect(isFormationTargetCopyBonusActive(support)).toBeTrue();
        supportUnits[2].setDestroyed(true);
        expect(isFormationTargetCopyBonusActive(support)).toBeFalse();
        expect(supportUnits[0].formationAbilities()).toEqual(['eagles_eyes']);
        supportUnits[2].setDestroyed(false);
        expect(isFormationTargetCopyBonusActive(support)).toBeTrue();
        support.formationTargetGroupId.set(null);
        expect(isFormationTargetCopyBonusActive(support)).toBeFalse();
    });

    it('removes a copied SPA from Support units that are not appropriate for that ability', () => {
        const faction = createFaction('Mercenary', 'Mercenary');
        const sourceUnits = Array.from({ length: 3 }, (_, index) =>
            createASForceUnit(`source-${index + 1}`, createUnit(index + 1, `Source ${index + 1}`, 'Mek', 'BattleMek', 'BM'), {
                formationAbilities: index < 2 ? ['swordsman'] : [],
            }),
        );
        const supportUnits = [
            createASForceUnit('support-cv', createUnit(11, 'Support Vehicle', 'Tank', 'Combat Vehicle', 'CV'), { formationAbilities: ['swordsman'] }),
            createASForceUnit('support-bm', createUnit(12, 'Support Mek', 'Mek', 'BattleMek', 'BM'), { formationAbilities: ['swordsman'] }),
            createASForceUnit('support-3', createUnit(13, 'Support 3', 'Mek', 'BattleMek', 'BM')),
            createASForceUnit('support-4', createUnit(14, 'Support 4', 'Mek', 'BattleMek', 'BM')),
        ];
        const source = createGroup(sourceUnits, getFormation('berserker-lance'), [
            createResolvedGroup({ name: 'Lance', type: 'Lance', tier: 1, units: sourceUnits.map(unit => unit.getUnit()) }),
        ], faction);
        const support = createGroup(supportUnits, getFormation('support-lance'), [
            createResolvedGroup({ name: 'Lance', type: 'Lance', tier: 1, units: supportUnits.map(unit => unit.getUnit()) }),
        ], faction);
        linkGroups([source, support]);
        support.formationTargetGroupId.set(source.id);

        const preview = FormationAbilityAssignmentUtil.previewGroupFormationAssignments(support);

        expect(preview.assignmentsByUnitId.get('support-cv')).toEqual([]);
        expect(preview.assignmentsByUnitId.get('support-bm')).toEqual(['swordsman']);
    });

    it('uses the Command Lance exception and never copies the commander or Tactical Genius', () => {
        const faction = createFaction('Mercenary', 'Mercenary');
        const commandUnits = [
            createASForceUnit('command-1', createUnit(1, 'Command 1', 'Mek', 'BattleMek', 'BM'), { formationAbilities: ['marksman'] }),
            createASForceUnit('command-2', createUnit(2, 'Command 2', 'Mek', 'BattleMek', 'BM'), { formationAbilities: ['eagles_eyes'] }),
            createASForceUnit('command-3', createUnit(3, 'Command 3', 'Mek', 'BattleMek', 'BM'), { formationAbilities: ['blood_stalker'] }),
            createASForceUnit('commander', createUnit(4, 'Commander', 'Mek', 'BattleMek', 'BM'), { formationAbilities: ['tactical_genius'], commander: true }),
            createASForceUnit('command-5', createUnit(5, 'Command 5', 'Mek', 'BattleMek', 'BM')),
        ];
        const supportUnits = [
            createASForceUnit('support-1', createUnit(11, 'Support 1', 'Mek', 'BattleMek', 'BM'), { formationAbilities: ['marksman'] }),
            createASForceUnit('support-2', createUnit(12, 'Support 2', 'Mek', 'BattleMek', 'BM'), { formationAbilities: ['eagles_eyes'] }),
            createASForceUnit('support-3', createUnit(13, 'Support 3', 'Mek', 'BattleMek', 'BM'), { formationAbilities: ['tactical_genius'] }),
        ];
        const command = createGroup(commandUnits, getFormation('command-lance'), [
            createResolvedGroup({ name: 'Lance', type: 'Lance', tier: 1, units: commandUnits.map(unit => unit.getUnit()) }),
        ], faction);
        const support = createGroup(supportUnits, getFormation('support-lance'), [
            createResolvedGroup({ name: 'Lance', type: 'Lance', tier: 1, units: supportUnits.map(unit => unit.getUnit()) }),
        ], faction);
        linkGroups([support, command]);
        support.formationTargetGroupId.set(command.id);

        for (const unit of supportUnits) {
            unit.setFormationAbilities([]);
        }
        const setupPreview = FormationAbilityAssignmentUtil.previewGroupFormationAssignments(support);
        expect(setupPreview.effectPreviews[0].descriptor.abilityIds).toEqual([
            'marksman',
            'eagles_eyes',
            'blood_stalker',
        ]);

        supportUnits[0].setFormationAbilities(['marksman']);
        supportUnits[1].setFormationAbilities(['eagles_eyes']);
        supportUnits[2].setFormationAbilities(['tactical_genius']);
        const preview = FormationAbilityAssignmentUtil.previewGroupFormationAssignments(support);

        expect(preview.effectPreviews[0].recipientLimit).toBe(2);
        expect(preview.effectPreviews[0].maxPerUnit).toBe(1);
        expect(preview.effectPreviews[0].descriptor.abilityIds).toEqual(['marksman', 'eagles_eyes', 'blood_stalker']);
        expect(preview.assignmentsByUnitId.get('support-1')).toEqual(['marksman']);
        expect(preview.assignmentsByUnitId.get('support-2')).toEqual(['eagles_eyes']);
        expect(preview.assignmentsByUnitId.get('support-3')).toEqual([]);
    });

    it('applies the Command exception to a Strategic Command Star', () => {
        const faction = createFaction('Clan', 'Mercenary');
        const commandUnits = [
            createASForceUnit('command-1', createUnit(1, 'Command 1', 'Mek', 'BattleMek', 'BM'), { formationAbilities: ['marksman'] }),
            createASForceUnit('command-2', createUnit(2, 'Command 2', 'Mek', 'BattleMek', 'BM'), { formationAbilities: ['combat_intuition'] }),
            createASForceUnit('command-3', createUnit(3, 'Command 3', 'Mek', 'BattleMek', 'BM')),
            createASForceUnit('commander', createUnit(4, 'Commander', 'Mek', 'BattleMek', 'BM'), { formationAbilities: ['tactical_genius'], commander: true }),
            createASForceUnit('fighter', createUnit(5, 'Fighter', 'Aero', 'Aerospace Fighter', 'AF')),
        ];
        const supportUnits = [
            createASForceUnit('support-1', createUnit(11, 'Support 1', 'Mek', 'BattleMek', 'BM'), { formationAbilities: ['marksman'] }),
            createASForceUnit('support-2', createUnit(12, 'Support 2', 'Mek', 'BattleMek', 'BM'), { formationAbilities: ['combat_intuition'] }),
            createASForceUnit('support-3', createUnit(13, 'Support 3', 'Mek', 'BattleMek', 'BM'), { formationAbilities: ['tactical_genius'] }),
        ];
        const command = createGroup(commandUnits, getFormation('strategic-command-star'), [
            createResolvedGroup({ name: 'Star', type: 'Star', tier: 1, units: commandUnits.map(unit => unit.getUnit()) }),
        ], faction);
        const support = createGroup(supportUnits, getFormation('support-lance'), [
            createResolvedGroup({ name: 'Lance', type: 'Lance', tier: 1, units: supportUnits.map(unit => unit.getUnit()) }),
        ], faction);
        linkGroups([support, command]);
        support.formationTargetGroupId.set(command.id);

        const preview = FormationAbilityAssignmentUtil.previewGroupFormationAssignments(support);

        expect(preview.effectPreviews[0].recipientLimit).toBe(2);
        expect(preview.effectPreviews[0].maxPerUnit).toBe(1);
        expect(preview.effectPreviews[0].descriptor.abilityIds).toEqual(['marksman', 'combat_intuition']);
        expect(preview.assignmentsByUnitId.get('support-1')).toEqual(['marksman']);
        expect(preview.assignmentsByUnitId.get('support-2')).toEqual(['combat_intuition']);
        expect(preview.assignmentsByUnitId.get('support-3')).toEqual([]);
    });

    it('revalidates a targeted Support Lance when a static source assignment changes', () => {
        const faction = createFaction('Mercenary', 'Mercenary');
        const reconUnits = Array.from({ length: 3 }, (_, index) =>
            createASForceUnit(`recon-${index + 1}`, createUnit(index + 1, `Recon ${index + 1}`, 'Mek', 'BattleMek', 'BM'), {
                formationAbilities: ['eagles_eyes'],
            }),
        );
        const supportUnits = [
            createASForceUnit('support-1', createUnit(11, 'Support 1', 'Mek', 'BattleMek', 'BM'), { formationAbilities: ['eagles_eyes'] }),
            createASForceUnit('support-2', createUnit(12, 'Support 2', 'Mek', 'BattleMek', 'BM')),
            createASForceUnit('support-3', createUnit(13, 'Support 3', 'Mek', 'BattleMek', 'BM')),
        ];
        const recon = createGroup(reconUnits, getFormation('recon-lance'), [
            createResolvedGroup({ name: 'Lance', type: 'Lance', tier: 1, units: reconUnits.map(unit => unit.getUnit()) }),
        ], faction);
        const support = createGroup(supportUnits, getFormation('support-lance'), [
            createResolvedGroup({ name: 'Lance', type: 'Lance', tier: 1, units: supportUnits.map(unit => unit.getUnit()) }),
        ], faction);
        linkGroups([support, recon]);
        support.formationTargetGroupId.set(recon.id);

        FormationAbilityAssignmentUtil.reconcileGroupAndDependents(recon, {
            abilityOverrides: new Map([['recon-1', ['maneuvering_ace']]]),
        });

        for (const unit of reconUnits) {
            expect(unit.formationAbilities()).toEqual(['maneuvering_ace']);
        }
        expect(supportUnits[0].formationAbilities()).toEqual([]);
    });

    it('clears a dependent Support snapshot when its source stops being a legal target', () => {
        const faction = createFaction('Mercenary', 'Mercenary');
        const sourceUnits = Array.from({ length: 3 }, (_, index) =>
            createASForceUnit(`source-${index + 1}`, createUnit(index + 1, `Source ${index + 1}`, 'Mek', 'BattleMek', 'BM'), {
                formationAbilities: ['eagles_eyes'],
            }),
        );
        const supportUnits = Array.from({ length: 3 }, (_, index) =>
            createASForceUnit(`support-${index + 1}`, createUnit(index + 10, `Support ${index + 1}`, 'Mek', 'BattleMek', 'BM'), {
                formationAbilities: index === 0 ? ['eagles_eyes'] : [],
            }),
        );
        const source = createGroup(sourceUnits, getFormation('recon-lance'), [
            createResolvedGroup({ name: 'Lance', type: 'Lance', tier: 1, units: sourceUnits.map(unit => unit.getUnit()) }),
        ], faction);
        const support = createGroup(supportUnits, getFormation('support-lance'), [
            createResolvedGroup({ name: 'Lance', type: 'Lance', tier: 1, units: supportUnits.map(unit => unit.getUnit()) }),
        ], faction);
        linkGroups([source, support]);
        support.formationTargetGroupId.set(source.id);
        (source as unknown as { activeFormation: () => FormationTypeDefinition }).activeFormation = () => getFormation('support-lance');

        FormationAbilityAssignmentUtil.reconcileGroupAndDependents(source);

        expect(support.formationTargetGroupId()).toBeNull();
        expect(supportUnits[0].formationAbilities()).toEqual([]);
    });

    it('rejects missing and recursive Support targets and clears stale copied assignments', () => {
        const faction = createFaction('Mercenary', 'Mercenary');
        const firstUnits = [createASForceUnit('support-1', createUnit(1, 'Support 1', 'Mek', 'BattleMek', 'BM'), { formationAbilities: ['marksman'] })];
        const secondUnits = [createASForceUnit('support-2', createUnit(2, 'Support 2', 'Mek', 'BattleMek', 'BM'))];
        const first = createGroup(firstUnits, getFormation('support-lance'), [
            createResolvedGroup({ name: 'Lance', type: 'Lance', tier: 1, units: firstUnits.map(unit => unit.getUnit()) }),
        ], faction);
        const second = createGroup(secondUnits, getFormation('support-lance'), [
            createResolvedGroup({ name: 'Lance', type: 'Lance', tier: 1, units: secondUnits.map(unit => unit.getUnit()) }),
        ], faction);
        linkGroups([first, second]);
        first.formationTargetGroupId.set(second.id);

        const preview = FormationAbilityAssignmentUtil.reconcileGroupFormationAssignments(first);

        expect(preview.effectPreviews).toEqual([]);
        expect(firstUnits[0].formationAbilities()).toEqual([]);
        expect(first.formationTargetGroupId()).toBeNull();
    });

    it('keeps formation-wide Communications Disruption out of unit assignments', () => {
        const formation = getFormation('electronic-warfare-squadron');
        const units = [
            createASForceUnit('unit-1', createUnit(1, 'Sholagar', 'Aero', 'Aerospace Fighter', 'AF', { role: 'Interceptor', as: { MVm: { a: 10 }, specials: ['ECM'] } })),
            createASForceUnit('unit-2', createUnit(2, 'Corsair', 'Aero', 'Aerospace Fighter', 'AF', { role: 'Interceptor', as: { MVm: { a: 10 }, specials: ['PRB'] } })),
            createASForceUnit('unit-3', createUnit(3, 'Lucifer', 'Aero', 'Aerospace Fighter', 'AF', { role: 'Interceptor', as: { MVm: { a: 10 }, specials: ['TAG'] } })),
            createASForceUnit('unit-4', createUnit(4, 'Transit', 'Aero', 'Aerospace Fighter', 'AF', { role: 'Interceptor', as: { MVm: { a: 10 }, specials: ['AECM'] } })),
            createASForceUnit('unit-5', createUnit(5, 'Sabre', 'Aero', 'Aerospace Fighter', 'AF', { role: 'Interceptor', as: { MVm: { a: 10 }, specials: [] } })),
            createASForceUnit('unit-6', createUnit(6, 'Chippewa', 'Aero', 'Aerospace Fighter', 'AF', { role: 'Interceptor', as: { MVm: { a: 10 }, specials: [] } })),
        ];
        const group = createGroup(
            units,
            formation,
            [createResolvedGroup({ name: 'Squadron', type: 'Squadron', tier: 1, units: units.map((unit) => unit.getUnit()) })],
            createFaction('Mercenary', 'Mercenary'),
        );

        const preview = FormationAbilityAssignmentUtil.previewGroupFormationAssignments(group);

        expect(preview.effectPreviews).toEqual([]);
        expect(preview.formationWideAbilities).toEqual([
            jasmine.objectContaining({
                sourceFormationId: 'electronic-warfare-squadron',
                ability: jasmine.objectContaining({
                    id: 'communications_disruption',
                    name: 'Communications Disruption',
                }),
            }),
        ]);
        for (const unit of units) {
            expect(preview.assignmentsByUnitId.get(unit.id)).toEqual([]);
        }
        expect(formation.effectGroups?.[0]?.distribution).toBe('formation-wide');
    });

    it('clears unit formation abilities when the group has no active formation', () => {
        const unit = createASForceUnit('unit-1', createUnit(1, 'Atlas', 'Mek', 'BattleMek', 'BM'), {
            formationAbilities: ['marksman'],
            commander: true,
        });
        const group = createGroup(
            [unit],
            null,
            [createResolvedGroup({ name: 'Lance', type: 'Lance', tier: 1, units: [unit.getUnit()] })],
            createFaction('Mercenary', 'Mercenary'),
        );

        FormationAbilityAssignmentUtil.reconcileGroupFormationAssignments(group);

        expect(unit.formationAbilities()).toEqual([]);
        expect(unit.commander()).toBeTrue();
    });
});
