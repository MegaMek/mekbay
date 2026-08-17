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

export type MekCriticalChanceResult =
    | { readonly kind: 'none' }
    | { readonly kind: 'critical-hits'; readonly count: 1 | 2 | 3 }
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
}

export interface MekCriticalRollOptions {
    /** Disable transfer when a multi-hit sequence has already selected its target location. */
    readonly transfer?: boolean;
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
    readonly reason?: 'empty' | 'unhittable' | 'already-damaged';
    readonly explosion?: MekEquipmentExplosionResult;
    readonly pendingExplosion?: MekPendingEquipmentExplosion;
}

const PENDING_MEK_COMPONENT_EXPLOSION_STATE_KEY = 'pending_mek_component_explosion';

interface PendingMekComponentExplosion {
    readonly version: 1;
    readonly equipment: string;
    readonly rawDamage: number;
    readonly pilotHits: number;
    readonly sourceLocation: string;
    readonly consolidateImmediately: boolean;
    readonly triggerId: string;
    readonly triggerLocation?: string;
    readonly triggerSlot?: number;
    readonly destroyEntryIds?: readonly string[];
}

const resolvedComponentExplosions = new WeakMap<MountedEquipment, MekEquipmentExplosionResult>();

export function resolveMekCriticalChance(total: number, canBlowOff: boolean): MekCriticalChanceResult {
    if (total <= 7) return { kind: 'none' };
    if (total <= 9) return { kind: 'critical-hits', count: 1 };
    if (total <= 11) return { kind: 'critical-hits', count: 2 };
    return canBlowOff ? { kind: 'blown-off' } : { kind: 'critical-hits', count: 3 };
}

export function mekCriticalChanceCanBlowOff(location: string): boolean {
    return location === 'HD' || !MEK_TORSO_LOCATIONS.has(location);
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
        && criticalSlotDisplayName(slot) === equipment
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

    const groupDie = results[0];
    const slotDie = results[1];
    if (!isD6Result(groupDie) || !isD6Result(slotDie)) return null;
    return (groupDie <= 3 ? 0 : 6) + slotDie - 1;
}

export function hasRollableMekCriticalSlot(
    unit: CBTForceUnit,
    location: string,
    options: MekCriticalRollOptions = {},
): boolean {
    const targetLocation = options.transfer === false ? location : mekCriticalRollLocation(unit, location);
    return rollableMekCriticalSlotIndexes(unit, targetLocation).length > 0;
}

