// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import { EquipmentInteractionRegistry } from '../../services/equipment-interaction-registry.service';
import type { ComponentId } from '../entity/entity-identifiers';
import { projectMekEquipmentPanel } from './equipment-panel';
import {
    ShieldModeHandler,
    SHIELD_ACTIVE_MODE,
    SHIELD_INACTIVE_MODE,
    SHIELD_PASSIVE_MODE,
} from './component-shield-mode';
import {
    createDirectDualShieldRuntimeFixture,
    createDirectShieldRuntimeFixture,
    emptyCBTEncounterSnapshot,
    type DirectMekRuntimeFixture,
} from './testing/direct-mek-runtime-fixture';

describe('direct shield modes', () => {
    it('raises one Core shield, blocks its protected firing arc, and lowers it at End Phase', () => {
        const fixture = createDirectShieldRuntimeFixture('core-2026', 'medium');
        const shield = shieldComponents(fixture)[0]!;
        const weapons = weaponComponents(fixture);
        const leftArm = weapons.find(component => component.mount.location === 'LA')!;
        const leftTorsoFront = weapons.find(component =>
            component.mount.location === 'LT' && !component.mount.rearMounted)!;
        const leftTorsoRear = weapons.find(component =>
            component.mount.location === 'LT' && component.mount.rearMounted)!;
        const rightTorso = weapons.find(component => component.mount.location === 'RT')!;
        const options = interactionOptions(fixture, shield.id);

        expect(fixture.instance.query().componentMode(shield.id)).toBe(SHIELD_INACTIVE_MODE);
        expect(options).toEqual([
            { label: 'Lowered', value: SHIELD_INACTIVE_MODE },
            { label: 'Raised', value: SHIELD_ACTIVE_MODE },
        ]);
        expect(setMode(fixture, shield.id, SHIELD_ACTIVE_MODE, 'core-shield:raise')).toBeTrue();

        const panel = equipmentPanel(fixture);
        expect(panel.components.find(row => row.componentId === leftArm.id)?.weapon?.selectable).toBeFalse();
        expect(panel.components.find(row => row.componentId === leftTorsoFront.id)?.weapon?.selectable).toBeFalse();
        expect(panel.components.find(row => row.componentId === leftTorsoRear.id)?.weapon?.selectable).toBeTrue();
        expect(panel.components.find(row => row.componentId === rightTorso.id)?.weapon?.selectable).toBeTrue();
        expect(panel.physicalAttacks.find(row =>
            row.label === 'Punch' && row.locationCodes.includes('LA'))?.available).toBeFalse();

        expect(fixture.instance.dispatch({
            type: 'end-phase',
            
            
        }).accepted).toBeTrue();
        expect(fixture.instance.query().componentMode(shield.id)).toBe(SHIELD_INACTIVE_MODE);
        expect(equipmentPanel(fixture).components
            .find(row => row.componentId === leftTorsoFront.id)?.weapon?.selectable).toBeTrue();
    });

    it('keeps Total Warfare modes persistent and applies inactive/passive to-hit penalties', () => {
        const fixture = createDirectShieldRuntimeFixture('total-warfare', 'medium');
        const shield = shieldComponents(fixture)[0]!;
        const weapons = weaponComponents(fixture);
        const leftArm = weapons.find(component => component.mount.location === 'LA')!;
        const leftTorsoFront = weapons.find(component =>
            component.mount.location === 'LT' && !component.mount.rearMounted)!;
        const leftTorsoRear = weapons.find(component =>
            component.mount.location === 'LT' && component.mount.rearMounted)!;

        expect(interactionOptions(fixture, shield.id)).toEqual([
            { label: 'Inactive', value: SHIELD_INACTIVE_MODE },
            { label: 'Active', value: SHIELD_ACTIVE_MODE },
            { label: 'Passive', value: SHIELD_PASSIVE_MODE },
        ]);
        expect(weaponRow(fixture, leftArm.id).weapon?.hitModifierBreakdown).toContain(jasmine.objectContaining({
            label: 'Shield (LA)', modifier: 1,
        }));

        expect(setMode(fixture, shield.id, SHIELD_PASSIVE_MODE, 'tw-shield:passive')).toBeTrue();
        expect(weaponRow(fixture, leftTorsoFront.id).weapon?.selectable).toBeTrue();
        expect(weaponRow(fixture, leftTorsoFront.id).weapon?.hitModifierBreakdown)
            .toContain(jasmine.objectContaining({ label: 'Passive Shield (LA)', modifier: 2 }));
        expect(weaponRow(fixture, leftTorsoRear.id).weapon?.hitModifierBreakdown)
            .not.toContain(jasmine.objectContaining({ label: 'Passive Shield (LA)' }));

        expect(setMode(fixture, shield.id, SHIELD_ACTIVE_MODE, 'tw-shield:active')).toBeTrue();
        expect(weaponRow(fixture, leftTorsoFront.id).weapon?.selectable).toBeFalse();
        expect(weaponRow(fixture, leftTorsoRear.id).weapon?.selectable).toBeFalse();
        expect(fixture.instance.dispatch({
            type: 'end-phase',
            
            
        }).accepted).toBeTrue();
        expect(fixture.instance.query().componentMode(shield.id)).toBe(SHIELD_ACTIVE_MODE);
    });

    it('hands Core protection to the newly raised arm but permits dual active TW shields', () => {
        const core = createDirectDualShieldRuntimeFixture('core-2026', 'medium');
        const [coreLeft, coreRight] = shieldComponents(core);
        expect(setMode(core, coreLeft!.id, SHIELD_ACTIVE_MODE, 'dual-core:left')).toBeTrue();
        expect(setMode(core, coreRight!.id, SHIELD_ACTIVE_MODE, 'dual-core:right')).toBeTrue();
        expect(core.instance.query().componentMode(coreLeft!.id)).toBe(SHIELD_INACTIVE_MODE);
        expect(core.instance.query().componentMode(coreRight!.id)).toBe(SHIELD_ACTIVE_MODE);

        const tw = createDirectDualShieldRuntimeFixture('total-warfare', 'medium');
        const [twLeft, twRight] = shieldComponents(tw);
        expect(setMode(tw, twLeft!.id, SHIELD_ACTIVE_MODE, 'dual-tw:left')).toBeTrue();
        expect(setMode(tw, twRight!.id, SHIELD_ACTIVE_MODE, 'dual-tw:right')).toBeTrue();
        expect(tw.instance.query().componentMode(twLeft!.id)).toBe(SHIELD_ACTIVE_MODE);
        expect(tw.instance.query().componentMode(twRight!.id)).toBe(SHIELD_ACTIVE_MODE);
    });

    it('stops blocking attacks after the shield loses all capacity', () => {
        const fixture = createDirectShieldRuntimeFixture('total-warfare', 'medium');
        const shield = shieldComponents(fixture)[0]!;
        const front = weaponComponents(fixture).find(component =>
            component.mount.location === 'LT' && !component.mount.rearMounted)!;
        expect(setMode(fixture, shield.id, SHIELD_ACTIVE_MODE, 'broken-shield:active')).toBeTrue();
        const projection = fixture.instance.query().mekShields();
        if (projection.kind !== 'supported') throw new Error('Fixture shield projection is unsupported');
        const maximum = projection.shields.find(row => row.componentId === shield.id)!.maximumCapacity;
        expect(fixture.instance.dispatch({
            type: 'damage-shield',
            
            
            componentId: shield.id,
            track: 'capacity',
            amount: maximum,
            target: 'committed',
        }).accepted).toBeTrue();

        expect(weaponRow(fixture, front.id).weapon?.selectable).toBeTrue();
    });
});

