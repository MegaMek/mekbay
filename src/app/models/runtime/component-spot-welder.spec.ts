// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import type { AttackerActionTarget } from './attacker-targeting-state';
import { deserializeMekTurnStateV2, serializeMekTurnStateV2 } from './mek-turn-state-v2';
import {
    projectMekEquipmentPanel,
    selectedWeaponHeat,
} from './equipment-panel';
import {
    createDirectSpotWelderRuntimeFixture,
    emptyCBTEncounterSnapshot,
    type DirectMekRuntimeFixture,
} from './testing/direct-mek-runtime-fixture';

describe('direct spot-welder runtime', () => {
    it('projects two firing heat and accumulates repeated uses until End Turn', () => {
        const fixture = createDirectSpotWelderRuntimeFixture();
        const welder = fixture.equipmentComponent('Test Spot Welder');
        const target = Object.freeze({ kind: 'component' as const, componentId: welder.id });

        expect(fixture.instance.dispatch({
            type: 'set-heat',
            
            
            heat: 20,
        }).accepted).toBeTrue();
        let row = physicalRow(fixture, target);
        expect(row.firingHeat).toBe(2);
        expect(row.effect).toEqual(jasmine.objectContaining({ kind: 'damage', damage: 5 }));

        expect(select(fixture, target, 'spot-welder:select')).toBeTrue();
        row = physicalRow(fixture, target);
        expect(row.selection).toEqual({ kind: 'selected' });
        expect(selectedWeaponHeat(panel(fixture))).toEqual({ hasSelection: true, value: 2 });

        expect(fire(fixture, 'spot-welder:first')).toBeTrue();
        expect(fixture.instance.query().turnState().weaponsHeat).toBe(2);
        // It fires once a turn: firing again while it stays selected changes nothing.
        expect(fire(fixture, 'spot-welder:second')).toBeFalse();
        expect(fixture.instance.query().turnState().weaponsHeat).toBe(2);
        const projected = fixture.instance.query().heatProjection();
        if (projected.kind !== 'supported') throw new Error('Spot-welder heat must be supported');
        expect(projected.projection.committedSources).toContain(jasmine.objectContaining({
            id: 'weapons', value: 2,
        }));
        expect(projected.projection.projected).toBe(12);

        expect(fixture.instance.dispatch({
            type: 'end-turn',
            
            
            policy: 'automatic',
        }).accepted).toBeTrue();
        expect(fixture.instance.query().heatState().current).toBe(12);
        expect(fixture.instance.query().turnState().weaponsHeat).toBe(0);
    });

    it('fires each weapon once a turn, so the player fires in steps', () => {
        const fixture = createDirectSpotWelderRuntimeFixture();
        const welder = fixture.equipmentComponent('Test Spot Welder');
        const laser = fixture.equipmentComponent('ISMediumLaser');
        const selectLaser = () => fixture.instance.dispatchAttackerTargeting({
            type: 'edit-attacker-targeting',
            edit: { kind: 'set-component-selection', componentId: laser.id, selection: { kind: 'selected' } },
        }, emptyCBTEncounterSnapshot(), false).accepted;
        const canFireLaser = () => panel(fixture).components.find(row => row.componentId === laser.id)?.weapon?.selectable;

        expect(selectLaser()).toBeTrue();
        expect(fire(fixture, 'steps:laser')).toBeTrue();
        expect(fixture.instance.query().turnState().weaponsHeat).toBe(3);
        expect(fixture.instance.query().turnState().firedWeapons).toEqual([laser.id]);
        // The laser stays selected but is spent: it no longer counts as selected heat and does not fire again.
        expect(canFireLaser()).toBeFalse();
        expect(selectedWeaponHeat(panel(fixture))).toEqual({ hasSelection: false, value: 0 });
        expect(fire(fixture, 'steps:laser-again')).toBeFalse();

        // A second step adds only what was not fired yet.
        expect(select(fixture, { kind: 'component', componentId: welder.id }, 'steps:welder')).toBeTrue();
        expect(fire(fixture, 'steps:welder-fire')).toBeTrue();
        expect(fixture.instance.query().turnState().weaponsHeat).toBe(5);

        // The fired weapons survive a save, and End Turn frees them.
        const saved = serializeMekTurnStateV2(fixture.instance.snapshot().turn);
        expect(deserializeMekTurnStateV2(JSON.parse(JSON.stringify(saved))).firedWeapons)
            .toEqual([laser.id, welder.id].sort());
        expect(fixture.instance.dispatch({ type: 'end-turn', policy: 'automatic' }).accepted).toBeTrue();
        expect(fixture.instance.query().turnState().firedWeapons).toBeUndefined();
        expect(canFireLaser()).toBeTrue();
    });

    it('adds spot-welder and ranged-weapon heat in one atomic fire command', () => {
        const fixture = createDirectSpotWelderRuntimeFixture();
        const welder = fixture.equipmentComponent('Test Spot Welder');
        const laser = fixture.equipmentComponent('ISMediumLaser');
        const target = Object.freeze({ kind: 'component' as const, componentId: welder.id });
        expect(select(fixture, target, 'spot-welder:mixed:physical')).toBeTrue();
        expect(fixture.instance.dispatchAttackerTargeting({
            type: 'edit-attacker-targeting',
            
            
            
            edit: {
                kind: 'set-component-selection',
                componentId: laser.id,
                selection: { kind: 'selected' },
            },
        }, emptyCBTEncounterSnapshot(), false).accepted).toBeTrue();

        expect(selectedWeaponHeat(panel(fixture))).toEqual({ hasSelection: true, value: 5 });
        expect(fire(fixture, 'spot-welder:mixed:fire')).toBeTrue();
        expect(fixture.instance.query().turnState().weaponsHeat).toBe(5);
    });

    it('ignores a selected welder that is no longer operational without adding heat', () => {
        const fixture = createDirectSpotWelderRuntimeFixture();
        const welder = fixture.equipmentComponent('Test Spot Welder');
        const target = Object.freeze({ kind: 'component' as const, componentId: welder.id });
        expect(select(fixture, target, 'spot-welder:destroyed:select')).toBeTrue();
        expect(fixture.instance.dispatch({
            type: 'set-component-status',
            
            
            componentId: welder.id,
            status: 'destroyed',
            target: 'committed',
        }).accepted).toBeTrue();

        const before = fixture.instance.revision();
        expect(fire(fixture, 'spot-welder:destroyed:fire')).toBeFalse();
        expect(fixture.instance.revision()).toBe(before);
        expect(fixture.instance.query().turnState().weaponsHeat).toBe(0);
    });
});

