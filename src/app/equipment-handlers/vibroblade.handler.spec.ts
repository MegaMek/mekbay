// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import { Equipment, type EquipmentRawData } from '../models/equipment.model';
import { EMPTY_EQUIPMENT_REGISTRY } from '../models/equipment-lookup';
import { MountedEquipment } from '../models/mounted-equipment.model';
import {
    createHandlerCommandContext,
    createHandlerQueryContext,
    EquipmentInteractionRegistry,
} from '../services/equipment-interaction-registry.service';
import type { DialogsService } from '../services/dialogs.service';
import type { ToastService } from '../services/toast.service';
import { createTestEquipmentOwner } from '../testing/unit-test-helpers';
import type { InventoryControlDisplayData, InventoryControlDisplayEffectOptions } from '../utils/inventory-control.util';
import { getVibrobladeBaseDamage, VIBROBLADE_MODE_STATE, VIBROBLADE_OFF_MODE, VIBROBLADE_ON_MODE, VibrobladeHandler } from './vibroblade.handler';

const DISPLAY: InventoryControlDisplayData = {
    name: 'Vibroblade',
    location: 'RA',
    heat: '—',
    damage: '7',
    hit: '-2',
    min: '—',
    short: '—',
    medium: '—',
    long: '—',
};

function setup(size: 'SMALL' | 'MEDIUM' | 'LARGE' = 'SMALL', destroyed = false, tons = 50) {
    const { owner } = createTestEquipmentOwner({ unit: { tons } });
    spyOn(owner, 'setInventoryEntry').and.callThrough();
    const equipment = new Equipment({
        id: `${size}Vibroblade`,
        name: `Vibroblade (${size})`,
        type: 'misc',
        flags: ['F_CLUB', `S_VIBRO_${size}`],
    } as EquipmentRawData);
    const entry = new MountedEquipment({
        owner,
        id: equipment.id,
        name: equipment.name,
        equipment,
        destroyed,
        locations: new Set(['RA']),
    });
    return { owner, entry };
}

const queryContext = createHandlerQueryContext(EMPTY_EQUIPMENT_REGISTRY);
const commandContext = createHandlerCommandContext(
    EMPTY_EQUIPMENT_REGISTRY,
    jasmine.createSpyObj<ToastService>('ToastService', ['showToast']),
    jasmine.createSpyObj<DialogsService>('DialogsService', ['createDialog']),
);
const displayOptions: InventoryControlDisplayEffectOptions = {
    selectedRange: null,
    hitModifierBreakdown: [],
};

