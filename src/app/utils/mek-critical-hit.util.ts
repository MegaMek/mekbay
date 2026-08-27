// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import type { CBTForceUnit } from '../models/cbt-force-unit.model';
import { AmmoEquipment } from '../models/equipment.model';
import type { EquipmentFlag } from '../models/equipment-flags.type';
import type { CriticalSlot } from '../models/force-serialization';
import { MountedWeapon, type MountedEquipment } from '../models/mounted-equipment.model';
import type { MekExplosionProtection, MekImmediateCriticalExplosion } from '../models/rules/game-rules';
import { getTopologyFor, LEG_LOCATIONS, MEK_TORSO_LOCATIONS } from '../models/entity/types';
import type { CriticalDelayedExplosion } from '../services/equipment-interaction-registry.service';
import { resolveInventoryControlWeaponDamage } from './inventory-control-damage.util';
import { getInventoryControlModeAmmoSummary } from './inventory-control.util';
import { mekStructureDamageCapacity, resolveMekStructureDamage } from './mek-structure-damage.util';

export type MekCriticalChanceResult =
    | { readonly kind: 'none' }
    | { readonly kind: 'critical-hits'; readonly count: 1 | 2 | 3 | 4 }
    | { readonly kind: 'blown-off' };

export interface MekCriticalChanceModifier {
    readonly label: string;
    readonly value: number;
    /** Optional modifiers can be corrected by the user when the attack context is not known. */
    readonly optional?: boolean;
    readonly enabled?: boolean;
}

export interface MekCriticalChanceContext {
    readonly hardenedArmorApplies?: boolean;
    readonly explosionProtection?: MekExplosionProtection;
}

export interface MekCriticalHitOptions {
    /** Disable transfer when a multi-hit sequence has already selected its target location. */
    readonly transfer?: boolean;
    /** In a destroyed location, resolve explosive-slot results and discard every other result. */
    readonly explosiveSlotsOnly?: boolean;
    /** Whether an explosive critical slot should also resolve its internal explosion. */
    readonly applyExplosion?: boolean;
    /** Pilot-damage event retained while this critical chain is paused. */
    readonly pilotDamageGroup?: string;
}

export type MekBlowOffResult =
    | { readonly kind: 'absorbed'; readonly equipment: 'Shoulder' | 'Hip' }
    | { readonly kind: 'blown-off' };

export interface MekExplosionLocationDamage {
    readonly location: string;
    readonly internalDamage: number;
    readonly armorDamage: number;
    readonly armorRear: boolean;
    readonly protection: MekExplosionProtection;
}

export interface MekEquipmentExplosionResult {
    readonly equipment: string;
    readonly rawDamage: number;
    readonly pilotHits: number;
    readonly locations: readonly MekExplosionLocationDamage[];
    readonly automaticCritical?: MekAutomaticCriticalResult;
}

export interface MekCriticalExplosionPreview {
    readonly timing: 'immediate' | 'phase-end';
    readonly equipment: string;
    readonly rawDamage: number;
    readonly pilotHits: number;
    readonly locations: readonly MekExplosionLocationDamage[];
    readonly automaticCriticalEquipment?: string;
}

export interface MekCriticalHitPreview {
    readonly applied: boolean;
    readonly slotNumber: number;
    readonly equipment: string | null;
    readonly armoredAbsorption: boolean;
    readonly reason?: MekCriticalRollReason;
    readonly explosion?: MekCriticalExplosionPreview;
}

export interface MekAutomaticCriticalResult {
    readonly equipment: string;
    readonly location: string;
    readonly slotNumber: number;
    readonly armoredAbsorption: boolean;
}

export interface MekPendingEquipmentExplosion {
    readonly equipment: string;
    readonly rawDamage: number;
}

export interface MekCriticalRollOutcome {
    readonly applied: boolean;
    readonly slotNumber: number;
    readonly equipment: string | null;
    readonly armoredAbsorption: boolean;
    readonly reason?: MekCriticalRollReason;
    readonly explosion?: MekEquipmentExplosionResult;
    readonly pendingExplosion?: MekPendingEquipmentExplosion;
}

export type MekCriticalRollReason = 'empty' | 'already-damaged' | 'non-explosive';
export type MekCriticalSlotRollability =
    | 'rollable'
    | 'empty'
    | 'unhittable'
    | 'already-damaged'
    | 'non-explosive';

const PENDING_MEK_COMPONENT_EXPLOSION_STATE_KEY = 'pending_mek_component_explosion';

interface PendingMekComponentExplosion {
    readonly equipment: string;
    readonly rawDamage: number;
    readonly pilotHits: number;
    readonly sourceLocation: string;
    readonly consolidateImmediately: boolean;
    readonly triggerId: string;
    readonly triggerLocation?: string;
    readonly triggerSlot?: number;
    readonly destroyEntryIds?: readonly string[];
    readonly pilotDamageGroup?: string;
}

const resolvedComponentExplosions = new WeakMap<MountedEquipment, MekEquipmentExplosionResult>();

export function resolveMekCriticalChance(
    total: number,
    canBlowOff: boolean,
    industrialMek: boolean,
): MekCriticalChanceResult {
    if (total <= 7) return { kind: 'none' };
    if (total <= 9) return { kind: 'critical-hits', count: 1 };
    if (total <= 11) return { kind: 'critical-hits', count: 2 };
    if (!industrialMek || total <= 13) {
        return canBlowOff ? { kind: 'blown-off' } : { kind: 'critical-hits', count: 3 };
    }
    return canBlowOff ? { kind: 'blown-off' } : { kind: 'critical-hits', count: 4 };
}

export function mekCriticalChanceCanBlowOff(location: string): boolean {
    return location === 'HD'
        || location === 'LA'
        || location === 'RA'
        || LEG_LOCATIONS.has(location);
}