function panel(fixture: DirectMekRuntimeFixture) {
    return projectMekEquipmentPanel(
        fixture.entity,
        fixture.index,
        fixture.instance.ruleset(),
        fixture.instance.query(),
        emptyCBTEncounterSnapshot(), {},
    );
}

function physicalRow(fixture: DirectMekRuntimeFixture, target: AttackerActionTarget) {
    const row = panel(fixture).physicalAttacks.find(candidate =>
        candidate.target.kind === target.kind
        && (candidate.target.kind === 'component' && target.kind === 'component'
            ? candidate.target.componentId === target.componentId
            : candidate.target.kind === 'intrinsic' && target.kind === 'intrinsic'
                && candidate.target.actionId === target.actionId));
    if (!row) throw new Error('Spot-welder physical row is missing');
    return row;
}

function select(
    fixture: DirectMekRuntimeFixture,
    target: AttackerActionTarget,
    commandId: string,
): boolean {
    const registry = emptyCBTEncounterSnapshot();
    return fixture.instance.dispatchAttackerTargeting({
        type: 'edit-attacker-targeting',
        
        
        
        edit: { kind: 'set-action-selection', target, selection: { kind: 'selected' } },
    }, registry, false).accepted;
}

function fire(fixture: DirectMekRuntimeFixture, commandId: string): boolean {
    const registry = emptyCBTEncounterSnapshot();
    return fixture.instance.dispatchSelectedWeaponFire({
        type: 'fire-selected-weapons',
        
        
        
    }, registry, false, false).changed;
}