describe('VibrobladeHandler', () => {
    const handler = new VibrobladeHandler();
    const registry = new EquipmentInteractionRegistry();
    registry.register(handler);

    it('applies only to clubs with a vibroblade size flag', () => {
        const vibroblade = setup().entry;
        const club = vibroblade.clone({
            equipment: new Equipment({ id: 'Hatchet', name: 'Hatchet', type: 'misc', flags: ['F_CLUB', 'S_HATCHET'] }),
        });
        const missingClubFlag = vibroblade.clone({
            equipment: new Equipment({ id: 'Fake', name: 'Fake', type: 'misc', flags: ['S_VIBRO_SMALL'] }),
        });

        expect(handler.applicableTo(vibroblade)).toBeTrue();
        expect(handler.applicableTo(club)).toBeFalse();
        expect(handler.applicableTo(missingClubFlag)).toBeFalse();
    });

    it('defaults to OFF and persists ON/OFF selections', () => {
        const { owner, entry } = setup();

        expect(handler.getChoices(entry, queryContext)[0]).toEqual(jasmine.objectContaining({
            label: 'Mode',
            value: VIBROBLADE_OFF_MODE,
        }));
        expect(registry.getChoices(entry, queryContext)[0].disabled).toBeFalse();

        expect(handler.handleSelection(entry, { value: VIBROBLADE_ON_MODE } as never, commandContext)).toBeFalse();
        expect(entry.states.get(VIBROBLADE_MODE_STATE)).toBe(VIBROBLADE_ON_MODE);
        expect(owner.setInventoryEntry).toHaveBeenCalledWith(entry);

        handler.handleSelection(entry, { value: VIBROBLADE_OFF_MODE } as never, commandContext);
        expect(entry.states.get(VIBROBLADE_MODE_STATE)).toBe(VIBROBLADE_OFF_MODE);
        expect(owner.setInventoryEntry).toHaveBeenCalledTimes(2);
    });

    it('disables mode selection when the vibroblade is unavailable', () => {
        const { entry } = setup('SMALL', true);

        expect(handler.getChoices(entry, queryContext)[0]).toEqual(jasmine.objectContaining({
            label: 'Mode',
            value: VIBROBLADE_OFF_MODE,
        }));
        expect(registry.getChoices(entry, queryContext)[0].disabled).toBeTrue();
    });

    it('applies the -2 vibroblade target-number modifier in both modes', () => {
        const { entry } = setup();
        expect(handler.getToHitAdjustments(entry)).toEqual([{ kind: 'replace-base', value: -2, label: entry.equipment?.shortName ?? entry.name }]);

        entry.states.set(VIBROBLADE_MODE_STATE, VIBROBLADE_ON_MODE);
        expect(handler.getToHitAdjustments(entry)).toEqual([{ kind: 'replace-base', value: -2, label: entry.equipment?.shortName ?? entry.name }]);
    });

    it('shows active heat and damage by blade size', () => {
        for (const [size, heat, damage] of [['SMALL', 3, 7], ['MEDIUM', 5, 10], ['LARGE', 7, 14]] as const) {
            const { entry } = setup(size);
            entry.states.set(VIBROBLADE_MODE_STATE, VIBROBLADE_ON_MODE);

            const display = handler.applyInventoryControlDisplayEffects(entry, DISPLAY, displayOptions, queryContext);
            expect(display.heat).withContext(size).toBe(`${heat}`);
            expect(display.damage).withContext(size).toBe(`${damage}`);
            expect(handler.getInventoryControlHeatEffect(entry)).withContext(size).toEqual({
                value: heat,
                weakened: false,
            });
        }
    });

    it('uses fixed 7/10/14 damage while ON', () => {
        for (const [size, damage] of [['SMALL', 7], ['MEDIUM', 10], ['LARGE', 14]] as const) {
            const { entry } = setup(size, false, 100);
            entry.states.set(VIBROBLADE_MODE_STATE, VIBROBLADE_ON_MODE);

            expect(getVibrobladeBaseDamage(entry)).withContext(size).toBe(damage);
        }
    });

    it('uses rounded-up tonnage damage plus one while OFF', () => {
        expect(getVibrobladeBaseDamage(setup('LARGE', false, 20).entry)).toBe(3);
        expect(getVibrobladeBaseDamage(setup('LARGE', false, 21).entry)).toBe(4);
        expect(getVibrobladeBaseDamage(setup('LARGE', false, 100).entry)).toBe(11);
    });

    it('caps OFF damage at the active damage before TSM is applied', () => {
        expect(getVibrobladeBaseDamage(setup('SMALL', false, 100).entry)).toBe(7);
        expect(getVibrobladeBaseDamage(setup('MEDIUM', false, 100).entry)).toBe(10);
        expect(getVibrobladeBaseDamage(setup('LARGE', false, 200).entry)).toBe(14);
    });

    it('provides mode-specific physical damage through the physical damage hook', () => {
        const { entry } = setup('MEDIUM', false, 40);
        const baseEffect = { baseDamage: 10, ignoreMyomer: false };

        expect(handler.applyInventoryControlPhysicalDamageEffects(entry, baseEffect, queryContext)).toEqual({
            baseDamage: 5,
            ignoreMyomer: false,
        });

        entry.states.set(VIBROBLADE_MODE_STATE, VIBROBLADE_ON_MODE);
        expect(handler.applyInventoryControlPhysicalDamageEffects(entry, baseEffect, queryContext)).toEqual({
            baseDamage: 10,
            ignoreMyomer: true,
        });
    });

    it('shows potential heat but emits no heat source while OFF', () => {
        const off = setup().entry;
        const display = handler.applyInventoryControlDisplayEffects(
            off,
            { ...DISPLAY, heat: '3', damage: '6 [12]' },
            displayOptions,
            queryContext,
        );
        expect(display.heat).toBe('[3]');
        expect(display.damage).toBe('6 [7]');
        expect(handler.getInventoryControlHeatEffect(off)).toBeNull();

        const unavailable = setup('LARGE', true).entry;
        unavailable.states.set(VIBROBLADE_MODE_STATE, VIBROBLADE_ON_MODE);
        expect(handler.getInventoryControlHeatEffect(unavailable)).toEqual({ value: 7, weakened: false });
    });
});
