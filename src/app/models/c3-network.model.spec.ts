// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import { signal } from '@angular/core';
import { MiscEquipment } from './equipment.model';
import {
    TestAeroSpaceFighterEntity,
    TestBattleArmorEntity,
    TestDropShipEntity,
    TestInfantryEntity,
    TestJumpShipEntity,
    TestProtoMekEntity,
    TestSmallCraftEntity,
    TestSpaceStationEntity,
    TestSupportNavalEntity,
    TestTankEntity,
    TestVtolEntity,
    TestWarShipEntity,
} from './entity/testing/test-entities';
import { buildNonMekRuntimeIndex } from './runtime/non-mek-runtime-index';
import type { SerializedC3NetworkGroup } from './force-serialization';
import {
    C3Capabilities,
    C3Network,
    C3NetworkType,
    C3Role,
    C3TaxCalculator,
    parseASC3Specials,
    projectNonMekC3Components,
    type C3Component,
    type C3UnitView,
} from './c3-network.model';

interface TestUnit {
    readonly unit: C3UnitView & { getBaseBv(): number; tagBV(): number };
    readonly components: C3Component[];
    readonly operational: ReturnType<typeof signal<boolean>>;
    readonly jammed: ReturnType<typeof signal<boolean>>;
}

function unit(
    id: string,
    components: readonly Omit<C3Component, 'index'>[],
    baseBv = 1000,
    tagBv = 0,
): TestUnit {
    const operational = signal(true);
    const jammed = signal(false);
    const normalized = components.map((component, index) => ({ ...component, index }));
    const view = {
        id,
        c3Components: normalized,
        getSummary: () => ({ name: id }),
        alias: () => undefined,
        c3Position: () => null,
        isC3Jammed: () => jammed(),
        isC3EndpointOperational: (index: number) => operational() && index < normalized.length,
        getBaseBv: () => baseBv,
        tagBV: () => tagBv,
    } as unknown as TestUnit['unit'];
    return { unit: view, components: normalized, operational, jammed };
}

function component(
    networkType: C3NetworkType,
    role: C3Role,
    extras: Partial<C3Component> = {},
): Omit<C3Component, 'index'> {
    return { networkType, role, boosted: false, ...extras };
}

describe('C3Capabilities', () => {
    it('uses explicit published endpoints in their canonical order', () => {
        const state = unit('multi', [
            component(C3NetworkType.C3, C3Role.MASTER),
            component(C3NetworkType.C3I, C3Role.PEER),
        ]);
        const capabilities = new C3Capabilities(state.unit);
        expect(capabilities.components.map(value => [value.index, value.role, value.networkType])).toEqual([
            [0, C3Role.MASTER, C3NetworkType.C3],
            [1, C3Role.PEER, C3NetworkType.C3I],
        ]);
        expect(capabilities.uniqueIndex(C3Role.MASTER, C3NetworkType.C3)).toBe(0);
        expect(Object.isFrozen(capabilities.components[0])).toBeTrue();
    });

    it('derives Alpha Strike endpoints only when no explicit endpoint projection exists', () => {
        const asUnit = {
            id: 'as',
            getSummary: () => ({ as: { specials: ['C3M2', 'NOVA'] } }),
            alias: () => undefined, c3Position: () => null, isC3Jammed: () => false,
            isC3EndpointOperational: () => true,
        } as unknown as C3UnitView;
        expect(new C3Capabilities(asUnit).components.map(value => [value.role, value.networkType])).toEqual([
            [C3Role.MASTER, C3NetworkType.C3],
            [C3Role.MASTER, C3NetworkType.C3],
            [C3Role.PEER, C3NetworkType.NOVA],
        ]);
        expect(parseASC3Specials(['C3I', 'NC3']).map(value => value.networkType)).toEqual([
            C3NetworkType.C3I, C3NetworkType.NAVAL,
        ]);
    });

    it('projects stable C3, C3i, Naval C3, Nova, and emergency endpoints for Entity families', () => {
        const entity = new TestTankEntity();
        const add = (id: string, flags: ConstructorParameters<typeof MiscEquipment>[0]['flags']) => {
            const equipment = new MiscEquipment({ id, name: id, type: 'misc', flags });
            entity.addEquipment({
                equipmentId: id,
                equipment,
                allocation: { kind: 'unallocated' },
                rearMounted: false,
                turretMounted: false,
                omniPodMounted: false,
                armored: false,
            });
        };
        add('Master', ['F_C3M']);
        add('Emergency', ['F_C3EM']);
        add('C3i', ['F_C3I']);
        add('Naval', ['F_NAVAL_C3']);
        add('Nova', ['F_NOVA']);
        add('Ambiguous', ['F_C3M', 'F_C3I']);

        const endpoints = projectNonMekC3Components(buildNonMekRuntimeIndex(entity));
        expect(endpoints.map(endpoint => [endpoint.networkType, endpoint.role, endpoint.emergency ?? false]))
            .toEqual([
                [C3NetworkType.C3, C3Role.MASTER, false],
                [C3NetworkType.C3, C3Role.SLAVE, true],
                [C3NetworkType.C3I, C3Role.PEER, false],
                [C3NetworkType.NAVAL, C3Role.PEER, false],
                [C3NetworkType.NOVA, C3Role.PEER, false],
            ]);
        expect(endpoints.every(endpoint => endpoint.componentId !== undefined)).toBeTrue();
        expect(Object.isFrozen(endpoints)).toBeTrue();
    });

    it('projects mounted C3 endpoints without family gates', () => {
        const entities = [
            new TestTankEntity(),
            new TestVtolEntity(),
            new TestSupportNavalEntity(),
            new TestInfantryEntity(),
            new TestBattleArmorEntity(),
            new TestProtoMekEntity(),
            new TestAeroSpaceFighterEntity(),
            new TestSmallCraftEntity(),
            new TestDropShipEntity(),
            new TestJumpShipEntity(),
            new TestWarShipEntity(),
            new TestSpaceStationEntity(),
        ];

        for (const entity of entities) {
            const equipment = new MiscEquipment({
                id: `C3i-${entity.entityType}`,
                name: 'C3i Computer',
                type: 'misc',
                flags: ['F_C3I'],
            });
            entity.addEquipment({
                equipmentId: equipment.id,
                equipment,
                allocation: { kind: 'unallocated' },
                rearMounted: false,
                turretMounted: false,
                omniPodMounted: false,
                armored: false,
            });

            expect(projectNonMekC3Components(buildNonMekRuntimeIndex(entity)))
                .withContext(entity.entityType)
                .toEqual([
                    jasmine.objectContaining({
                        networkType: C3NetworkType.C3I,
                        role: C3Role.PEER,
                        componentId: jasmine.any(String),
                    }),
                ]);
        }
    });
});

