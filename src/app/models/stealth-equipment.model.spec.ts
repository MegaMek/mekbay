// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import { ArmorEquipment, MiscEquipment, type Equipment } from './equipment.model';
import { asComponentId } from './entity/entity-identifiers';
import {
    activeStealthHeatComponents,
    getActiveStealthTnModifiers,
    isStealthEquipment,
    nextStealthState,
    STEALTH_DISABLING_MODE,
    STEALTH_ENABLING_MODE,
    stealthStateForMode,
    unitHasActiveC3DisruptingStealth,
    type StealthEquipmentFacts,
} from './stealth-equipment.model';
import {
    TN_CHAMELEON_MODIFIERS,
    TN_STANDARD_STEALTH_MODIFIERS,
} from './target-number-calculator.model';

describe('stealth equipment state policy', () => {
    it('uses catalog flags plus sparse mode/status facts without an owner graph', () => {
        const stealth = misc('Stealth', ['F_STEALTH'], ['On', 'Off']);
        const ecm = misc('ECM', ['F_ECM']);

        expect(isStealthEquipment(stealth)).toBeTrue();
        expect(getActiveStealthTnModifiers([
            facts(stealth, 'On'),
            facts(ecm, 'ecm'),
        ])).toEqual(TN_STANDARD_STEALTH_MODIFIERS);
        expect(unitHasActiveC3DisruptingStealth([
            facts(stealth, 'On'),
            facts(ecm, 'ecm'),
        ])).toBeTrue();
        expect(getActiveStealthTnModifiers([
            facts(stealth, 'Off'),
            facts(ecm, 'ecm'),
        ])).toBeUndefined();
    });

    it('requires functional ECM for switchable Stealth Armor', () => {
        const stealth = misc('Stealth', ['F_STEALTH'], ['On', 'Off']);
        const ecm = misc('ECM', ['F_ECM']);

        expect(getActiveStealthTnModifiers([facts(stealth, 'On')])).toBeUndefined();
        expect(getActiveStealthTnModifiers([
            facts(stealth, 'On'),
            facts(ecm, 'eccm'),
        ])).toBeUndefined();
        expect(getActiveStealthTnModifiers([
            facts(stealth, 'On'),
            facts(ecm, 'ecm', false),
        ])).toBeUndefined();
    });

    it('keeps switchable effects pending until End Turn and hot while disabling', () => {
        const stealth = misc('Stealth', ['F_STEALTH'], ['On', 'Off']);
        const ecm = misc('ECM', ['F_ECM']);
        const supportingEcm = facts(ecm, 'ecm');

        expect(stealthStateForMode(stealth, STEALTH_ENABLING_MODE)).toBe('enabling');
        expect(stealthStateForMode(stealth, STEALTH_DISABLING_MODE)).toBe('disabling');
        expect(nextStealthState('enabling')).toBe('disabled');
        expect(nextStealthState('disabling')).toBe('enabled');
        expect(getActiveStealthTnModifiers([
            facts(stealth, undefined, true, 'enabling'), supportingEcm,
        ])).toBeUndefined();
        expect(getActiveStealthTnModifiers([
            facts(stealth, undefined, true, 'disabling'), supportingEcm,
        ])).toEqual(TN_STANDARD_STEALTH_MODIFIERS);
        expect([...activeStealthHeatComponents([
            facts(stealth, undefined, true, 'disabling'), supportingEcm,
        ])]).toEqual([asComponentId('Stealth')]);
    });

    it('keeps Chameleon active without treating it as C3-disrupting stealth', () => {
        const chameleon = misc('Chameleon', ['F_CHAMELEON_SHIELD']);
        const entries = [facts(chameleon)];

        expect(getActiveStealthTnModifiers(entries)).toEqual(TN_CHAMELEON_MODIFIERS);
        expect(unitHasActiveC3DisruptingStealth(entries)).toBeFalse();
    });

    it('derives BA profiles and movement-dependent mimetic camouflage', () => {
        const baStealth = new ArmorEquipment({
            id: 'BA Stealth', name: 'BA Stealth', type: 'armor',
            flags: ['F_STEALTH'], armor: { type: 'BA_STEALTH_IMP' },
        });
        const mimetic = new ArmorEquipment({
            id: 'BA Mimetic', name: 'BA Mimetic', type: 'armor',
            flags: ['F_VISUAL_CAMO'], armor: { type: 'BA_MIMETIC' },
        });

        expect(getActiveStealthTnModifiers([facts(baStealth)])).toEqual({
            short: 1,
            medium: 2,
            long: 3,
            conventionalInfantry: { short: 0, medium: 0, long: 0 },
        });
        expect(getActiveStealthTnModifiers([facts(mimetic)], 0)).toEqual({
            short: 3, medium: 3, long: 3,
        });
        expect(getActiveStealthTnModifiers([facts(mimetic)], 2)).toEqual({
            short: 1, medium: 1, long: 1,
        });
    });
});

function misc(
    id: string,
    flags: ConstructorParameters<typeof MiscEquipment>[0]['flags'],
    modes: string[] = [],
): MiscEquipment {
    return new MiscEquipment({ id, name: id, type: 'misc', flags, modes });
}

function facts(
    equipment: Equipment,
    mode?: string,
    operational = true,
    state?: StealthEquipmentFacts['state'],
): StealthEquipmentFacts {
    return Object.freeze({
        componentId: asComponentId(equipment.id),
        equipment,
        mode,
        ...(state === undefined ? {} : { state }),
        operational,
    });
}
