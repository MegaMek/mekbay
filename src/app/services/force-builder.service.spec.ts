import { signal } from '@angular/core';
import { GameSystem } from '../models/common.model';
import type { Faction } from '../models/factions.model';
import type { UnitGroup } from '../models/force.model';
import type { ForceUnit } from '../models/force-unit.model';
import { LoadForceEntry } from '../models/load-force-entry.model';
import type { Unit } from '../models/units.model';
import type { FormationTypeDefinition } from '../utils/formation-type.model';
import { LanceTypeIdentifierUtil } from '../utils/lance-type-identifier.util';
import { ForceBuilderService } from './force-builder.service';

function createFaction(id: number, name: string): Faction {
    return {
        id,
        name,
        group: 'Inner Sphere',
        img: '',
        eras: {},
    };
}

function createFormation(id: string, exclusiveFaction?: string[]): FormationTypeDefinition {
    return {
        id,
        name: id,
        description: '',
        minUnits: 4,
        exclusiveFaction,
    };
}

function createUnit(): Unit {
    return {
        id: 1,
        name: 'Test Mek',
        chassis: 'Test',
        model: 'Mek',
        type: 'BM',
    } as unknown as Unit;
}

function createHarness(formation: FormationTypeDefinition, factions: Faction[]) {
    const service = Object.create(ForceBuilderService.prototype) as any;
    const selectedUnit = signal<ForceUnit | null>(null);
    const groupUnits = signal<ForceUnit[]>([]);
    const forceUnits: ForceUnit[] = [];
    const group = {
        formation: signal<FormationTypeDefinition | null>(null),
        formationLock: false,
        formationHistory: new Set<string>(['previous-automatic-match']),
        units: groupUnits,
    } as UnitGroup;
    const force = {
        gameSystem: GameSystem.ALPHA_STRIKE,
        faction: signal<Faction | null>(null),
        factionLock: false,
        era: signal(null),
        eraLock: false,
        units: () => forceUnits,
        groups: () => [group],
        addUnit: jasmine.createSpy('addUnit').and.callFake((unit: Unit, targetGroup: UnitGroup = group) => {
            const forceUnit = {
                id: `unit-${forceUnits.length + 1}`,
                force,
                getUnit: () => unit,
                getGroup: () => targetGroup,
            } as unknown as ForceUnit;
            forceUnits.push(forceUnit);
            targetGroup.units.set([...targetGroup.units(), forceUnit]);
            return forceUnit;
        }),
        setName: jasmine.createSpy('setName'),
    };
    group.force = force as any;

    const filtersService = {
        getActiveFormationTargetDefinition: jasmine.createSpy('getActiveFormationTargetDefinition').and.returnValue(formation),
    };

    service.dataService = {
        getFactions: () => factions,
    };
    service.injector = {
        get: () => filtersService,
    };
    service.layoutService = {
        openMenu: jasmine.createSpy('openMenu'),
    };
    service.toastService = {
        showToast: jasmine.createSpy('showToast'),
    };
    service.unitAvailabilitySource = {
        createForceAvailabilityContextForUnits: () => ({}) as any,
    };
    service.selectedUnit = selectedUnit;
    service.smartCurrentForce = () => force;
    service.reconcileASFormationAssignments = jasmine.createSpy('reconcileASFormationAssignments');

    return { service, force, group, filtersService };
}

