// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import type { PSRCheck, UnitHeatSource } from '../../../models/rules/unit-type-rules';
import type { SelectedInventoryWeaponHeat } from '../../../utils/inventory-control-heat.util';
import type { MotiveModes } from '../../../models/motiveModes.model';
import type { ManagedOverlayRef, OverlayManagerService } from '../../../services/overlay-manager.service';

export interface TurnSummaryHeatRow {
    readonly id: string;
    readonly label: string;
    readonly value: number;
    readonly selectedValue?: number;
    readonly selectedOnly?: boolean;
    readonly underwater?: boolean;
}

export const TURN_SUMMARY_UNDERWATER_HEAT_SOURCE_ID = 'underwater-dissipation';

/** Keeps the summary's capture-phase outside-click handler dormant while a modal child is open. */
export function openTurnSummaryChildOverlay<T>(
    overlayManager: OverlayManagerService,
    unitId: string,
    openOverlay: () => ManagedOverlayRef<T>,
): ManagedOverlayRef<T> {
    const parentOverlayKey = `turnSummary-${unitId}`;
    overlayManager.blockCloseUntil(parentOverlayKey);
    try {
        const childOverlay = openOverlay();
        childOverlay.closed.subscribe(() => overlayManager.unblockClose(parentOverlayKey));
        return childOverlay;
    } catch (error) {
        overlayManager.unblockClose(parentOverlayKey);
        throw error;
    }
}

export function composeTurnSummaryHeatRows(
    sources: readonly UnitHeatSource[],
    selection: SelectedInventoryWeaponHeat,
    underwaterBonus = 0,
): TurnSummaryHeatRow[] {
    const rows: TurnSummaryHeatRow[] = [];
    for (const source of sources) {
        const rowIndex = rows.findIndex(row => row.label === source.label);
        if (rowIndex >= 0) {
            const row = rows[rowIndex];
            rows[rowIndex] = { ...row, id: row.label.toLowerCase(), value: row.value + source.value };
        } else {
            rows.push({ id: source.id, label: source.label, value: source.value });
        }
    }
    let result = rows;

    if (selection.hasSelection) {
        const weaponsRow = rows.find(row => row.id === 'weapons');
        if (weaponsRow) {
            result = rows.map(row => row === weaponsRow ? { ...row, selectedValue: selection.value } : row);
        } else {
            result = [{
                id: 'selected-weapons',
                label: 'Selected Weapons',
                value: selection.value,
                selectedOnly: true,
            }, ...rows];
        }
    }

    if (Number.isFinite(underwaterBonus) && underwaterBonus > 0) {
        result = [...result, {
            id: TURN_SUMMARY_UNDERWATER_HEAT_SOURCE_ID,
            label: 'Water',
            value: -underwaterBonus,
            underwater: true,
        }];
    }
    return result;
}

export function displayPsrModifiers(modifiers: readonly PSRCheck[]): Array<PSRCheck & { pilotCheck: number }> {
    return modifiers
        .filter((modifier): modifier is PSRCheck & { pilotCheck: number } =>
            modifier.pilotCheck !== undefined && modifier.pilotCheck !== 0
        )
        .map(modifier => ({
            ...modifier,
            reason: modifier.modifierReason ?? modifier.reason,
        }));
}

export function countActionablePsrChecks(
    checks: readonly Pick<PSRCheck, 'failureOutcome'>[],
    autoFall: boolean
): number {
    return autoFall ? checks.filter(check => check.failureOutcome !== 'Fall').length : checks.length;
}

export function isMoveModeDisabledWhileProne(
    mode: MotiveModes,
    prone: boolean,
): boolean {
    return mode === 'jump' && prone;
}
