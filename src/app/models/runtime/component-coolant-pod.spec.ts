// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import type { ComponentId } from '../entity/entity-identifiers';
import {
    COOLANT_POD_ACTIVE_MODE,
    COOLANT_POD_READY_MODE,
} from './component-coolant-pod';
import {
    createDirectCoolantPodRuntimeFixture,
    type DirectMekRuntimeFixture,
} from './testing/direct-mek-runtime-fixture';

describe('direct coolant-pod runtime', () => {
    it('spends one pod atomically, doubles the working sink bank, and resets after End Turn', () => {
        const fixture = createDirectCoolantPodRuntimeFixture();
        const [first, second] = coolantPods(fixture);

        expect(fixture.instance.dispatch({
            type: 'set-heatsinks-off',
            
            
            heatsinksOff: 3,
        }).accepted).toBeTrue();
        expect(fixture.instance.dispatch({
            type: 'set-heat',
            
            
            heat: 20,
        }).accepted).toBeTrue();
        expect(heatCapacity(fixture)).toBe(7);

        expect(activate(fixture, first!, 'coolant:first')).toBeTrue();
        expect(fixture.instance.query().remainingAmmo(first!)).toBe(0);
        expect(fixture.instance.query().componentMode(first!)).toBe(COOLANT_POD_ACTIVE_MODE);
        expect(heatCapacity(fixture)).toBe(14);
        expect(heatProjected(fixture)).toBe(6);

        const beforeRejectedUse = fixture.instance.revision();
        expect(activate(fixture, second!, 'coolant:second')).toBeFalse();
        expect(fixture.instance.revision()).toBe(beforeRejectedUse);
        expect(fixture.instance.query().remainingAmmo(second!)).toBe(1);

        expect(fixture.instance.dispatch({
            type: 'end-turn',
            
            
            policy: 'automatic',
        }).accepted).toBeTrue();
        expect(fixture.instance.query().heatState().current).toBe(6);
        expect(fixture.instance.query().componentMode(first!)).toBe(COOLANT_POD_READY_MODE);
        expect(fixture.instance.query().remainingAmmo(first!)).toBe(0);
        expect(fixture.instance.query().remainingAmmo(second!)).toBe(1);
        expect(heatCapacity(fixture)).toBe(7);

        expect(activate(fixture, second!, 'coolant:next-turn')).toBeTrue();
    });

    it('does not grant cooling after the active pod becomes unavailable', () => {
        const fixture = createDirectCoolantPodRuntimeFixture();
        const [pod] = coolantPods(fixture);
        expect(activate(fixture, pod!, 'coolant:destroyed:activate')).toBeTrue();
        expect(heatCapacity(fixture)).toBe(20);

        expect(fixture.instance.dispatch({
            type: 'set-component-status',
            
            
            componentId: pod!,
            status: 'destroyed',
            target: 'committed',
        }).accepted).toBeTrue();
        expect(heatCapacity(fixture)).toBe(10);
    });

    it('consumes the pod without stacking with an active Radical Heat Sink', () => {
        const fixture = createDirectCoolantPodRuntimeFixture('core-2026', true);
        const [pod] = coolantPods(fixture);
        const radical = fixture.equipmentComponent('Test Radical Heat Sink');

        expect(fixture.instance.dispatch({
            type: 'edit-escalating-failure',
            
            
            componentId: radical.id,
            edit: { kind: 'select-sequence', index: 0 },
        }).accepted).toBeTrue();
        expect(fixture.instance.query().componentEscalatingFailure(radical.id)?.active).toBeTrue();
        expect(heatCapacity(fixture)).toBe(20);

        expect(activate(fixture, pod!, 'coolant:radical:pod')).toBeTrue();
        expect(fixture.instance.query().remainingAmmo(pod!)).toBe(0);
        expect(heatCapacity(fixture)).toBe(20);
    });
});

function coolantPods(fixture: DirectMekRuntimeFixture): ComponentId[] {
    return [...fixture.index.components]
        .filter(([, component]) => component.kind === 'equipment'
            && component.mount.equipmentId === 'Test Coolant Pod')
        .map(([componentId]) => componentId);
}

function activate(
    fixture: DirectMekRuntimeFixture,
    componentId: ComponentId,
    commandId: string,
): boolean {
    return fixture.instance.dispatch({
        type: 'activate-coolant-pod',
        
        
        componentId,
    }).accepted;
}

function heatCapacity(fixture: DirectMekRuntimeFixture): number {
    const heat = fixture.instance.query().heatProjection('manual');
    if (heat.kind !== 'supported') throw new Error('Coolant fixture heat must be supported');
    return heat.projection.capacity;
}

function heatProjected(fixture: DirectMekRuntimeFixture): number {
    const heat = fixture.instance.query().heatProjection('automatic');
    if (heat.kind !== 'supported') throw new Error('Coolant fixture heat must be supported');
    return heat.projection.projected;
}