describe('ForceBuilderService formation filter integration', () => {
    it('locks the first group to the active formation filter and prefers its exclusive faction', async () => {
        const freeWorldsLeague = createFaction(56, 'Free Worlds League');
        const draconisCombine = createFaction(27, 'Draconis Combine');
        const formation = createFormation('fw-lance', ['Free Worlds League']);
        const { service, force, group, filtersService } = createHarness(formation, [draconisCombine, freeWorldsLeague]);

        await service.addUnit(createUnit());

        expect(filtersService.getActiveFormationTargetDefinition).toHaveBeenCalledWith(GameSystem.ALPHA_STRIKE);
        expect(group.formation()).toBe(formation);
        expect(group.formationLock).toBeTrue();
        expect(group.formationHistory.size).toBe(0);
        expect(force.faction()).toBe(freeWorldsLeague);
        expect(force.setName).toHaveBeenCalled();
    });

    it('restores group formations from generated force preview entries', async () => {
        const lightFireFormation = createFormation('light-fire-lance');
        const automaticFormation = createFormation('automatic-lance');
        spyOn(LanceTypeIdentifierUtil, 'getDefinitionById').and.callFake((formationId: string) => (
            formationId === lightFireFormation.id ? lightFireFormation : null
        ));

        const service = Object.create(ForceBuilderService.prototype) as any;
        const groupsSignal = signal<UnitGroup[]>([]);
        const createdForceUnits: ForceUnit[] = [];
        const addUnitLoadingStates: boolean[] = [];
        const force = {
            name: 'Generated Test Force',
            gameSystem: GameSystem.ALPHA_STRIKE,
            loading: false,
            instanceId: signal<string | null>(null),
            faction: signal<Faction | null>(null),
            era: signal(null),
            groups: groupsSignal,
            addGroup: jasmine.createSpy('addGroup').and.callFake((name: string | undefined) => {
                if (!force.loading) {
                    force.instanceId.set('saved-during-add-group');
                }
                const group = {
                    force,
                    name: signal(name),
                    formation: signal<FormationTypeDefinition | null>(automaticFormation),
                    formationLock: false,
                    formationHistory: new Set<string>([automaticFormation.id]),
                    units: signal<ForceUnit[]>([]),
                } as unknown as UnitGroup;
                groupsSignal.set([...groupsSignal(), group]);
                return group;
            }),
            removeEmptyGroups: jasmine.createSpy('removeEmptyGroups').and.callFake(() => {
                groupsSignal.set(groupsSignal().filter((group) => group.units().length > 0));
            }),
            setName: jasmine.createSpy('setName').and.callFake((name: string) => {
                force.name = name;
            }),
            factionLock: false,
            eraLock: false,
        };
        const faction = createFaction(1, 'Mercenary');
        const era = { id: 3151, name: 'ilClan', years: {} } as any;
        const firstUnit = createUnit();
        const secondUnit = { ...createUnit(), id: 2, name: 'Second Mek' } as Unit;

        service.createNewForce = jasmine.createSpy('createNewForce').and.resolveTo(force);
        service.addUnit = jasmine.createSpy('addUnit').and.callFake(async (
            unit: Unit,
            _gunnerySkill: number | undefined,
            _pilotingSkill: number | undefined,
            targetGroup: UnitGroup,
        ) => {
            addUnitLoadingStates.push(force.loading);
            if (!force.loading) {
                force.instanceId.set('saved-during-add-unit');
            }
            targetGroup.formation.set(automaticFormation);
            targetGroup.formationHistory.add(automaticFormation.id);
            const forceUnit = {
                id: `unit-${createdForceUnits.length + 1}`,
                getUnit: () => unit,
            } as ForceUnit;
            createdForceUnits.push(forceUnit);
            targetGroup.units.set([...targetGroup.units(), forceUnit]);
            return forceUnit;
        });
        service.applyGeneratedUnitOverrides = jasmine.createSpy('applyGeneratedUnitOverrides');
        service.reconcileASFormationAssignments = jasmine.createSpy('reconcileASFormationAssignments');
        service.selectUnit = jasmine.createSpy('selectUnit');

        const entry = new LoadForceEntry({
            name: 'Generated Test Force',
            type: GameSystem.ALPHA_STRIKE,
            faction,
            era,
            groups: [
                {
                    name: 'Light Fire',
                    formationId: lightFireFormation.id,
                    units: [{ unit: firstUnit, destroyed: false, skill: 4 }],
                },
                {
                    name: 'Unformed',
                    units: [{ unit: secondUnit, destroyed: false, skill: 4 }],
                },
            ],
        });

        const result = await service.createGeneratedForce(entry);

        expect(result).toBe(force);
        expect(force.faction()).toBe(faction);
        expect(force.era()).toBe(era);
        expect(force.loading).toBeFalse();
        expect(force.instanceId()).toBeNull();
        expect(addUnitLoadingStates).toEqual([true, true]);
        expect(groupsSignal().map((group) => group.name())).toEqual(['Light Fire', 'Unformed']);
        expect(groupsSignal().map((group) => group.formation())).toEqual([lightFireFormation, null]);
        expect(groupsSignal().map((group) => [...group.formationHistory])).toEqual([[lightFireFormation.id], []]);
        expect(groupsSignal().map((group) => group.formationLock)).toEqual([undefined, undefined]);
        expect(service.reconcileASFormationAssignments).toHaveBeenCalledTimes(2);
    });
});
