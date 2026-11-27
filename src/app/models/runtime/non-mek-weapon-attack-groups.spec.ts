// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import { WeaponEquipment } from '../equipment.model';
import { asComponentId } from '../entity/entity-identifiers';
import {
    TestAeroSpaceFighterEntity,
    TestConvFighterEntity,
    TestDropShipEntity,
    TestFixedWingSupportEntity,
    TestInfantryEntity,
    TestJumpShipEntity,
    TestSmallCraftEntity,
    TestSpaceStationEntity,
    TestTankEntity,
    TestVtolEntity,
    TestWarShipEntity,
} from '../entity/testing/test-entities';
import { createTestEquipmentRegistry } from '../entity/testing/test-equipment-registry';
import { addTestEquipment } from '../entity/testing/test-mounted-equipment';
import { buildNonMekRuntimeIndex } from './non-mek-runtime-index';
import {
    createPristineNonMekUnitState,
    hasNonMekAirborneTurnSelection,
} from './non-mek-unit-instance';
import {
    canSwitchNonMekAirGroundState,
    canonicalNonMekAirborneState,
    isOnlyAirborne,
    isSatelliteEntity,
    nonMekAirGroundCapability,
} from './non-mek-airborne-state';
import {
    nonMekWeaponAttackGroups,
    nonMekWeaponAttackMode,
} from './non-mek-weapon-attack-groups';

