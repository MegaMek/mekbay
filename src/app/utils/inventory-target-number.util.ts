// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import type { MountedEquipment } from '../models/mounted-equipment.model';
import { isBombEquipment, WeaponEquipment, type AmmoEquipment, type AmmoType } from '../models/equipment.model';
import { resolveAmmoWeaponProfile } from '../models/ammo-weapon-profile.model';
import { getEffectiveInventoryControlCalculatorState, inventoryControlEntryAllowsTarget, inventoryControlTargetUsesIndirectFire, type InventoryControlRuntimeRangeKey, type InventoryControlRuntimeTarget } from '../models/inventory-control-runtime-state.model';
import { CORE_2026_GAME_RULES, separateHeatFireModifier, SKILL_BREAKDOWN_PRIORITY, type C3DegradationSource, type CBTGameRules, type TargetAttackTraits, type ToHitResolution } from '../models/rules/game-rules';
import { modifierTooltipLines, orderHitTargetTooltipLines } from './hit-target-tooltip.util';
import type { UnitModifierBreakdownEntry } from '../models/rules/unit-type-rules';
import type { InventoryControlDisplayData, InventoryControlGroupId, InventoryRangeKey } from './inventory-control.util';
import type { TooltipLine } from '../components/tooltip/tooltip.component';
import { aerospaceRangeBracket, aerospaceRangeLimits, effectiveAerospaceMaximumBracket, isRangeBracketWithinMaximum } from './aerospace-range.util';
import {
    calculateTargetTnModifierBreakdown,
    getTnTargetModifierGroupTotals,
    TN_INDIRECT_FIRE_MODIFIER,
    type TnTargetModifierBreakdownEntry,
    type TnTargetModifierGroupTotals,
    type TnTargetNumberCalculatorState,
    type TnRangeBracket,
    type TnTargetUnitType,
} from '../models/target-number-calculator.model';
import { UnitSummaryTypeGuard } from '../models/unit-summary-type-guard';
import type { WeaponType } from '../models/weapon-types.model';
import { getInventoryControlDamageTypes } from './inventory-control-damage.util';

export type EffectiveTargetModifierBreakdownEntry = TnTargetModifierBreakdownEntry & {
    ignored?: true;
};

const ARTILLERY_CANNON_AMMO_TYPES = new Set<AmmoType>([
    'SNIPER_CANNON',
    'THUMPER_CANNON',
    'LONG_TOM_CANNON',
]);
const FLAK_TARGET_UNIT_TYPES = new Set<TnTargetUnitType>(['aero', 'vtol-wige']);

export interface TargetGuidanceCapabilities {
    readonly semiGuided: boolean;
    readonly narcCapableAboveWater: boolean;
    readonly narcCapableUnderwater: boolean;
}

export type NarcGuidanceUnavailableReason = 'ecm-shielded' | 'water-layer';

export interface TargetGuidanceResolution {
    readonly semiGuided: boolean;
    readonly narc: boolean;
    readonly narcRelevant: boolean;
    readonly narcUnavailableReason: NarcGuidanceUnavailableReason | null;
}

interface WeaponTargetGuidanceResolution extends TargetGuidanceResolution {
    readonly noSpotter: boolean;
}

export function resolveTargetGuidance(
    calculator: TnTargetNumberCalculatorState | undefined,
    unitType: TnTargetUnitType | undefined,
    capabilities: TargetGuidanceCapabilities,
    gameRules: CBTGameRules = CORE_2026_GAME_RULES,
): TargetGuidanceResolution {
    const narcRelevant = calculator !== undefined
        && (calculator.narcAboveWater === true || calculator.narcUnderwater === true)
        && (capabilities.narcCapableAboveWater || capabilities.narcCapableUnderwater);
    const sameWaterLayer = calculator !== undefined
        && ((calculator.narcAboveWater === true && capabilities.narcCapableAboveWater)
            || (calculator.narcUnderwater === true && capabilities.narcCapableUnderwater));
    const narcUnavailableReason: NarcGuidanceUnavailableReason | null = !narcRelevant
        ? null
        : calculator.ecmShielded === true
            ? 'ecm-shielded'
            : !sameWaterLayer
                ? 'water-layer'
                : null;

    const narc = narcRelevant && narcUnavailableReason === null;
    return {
        semiGuided: calculator?.tagged === true
            && capabilities.semiGuided
            && gameRules.allowsTagDesignation(unitType),
        narc,
        narcRelevant,
        narcUnavailableReason,
    };
}

