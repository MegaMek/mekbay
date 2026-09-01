// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import { CORE_2026_RULESET } from '../cbt-ruleset.model';
import { AmmoEquipment, createEquipment, WeaponEquipment } from '../equipment.model';
import {
    TestAeroSpaceFighterEntity,
    TestDropShipEntity,
    TestInfantryEntity,
    TestJumpShipEntity,
    TestProtoMekEntity,
    TestTankEntity,
} from '../entity/testing/test-entities';
import { createTestEquipmentRegistry } from '../entity/testing/test-equipment-registry';
import { addTestEquipment } from '../entity/testing/test-mounted-equipment';
import { asUnitUuid, MM_DATA_UNIT_PROVIDER_ID } from '../../services/unit-catalog/unit-catalog.types';
import { asComponentId } from '../entity/entity-identifiers';
import { createDefaultCrewAssignment } from './crew-assignment';
import { projectNonMekEquipmentPanel } from './non-mek-equipment-panel';
import {
    equipmentPanelRuntimeTarget,
    projectWeaponTargetPresentation,
} from './equipment-panel';
import { NonMekUnitInstance } from './non-mek-unit-instance';
import { asEncounterTargetId } from './encounter-runtime';
import { asStateRevision, asUnitInstanceId, type InstanceBaselineRef } from './runtime-state';
import { nonMekDamageTrackId } from '../rules/non-mek-damage-track-rules';

const UUID = asUnitUuid('019f6767-0dcb-7bb8-992f-aef08202f5e1');

