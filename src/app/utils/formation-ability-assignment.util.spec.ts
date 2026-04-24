import { GameSystem } from '../models/common.model';
import { type Faction } from '../models/factions.model';
import type { ASForceUnit } from '../models/as-force-unit.model';
import type { UnitGroup } from '../models/force.model';
import type { Unit } from '../models/units.model';
import { FormationAbilityAssignmentUtil } from './formation-ability-assignment.util';
import { LanceTypeIdentifierUtil } from './lance-type-identifier.util';
import type { FormationTypeDefinition } from './formation-type.model';
import type { GroupSizeResult } from './org/org-types';
import { MULFACTION_MERCENARY, type FactionAffinity } from '../models/mulfactions.model';

function createUnit(
    id: number,
    name: string,
    unitType: Unit['type'],
    subtype: string,
    tp: Unit['as']['TP'],
    overrides: Partial<Omit<Unit, 'as'>> & { as?: Partial<Unit['as']> } = {},
): Unit {
    return {
        id,
        name,
        chassis: name,
        model: name,
        year: 3050,
        weightClass: 'Heavy',
        tons: 70,
        offSpeedFactor: 0,
        bv: 0,
        pv: 0,
        cost: 0,
        level: 0,
        techBase: 'Inner Sphere',
        techRating: 'D',
        type: unitType,
        subtype,
        omni: 0,
        engine: 'Fusion',
        engineRating: 0,
        engineHS: 0,
        engineHSType: 'Heat Sink',
        source: [],
        role: 'Brawler',
        armorType: '',
        structureType: '',
        armor: 0,
        armorPer: 0,
        internal: 1,
        heat: 0,
        dissipation: 0,
        moveType: unitType === 'Aero' ? 'a' : 'Tracked',
        walk: 0,
        walk2: 0,
        run: 0,
        run2: 0,
        jump: 0,
        umu: 0,
        c3: '',
        dpt: 0,
        comp: [],
        su: 0,
        crewSize: 1,
        quirks: [],
        features: [],
        icon: '',
        sheets: [],
        ...overrides,
        as: {
            TP: tp,
            PV: 0,
            SZ: tp === 'AF' ? 2 : tp === 'BA' ? 1 : 3,
            TMM: 0,
            MV: '',
            MVm: {},
            ROLE: '',
            SKILL: 4,
            M: 0,
            S: 0,
            MSL: 0,
            L: 0,
            OV: 0,
            ARM: 0,
            STR: 0,
            specials: [],
            ...(overrides.as ?? {}),
        },
    } as unknown as Unit;
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

    return {
        id,
        getUnit: () => unit,
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
    const force = {
        faction: () => faction,
        era: () => null,
        gameSystem: GameSystem.ALPHA_STRIKE,
    };

    return {
        force,
        units: () => [...units],
        activeFormation: () => formation,
        organizationalResult: () => ({
            name: resolvedGroups.map((group) => group.name).join(' + '),
            tier: resolvedGroups[0]?.tier ?? 0,
            groups: resolvedGroups,
        }),
    } as unknown as UnitGroup<ASForceUnit>;
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
        expect(preview.unsupportedEffects).toEqual([]);
    });

    it('supports fixed command ability assignments with the same recipient limits as pilot abilities', () => {
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
                recipientLimit: 2,
                recipientUnitIds: ['unit-1', 'unit-2'],
            }),
        ]);
        expect(preview.assignmentsByUnitId.get('unit-1')).toEqual(['anti_aircraft_specialists']);
        expect(preview.assignmentsByUnitId.get('unit-2')).toEqual(['anti_aircraft_specialists']);
        expect(preview.assignmentsByUnitId.get('unit-3')).toEqual([]);
    });

    it('filters structurally ineligible Air Lance units out of formation bonus recipients', () => {
        const formation = getFormation('command-lance');
        const bmUnits = [
            createASForceUnit('bm-1', createUnit(1, 'Atlas', 'Mek', 'BattleMek', 'BM')),
            createASForceUnit('bm-2', createUnit(2, 'Banshee', 'Mek', 'BattleMek', 'BM')),
        ];
        const flightUnits = [
            createASForceUnit('flight-1', createUnit(10, 'Corsair', 'Aero', 'Aero', 'AF', { role: 'Interceptor', as: { MVm: { a: 12 } } })),
            createASForceUnit('flight-2', createUnit(11, 'Lucifer', 'Aero', 'Aero', 'AF', { role: 'Interceptor', as: { MVm: { a: 10 } } })),
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

    it('keeps commander-only bonuses on the commander and strips commander-excluded bonuses from that unit', () => {
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

        expect(commander.formationAbilities()).toEqual(['tactical_genius']);
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
        expect(unitB.formationAbilities()).toEqual(['tactical_genius']);
    });

    it('automatically assigns all-unit pilot effects without requiring manual selection', () => {
        const formation = getFormation('light-recon-lance');
        const units = [
            createASForceUnit('unit-1', createUnit(1, 'Locust', 'Mek', 'BattleMek', 'BM', { role: 'Scout', as: { SZ: 1, MVm: { g: 12 } } })),
            createASForceUnit('unit-2', createUnit(2, 'Stinger', 'Mek', 'BattleMek', 'BM', { role: 'Scout', as: { SZ: 1, MVm: { g: 14 } } })),
            createASForceUnit('unit-3', createUnit(3, 'Wasp', 'Mek', 'BattleMek', 'BM', { role: 'Scout', as: { SZ: 1, MVm: { g: 12 } } })),
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
        const formation = getFormation('light-recon-lance');
        const units = [
            createASForceUnit('unit-1', createUnit(1, 'Locust', 'Mek', 'BattleMek', 'BM', { role: 'Scout', as: { SZ: 1, MVm: { g: 12 } } }), {
                formationAbilities: ['eagles_eyes', 'forward_observer'],
            }),
            createASForceUnit('unit-2', createUnit(2, 'Stinger', 'Mek', 'BattleMek', 'BM', { role: 'Scout', as: { SZ: 1, MVm: { g: 14 } } }), {
                formationAbilities: ['eagles_eyes', 'forward_observer'],
            }),
            createASForceUnit('unit-3', createUnit(3, 'Wasp', 'Mek', 'BattleMek', 'BM', { role: 'Scout', as: { SZ: 1, MVm: { g: 12 } } }), {
                formationAbilities: ['eagles_eyes', 'forward_observer'],
            }),
        ];
        const group = createGroup(
            units,
            formation,
            [createResolvedGroup({ name: 'Lance', type: 'Lance', tier: 1, units: units.map((unit) => unit.getUnit()) })],
            createFaction('Mercenary', 'Mercenary'),
        );

        const preview = FormationAbilityAssignmentUtil.previewGroupFormationAssignments(group, {
            abilityOverrides: new Map([['unit-1', ['forward_observer']]]),
        });

        expect(preview.assignmentsByUnitId.get('unit-1')).toEqual(['forward_observer']);
        expect(preview.assignmentsByUnitId.get('unit-2')).toEqual(['forward_observer']);
        expect(preview.assignmentsByUnitId.get('unit-3')).toEqual(['forward_observer']);
    });

    it('lets an explicit override replace an automatic choose-one selection for all recipients', () => {
        const formation = getFormation('light-recon-lance');
        const units = [
            createASForceUnit('unit-1', createUnit(1, 'Locust', 'Mek', 'BattleMek', 'BM', { role: 'Scout', as: { SZ: 1, MVm: { g: 12 } } }), {
                formationAbilities: ['eagles_eyes', 'forward_observer'],
            }),
            createASForceUnit('unit-2', createUnit(2, 'Stinger', 'Mek', 'BattleMek', 'BM', { role: 'Scout', as: { SZ: 1, MVm: { g: 14 } } }), {
                formationAbilities: ['eagles_eyes', 'forward_observer'],
            }),
            createASForceUnit('unit-3', createUnit(3, 'Wasp', 'Mek', 'BattleMek', 'BM', { role: 'Scout', as: { SZ: 1, MVm: { g: 12 } } }), {
                formationAbilities: ['eagles_eyes', 'forward_observer'],
            }),
        ];
        const group = createGroup(
            units,
            formation,
            [createResolvedGroup({ name: 'Lance', type: 'Lance', tier: 1, units: units.map((unit) => unit.getUnit()) })],
            createFaction('Mercenary', 'Mercenary'),
        );

        const preview = FormationAbilityAssignmentUtil.previewGroupFormationAssignments(group, {
            abilityOverrides: new Map([['unit-1', ['maneuvering_ace', 'forward_observer']]]),
        });

        expect(preview.assignmentsByUnitId.get('unit-1')).toEqual(['maneuvering_ace', 'forward_observer']);
        expect(preview.assignmentsByUnitId.get('unit-2')).toEqual(['maneuvering_ace', 'forward_observer']);
        expect(preview.assignmentsByUnitId.get('unit-3')).toEqual(['maneuvering_ace', 'forward_observer']);
    });

    it('auto-assigns all-unit command abilities through the formation preview', () => {
        const formation = getFormation('electronic-warfare-squadron');
        const units = [
            createASForceUnit('unit-1', createUnit(1, 'Sholagar', 'Aero', 'Aero', 'AF', { role: 'Interceptor', as: { MVm: { a: 10 }, specials: ['ECM'] } })),
            createASForceUnit('unit-2', createUnit(2, 'Corsair', 'Aero', 'Aero', 'AF', { role: 'Interceptor', as: { MVm: { a: 10 }, specials: ['PRB'] } })),
            createASForceUnit('unit-3', createUnit(3, 'Lucifer', 'Aero', 'Aero', 'AF', { role: 'Interceptor', as: { MVm: { a: 10 }, specials: ['TAG'] } })),
            createASForceUnit('unit-4', createUnit(4, 'Transit', 'Aero', 'Aero', 'AF', { role: 'Interceptor', as: { MVm: { a: 10 }, specials: ['AECM'] } })),
            createASForceUnit('unit-5', createUnit(5, 'Sabre', 'Aero', 'Aero', 'AF', { role: 'Interceptor', as: { MVm: { a: 10 }, specials: [] } })),
            createASForceUnit('unit-6', createUnit(6, 'Chippewa', 'Aero', 'Aero', 'AF', { role: 'Interceptor', as: { MVm: { a: 10 }, specials: [] } })),
        ];
        const group = createGroup(
            units,
            formation,
            [createResolvedGroup({ name: 'Squadron', type: 'Squadron', tier: 1, units: units.map((unit) => unit.getUnit()) })],
            createFaction('Mercenary', 'Mercenary'),
        );

        const preview = FormationAbilityAssignmentUtil.previewGroupFormationAssignments(group);

        expect(preview.unsupportedEffects).toEqual([]);
        for (const unit of units) {
            expect(preview.assignmentsByUnitId.get(unit.id)).toEqual(['communications_disruption']);
        }
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