export function usesIndustrialMekCriticalChanceTable(unit: CBTForceUnit): boolean {
    const subtype = unit.getUnit().subtype;
    return unit.gameRules.id === 'tw'
        && (subtype === 'Industrial Mek' || subtype === 'Quad Industrial Mek');
}

function usesPrimitiveMekCriticalChanceModifier(unit: CBTForceUnit): boolean {
    return unit.gameRules.id === 'tw'
        && unit.getUnit().features.some(feature =>
            feature === 'Primitive Cockpit' || feature === 'Primitive Industrial Cockpit');
}

export function applyMekBlowOff(
    unit: CBTForceUnit,
    location: string,
    consolidateImmediately: boolean,
): MekBlowOffResult {
    const equipment = location === 'LA' || location === 'RA'
        ? 'Shoulder'
        : LEG_LOCATIONS.has(location) ? 'Hip' : null;
    const armoredActuator = equipment === null ? null : unit.getCritSlots().find(slot =>
        slot.loc === location
        && (slot.eq?.name?.trim() || slot.name?.trim()) === equipment
        && slot.armored === true
        && (slot.hits ?? 0) === 0
        && (slot.pendingHits ?? 0) === 0
        && !slot.destroying
        && !slot.destroyed);

    if (armoredActuator && equipment !== null) {
        unit.applyHitToCritSlot(armoredActuator, 1, consolidateImmediately);
        return { kind: 'absorbed', equipment };
    }

    unit.setLocationCondition(location, 'blown-off', true, consolidateImmediately);
    return { kind: 'blown-off' };
}

export function mekCriticalRollDiceCount(location: string): 1 | 2 {
    return location === 'HD' || LEG_LOCATIONS.has(location) ? 1 : 2;
}

export function mekCriticalSlotIndexForRoll(location: string, results: readonly number[]): number | null {
    if (mekCriticalRollDiceCount(location) === 1) {
        const die = results[0];
        return isD6Result(die) ? die - 1 : null;
    }

    const sectionDie = results[0];
    const positionDie = results[1];
    if (!isD6Result(sectionDie) || !isD6Result(positionDie)) return null;

    // These are sequential selectors, not an arithmetic 2D6 roll: the first die
    // chooses slots 1–6 or 7–12, then the second die chooses a position in that section.
    const sectionOffset = sectionDie <= 3 ? 0 : 6;
    return sectionOffset + positionDie - 1;
}

export function hasRollableMekCriticalSlot(
    unit: CBTForceUnit,
    location: string,
    options: MekCriticalHitOptions = {},
): boolean {
    return getRollableMekCriticalSlots(unit, location, options).length > 0;
}

export function getRollableMekCriticalSlots(
    unit: CBTForceUnit,
    location: string,
    options: MekCriticalHitOptions = {},
): CriticalSlot[] {
    const targetLocation = options.transfer === false ? location : mekCriticalRollLocation(unit, location);
    return rollableMekCriticalSlotIndexes(unit, targetLocation, options)
        .flatMap(slotIndex => unit.getCritSlot(targetLocation, slotIndex) ?? []);
}

export function mekCriticalSlotRollability(
    unit: CBTForceUnit,
    location: string,
    slotIndex: number,
    options: Pick<MekCriticalHitOptions, 'explosiveSlotsOnly'> = {},
): MekCriticalSlotRollability {
    const candidate = criticalHitCandidate(unit, location, slotIndex, options);
    if (candidate === null) return 'unhittable';
    return 'slot' in candidate ? 'rollable' : candidate.reason ?? 'empty';
}

/** Returns one canonical set of table dice faces for a directly selected slot. */
export function mekCriticalRollForSlot(location: string, slotIndex: number): number[] {
    const slotCount = mekCriticalRollDiceCount(location) === 1 ? 6 : 12;
    if (!Number.isInteger(slotIndex) || slotIndex < 0 || slotIndex >= slotCount) {
        throw new RangeError(`Critical slot index must be between 0 and ${slotCount - 1}.`);
    }
    if (slotCount === 6) return [slotIndex + 1];
    return [slotIndex < 6 ? 1 : 4, slotIndex % 6 + 1];
}

export function mekCriticalChanceModifiers(
    unit: CBTForceUnit,
    location: string,
    context: MekCriticalChanceContext = {},
): MekCriticalChanceModifier[] {
    const modifiers: MekCriticalChanceModifier[] = [];
    const unitData = unit.getUnit();
    if (unit.getStructureKindAt(location) === 'reinforced') {
        modifiers.push({ label: 'Reinforced structure', value: -1 });
    }
    if (usesIndustrialMekCriticalChanceTable(unit)) {
        modifiers.push({ label: 'IndustrialMech', value: 2 });
    }
    if (usesPrimitiveMekCriticalChanceModifier(unit)) {
        modifiers.push({ label: 'Primitive/RetroTech Mek', value: 2 });
    }
    if (unit.gameRules.id === 'core2026' && context.explosionProtection === 'case-ii') {
        modifiers.push({ label: 'CASE II internal explosion', value: -1 });
    }
    if (context.hardenedArmorApplies !== false
        && unit.getArmorTypeAt(location) === 'HARDENED') {
        const facingUnknown = context.hardenedArmorApplies === undefined;
        modifiers.push(facingUnknown
            ? {
                label: 'Hardened armor in damaged facing',
                value: -2,
                optional: true,
                enabled: hasRemainingMekArmor(unit, location),
            }
            : { label: 'Hardened armor in damaged facing', value: -2 });
    }
    return modifiers;
}

