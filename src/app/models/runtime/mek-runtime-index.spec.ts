// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import { MountedEngine } from '../entity/components';
import type { MekLocation, MekSystemType } from '../entity/types';
import {
    TestBipedMekEntity as BipedMekEntity,
    TestQuadVeeEntity as QuadVeeEntity,
} from '../entity/testing/test-entities';
import { asArmorFaceId, asComponentId, asCriticalSlotId } from '../entity/entity-identifiers';
import { mekLocationId } from '../entity/mek-entity-conventions';
import {
    buildMekRuntimeIndex,
    componentIdForMount,
    componentLocationIds,
    type MekIndexedSystem,
    type MekRuntimeIndex,
} from './mek-runtime-index';

function systemComponents(index: MekRuntimeIndex, systemType: MekSystemType): MekIndexedSystem[] {
    return [...index.components.values()].filter(
        (component): component is MekIndexedSystem =>
            component.kind === 'system' && component.systemType === systemType,
    ).sort((left, right) => left.id.localeCompare(right.id));
}

function systemLocationCodes(index: MekRuntimeIndex, component: MekIndexedSystem): MekLocation[] {
    return [...new Set(component.placements.map(placement =>
        index.locations.get(placement.locationId)?.code,
    ).filter((code): code is MekLocation => code !== undefined))].sort();
}

