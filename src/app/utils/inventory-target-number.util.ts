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

import type { MountedEquipment } from '../models/mounted-equipment.model';
import { WeaponEquipment, type AmmoEquipment } from '../models/equipment.model';
import type { InventoryControlRuntimeRangeKey, InventoryControlRuntimeTarget } from '../models/inventory-control-runtime-state.model';
import { CORE_2026_GAME_RULES, type CBTGameRules, type HitModifier } from '../models/rules/game-rules';
import type { UnitModifierBreakdownEntry } from '../models/rules/unit-type-rules';
import type { InventoryControlDisplayData, InventoryControlGroupId, InventoryRangeKey } from './inventory-control.util';
import type { TooltipLine } from '../components/tooltip/tooltip.component';

export interface InventoryTargetRangeSelection {
    range: InventoryControlRuntimeRangeKey;
    outOfLongRange: boolean;
    outOfExtremeRange: boolean;
    minimumRangeModifier: number;
    distance: number;
    c3Distance: number | null;
}

export interface InventoryTargetNumberBreakdown {
    total: number;
    lines: TooltipLine[];
    rangeSelection: InventoryTargetRangeSelection;
}

export interface InventoryTargetNumberState {
    text: string;
    breakdown: InventoryTargetNumberBreakdown | null;
    rangeSelection: InventoryTargetRangeSelection | null;
}

export interface InventoryTargetNumberInput {
    entry: MountedEquipment;
    category: InventoryControlGroupId;
    display: Pick<InventoryControlDisplayData, InventoryRangeKey | 'min'>;
    extremeRange?: number | null;
    selectedAmmo?: AmmoEquipment | null;
    target: InventoryControlRuntimeTarget | null;
    gunnerySkill: number;
    pilotingSkill: number;
    gunneryModifierBreakdown?: readonly UnitModifierBreakdownEntry[];
    pilotingModifierBreakdown?: readonly UnitModifierBreakdownEntry[];
    missingMovementModifier?: boolean;
    attackModifierBreakdown: readonly UnitModifierBreakdownEntry[];
    hitModifier: HitModifier;
    heatFireModifier?: number;
    gameRules?: CBTGameRules;
}

export type InventoryTargetDisplay = Pick<InventoryControlDisplayData, InventoryRangeKey | 'min'>;

export function inventoryTargetCategory(entry: MountedEquipment): InventoryControlGroupId {
    if (isPhysicalInventoryTargetNumberEntry(entry)) return 'physical';
    if (entry.equipment instanceof WeaponEquipment) return 'ranged';
    return 'equipment';
}

export function inventoryTargetRangeSelection(input: Pick<InventoryTargetNumberInput, 'entry' | 'category' | 'display' | 'extremeRange' | 'target' | 'selectedAmmo'>): InventoryTargetRangeSelection | null {
    const target = input.target;
    if (!target) return null;
    const c3Distance = target.useC3 === true ? target.c3Distance ?? null : null;
    const rangeDistance = c3Distance === null ? target.distance : Math.min(target.distance, c3Distance);
    if (isPhysicalInventoryTargetNumberEntry(input.entry, input.category)) return { range: 'short', outOfLongRange: false, outOfExtremeRange: false, minimumRangeModifier: 0, distance: target.distance, c3Distance };

    const artilleryMinimumDistance = input.selectedAmmo?.category === 'Artillery' ? 7 : null;
    if (artilleryMinimumDistance !== null && target.distance <= artilleryMinimumDistance) {
        return { range: 'short', outOfLongRange: true, outOfExtremeRange: false, minimumRangeModifier: 0, distance: target.distance, c3Distance };
    }

    const minimumRangeModifier = inventoryTargetMinimumRangeModifier(input.display.min, target.distance);

    const thresholds = (['short', 'medium', 'long'] as const)
        .map(range => ({ range, value: parseInventoryTargetNumberCell(input.display[range]) }))
        .filter((item): item is { range: InventoryRangeKey; value: number } => item.value !== null);
    if (thresholds.length === 0) return null;
    const longRange = thresholds.find(threshold => threshold.range === 'long')?.value ?? null;
    const outOfLongRange = longRange !== null && target.distance > longRange;
    const extremeRange = input.extremeRange ?? null;
    const actualOutOfExtremeRange = outOfLongRange && extremeRange !== null && target.distance > extremeRange;

    for (const threshold of thresholds) {
        if (rangeDistance <= threshold.value) {
            return { range: threshold.range, outOfLongRange, outOfExtremeRange: actualOutOfExtremeRange, minimumRangeModifier, distance: target.distance, c3Distance };
        }
    }

    return {
        range: 'extreme',
        outOfLongRange: true,
        outOfExtremeRange: extremeRange !== null && rangeDistance > extremeRange,
        minimumRangeModifier,
        distance: target.distance,
        c3Distance
    };
}

export function inventoryTargetNumberState(
    input: InventoryTargetNumberInput,
    rangeSelection: InventoryTargetRangeSelection | null = inventoryTargetRangeSelection(input)
): InventoryTargetNumberState {
    if (!rangeSelection) return { text: '', breakdown: null, rangeSelection };
    if (rangeSelection.outOfLongRange) return { text: 'X', breakdown: null, rangeSelection };
    if (input.hitModifier === 'Vs' || input.hitModifier === '*') {
        return { text: input.hitModifier, breakdown: null, rangeSelection };
    }
    if (input.hitModifier === null) return { text: '', breakdown: null, rangeSelection };
    const breakdown = inventoryTargetNumberBreakdown(input, rangeSelection);
    if (input.missingMovementModifier) return { text: 'M?', breakdown, rangeSelection };
    return { text: breakdown === null ? '' : breakdown.total.toString(), breakdown, rangeSelection };
}