describe('C3Network', () => {
    it('indexes canonical hierarchy and endpoint identity without a mounted graph', () => {
        const networks: SerializedC3NetworkGroup[] = [
            { id: 'parent', type: C3NetworkType.C3, color: '#111', masterId: 'sunder', masterCompIndex: 0, members: ['sunder:1', 'atlas'] },
            { id: 'child', type: C3NetworkType.C3, color: '#222', masterId: 'sunder', masterCompIndex: 1, members: ['akuma'] },
            { id: 'peer', type: C3NetworkType.C3I, color: '#333', peerIds: ['sunder', 'peer'] },
        ];
        const model = new C3Network(networks);
        expect(model.topLevelNetworks.map(value => value.id)).toEqual(['parent', 'peer']);
        expect(model.parentOf('child')?.id).toBe('parent');
        expect(model.networksForUnit('sunder').map(value => value.id)).toEqual(['parent', 'child', 'peer']);
        expect(model.treeEndpointKeys('parent')).toEqual(new Set([
            'master:sunder:0', 'master:sunder:1', 'slave:atlas', 'slave:akuma',
        ]));
        expect(C3Network.parseMember('unit:2')).toEqual({ unitId: 'unit', compIndex: 2 });
        expect(C3Network.parseMember('unit:nope')).toEqual({ unitId: 'unit:nope' });
    });

    it('derives linked/degraded state from typed endpoint health and jamming', () => {
        const left = unit('left', [component(C3NetworkType.C3I, C3Role.PEER)]);
        const right = unit('right', [component(C3NetworkType.C3I, C3Role.PEER)]);
        const networks: SerializedC3NetworkGroup[] = [{
            id: 'peer', type: C3NetworkType.C3I, color: '#1565C0', peerIds: ['left', 'right'],
        }];
        const build = () => new C3Network(networks, [left.unit, right.unit]);
        expect(build().stateFor('left', C3NetworkType.C3I)).toEqual({ linked: true, degraded: false, color: '#1565C0' });
        right.jammed.set(true);
        expect(build().stateFor('left', C3NetworkType.C3I)).toEqual({ linked: true, degraded: true, color: '#1565C0' });
        right.operational.set(false);
        expect(build().stateFor('left', C3NetworkType.C3I)).toEqual({ linked: false, degraded: false, color: '#1565C0' });
    });

    it('uses an exact operational emergency endpoint and rejects a fried endpoint', () => {
        const master = unit('master', [component(C3NetworkType.C3, C3Role.MASTER)]);
        const emergency = unit('emergency', [component(C3NetworkType.C3, C3Role.SLAVE, { emergency: true })]);
        const slave = unit('slave', [component(C3NetworkType.C3, C3Role.SLAVE)]);
        master.operational.set(false);
        const networks: SerializedC3NetworkGroup[] = [{
            id: 'network', type: C3NetworkType.C3, color: '#123',
            masterId: 'master', masterCompIndex: 0, members: ['emergency', 'slave'],
        }];
        expect(new C3Network(networks, [master.unit, emergency.unit, slave.unit]).effectiveEmergencyMasterForNetwork('network'))
            .toEqual({ unitId: 'emergency', compIndex: 0 });
        emergency.components[0] = { ...emergency.components[0], emergencyFried: true };
        expect(new C3Network(networks, [master.unit, emergency.unit, slave.unit]).effectiveEmergencyMasterForNetwork('network'))
            .toBeUndefined();
    });
});

describe('C3TaxCalculator', () => {
    it('calculates from canonical network membership and base values', () => {
        const master = unit('master', [component(C3NetworkType.C3, C3Role.MASTER)], 1000);
        const slave = unit('slave', [component(C3NetworkType.C3, C3Role.SLAVE)], 500);
        const networks: SerializedC3NetworkGroup[] = [{
            id: 'network', type: C3NetworkType.C3, color: '#123',
            masterId: 'master', masterCompIndex: 0, members: ['slave'],
        }];
        const tax = new C3TaxCalculator(networks, [master.unit, slave.unit]);
        expect(tax.core2026(master.unit)).toBe(100);
        expect(tax.core2026(slave.unit)).toBe(50);
        expect(tax.totalWar(master.unit)).toBe(75);
        expect(tax.totalWar(slave.unit)).toBe(75);
    });
});