function hasRemainingMekArmor(unit: CBTForceUnit, location: string): boolean {
    const facings = MEK_TORSO_LOCATIONS.has(location) ? [false, true] : [false];
    return facings.some(rear => unit.getArmorPoints(location, rear) - unit.getArmorHits(location, rear) > 0);
}

/** Returns the inward location used when the original location had no applicable slot at phase start. */
export function mekCriticalRollLocation(unit: CBTForceUnit, location: string): string {
    const topology = getTopologyFor(unit.locations?.internal.keys() ?? []);
    const visited = new Set<string>();
    let current = location;

    while (current !== 'HD'
        && current !== 'CT'
        && !visited.has(current)
        && !locationHadApplicableCriticalSlotAtPhaseStart(unit, current)) {
        visited.add(current);
        const next = topology[current as keyof typeof topology]?.transfersTo;
        if (!next) break;
        current = next;
    }
    return current;
}

/**
 * Preserves the critical table's roll order while skipping pointless rerolls:
 * choose the 1–6/7–12 section first, then choose a valid position in that section.
 * Destroyed locations are the exception: roll the complete table once so
 * non-explosive results can be discarded instead of rerolled.
 */
export function randomValidMekCriticalRoll(
    unit: CBTForceUnit,
    location: string,
    random: () => number = Math.random,
    options: MekCriticalHitOptions = {},
): number[] | null {
    const targetLocation = options.transfer === false ? location : mekCriticalRollLocation(unit, location);
    const validSlots = rollableMekCriticalSlotIndexes(unit, targetLocation, options);
    if (validSlots.length === 0) return null;

    if (options.explosiveSlotsOnly) {
        return Array.from(
            { length: mekCriticalRollDiceCount(targetLocation) },
            () => Math.floor(random() * 6) + 1,
        );
    }

    if (mekCriticalRollDiceCount(targetLocation) === 1) {
        const slotIndex = validSlots[Math.floor(random() * validSlots.length)];
        return [slotIndex + 1];
    }

    const firstSection = validSlots.filter(slotIndex => slotIndex < 6);
    const secondSection = validSlots.filter(slotIndex => slotIndex >= 6);
    const bothSectionsAvailable = firstSection.length > 0 && secondSection.length > 0;
    const sectionDie = bothSectionsAvailable
        ? Math.floor(random() * 6) + 1
        : firstSection.length > 0
            ? Math.floor(random() * 3) + 1
            : Math.floor(random() * 3) + 4;
    const section = sectionDie <= 3 ? firstSection : secondSection;
    const slotIndex = section[Math.floor(random() * section.length)];
    return [sectionDie, slotIndex % 6 + 1];
}

interface MekCriticalHitCandidate {
    readonly targetLocation: string;
    readonly slot: CriticalSlot;
    readonly slotNumber: number;
    readonly entry: MountedEquipment | null;
    readonly equipmentName: string;
    readonly criticalHitApplied: boolean;
    readonly delayedExplosion: CriticalDelayedExplosion | null;
    readonly immediateExplosion: MekImmediateCriticalExplosion | null;
}

type MekCriticalHitEffects = Pick<
    MekCriticalHitCandidate,
    'entry' | 'equipmentName' | 'criticalHitApplied' | 'delayedExplosion' | 'immediateExplosion'
>;

export function previewMekCriticalRoll(
    unit: CBTForceUnit,
    location: string,
    results: readonly number[],
    options: MekCriticalHitOptions = {},
): MekCriticalHitPreview | null {
    const candidate = criticalHitCandidateForRoll(unit, location, results, options);
    return candidate ? previewMekCriticalHitCandidate(unit, candidate) : null;
}

export function previewMekCriticalSlotHit(
    unit: CBTForceUnit,
    slot: CriticalSlot,
    options: Pick<MekCriticalHitOptions, 'explosiveSlotsOnly'> = {},
): MekCriticalHitPreview | null {
    const candidate = criticalHitCandidateForSlot(unit, slot, options);
    return candidate ? previewMekCriticalHitCandidate(unit, candidate) : null;
}

/** Returns the canonical mounted-equipment label for a critical slot. */
export function mekCriticalSlotDisplayName(unit: CBTForceUnit, slot: CriticalSlot): string {
    const fallback = slot.eq?.name?.trim() || slot.name?.trim() || 'Equipment';
    return inventoryEntryForCriticalSlot(unit, slot)?.getDisplayName(fallback) ?? fallback;
}

export function applyMekCriticalRoll(
    unit: CBTForceUnit,
    location: string,
    results: readonly number[],
    consolidateImmediately: boolean,
    options: MekCriticalHitOptions = {},
): MekCriticalRollOutcome | null {
    const candidate = criticalHitCandidateForRoll(unit, location, results, options);
    return candidate
        ? applyMekCriticalHitCandidate(
            unit,
            candidate,
            consolidateImmediately,
            options.applyExplosion !== false,
            options.pilotDamageGroup,
        )
        : null;
}

export function applyMekCriticalSlotHit(
    unit: CBTForceUnit,
    slot: CriticalSlot,
    consolidateImmediately: boolean,
    options: Pick<MekCriticalHitOptions, 'applyExplosion' | 'pilotDamageGroup'> = {},
): MekCriticalRollOutcome | null {
    const candidate = criticalHitCandidateForSlot(unit, slot);
    return candidate
        ? applyMekCriticalHitCandidate(
            unit,
            candidate,
            consolidateImmediately,
            options.applyExplosion !== false,
            options.pilotDamageGroup,
        )
        : null;
}

function criticalHitCandidateForRoll(
    unit: CBTForceUnit,
    location: string,
    results: readonly number[],
    options: MekCriticalHitOptions,
): MekCriticalHitCandidate | MekCriticalRollOutcome | null {
    const targetLocation = options.transfer === false ? location : mekCriticalRollLocation(unit, location);
    const slotIndex = mekCriticalSlotIndexForRoll(targetLocation, results);
    if (slotIndex === null) return null;
    return criticalHitCandidate(unit, targetLocation, slotIndex, options);
}

