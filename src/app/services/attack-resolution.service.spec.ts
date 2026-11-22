// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import { StaticEmplacementEntity } from '../models/entity/entities/misc/static-emplacement-entity';
import { shelterDamage, shelterHitReport } from '../models/runtime/attack-hit-location';
import { TestBed } from '@angular/core/testing';
import { EMPTY, of, Subject } from 'rxjs';
import type { AttackResolutionDialogData } from '../components/attack-resolution-dialog/attack-resolution-dialog.component';
import { CBTForceMember } from '../models/force-member.model';
import { CBTForce } from '../models/cbt-force.model';
import { AmmoEquipment, WeaponEquipment } from '../models/equipment.model';
import { addTestEquipment } from '../models/entity/testing/test-mounted-equipment';
import { createTestEquipmentRegistry } from '../models/entity/testing/test-equipment-registry';
import { createNonMekUnit } from '../models/runtime/cbt-non-mek-unit';
import { projectNonMekEquipmentPanel } from '../models/runtime/non-mek-equipment-panel';
import { componentIdForMount } from '../models/runtime/unit-runtime-index';
import { asUnitUuid } from './unit-catalog/unit-catalog.types';
import { resolveWeaponAttack } from '../models/rules/weapon-attack-resolution';
import type { CBTUnitCommand } from '../models/runtime/unit-command';
import { TestAeroSpaceFighterEntity, TestDropShipEntity } from '../models/entity/testing/test-entities';
import { asEncounterTargetId } from '../models/runtime/encounter-runtime';
import { projectMekEquipmentPanel, type EquipmentPanelSnapshot } from '../models/runtime/equipment-panel';
import { createDirectMachineGunArrayRuntimeFixture, createDirectMekRuntimeFixture } from '../models/runtime/testing/direct-mek-runtime-fixture';
import { MGA_UNLINKING_MODE } from '../models/runtime/component-machine-gun-array';
import { AttackResolutionService } from './attack-resolution.service';
import { DialogsService } from './dialogs.service';
import { ForceWorkspaceStateService } from './force-workspace-state.service';
import { GameEventsService, type ReceivedGameEvent } from './game-events.service';
import { ForceWorkspaceCommandsService } from './force-workspace-commands.service';
import { weaponHitLocation } from '../models/runtime/attack-hit-location';
import { InventoryControlOpforService } from './inventory-control-opfor.service';
import { GameTurnService } from './game-turn.service';
import { OptionsService } from './options.service';
import { ToastService } from './toast.service';
import { UnitNameService } from './unit-name.service';

