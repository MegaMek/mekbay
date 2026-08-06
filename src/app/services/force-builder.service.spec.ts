// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import { signal } from '@angular/core';
import { of } from 'rxjs';
import { GameSystem } from '../models/common.model';
import type { Faction } from '../models/factions.model';
import { Force, type UnitGroup } from '../models/force.model';
import type { ForceUnit } from '../models/force-unit.model';
import { LoadForceEntry } from '../models/load-force-entry.model';
import type { Unit } from '../models/units.model';
import type { FormationTypeDefinition } from '../utils/formation-type.model';
import { createEmptyForceNameWords } from '../models/force-name-words.model';
import { LanceTypeIdentifierUtil } from '../utils/lance-type-identifier.util';
import { ForceBuilderService } from './force-builder.service';
import { CBTForce } from '../models/cbt-force.model';
import { CBTForceUnit } from '../models/cbt-force-unit.model';
import type { InventoryControlRuntimeTarget } from '../models/inventory-control-runtime-state.model';

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
        getForceNameWords: () => createEmptyForceNameWords(),
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

describe('ForceBuilderService CBT crew editing', () => {
    function createCrewMember(id: number, name: string, gunnery: number, piloting: number) {
        return {
            getId: () => id,
            getName: () => name,
            getSkill: (skillType: 'gunnery' | 'piloting', asf = false) => {
                if (asf) return skillType === 'gunnery' ? gunnery + 1 : piloting + 1;
                return skillType === 'gunnery' ? gunnery : piloting;
            },
            setName: jasmine.createSpy(`setName${id}`),
            setSkill: jasmine.createSpy(`setSkill${id}`),
        };
    }

    function createClassicHarness(
        crew: ReturnType<typeof createCrewMember>[],
        result: unknown,
        baseUnit: any = { type: 'Mek', subtype: 'Land-Air BattleMek' },
    ) {
        const service = Object.create(ForceBuilderService.prototype) as any;
        let dialogData: any;
        service.dialogsService = {
            createDialog: jasmine.createSpy('createDialog').and.callFake((_component: unknown, config: any) => {
                dialogData = config.data;
                return { closed: of(result) };
            }),
        };
        service.toastService = { showToast: jasmine.createSpy('showToast') };

        const unit = Object.create(CBTForceUnit.prototype) as any;
        Object.defineProperty(unit, 'force', {
            value: { faction: () => ({ id: 27 }), era: () => ({ years: { from: 3050 } }) },
            configurable: true,
        });
        Object.assign(unit, {
            id: 'unit-1',
            disabledSaving: false,
            readOnly: () => false,
            getUnit: () => baseUnit,
            getCrewMembers: () => crew,
            getGroup: () => null,
            commander: () => false,
            getPreSkillBv: () => 1200,
            setFormationCommander: jasmine.createSpy('setFormationCommander'),
            setModified: jasmine.createSpy('setModified'),
        });

        return { service, unit, dialogData: () => dialogData };
    }

    it('opens one dialog with all crew and applies every returned member', async () => {
        const crew = [createCrewMember(0, 'Pilot', 4, 2), createCrewMember(1, 'Gunner', 3, 5)];
        const result = {
            crew: [
                { id: 0, name: 'New Pilot', gunnery: 2, piloting: 3, asfGunnery: 1, asfPiloting: 2 },
                { id: 1, name: 'New Gunner', gunnery: 1, piloting: 4, asfGunnery: 2, asfPiloting: 3 },
                { id: 99, name: 'Unknown', gunnery: 0, piloting: 0 },
            ],
            commander: true,
        };
        const { service, unit, dialogData } = createClassicHarness(crew, result);

        await service.editPilotOfUnit(unit);

        expect(dialogData().crew).toEqual([
            { id: 0, name: 'Pilot', gunnery: 4, piloting: 2, asfGunnery: 5, asfPiloting: 3 },
            { id: 1, name: 'Gunner', gunnery: 3, piloting: 5, asfGunnery: 4, asfPiloting: 6 },
        ]);
        expect(dialogData().preSkillBv).toBe(1200);
        expect(crew[0].setName).toHaveBeenCalledOnceWith('New Pilot');
        expect(crew[0].setSkill).toHaveBeenCalledWith('gunnery', 2);
        expect(crew[0].setSkill).toHaveBeenCalledWith('piloting', 3);
        expect(crew[0].setSkill).toHaveBeenCalledWith('gunnery', 1, true);
        expect(crew[0].setSkill).toHaveBeenCalledWith('piloting', 2, true);
        expect(crew[1].setName).toHaveBeenCalledOnceWith('New Gunner');
        expect(unit.setModified).toHaveBeenCalledTimes(1);
        expect(unit.disabledSaving).toBeFalse();
        expect(unit.setFormationCommander).toHaveBeenCalledOnceWith(true);
    });

    it('does not mutate or mark unchanged crew', async () => {
        const crew = [createCrewMember(0, 'Pilot', 4, 5)];
        const { service, unit } = createClassicHarness(crew, {
            crew: [{ id: 0, name: 'Pilot', gunnery: 4, piloting: 5 }],
            commander: false,
        });

        await service.editPilotOfUnit(unit);

        expect(crew[0].setName).not.toHaveBeenCalled();
        expect(crew[0].setSkill).not.toHaveBeenCalled();
        expect(unit.setModified).not.toHaveBeenCalled();
    });

    it('enforces fixed Piloting when applying a dialog result', async () => {
        const crew = [createCrewMember(0, 'Pilot', 4, 5)];
        const { service, unit } = createClassicHarness(crew, {
            crew: [{ id: 0, name: 'Pilot', gunnery: 4, piloting: 0 }],
            commander: false,
        }, { type: 'ProtoMek', subtype: 'ProtoMek' });

        await service.editPilotOfUnit(unit);

        expect(crew[0].setSkill).not.toHaveBeenCalledWith('piloting', 0);
        expect(crew[0].setSkill).not.toHaveBeenCalledWith('piloting', 5);
    });

    it('rejects crewless CBT units before opening a dialog', async () => {
        const { service, unit } = createClassicHarness([], null);

        await service.editPilotOfUnit(unit);

        expect(service.dialogsService.createDialog).not.toHaveBeenCalled();
        expect(service.toastService.showToast).toHaveBeenCalledOnceWith('This unit has no crew to edit.', 'error');
    });
});