function criticalHitCandidateForSlot(
    unit: CBTForceUnit,
    slot: CriticalSlot,
    options: Pick<MekCriticalHitOptions, 'explosiveSlotsOnly'> = {},
): MekCriticalHitCandidate | MekCriticalRollOutcome | null {
    if (!slot.loc || slot.slot === undefined) return null;
    return criticalHitCandidate(unit, slot.loc, slot.slot, options);
}

function criticalHitCandidate(
    unit: CBTForceUnit,
    targetLocation: string,
    slotIndex: number,
    options: Pick<MekCriticalHitOptions, 'explosiveSlotsOnly'> = {},
): MekCriticalHitCandidate | MekCriticalRollOutcome | null {
    const slotNumber = slotIndex + 1;
    const slot = unit.getCritSlot(targetLocation, slotIndex);
    if (!slot) {
        return {
            applied: false,
            slotNumber,
            equipment: null,
            armoredAbsorption: false,
            reason: options.explosiveSlotsOnly ? 'non-explosive' : 'empty',
        };
    }

    const explosiveSlotsOnly = options.explosiveSlotsOnly === true;
    const baseRollability = criticalSlotRollability(unit, slot, explosiveSlotsOnly);
    if (baseRollability === 'unhittable') return null;
    if (!explosiveSlotsOnly && baseRollability !== 'rollable') {
        return {
            applied: false,
            slotNumber,
            equipment: criticalSlotDisplayName(unit, slot),
            armoredAbsorption: false,
            reason: baseRollability,
        };
    }

    const effects = criticalHitEffects(unit, slot);
    const explosive = (effects.delayedExplosion?.rawDamage ?? 0) > 0
        || (effects.immediateExplosion?.rawDamage ?? 0) > 0;
    const rollability = explosiveSlotsOnly && !explosive ? 'non-explosive' : baseRollability;
    if (rollability !== 'rollable') {
        return {
            applied: false,
            slotNumber,
            equipment: criticalSlotDisplayName(unit, slot),
            armoredAbsorption: false,
            reason: rollability,
        };
    }

    return {
        targetLocation,
        slot,
        slotNumber,
        ...effects,
    };
}

function criticalHitEffects(unit: CBTForceUnit, slot: CriticalSlot): MekCriticalHitEffects {
    const entry = inventoryEntryForCriticalSlot(unit, slot);
    const equipment = slot.eq;
    const criticalHitApplied = (slot.hits ?? 0) + 1 > (slot.armored ? 1 : 0);
    const ammoExplosion = explosiveAmmo(unit, slot);
    const delayedExplosionHandling = criticalHitApplied && entry
        ? unit.getCriticalDelayedExplosion(entry, {
            mountedCriticalSlots: candidate => currentCriticalSlots(unit, candidate).length,
            componentCriticalHits: candidate => componentCriticalHitCount(unit, candidate),
            effectiveMaximumWeaponDamage: candidate => effectiveMaximumWeaponDamage(unit, candidate),
        })
        : null;
    const delayedExplosion = delayedExplosionHandling?.explosion ?? null;
    const immediateExplosion = criticalHitApplied && !delayedExplosionHandling
        ? unit.gameRules.getMekImmediateCriticalExplosion({
            hitEntry: entry,
            hitEquipment: equipment ?? null,
            remainingAmmoDamage: ammoExplosion.damage,
            remainingAmmoShots: ammoExplosion.shots,
            mountedCriticalSlots: entry ? currentCriticalSlots(unit, entry).length : 0,
            previousComponentCriticalHits: entry ? componentCriticalHitCount(unit, entry) : 0,
            explosiveWeapon: entry instanceof MountedWeapon
                && unit.getEffectiveWeaponTypes(entry).has('X'),
            parentOperational: !!entry?.parent && unit.isEquipmentOperational(entry.parent),
            hasUsableAmmo: entry instanceof MountedWeapon && getInventoryControlModeAmmoSummary(
                entry,
                unit.getEquipmentRegistry(),
                unit.getInventoryControlRules(),
            ).remaining > 0,
        })
        : null;

    return {
        entry,
        equipmentName: criticalSlotDisplayName(unit, slot) ?? 'System',
        criticalHitApplied,
        delayedExplosion,
        immediateExplosion,
    };
}

function previewMekCriticalHitCandidate(
    unit: CBTForceUnit,
    candidate: MekCriticalHitCandidate | MekCriticalRollOutcome,
): MekCriticalHitPreview {
    if (!('slot' in candidate)) {
        return {
            applied: candidate.applied,
            slotNumber: candidate.slotNumber,
            equipment: candidate.equipment,
            armoredAbsorption: candidate.armoredAbsorption,
            ...(candidate.reason && { reason: candidate.reason }),
        };
    }

    const explosion = candidate.delayedExplosion
        ? previewMekEquipmentExplosion(unit, candidate.targetLocation, {
            equipment: candidate.delayedExplosion.equipment,
            rawDamage: candidate.delayedExplosion.rawDamage,
            pilotHits: unit.gameRules.getMekInternalExplosionPilotHits(),
        }, 'phase-end')
        : candidate.immediateExplosion && candidate.immediateExplosion.rawDamage > 0
            ? previewMekEquipmentExplosion(
                unit,
                candidate.targetLocation,
                candidate.immediateExplosion,
                'immediate',
            )
            : undefined;

    return {
        applied: true,
        slotNumber: candidate.slotNumber,
        equipment: candidate.equipmentName,
        armoredAbsorption: !candidate.criticalHitApplied,
        ...(explosion && { explosion }),
    };
}

