// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import type { EquipmentFlag } from './equipment-flags.type';

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

/** Minimal immutable facts consumed by the C3 emergency-master kernel. */
export interface C3EmergencyMasterStateSource {
    readonly equipment?: {
        readonly flags: ReadonlySet<EquipmentFlag>;
    };
    readonly states: ReadonlyMap<string, string>;
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

export function isC3EmergencyMaster(equipment: C3EmergencyMasterStateSource): boolean {
    return equipment.equipment?.flags.has(C3_EMERGENCY_MASTER_FLAG) === true;
}

export function isC3EmergencyMasterEquipment(
    equipment: Readonly<{ hasFlag(flag: string): boolean }> | null | undefined,
): boolean {
    return equipment?.hasFlag(C3_EMERGENCY_MASTER_FLAG) === true;
}

export function getC3EmergencyMasterMode(equipment: C3EmergencyMasterStateSource): C3EmergencyMasterMode {
    const value = equipment.states.get(C3EM_MODE_STATE_KEY);
    return value === 'on' || value === 'off' ? value : 'auto';
}

export function getC3EmergencyMasterOperatingTurns(equipment: C3EmergencyMasterStateSource): number {
    const value = Number(equipment.states.get(C3EM_OPERATING_TURNS_STATE_KEY) ?? 0);
    if (!Number.isFinite(value)) return 0;
    return Math.max(0, Math.min(C3EM_FRIED_SEQUENCE_VALUE, Math.trunc(value)));
}

export function isC3EmergencyMasterFried(equipment: C3EmergencyMasterStateSource): boolean {
    return isC3EmergencyMasterOperatingTurnsFried(getC3EmergencyMasterOperatingTurns(equipment));
}

export function isC3EmergencyMasterRequested(equipment: C3EmergencyMasterStateSource, automatic: boolean): boolean {
    return isC3EmergencyMasterModeRequested(getC3EmergencyMasterMode(equipment), automatic);
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