describe('non-Mek weapon attack grouping', () => {
    const laser = new WeaponEquipment({
        id: 'TestCapitalLaser',
        name: 'Test Capital Laser',
        type: 'weapon',
        weapon: {
            atClass: 'CAPITAL_LASER',
            capital: true,
            heat: 10,
            damage: 1,
            ranges: [12, 24, 40, 50],
            av: [1, 1, 1, 0],
        },
    });
    const registry = createTestEquipmentRegistry({ [laser.id]: laser });

    it('forces JumpShips, WarShips, Space Stations, and Satellites airborne and into bays', () => {
        const satellite = new TestFixedWingSupportEntity(registry);
        satellite.motiveType.set('Station Keeping');
        const entities = [
            new TestJumpShipEntity(registry),
            new TestWarShipEntity(registry),
            new TestSpaceStationEntity(registry),
            satellite,
        ];

        expect(isSatelliteEntity(satellite)).toBeTrue();
        for (const entity of entities) {
            expect(isOnlyAirborne(entity)).toBeTrue();
            expect(nonMekWeaponAttackMode(entity, turn(false))).toBe('weapon-bays');
            expect(createPristineNonMekUnitState(entity).turn.airborne).toBeTrue();
            expect(nonMekAirGroundCapability(entity)).toBe('only-airborne');
            expect(canonicalNonMekAirborneState(entity, false)).toBeTrue();
            expect(canSwitchNonMekAirGroundState(entity)).toBeFalse();
            expect(hasNonMekAirborneTurnSelection(entity, turn(true))).toBeFalse();
        }
    });

    it('offers airborne selection to craft and lift vehicles that can also operate grounded', () => {
        const wige = new TestTankEntity(registry);
        wige.motiveType.set('WiGE');
        const vtolInfantry = new TestInfantryEntity(registry);
        vtolInfantry.motiveType.set('VTOL');
        const entities = [
            new TestAeroSpaceFighterEntity(registry),
            new TestConvFighterEntity(registry),
            new TestFixedWingSupportEntity(registry),
            new TestSmallCraftEntity(registry),
            new TestDropShipEntity(registry),
            new TestVtolEntity(registry),
            wige,
            vtolInfantry,
        ];

        for (const entity of entities) {
            expect(isOnlyAirborne(entity)).withContext(entity.entityType).toBeFalse();
            expect(nonMekAirGroundCapability(entity)).withContext(entity.entityType).toBe('switchable');
            expect(canSwitchNonMekAirGroundState(entity)).withContext(entity.entityType).toBeTrue();
        }
    });

    it('normalizes permanently grounded units to an implicit unset state', () => {
        const tank = new TestTankEntity(registry);

        expect(nonMekAirGroundCapability(tank)).toBe('only-grounded');
        expect(canSwitchNonMekAirGroundState(tank)).toBeFalse();
        expect(canonicalNonMekAirborneState(tank, true)).toBeNull();
        expect(canonicalNonMekAirborneState(tank, false)).toBeNull();
    });

    it('switches only DropShips between grounded individual weapons and airborne bays', () => {
        const dropShip = new TestDropShipEntity(registry);
        const first = addTestEquipment(dropShip, laser, { location: dropShip.locationOrder[0] });
        const second = addTestEquipment(dropShip, laser, { location: dropShip.locationOrder[0] });
        const unclaimed = addTestEquipment(dropShip, laser, { location: dropShip.locationOrder[0] });
        dropShip.addEquipmentBay('weapon-bay', { mounts: [first, second] });
        const index = buildNonMekRuntimeIndex(dropShip);

        expect(canSwitchNonMekAirGroundState(dropShip)).toBeTrue();
        expect(hasNonMekAirborneTurnSelection(dropShip, turn(null))).toBeFalse();
        expect(hasNonMekAirborneTurnSelection(dropShip, turn(false))).toBeTrue();
        expect(hasNonMekAirborneTurnSelection(dropShip, turn(true))).toBeTrue();
        expect(nonMekWeaponAttackGroups(dropShip, index, turn(null))).toEqual([
            jasmine.objectContaining({ kind: 'weapon-bay', memberIds: [first.mountId, second.mountId] }),
            jasmine.objectContaining({
                kind: 'weapon-bay', source: 'synthetic-bay', memberIds: [unclaimed.mountId],
            }),
        ]);
        expect(nonMekWeaponAttackGroups(dropShip, index, turn(false)).map(group => group.kind))
            .toEqual(['individual-weapon', 'individual-weapon', 'individual-weapon']);
        expect(nonMekWeaponAttackGroups(dropShip, index, turn(true)).map(group => group.kind))
            .toEqual(['weapon-bay', 'weapon-bay']);
    });

    it('never leaks an unclaimed space-only weapon back to individual fire', () => {
        const jumpShip = new TestJumpShipEntity(registry);
        const first = addTestEquipment(jumpShip, laser, { location: jumpShip.locationOrder[0] });
        const second = addTestEquipment(jumpShip, laser, { location: jumpShip.locationOrder[0] });
        const groups = nonMekWeaponAttackGroups(
            jumpShip,
            buildNonMekRuntimeIndex(jumpShip),
            turn(false),
        );

        expect(groups).toEqual([jasmine.objectContaining({
            kind: 'weapon-bay',
            source: 'synthetic-bay',
            memberIds: [first.mountId, second.mountId],
        })]);
    });

    it('splits inferred bays at the 700-standard-damage construction limit', () => {
        const heavyCapitalLaser = new WeaponEquipment({
            id: 'TestHeavyCapitalLaser',
            name: 'Test Heavy Capital Laser',
            type: 'weapon',
            weapon: {
                atClass: 'CAPITAL_LASER',
                capital: true,
                heat: 10,
                damage: 40,
                ranges: [12, 24, 40, 50],
                av: [40, 40, 40, 0],
            },
        });
        const jumpShip = new TestJumpShipEntity(createTestEquipmentRegistry({
            [heavyCapitalLaser.id]: heavyCapitalLaser,
        }));
        const first = addTestEquipment(jumpShip, heavyCapitalLaser, {
            location: jumpShip.locationOrder[0],
        });
        const second = addTestEquipment(jumpShip, heavyCapitalLaser, {
            location: jumpShip.locationOrder[0],
        });

        expect(nonMekWeaponAttackGroups(
            jumpShip,
            buildNonMekRuntimeIndex(jumpShip),
            turn(true),
        )).toEqual([
            jasmine.objectContaining({ source: 'synthetic-bay', memberIds: [first.mountId] }),
            jasmine.objectContaining({ source: 'synthetic-bay', memberIds: [second.mountId] }),
        ]);
    });

    it('keeps capital mass drivers together despite the normal damage limit', () => {
        const massDriver = new WeaponEquipment({
            id: 'TestCapitalMassDriver',
            name: 'Test Capital Mass Driver',
            type: 'weapon',
            weapon: {
                atClass: 'CAPITAL_MD',
                capital: true,
                heat: 100,
                damage: 100,
                ranges: [12, 24, 40, 50],
                av: [100, 100, 100, 0],
            },
        });
        const warShip = new TestWarShipEntity(createTestEquipmentRegistry({ [massDriver.id]: massDriver }));
        const first = addTestEquipment(warShip, massDriver, { location: warShip.locationOrder[0] });
        const second = addTestEquipment(warShip, massDriver, { location: warShip.locationOrder[0] });

        expect(nonMekWeaponAttackGroups(
            warShip,
            buildNonMekRuntimeIndex(warShip),
            turn(true),
        )).toEqual([jasmine.objectContaining({
            source: 'synthetic-bay',
            memberIds: [first.mountId, second.mountId],
        })]);
    });

    it('splits inferred over-limit bays as evenly as possible', () => {
        const standardLaser = new WeaponEquipment({
            id: 'TestStandardLaser',
            name: 'Test Standard Laser',
            type: 'weapon',
            weapon: {
                atClass: 'LASER',
                heat: 10,
                damage: 100,
                ranges: [12, 24, 40, 50],
                av: [100, 100, 100, 0],
            },
        });
        const jumpShip = new TestJumpShipEntity(createTestEquipmentRegistry({
            [standardLaser.id]: standardLaser,
        }));
        const mounts = Array.from({ length: 10 }, () => addTestEquipment(
            jumpShip,
            standardLaser,
            { location: jumpShip.locationOrder[0] },
        ));

        const groups = nonMekWeaponAttackGroups(
            jumpShip,
            buildNonMekRuntimeIndex(jumpShip),
            turn(true),
        );

        expect(groups.map(group => group.memberIds.length)).toEqual([5, 5]);
        expect(new Set(groups.flatMap(group => group.memberIds)))
            .toEqual(new Set(mounts.map(mount => asComponentId(mount.mountId))));
    });

    it('keeps fighters individual even if an unsupported bay relationship is present', () => {
        const fighter = new TestAeroSpaceFighterEntity(registry);
        const first = addTestEquipment(fighter, laser, { location: fighter.locationOrder[0] });
        const second = addTestEquipment(fighter, laser, { location: fighter.locationOrder[0] });
        fighter.addEquipmentBay('weapon-bay', { mounts: [first, second] });

        expect(nonMekWeaponAttackGroups(
            fighter,
            buildNonMekRuntimeIndex(fighter),
            turn(true),
        ).map(group => group.kind)).toEqual([
            'individual-weapon',
            'individual-weapon',
        ]);
    });

    it('keeps Small Craft weapons individual in either movement state', () => {
        const smallCraft = new TestSmallCraftEntity(registry);
        const first = addTestEquipment(smallCraft, laser, { location: smallCraft.locationOrder[0] });
        const second = addTestEquipment(smallCraft, laser, { location: smallCraft.locationOrder[0] });
        smallCraft.addEquipmentBay('weapon-bay', { mounts: [first, second] });
        const index = buildNonMekRuntimeIndex(smallCraft);

        for (const airborne of [null, false, true] as const) {
            expect(nonMekWeaponAttackMode(smallCraft, turn(airborne))).toBe('individual-weapons');
            expect(nonMekWeaponAttackGroups(smallCraft, index, turn(airborne)).map(group => group.kind))
                .toEqual(['individual-weapon', 'individual-weapon']);
        }
    });

    it('derives Satellite bays by arc and bay class without mutating its mounts', () => {
        const satellite = new TestFixedWingSupportEntity(registry);
        satellite.motiveType.set('Station Keeping');
        const first = addTestEquipment(satellite, laser, { location: 'Nose' });
        const second = addTestEquipment(satellite, laser, { location: 'Nose' });
        const aft = addTestEquipment(satellite, laser, { location: 'Aft' });

        const groups = nonMekWeaponAttackGroups(
            satellite,
            buildNonMekRuntimeIndex(satellite),
            turn(false),
        );

        expect(groups).toEqual([
            jasmine.objectContaining({
                kind: 'weapon-bay',
                source: 'synthetic-bay',
                memberIds: [first.mountId, second.mountId],
            }),
            jasmine.objectContaining({
                kind: 'weapon-bay',
                source: 'synthetic-bay',
                memberIds: [aft.mountId],
            }),
        ]);
        expect(satellite.equipment()).toHaveSize(3);
        expect(satellite.equipmentBays()).toHaveSize(0);
    });
});

function turn(airborne: boolean | null) {
    return { turn: { airborne } } as const;
}