function applyMekCriticalHitCandidate(
    unit: CBTForceUnit,
    candidate: MekCriticalHitCandidate | MekCriticalRollOutcome,
    consolidateImmediately: boolean,
    applyExplosion: boolean,
    pilotDamageGroup?: string,
): MekCriticalRollOutcome {
    if (!('slot' in candidate)) return candidate;

    const { slot, delayedExplosion, immediateExplosion } = candidate;
    if (applyExplosion && delayedExplosion) {
        queueMekComponentExplosion(
            unit,
            slot,
            candidate.targetLocation,
            delayedExplosion,
            consolidateImmediately,
            pilotDamageGroup,
        );
    }
    unit.applyHitToCritSlot(slot, 1, consolidateImmediately);

    const explosion = applyExplosion && delayedExplosion && consolidateImmediately
        ? takeResolvedComponentExplosion(delayedExplosion.source)
        : applyExplosion && immediateExplosion && immediateExplosion.rawDamage > 0
            ? applyMekEquipmentExplosion(
                unit,
                candidate.targetLocation,
                immediateExplosion,
                consolidateImmediately,
                pilotDamageGroup,
            )
            : undefined;
    const pendingExplosion = applyExplosion && delayedExplosion && !consolidateImmediately
        ? { equipment: delayedExplosion.equipment, rawDamage: delayedExplosion.rawDamage }
        : undefined;

    return {
        applied: true,
        slotNumber: candidate.slotNumber,
        equipment: candidate.equipmentName,
        armoredAbsorption: !candidate.criticalHitApplied,
        ...(explosion && { explosion }),
        ...(pendingExplosion && { pendingExplosion }),
    };
}

function isD6Result(value: number | undefined): value is number {
    return Number.isInteger(value) && value! >= 1 && value! <= 6;
}

function rollableMekCriticalSlotIndexes(
    unit: CBTForceUnit,
    location: string,
    options: Pick<MekCriticalHitOptions, 'explosiveSlotsOnly'> = {},
): number[] {
    const slotCount = mekCriticalRollDiceCount(location) === 1 ? 6 : 12;
    return Array.from({ length: slotCount }, (_, slotIndex) => slotIndex)
        .filter(slotIndex => {
            const slot = unit.getCritSlot(location, slotIndex);
            if (!options.explosiveSlotsOnly) return canApplyMekCriticalHitToSlot(unit, slot);
            const candidate = criticalHitCandidate(unit, location, slotIndex, options);
            return candidate !== null && 'slot' in candidate;
        });
}

function locationHadApplicableCriticalSlotAtPhaseStart(unit: CBTForceUnit, location: string): boolean {
    const slotCount = mekCriticalRollDiceCount(location) === 1 ? 6 : 12;
    return Array.from({ length: slotCount }, (_, slotIndex) => unit.getCritSlot(location, slotIndex))
        .some(slot => criticalSlotWasApplicableAtPhaseStart(unit, slot));
}

function criticalSlotWasApplicableAtPhaseStart(unit: CBTForceUnit, slot: CriticalSlot | null): boolean {
    if (!slot || (!slot.name?.trim() && !slot.eq)) return false;
    if (slot.el && slot.el.getAttribute('hittable') !== '1') return false;
    const repeatable = repeatableSingleSlotCritical(unit, slot);
    if (repeatable) {
        if (slot.destroying && !slot.destroyed) return true;
        return componentCriticalHitCount(unit, repeatable.entry) < repeatable.threshold;
    }
    if (slot.destroyed) return false;
    if (slot.destroying) return true;
    return (slot.hits ?? 0) < (slot.armored ? 2 : 1);
}

export function canApplyMekCriticalHitToSlot(unit: CBTForceUnit, slot: CriticalSlot | null): boolean {
    return criticalSlotRollability(unit, slot) === 'rollable';
}

function criticalSlotRollability(
    unit: CBTForceUnit,
    slot: CriticalSlot | null,
    allowStructurallyDestroying = false,
): 'rollable' | 'empty' | 'unhittable' | 'already-damaged' {
    if (!slot || (!slot.name?.trim() && !slot.eq)) return 'empty';
    if (slot.el && slot.el.getAttribute('hittable') !== '1') return 'unhittable';
    if ((slot.pendingHits ?? 0) !== 0) return 'already-damaged';

    const hits = slot.hits ?? 0;
    if (slot.armored && hits < 2 && !slot.destroyed
        && (!slot.destroying || allowStructurallyDestroying)) return 'rollable';
    const repeatable = repeatableSingleSlotCritical(unit, slot);
    if (repeatable) {
        return componentCriticalHitCount(unit, repeatable.entry) < repeatable.threshold
            ? 'rollable'
            : 'already-damaged';
    }
    if ((slot.hits ?? 0) > 0
        || (!!slot.destroying && !allowStructurallyDestroying)
        || !!slot.destroyed) return 'already-damaged';
    return 'rollable';
}

function repeatableSingleSlotCritical(
    unit: CBTForceUnit,
    slot: CriticalSlot,
): { readonly entry: MountedEquipment; readonly threshold: number } | null {
    const threshold = unit.rules.mountedCriticalDamageDestructionThreshold(slot.eq ?? null);
    if (threshold <= 1) return null;
    const entry = inventoryEntryForCriticalSlot(unit, slot);
    if (!entry) return null;
    if (currentCriticalSlots(unit, entry).length !== 1) return null;
    return { entry, threshold };
}

function criticalSlotDisplayName(unit: CBTForceUnit, slot: CriticalSlot | null): string | null {
    if (!slot) return null;
    const fallback = slot.eq?.name?.trim() || slot.name?.trim() || '';
    const entry = inventoryEntryForCriticalSlot(unit, slot);
    return entry?.getDisplayName(fallback).trim() || fallback || null;
}