describe('AttackResolutionService hit locations', () => {
    const dialog = jasmine.createSpy('createDialog').and.returnValue({ closed: of(undefined) });
    beforeEach(() => {
        dialog.calls.reset();
        TestBed.configureTestingModule({ providers: [
            { provide: OptionsService, useValue: { options: () => ({ attackResolution: true, CBTOptionalRules: {} }) } },
            { provide: DialogsService, useValue: { createDialog: dialog } },
            { provide: GameEventsService, useValue: { received: EMPTY } },
            { provide: InventoryControlOpforService, useValue: { resolveOpforTarget: () => null } },
            { provide: ForceWorkspaceStateService, useValue: {} },
            { provide: UnitNameService, useValue: { name: () => 'Attacker' } },
            { provide: ToastService, useValue: {} },
        ] });
    });

    it('keeps the equipment Fire button from rolling before the final phase declaration', async () => {
        const member = {} as CBTForceMember;
        const turns = { unitFor: () => ({ step: { kind: 'declaration' }, position: { step: 2 }, status: 'done' }) };
        TestBed.overrideProvider(OptionsService, { useValue: { options: () => ({ realPhases: true, trackPhaseAndTurn: true,
            attackResolution: true, CBTOptionalRules: {} }) } });
        TestBed.overrideProvider(GameTurnService, { useValue: turns });
        TestBed.overrideProvider(ToastService, { useValue: { showToast: jasmine.createSpy('toast') } });
        const service = TestBed.inject(AttackResolutionService);
        expect(service.allowsAttackDeclaration(member, 'weapons')).toBeFalse();
        expect(await service.rollAttacks(member, {} as EquipmentPanelSnapshot, null)).toBe('dismissed');
        expect(dialog).not.toHaveBeenCalled();
    });

    it('shows and spends maximum Ultra and Rotary bursts for an airborne fighter', () => {
        for (const [ammoType, bursts] of [['AC_ULTRA', 2], ['AC_ROTARY', 6]] as const) {
            const modes = ammoType === 'AC_ULTRA' ? ['Single', 'Ultra'] : ['1', '2', '3', '4', '5', '6'];
            const gun = new WeaponEquipment({ id: 'rapid', name: 'Rapid-fire AC', type: 'weapon', modes,
                flags: ['F_AC', 'F_BALLISTIC', 'F_DIRECT_FIRE'], weapon: { heat: 1, damage: 5, ammoType, rackSize: 5 } });
            const ammo = new AmmoEquipment({ id: 'rounds', name: 'AC ammo', type: 'ammo',
                ammo: { type: ammoType, rackSize: 5, shots: 20, damagePerShot: 5 } });
            const entity = new TestAeroSpaceFighterEntity(createTestEquipmentRegistry({ rapid: gun, rounds: ammo }));
            const uuid = asUnitUuid('019f6767-0dcb-7bb8-992f-aef08202f5e1');
            entity.uuid.set(uuid);
            entity.structuralIntegrity.set(10);
            const weaponId = componentIdForMount(addTestEquipment(entity, gun, { location: 'Nose' }));
            const bin = componentIdForMount(addTestEquipment(entity, ammo, { location: 'Nose', shotsCount: 20 }));
            const unit = createNonMekUnit(entity, { instanceId: 'rapid', uuid, deployment: { id: 'default' },
                scenario: { id: 'megamek', ruleset: 'total-warfare' }, initialStateProfileId: 'pristine' });
            unit.dispatch({ type: 'set-airborne', airborne: true });
            const registry = { revision: 0, targets: [] };
            for (const edit of [
                { kind: 'set-component-selection', componentId: weaponId, selection: { kind: 'selected' } },
                { kind: 'set-component-ammo', componentId: weaponId, ammo: { munitionKey: ammo.id, preferredSourceId: bin } },
            ] as const) unit.dispatchAttackerTargeting({ type: 'edit-attacker-targeting', edit }, registry, false);
            const panel = projectNonMekEquipmentPanel(entity, unit.getIndex(), 'total-warfare', unit.snapshot(), unit.query(), registry, {});
            const row = panel.components.find(component => component.componentId === weaponId)!;
            expect(row.weapon?.firingHeat).toBe(bursts);
            expect(row.modes).toEqual([]);
            expect(row.mode).toBe(modes.at(-1));
            expect(unit.dispatchSelectedWeaponFire({ type: 'fire-selected-weapons' }, registry, false, false).changed).toBeTrue();
            expect(unit.query().remainingAmmo(bin)).toBe(20 - bursts);
            expect(unit.snapshot().turn.weaponsHeat).toBe(bursts);
        }
    });

    it('fires a fighter LRM at fixed AV and delivers one combined DropShip laser bay from its operating members', () => {
        const lrm = new WeaponEquipment({ id: 'lrm', name: 'LRM 15', type: 'weapon', flags: ['F_LRM', 'F_MISSILE'],
            weapon: { damage: 'cluster', rackSize: 15, ammoType: 'LRM', av: [9, 9, 9, 0], ranges: [7, 14, 21, 28] } });
        const ammo = new AmmoEquipment({ id: 'lrm-ammo', name: 'LRM 15 Ammo', type: 'ammo',
            ammo: { type: 'LRM', rackSize: 15, shots: 8, damagePerShot: 1 } });
        const laser = new WeaponEquipment({ id: 'laser', name: 'Large Laser', type: 'weapon', flags: ['F_ENERGY', 'F_LASER'],
            weapon: { damage: 8, ammoType: 'NA', av: [8, 8, 0, 0], ranges: [5, 10, 15, 20] } });
        const equipment = createTestEquipmentRegistry({ lrm, 'lrm-ammo': ammo, laser });
        for (const entity of [new TestAeroSpaceFighterEntity(equipment), new TestDropShipEntity(equipment)]) {
            const bay = entity instanceof TestDropShipEntity;
            const uuid = asUnitUuid('019f6767-0dcb-7bb8-992f-aef08202f5e1');
            entity.uuid.set(uuid);
            entity.structuralIntegrity.set(10);
            const mounts = Array.from({ length: bay ? 3 : 1 }, () => addTestEquipment(entity, bay ? laser : lrm,
                { location: entity.locationOrder[0] }));
            if (bay) entity.addEquipmentBay('weapon-bay', { mounts });
            else addTestEquipment(entity, ammo, { location: 'Nose', shotsCount: 8 });
            const unit = createNonMekUnit(entity, { instanceId: 'airborne', uuid, deployment: { id: 'default' },
                scenario: { id: 'megamek', ruleset: 'total-warfare' }, initialStateProfileId: 'pristine' });
            unit.dispatch({ type: 'set-airborne', airborne: true });
            const targetId = asEncounterTargetId('fighter');
            const registry = { revision: 0, targets: [{ id: targetId, letter: 'A', color: '#abc', name: 'Fighter',
                unitType: 'aero', tnCalculator: { isAirborne: true } }] } as const;
            if (bay) unit.dispatch({ type: 'set-component-status', componentId: componentIdForMount(mounts[0]),
                status: 'destroyed', target: 'committed' });
            const components = bay ? mounts.slice(1) : mounts;
            for (const mount of components) unit.dispatchAttackerTargeting({ type: 'edit-attacker-targeting',
                edit: { kind: 'set-component-selection', componentId: componentIdForMount(mount), selection: { kind: 'target', targetId } } },
                registry, false);
            const panel = projectNonMekEquipmentPanel(entity, unit.getIndex(), 'total-warfare', unit.snapshot(), unit.query(), registry, {});
            const member = { entity, id: unit.instanceId, force: { getUnitSnapshot: () => ({ state: unit.snapshot(), query: unit.query() }) } } as unknown as CBTForceMember;
            const target = TestBed.inject(AttackResolutionService)['attackTargets'](member, panel, {
                gunnery: 4, pilotingSkill: 5, movementMode: null, allowExtremeRange: false, missingMovementModifier: false,
                attackModifierBreakdown: [], c3Available: false, c3DegradationSource: 'none' })[0];
            expect(target.profiles).toHaveSize(1);
            expect(resolveWeaponAttack(target.profiles[0], [6, 6], null).groups).toEqual(bay ? [16] : [5, 4]);
        }
    });

    it('debits only the linked hex for occupied-building protection and discards or commits CF with its phase', async () => {
        const entity = new StaticEmplacementEntity(createTestEquipmentRegistry({}));
        const uuid = asUnitUuid('019f6767-0dcb-7bb8-992f-aef08202f5f2');
        entity.uuid.set(uuid);
        entity.height.set(2);
        entity.buildingType.set(2);
        entity.constructionFactor.set(38);
        entity.coordinates.set([{ q: 0, r: 0 }, { q: 1, r: 0 }]);
        const unit = createNonMekUnit(entity, { instanceId: 'building', uuid,
            scenario: { id: 'megamek', ruleset: 'total-warfare' }, deployment: { id: 'default' }, initialStateProfileId: 'pristine' });
        const building = { id: unit.instanceId, entity, force: {
            getUnitSnapshot: () => ({ entity, index: unit.getIndex(), state: unit.snapshot(), query: unit.query() }),
            dispatchUnitCommand: async (_: string, command: CBTUnitCommand) => unit.dispatch(command),
        } } as unknown as CBTForceMember;
        const cells = [...unit.getIndex().locations.values()];
        const left = cells.filter(cell => cell.code.endsWith('0.0,0.0,0.0'));
        const adjacent = cells.filter(cell => !left.includes(cell));
        expect(left.length).toBe(2);
        const hit = shelterHitReport('AC/10', 4, left[0].code);
        const apply = () => TestBed.inject(AttackResolutionService)['applyBuildingCf'](building, hit, 'pending');
        expect(await apply()).toBeTrue();
        expect(left.map(cell => unit.query().remainingInternal(cell.id, 'committed'))).toEqual([38, 38]);
        expect(left.map(cell => unit.query().remainingInternal(cell.id, 'preview'))).toEqual([34, 34]);
        unit.dispatch({ type: 'cancel-pending' });
        expect(left.map(cell => unit.query().remainingInternal(cell.id, 'preview'))).toEqual([38, 38]);
        expect(await apply()).toBeTrue();
        unit.dispatch({ type: 'end-phase' });
        expect(left.map(cell => unit.query().remainingInternal(cell.id, 'committed'))).toEqual([34, 34]);
        expect(adjacent.every(cell => unit.query().remainingInternal(cell.id) === 38)).toBeTrue();
    });

    it('resolves manual TW building charges and DFAs without a defending pilot and distinguishes shelter from interior hits', () => {
        const fixture = createDirectMekRuntimeFixture('total-warfare');
        const targetId = asEncounterTargetId('unit-target');
        const member = { id: 'attacker', entity: fixture.entity, force: {
            getUnitSnapshot: () => ({ state: fixture.instance.snapshot(), query: fixture.instance.query() }),
            getWeaponAttackContext: () => ({ pilotingSkill: 5 }),
        } } as unknown as CBTForceMember;
        let linked = false;
        TestBed.overrideProvider(InventoryControlOpforService, { useValue: {
            resolveOpforTarget: () => linked ? { forceId: 'opfor', member } : null,
        } });
        const service = TestBed.inject(AttackResolutionService);
        const base = projectMekEquipmentPanel(fixture.entity, fixture.index, 'total-warfare', fixture.instance.query(), { revision: 0, targets: [] }, {});
        const resolve = (kind: 'charge' | 'death-from-above' | 'kick', unitType: 'building' | 'mek-biped', inside = false) => {
            const physical = { ...base.physicalAttacks[0], kind, ruleset: 'total-warfare' as const, jumpMp: 8,
                reach: undefined, insideBuilding: inside, selectable: true, available: true, hitTable: 'standard' as const,
                hitModifiers: kind === 'kick' ? [0] as const : ['versus'] as const,
                effect: { kind: 'damage' as const, damage: 10, baseDamage: 10, maximumDamage: 10, weakened: false, boosted: false },
                selection: { kind: 'target' as const, targetId } };
            const target = { targetId, unitType, name: 'Target', letter: 'A', color: '', readOnly: false,
                ...(unitType === 'building' ? {} : { calculator: { buildingCover: 'building-1' as const,
                    buildingCf: 38, ...(inside ? { insideTargetBuilding: true as const } : {}) } }) };
            return service['attackTargets'](member, { ...base, components: [], physicalAttacks: [physical], targets: [target] }, {
                gunnery: 4, pilotingSkill: 5, movementMode: null, allowExtremeRange: false, missingMovementModifier: false,
                attackModifierBreakdown: [], c3Available: false, c3DegradationSource: 'none',
            })[0];
        };
        for (const kind of ['charge', 'death-from-above'] as const) {
            const target = resolve(kind, 'building');
            expect(target.profiles[0]).toEqual(jasmine.objectContaining({ physical: kind, automaticBuildingHit: true, targetNumber: 2 }));
            expect(target.buildingChargeHexes).toEqual(kind === 'charge' ? [] : undefined);
        }
        linked = true;
        const charge = resolve('charge', 'mek-biped').profiles[0];
        expect(charge.partialCover).toBeTrue();
        const hit = resolveWeaponAttack(charge, [6, 6], null);
        expect(hit.groups).toEqual([1, 1]);
        expect(hit.absorbed).toEqual([4, 4]);
        expect(shelterDamage(null, 'front', { name: 'Charge', types: [], physical: 'charge', targetNumber: 2, toHit: [6, 6], partialCover: true,
            groups: [{ damage: 1, buildingDamage: 4, location: [3, 3], aux: 1 }, { damage: 1, buildingDamage: 4, location: [3, 4], aux: 1 }],
        }, 'total-warfare', 'mek-biped')).toBe(8);
        expect(shelterDamage(null, 'front', { name: 'Charge', types: [], physical: 'charge', targetNumber: 2, toHit: [6, 6], partialCover: true,
            groups: [{ damage: 1, buildingDamage: 4, location: [2, 3], aux: 1 }, { damage: 1, buildingDamage: 4, location: [3, 4], aux: 1 }],
        }, 'total-warfare', 'mek-biped')).toBe(9);
        for (const kind of ['charge', 'kick'] as const) {
            const interior = resolve(kind, 'mek-biped', true).profiles[0];
            expect(interior.partialCover).toBeFalse();
            expect(interior.buildingAbsorption).toBe(4);
        }
    });

    it('absorbs the BattleMaster’s two-point machine-gun hit on the Locust inside a CF 60 building (BMM p. 72)', () => {
        const fixture = createDirectMachineGunArrayRuntimeFixture('total-warfare');
        const ref = { forceId: 'owner', unitId: 'building', location: 'Level 2 0.0,0.0,0.0' };
        TestBed.overrideProvider(InventoryControlOpforService, { useValue: { resolveOpforTarget: () => null,
            buildingFloors: () => [{ ref, cf: 60 }] } });
        const targetId = asEncounterTargetId('locust');
        const registry = { revision: 1, targets: [{ id: targetId, letter: 'A', name: 'Locust', color: '#abc',
            unitType: 'mek-biped', tnCalculator: { buildingCover: 'building-1' } }] } as const;
        fixture.instance.dispatch({ type: 'set-component-mode', componentId: fixture.equipmentComponent('Test MGA').id, mode: MGA_UNLINKING_MODE });
        fixture.instance.dispatch({ type: 'end-phase' });
        const gun = fixture.equipmentComponent('Test Machine Gun');
        for (const edit of [{ kind: 'set-target-facts', targetId, facts: { distance: 1,
            calculator: { targetLevelDifference: 1, insideTargetBuilding: true, shelteringBuilding: ref, buildingCf: 10 } } },
            { kind: 'set-component-selection', componentId: gun.id, selection: { kind: 'target', targetId } }] as const) {
            expect(fixture.instance.dispatchAttackerTargeting({ type: 'edit-attacker-targeting', edit }, registry, false).accepted).toBeTrue();
        }
        const member = { id: 'battlemaster', entity: fixture.entity, force: { getUnitSnapshot: () => null } } as unknown as CBTForceMember;
        const panel = projectMekEquipmentPanel(fixture.entity, fixture.index, 'total-warfare', fixture.instance.query(), registry, {});
        const [target] = TestBed.inject(AttackResolutionService)['attackTargets'](member, panel, {
            gunnery: 4, pilotingSkill: 5, movementMode: 'run', allowExtremeRange: false, missingMovementModifier: false,
            attackModifierBreakdown: [], c3Available: false, c3DegradationSource: 'none',
        });
        const [profile] = target.profiles;
        expect(profile.shelteringBuilding).toEqual(ref);
        expect(profile.buildingAbsorption).toBe(6);
        expect(profile.adjacentShelter).toBeUndefined();
        expect(profile.partialCover).toBeFalse();
        const outcome = resolveWeaponAttack(profile, [6, 6], null);
        expect(outcome.groups).toEqual([0]);
        expect(outcome.absorbed).toEqual([2]);
    });

    it('reads the defender-selected building hex and level from a local report', () => {
        const level = 'Level 0 0.0,0.0,0.0';
        const member = { entity: { entityType: 'BuildingEntity' }, nonMekRecordSheetSnapshot: () => ({
            locations: [{ code: level, locationId: 'struck' }, { code: 'Level 1 0.0,0.0,0.0', locationId: 'upper' }],
        }) } as unknown as CBTForceMember;
        const group = { location: [4, 4] as const, aux: 1, buildingLocation: level };
        expect(weaponHitLocation(member, 'front', {}, group)).toEqual(jasmine.objectContaining({ locationId: 'struck' }));
        expect(weaponHitLocation(member, 'front', {}, { ...group, buildingLocation: 'missing' })).toBeNull();
    });

    it('sends the absorbed four points to the building owner and applies the remaining six to the Mek', async () => {
        const send = jasmine.createSpy('send').and.resolveTo(true);
        TestBed.overrideProvider(GameEventsService, { useValue: { received: EMPTY, send } });
        TestBed.overrideProvider(ForceWorkspaceStateService, { useValue: { loadedForces: () => [] } });
        const applied = jasmine.createSpy('applyWeaponHits').and.resolveTo(true);
        const fixture = createDirectMekRuntimeFixture('total-warfare');
        const member = { kind: 'cbt', id: 'occupant', entity: fixture.entity, force: {
            getUnitSnapshot: () => ({ entity: fixture.entity, index: fixture.index, state: fixture.instance.snapshot(),
                query: fixture.instance.query(), ruleset: 'total-warfare' }), applyWeaponHits: applied,
        } } as unknown as CBTForceMember;
        const shelter = { forceId: 'building-owner', unitId: 'tower', location: 'floor-one' };
        await TestBed.inject(AttackResolutionService)['applyAttack'](member, {
            kind: 'attack', id: 'attack', fromForce: 'sender', fromUnit: 'gunner', attacker: 'Gunner',
            toUnit: member.id, turn: 1, arc: 'front', weapons: [{ name: 'AC/10', types: [], targetNumber: 5,
                toHit: [4, 5], partialCover: true, shelteringBuilding: shelter,
                groups: [{ location: [3, 4], aux: 1, damage: 6, buildingDamage: 4 }] }],
        }, 'pending');
        expect(send).toHaveBeenCalledOnceWith(shelter.forceId, jasmine.objectContaining({
            toUnit: shelter.unitId, weapons: [shelterHitReport('AC/10', 4, shelter.location)] }));
        expect(applied).toHaveBeenCalledOnceWith(member.id, { family: 'mek',
            groups: [jasmine.objectContaining({ location: 'CT', damage: 6 })] }, 'pending');
    });

    it('applies each Battle Armor flamer’s heat and damage together at its struck Mek location', async () => {
        const applied = jasmine.createSpy('applyWeaponHits').and.resolveTo(true);
        const member = { kind: 'cbt', id: 'mek', entity: createDirectMekRuntimeFixture().entity,
            force: { getUnitSnapshot: () => null, applyWeaponHits: applied } } as unknown as CBTForceMember;
        const group = { location: [3, 4] as const, aux: 1, damage: 2 };
        await TestBed.inject(AttackResolutionService)['applyAttack'](member, {
            kind: 'attack', id: 'attack', fromForce: 'sender', fromUnit: 'ba', attacker: 'BA',
            toUnit: member.id, turn: 1, arc: 'front', weapons: [{ name: 'BA flamers', heat: 4, heatPerGroup: 2,
                toHit: [4, 5], types: ['H'], targetNumber: 5, groups: [group, group] }],
        }, 'committed');
        const hit = jasmine.objectContaining({ location: 'CT', damage: 2, outsideHeat: 2 });
        expect(applied).toHaveBeenCalledOnceWith(member.id, { family: 'mek', groups: [hit, hit] }, 'committed');
    });

    it('gives a fighter a lucky-hit check for a rolled 12 but not for automatic swarm damage (TW pp.223, 239)', async () => {
        const applied = jasmine.createSpy('applyWeaponHits').and.resolveTo(true);
        const fighter = {
            kind: 'cbt', id: 'fighter', entity: new TestAeroSpaceFighterEntity(),
            force: { getUnitSnapshot: () => null, applyWeaponHits: applied },
            nonMekRecordSheetSnapshot: () => ({ locations: [{ code: 'Nose', sheetCode: 'Nose', locationId: 'nose' }] }),
        } as unknown as CBTForceMember;
        const roll = { types: [], targetNumber: 5, toHit: [6, 6], groups: [{ location: [3, 4], aux: 1, damage: 1 }] } as const;
        await TestBed.inject(AttackResolutionService)['applyAttack'](fighter, {
            kind: 'attack', id: 'attack', fromForce: 'sender', fromUnit: 'attacker', attacker: 'Infantry',
            toUnit: fighter.id, turn: 1, arc: 'front', weapons: [
                { ...roll, name: 'Swarm damage', physical: 'swarm-damage', critical: true },
                { ...roll, name: 'Laser' },
            ],
        }, 'committed');
        expect(applied).toHaveBeenCalledOnceWith(fighter.id, jasmine.objectContaining({ groups: [
            jasmine.objectContaining({ locationId: 'nose', luckyHit: false, source: { kind: 'physical', infantryCritical: 'swarm-damage' } }),
            jasmine.objectContaining({ locationId: 'nose', luckyHit: true }),
        ] }), 'committed');
    });

    for (const ruleset of ['core-2026', 'total-warfare'] as const) {
        it(`resolves semi-guided indirect fire and aimed shots against water cover under ${ruleset}`, async () => {
            const fixture = createDirectMekRuntimeFixture(ruleset);
            const targetId = asEncounterTargetId('target:water');
            const registry = { revision: 0, targets: [{ id: targetId, letter: 'A', name: 'Target', color: '#abc',
                unitType: 'mek-biped', tnCalculator: { waterDepth: 'underwater-depth-1', tagged: true, immobile: true },
            }] } as const;
            const member = { id: fixture.instance.instanceId, entity: fixture.entity,
                force: { getUnitSnapshot: () => null } } as unknown as CBTForceMember;
            for (const indirectFire of [true, false]) {
                const weapon = fixture.equipmentComponent(indirectFire ? 'Test Artemis Launcher' : 'ISMediumLaser');
                expect(fixture.instance.dispatchAttackerTargeting({ type: 'edit-attacker-targeting',
                    edit: { kind: 'set-target-facts', targetId,
                        facts: { distance: 3, ...(indirectFire ? { calculator: { indirectFire: true } } : {}) } },
                }, registry, false).changed).toBeTrue();
                expect(fixture.instance.dispatchAttackerTargeting({ type: 'edit-attacker-targeting',
                    edit: { kind: 'set-component-selection', componentId: weapon.id,
                        selection: { kind: 'target', targetId, ...(indirectFire ? {} : { aim: 'CT' }) } },
                }, registry, false).changed).toBeTrue();
                const panel = projectMekEquipmentPanel(fixture.entity, fixture.index, ruleset, fixture.instance.query(), registry, {});
                await TestBed.inject(AttackResolutionService).rollAttacks(member, panel, {
                    gunnery: 4, pilotingSkill: 5, movementMode: null, allowExtremeRange: false,
                    missingMovementModifier: false, attackModifierBreakdown: [], c3Available: true, c3DegradationSource: 'none',
                });
                const data: AttackResolutionDialogData = dialog.calls.mostRecent().args[1].data;
                const profile = data.targets[0].profiles.find(entry => entry.componentId === weapon.id)!;
                expect(profile.partialCover).toBe(indirectFire && ruleset === 'core-2026');
                if (!indirectFire) expect(profile.aim?.rerollLegs).toBeTrue();
            }
        });
    }
});

