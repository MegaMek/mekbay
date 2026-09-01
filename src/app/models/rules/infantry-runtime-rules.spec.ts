// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import { CORE_2026_RULESET } from '../cbt-ruleset.model';
import { WeaponEquipment } from '../equipment.model';
import {
    TestBattleArmorEntity,
    TestInfantryEntity,
} from '../entity/testing/test-entities';
import { addTestEquipment } from '../entity/testing/test-mounted-equipment';
import { asUnitUuid } from '../../services/unit-catalog/unit-catalog.types';
import { componentIdForMount } from '../runtime/non-mek-runtime-index';
import { NonMekUnitInstance, projectNonMekMovementCapabilities } from '../runtime/non-mek-unit-instance';
import { type InstanceBaselineRef } from '../runtime/runtime-state';
import { projectInfantryRuntimeRules } from './infantry-runtime-rules';

const UUID = asUnitUuid('019f6767-0dcb-7bb8-992f-aef08202f5e1');

describe('Infantry runtime rules', () => {
    it('disables field-gun instances beyond the committed functional crew count', () => {
        const entity = infantry();
        const gun = fieldGun();
        const mounts = Array.from({ length: 3 }, () =>
            addTestEquipment(entity, gun, { location: 'Field Guns' }));
        const runtime = instance(entity, 'unit:infantry-field-guns');
        const troopLocation = [...runtime.getIndex().locations.values()][0]!;

        runtime.dispatch({
            kind: 'set-internal-damage',
            
            locationId: troopLocation.id,
            damage: 7,
        });
        const rules = projectInfantryRuntimeRules(
            entity,
            runtime.getIndex(),
            runtime.snapshot(),
        );

        expect([...rules.fireBlockedComponentIds]).toEqual([componentIdForMount(mounts[2]!)]);
        expect(mounts.map(mount => runtime.componentStatus(componentIdForMount(mount))))
            .toEqual(['available', 'available', 'available']);
    });

    it('derives conventional Infantry destruction from committed troop loss', () => {
        const entity = infantry();
        const runtime = instance(entity, 'unit:infantry-destroyed');
        const troopLocation = [...runtime.getIndex().locations.values()][0]!;

        runtime.dispatch({
            kind: 'set-internal-damage',
            
            locationId: troopLocation.id,
            damage: troopLocation.internalPoints,
        });

        expect(runtime.snapshot().explicitlyDestroyed).toBeFalse();
        expect(runtime.destroyed()).toBeTrue();
        expect(runtime.stateView().destroyed).toBeTrue();
        expect(projectNonMekMovementCapabilities(
            entity,
            runtime.getIndex(),
            runtime.snapshot(),
            CORE_2026_RULESET,
        )).toEqual(jasmine.objectContaining({ destroyed: true, immobile: true }));
    });

    it('derives Battle Armor destruction without mutating its squad equipment', () => {
        const entity = new TestBattleArmorEntity();
        entity.uuid.set(UUID);
        entity.trooperCount.set(2);
        entity.setArmorValue('Squad', 'front', 3);
        const mount = addTestEquipment(entity, fieldGun(), { location: 'Squad' });
        const runtime = instance(entity, 'unit:battle-armor-destroyed');

        for (const location of runtime.getIndex().locations.values()) {
            const face = runtime.getIndex().armorFaces.get(location.armorFaceIds[0]!)!;
            runtime.dispatch({
                kind: 'set-armor-damage',
                
                faceId: face.id,
                damage: face.maximumPoints,
            });
            runtime.dispatch({
                kind: 'set-internal-damage',
                
                locationId: location.id,
                damage: location.internalPoints,
            });
        }

        expect(runtime.destroyed()).toBeTrue();
        expect(runtime.componentStatus(componentIdForMount(mount))).toBe('available');
        expect(runtime.snapshot().components.size).toBe(0);
    });

    it('requires Infantry jump declarations to move at least one hex', () => {
        const entity = infantry();
        entity.motiveType.set('Jump');
        const runtime = instance(entity, 'unit:infantry-jump');
        const capabilities = projectNonMekMovementCapabilities(
            entity,
            runtime.getIndex(),
            runtime.snapshot(),
            CORE_2026_RULESET,
        );

        expect(capabilities.minimum.jump).toBe(1);
        expect(capabilities.maximum.jump).toBe(3);
        expect(runtime.dispatch({
            kind: 'set-movement',
            
            movement: { mode: 'jump', distance: 0, boosterComponentIds: [] },
        })).toEqual(jasmine.objectContaining({ accepted: true, changed: false }));
        expect(runtime.dispatch({
            kind: 'set-movement',
            
            movement: { mode: 'jump', distance: 1, boosterComponentIds: [] },
        }).accepted).toBeTrue();
    });
});

function infantry(): TestInfantryEntity {
    const entity = new TestInfantryEntity();
    entity.uuid.set(UUID);
    entity.squadSize.set(5);
    entity.squadCount.set(4);
    return entity;
}

function fieldGun(): WeaponEquipment {
    return new WeaponEquipment({
        id: 'Autocannon/2',
        name: 'AC/2',
        type: 'weapon',
        stats: { tonnage: 6 },
        weapon: { ammoType: 'AC', rackSize: 2, damage: 2, ranges: [8, 16, 24, 32] },
    });
}

function instance(
    entity: TestInfantryEntity | TestBattleArmorEntity,
    id: string,
): NonMekUnitInstance {
    return new NonMekUnitInstance(
        id,
        baseline(),
        entity,
        CORE_2026_RULESET,
    );
}

function baseline(): InstanceBaselineRef {
    return Object.freeze({
        entity: UUID,
        ruleset: CORE_2026_RULESET,
        initialStateProfile: Object.freeze({
            schemaVersion: 1 as const,
            initializerRevision: 1,
            profileId: 'pristine-non-mek-v1',
        }),
    });
}
