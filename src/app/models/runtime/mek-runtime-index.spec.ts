// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import { TestBipedMekEntity as BipedMekEntity } from '../entity/testing/test-entities';
import { asArmorFaceId, asCriticalSlotId } from '../entity/entity-identifiers';
import { mekLocationId } from '../entity/mek-entity-conventions';
import { buildMekRuntimeIndex, componentIdForMount } from './mek-runtime-index';

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
});
