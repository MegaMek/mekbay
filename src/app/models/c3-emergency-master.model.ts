/*
 * Copyright (C) 2026 The MegaMek Team. All Rights Reserved.
 *
 * This file is part of MekBay.
 *
 * MekBay is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License (GPL),
 * version 3 or (at your option) any later version,
 * as published by the Free Software Foundation.
 *
 * MekBay is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty
 * of MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.
 * See the GNU General Public License for more details.
 *
 * A copy of the GPL should have been included with this project;
 * if not, see <https://www.gnu.org/licenses/>.
 *
 * NOTICE: The MegaMek organization is a non-profit group of volunteers
 * creating free software for the BattleTech community.
 *
 * MechWarrior, BattleMech, `Mech and AeroTech are registered trademarks
 * of The Topps Company, Inc. All Rights Reserved.
 *
 * Catalyst Game Labs and the Catalyst Game Labs logo are trademarks of
 * InMediaRes Productions, LLC.
 *
 * MechWarrior Copyright Microsoft Corporation. MegaMek was created under
 * Microsoft's "Game Content Usage Rules"
 * <https://www.xbox.com/en-US/developers/rules> and it is not endorsed by or
 * affiliated with Microsoft.
 */

import type { MountedEquipment } from './mounted-equipment.model';

export const C3EM_MODE_STATE_KEY = 'c3emMode';
export const C3EM_OPERATING_TURNS_STATE_KEY = 'c3emOperatingTurns';
export const C3EM_MAX_OPERATING_TURNS = 6;
export const C3EM_FRIED_SEQUENCE_VALUE = C3EM_MAX_OPERATING_TURNS + 1;

export type C3EmergencyMasterMode = 'auto' | 'on' | 'off';
export type C3EmergencyMasterStatus = 'dormant' | 'active' | 'standby' | 'fried' | 'unavailable';

export interface C3EmergencyMasterStatusEntry {
    key: string;
    status: C3EmergencyMasterStatus;
}

export class C3EmergencyMasterActivationTracker {
    private previousStatuses: ReadonlyMap<string, C3EmergencyMasterStatus> | null = null;

    update(entries: readonly C3EmergencyMasterStatusEntry[]): string[] {
        const currentStatuses = new Map(entries.map(entry => [entry.key, entry.status]));
        const activated = this.previousStatuses
            ? entries
                .filter(entry => this.previousStatuses!.has(entry.key)
                    && this.previousStatuses!.get(entry.key) !== 'active'
                    && entry.status === 'active')
                .map(entry => entry.key)
            : [];
        this.previousStatuses = currentStatuses;
        return activated;
    }
}

export function isC3EmergencyMaster(equipment: MountedEquipment): boolean {
    return equipment.equipment?.flags.has('F_C3EM') === true;
}

export function getC3EmergencyMasterMode(equipment: MountedEquipment): C3EmergencyMasterMode {
    const value = equipment.states.get(C3EM_MODE_STATE_KEY);
    return value === 'on' || value === 'off' ? value : 'auto';
}

export function getC3EmergencyMasterOperatingTurns(equipment: MountedEquipment): number {
    const value = Number(equipment.states.get(C3EM_OPERATING_TURNS_STATE_KEY) ?? 0);
    if (!Number.isFinite(value)) return 0;
    return Math.max(0, Math.min(C3EM_FRIED_SEQUENCE_VALUE, Math.trunc(value)));
}

export function isC3EmergencyMasterFried(equipment: MountedEquipment): boolean {
    return getC3EmergencyMasterOperatingTurns(equipment) === C3EM_FRIED_SEQUENCE_VALUE;
}

export function isC3EmergencyMasterRequested(equipment: MountedEquipment, automatic: boolean): boolean {
    const mode = getC3EmergencyMasterMode(equipment);
    return mode === 'on' || (mode === 'auto' && automatic);
}
