// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import { ECMMode } from '../common.model';
import { createEquipment, WeaponEquipment } from '../equipment.model';
import type { ComponentId } from '../entity/entity-identifiers';
import { TestBipedMekEntity } from '../entity/testing/test-entities';
import { addTestEquipment } from '../entity/testing/test-mounted-equipment';
import type { UnitConditionKey } from '../unit-condition.model';
import type { ClassicUnitQueryPort } from './classic-unit-runtime';
import { projectClassicUnitTagEcmCapabilitySummary } from './classic-unit-capability-projection';
import { buildMekRuntimeIndex, componentIdForMount } from './mek-runtime-index';

describe('Classic unit capability projection', () => {
    it('derives light TAG and the selected ECM mode from Entity equipment', () => {
        const entity = new TestBipedMekEntity();
        addTestEquipment(entity, tagWeapon('Light TAG', 3));
        const ecm = addTestEquipment(entity, createEquipment({
            id: 'Test Angel ECM',
            name: 'Test Angel ECM',
            type: 'misc',
            flags: ['F_ECM', 'F_ANGEL_ECM'],
        }));

        const summary = projectClassicUnitTagEcmCapabilitySummary(source(entity, {
            modes: new Map([[componentIdForMount(ecm), ECMMode.ECM_GHOST]]),
        }));

        expect(summary).toEqual({
            tag: { label: 'LTAG', unavailable: false },
            ecm: { mode: ECMMode.ECM_GHOST, unavailable: false },
        });
    });

    it('prefers operational equipment and retains installed damaged fallbacks', () => {
        const entity = new TestBipedMekEntity();
        const damagedTag = addTestEquipment(entity, tagWeapon('TAG', 6));
        addTestEquipment(entity, tagWeapon('Backup Light TAG', 3));
        const damagedEcm = addTestEquipment(entity, createEquipment({
            id: 'Damaged ECM', name: 'Damaged ECM', type: 'misc', flags: ['F_ECM'],
        }));
        const workingEcm = addTestEquipment(entity, createEquipment({
            id: 'Working Angel ECM',
            name: 'Working Angel ECM',
            type: 'misc',
            flags: ['F_ECM', 'F_ANGEL_ECM'],
        }));

        const summary = projectClassicUnitTagEcmCapabilitySummary(source(entity, {
            unavailable: new Set([
                componentIdForMount(damagedTag),
                componentIdForMount(damagedEcm),
            ]),
            modes: new Map([[componentIdForMount(workingEcm), ECMMode.ECCM]]),
        }));

        expect(summary).toEqual({
            tag: { label: 'LTAG', unavailable: false },
            ecm: { mode: ECMMode.ECCM, unavailable: false },
        });
    });

    it('marks installed systems unavailable when damage or transient unit state blocks them', () => {
        const entity = new TestBipedMekEntity();
        const tag = addTestEquipment(entity, tagWeapon('TAG', 6));
        const ecm = addTestEquipment(entity, createEquipment({
            id: 'Test ECM', name: 'Test ECM', type: 'misc', flags: ['F_ECM'],
        }));
        const unavailable = new Set([componentIdForMount(tag), componentIdForMount(ecm)]);

        expect(projectClassicUnitTagEcmCapabilitySummary(source(entity, { unavailable }))).toEqual({
            tag: { label: 'TAG', unavailable: true },
            ecm: { mode: ECMMode.OFF, unavailable: true },
        });
        expect(projectClassicUnitTagEcmCapabilitySummary(source(entity, {
            conditions: new Set(['shutdown']),
        }))).toEqual({
            tag: { label: 'TAG', unavailable: true },
            ecm: { mode: ECMMode.OFF, unavailable: true },
        });
    });
});

function tagWeapon(name: string, shortRange: number): WeaponEquipment {
    return new WeaponEquipment({
        id: name,
        name,
        type: 'weapon',
        flags: ['F_TAG'],
        weapon: {
            ammoType: 'NA',
            damage: 0,
            rackSize: 0,
            ranges: [shortRange, shortRange * 2, shortRange * 3, shortRange * 4],
        },
    });
}

function source(
    entity: TestBipedMekEntity,
    options: Readonly<{
        unavailable?: ReadonlySet<ComponentId>;
        modes?: ReadonlyMap<ComponentId, string>;
        conditions?: ReadonlySet<UnitConditionKey>;
        destroyed?: boolean;
    }> = {},
) {
    const index = buildMekRuntimeIndex(entity);
    const query: Pick<
        ClassicUnitQueryPort,
        'componentMode' | 'componentStatus' | 'destroyed' | 'hasCondition'
    > = {
        componentMode: componentId => options.modes?.get(componentId),
        componentStatus: componentId => options.unavailable?.has(componentId) ? 'destroyed' : 'available',
        destroyed: () => options.destroyed ?? false,
        hasCondition: condition => options.conditions?.has(condition) ?? false,
    };
    return { index, query };
}
