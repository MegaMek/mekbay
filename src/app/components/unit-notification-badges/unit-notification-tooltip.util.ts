// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import type { CBTForceUnit } from '../../models/cbt-force-unit.model';
import type {
    SerializedPendingMekCritical,
    SerializedPendingMekCriticalChance,
    SerializedPendingUnitCheck,
} from '../../models/force-serialization';
import { getMekLocationLabel } from '../../models/entity/types';
import { isFallPSRCheck, psrFailureLabel, type PSRCheck } from '../../models/rules/unit-type-rules';
import {
    pendingUnitCheckOutcome,
    pendingUnitCheckPriority,
    pendingUnitCheckLabel,
    pendingUnitCheckStage,
} from '../../utils/unit-check.util';
import type { TooltipLine } from '../tooltip/tooltip.component';

export type UnitNotificationKind = 'fall' | 'psr' | 'critical-chance' | 'critical-hit' | 'unit-check';

export interface PendingNotificationSummary {
    readonly kind: UnitNotificationKind;
    readonly count: number;
    readonly tooltip: TooltipLine[];
}

type PendingCriticalEvent = SerializedPendingMekCriticalChance | SerializedPendingMekCritical;

/**
 * Builds the one numbered badge used for all actionable work. The ordering
 * mirrors CBTPhaseResolutionService so the badge shape describes the dialog
 * that clicking it will open first.
 */
export function buildPendingNotificationSummary(
    unit: CBTForceUnit | null | undefined,
): PendingNotificationSummary | null {
    if (!unit) return null;

    const turnState = unit.turnState();
    const fallCount = unit.pendingFallCount?.() ?? 0;
    const unitCheckCount = turnState.pendingUnitCheckCount();
    const criticalChanceCount = turnState.pendingCriticalChanceCount();
    const criticalHitCount = turnState.pendingCriticalHitCount();
    const psrCount = turnState.actionablePSRRollsCount();
    const count = fallCount + unitCheckCount + criticalChanceCount + criticalHitCount + psrCount;
    if (count === 0) return null;

    const criticalEvents = orderedPendingCriticalEvents(
        unit,
        criticalChanceCount > 0,
        criticalHitCount > 0,
    );
    const firstCriticalKind = criticalEvents[0]?.type === 'mek-critical-hit'
        ? 'critical-hit'
        : criticalEvents[0]?.type === 'mek-critical-chance'
            ? 'critical-chance'
            : criticalChanceCount > 0
                ? 'critical-chance'
                : 'critical-hit';
    const kind: UnitNotificationKind = fallCount > 0
        ? 'fall'
        : unitCheckCount > 0
            ? 'unit-check'
            : criticalChanceCount + criticalHitCount > 0
                ? firstCriticalKind
                : 'psr';

    const tooltip: TooltipLine[] = [];
    if (fallCount > 0) {
        tooltip.push(...(buildFallTooltip(unit) ?? [{
            label: 'Fall damage',
            value: fallCount === 1 ? 'Pending' : `${fallCount} pending`,
        }]));
    }
    if (unitCheckCount > 0) {
        tooltip.push(...(buildPendingUnitCheckTooltip(unit) ?? [{
            label: 'Unit checks',
            value: `${unitCheckCount} pending`,
        }]));
    }

    let listedCriticalChances = 0;
    let listedCriticalHits = 0;
    for (const event of criticalEvents) {
        if (event.type === 'mek-critical-chance') {
            listedCriticalChances++;
            tooltip.push(prefixTooltipLabel(criticalChanceLine(event), 'Critical Chance'));
        } else {
            listedCriticalHits += event.remainingHits;
            tooltip.push(prefixTooltipLabel(criticalHitLine(event), 'Critical Hit'));
        }
    }
    if (listedCriticalChances < criticalChanceCount) {
        tooltip.push({
            label: 'Critical chances',
            value: `${criticalChanceCount - listedCriticalChances} pending`,
        });
    }
    if (listedCriticalHits < criticalHitCount) {
        const remaining = criticalHitCount - listedCriticalHits;
        tooltip.push({
            label: 'Critical hits',
            value: `${remaining} hit${remaining === 1 ? '' : 's'} pending`,
        });
    }
    if (psrCount > 0) {
        const psrLines = buildPsrTooltip(unit) ?? [{
            label: 'Piloting Skill Rolls',
            value: `${psrCount} pending`,
        }];
        tooltip.push(...psrLines.map(line => prefixTooltipLabel(line, 'PSR', ' · ')));
    }

    return { kind, count, tooltip };
}

export function buildFallTooltip(unit: CBTForceUnit | null | undefined): TooltipLine[] | null {
    if (!unit) return null;
    const pendingFallCount = unit.pendingFallCount?.() ?? 0;
    if (pendingFallCount > 0) {
        return [{
            label: 'Fall damage',
            value: pendingFallCount === 1 ? 'Pending' : `${pendingFallCount} pending`,
        }];
    }
    const automaticFallLines = buildPsrEventTooltip(unit, 'automatic-fall');
    if (!unit.turnState().autoFall() && automaticFallLines === null) return null;
    return automaticFallLines ?? [{
        label: 'Automatic fall',
        value: 'Fall',
    }];
}

export function buildPsrTooltip(unit: CBTForceUnit | null | undefined): TooltipLine[] | null {
    return unit ? buildPsrEventTooltip(unit, 'roll') : null;
}

