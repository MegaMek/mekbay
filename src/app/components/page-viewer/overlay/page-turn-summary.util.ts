// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import { InjectionToken } from '@angular/core';

import type { CBTMekForceMember } from '../../../models/force-member.model';
import type {
    MekMovementPsrProjectionResultV2,
    MekPilotCheckV2,
} from '../../../models/runtime/mek-movement-psr-v2';
import type { ManagedOverlayRef, OverlayManagerService } from '../../../services/overlay-manager.service';

/** The direct force member owned by a turn-summary child overlay. */
export const PAGE_TURN_MEMBER = new InjectionToken<CBTMekForceMember>('Page turn member');

export interface TurnSummaryHeatSource {
    readonly id: string;
    readonly label: string;
    readonly value: number;
    readonly group?: string;
}

export interface TurnSummaryHeatRow extends TurnSummaryHeatSource {
    readonly selectedValue?: number;
    readonly selectedOnly?: boolean;
    readonly underwater?: boolean;
}

export interface MekPsrDisplayModifier {
    readonly modifier: number;
    readonly reason: string;
    readonly locationId?: string;
}

/** An automatic fall replaces only checks whose failure would also be a fall. */
export function actionableMekPilotChecks(
    checks: readonly MekPilotCheckV2[],
    automaticFall: boolean,
): readonly MekPilotCheckV2[] {
    return automaticFall
        ? checks.filter(check => check.source.triggerKind === 'shutdown'
            || check.source.triggerKind === 'get-up')
        : checks;
}

export function composeTurnSummaryHeatRows(
    sources: readonly TurnSummaryHeatSource[],
    selectedWeaponsHeat: number | null,
    underwaterBonus: number,
): readonly TurnSummaryHeatRow[] {
    let rows: TurnSummaryHeatRow[] = [];
    for (const source of sources) {
        if (source.value === 0) continue;
        const existingIndex = rows.findIndex(row => row.label === source.label);
        if (existingIndex >= 0) {
            const existing = rows[existingIndex];
            rows[existingIndex] = {
                id: existing.label.toLowerCase(),
                label: existing.label,
                value: existing.value + source.value,
            };
        } else {
            rows.push({ id: source.id, label: source.label, value: source.value });
        }
    }
    if (selectedWeaponsHeat !== null) {
        const weaponsIndex = rows.findIndex(row => row.id === 'weapons');
        if (weaponsIndex >= 0) {
            rows = rows.map((row, index) => index === weaponsIndex
                ? { ...row, selectedValue: selectedWeaponsHeat }
                : row);
        } else {
            rows.unshift({
                id: 'selected-weapons',
                label: 'Selected Weapons',
                value: selectedWeaponsHeat,
                selectedOnly: true,
            });
        }
    }
    if (underwaterBonus > 0) rows.push({
        id: 'underwater-dissipation',
        label: 'Water',
        value: -underwaterBonus,
        underwater: true,
    });
    return Object.freeze(rows.map(row => Object.freeze(row)));
}

/** The modifiers every Piloting Skill Roll of the phase adds, as the rules derive them, labelled for the overlays. */
export function mekPsrDisplayModifiers(movement: MekMovementPsrProjectionResultV2): readonly MekPsrDisplayModifier[] {
    if (movement.kind !== 'supported') return Object.freeze([]);
    return Object.freeze(movement.phasePsrModifiers.map(entry => Object.freeze({
        modifier: entry.modifier,
        reason: entry.modifierReason ?? entry.reason,
        ...(entry.locationId === undefined ? {} : { locationId: entry.locationId }),
    })));
}

/** Prevent a modal confirmation from being mistaken for an outside click. */
export async function runWithTurnSummaryCloseBlocked<T>(
    overlayManager: OverlayManagerService,
    unitId: string,
    operation: () => Promise<T>,
): Promise<T> {
    const parentKey = `turnSummary-${unitId}`;
    overlayManager.blockCloseUntil(parentKey);
    try {
        return await operation();
    } finally {
        overlayManager.unblockClose(parentKey);
    }
}

/** Keep the parent summary open while one of its modal child panels is active. */
export function openTurnSummaryChildOverlay<T>(
    overlayManager: OverlayManagerService,
    unitId: string,
    openOverlay: () => ManagedOverlayRef<T>,
): ManagedOverlayRef<T> {
    const parentKey = `turnSummary-${unitId}`;
    overlayManager.blockCloseUntil(parentKey);
    try {
        const child = openOverlay();
        child.closed.subscribe(() => overlayManager.unblockClose(parentKey));
        return child;
    } catch (error) {
        overlayManager.unblockClose(parentKey);
        throw error;
    }
}
