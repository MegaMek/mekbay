// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import { Equipment } from '../models/equipment.model';
import { EMPTY_EQUIPMENT_REGISTRY } from '../models/equipment-lookup';
import { MountedEquipment } from '../models/mounted-equipment.model';
import { TW_GAME_RULES } from '../models/rules/game-rules';
import type { DialogsService } from '../services/dialogs.service';
import { createHandlerCommandContext, createHandlerQueryContext } from '../services/equipment-interaction-registry.service';
import type { ToastService } from '../services/toast.service';
import { createTestEquipmentOwner } from '../testing/unit-test-helpers';
import type { InventoryControlDisplayData } from '../utils/inventory-control.util';
import {
    selectedShieldMode,
    shieldProtectsLocation,
    SHIELD_INACTIVE_MODE,
    SHIELD_PASSIVE_MODE,
    SHIELD_RAISED_MODE,
} from '../utils/shield-mode.util';
import { ShieldModeHandler } from './shield-mode.handler';

describe('ShieldModeHandler', () => {
    const handler = new ShieldModeHandler();
    const queryContext = createHandlerQueryContext(EMPTY_EQUIPMENT_REGISTRY);
    const commandContext = createHandlerCommandContext(
        EMPTY_EQUIPMENT_REGISTRY,
        jasmine.createSpyObj<ToastService>('ToastService', ['showToast']),
        jasmine.createSpyObj<DialogsService>('DialogsService', ['createDialog']),
    );
    const display: InventoryControlDisplayData = {
        name: 'Shield (Medium)', location: 'LA', heat: '—', damage: '+2', hit: '—',
        min: '—', short: '—', medium: '—', long: '—',
    };

    function mounted(rules = undefined as typeof TW_GAME_RULES | undefined): MountedEquipment {
        const { owner, inventory } = createTestEquipmentOwner({ gameRules: rules });
        const equipment = new Equipment({
            id: 'MediumShield',
            name: 'Shield (Medium)',
            type: 'misc',
            flags: ['F_SHIELD', 'S_SHIELD_MEDIUM'],
        });
        const entry = new MountedEquipment({
            owner,
            id: equipment.id,
            name: equipment.name,
            equipment,
            locations: new Set(['LA']),
        });
        inventory.push(entry);
        return entry;
    }

    it('presents Core internal None as Lowered and resets Raised at end of phase', () => {
        const shield = mounted();
        const choice = handler.getChoices(shield, queryContext)[0];

        expect(choice.value).toBe(SHIELD_INACTIVE_MODE);
        expect(choice.choices).toEqual([
            { label: 'Lowered', value: SHIELD_INACTIVE_MODE },
            { label: 'Raised', value: SHIELD_RAISED_MODE },
        ]);

        handler.handleSelection(shield, { ...choice, value: SHIELD_RAISED_MODE }, commandContext);
        expect(selectedShieldMode(shield)).toBe(SHIELD_RAISED_MODE);

        handler.onEndPhase(shield);
        expect(selectedShieldMode(shield)).toBe(SHIELD_INACTIVE_MODE);
    });

    it('presents the persistent TW Active, Passive, and Inactive modes', () => {
        const shield = mounted(TW_GAME_RULES);
        const choice = handler.getChoices(shield, queryContext)[0];

        expect(choice.value).toBe(SHIELD_INACTIVE_MODE);
        expect(choice.choices).toEqual([
            { label: 'Inactive', value: SHIELD_INACTIVE_MODE },
            { label: 'Active', value: SHIELD_RAISED_MODE },
            { label: 'Passive', value: SHIELD_PASSIVE_MODE },
        ]);

        handler.handleSelection(shield, { ...choice, value: SHIELD_PASSIVE_MODE }, commandContext);
        handler.onEndPhase(shield);
        expect(selectedShieldMode(shield)).toBe(SHIELD_PASSIVE_MODE);
    });

    it('keeps Core head and rear-mounted weapons available behind a raised shield', () => {
        const shield = mounted();
        handler.handleSelection(shield, { label: 'Mode', value: SHIELD_RAISED_MODE }, commandContext);

        expect(shieldProtectsLocation(shield, 'CT')).toBeTrue();
        expect(shieldProtectsLocation(shield, 'LT')).toBeTrue();
        expect(shieldProtectsLocation(shield, 'HD')).toBeFalse();
        expect(shieldProtectsLocation(shield, 'LT', true)).toBeFalse();
        expect(shieldProtectsLocation(shield, 'RT')).toBeFalse();
    });

    it('uses the broader TW active-shield arc, including the head and same-side rear weapons', () => {
        const shield = mounted(TW_GAME_RULES);
        handler.handleSelection(shield, { label: 'Mode', value: SHIELD_RAISED_MODE }, commandContext);

        expect(shieldProtectsLocation(shield, 'HD')).toBeTrue();
        expect(shieldProtectsLocation(shield, 'LT', true)).toBeTrue();
        expect(shieldProtectsLocation(shield, 'CT', true)).toBeFalse();
    });

    it('hands a raised Core shield over to the newly selected arm', () => {
        const { owner, inventory } = createTestEquipmentOwner();
        const equipment = new Equipment({
            id: 'MediumShield',
            name: 'Shield (Medium)',
            type: 'misc',
            flags: ['F_SHIELD', 'S_SHIELD_MEDIUM'],
        });
        const left = new MountedEquipment({
            owner, id: 'shield-left', name: equipment.name, equipment, locations: new Set(['LA']),
        });
        const right = new MountedEquipment({
            owner, id: 'shield-right', name: equipment.name, equipment, locations: new Set(['RA']),
        });
        inventory.push(left, right);

        handler.handleSelection(left, { label: 'Mode', value: SHIELD_RAISED_MODE }, commandContext);
        handler.handleSelection(right, { label: 'Mode', value: SHIELD_RAISED_MODE }, commandContext);

        expect(selectedShieldMode(left)).toBe(SHIELD_INACTIVE_MODE);
        expect(selectedShieldMode(right)).toBe(SHIELD_RAISED_MODE);
    });

    it('allows both TW shields to remain active', () => {
        const { owner, inventory } = createTestEquipmentOwner({ gameRules: TW_GAME_RULES });
        const equipment = new Equipment({
            id: 'MediumShield',
            name: 'Shield (Medium)',
            type: 'misc',
            flags: ['F_SHIELD', 'S_SHIELD_MEDIUM'],
        });
        const left = new MountedEquipment({
            owner, id: 'shield-left', name: equipment.name, equipment, locations: new Set(['LA']),
        });
        const right = new MountedEquipment({
            owner, id: 'shield-right', name: equipment.name, equipment, locations: new Set(['RA']),
        });
        inventory.push(left, right);

        handler.handleSelection(left, { label: 'Mode', value: SHIELD_RAISED_MODE }, commandContext);
        handler.handleSelection(right, { label: 'Mode', value: SHIELD_RAISED_MODE }, commandContext);

        expect(selectedShieldMode(left)).toBe(SHIELD_RAISED_MODE);
        expect(selectedShieldMode(right)).toBe(SHIELD_RAISED_MODE);
    });

    it('shows the current shield mode in SVG summaries and updates an existing suffix', () => {
        const options = { selectedRange: null, hitModifierBreakdown: [], showModeName: true };
        const coreShield = mounted();

        expect(handler.applyInventoryControlDisplayEffects(coreShield, display, options, queryContext).name)
            .toBe('Shield (Medium) (Lowered)');
        handler.handleSelection(coreShield, { label: 'Mode', value: SHIELD_RAISED_MODE }, commandContext);
        expect(handler.applyInventoryControlDisplayEffects(
            coreShield,
            { ...display, name: 'Shield (Medium) (Lowered)' },
            options,
            queryContext,
        ).name).toBe('Shield (Medium) (Raised)');

        const twShield = mounted(TW_GAME_RULES);
        handler.handleSelection(twShield, { label: 'Mode', value: SHIELD_PASSIVE_MODE }, commandContext);
        expect(handler.applyInventoryControlDisplayEffects(twShield, display, options, queryContext).name)
            .toBe('Shield (Medium) (Passive)');
        expect(handler.applyInventoryControlDisplayEffects(
            twShield, display, { ...options, showModeName: false }, queryContext,
        )).toBe(display);
    });
});
