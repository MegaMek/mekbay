// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import type { MountedEquipment } from '../models/mounted-equipment.model';
import { WeaponEquipment, type AmmoEquipment } from '../models/equipment.model';
import { resolveAmmoWeaponProfile } from '../models/ammo-weapon-profile.model';
import type { InventoryControlRuntimeRangeKey, InventoryControlRuntimeTarget } from '../models/inventory-control-runtime-state.model';
import { CORE_2026_GAME_RULES, SKILL_BREAKDOWN_PRIORITY, validatedToHitModifierBreakdown, type C3DegradationSource, type CBTGameRules, type HitModifier, type ToHitModifierBreakdownEntry } from '../models/rules/game-rules';
import { modifierTooltipLines, orderHitTargetTooltipLines } from './hit-target-tooltip.util';
import type { UnitModifierBreakdownEntry } from '../models/rules/unit-type-rules';
import type { InventoryControlDisplayData, InventoryControlGroupId, InventoryRangeKey } from './inventory-control.util';
import type { TooltipLine } from '../components/tooltip/tooltip.component';
import { aerospaceRangeBracket, aerospaceRangeLimits, effectiveAerospaceMaximumBracket, isRangeBracketWithinMaximum } from './aerospace-range.util';

export interface InventoryTargetRangeSelection {
    range: InventoryControlRuntimeRangeKey;
    maximumRange: InventoryControlRuntimeRangeKey;
    outOfRange: boolean;
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
    allowExtremeRange?: boolean;
    selectedAmmo?: AmmoEquipment | null;
    target: InventoryControlRuntimeTarget | null;
    gunnerySkill: number;
    pilotingSkill: number;
    missingMovementModifier?: boolean;
    attackModifierBreakdown: readonly UnitModifierBreakdownEntry[];
    hitModifier: HitModifier;
    hitModifierBreakdown?: readonly ToHitModifierBreakdownEntry[];
    heatFireModifier?: number;
    c3DegradationSource?: C3DegradationSource;
    gameRules?: CBTGameRules;
}

export type InventoryTargetDisplay = Pick<InventoryControlDisplayData, InventoryRangeKey | 'min'>;

export function inventoryTargetCategory(entry: MountedEquipment): InventoryControlGroupId {
    if (entry.isPhysicalWeapon()) return 'physical';
    if (entry.equipment instanceof WeaponEquipment) return 'ranged';
    return 'equipment';
}

export function inventoryTargetAllowsC3(target: InventoryControlRuntimeTarget): boolean {
    return target.tnCalculator?.indirectFire !== true;
}

export function inventoryTargetUsesC3(target: InventoryControlRuntimeTarget): boolean {
    return target.useC3 === true && inventoryTargetAllowsC3(target);
}

export function inventoryTargetRangeSelection(input: Pick<InventoryTargetNumberInput, 'entry' | 'category' | 'display' | 'extremeRange' | 'allowExtremeRange' | 'target' | 'selectedAmmo'>): InventoryTargetRangeSelection | null {
    const target = input.target;
    if (!target) return null;
    const c3Distance = inventoryTargetUsesC3(target) ? target.c3Distance ?? null : null;
    const rangeDistance = c3Distance === null ? target.distance : Math.min(target.distance, c3Distance);
    if (isPhysicalInventoryTargetNumberEntry(input.entry, input.category)) return { range: 'short', maximumRange: 'short', outOfRange: false, outOfLongRange: false, outOfExtremeRange: false, minimumRangeModifier: 0, distance: target.distance, c3Distance };

    if (isAerospaceWeaponAttack(input.entry)) {
        return aerospaceTargetRangeSelection(input.entry, target, input.selectedAmmo ?? null, c3Distance);
    }

    const artilleryMinimumDistance = input.selectedAmmo?.category === 'Artillery' ? 7 : null;
    if (artilleryMinimumDistance !== null && target.distance <= artilleryMinimumDistance) {
        return { range: 'short', maximumRange: 'short', outOfRange: true, outOfLongRange: true, outOfExtremeRange: false, minimumRangeModifier: 0, distance: target.distance, c3Distance };
    }

    const minimumRangeModifier = inventoryTargetMinimumRangeModifier(input.display.min, target.distance);

    const thresholds = (['short', 'medium', 'long'] as const)
        .map(range => ({ range, value: parseInventoryTargetNumberCell(input.display[range]) }))
        .filter((item): item is { range: InventoryRangeKey; value: number } => item.value !== null);
    if (thresholds.length === 0) return null;
    const normalMaximum = thresholds[thresholds.length - 1];
    const extremeRange = input.extremeRange ?? null;
    const extremeEnabled = input.allowExtremeRange === true
        && normalMaximum.range === 'long'
        && extremeRange !== null
        && extremeRange > normalMaximum.value;
    const maximumRange = extremeEnabled ? 'extreme' : normalMaximum.range;
    const maximumDistance = extremeEnabled ? extremeRange : normalMaximum.value;
    const outOfLongRange = target.distance > normalMaximum.value;
    const actualOutOfExtremeRange = extremeRange !== null && target.distance > extremeRange;
    const outOfRange = target.distance > maximumDistance;

    const closestUnitRange = thresholds.find(threshold => rangeDistance <= threshold.value)?.range ?? 'extreme';
    const range = c3Distance !== null && !outOfRange && outOfLongRange
        ? nextInventoryRangeBracket(closestUnitRange)
        : closestUnitRange;

    return {
        range,
        maximumRange,
        outOfRange,
        outOfLongRange,
        outOfExtremeRange: actualOutOfExtremeRange,
        minimumRangeModifier,
        distance: target.distance,
        c3Distance
    };
}