function resolveWeaponTargetGuidance(
    calculator: TnTargetNumberCalculatorState | undefined,
    unitType: TnTargetUnitType | undefined,
    entry: MountedEquipment,
    selectedAmmo: AmmoEquipment | null | undefined,
    gameRules: CBTGameRules,
): WeaponTargetGuidanceResolution {
    const narcCapable = selectedAmmo?.hasMunitionType('M_NARC_CAPABLE') === true;
    const weaponUnderwater = narcCapable && entry.owner.isEquipmentSubmerged(entry);
    const guidance = resolveTargetGuidance(calculator, unitType, {
        semiGuided: selectedAmmo?.hasMunitionType('M_SEMIGUIDED') === true,
        narcCapableAboveWater: narcCapable && !weaponUnderwater,
        narcCapableUnderwater: narcCapable && weaponUnderwater,
    }, gameRules);
    return {
        ...guidance,
        noSpotter: guidance.narc && calculator?.indirectFire === true,
    };
}

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
    /** Effective types after equipment handlers and the selected ammunition are resolved. */
    damageTypes?: readonly WeaponType[];
    target: InventoryControlRuntimeTarget | null;
    gunnerySkill: number;
    pilotingSkill: number;
    missingMovementModifier?: boolean;
    attackModifierBreakdown: readonly UnitModifierBreakdownEntry[];
    hitResolution: ToHitResolution;
    c3DegradationSource?: C3DegradationSource;
    gameRules?: CBTGameRules;
}

export type InventoryTargetDisplay = Pick<InventoryControlDisplayData, InventoryRangeKey | 'min'>;

export interface InventoryTargetToHitModifierContext {
    readonly target: InventoryControlRuntimeTarget;
    readonly entry: MountedEquipment;
    readonly selectedAmmo?: AmmoEquipment | null;
    readonly gameRules?: CBTGameRules;
    readonly rangeBracket?: TnRangeBracket;
    readonly effectiveDamageTypes?: readonly WeaponType[];
}

export function inventoryTargetCategory(entry: MountedEquipment): InventoryControlGroupId {
    if (entry.isPhysicalWeapon()) return 'physical';
    if (entry.equipment instanceof WeaponEquipment) return 'ranged';
    return 'equipment';
}

export function inventoryTargetAllowsC3(target: InventoryControlRuntimeTarget): boolean {
    return !inventoryControlTargetUsesIndirectFire(target);
}

export function inventoryTargetUsesC3(target: InventoryControlRuntimeTarget): boolean {
    return target.useC3 === true && inventoryTargetAllowsC3(target);
}

export function inventoryTargetEffectiveTnModifier(
    target: InventoryControlRuntimeTarget,
    entry: MountedEquipment,
    selectedAmmo?: AmmoEquipment | null,
    gameRules: CBTGameRules = CORE_2026_GAME_RULES,
    rangeBracket?: TnRangeBracket,
    effectiveDamageTypes?: readonly WeaponType[],
): number {
    const calculator = getEffectiveInventoryControlCalculatorState(target);
    if (!calculator) return target.tnModifier;

    const rawBreakdown = targetCalculatorBreakdown(target, gameRules);
    const effectiveBreakdown = compileInventoryTargetToHitModifiers({
        target,
        entry,
        selectedAmmo,
        gameRules,
        rangeBracket,
        effectiveDamageTypes,
    });
    return target.tnModifier
        + sumTargetModifiers(effectiveBreakdown)
        - sumTargetModifiers(rawBreakdown);
}

function targetCalculatorBreakdown(
    target: InventoryControlRuntimeTarget,
    gameRules: CBTGameRules,
    rangeBracket?: TnRangeBracket,
    attackerIsConventionalInfantry = false,
): TnTargetModifierBreakdownEntry[] {
    const calculator = getEffectiveInventoryControlCalculatorState(target);
    if (!calculator) return [];
    return calculateTargetTnModifierBreakdown({
        ...calculator,
        unitType: target.unitType,
        range: target.distance,
        rangeBracket,
        attackerIsConventionalInfantry,
    }, gameRules);
}

/** Compiles semantic target groups for equipment handlers; manual TN overrides intentionally have none. */
export function inventoryTargetModifierGroups(
    target: InventoryControlRuntimeTarget,
    gameRules: CBTGameRules = CORE_2026_GAME_RULES,
): TnTargetModifierGroupTotals | undefined {
    if (!getEffectiveInventoryControlCalculatorState(target)) return undefined;
    return getTnTargetModifierGroupTotals(targetCalculatorBreakdown(target, gameRules));
}