function inventoryEntryForCriticalSlot(unit: CBTForceUnit, slot: CriticalSlot): MountedEquipment | null {
    return unit.getInventory().find(entry => entry.critSlots?.some(candidate => sameCriticalSlot(candidate, slot))) ?? null;
}

function currentCriticalSlots(unit: CBTForceUnit, entry: MountedEquipment): CriticalSlot[] {
    return entry.critSlots?.flatMap(slot => unit.findCurrentCriticalSlot(slot) ?? []) ?? [];
}

function componentCriticalHitCount(unit: CBTForceUnit, entry: MountedEquipment): number {
    return currentCriticalSlots(unit, entry).reduce(
        (total, slot) => total + Math.max(0, (slot.hits ?? 0) - (slot.armored ? 1 : 0)),
        0,
    );
}

function sameCriticalSlot(left: CriticalSlot, right: CriticalSlot): boolean {
    if (left.loc && right.loc && left.slot !== undefined && right.slot !== undefined) {
        return left.loc === right.loc && left.slot === right.slot;
    }
    return !!left.id && left.id === right.id;
}

function explosiveAmmo(unit: CBTForceUnit, slot: CriticalSlot): { readonly shots: number; readonly damage: number } {
    const equipment = slot.eq;
    if (!(equipment instanceof AmmoEquipment)) return { shots: 0, damage: 0 };
    const shots = Math.max(0, criticalSlotTotalAmmo(unit, slot, equipment) - (slot.consumed ?? 0));
    return {
        shots,
        damage: shots * ammoRackSize(equipment) * ammoExplosionDamagePerShot(equipment),
    };
}

function effectiveMaximumWeaponDamage(unit: CBTForceUnit, source: MountedWeapon): number {
    return resolveInventoryControlWeaponDamage(source, {
        selectedRange: null,
        selectedAmmo: unit.getInventoryControlSelectedAmmo(source),
        equipmentCatalog: unit.getEquipmentRegistry(),
    }, unit.getInventoryControlRules())?.damage.maximum ?? 0;
}

function queueMekComponentExplosion(
    unit: CBTForceUnit,
    trigger: CriticalSlot,
    sourceLocation: string,
    plan: CriticalDelayedExplosion,
    consolidateImmediately: boolean,
    pilotDamageGroup?: string,
): void {
    const source = plan.source;
    const pending: PendingMekComponentExplosion = {
        equipment: plan.equipment,
        rawDamage: plan.rawDamage,
        pilotHits: unit.gameRules.getMekInternalExplosionPilotHits(),
        sourceLocation,
        consolidateImmediately,
        triggerId: trigger.id,
        ...(trigger.loc && { triggerLocation: trigger.loc }),
        ...(trigger.slot !== undefined && { triggerSlot: trigger.slot }),
        ...(plan.destroyEntries && { destroyEntryIds: plan.destroyEntries.map(entry => entry.id) }),
        ...(pilotDamageGroup && { pilotDamageGroup }),
    };
    resolvedComponentExplosions.delete(source);
    if (source.setState(PENDING_MEK_COMPONENT_EXPLOSION_STATE_KEY, JSON.stringify(pending))) {
        unit.setInventoryEntry(source);
    }
}

/** Resolves an explosion queued exclusively by the automated Mek critical-roll workflow. */
export function resolvePendingMekComponentExplosion(
    source: MountedEquipment,
    suppressExplosion: boolean,
): MekEquipmentExplosionResult | null {
    const serialized = source.states.get(PENDING_MEK_COMPONENT_EXPLOSION_STATE_KEY);
    if (serialized === undefined) return null;

    const pending = parsePendingMekComponentExplosion(serialized);
    cancelPendingMekComponentExplosion(source);
    if (!pending || suppressExplosion) return null;

    const trigger = pendingTriggerSlot(source.owner, pending);
    if (!trigger || !isPendingCriticalHit(trigger)) return null;

    if (pending.destroyEntryIds?.length) {
        destroyMountedEntries(
            source.owner,
            pending.destroyEntryIds,
            trigger.destroying!,
            pending.consolidateImmediately,
        );
    }
    const explosion = applyMekEquipmentExplosion(
        source.owner,
        pending.sourceLocation,
        {
            equipment: pending.equipment,
            rawDamage: pending.rawDamage,
            pilotHits: pending.pilotHits,
        },
        pending.consolidateImmediately,
        pending.pilotDamageGroup,
    );
    resolvedComponentExplosions.set(source, explosion);
    return explosion;
}

/** Cancels an automated critical-roll explosion without undoing the critical hit itself. */
export function cancelPendingMekComponentExplosion(source: MountedEquipment): void {
    resolvedComponentExplosions.delete(source);
    if (source.deleteState(PENDING_MEK_COMPONENT_EXPLOSION_STATE_KEY)) {
        source.owner.setInventoryEntry(source);
    }
}

function takeResolvedComponentExplosion(source: MountedEquipment): MekEquipmentExplosionResult | undefined {
    const explosion = resolvedComponentExplosions.get(source);
    resolvedComponentExplosions.delete(source);
    return explosion;
}

function pendingTriggerSlot(
    unit: CBTForceUnit,
    pending: PendingMekComponentExplosion,
): CriticalSlot | null {
    if (pending.triggerLocation !== undefined && pending.triggerSlot !== undefined) {
        return unit.getCritSlot(pending.triggerLocation, pending.triggerSlot);
    }
    return unit.getCritSlots().find(slot => slot.id === pending.triggerId) ?? null;
}

