// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import { MiscEquipment } from '../equipment.model';
import type { ComponentId } from '../entity/entity-identifiers';
import {
    HPG_CHARGED_MODE,
    HPG_CHARGING_MODE,
    HPG_COOLDOWN_3_MODE,
    HPG_IDLE_MODE,
    HPG_TRANSMITTING_MODE,
    mobileHpgModeChangeReason,
    settleMobileHpgMode,
} from './component-mobile-hpg';
import { canPerformMekAction } from './mek-action-availability';
import { MEK_MOVEMENT_DECLARATION_SCHEMA_VERSION } from './mek-movement-psr-v2';
import { createDirectMobileHpgRuntimeFixture } from './testing/direct-mek-runtime-fixture';

describe('direct Mobile HPG lifecycle', () => {
    it('charges, transmits, blocks attacks and movement, then observes cooldown', () => {
        const fixture = createDirectMobileHpgRuntimeFixture();
        const hpg = fixture.equipmentComponent('Test Ground-Mobile HPG');
        const weapon = fixture.equipmentComponent('Test AC');

        expect(fixture.instance.query().componentMode(hpg.id)).toBe(HPG_IDLE_MODE);
        expect(setMode(fixture, hpg.id, HPG_CHARGING_MODE)).toBeTrue();
        expect(hpgHeat(fixture, hpg.id)).toBe(20);
        expect(canPerformMekAction(
            fixture.entity,
            fixture.index,
            fixture.instance.query(),
            { kind: 'component', componentId: weapon.id },
            'fire',
            fixture.instance.ruleset(),
        )).toBeFalse();

        expect(endTurn(fixture)).toBeTrue();
        expect(fixture.instance.query().componentMode(hpg.id)).toBe(HPG_CHARGED_MODE);
        expect(hpgHeat(fixture, hpg.id)).toBeUndefined();
        expect(setMode(fixture, hpg.id, HPG_TRANSMITTING_MODE)).toBeTrue();
        expect(hpgHeat(fixture, hpg.id)).toBe(20);

        expect(fixture.instance.dispatch({
            type: 'declare-mek-movement',
            
            
            declaration: {
                schemaVersion: MEK_MOVEMENT_DECLARATION_SCHEMA_VERSION,
                mode: 'walk',
                distance: 1,
                boosterComponentIds: [],
            },
        })).toEqual(jasmine.objectContaining({ accepted: true, changed: false }));

        expect(endTurn(fixture)).toBeTrue();
        expect(fixture.instance.query().componentMode(hpg.id)).toBe(HPG_COOLDOWN_3_MODE);
        expect(endTurn(fixture)).toBeTrue();
        expect(endTurn(fixture)).toBeTrue();
        expect(endTurn(fixture)).toBeTrue();
        expect(fixture.instance.query().componentMode(hpg.id)).toBe(HPG_IDLE_MODE);
    });

    it('validates fusion, weapon-selection, and zero-MP constraints in one kernel', () => {
        const ground = new MiscEquipment({
            id: 'ground-hpg', name: 'Ground-Mobile HPG', type: 'misc',
            flags: ['F_MOBILE_HPG', 'F_MEK_EQUIPMENT'],
        });
        const ordinary = new MiscEquipment({
            id: 'hpg', name: 'Mobile HPG', type: 'misc', flags: ['F_MOBILE_HPG'],
        });
        const facts = {
            fusionEngine: true,
            selectedWeaponAttack: false,
            movementMode: 'stationary',
            movementDistance: 0,
        } as const;

        expect(mobileHpgModeChangeReason(ground, HPG_IDLE_MODE, HPG_CHARGING_MODE, {
            ...facts,
            fusionEngine: false,
        })).toBe('NO_FUSION_ENGINE');
        expect(mobileHpgModeChangeReason(ground, HPG_IDLE_MODE, HPG_CHARGING_MODE, {
            ...facts,
            selectedWeaponAttack: true,
        })).toBe('WEAPON_ATTACK_SELECTED');
        expect(mobileHpgModeChangeReason(ground, HPG_CHARGED_MODE, HPG_TRANSMITTING_MODE, {
            ...facts,
            movementMode: 'walk',
            movementDistance: 1,
        })).toBe('MUST_SPEND_ZERO_MP');
        expect(mobileHpgModeChangeReason(
            ordinary,
            HPG_IDLE_MODE,
            HPG_TRANSMITTING_MODE,
            facts,
        )).toBeNull();
        expect(settleMobileHpgMode(ground, HPG_TRANSMITTING_MODE, true)).toBe(HPG_IDLE_MODE);
    });
});

type Fixture = ReturnType<typeof createDirectMobileHpgRuntimeFixture>;

function setMode(fixture: Fixture, componentId: ComponentId, mode: string): boolean {
    return fixture.instance.dispatch({
        type: 'set-component-mode',
        
        
        componentId,
        mode,
    }).accepted;
}

function endTurn(fixture: Fixture): boolean {
    return fixture.instance.dispatch({
        type: 'end-turn',
        
        
        policy: 'automatic',
    }).accepted;
}

function hpgHeat(fixture: Fixture, componentId: ComponentId): number | undefined {
    const result = fixture.instance.query().heatProjection('manual');
    expect(result.kind).toBe('supported');
    if (result.kind !== 'supported') return undefined;
    return result.projection.committedSources.find(source =>
        source.id === `mobile-hpg:${componentId}`)?.value;
}
