// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import { signal } from '@angular/core';
import { GameSystem } from '../models/common.model';
import { type Faction } from '../models/factions.model';
import type { ASForceUnit } from '../models/as-force-unit.model';
import type { UnitGroup } from '../models/force.model';
import type { UnitSummary, UnitSubtype } from '../models/unit-summary.model';
import { createEmptyUnit, type TestUnitOverrides } from '../testing/unit-test-helpers';
import { FormationAbilityAssignmentUtil } from './formation-ability-assignment.util';
import { LanceTypeIdentifierUtil } from './lance-type-identifier.util';
import type { FormationTypeDefinition } from './formation-type.model';
import type { GroupSizeResult } from './org/org-types';
import { MULFACTION_MERCENARY, type FactionAffinity } from '../models/mulfactions.model';

function createUnit(
    id: number,
    name: string,
    unitType: UnitSummary['type'],
    subtype: UnitSubtype,
    tp: UnitSummary['as']['TP'],
    overrides: TestUnitOverrides = {},
): UnitSummary {
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
    unit: UnitSummary,
    options: { formationAbilities?: string[]; commander?: boolean } = {},
): ASForceUnit {
    let formationAbilities = [...(options.formationAbilities ?? [])];
    let commander = options.commander ?? false;

    return {
        id,
        getSummary: () => unit,
        getFormationSummary: () => unit,
        formationAbilities: () => formationAbilities,
        commander: () => commander,
        setFormationAbilities: (next: string[]) => {
            formationAbilities = [...next];
        },
        setFormationCommander: (next: boolean) => {
            commander = next;
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
        gameSystem: GameSystem.AS,
        groups: () => [group],
    };

    for (const unit of units) {
        Object.assign(unit as unknown as Record<string, unknown>, { force });
    }
    group = {
        id: 'test-group',
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

function getFormation(id: string): FormationTypeDefinition {
    const formation = LanceTypeIdentifierUtil.getDefinitionById(id, GameSystem.AS);
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
            [createResolvedGroup({ name: 'Lance', type: 'Lance', tier: 1, units: units.map((unit) => unit.getSummary()) })],
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
            [createResolvedGroup({ name: 'Lance', type: 'Lance', tier: 1, units: units.map((unit) => unit.getSummary()) })],
            createFaction('Mercenary', 'Mercenary'),
        );

        const preview = FormationAbilityAssignmentUtil.previewGroupFormationAssignments(group);

        expect(preview.effectPreviews.map((effect) => effect.descriptor.sourceFormationId)).toEqual(['anti-air-lance']);
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
            [createResolvedGroup({ name: 'Lance', type: 'Lance', tier: 1, units: units.map((unit) => unit.getSummary()) })],
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
                    createResolvedGroup({ name: 'Flight', type: 'Flight', tier: 1, units: flightUnits.map((unit) => unit.getSummary()) }),
                    createResolvedGroup({ name: 'Lance', type: 'Lance', tier: 1, units: bmUnits.map((unit) => unit.getSummary()) }),
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
            [createResolvedGroup({ name: 'Lance', type: 'Lance', tier: 1, units: [commander.getSummary(), wingman.getSummary(), support.getSummary()] })],
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
            [createResolvedGroup({ name: 'Lance', type: 'Lance', tier: 1, units: [unitA.getSummary(), unitB.getSummary(), unitC.getSummary()] })],
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
            [createResolvedGroup({ name: 'Lance', type: 'Lance', tier: 1, units: units.map((unit) => unit.getSummary()) })],
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
            createASForceUnit('unit-1', createUnit(1, 'Locust', 'Mek', 'BattleMek', 'BM', { role: 'Scout', as: { SZ: 1, MVm: { g: 12 } } }), {
                formationAbilities: ['eagles_eyes'],
            }),
            createASForceUnit('unit-2', createUnit(2, 'Stinger', 'Mek', 'BattleMek', 'BM', { role: 'Scout', as: { SZ: 1, MVm: { g: 14 } } }), {
                formationAbilities: ['eagles_eyes'],
            }),
            createASForceUnit('unit-3', createUnit(3, 'Wasp', 'Mek', 'BattleMek', 'BM', { role: 'Scout', as: { SZ: 1, MVm: { g: 12 } } }), {
                formationAbilities: ['eagles_eyes'],
            }),
        ];
        const group = createGroup(
            units,
            formation,
            [createResolvedGroup({ name: 'Lance', type: 'Lance', tier: 1, units: units.map((unit) => unit.getSummary()) })],
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
            createASForceUnit('unit-1', createUnit(1, 'Locust', 'Mek', 'BattleMek', 'BM', { role: 'Scout', as: { SZ: 1, MVm: { g: 12 } } }), {
                formationAbilities: ['eagles_eyes'],
            }),
            createASForceUnit('unit-2', createUnit(2, 'Stinger', 'Mek', 'BattleMek', 'BM', { role: 'Scout', as: { SZ: 1, MVm: { g: 14 } } }), {
                formationAbilities: ['eagles_eyes'],
            }),
            createASForceUnit('unit-3', createUnit(3, 'Wasp', 'Mek', 'BattleMek', 'BM', { role: 'Scout', as: { SZ: 1, MVm: { g: 12 } } }), {
                formationAbilities: ['eagles_eyes'],
            }),
        ];
        const group = createGroup(
            units,
            formation,
            [createResolvedGroup({ name: 'Lance', type: 'Lance', tier: 1, units: units.map((unit) => unit.getSummary()) })],
            createFaction('Mercenary', 'Mercenary'),
        );

        const preview = FormationAbilityAssignmentUtil.previewGroupFormationAssignments(group, {
            abilityOverrides: new Map([['unit-1', ['maneuvering_ace']]]),
        });

        expect(preview.assignmentsByUnitId.get('unit-1')).toEqual(['maneuvering_ace']);
        expect(preview.assignmentsByUnitId.get('unit-2')).toEqual(['maneuvering_ace']);
        expect(preview.assignmentsByUnitId.get('unit-3')).toEqual(['maneuvering_ace']);
    });

    it('exposes formation-wide command abilities without serializing them onto units', () => {
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
            [createResolvedGroup({ name: 'Squadron', type: 'Squadron', tier: 1, units: units.map((unit) => unit.getSummary()) })],
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
            [createResolvedGroup({ name: 'Lance', type: 'Lance', tier: 1, units: [unit.getSummary()] })],
            createFaction('Mercenary', 'Mercenary'),
        );

        FormationAbilityAssignmentUtil.reconcileGroupFormationAssignments(group);

        expect(unit.formationAbilities()).toEqual([]);
        expect(unit.commander()).toBeTrue();
    });
});