function isAerospaceWeaponAttack(entry: MountedEquipment): boolean {
    return entry.owner.getUnit?.().type === 'Aero' && entry.equipment instanceof WeaponEquipment;
}

function aerospaceTargetRangeSelection(
    entry: MountedEquipment,
    target: InventoryControlRuntimeTarget,
    selectedAmmo: AmmoEquipment | null,
    c3Distance: number | null
): InventoryTargetRangeSelection {
    const weapon = entry.equipment as WeaponEquipment;
    // Runtime targets do not yet model altitude or map scale. An Aero target is
    // therefore the explicit signal that the entered distance is an A2A range;
    // all other targets use MegaMek's zero-distance A2G bracket rule.
    const usesAerospaceDistance = target.unitType === 'aero';
    const actualDistance = usesAerospaceDistance ? target.distance : 0;
    const effectiveDistance = c3Distance === null || !usesAerospaceDistance
        ? actualDistance
        : Math.min(actualDistance, c3Distance);
    const limits = aerospaceRangeLimits(weapon);
    const actualRange = aerospaceRangeBracket(actualDistance, limits);
    const effectiveRange = aerospaceRangeBracket(effectiveDistance, limits);
    const maximumRange = aerospaceMaximumRangeBracket(weapon, selectedAmmo);
    const outOfExtremeRange = actualRange === null;
    const outOfRange = outOfExtremeRange
        || !isRangeBracketWithinMaximum(actualRange, maximumRange);

    return {
        range: actualRange === 'extreme' && c3Distance !== null
            ? nextInventoryRangeBracket(effectiveRange ?? 'extreme')
            : effectiveRange ?? 'extreme',
        maximumRange,
        outOfRange,
        outOfLongRange: actualRange === 'extreme' || outOfExtremeRange,
        outOfExtremeRange,
        minimumRangeModifier: 0,
        distance: target.distance,
        c3Distance
    };
}

function aerospaceMaximumRangeBracket(
    weapon: WeaponEquipment,
    selectedAmmo: AmmoEquipment | null
): InventoryControlRuntimeRangeKey {
    return effectiveAerospaceMaximumBracket(weapon, resolveAmmoWeaponProfile(selectedAmmo));
}