describe('incoming floating criticals', () => {
    it('spends two bearing AMS on confirmation before revealing AV; ignoring the damage cannot refund them', async () => {
        const gun = new WeaponEquipment({ id: 'ams', name: 'AMS', type: 'weapon', flags: ['F_AMS', 'F_BALLISTIC'],
            weapon: { heat: 1, rackSize: 2, ammoType: 'AMS' } });
        const ammo = new AmmoEquipment({ id: 'bin', name: 'AMS Ammo', type: 'ammo', ammo: { type: 'AMS', rackSize: 2, shots: 12 } });
        const entity = new TestAeroSpaceFighterEntity(createTestEquipmentRegistry({ ams: gun, bin: ammo }));
        const uuid = asUnitUuid('019f6767-0dcb-7bb8-992f-aef08202f5e1');
        entity.uuid.set(uuid);
        entity.structuralIntegrity.set(10);
        const ids = [1, 2].map(() => componentIdForMount(addTestEquipment(entity, gun, { location: 'Nose' })));
        const bin = componentIdForMount(addTestEquipment(entity, ammo, { location: 'Aft', shotsCount: 12 }));
        const unit = createNonMekUnit(entity, { instanceId: 'target', uuid, deployment: { id: 'default' },
            scenario: { id: 'megamek', ruleset: 'total-warfare' }, initialStateProfileId: 'pristine' });
        const force = Object.assign(Object.create(CBTForce.prototype), {
            instanceId: () => 'force', readOnly: () => false, getCBTMembers: () => [member],
            getUnitSnapshot: () => ({ entity, index: unit.getIndex(), state: unit.snapshot(), query: unit.query(), ruleset: 'total-warfare' }),
            dispatchUnitCommand: (_id: string, cmd: CBTUnitCommand) => Promise.resolve(unit.dispatch(cmd)),
            runAsOneUndoStep: (apply: () => Promise<boolean>) => apply(),
        });
        const member = new CBTForceMember('target', force, entity);
        const shown = jasmine.createSpy('createDialog').and.callFake((_component, { data }) => {
            if (data.choosingDefenses) {
                expect(unit.query().remainingAmmo(bin)).toBe(12);
                return { closed: of({ defenses: ids.map(componentId => ({ weapon: 0, componentId })) }) };
            }
            expect(unit.query().remainingAmmo(bin)).toBe(10);
            expect(data.event.weapons[0].groups.map((g: { damage: number }) => g.damage)).toEqual([2]);
            expect(data.defenseDice.get(0)).toEqual([3, 4]);
            return { closed: of(false) };
        });
        TestBed.configureTestingModule({ providers: [
            { provide: OptionsService, useValue: { options: () => ({ CBTOptionalRules: {} }) } },
            { provide: GameEventsService, useValue: { received: EMPTY } }, { provide: DialogsService, useValue: { createDialog: shown } },
            { provide: InventoryControlOpforService, useValue: {} }, { provide: ForceWorkspaceCommandsService, useValue: { selectUnit: () => {} } },
            { provide: ForceWorkspaceStateService, useValue: { loadedForces: () => [{ force }] } }, { provide: UnitNameService, useValue: { name: () => 'Target' } },
            { provide: ToastService, useValue: { showToast: () => {} } },
        ] });
        spyOn(Math, 'random').and.returnValue(0.55);
        await TestBed.inject(AttackResolutionService)['receive']('force', { kind: 'attack', id: 'multi-ams', fromForce: 'other',
            fromUnit: 'attacker', attacker: 'Fighter', toUnit: 'target', turn: 0, arc: 'front', weapons: [{
                name: 'LRM 15', types: ['M'], targetNumber: 4, toHit: [3, 3],
                groups: [5, 4].map(damage => ({ location: [3, 3], aux: 1, damage })),
                ams: { die: 3, damage: [5, 1], hits: 1, heat: 0, aerospace: { av: 9, groupSize: 5, absorption: 0 } },
            }] }, null);
        expect(shown).toHaveBeenCalledTimes(2);
        expect(unit.query().remainingAmmo(bin)).toBe(10);
        expect(unit.snapshot().turn.weaponsHeat).toBe(2);
    });

    for (const floatingCriticals of [true, false]) {
        it(`previews and applies the sender's reroll only when the defender plays floating criticals (${floatingCriticals})`, async () => {
            const received = new Subject<ReceivedGameEvent>();
            const shown = jasmine.createSpy('createDialog').and.returnValue({ closed: of(true) });
            const applied = jasmine.createSpy('applyWeaponHits').and.resolveTo(true);
            const force = Object.assign(Object.create(CBTForce.prototype), {
                instanceId: () => 'force', readOnly: () => false, getCBTMembers: () => [member],
                getUnitSnapshot: () => null, applyWeaponHits: applied,
                runAsOneUndoStep: (apply: () => Promise<boolean>) => apply(),
            });
            const member = new CBTForceMember('target', force, createDirectMekRuntimeFixture().entity);
            TestBed.configureTestingModule({ providers: [
                { provide: OptionsService, useValue: { options: () => ({ CBTOptionalRules: { floatingCriticals } }) } },
                { provide: GameEventsService, useValue: { received } },
                { provide: DialogsService, useValue: { createDialog: shown } },
                { provide: InventoryControlOpforService, useValue: {} },
                { provide: ForceWorkspaceCommandsService, useValue: { selectUnit: () => {} } },
                { provide: ForceWorkspaceStateService, useValue: { loadedForces: () => [{ force }] } },
                { provide: UnitNameService, useValue: { name: () => 'Target' } },
                { provide: ToastService, useValue: { showToast: () => {} } },
            ] });
            const service = TestBed.inject(AttackResolutionService);
            received.next({ toForce: 'force', fromDisplayName: null, event: {
                kind: 'attack', id: 'attack', fromForce: 'sender', fromUnit: 'attacker', attacker: 'Atlas',
                toUnit: 'target', turn: 1, arc: 'rear', weapons: [{ name: 'Laser', types: [], targetNumber: 5,
                    toHit: [4, 4], groups: [{ location: [1, 1], floating: [3, 3], aux: 1, damage: 5 }] }],
            } });
            await (service as unknown as { incoming: Promise<void> }).incoming;
            const { weapons, arc } = shown.calls.mostRecent().args[1].data.event;
            const expected = { location: floatingCriticals ? 'RT' : 'CT', rear: true, throughArmorCritical: true };
            expect(weaponHitLocation(member, arc, weapons[0], weapons[0].groups[0])).toEqual(jasmine.objectContaining(expected));
            expect(applied).toHaveBeenCalledOnceWith('target', { family: 'mek',
                groups: [jasmine.objectContaining({ ...expected, damage: 5, ...(floatingCriticals ? { floatingCritical: true } : {}) })],
            }, 'committed');
        });
    }
});