export function inventoryTargetNumberText(input: InventoryTargetNumberInput): string {
    return inventoryTargetNumberState(input).text;
}

export function inventoryTargetNumberBreakdown(
    input: InventoryTargetNumberInput,
    rangeSelection: InventoryTargetRangeSelection | null = inventoryTargetRangeSelection(input)
): InventoryTargetNumberBreakdown | null {
    const target = input.target;
    if (!target) return null;
    if (!rangeSelection) return null;
    if (typeof input.hitModifier !== 'number') return null;
    if (input.missingMovementModifier) {
        return {
            total: 0,
            rangeSelection,
            lines: [{ value: 'Select movement to calculate TN', isHeader: true }]
        };
    }

    const physical = isPhysicalInventoryTargetNumberEntry(input.entry, input.category);
    const skillLabel = physical ? 'Piloting' : 'Gunnery';
    const skill = physical ? input.pilotingSkill : input.gunnerySkill;
    const skillModifierBreakdown = physical ? input.pilotingModifierBreakdown ?? [] : input.gunneryModifierBreakdown ?? [];
    const gameRules = input.gameRules ?? CORE_2026_GAME_RULES;
    const artilleryRangeModifier = input.selectedAmmo?.category === 'Artillery'
        ? gameRules.artilleryFlatRangeModifier : null;
    const rangeModifier = artilleryRangeModifier ?? inventoryTargetRangeModifier(rangeSelection.range);
    const minimumRangeModifier = rangeSelection.minimumRangeModifier;
    const ammoToHitModifier = physical || !input.selectedAmmo
        ? 0
        : gameRules.resolveToHit({ subject: input.selectedAmmo, range: rangeSelection.range }).value;
    const numericAmmoToHitModifier = typeof ammoToHitModifier === 'number' ? ammoToHitModifier : 0;
    const heatFireModifier = physical ? 0 : input.heatFireModifier ?? 0;
    const terms: TooltipLine[] = [
        { label: skillLabel, value: skill.toString() }
    ];

    terms.push(...input.attackModifierBreakdown.map(entry => ({
        label: entry.label,
        value: formatInventoryTargetSignedModifier(entry.modifier)
    })));

    terms.push(...skillModifierBreakdown.map(entry => ({
        label: entry.label,
        value: formatInventoryTargetSignedModifier(entry.modifier)
    })));

    if (target.tnModifier !== 0) {
        terms.push({ label: `Target (${target.letter})`, value: formatInventoryTargetSignedModifier(target.tnModifier) });
    }

    if (!physical) {
        terms.push({
            label: artilleryRangeModifier === null ? `Range (${inventoryTargetRangeDisplayName(rangeSelection.range)})` : 'Artillery',
            value: formatInventoryTargetSignedModifier(rangeModifier)
        });
        if (rangeSelection.c3Distance !== null) {
            terms.push({ label: 'C³ Distance', value: `${rangeSelection.c3Distance} (actual ${rangeSelection.distance})` });
        }
    }
    if (minimumRangeModifier !== 0) {
        terms.push({ label: 'Minimum Range', value: formatInventoryTargetSignedModifier(minimumRangeModifier) });
    }
    if (input.hitModifier !== 0) {
        terms.push({ label: 'Hit Modifier', value: formatInventoryTargetSignedModifier(input.hitModifier) });
    }
    if (numericAmmoToHitModifier !== 0 && input.selectedAmmo) {
        terms.push({ label: `Ammo (${input.selectedAmmo.shortName})`, value: formatInventoryTargetSignedModifier(numericAmmoToHitModifier) });
    }
    if (heatFireModifier !== 0) {
        terms.push({ label: 'Heat - Fire Modifier', value: formatInventoryTargetSignedModifier(heatFireModifier) });
    }

    const attackModifier = input.attackModifierBreakdown.reduce((total, entry) => total + entry.modifier, 0);
    const skillModifier = skillModifierBreakdown.reduce((total, entry) => total + entry.modifier, 0);
    const total = skill + skillModifier + attackModifier + target.tnModifier + rangeModifier + minimumRangeModifier + input.hitModifier + numericAmmoToHitModifier + heatFireModifier;
    terms.push({ isBreak: true });
    terms.push({ label: 'Total', value: total.toString(), isHeader: true });

    return { total, lines: terms, rangeSelection };
}

export function isPhysicalInventoryTargetNumberEntry(entry: MountedEquipment, category?: string): boolean {
    return category === 'physical'
        || !!entry.physical
        || !!entry.equipment?.flags.has('F_CLUB')
        || !!entry.equipment?.flags.has('F_HAND_WEAPON');
}

export function parseInventoryTargetNumberCell(value: string): number | null {
    const text = value.trim();
    if (!/^[-+]?\d+(?:\.\d+)?$/.test(text)) return null;
    const parsed = Number(text);
    return Number.isFinite(parsed) ? parsed : null;
}

export function formatInventoryTargetSignedModifier(value: number): string {
    return value >= 0 ? `+${value}` : value.toString();
}

function inventoryTargetMinimumRangeModifier(minimumRangeText: string, distance: number): number {
    const min = parseInventoryTargetNumberCell(minimumRangeText);
    if (min === null || min <= 0 || distance > min) return 0;
    return (min - distance) + 1;
}

function inventoryTargetRangeModifier(range: InventoryControlRuntimeRangeKey): number {
    switch (range) {
        case 'medium': return 2;
        case 'long': return 4;
        case 'extreme': return 6;
        default: return 0;
    }
}

function inventoryTargetRangeDisplayName(range: InventoryControlRuntimeRangeKey): string {
    switch (range) {
        case 'short': return 'Short';
        case 'medium': return 'Medium';
        case 'long': return 'Long';
        case 'extreme': return 'Extreme';
    }
}