export function inventoryTargetNumberState(
    input: InventoryTargetNumberInput,
    rangeSelection: InventoryTargetRangeSelection | null = inventoryTargetRangeSelection(input)
): InventoryTargetNumberState {
    if (!rangeSelection) return { text: '', breakdown: null, rangeSelection };
    if (rangeSelection.outOfRange) return { text: 'X', breakdown: null, rangeSelection };
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
    const gameRules = input.gameRules ?? CORE_2026_GAME_RULES;
    const artilleryRangeModifier = input.selectedAmmo?.category === 'Artillery'
        ? gameRules.artilleryFlatRangeModifier : null;
    const rangeModifier = artilleryRangeModifier ?? inventoryTargetRangeModifier(rangeSelection.range);
    const c3Modifier = gameRules.resolveC3TargetingModifier(
        input.c3DegradationSource ?? 'none',
        c3RangeBracketImprovement(input, rangeSelection)
    );
    const c3ModifierValue = c3Modifier?.modifier ?? 0;
    const minimumRangeModifier = rangeSelection.minimumRangeModifier;
    const ammoToHitModifier = physical || !input.selectedAmmo
        ? 0
        : gameRules.resolveToHit({ subject: input.selectedAmmo, range: rangeSelection.range }).value;
    const numericAmmoToHitModifier = typeof ammoToHitModifier === 'number' ? ammoToHitModifier : 0;
    const heatFireModifier = physical ? 0 : input.heatFireModifier ?? 0;
    const terms: TooltipLine[] = [
        { label: skillLabel, value: skill.toString(), priority: SKILL_BREAKDOWN_PRIORITY }
    ];

    terms.push(...modifierTooltipLines(input.attackModifierBreakdown, entry => formatInventoryTargetSignedModifier(entry.modifier)));

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
        if (c3Modifier) {
            terms.push({
                label: c3Modifier.label,
                value: formatInventoryTargetSignedModifier(c3Modifier.modifier),
                ...(c3Modifier.weakened && { weakened: true })
            });
        }
    }
    if (minimumRangeModifier !== 0) {
        terms.push({ label: 'Minimum Range', value: formatInventoryTargetSignedModifier(minimumRangeModifier), weakened: true });
    }
    const hitModifierBreakdown = validatedToHitModifierBreakdown(input.hitModifier, input.hitModifierBreakdown);
    terms.push(...modifierTooltipLines(hitModifierBreakdown, entry => formatInventoryTargetSignedModifier(entry.modifier)));
    if (numericAmmoToHitModifier !== 0 && input.selectedAmmo) {
        terms.push({ label: `Ammo (${input.selectedAmmo.shortName})`, value: formatInventoryTargetSignedModifier(numericAmmoToHitModifier) });
    }
    if (heatFireModifier !== 0) {
        terms.push({
            label: 'Heat - Fire Modifier',
            value: formatInventoryTargetSignedModifier(heatFireModifier),
            weakened: true,
            kind: 'heat'
        });
    }

    const attackModifier = input.attackModifierBreakdown.reduce((total, entry) => total + entry.modifier, 0);
    const total = skill + attackModifier + target.tnModifier + rangeModifier + c3ModifierValue + minimumRangeModifier + input.hitModifier + numericAmmoToHitModifier + heatFireModifier;
    return {
        total,
        lines: [
            ...orderHitTargetTooltipLines(terms),
            { isBreak: true },
            { label: 'Total', value: total.toString(), isHeader: true }
        ],
        rangeSelection
    };
}

function c3RangeBracketImprovement(
    input: InventoryTargetNumberInput,
    effectiveSelection: InventoryTargetRangeSelection
): number {
    if (effectiveSelection.c3Distance === null) return 0;
    const target = input.target;
    if (!target) return 0;
    const actualSelection = inventoryTargetRangeSelection({
        ...input,
        target: { ...target, c3Distance: undefined }
    });
    if (actualSelection?.range === 'extreme' && !actualSelection.outOfRange) {
        return Math.max(0,
            c3RangeBracketIndex(actualSelection)
            - c3RangeBracketIndex(effectiveSelection));
    }
    const c3Selection = inventoryTargetRangeSelection({
        ...input,
        target: {
            ...target,
            distance: Math.min(target.distance, effectiveSelection.c3Distance),
            c3Distance: undefined
        }
    });
    if (!actualSelection || !c3Selection) return 0;

    return Math.max(0,
        c3RangeBracketIndex(actualSelection)
        - c3RangeBracketIndex(c3Selection));
}

function c3RangeBracketIndex(selection: InventoryTargetRangeSelection): number {
    return selection.outOfRange
        ? inventoryRangeBracketIndex(selection.maximumRange) + 1
        : inventoryRangeBracketIndex(selection.range);
}

function inventoryRangeBracketIndex(range: InventoryControlRuntimeRangeKey): number {
    switch (range) {
        case 'short': return 0;
        case 'medium': return 1;
        case 'long': return 2;
        case 'extreme': return 3;
    }
}

function nextInventoryRangeBracket(range: InventoryControlRuntimeRangeKey): InventoryControlRuntimeRangeKey {
    switch (range) {
        case 'short': return 'medium';
        case 'medium': return 'long';
        case 'long':
        case 'extreme': return 'extreme';
    }
}

export function isPhysicalInventoryTargetNumberEntry(entry: MountedEquipment, category?: string): boolean {
    return category === 'physical' || entry.isPhysicalWeapon();
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