function interactionOptions(fixture: DirectMekRuntimeFixture, componentId: string) {
    const registry = new EquipmentInteractionRegistry();
    registry.register(new ShieldModeHandler());
    return registry.choices(
        fixture.instance,
        fixture.entity,
        fixture.index,
        fixture.instance.ruleset(),
        { instanceId: fixture.instance.id, encounter: emptyCBTEncounterSnapshot },
        {},
    ).find(choice => choice.componentId === componentId)?.choice.choices;
}

function setMode(
    fixture: DirectMekRuntimeFixture,
    componentId: ComponentId,
    mode: string,
    commandId: string,
): boolean {
    return fixture.instance.dispatch({
        type: 'set-component-mode',
        
        
        componentId,
        mode,
    }).accepted;
}

function equipmentPanel(fixture: DirectMekRuntimeFixture) {
    return projectMekEquipmentPanel(
        fixture.entity,
        fixture.index,
        fixture.instance.ruleset(),
        fixture.instance.query(),
        emptyCBTEncounterSnapshot(),
    );
}

function weaponRow(fixture: DirectMekRuntimeFixture, componentId: string) {
    return equipmentPanel(fixture).components.find(row => row.componentId === componentId)!;
}

function shieldComponents(fixture: DirectMekRuntimeFixture) {
    return [...fixture.index.components.values()].filter(component =>
        component.kind === 'equipment' && component.mount.equipment?.hasFlag('F_SHIELD'))
        .map(component => {
            if (component.kind !== 'equipment') throw new Error('Shield component mismatch');
            return component;
        });
}

function weaponComponents(fixture: DirectMekRuntimeFixture) {
    return [...fixture.index.components.values()].filter(component =>
        component.kind === 'equipment' && component.mount.equipmentId === 'ISMediumLaser')
        .map(component => {
            if (component.kind !== 'equipment') throw new Error('Weapon component mismatch');
            return component;
        });
}