function buildPsrEventTooltip(
    unit: CBTForceUnit,
    mode: 'roll' | 'automatic-fall',
): TooltipLine[] | null {
    const turnState = unit.turnState();
    const pending = turnState.getPSRChecks().filter(check => {
        if (check.fallCheck === undefined || check.id === undefined) return false;
        const outcome = turnState.getPSROutcome(check.id);
        if (mode === 'automatic-fall') {
            return isFallPSRCheck(check)
                && (turnState.autoFall() || turnState.isPSRCheckAutomaticFailure(check))
                && (outcome === undefined || (outcome === 'failed' && !unit.getCondition('prone')));
        }
        return outcome === undefined
            && !turnState.isPSRCheckAutomaticFailure(check)
            && (!turnState.autoFall() || !isFallPSRCheck(check));
    });
    if (pending.length === 0) return null;

    return pending.map(check => ({
        label: psrCheckLabel(check),
        value: mode === 'automatic-fall'
            ? psrFailureLabel(check)
            : `Target ${unit.PSRTargetRoll()}+ · ${psrFailureLabel(check)}`,
    }));
}

export function buildPendingCriticalChanceTooltip(
    unit: CBTForceUnit | null | undefined,
): TooltipLine[] | null {
    const pending = unit?.turnState().getPendingCriticalChances() ?? [];
    if (pending.length === 0) return null;
    return pending.map(criticalChanceLine);
}

export function buildPendingCriticalHitTooltip(
    unit: CBTForceUnit | null | undefined,
): TooltipLine[] | null {
    const pending = unit?.turnState().getPendingCriticalHits() ?? [];
    const count = pending.reduce((total, event) => total + event.remainingHits, 0);
    if (pending.length === 0 || count === 0) return null;
    return pending.map(criticalHitLine);
}

export function buildPendingUnitCheckTooltip(
    unit: CBTForceUnit | null | undefined,
): TooltipLine[] | null {
    if (!unit) return null;
    const total = unit.turnState().pendingUnitCheckCount();
    if (total === 0) return null;

    const currentStage = pendingUnitCheckStage(unit);
    const currentIds = new Set(currentStage.map(check => check.id));
    const checks = [
        ...currentStage,
        ...unit.turnState().actionablePendingUnitChecks()
            .filter(check => !currentIds.has(check.id))
            .sort((left, right) => pendingUnitCheckPriority(unit, left) - pendingUnitCheckPriority(unit, right)),
    ].slice(0, total);
    return checks.flatMap(check => unitCheckLines(unit, check));
}

function unitCheckLines(unit: CBTForceUnit, check: SerializedPendingUnitCheck): TooltipLine[] {
    const outcome = pendingUnitCheckOutcome(check);
    const resolution = check.target !== undefined
        ? `Target ${check.target}+${outcome ? ` · ${capitalize(outcome)}` : ''}`
        : outcome
            ? `${check.result?.kind === 'automatic' ? 'Automatic · ' : ''}${capitalize(outcome)}`
            : 'Pending';
    return [
        { label: pendingUnitCheckLabel(check), value: resolution }
    ];
}

function criticalChanceStatus(result: 'none' | 'blown-off' | 1 | 2 | 3 | 4 | undefined): string {
    if (result === undefined) return 'Pending';
    if (result === 'none') return 'No criticals';
    if (result === 'blown-off') return 'Blown off';
    return `${result} critical hit${result === 1 ? '' : 's'}`;
}

function orderedPendingCriticalEvents(
    unit: CBTForceUnit,
    includeChances: boolean,
    includeHits: boolean,
): PendingCriticalEvent[] {
    const turnState = unit.turnState();
    const ordered: PendingCriticalEvent[] = [];
    const seen = new Set<string>();
    const append = (event: PendingCriticalEvent): void => {
        if ((event.type === 'mek-critical-chance' && !includeChances)
            || (event.type === 'mek-critical-hit' && !includeHits)
            || seen.has(event.id)) return;
        seen.add(event.id);
        ordered.push(event);
    };

    for (const event of turnState.getPendingEvents?.() ?? []) {
        if (event.type === 'mek-critical-chance' || event.type === 'mek-critical-hit') append(event);
    }
    for (const event of turnState.getPendingCriticalChances()) append(event);
    for (const event of turnState.getPendingCriticalHits()) append(event);
    return ordered;
}

function criticalChanceLine(event: SerializedPendingMekCriticalChance): TooltipLine {
    return {
        label: getMekLocationLabel(event.location) ?? event.location,
        value: criticalChanceStatus(event.result),
    };
}

function criticalHitLine(event: SerializedPendingMekCritical): TooltipLine {
    const source = getMekLocationLabel(event.location) ?? event.location;
    const target = getMekLocationLabel(event.targetLocation) ?? event.targetLocation;
    const location = source === target ? target : `${source} → ${target}`;
    const caseII = event.caseII?.status === 'pending' ? ' · CASE II pending' : '';
    return {
        label: location,
        value: `${event.remainingHits} hit${event.remainingHits === 1 ? '' : 's'}${caseII}`,
    };
}

function prefixTooltipLabel(line: TooltipLine, prefix: string, separator = ': '): TooltipLine {
    return {
        ...line,
        label: line.label ? `${prefix}${separator}${line.label}` : prefix,
    };
}

function psrCheckLabel(check: PSRCheck): string {
    const location = check.loc
        ? getMekLocationLabel(check.loc) ?? check.loc
        : undefined;
    return location ? `${check.reason} (${location})` : check.reason;
}

function capitalize(value: string): string {
    return `${value.charAt(0).toUpperCase()}${value.slice(1)}`;
}
