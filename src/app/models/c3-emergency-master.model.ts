// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

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