describe('MekRuntimeIndex', () => {
    it('indexes actual entity mounts by mountId without copying equipment facts', () => {
        const entity = new BipedMekEntity();
        entity.setTonnage(50);
        entity.setArmorValue('CT', 'front', 20);
        entity.setArmorValue('CT', 'rear', 8);
        const mount = entity.addEquipment({
            equipmentId: 'Unresolved Test Equipment',
            allocation: {
                kind: 'location',
                location: 'CT',
                placements: [{ location: 'CT', slotIndex: 8 }],
            },
            rearMounted: false,
            turretMounted: false,
            omniPodMounted: false,
            armored: true,
        });

        const index = buildMekRuntimeIndex(entity);
        const componentId = componentIdForMount(mount);
        const component = index.components.get(componentId);
        const locationId = mekLocationId('CT')!;

        expect(componentId).toBe(mount.mountId);
        expect(component?.kind).toBe('equipment');
        expect(component?.kind === 'equipment' && component.mount).toBe(mount);
        expect(component && 'equipment' in component).toBeFalse();
        expect(index.slots.get(asCriticalSlotId(`critical:${locationId}:8`))).toEqual(
            jasmine.objectContaining({ componentIds: [componentId], armored: true }),
        );
        expect(index.armorFaces.get(asArmorFaceId(`armor:${locationId}:front`))?.maximumPoints).toBe(20);
        expect(index.armorFaces.get(asArmorFaceId(`armor:${locationId}:rear`))?.maximumPoints).toBe(8);
    });

    it('uses semantic system identities and direct entity relationships', () => {
        const entity = new BipedMekEntity();
        entity.setTonnage(50);
        const first = entity.addEquipment({
            equipmentId: 'First',
            allocation: { kind: 'location', location: 'LT' },
            rearMounted: false,
            turretMounted: false,
            omniPodMounted: false,
            armored: false,
        });
        const second = entity.addEquipment({
            equipmentId: 'Second',
            allocation: { kind: 'location', location: 'LT' },
            rearMounted: false,
            turretMounted: false,
            omniPodMounted: false,
            armored: false,
        });
        entity.addEquipmentBay('weapon-bay', { controller: first, mounts: [second] });

        const index = buildMekRuntimeIndex(entity);
        const systemIds = [...index.components]
            .filter(([, component]) => component.kind === 'system')
            .map(([id]) => id);

        expect(systemIds.length).toBeGreaterThan(0);
        expect(systemIds.every(id => id.startsWith('system:'))).toBeTrue();
        expect(index.relationships.bays).toEqual([jasmine.objectContaining({
            controllerId: componentIdForMount(first),
            memberIds: [componentIdForMount(second)],
        })]);
    });

    it('precomputes stable component locations and distinct Mek topology relations', () => {
        const entity = new BipedMekEntity();
        entity.setTonnage(50);
        const mount = entity.addEquipment({
            equipmentId: 'Left Arm Test Equipment',
            allocation: { kind: 'location', location: 'LA' },
            rearMounted: false,
            turretMounted: false,
            omniPodMounted: false,
            armored: false,
        });
        const index = buildMekRuntimeIndex(entity);
        const componentId = componentIdForMount(mount);
        const leftArmId = mekLocationId('LA')!;
        const rightArmId = mekLocationId('RA')!;
        const leftLegId = mekLocationId('LL')!;
        const rightLegId = mekLocationId('RL')!;
        const leftTorsoId = mekLocationId('LT')!;
        const rightTorsoId = mekLocationId('RT')!;
        const centerTorsoId = mekLocationId('CT')!;

        expect(componentLocationIds(index, componentId)).toEqual([leftArmId]);
        expect(componentLocationIds(index, componentId))
            .toBe(componentLocationIds(index, componentId));
        expect(index.damageTransferLocationIdByLocation.get(leftArmId)).toBe(leftTorsoId);
        expect(index.damageTransferLocationIdByLocation.get(leftLegId)).toBe(leftTorsoId);
        expect(index.damageTransferLocationIdByLocation.get(leftTorsoId)).toBe(centerTorsoId);
        expect(index.damageTransferLocationIdByLocation.get(rightArmId)).toBe(rightTorsoId);
        expect(index.damageTransferLocationIdByLocation.get(rightLegId)).toBe(rightTorsoId);
        expect(index.damageTransferLocationIdByLocation.get(rightTorsoId)).toBe(centerTorsoId);
        expect(index.damageTransferLocationIdByLocation.get(centerTorsoId)).toBeNull();

        expect(index.destructionParentLocationIdByLocation.get(leftArmId)).toBe(leftTorsoId);
        expect(index.destructionParentLocationIdByLocation.get(leftLegId)).toBeNull();
        expect(index.destructionParentLocationIdByLocation.get(leftTorsoId)).toBeNull();
    });

    it('groups unit-wide systems while keeping matching actuators location-scoped', () => {
        const entity = new BipedMekEntity();
        entity.setTonnage(50);
        entity.mountedEngine.set(new MountedEngine({ type: 'XL', rating: 250, techBase: 'IS' }));

        const index = buildMekRuntimeIndex(entity);
        const engines = systemComponents(index, 'Engine');
        const upperArms = systemComponents(index, 'Upper Arm Actuator');

        expect(engines.length).toBe(1);
        expect(engines[0]!.id).toBe(asComponentId('system:engine'));
        expect(systemLocationCodes(index, engines[0]!)).toEqual(['CT', 'LT', 'RT']);
        expect(upperArms.length).toBe(2);
        expect(upperArms.map(component => component.id)).toEqual([
            asComponentId('system:upper-arm-actuator:mek:left-arm'),
            asComponentId('system:upper-arm-actuator:mek:right-arm'),
        ]);
        expect(upperArms.map(component => systemLocationCodes(index, component))).toEqual([
            ['LA'],
            ['RA'],
        ]);
    });

    it('treats each QuadVee conversion gear as a separate limb component', () => {
        const entity = new QuadVeeEntity();
        entity.setTonnage(50);

        const index = buildMekRuntimeIndex(entity);
        const conversionGears = systemComponents(index, 'Conversion Gear');

        expect(conversionGears.length).toBe(4);
        expect(conversionGears.map(component => component.id)).toEqual([
            asComponentId('system:conversion-gear:mek:front-left-leg'),
            asComponentId('system:conversion-gear:mek:front-right-leg'),
            asComponentId('system:conversion-gear:mek:rear-left-leg'),
            asComponentId('system:conversion-gear:mek:rear-right-leg'),
        ]);
        expect(conversionGears.map(component => systemLocationCodes(index, component))).toEqual([
            ['FLL'],
            ['FRL'],
            ['RLL'],
            ['RRL'],
        ]);
        expect(conversionGears.every(component => component.placements.length === 1)).toBeTrue();
    });
});
