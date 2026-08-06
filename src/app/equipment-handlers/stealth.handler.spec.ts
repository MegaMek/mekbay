// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import type { PickerChoice } from '../components/picker/picker.interface';
import type { Equipment } from '../models/equipment.model';
import { MountedEquipment } from '../models/mounted-equipment.model';
import type { HandlerContext } from '../services/equipment-interaction-registry.service';
import { StealthHandler } from './stealth.handler';

function equipment(flag: 'F_STEALTH' | 'F_CHAMELEON_SHIELD' | 'F_ECM'): MountedEquipment {
    const owner = {
        setInventoryEntry: jasmine.createSpy('setInventoryEntry'),
        rules: { computeEntryState: () => ({ isDamaged: false, isDisabled: false, hitMod: 0 }) },
    } as never;
    return new MountedEquipment({
        owner,
        id: flag,
        name: flag,
        equipment: { name: flag, flags: new Set([flag]) } as Equipment,
        states: new Map(),
    });
}

describe('StealthHandler', () => {
    const handler = new StealthHandler();
    const context = {
        toastService: { showToast: jasmine.createSpy('showToast') },
    } as never as HandlerContext;

    it('applies to ordinary stealth and Chameleon LPS only', () => {
        expect(handler.applicableTo(equipment('F_STEALTH'))).toBeTrue();
        expect(handler.applicableTo(equipment('F_CHAMELEON_SHIELD'))).toBeTrue();
        expect(handler.applicableTo(equipment('F_ECM'))).toBeFalse();
    });

    it('uses the same persisted toggle state for Chameleon LPS', () => {
        const chameleon = equipment('F_CHAMELEON_SHIELD');

        handler.handleSelection(chameleon, { value: 'enabled' } as PickerChoice, context);

        expect(chameleon.states.get('state')).toBe('enabled');
        expect(chameleon.owner.setInventoryEntry).toHaveBeenCalledWith(chameleon);
        expect(handler.getChoices(chameleon, context)[0]).toEqual(jasmine.objectContaining({
            active: true,
            value: 'disabled',
        }));
    });
});