export function mekCriticalChanceModifiers(
    unit: CBTForceUnit,
    location: string,
    context: MekCriticalChanceContext = {},
): MekCriticalChanceModifier[] {
    const modifiers: MekCriticalChanceModifier[] = [];
    const unitData = unit.getUnit();
    const structureType = unitData.structureType?.trim().toLowerCase() ?? '';
    if (structureType.includes('reinforced')) {
        modifiers.push({ label: 'Reinforced structure', value: -1 });
    }
    if (unit.gameRules.id === 'tw'
        && unitData.features.some(feature => feature === 'Primitive Cockpit'
            || feature === 'Primitive Industrial Cockpit')) {
        modifiers.push({ label: 'Primitive Mek', value: 2 });
    }
    if (context.hardenedArmorApplies !== false
        && unitData.armorType.trim().toLowerCase().includes('hardened')) {
        const enabled = context.hardenedArmorApplies ?? hasRemainingMekArmor(unit, location);
        modifiers.push({
            label: 'Hardened armor in damaged facing',
            value: -2,
            optional: context.hardenedArmorApplies === undefined,
            enabled,
        });
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
 * Selects every valid slot with equal probability, then returns the dice faces
 * that represent that slot on the critical-hit table.
 */
export function randomValidMekCriticalRoll(
    unit: CBTForceUnit,
    location: string,
    random: () => number = Math.random,
    options: MekCriticalRollOptions = {},
): number[] | null {
    const targetLocation = options.transfer === false ? location : mekCriticalRollLocation(unit, location);
    const validSlots = rollableMekCriticalSlotIndexes(unit, targetLocation);
    if (validSlots.length === 0) return null;

    const slotIndex = validSlots[Math.floor(random() * validSlots.length)];
    if (mekCriticalRollDiceCount(targetLocation) === 1) return [slotIndex + 1];

    const sectionStart = slotIndex < 6 ? 1 : 4;
    const sectionDie = sectionStart + Math.floor(random() * 3);
    return [sectionDie, slotIndex % 6 + 1];
}

export function applyMekCriticalRoll(
    unit: CBTForceUnit,
    location: string,
    results: readonly number[],
    consolidateImmediately: boolean,
    options: MekCriticalRollOptions = {},
): MekCriticalRollOutcome | null {
    const targetLocation = options.transfer === false ? location : mekCriticalRollLocation(unit, location);
    const slotIndex = mekCriticalSlotIndexForRoll(targetLocation, results);
    if (slotIndex === null) return null;

    const slotNumber = slotIndex + 1;
    const slot = unit.getCritSlot(targetLocation, slotIndex);
    const rollability = criticalSlotRollability(unit, slot);
    if (!slot || rollability !== 'rollable') {
        return {
            applied: false,
            slotNumber,
            equipment: criticalSlotDisplayName(slot),
            armoredAbsorption: false,
            reason: rollability === 'rollable' ? 'empty' : rollability,
        };
    }

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

    if (equipment instanceof AmmoEquipment && criticalHitApplied) {
        slot.consumed = criticalSlotTotalAmmo(unit, slot, equipment);
    }
    if (delayedExplosion) {
        queueMekComponentExplosion(unit, slot, targetLocation, delayedExplosion, consolidateImmediately);
    }
    unit.applyHitToCritSlot(slot, 1, consolidateImmediately);

    const equipmentName = criticalSlotDisplayName(slot) ?? 'System';
    const explosion = delayedExplosion && consolidateImmediately
        ? takeResolvedComponentExplosion(delayedExplosion.source)
        : immediateExplosion && immediateExplosion.rawDamage > 0
            ? applyMekEquipmentExplosion(unit, targetLocation, immediateExplosion, consolidateImmediately)
            : undefined;
    const pendingExplosion = delayedExplosion && !consolidateImmediately
        ? { equipment: delayedExplosion.equipment, rawDamage: delayedExplosion.rawDamage }
        : undefined;

    return {
        applied: true,
        slotNumber,
        equipment: equipmentName,
        armoredAbsorption: !criticalHitApplied,
        ...(explosion && { explosion }),
        ...(pendingExplosion && { pendingExplosion }),
    };
}

function isD6Result(value: number | undefined): value is number {
    return Number.isInteger(value) && value! >= 1 && value! <= 6;
}

function rollableMekCriticalSlotIndexes(unit: CBTForceUnit, location: string): number[] {
    const slotCount = mekCriticalRollDiceCount(location) === 1 ? 6 : 12;
    return Array.from({ length: slotCount }, (_, slotIndex) => slotIndex)
        .filter(slotIndex => canApplyMekCriticalHitToSlot(unit, unit.getCritSlot(location, slotIndex)));
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
): 'rollable' | 'empty' | 'unhittable' | 'already-damaged' {
    if (!slot || (!slot.name?.trim() && !slot.eq)) return 'empty';
    if (slot.el && slot.el.getAttribute('hittable') !== '1') return 'unhittable';
    if ((slot.pendingHits ?? 0) !== 0) return 'already-damaged';

    const hits = slot.hits ?? 0;
    if (slot.armored && hits < 2 && !slot.destroyed && !slot.destroying) return 'rollable';
    const repeatable = repeatableSingleSlotCritical(unit, slot);
    if (repeatable) {
        return componentCriticalHitCount(unit, repeatable.entry) < repeatable.threshold
            ? 'rollable'
            : 'already-damaged';
    }
    if ((slot.hits ?? 0) > 0
        || !!slot.destroying
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

function criticalSlotDisplayName(slot: CriticalSlot | null): string | null {
    return slot?.eq?.name?.trim() || slot?.name?.trim() || null;
}

function isDestroyedCriticalSlot(slot: CriticalSlot): boolean {
    const hitsToDestroy = slot.armored ? 2 : 1;
    return !!slot.destroyed || !!slot.destroying || (slot.hits ?? 0) >= hitsToDestroy;
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
): void {
    const source = plan.source;
    const pending: PendingMekComponentExplosion = {
        version: 1,
        equipment: plan.equipment,
        rawDamage: plan.rawDamage,
        pilotHits: unit.gameRules.getMekInternalExplosionPilotHits(),
        sourceLocation,
        consolidateImmediately,
        triggerId: trigger.id,
        ...(trigger.loc && { triggerLocation: trigger.loc }),
        ...(trigger.slot !== undefined && { triggerSlot: trigger.slot }),
        ...(plan.destroyEntries && { destroyEntryIds: plan.destroyEntries.map(entry => entry.id) }),
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
            || parsed['version'] !== 1
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
                    || parsed['destroyEntryIds'].some(id => typeof id !== 'string' || id.length === 0)))) return null;
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

function criticalSlotTotalAmmo(unit: CBTForceUnit, slot: CriticalSlot, ammo: AmmoEquipment): number {
    const elementTotal = Number(slot.el?.getAttribute('totalAmmo') ?? 0);
    return Math.max(0, slot.totalAmmo || elementTotal || ammo.getShots(unit.gameRules, unit.getEquipmentRegistry()));
}

function ammoRackSize(ammo: AmmoEquipment): number {
    if (ammo.hasFlag('F_CAP_MISSILE') || ammo.ammoType === 'SCREEN_LAUNCHER') return 1;
    return Math.max(0, ammo.rackSize);
}

function ammoExplosionDamagePerShot(ammo: AmmoEquipment): number {
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

function applyMekEquipmentExplosion(
    unit: CBTForceUnit,
    sourceLocation: string,
    plan: MekImmediateCriticalExplosion,
    consolidateImmediately: boolean,
): MekEquipmentExplosionResult {
    const topology = getTopologyFor(unit.locations?.internal.keys() ?? []);
    // Explosion rules resolve damage points; composite structure marks two pips per point.
    const internalDamageMultiplier = isCompositeStructure(unit) ? 2 : 1;
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
        const remainingInternalCapacity = remainingInternal / internalDamageMultiplier;
        const torso = MEK_TORSO_LOCATIONS.has(location);
        const remainingArmor = Math.max(0, unit.getArmorPoints(location, torso) - unit.getArmorHits(location, torso));
        const resolution = unit.gameRules.resolveMekExplosionDamage({
            damage,
            protection,
            remainingInternal: remainingInternalCapacity,
            remainingArmor,
            originalArmor: unit.getArmorPoints(location, torso),
            torso,
            armorBlowoutPending,
        });
        const armorDamage = Math.min(remainingArmor, resolution.armorDamage);
        const internalDamage = Math.min(
            remainingInternal,
            resolution.internalDamage * internalDamageMultiplier,
        );

        if (armorDamage > 0) unit.addArmorHits(location, armorDamage, resolution.armorRear, consolidateImmediately);
        if (internalDamage > 0) unit.addInternalHits(location, internalDamage, consolidateImmediately);
        locations.push({ location, internalDamage, armorDamage, armorRear: resolution.armorRear, protection });

        const appliedInternalDamage = internalDamage / internalDamageMultiplier;
        const overflow = Math.max(0, resolution.internalDamage - appliedInternalDamage);
        if (overflow === 0 || resolution.stopsTransfer) break;
        location = topology[location as keyof typeof topology]?.transfersTo ?? null;
        damage = overflow;
    }

    const pilot = unit.getCrewMember?.(0);
    if (pilot && plan.pilotHits > 0) {
        pilot.setHits(pilot.getHits() + plan.pilotHits);
    }
    const automaticCritical = plan.automaticCriticalEntry
        ? applyAutomaticMekCritical(unit, plan.automaticCriticalEntry, consolidateImmediately)
        : undefined;

    return {
        equipment: plan.equipment,
        rawDamage: plan.rawDamage,
        pilotHits: plan.pilotHits,
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

function isCompositeStructure(unit: CBTForceUnit): boolean {
    return unit.getUnit().structureType?.trim().toLowerCase() === 'composite';
}

export function getMekExplosionProtection(unit: CBTForceUnit, location: string): MekExplosionProtection {
    if (hasOperationalProtection(unit, location, ['F_CASE_II'])) return 'case-ii';
    if (hasOperationalProtection(unit, location, ['F_CASE', 'F_CASE_P'])) return 'case';
    return 'none';
}

function hasOperationalProtection(
    unit: CBTForceUnit,
    location: string,
    flags: readonly EquipmentFlag[],
): boolean {
    const slots = unit.getCritSlots().filter(slot =>
        slot.loc === location && slot.eq?.hasAnyFlag([...flags]));
    if (slots.length > 0) return slots.some(slot => !isDestroyedCriticalSlot(slot));

    return unit.getUnit().comp.some(component =>
        component.eq?.hasAnyFlag([...flags])
        && component.l.split('/').includes(location));
}