/** Converts equipment, ammunition, mode-derived types, and munition state into rules-profile input. */
export function inventoryTargetAttackTraits(
    entry: MountedEquipment,
    selectedAmmo?: AmmoEquipment | null,
    effectiveDamageTypes: readonly WeaponType[] = [],
): TargetAttackTraits {
    const weapon = entry.equipment instanceof WeaponEquipment ? entry.equipment : null;
    const artilleryCannon = weapon !== null && (
        ARTILLERY_CANNON_AMMO_TYPES.has(weapon.ammoType)
        || (weapon.hasFlag('F_ARTILLERY') && weapon.hasFlag('F_DIRECT_FIRE'))
    );
    const artillery = weapon?.hasFlag('F_ARTILLERY') === true
        || selectedAmmo?.category === 'Artillery';
    const bomb = (weapon !== null && isBombEquipment(weapon))
        || (selectedAmmo !== null && selectedAmmo !== undefined && isBombEquipment(selectedAmmo));
    const mekMortarAirburst = weapon?.hasFlag('F_MEK_MORTAR') === true
        && selectedAmmo?.hasMunitionType('M_AIRBURST') === true;
    const areaEffect = effectiveDamageTypes.includes('AE')
        || weapon?.getWeaponTypes().includes('AE') === true
        || selectedAmmo?.getWeaponTypes().includes('AE') === true
        || artillery
        || bomb
        || mekMortarAirburst;
    return { areaEffect, artillery, artilleryCannon, bomb, mekMortarAirburst };
}

export function compileInventoryTargetToHitModifiers(
    context: InventoryTargetToHitModifierContext,
): EffectiveTargetModifierBreakdownEntry[] {
    const {
        target,
        entry,
        selectedAmmo,
        gameRules = CORE_2026_GAME_RULES,
        rangeBracket,
        effectiveDamageTypes,
    } = context;
    const calculator = getEffectiveInventoryControlCalculatorState(target);
    const weaponTypes = effectiveDamageTypes ?? getInventoryControlDamageTypes(entry, selectedAmmo);
    const attacker = entry.owner.getUnit?.();
    const attackKind = entry.isPhysicalWeapon() ? 'physical' : 'ranged';
    const attackTraits = inventoryTargetAttackTraits(entry, selectedAmmo, weaponTypes);
    let breakdown = targetCalculatorBreakdown(
        target,
        gameRules,
        rangeBracket,
        UnitSummaryTypeGuard.isConventionalInfantry(attacker),
    )
        .map(modifier => markTargetModifierIgnored(
            modifier,
            (modifier.partialCoverSource === 'water' && !waterPartialCoverApplies(entry))
            || (modifier.id === 'battle-armor'
                && attackKind === 'ranged'
                && UnitSummaryTypeGuard.isInfantry(attacker))
            || (modifier.id === 'immobile' && !gameRules.attackBenefitsFromImmobile(attackTraits)),
        ));
    if (isInventoryTargetFlakAttack(calculator, target.unitType, weaponTypes)) {
        breakdown.push({ id: 'flak', label: 'Flak', modifier: -2 });
    }
    if (!calculator || !selectedAmmo) return breakdown;

    const guidance = resolveWeaponTargetGuidance(
        calculator,
        target.unitType,
        entry,
        selectedAmmo,
        gameRules,
    );
    if (guidance.noSpotter || (calculator.indirectFire && guidance.semiGuided)) {
        breakdown = breakdown.map(modifier => markTargetModifierIgnored(
            modifier,
            (guidance.narc && modifier.ignoredByNarcGuidance === true)
            || (guidance.semiGuided && modifier.ignoredBySemiGuidedGuidance === true),
        ));
    }
    if (guidance.semiGuided && !calculator.indirectFire && gameRules.semiGuidedIgnoresCover) {
        breakdown = breakdown.map(modifier => markTargetModifierIgnored(
            modifier,
            modifier.adjustmentGroup === 'partial-cover',
        ));
    }

    const guidanceModifiers: EffectiveTargetModifierBreakdownEntry[] = [];
    if (guidance.semiGuided) {
        const adjustment = ([
            { source: 'movement', group: 'target-movement' },
            { source: 'terrain', group: 'terrain' },
        ] as const).reduce((total, { source, group }) => {
            const modifierValue = breakdown
                .filter(modifier => modifier.ignored !== true && modifier.adjustmentGroup === group)
                .reduce((sum, modifier) => sum + modifier.modifier, 0);
            return total + gameRules.getSemiGuidedAdjustment(modifierValue, source);
        }, 0);
        const indirectFireAdjustment = calculator.indirectFire
            && gameRules.semiGuidedIgnoresIndirectFireModifier
            ? TN_INDIRECT_FIRE_MODIFIER
            : 0;
        const semiGuidedModifier = -(adjustment + indirectFireAdjustment);
        if (semiGuidedModifier !== 0) {
            guidanceModifiers.push({ id: 'semi-guided', label: 'Semi-Guided', modifier: semiGuidedModifier });
        }
    }
    if (guidance.narc && !calculator.indirectFire && gameRules.narcHomingTargetModifier !== 0) {
        guidanceModifiers.push({ id: 'narc', label: 'NARC', modifier: gameRules.narcHomingTargetModifier });
    }
    return [...breakdown, ...guidanceModifiers];
}

