// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

export const C3_EMERGENCY_MASTER_FLAG = 'F_C3EM' as const;

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

export function isC3EmergencyMasterEquipment(
    equipment: Readonly<{ hasFlag(flag: string): boolean }> | null | undefined,
): boolean {
    return equipment?.hasFlag(C3_EMERGENCY_MASTER_FLAG) === true;
}

/** Representation-independent fried policy shared by legacy and ComponentId runtimes. */
export function isC3EmergencyMasterOperatingTurnsFried(operatingTurns: number): boolean {
    return operatingTurns === C3EM_FRIED_SEQUENCE_VALUE;
}

/**
 * Representation-independent request policy. In typed V2, `automatic` is true
 * only after the encounter coordinator promotes the exact endpoint to master.
 */
export function isC3EmergencyMasterModeRequested(
    mode: C3EmergencyMasterMode,
    automatic: boolean,
): boolean {
    return mode === 'on' || (mode === 'auto' && automatic);
}
