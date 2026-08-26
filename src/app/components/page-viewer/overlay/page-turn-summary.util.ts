// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import { InjectionToken } from '@angular/core';

import type { CBTMekForceMember } from '../../../models/force-member.model';
import type { MekHeatSourceV2 } from '../../../models/runtime/mek-heat-state-v2';
import type {
    MekPilotCheckV2,
    MekPilotCheckSourceV2,
    MekPsrModifier,
} from '../../../models/runtime/mek-movement-psr-v2';
import type { ManagedOverlayRef, OverlayManagerService } from '../../../services/overlay-manager.service';

/** The direct force member owned by a turn-summary child overlay. */
export const PAGE_TURN_MEMBER = new InjectionToken<CBTMekForceMember>('Page turn member');

export interface MekTurnSummaryHeatRow extends MekHeatSourceV2 {
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

export function composeMekTurnSummaryHeatRows(
    sources: readonly MekHeatSourceV2[],
    selectedWeaponsHeat: number | null,
    underwaterBonus: number,
): readonly MekTurnSummaryHeatRow[] {
    let rows: MekTurnSummaryHeatRow[] = sources.map(source => ({ ...source }));
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

/** Combines permanent rules facts with phase-only checks for the retained overlay. */
export function composeMekPsrDisplayModifiers(
    permanent: readonly MekPsrModifier[],
    checks: readonly {
        readonly reason: string;
        readonly source: Pick<MekPilotCheckSourceV2, 'triggerKind' | 'triggerModifier'>;
    }[],
): readonly MekPsrDisplayModifier[] {
    const gyroChecks = checks.filter(check => check.source.triggerKind === 'gyro-hit');
    const rows: MekPsrDisplayModifier[] = permanent
        .filter(entry => gyroChecks.length === 0 || !entry.reason.includes('Gyro'))
        .map(entry => ({
            modifier: entry.modifier,
            reason: entry.modifierReason ?? entry.reason,
            ...(entry.locationId === undefined ? {} : { locationId: entry.locationId }),
        }));
    for (const check of checks) {
        if (check.source.triggerModifier === 0 || check.source.triggerKind === 'gyro-hit') continue;
        rows.push({ modifier: check.source.triggerModifier, reason: check.reason });
    }
    const gyroCheck = gyroChecks[gyroChecks.length - 1];
    if (gyroCheck && gyroCheck.source.triggerModifier !== 0) {
        rows.push({ modifier: gyroCheck.source.triggerModifier, reason: gyroCheck.reason });
    }
    rows.sort((left, right) => {
        const leftNegative = left.modifier < 0;
        const rightNegative = right.modifier < 0;
        if (leftNegative !== rightNegative) return leftNegative ? -1 : 1;
        return left.reason < right.reason ? -1 : left.reason > right.reason ? 1 : 0;
    });
    return Object.freeze(rows.map(row => Object.freeze(row)));
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