function destroyMountedEntries(
    unit: CBTForceUnit,
    entryIds: readonly string[],
    timestamp: number,
    consolidateImmediately: boolean,
): void {
    const entries = entryIds.flatMap(id => unit.getInventory().find(entry => entry.id === id) ?? []);
    const slotsByEntry = entries.map(entry => ({ entry, slots: currentCriticalSlots(unit, entry) }));
    let criticalSlotsChanged = false;

    for (const { slots } of slotsByEntry) {
        for (const slot of slots) {
            const hits = Math.max(slot.hits ?? 0, slot.armored ? 2 : 1);
            if (slot.hits !== hits) {
                slot.hits = hits;
                criticalSlotsChanged = true;
            }
            if (slot.destroying === undefined) {
                slot.destroying = timestamp;
                criticalSlotsChanged = true;
            }
        }
    }
    if (criticalSlotsChanged) {
        unit.setCritSlots([...unit.getCritSlots()]);
    }

    for (const { entry, slots } of slotsByEntry) {
        if (slots.length > 0 || !entry.setPendingDestroyed(true)) continue;
        if (consolidateImmediately) entry.commitPendingDestroyed();
        unit.setInventoryEntry(entry);
    }
}

function parsePendingMekComponentExplosion(value: string): PendingMekComponentExplosion | null {
    try {
        const parsed: unknown = JSON.parse(value);
        if (!isRecord(parsed)
            || typeof parsed['equipment'] !== 'string'
            || typeof parsed['rawDamage'] !== 'number'
            || !Number.isFinite(parsed['rawDamage'])
            || parsed['rawDamage'] < 0
            || typeof parsed['pilotHits'] !== 'number'
            || !Number.isInteger(parsed['pilotHits'])
            || parsed['pilotHits'] < 0
            || typeof parsed['sourceLocation'] !== 'string'
            || typeof parsed['consolidateImmediately'] !== 'boolean'
            || typeof parsed['triggerId'] !== 'string'
            || (parsed['triggerLocation'] !== undefined && typeof parsed['triggerLocation'] !== 'string')
            || (parsed['triggerSlot'] !== undefined
                && (!Number.isInteger(parsed['triggerSlot']) || (parsed['triggerSlot'] as number) < 0))
            || (parsed['destroyEntryIds'] !== undefined
                && (!Array.isArray(parsed['destroyEntryIds'])
                    || parsed['destroyEntryIds'].some(id => typeof id !== 'string' || id.length === 0)))
            || (parsed['pilotDamageGroup'] !== undefined
                && (typeof parsed['pilotDamageGroup'] !== 'string'
                    || parsed['pilotDamageGroup'].length === 0
                    || parsed['pilotDamageGroup'].length > 80))) return null;
        return parsed as unknown as PendingMekComponentExplosion;
    } catch {
        return null;
    }
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null;
}

function isPendingCriticalHit(slot: CriticalSlot): boolean {
    return slot.destroying !== undefined
        && !slot.destroyed
        && (slot.hits ?? 0) >= (slot.armored ? 2 : 1);
}

export function criticalSlotTotalAmmo(unit: CBTForceUnit, slot: CriticalSlot, ammo: AmmoEquipment): number {
    const elementTotal = Number(slot.el?.getAttribute('totalAmmo') ?? 0);
    return Math.max(0, slot.totalAmmo || elementTotal || ammo.getShots(unit.gameRules, unit.getEquipmentRegistry()));
}

export function ammoRackSize(ammo: AmmoEquipment): number {
    if (ammo.hasFlag('F_CAP_MISSILE') || ammo.ammoType === 'SCREEN_LAUNCHER') return 1;
    return Math.max(0, ammo.rackSize);
}

export function ammoExplosionDamagePerShot(ammo: AmmoEquipment): number {
    if (ammo.ammoType === 'SCREEN_LAUNCHER') return 15;
    if (ammo.ammoType === 'TASER') return 6;
    if (ammo.ammoType === 'MEK_MORTAR') {
        return ammo.hasMunitionType('M_AIRBURST')
            || ammo.hasMunitionType('M_FLARE')
            || ammo.hasMunitionType('M_SMOKE_WARHEAD')
            ? 1
            : 2;
    }
    return ammo.damagePerShot + (
        ammo.hasMunitionType('M_DEAD_FIRE') || ammo.hasMunitionType('M_TANDEM_CHARGE') ? 1 : 0
    );
}

function previewMekEquipmentExplosion(
    unit: CBTForceUnit,
    sourceLocation: string,
    plan: MekImmediateCriticalExplosion,
    timing: MekCriticalExplosionPreview['timing'],
): MekCriticalExplosionPreview {
    return {
        timing,
        equipment: plan.equipment,
        rawDamage: plan.rawDamage,
        pilotHits: plan.pilotHits,
        locations: resolveMekExplosionLocationDamage(unit, sourceLocation, plan),
        ...(plan.automaticCriticalEntry && {
            automaticCriticalEquipment: plan.automaticCriticalEntry.getDisplayName(
                plan.automaticCriticalEntry.name,
            ),
        }),
    };
}