/** HAG and LB-X supply their separate -1 through the existing equipment/ammo to-hit paths. */
function isInventoryTargetFlakAttack(
    calculator: TnTargetNumberCalculatorState | undefined,
    targetUnitType: TnTargetUnitType | undefined,
    weaponTypes: readonly WeaponType[],
): boolean {
    return calculator?.isAirborne === true
        && targetUnitType !== undefined
        && FLAK_TARGET_UNIT_TYPES.has(targetUnitType)
        && weaponTypes.includes('F');
}

function markTargetModifierIgnored(
    modifier: EffectiveTargetModifierBreakdownEntry,
    ignored: boolean,
): EffectiveTargetModifierBreakdownEntry {
    return ignored && modifier.ignored !== true
        ? { ...modifier, ignored: true }
        : modifier;
}

function waterPartialCoverApplies(entry: MountedEquipment): boolean {
    if (entry.owner.turnState().submerged()) return false;
    if (!entry.isPhysicalWeapon()) return true;
    if (!entry.isIntrinsicPhysicalAttack()) return true; // Any carried physical weapon
    return entry.name.toLowerCase() === 'club';
}

function sumTargetModifiers(breakdown: readonly EffectiveTargetModifierBreakdownEntry[]): number {
    return breakdown.reduce(
        (total, modifier) => modifier.ignored === true ? total : total + modifier.modifier,
        0,
    );
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
    return UnitSummaryTypeGuard.isAero(entry.owner.getUnit?.())
        && entry.equipment instanceof WeaponEquipment;
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
    if (input.target && !inventoryControlEntryAllowsTarget(
        input.entry,
        input.target,
        input.selectedAmmo ?? null,
        input.gameRules ?? CORE_2026_GAME_RULES,
    )) {
        return { text: 'X', breakdown: null, rangeSelection };
    }
    if (!rangeSelection) return { text: '', breakdown: null, rangeSelection };
    if (rangeSelection.outOfRange) return { text: 'X', breakdown: null, rangeSelection };
    const { hitModifier } = separateHeatFireModifier(input.hitResolution);
    if (hitModifier === 'Vs' || hitModifier === '*') {
        return { text: hitModifier, breakdown: null, rangeSelection };
    }
    if (hitModifier === null) return { text: '', breakdown: null, rangeSelection };
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
    const { hitModifier, hitModifierBreakdown, heatFireModifier: separatedHeatFireModifier } = separateHeatFireModifier(input.hitResolution);
    if (typeof hitModifier !== 'number') return null;
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
    const heatFireModifier = physical ? 0 : separatedHeatFireModifier;
    const targetModifier = inventoryTargetEffectiveTnModifier(
        target,
        input.entry,
        input.selectedAmmo,
        gameRules,
        rangeSelection.range,
        input.damageTypes,
    );
    const terms: TooltipLine[] = [
        { label: skillLabel, value: skill.toString(), priority: SKILL_BREAKDOWN_PRIORITY }
    ];

    terms.push(...modifierTooltipLines(input.attackModifierBreakdown, entry => formatInventoryTargetSignedModifier(entry.modifier)));

    const calculator = getEffectiveInventoryControlCalculatorState(target);
    const guidance = resolveWeaponTargetGuidance(
        calculator,
        target.unitType,
        input.entry,
        input.selectedAmmo,
        gameRules,
    );
    if (calculator) {
        terms.push({ label: `Target ${target.letter}`, value: formatInventoryTargetSignedModifier(targetModifier), isHeader: true });
        terms.push(...compileInventoryTargetToHitModifiers({
            target,
            entry: input.entry,
            selectedAmmo: input.selectedAmmo,
            gameRules,
            rangeBracket: rangeSelection.range,
            effectiveDamageTypes: input.damageTypes,
        }).map(entry => ({
            label: entry.label,
            value: formatInventoryTargetSignedModifier(entry.modifier),
            nested: true,
            ...(entry.ignored && { ignored: true }),
        })));
    } else if (targetModifier !== 0) {
        terms.push({ label: `Target (${target.letter})`, value: formatInventoryTargetSignedModifier(targetModifier) });
    }
    if (guidance.noSpotter) {
        terms.push({ label: 'Spotter', value: 'Not required (NARC)' });
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
    const equipmentHitModifier = hitModifierBreakdown.reduce((total, entry) => total + entry.modifier, 0);
    const total = skill + attackModifier + targetModifier + rangeModifier + c3ModifierValue + minimumRangeModifier + equipmentHitModifier + numericAmmoToHitModifier + heatFireModifier;
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

