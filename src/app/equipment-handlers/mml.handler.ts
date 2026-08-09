// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import type { PickerChoice } from '../components/picker/picker.interface';
import { AmmoEquipment, WeaponEquipment } from '../models/equipment.model';
import type { MountedEquipment } from '../models/mounted-equipment.model';
import { EquipmentInteractionHandler, type HandlerCommandContext, type HandlerQueryContext } from '../services/equipment-interaction-registry.service';
import { INVENTORY_CONTROL_MODE_STATE } from '../utils/inventory-control.util';
import { resolveAmmoWeaponProfile } from '../models/ammo-weapon-profile.model';

export class MmlHandler extends EquipmentInteractionHandler {
    readonly id = 'mml-handler';
    override readonly priority = 110;

    override applicableTo(equipment: MountedEquipment): boolean {
        return equipment.equipment instanceof WeaponEquipment && equipment.equipment.ammoType === 'MML';
    }

    getChoices(_equipment: MountedEquipment, _context: HandlerQueryContext): PickerChoice[] {
        return [];
    }

    handleSelection(_equipment: MountedEquipment, _choice: PickerChoice, _context: HandlerCommandContext): boolean {
        return true;
    }

    override matchesInventoryAmmo(equipment: MountedEquipment, ammo: AmmoEquipment, mode: string | null, _context: HandlerQueryContext): boolean | null {
        if (!(equipment.equipment instanceof WeaponEquipment) || equipment.equipment.ammoType !== 'MML') return null;
        if (ammo.ammoType !== 'MML') return false;
        if (equipment.equipment.rackSize > 0 && ammo.rackSize !== equipment.equipment.rackSize) return false;
        const ammoProfile = resolveAmmoWeaponProfile(ammo);
        if (!ammoProfile) return false;
        const persistedMode = equipment.states.get(INVENTORY_CONTROL_MODE_STATE);
        return ammoProfile.displayName === (mode ?? persistedMode ?? 'SRM');
    }
}