// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import {
    RuntimeEquipmentStatusKernel,
    type RuntimeEquipmentCommittedState,
    type RuntimeEquipmentStatusTopology,
} from './equipment-status-kernel';
import type { EquipmentFlag } from '../equipment-flags.type';

function topology(flags: readonly EquipmentFlag[] = ['F_AC']): RuntimeEquipmentStatusTopology {
    return {
        components: new Map([
            ['weapon', {
                id: 'weapon',
                flags: new Set<EquipmentFlag>(flags),
                locationIds: ['LT', 'RT'],
                criticalSlotIds: ['LT:3', 'RT:4'],
            }],
        ]),
        criticalSlots: new Map([
            ['LT:3', { id: 'LT:3', componentIds: ['weapon'], locationId: 'LT' }],
            ['RT:4', { id: 'RT:4', componentIds: ['weapon'], locationId: 'RT' }],
        ]),
    };
}

function committed(input: Partial<RuntimeEquipmentCommittedState> = {}): RuntimeEquipmentCommittedState {
    return {
        components: input.components ?? new Map(),
        criticalSlots: input.criticalSlots ?? new Map(),
        locations: input.locations ?? new Map(),
        engineHit: input.engineHit ?? false,
    };
}

function destroyed(hits = 1) {
    return { status: 'destroyed' as const, hits, armored: false };
}

describe('RuntimeEquipmentStatusKernel', () => {
    it('uses two destroyed criticals for Core autocannons and one for other Core Mek equipment', () => {
        const state = committed({ criticalSlots: new Map([['LT:3', destroyed()]]) });
        const ac = new RuntimeEquipmentStatusKernel(topology(), state, { rules: 'core-2026', family: 'mek' });
        const laser = new RuntimeEquipmentStatusKernel(
            topology(['F_ENERGY']), state, { rules: 'core-2026', family: 'mek' },
        );

        expect(ac.component('weapon').status).toBe('available');
        expect(laser.component('weapon').status).toBe('destroyed');

        const twoHits = committed({
            criticalSlots: new Map([['LT:3', destroyed()], ['RT:4', destroyed()]]),
        });
        expect(new RuntimeEquipmentStatusKernel(
            topology(), twoHits, { rules: 'core-2026', family: 'mek' },
        ).component('weapon').status).toBe('destroyed');
    });

    it('uses the one-critical Total Warfare threshold even for autocannons', () => {
        const kernel = new RuntimeEquipmentStatusKernel(
            topology(),
            committed({ criticalSlots: new Map([['LT:3', destroyed()]]) }),
            { rules: 'total-warfare', family: 'mek' },
        );
        expect(kernel.component('weapon').status).toBe('destroyed');
    });

    it('counts repeat hits in one Core autocannon slot after component armor', () => {
        const oneSlot: RuntimeEquipmentStatusTopology = {
            components: new Map([['weapon', {
                id: 'weapon', flags: new Set(['F_AC']), locationIds: ['LT'], criticalSlotIds: ['LT:3'],
            }]]),
            criticalSlots: new Map([['LT:3', {
                id: 'LT:3', componentIds: ['weapon'], locationId: 'LT',
            }]]),
        };
        expect(new RuntimeEquipmentStatusKernel(oneSlot, committed({
            criticalSlots: new Map([['LT:3', { status: 'destroyed', hits: 2, armored: true }]]),
        }), { rules: 'core-2026', family: 'mek' }).component('weapon').status).toBe('available');
        expect(new RuntimeEquipmentStatusKernel(oneSlot, committed({
            criticalSlots: new Map([['LT:3', { status: 'destroyed', hits: 3, armored: true }]]),
        }), { rules: 'core-2026', family: 'mek' }).component('weapon').status).toBe('destroyed');
    });

    it('isolates per-location critical queries while whole-mount queries combine locations', () => {
        const kernel = new RuntimeEquipmentStatusKernel(
            topology(['F_ENERGY']),
            committed({ criticalSlots: new Map([['RT:4', destroyed()]]) }),
            { rules: 'core-2026', family: 'mek' },
        );
        expect(kernel.componentAtLocation('weapon', 'LT').status).toBe('available');
        expect(kernel.componentAtLocation('weapon', 'RT').status).toBe('destroyed');
        expect(kernel.component('weapon').status).toBe('destroyed');
    });

    it('disables only vehicle energy equipment after a committed engine hit', () => {
        const energy = new RuntimeEquipmentStatusKernel(
            topology(['F_ENERGY']), committed({ engineHit: true }),
            { rules: 'core-2026', family: 'vehicle' },
        );
        const ballistic = new RuntimeEquipmentStatusKernel(
            topology(['F_BALLISTIC']), committed({ engineHit: true }),
            { rules: 'core-2026', family: 'vehicle' },
        );
        expect(energy.component('weapon').status).toBe('disabled');
        expect(ballistic.component('weapon').status).toBe('available');
    });

    it('preserves destroyed over disabled severity and reads committed facts only', () => {
        const kernel = new RuntimeEquipmentStatusKernel(
            topology(['F_ENERGY']),
            committed({
                engineHit: true,
                components: new Map([['weapon', 'destroyed']]),
                locations: new Map([['LT', 'disabled']]),
            }),
            { rules: 'core-2026', family: 'vehicle' },
        );
        expect(kernel.component('weapon').status).toBe('destroyed');
    });

    it('keeps stale references available but makes the mismatch explicit', () => {
        const kernel = new RuntimeEquipmentStatusKernel(
            topology(), committed(), { rules: 'core-2026', family: 'mek' },
        );
        expect(kernel.component('gone')).toEqual({
            status: 'available',
            diagnostics: [{ code: 'STALE_COMPONENT_REFERENCE', referenceId: 'gone' }],
        });
        expect(kernel.criticalSlot('gone')).toEqual({
            status: 'available',
            diagnostics: [{ code: 'STALE_CRITICAL_REFERENCE', referenceId: 'gone' }],
        });
    });

    it('rejects duplicate or inconsistent topology identities at the boundary', () => {
        const invalid = topology();
        const component = invalid.components.get('weapon')!;
        expect(() => new RuntimeEquipmentStatusKernel({
            ...invalid,
            components: new Map([['weapon', { ...component, criticalSlotIds: ['LT:3', 'LT:3'] }]]),
        }, committed(), { rules: 'core-2026', family: 'mek' })).toThrowError(/Duplicate critical identity/);
    });
});
