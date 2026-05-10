import { signal } from '@angular/core';
import { GameSystem } from '../models/common.model';
import type { Faction } from '../models/factions.model';
import type { UnitGroup } from '../models/force.model';
import type { ForceUnit } from '../models/force-unit.model';
import type { Unit } from '../models/units.model';
import type { FormationTypeDefinition } from '../utils/formation-type.model';
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
});