describe('Entity equipment panel projection', () => {
    it('applies the shared Flak modifier to airborne Aero and VTOL/WiGE targets', () => {
        const weapon = new WeaponEquipment({
            id: 'FlakWeapon',
            name: 'Flak Weapon',
            type: 'weapon',
            flags: ['F_ARTILLERY'],
            weapon: { damage: 5, heat: 1, ranges: [6, 12, 18, 24] },
        });
        const row = {
            componentId: asComponentId('component:flak'),
            label: weapon.name,
            equipment: weapon,
            locations: [],
            status: 'available',
            previewStatus: 'available',
            modes: [],
            jammed: false,
            weapon: {
                heat: 1,
                firingHeat: 1,
                selectable: true,
                damage: 5,
                damageText: '5 [F]',
                damageTextByRange: {
                    short: '5 [F]', medium: '5 [F]', long: '5 [F]', extreme: '5 [F]',
                },
                hit: {
                    default: { profile: [0], value: 0, changed: false, weakened: false, modifierBreakdown: [] },
                    byRange: {
                        short: { profile: [0], value: 0, changed: false, weakened: false, modifierBreakdown: [] },
                        medium: { profile: [0], value: 0, changed: false, weakened: false, modifierBreakdown: [] },
                        long: { profile: [0], value: 0, changed: false, weakened: false, modifierBreakdown: [] },
                        extreme: { profile: [0], value: 0, changed: false, weakened: false, modifierBreakdown: [] },
                    },
                    indirectByRange: {
                        short: { profile: [0], value: 0, changed: false, weakened: false, modifierBreakdown: [] },
                        medium: { profile: [0], value: 0, changed: false, weakened: false, modifierBreakdown: [] },
                        long: { profile: [0], value: 0, changed: false, weakened: false, modifierBreakdown: [] },
                        extreme: { profile: [0], value: 0, changed: false, weakened: false, modifierBreakdown: [] },
                    },
                },
                toHitModifier: 0,
                hitModifierBreakdown: [],
                ranges: [6, 12, 18, 24],
                minimumRange: 0,
                ammoSources: [],
                underwater: false,
                attackerSubmerged: false,
                disabledTargetReasons: {},
                effectiveWeaponTypes: ['F'],
            },
        } as const;
        const target = {
            id: asEncounterTargetId('target:airborne-vtol'),
            letter: 'A',
            name: 'Airborne VTOL',
            color: '#fff',
            unitType: 'vtol-wige' as const,
            distance: 6,
            tnModifier: 1,
            tnCalculator: { isAirborne: true },
        };

        const presentation = projectWeaponTargetPresentation(
            row,
            target,
            4,
            null,
            CORE_2026_RULESET,
        );
        expect(presentation.targetModifier).toBe(-1);
        expect(presentation.targetModifierBreakdown).toEqual([
            jasmine.objectContaining({ id: 'airborne', modifier: 1 }),
            { id: 'flak', label: 'Flak', modifier: -2 },
        ]);
    });

    it('projects vehicle weapons, compatible ammo, and committed/pending status from one runtime', () => {
        const weapon = new WeaponEquipment({
            id: 'AC_10',
            name: 'AC/10',
            type: 'weapon',
            flags: ['F_AC', 'F_BALLISTIC', 'F_DIRECT_FIRE'],
            weapon: {
                ammoType: 'AC',
                rackSize: 10,
                heat: 3,
                damage: 10,
                ranges: [5, 10, 15, 20],
            },
        });
        const standard = new AmmoEquipment({
            id: 'Ammo_AC_10',
            name: 'AC/10 Ammo',
            type: 'ammo',
            ammo: { type: 'AC', rackSize: 10, shots: 10 },
        });
        const precision = new AmmoEquipment({
            id: 'Ammo_AC_10_Precision',
            name: 'AC/10 Precision Ammo',
            type: 'ammo',
            ammo: { type: 'AC', rackSize: 10, shots: 10, munitionType: ['M_PRECISION'] },
        });
        const entity = new TestTankEntity(createTestEquipmentRegistry({
            [weapon.id]: weapon,
            [standard.id]: standard,
            [precision.id]: precision,
        }));
        entity.uuid.set(UUID);
        const location = entity.locationOrder[0];
        const weaponMount = addTestEquipment(entity, weapon, { location });
        const ammoMount = addTestEquipment(entity, standard, { location, shotsCount: 10 });
        const runtime = new NonMekUnitInstance(
            asUnitInstanceId('unit:tank-equipment-panel'),
            baseline(),
            entity,
            CORE_2026_RULESET,
        );
        const weaponId = [...runtime.getIndex().components.keys()]
            .find(id => String(id) === String(weaponMount.mountId))!;
        const ammoId = [...runtime.getIndex().components.keys()]
            .find(id => String(id) === String(ammoMount.mountId))!;
        const targetId = asEncounterTargetId('target:vehicle');
        const registry = Object.freeze({
            revision: asStateRevision(0),
            targets: Object.freeze([Object.freeze({
                id: targetId,
                letter: 'A',
                name: 'Target A',
                color: '#ff0000',
                source: 'manual' as const,
                readOnly: false,
                unitType: 'vehicle' as const,
                tnCalculator: Object.freeze({ targetMovementBracket: '7-9' as const }),
            })]),
        });

        runtime.dispatch({
            kind: 'configure-ammo-source',

            componentId: ammoId,
            munitionKey: precision.id,
            remaining: 4,
        });
        runtime.dispatchAttackerTargeting({
            kind: 'edit-attacker-targeting',


            edit: {
                kind: 'set-component-selection',
                componentId: weaponId,
                selection: { kind: 'target', targetId },
            },
        }, registry, false);
        runtime.dispatchAttackerTargeting({
            kind: 'edit-attacker-targeting',


            edit: {
                kind: 'set-target-facts',
                targetId,
                facts: { distance: 6 },
            },
        }, registry, false);
        runtime.dispatchAttackerTargeting({
            kind: 'edit-attacker-targeting',


            edit: {
                kind: 'set-component-ammo',
                componentId: weaponId,
                ammo: { munitionKey: precision.id, preferredSourceId: ammoId },
            },
        }, registry, false);
        runtime.dispatch({
            kind: 'set-component-status',

            componentId: weaponId,
            status: 'destroyed',
            target: 'pending',
        });
        runtime.dispatch({
            kind: 'set-component-status',

            componentId: ammoId,
            status: 'destroyed',
            target: 'pending',
        });

        const snapshot = projectNonMekEquipmentPanel(
            entity,
            runtime.getIndex(),
            CORE_2026_RULESET,
            runtime.snapshot(),
            createDefaultCrewAssignment(runtime.getIndex().crewPositions),
            registry,
        );
        const weaponRow = snapshot.components.find(row => row.componentId === weaponId)!;
        const ammoRow = snapshot.components.find(row => row.componentId === ammoId)!;

        expect(snapshot.unitType).toBe('Tank');
        expect(snapshot.tracksHeat).toBeFalse();
        expect(weaponRow.status).toBe('available');
        expect(weaponRow.previewStatus).toBe('destroyed');
        expect(weaponRow.mode).toBeUndefined();
        expect(weaponRow.weapon?.damage).toBe(10);
        expect(weaponRow.weapon?.selectable).toBeTrue();
        expect(weaponRow.weapon?.selection).toEqual({ kind: 'target', targetId });
        expect(weaponRow.weapon?.ammoSelection).toEqual({
            munitionKey: precision.id,
            preferredSourceId: ammoId,
        });
        expect(weaponRow.weapon?.ammoSources.map(source => source.componentId)).toEqual([ammoId]);
        expect(weaponRow.weapon?.ammoSources[0]?.munitionKey).toBe(precision.id);
        expect(weaponRow.weapon?.ammoSources[0]?.remaining).toBe(4);
        expect(weaponRow.weapon?.ammoSources[0]).toEqual(jasmine.objectContaining({
            location,
            status: 'available',
        }));
        expect(ammoRow.status).toBe('available');
        expect(ammoRow.previewStatus).toBe('destroyed');
        expect(ammoRow.ammo?.loadouts.map(loadout => loadout.munitionKey))
            .toEqual([standard.id, precision.id]);
        expect(ammoRow.ammo?.remaining).toBe(4);
        expect(snapshot.targets.map(target => target.targetId)).toEqual([targetId]);
        const target = equipmentPanelRuntimeTarget(snapshot.targets[0], snapshot.ruleset);
        expect(target.tnModifier).toBe(3);
        const presentation = projectWeaponTargetPresentation(
            weaponRow,
            target,
            snapshot.crew.gunnery,
            null,
            snapshot.ruleset,
        );
        expect(presentation.targetModifier).toBe(1);
        expect(presentation.targetModifierBreakdown).toEqual([
            jasmine.objectContaining({ id: 'target-movement', modifier: 3 }),
            { id: 'precision', label: 'Precision', modifier: -2 },
        ]);

        runtime.dispatch({ kind: 'end-phase'});
        const committed = projectNonMekEquipmentPanel(
            entity,
            runtime.getIndex(),
            CORE_2026_RULESET,
            runtime.snapshot(),
            createDefaultCrewAssignment(runtime.getIndex().crewPositions),
            registry,
        );
        const committedWeapon = committed.components.find(row => row.componentId === weaponId)!;
        expect(committedWeapon.weapon?.ammoSources[0]).toEqual(jasmine.objectContaining({
            status: 'destroyed',
            remaining: 0,
        }));
    });

    it('applies direct vehicle system rules to weapon status, firing, and to-hit display', () => {
        const laser = new WeaponEquipment({
            id: 'VehicleLaser',
            name: 'Vehicle Laser',
            type: 'weapon',
            flags: ['F_DIRECT_FIRE', 'F_ENERGY'],
            weapon: { damage: 5, ranges: [3, 6, 9, 12] },
        });
        const targetingComputer = createEquipment({
            id: 'VehicleTargetingComputer',
            name: 'Targeting Computer',
            type: 'misc',
            flags: ['F_TARGETING_COMPUTER'],
        });
        const entity = new TestTankEntity(createTestEquipmentRegistry({
            [laser.id]: laser,
            [targetingComputer.id]: targetingComputer,
        }));
        entity.uuid.set(UUID);
        const mount = addTestEquipment(entity, laser, { location: 'Front' });
        addTestEquipment(entity, targetingComputer, { location: 'Body' });
        const runtime = new NonMekUnitInstance(
            asUnitInstanceId('unit:tank-system-rules'),
            baseline(),
            entity,
            CORE_2026_RULESET,
        );
        runtime.dispatch({
            kind: 'damage-track',

            damageTrackId: nonMekDamageTrackId('engine_hit_1'),
            amount: 1,
            target: 'committed',
            timestamp: 1,
        });
        runtime.dispatch({
            kind: 'set-sensor-damage-level',

            level: 4,
            target: 'committed',
            timestamp: 2,
        });

        const snapshot = projectNonMekEquipmentPanel(
            entity,
            runtime.getIndex(),
            CORE_2026_RULESET,
            runtime.snapshot(),
            createDefaultCrewAssignment(runtime.getIndex().crewPositions),
            Object.freeze({ revision: asStateRevision(0), targets: Object.freeze([]) }),
        );
        const row = snapshot.components.find(component =>
            component.componentId === asComponentId(mount.mountId))!;

        expect(row.status).toBe('disabled');
        expect(row.previewStatus).toBe('disabled');
        expect(row.weapon?.selectable).toBeFalse();
        expect(row.weapon?.toHitModifier).toBe(3);
        expect(row.weapon?.hitModifierBreakdown).toEqual([
            { label: 'Targeting Computer', modifier: -1 },
            { label: 'Sensor hits', modifier: 4, weakened: true },
        ]);
    });

    it('projects non-Mek vehicle Charge and exact stabilizer movement modifiers', () => {
        const weapon = new WeaponEquipment({
            id: 'StabilizedVehicleWeapon',
            name: 'Stabilized Vehicle Weapon',
            type: 'weapon',
            weapon: { damage: 5, ranges: [3, 6, 9, 12] },
        });
        const entity = new TestTankEntity(createTestEquipmentRegistry({ [weapon.id]: weapon }));
        entity.uuid.set(UUID);
        entity.setTonnage(60);
        entity.originalWalkMP.set(8);
        const mount = addTestEquipment(entity, weapon, { location: 'Front' });
        const runtime = new NonMekUnitInstance(
            asUnitInstanceId('unit:tank-charge-panel'),
            baseline(),
            entity,
            CORE_2026_RULESET,
        );
        runtime.dispatch({
            kind: 'damage-track',

            damageTrackId: nonMekDamageTrackId('stabilizer_hit_front'),
            amount: 1,
            target: 'committed',
            timestamp: 1,
        });
        runtime.dispatch({
            kind: 'set-movement',

            movement: { mode: 'run', distance: 5, boosterComponentIds: [] },
        });
        const registry = Object.freeze({ revision: asStateRevision(0), targets: Object.freeze([]) });
        runtime.dispatchAttackerTargeting({
            kind: 'edit-attacker-targeting',


            edit: {
                kind: 'set-action-selection',
                target: { kind: 'intrinsic', actionId: 'intrinsic:charge' },
                selection: { kind: 'selected' },
            },
        }, registry, false);

        const snapshot = projectNonMekEquipmentPanel(
            entity,
            runtime.getIndex(),
            CORE_2026_RULESET,
            runtime.snapshot(),
            createDefaultCrewAssignment(runtime.getIndex().crewPositions),
            registry,
        );
        const row = snapshot.components.find(component =>
            component.componentId === asComponentId(mount.mountId))!;
        expect(row.weapon?.hitModifierBreakdown).toContain({
            label: 'Stabilizer Hit',
            modifier: 2,
            weakened: true,
        });
        expect(snapshot.physicalAttacks).toHaveSize(1);
        expect(snapshot.physicalAttacks[0]).toEqual(jasmine.objectContaining({
            label: 'Charge',
            available: true,
            selectable: true,
            selection: { kind: 'selected' },
            effect: jasmine.objectContaining({
                kind: 'damage',
                damage: 36,
                maximumDamage: 60,
            }),
        }));
    });

    it('projects real aerospace heat and its named ranged-fire modifier', () => {
        const weapon = new WeaponEquipment({
            id: 'ISMediumPulseLaserPrototype',
            name: 'Prototype Medium Pulse Laser',
            type: 'weapon',
            weapon: { damage: 6, heat: 4, ranges: [2, 4, 6, 8], av: [6, 0, 0, 0] },
        });
        const entity = new TestAeroSpaceFighterEntity(createTestEquipmentRegistry({
            [weapon.id]: weapon,
        }));
        entity.uuid.set(UUID);
        entity.heatSinkCount.set(10);
        const mount = addTestEquipment(entity, weapon, { location: 'Nose' });
        const runtime = new NonMekUnitInstance(
            asUnitInstanceId('unit:aero-heat-panel'),
            baseline(),
            entity,
            CORE_2026_RULESET,
        );
        runtime.dispatch({
            kind: 'set-heat',

            heat: 24,
            target: 'committed',
        });
        const snapshot = projectNonMekEquipmentPanel(
            entity,
            runtime.getIndex(),
            CORE_2026_RULESET,
            runtime.snapshot(),
            createDefaultCrewAssignment(runtime.getIndex().crewPositions),
            Object.freeze({ revision: asStateRevision(0), targets: Object.freeze([]) }),
        );
        const row = snapshot.components.find(component =>
            component.componentId === asComponentId(mount.mountId))!;

        expect(snapshot.tracksHeat).toBeTrue();
        expect(snapshot.heat).toEqual({ current: 24, pending: null, sinksOff: 0 });
        expect(row.weapon).toEqual(jasmine.objectContaining({
            heat: 10,
            firingHeat: 10,
        }));
        expect(row.weapon?.heatSuffix).toBeUndefined();
        expect(row.weapon?.hitModifierBreakdown).toContain({
            label: 'Heat - Fire Modifier',
            modifier: 4,
            weakened: true,
            kind: 'heat',
        });
    });

    it('projects the non-Mek ProtoMek Frenzy action and crew availability', () => {
        const entity = new TestProtoMekEntity();
        entity.uuid.set(UUID);
        entity.setTonnage(10);
        entity.originalWalkMP.set(5);
        const runtime = new NonMekUnitInstance(
            asUnitInstanceId('unit:proto-frenzy'),
            baseline(),
            entity,
            CORE_2026_RULESET,
        );
        const registry = Object.freeze({ revision: asStateRevision(0), targets: Object.freeze([]) });
        const snapshot = () => projectNonMekEquipmentPanel(
            entity,
            runtime.getIndex(),
            CORE_2026_RULESET,
            runtime.snapshot(),
            createDefaultCrewAssignment(runtime.getIndex().crewPositions),
            registry,
        );

        expect(snapshot().physicalAttacks).toEqual([jasmine.objectContaining({
            label: 'Frenzy',
            available: true,
            selectable: true,
            hitModifiers: [0],
            effect: jasmine.objectContaining({
                kind: 'damage',
                damage: 3,
                maximumDamage: 3,
            }),
        })]);

        const crewId = [...runtime.getIndex().crewPositions.keys()][0]!;
        runtime.dispatch({
            kind: 'set-crew-state',

            positionId: crewId,
            wounds: 0,
            unconscious: true,
            ejected: false,
            killed: false,
            stunned: false,
        });
        expect(snapshot().physicalAttacks[0]).toEqual(jasmine.objectContaining({
            label: 'Frenzy',
            available: false,
            selectable: false,
        }));
    });

    it('keeps uncrewed Infantry field guns intact but prevents firing them', () => {
        const gun = new WeaponEquipment({
            id: 'InfantryFieldGun',
            name: 'Field Gun',
            type: 'weapon',
            stats: { tonnage: 6 },
            weapon: { damage: 2, ranges: [8, 16, 24, 32] },
        });
        const entity = new TestInfantryEntity(createTestEquipmentRegistry({ [gun.id]: gun }));
        entity.uuid.set(UUID);
        entity.squadSize.set(5);
        entity.squadCount.set(4);
        const mounts = Array.from({ length: 3 }, () =>
            addTestEquipment(entity, gun, { location: 'Field Guns' }));
        const runtime = new NonMekUnitInstance(
            asUnitInstanceId('unit:infantry-field-gun-panel'),
            baseline(),
            entity,
            CORE_2026_RULESET,
        );
        const troopLocation = [...runtime.getIndex().locations.values()][0]!;
        runtime.dispatch({
            kind: 'set-internal-damage',

            locationId: troopLocation.id,
            damage: 7,
        });

        const snapshot = projectNonMekEquipmentPanel(
            entity,
            runtime.getIndex(),
            CORE_2026_RULESET,
            runtime.snapshot(),
            createDefaultCrewAssignment(runtime.getIndex().crewPositions),
            Object.freeze({ revision: asStateRevision(0), targets: Object.freeze([]) }),
        );
        const rows = mounts.map(mount => snapshot.components.find(row =>
            row.componentId === asComponentId(mount.mountId))!);

        expect(rows.map(row => row.status)).toEqual(['available', 'available', 'available']);
        expect(rows.map(row => row.weapon?.selectable)).toEqual([true, true, false]);
    });

    it('projects one aggregate attack row per authored capital bay', () => {
        const laser = new WeaponEquipment({
            id: 'CapitalBayLaser',
            name: 'Capital Bay Laser',
            type: 'weapon',
            weapon: {
                atClass: 'CAPITAL_LASER',
                capital: true,
                damage: 1,
                heat: 10,
                ranges: [12, 24, 40, 50],
                av: [1, 1, 1, 0],
            },
        });
        const entity = new TestJumpShipEntity(createTestEquipmentRegistry({ [laser.id]: laser }));
        entity.uuid.set(UUID);
        const mounts = Array.from({ length: 4 }, () =>
            addTestEquipment(entity, laser, { location: entity.locationOrder[0] }));
        entity.addEquipmentBay('weapon-bay', { mounts });
        const runtime = new NonMekUnitInstance(
            asUnitInstanceId('unit:jumpship-bay-panel'),
            baseline(),
            entity,
            CORE_2026_RULESET,
        );

        const snapshot = projectNonMekEquipmentPanel(
            entity,
            runtime.getIndex(),
            CORE_2026_RULESET,
            runtime.snapshot(),
            createDefaultCrewAssignment(runtime.getIndex().crewPositions),
            Object.freeze({ revision: asStateRevision(0), targets: Object.freeze([]) }),
        );
        const weapons = snapshot.components.filter(row => row.weapon !== undefined);

        expect(weapons).toHaveSize(1);
        expect(weapons[0].attack?.source).toBe('authored-bay');
        expect(weapons[0].attack?.members.map(member => member.componentId))
            .toEqual(mounts.map(mount => asComponentId(mount.mountId)));
        expect(weapons[0].weapon?.firingHeat).toBe(40);
        expect(weapons[0].weapon?.aerospace?.attackValues).toEqual([4, 4, 4, 0]);
    });

    it('switches a DropShip projection between bay and grounded individual attacks', () => {
        const laser = new WeaponEquipment({
            id: 'DropShipBayLaser',
            name: 'DropShip Bay Laser',
            type: 'weapon',
            weapon: { damage: 5, heat: 5, ranges: [6, 12, 20, 25], av: [5, 5, 0, 0] },
        });
        const entity = new TestDropShipEntity(createTestEquipmentRegistry({ [laser.id]: laser }));
        entity.uuid.set(UUID);
        const mounts = Array.from({ length: 3 }, () =>
            addTestEquipment(entity, laser, { location: entity.locationOrder[0] }));
        entity.addEquipmentBay('weapon-bay', { mounts });
        const runtime = new NonMekUnitInstance(
            asUnitInstanceId('unit:dropship-bay-panel'),
            baseline(),
            entity,
            CORE_2026_RULESET,
        );
        const registry = Object.freeze({ revision: asStateRevision(0), targets: Object.freeze([]) });
        const weaponRows = () => projectNonMekEquipmentPanel(
            entity,
            runtime.getIndex(),
            CORE_2026_RULESET,
            runtime.snapshot(),
            createDefaultCrewAssignment(runtime.getIndex().crewPositions),
            registry,
        ).components.filter(row => row.weapon !== undefined);

        expect(weaponRows()).toHaveSize(1);
        runtime.dispatch({ kind: 'set-airborne', airborne: false });
        expect(weaponRows()).toHaveSize(3);
        runtime.dispatch({ kind: 'set-airborne', airborne: true });
        expect(weaponRows()).toHaveSize(1);
    });

    it('keeps a Leviathan-scale inventory projection bounded by bay count', () => {
        const weapon = new WeaponEquipment({
            id: 'LeviathanScaleNac',
            name: 'Leviathan Scale NAC',
            type: 'weapon',
            weapon: {
                atClass: 'CAPITAL_AC',
                ammoType: 'NAC',
                rackSize: 10,
                capital: true,
                damage: 1,
                heat: 10,
                ranges: [12, 24, 40, 50],
                av: [1, 1, 1, 0],
            },
        });
        const ammo = new AmmoEquipment({
            id: 'LeviathanScaleNacAmmo',
            name: 'Leviathan Scale NAC Ammo',
            type: 'ammo',
            ammo: { type: 'NAC', rackSize: 10, shots: 10 },
        });
        const entity = new TestJumpShipEntity(createTestEquipmentRegistry({
            [weapon.id]: weapon,
            [ammo.id]: ammo,
        }));
        entity.uuid.set(UUID);
        const location = entity.locationOrder[0];
        const baySizes = Array.from({ length: 73 }, (_, index) => index < 67 ? 7 : 6);
        for (const size of baySizes) {
            const mounts = Array.from({ length: size }, () =>
                addTestEquipment(entity, weapon, { location }));
            entity.addEquipmentBay('weapon-bay', { mounts });
        }
        Array.from({ length: 72 }, () =>
            addTestEquipment(entity, ammo, { location, shotsCount: 10 }));
        const runtime = new NonMekUnitInstance(
            asUnitInstanceId('unit:leviathan-scale-panel'),
            baseline(),
            entity,
            CORE_2026_RULESET,
        );

        const started = performance.now();
        const snapshot = projectNonMekEquipmentPanel(
            entity,
            runtime.getIndex(),
            CORE_2026_RULESET,
            runtime.snapshot(),
            createDefaultCrewAssignment(runtime.getIndex().crewPositions),
            Object.freeze({ revision: asStateRevision(0), targets: Object.freeze([]) }),
        );
        const elapsed = performance.now() - started;
        const weaponRows = snapshot.components.filter(row => row.weapon !== undefined);

        expect(entity.equipment()).toHaveSize(577);
        expect(weaponRows).toHaveSize(73);
        expect(weaponRows.flatMap(row => row.attack?.members ?? [])).toHaveSize(505);
        expect(snapshot.components).toHaveSize(145);
        expect(elapsed).withContext(`projection took ${elapsed.toFixed(1)}ms`).toBeLessThan(3_000);
    });
});

function baseline(): InstanceBaselineRef {
    return Object.freeze({
        entity: Object.freeze({
            origin: 'megamek' as const,
            provider: MM_DATA_UNIT_PROVIDER_ID,
            uuid: UUID,
            sourceFormat: 'blk' as const,
        }),
        ruleset: CORE_2026_RULESET,
        initialStateProfile: Object.freeze({
            schemaVersion: 1 as const,
            initializerRevision: 1,
            profileId: 'pristine-non-mek-v1',
        }),
    });
}