describe('ForceBuilderService OPFOR inventory target synchronization', () => {
    function createOpforHarness() {
        const service = Object.create(ForceBuilderService.prototype) as ForceBuilderService;
        let targets: InventoryControlRuntimeTarget[] = [];
        const enabled = signal(true);
        const force = {
            inventoryControlOpforEnabled: enabled,
            getInventoryControlTargets: () => targets,
            replaceInventoryControlTargets: jasmine.createSpy('replaceInventoryControlTargets').and.callFake(
                (nextTargets: InventoryControlRuntimeTarget[]) => targets = nextTargets
            ),
            units: () => []
        } as unknown as CBTForce;
        spyOn(service, 'isInventoryControlOpforAvailable').and.returnValue(true);

        return {
            service,
            force,
            enabled,
            targets: () => targets,
            setTargets: (nextTargets: InventoryControlRuntimeTarget[]) => targets = nextTargets
        };
    }

    function createEnemyUnit(id: string, name: string, definition: Partial<Unit> = {}): CBTForceUnit {
        return {
            id,
            getDisplayName: () => name,
            getUnit: () => ({
                type: 'Mek',
                subtype: 'BattleMek',
                moveType: 'Biped',
                tons: 50,
                weightClass: 'Medium',
                ...definition
            } as Unit),
            getCondition: () => false,
            turnState: () => ({
                moveMode: signal(null),
                moveDistance: signal<number | null>(0),
                airborne: signal<boolean | null>(false)
            })
        } as unknown as CBTForceUnit;
    }

    function createAlignedCBTForce(units: CBTForceUnit[] = []): CBTForce {
        return Object.assign(Object.create(CBTForce.prototype), {
            units: () => units,
            inventoryControlOpforEnabled: signal(false)
        }) as CBTForce;
    }

    function configureLoadedForces(
        service: ForceBuilderService,
        slots: Array<{ force: Force; alignment: 'friendly' | 'enemy' }>
    ): void {
        (service as any).loadedForces = signal(slots.map(slot => ({ ...slot, changeSub: null })));
    }

    it('resolves enemy CBT units as OPFOR for a friendly force', () => {
        const service = Object.create(ForceBuilderService.prototype) as ForceBuilderService;
        const friendlyUnit = createEnemyUnit('friendly-1', 'Friendly');
        const firstEnemyUnit = createEnemyUnit('enemy-1', 'First Enemy');
        const secondEnemyUnit = createEnemyUnit('enemy-2', 'Second Enemy');
        const source = createAlignedCBTForce([friendlyUnit]);
        const friendlyPeer = createAlignedCBTForce([createEnemyUnit('friendly-2', 'Friendly Peer')]);
        const firstEnemy = createAlignedCBTForce([firstEnemyUnit]);
        const secondEnemy = createAlignedCBTForce([secondEnemyUnit]);
        configureLoadedForces(service, [
            { force: source, alignment: 'friendly' },
            { force: friendlyPeer, alignment: 'friendly' },
            { force: firstEnemy, alignment: 'enemy' },
            { force: secondEnemy, alignment: 'enemy' }
        ]);

        expect(service.isInventoryControlOpforAvailable(source)).toBeTrue();
        expect((service as any).opposingCBTUnits(source)).toEqual([firstEnemyUnit, secondEnemyUnit]);
    });

    it('resolves all non-enemy CBT units as OPFOR for an enemy force', () => {
        const service = Object.create(ForceBuilderService.prototype) as ForceBuilderService;
        const firstFriendlyUnit = createEnemyUnit('friendly-1', 'First Friendly');
        const secondFriendlyUnit = createEnemyUnit('friendly-2', 'Second Friendly');
        const sourceUnit = createEnemyUnit('enemy-1', 'Source Enemy');
        const enemyPeerUnit = createEnemyUnit('enemy-2', 'Enemy Peer');
        const firstFriendly = createAlignedCBTForce([firstFriendlyUnit]);
        const secondFriendly = createAlignedCBTForce([secondFriendlyUnit]);
        const source = createAlignedCBTForce([sourceUnit]);
        const enemyPeer = createAlignedCBTForce([enemyPeerUnit]);
        configureLoadedForces(service, [
            { force: firstFriendly, alignment: 'friendly' },
            { force: source, alignment: 'enemy' },
            { force: enemyPeer, alignment: 'enemy' },
            { force: secondFriendly, alignment: 'friendly' }
        ]);

        expect(service.isInventoryControlOpforAvailable(source)).toBeTrue();
        expect((service as any).opposingCBTUnits(source)).toEqual([firstFriendlyUnit, secondFriendlyUnit]);
    });

    it('enables an enemy force OPFOR toggle with friendly CBT units', () => {
        const service = Object.create(ForceBuilderService.prototype) as ForceBuilderService;
        const friendlyUnit = createEnemyUnit('friendly-1', 'Friendly');
        const friendly = createAlignedCBTForce([friendlyUnit]);
        const source = createAlignedCBTForce([createEnemyUnit('enemy-1', 'Enemy')]);
        configureLoadedForces(service, [
            { force: source, alignment: 'enemy' },
            { force: friendly, alignment: 'friendly' }
        ]);
        const synchronize = spyOn<any>(service, 'syncOpforInventoryTargets');

        service.setInventoryControlOpforEnabled(source, true);

        expect(source.inventoryControlOpforEnabled()).toBeTrue();
        expect(synchronize).toHaveBeenCalledOnceWith(source, [friendlyUnit]);
    });

    it('does not expose OPFOR for unloaded forces or forces with only same-side CBT peers', () => {
        const service = Object.create(ForceBuilderService.prototype) as ForceBuilderService;
        const source = createAlignedCBTForce();
        const friendlyPeer = createAlignedCBTForce();
        const unloaded = createAlignedCBTForce();
        configureLoadedForces(service, [
            { force: source, alignment: 'friendly' },
            { force: friendlyPeer, alignment: 'friendly' }
        ]);

        expect(service.isInventoryControlOpforAvailable(source)).toBeFalse();
        expect(service.isInventoryControlOpforAvailable(unloaded)).toBeFalse();
        expect((service as any).opposingCBTUnits(source)).toEqual([]);
    });

    it('does not treat a non-CBT opposing force as inventory-control OPFOR', () => {
        const service = Object.create(ForceBuilderService.prototype) as ForceBuilderService;
        const source = createAlignedCBTForce();
        const alphaStrikeForce = { units: () => [] } as unknown as Force;
        configureLoadedForces(service, [
            { force: source, alignment: 'enemy' },
            { force: alphaStrikeForce, alignment: 'friendly' }
        ]);

        expect(service.isInventoryControlOpforAvailable(source)).toBeFalse();
        expect((service as any).opposingCBTUnits(source)).toEqual([]);
    });

    it('keeps OPFOR available when the opposing CBT force is empty', () => {
        const service = Object.create(ForceBuilderService.prototype) as ForceBuilderService;
        const source = createAlignedCBTForce();
        const emptyEnemy = createAlignedCBTForce();
        configureLoadedForces(service, [
            { force: source, alignment: 'friendly' },
            { force: emptyEnemy, alignment: 'enemy' }
        ]);

        expect(service.isInventoryControlOpforAvailable(source)).toBeTrue();
        expect((service as any).opposingCBTUnits(source)).toEqual([]);
    });

    it('imports enemy units and synchronizes only shared identity and target state', () => {
        const harness = createOpforHarness();
        const enemy = createEnemyUnit('enemy-1', 'Atlas AS7-D');

        (harness.service as any).syncOpforInventoryTargets(harness.force, [enemy]);
        const imported = harness.targets()[0];
        expect(imported).toEqual(jasmine.objectContaining({
            id: 'opfor:enemy-1',
            name: 'Atlas AS7-D',
            source: 'opfor',
            readOnly: true,
            unitType: 'mek-biped',
            distance: 1
        }));

        harness.setTargets([{ ...imported, distance: 12, c3Distance: 7, useC3: true }]);
        harness.targets()[0].color = '#abcdef';
        const renamedVehicle = createEnemyUnit('enemy-1', 'Demolisher', {
            type: 'Tank',
            subtype: 'Combat Vehicle'
        });
        (harness.service as any).syncOpforInventoryTargets(harness.force, [renamedVehicle]);

        expect(harness.targets()[0]).toEqual(jasmine.objectContaining({
            id: 'opfor:enemy-1',
            name: 'Demolisher',
            color: '#abcdef',
            unitType: 'vehicle',
            distance: 1,
            tnModifier: 0
        }));
        expect(harness.targets()[0].c3Distance).toBeUndefined();
        expect(harness.targets()[0].useC3).toBeUndefined();
    });

    it('does not replace semantically unchanged OPFOR targets with different property order', () => {
        const harness = createOpforHarness();
        const enemy = createEnemyUnit('enemy-1', 'Atlas AS7-D');
        (harness.service as any).syncOpforInventoryTargets(harness.force, [enemy]);
        const imported = harness.targets()[0];
        harness.setTargets([{
            tnModifier: imported.tnModifier,
            distance: imported.distance,
            tnCalculator: {
                largeTarget: imported.tnCalculator?.largeTarget,
                stance: imported.tnCalculator?.stance,
                skidding: imported.tnCalculator?.skidding,
                targetMovementBracket: imported.tnCalculator?.targetMovementBracket,
                isAirborne: imported.tnCalculator?.isAirborne
            },
            unitType: imported.unitType,
            readOnly: imported.readOnly,
            source: imported.source,
            color: imported.color,
            name: imported.name,
            letter: imported.letter,
            id: imported.id
        }]);

        (harness.service as any).syncOpforInventoryTargets(harness.force, [enemy]);

        expect(harness.force.replaceInventoryControlTargets).toHaveBeenCalledTimes(1);
    });

    it('does not rewrite targets after adding a manual target beside existing OPFOR', () => {
        const harness = createOpforHarness();
        const enemy = createEnemyUnit('enemy-1', 'Atlas');
        (harness.service as any).syncOpforInventoryTargets(harness.force, [enemy]);
        const linkedTarget = harness.targets()[0];
        harness.setTargets([linkedTarget, {
            id: 'B',
            letter: 'B',
            name: 'Target B',
            color: '#fff',
            source: 'manual',
            unitType: 'mek-biped',
            distance: 1,
            tnModifier: 0
        }]);
        const replacementSpy = harness.force.replaceInventoryControlTargets as jasmine.Spy;
        replacementSpy.calls.reset();

        (harness.service as any).syncOpforInventoryTargets(harness.force, [enemy]);

        expect(replacementSpy).not.toHaveBeenCalled();
        expect(harness.targets().map(target => [target.id, target.letter])).toEqual([
            ['opfor:enemy-1', 'A'],
            ['B', 'B']
        ]);
    });

    it('keeps linked letters stable and converges after manual target deletions', () => {
        const harness = createOpforHarness();
        const enemies = [
            createEnemyUnit('enemy-1', 'Atlas'),
            createEnemyUnit('enemy-2', 'Marauder')
        ];
        (harness.service as any).syncOpforInventoryTargets(harness.force, enemies);
        const linkedTargets = harness.targets();
        expect(linkedTargets.map(target => target.letter)).toEqual(['A', 'B']);

        const manualTargets = ['C', 'D', 'E', 'F', 'G'].map(letter => ({
            id: letter,
            letter,
            name: `Target ${letter}`,
            color: '#fff',
            source: 'manual' as const,
            distance: 1,
            tnModifier: 0
        }));
        harness.setTargets([...linkedTargets, ...manualTargets]);
        (harness.service as any).syncOpforInventoryTargets(harness.force, enemies);
        expect(harness.targets().filter(target => target.source === 'opfor').map(target => target.letter)).toEqual(['A', 'B']);

        for (const letter of ['C', 'D', 'E', 'F', 'G']) {
            harness.setTargets(harness.targets().filter(target => target.id !== letter));
            (harness.service as any).syncOpforInventoryTargets(harness.force, enemies);
            const replacementSpy = harness.force.replaceInventoryControlTargets as jasmine.Spy;
            const replacementCount = replacementSpy.calls.count();
            (harness.service as any).syncOpforInventoryTargets(harness.force, enemies);

            const currentTargets = harness.targets();
            expect(new Set(currentTargets.map(target => target.letter)).size).toBe(currentTargets.length);
            expect(currentTargets.filter(target => target.source === 'opfor').map(target => target.letter)).toEqual(['A', 'B']);
            expect(replacementSpy.calls.count()).toBe(replacementCount);
        }
    });

    it('removes departed enemies without disturbing manual targets', () => {
        const harness = createOpforHarness();
        const manualTarget = {
            id: 'manual-1',
            letter: 'A',
            name: 'Objective',
            color: '#fff',
            unitType: 'vehicle',
            distance: 4,
            tnModifier: 0
        } as InventoryControlRuntimeTarget;
        harness.setTargets([manualTarget]);

        (harness.service as any).syncOpforInventoryTargets(
            harness.force,
            [createEnemyUnit('enemy-1', 'Atlas')]
        );
        expect(harness.targets().length).toBe(2);

        (harness.service as any).syncOpforInventoryTargets(harness.force, []);
        expect(harness.targets()).toEqual([manualTarget]);
    });

    it('removes derived targets when OPFOR synchronization is disabled', () => {
        const harness = createOpforHarness();
        (harness.service as any).syncOpforInventoryTargets(
            harness.force,
            [createEnemyUnit('enemy-1', 'Atlas')]
        );

        harness.enabled.set(false);
        (harness.service as any).syncOpforInventoryTargets(
            harness.force,
            [createEnemyUnit('enemy-1', 'Atlas')]
        );

        expect(harness.targets()).toEqual([]);
    });
});

describe('ForceBuilderService load dialog', () => {
    it('loads a source force from the dialog without resolving its empty instanceId', async () => {
        const service = Object.create(ForceBuilderService.prototype) as any;
        const sourceForce = Object.create(Force.prototype) as Force;
        sourceForce.instanceId = signal<string | null>(null);

        service.dialogsService = {
            createDialog: jasmine.createSpy('createDialog').and.returnValue({
                closed: of({
                    result: sourceForce,
                    mode: 'load',
                    alignment: 'friendly',
                }),
            }),
        };
        service.dataService = {
            getForce: jasmine.createSpy('getForce'),
        };
        service.loadForce = jasmine.createSpy('loadForce').and.resolveTo(true);

        await service.showLoadForceDialog();

        expect(service.dataService.getForce).not.toHaveBeenCalled();
        expect(service.loadForce).toHaveBeenCalledOnceWith(sourceForce);
        expect(sourceForce.instanceId()).toBeNull();
    });
});