function resolveMekExplosionLocationDamage(
    unit: CBTForceUnit,
    sourceLocation: string,
    plan: MekImmediateCriticalExplosion,
): MekExplosionLocationDamage[] {
    const topology = getTopologyFor(unit.locations?.internal.keys() ?? []);
    const locations: MekExplosionLocationDamage[] = [];
    const visited = new Set<string>();
    let location: string | null = sourceLocation;
    let damage = plan.rawDamage;
    let armorBlowoutPending = false;

    while (location && damage > 0 && !visited.has(location)) {
        visited.add(location);
        const protection = getMekExplosionProtection(unit, location);
        if (unit.gameRules.id === 'core2026' && protection === 'none' && damage > 20) {
            armorBlowoutPending = true;
        }
        const remainingInternal = Math.max(0, unit.getInternalPoints(location) - unit.getInternalHits(location));
        const structureKind = unit.getStructureKindAt(location);
        const torso = MEK_TORSO_LOCATIONS.has(location);
        const remainingArmor = Math.max(0, unit.getArmorPoints(location, torso) - unit.getArmorHits(location, torso));
        const resolution = unit.gameRules.resolveMekExplosionDamage({
            damage,
            protection,
            remainingInternal: mekStructureDamageCapacity(remainingInternal, structureKind),
            remainingArmor,
            originalArmor: unit.getArmorPoints(location, torso),
            torso,
            armorBlowoutPending,
        });
        const armorDamage = Math.min(remainingArmor, resolution.armorDamage);
        const structureDamage = resolveMekStructureDamage(
            resolution.internalDamage,
            remainingInternal,
            structureKind,
        );

        locations.push({
            location,
            internalDamage: structureDamage.internalDamage,
            armorDamage,
            armorRear: resolution.armorRear,
            protection,
        });

        const overflow = structureDamage.overflowDamage;
        if (overflow === 0 || resolution.stopsTransfer) break;
        location = topology[location as keyof typeof topology]?.transfersTo ?? null;
        damage = overflow;
    }

    return locations;
}

function applyMekEquipmentExplosion(
    unit: CBTForceUnit,
    sourceLocation: string,
    plan: MekImmediateCriticalExplosion,
    consolidateImmediately: boolean,
    pilotDamageGroup?: string,
): MekEquipmentExplosionResult {
    const locations = resolveMekExplosionLocationDamage(unit, sourceLocation, plan);
    for (const damage of locations) {
        if (damage.armorDamage > 0) {
            unit.addArmorHits(
                damage.location,
                damage.armorDamage,
                damage.armorRear,
                consolidateImmediately,
            );
        }
        if (damage.internalDamage > 0) {
            unit.addInternalHits(
                damage.location,
                damage.internalDamage,
                consolidateImmediately,
                {
                    explosionProtection: damage.protection,
                    ...(pilotDamageGroup && { pilotDamageGroup }),
                },
            );
        }
    }

    const pilotHits = plan.pilotHits > 0
        ? unit.applyInternalExplosionCrewHits(plan.pilotHits, pilotDamageGroup)
        : 0;
    const automaticCritical = plan.automaticCriticalEntry
        ? applyAutomaticMekCritical(unit, plan.automaticCriticalEntry, consolidateImmediately)
        : undefined;

    return {
        equipment: plan.equipment,
        rawDamage: plan.rawDamage,
        pilotHits,
        locations,
        ...(automaticCritical && { automaticCritical }),
    };
}

function applyAutomaticMekCritical(
    unit: CBTForceUnit,
    entry: MountedEquipment,
    consolidateImmediately: boolean,
): MekAutomaticCriticalResult | undefined {
    const slot = currentCriticalSlots(unit, entry)
        .sort((left, right) => (left.slot ?? 0) - (right.slot ?? 0))
        .find(candidate => criticalSlotRollability(unit, candidate) === 'rollable');
    if (!slot || !slot.loc || slot.slot === undefined) return undefined;

    // Component-generated automatic criticals bypass component armor.
    const damage = Math.max(1, (slot.armored ? 2 : 1) - (slot.hits ?? 0));
    unit.applyHitToCritSlot(slot, damage, consolidateImmediately);
    return {
        equipment: entry.getDisplayName(entry.name),
        location: slot.loc,
        slotNumber: slot.slot + 1,
        armoredAbsorption: false,
    };
}

export function getMekExplosionProtection(unit: CBTForceUnit, location: string): MekExplosionProtection {
    if (hasOperationalProtection(unit, location, ['F_CASE_II'])) return 'case-ii';
    if (hasOperationalProtection(unit, location, ['F_CASE', 'F_CASE_P'])) return 'case';
    return 'none';
}

/** Resolves a heat-triggered ammo-bin explosion without pretending it was a critical-hit roll. */
export function applyMekHeatAmmoExplosion(
    unit: CBTForceUnit,
    slotId: string,
    pilotHitGroup?: string,
): MekEquipmentExplosionResult | null {
    const slot = unit.getCritSlots().find(candidate => candidate.id === slotId);
    const ammo = slot?.eq;
    if (!slot || !(ammo instanceof AmmoEquipment) || !slot.loc || slot.destroyed || slot.destroying) return null;

    const ammoState = explosiveAmmo(unit, slot);
    const plan = unit.gameRules.getMekImmediateCriticalExplosion({
        hitEntry: inventoryEntryForCriticalSlot(unit, slot),
        hitEquipment: ammo,
        remainingAmmoDamage: ammoState.damage,
        remainingAmmoShots: ammoState.shots,
        mountedCriticalSlots: 1,
        previousComponentCriticalHits: 0,
        explosiveWeapon: false,
        parentOperational: false,
        hasUsableAmmo: false,
    });
    if (!plan || plan.rawDamage <= 0) return null;

    const hitsRequired = Math.max(1, (slot.armored ? 2 : 1) - (slot.hits ?? 0));
    unit.applyHitToCritSlot(slot, hitsRequired, true);
    return applyMekEquipmentExplosion(unit, slot.loc, plan, true, pilotHitGroup);
}

function hasOperationalProtection(
    unit: CBTForceUnit,
    location: string,
    flags: readonly EquipmentFlag[],
): boolean {
    const slots = unit.getCritSlots().filter(slot =>
        slot.loc === location && slot.eq?.hasAnyFlag([...flags]));
    // Pending critical/location damage remains operational until the phase commits.
    if (slots.length > 0) return slots.some(slot => !slot.destroyed);

    return unit.getUnit().comp.some(component =>
        component.eq?.hasAnyFlag([...flags])
        && component.l.split('/').includes(location));
}
