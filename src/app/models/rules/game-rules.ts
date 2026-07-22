/*
 * Copyright (C) 2026 The MegaMek Team. All Rights Reserved.
 *
 * This file is part of MekBay.
 */

import type { CBTForceUnit } from '../cbt-force-unit.model';
import { AmmoEquipment, Equipment, WeaponEquipment, type RangeBrackets } from '../equipment.model';
import type { InventoryControlRuntimeRangeKey } from '../inventory-control-runtime-state.model';
import { MountedEquipment } from '../mounted-equipment.model';

export type HitModifier = number | 'Vs' | '*' | null;
export type ToHitAdjustment =
    | { readonly kind: 'replace-base'; readonly value: number | readonly number[] }
    | { readonly kind: 'add'; readonly value: number; readonly weakened?: boolean }
    | { readonly kind: 'unsupported' };

export interface ToHitRequest {
    subject: Equipment | MountedEquipment;
    range?: RangeBrackets | null;
    stateModifier?: number;
    stateWeakened?: boolean;
    adjustments?: readonly ToHitAdjustment[];
}

export interface ToHitResolution {
    readonly profile: readonly number[];
    readonly value: HitModifier;
    readonly changed: boolean;
    readonly weakened: boolean;
}

const TO_HIT_MODIFIER_RANGE_INDEX: Record<RangeBrackets, number> = {
    short: 0,
    medium: 1,
    long: 2,
    extreme: 2,
};

export abstract class CBTGameRules {
    abstract readonly id: 'core2026' | 'tw';
    abstract readonly escalatingFailureLabels: readonly string[];
    abstract readonly usesUacJamming: boolean;
    abstract readonly supportsSkidding: boolean;
    abstract readonly supportsSecondaryTargetSideBack: boolean;
    abstract readonly supportsLargeTarget: boolean;
    abstract readonly artilleryFlatRangeModifier: number | null;
    abstract readonly supportsApolloSaturationMode: boolean;

    resolveToHit(request: ToHitRequest): ToHitResolution {
        const entry = request.subject instanceof MountedEquipment ? request.subject : null;
        const equipment = entry?.equipment ?? (request.subject instanceof Equipment ? request.subject : null);
        const adjustments = request.adjustments ?? [];
        const unsupported = adjustments.some(adjustment => adjustment.kind === 'unsupported');
        const replacement = adjustments.find(adjustment => adjustment.kind === 'replace-base');
        const hasBaseReplacement = replacement !== undefined;
        if (unsupported || (entry && !this.supportsToHit(entry) && !hasBaseReplacement)) return emptyToHitResolution();

        if (entry?.physical) {
            const physicalValue = this.physicalBaseHitModifiers[entry.name.toLowerCase()] ?? null;
            if (physicalValue === null || physicalValue === 'Vs') {
                return { profile: [], value: physicalValue, changed: false, weakened: request.stateWeakened ?? false };
            }
            return this.composeToHit([physicalValue], request, adjustments);
        }
        if (!equipment) return emptyToHitResolution();

        const rulesProfile = this.getRulesProfile(equipment);
        const baseProfile = replacement?.kind === 'replace-base'
            ? normalizeToHitProfile(replacement.value)
            : rulesProfile;
        return this.composeToHit(baseProfile, request, adjustments, rulesProfile);
    }

    getAmmoShots(ammo: AmmoEquipment): number {
        return ammo.shots;
    }

    getAmmoKgPerShot(ammo: AmmoEquipment): number {
        if (ammo.hasCustomKgPerShot) return ammo.kgPerShot;
        const shots = this.getAmmoShots(ammo);
        return shots > 0 ? 1000 / shots : 0;
    }

    calculateTagBVCost(_unit: CBTForceUnit): number {
        return 0;
    }

    protected abstract readonly physicalBaseHitModifiers: Readonly<Record<string, number | 'Vs'>>;

    protected getRulesProfile(equipment: Equipment): number[] {
        return normalizeToHitProfile(equipment.toHitModifier);
    }

    private supportsToHit(entry: MountedEquipment): boolean {
        const equipment = entry.equipment;
        if (entry.physical) return true;
        if (!equipment) return false;
        if (!(equipment instanceof WeaponEquipment)
            && !equipment.flags.has('F_CLUB')
            && !equipment.flags.has('F_HAND_WEAPON')) return false;
        if (equipment instanceof WeaponEquipment
            && equipment.hasNoRange()
            && !equipment.flags.has('F_CLUB')
            && !equipment.flags.has('F_HAND_WEAPON')
            && equipment.weapon.ammoType !== 'MML'
            && (!entry.parent?.equipment
                || (entry.parent.equipment instanceof WeaponEquipment && entry.parent.equipment.hasNoRange()))) return false;
        return true;
    }

    private composeToHit(
        baseProfile: readonly number[],
        request: ToHitRequest,
        adjustments: readonly ToHitAdjustment[],
        rulesProfile: readonly number[] = baseProfile
    ): ToHitResolution {
        const stateModifier = request.stateModifier ?? 0;
        const adjustmentModifier = adjustments.reduce(
            (total, adjustment) => total + (adjustment.kind === 'add' ? adjustment.value : 0),
            0
        );
        const totalModifier = stateModifier + adjustmentModifier;
        const profile = baseProfile.map(value => value + totalModifier);
        const baseValue = valueAtRange(baseProfile, request.range);
        const value = !request.range && profile.length > 1 ? '*' : valueAtRange(profile, request.range);
        const selectedValue = valueAtRange(profile, request.range);
        const changed = !sameProfile(profile, rulesProfile);
        const weakened = request.stateWeakened === true
            || adjustments.some(adjustment => adjustment.kind === 'add' && adjustment.weakened === true)
            || selectedValue > baseValue;
        return { profile, value, changed, weakened };
    }
}

export class GameRules extends CBTGameRules {
    readonly id = 'core2026' as const;
    readonly physicalBaseHitModifiers = {
        punch: -1,
        kick: -1,
        'kick [talons]': -1,
        club: -1,
        push: -1,
        frenzy: 0,
        charge: 'Vs',
        'death from above': 'Vs',
        'dfa [talons]': 'Vs',
        'airmech ram': 'Vs',
    } as const;
    readonly escalatingFailureLabels = ['3+', '5+', '7+', '10+', '11+'] as const;
    readonly usesUacJamming = false;
    readonly supportsSkidding = false;
    readonly supportsSecondaryTargetSideBack = false;
    readonly supportsLargeTarget = true;
    readonly artilleryFlatRangeModifier = 4;
    readonly supportsApolloSaturationMode = true;
    
    protected override getRulesProfile(equipment: Equipment): number[] {
        // Claw and Lance has 0 hitmod instead of 1
        if (equipment.flags.has('S_CLAW') || equipment.flags.has('S_LANCE')) {
            return [0];
        }

        const modifiers = super.getRulesProfile(equipment);
        // MRM doesn't have the +1 but 0
        return equipment instanceof WeaponEquipment && equipment.hasFlag('F_MRM')
            ? modifiers.map(modifier => modifier - 1)
            : modifiers;
    }

    override getAmmoShots(ammo: AmmoEquipment): number {
        // Precision ammo divisor went from 0.5 to 0.8 (so, x1.6)
        return ammo.hasMunitionType('M_PRECISION')
            ? ammo.shots * 1.6
            : ammo.shots;
    }
}

export class TWGameRules extends CBTGameRules {
    readonly id = 'tw' as const;
    readonly physicalBaseHitModifiers = {
        punch: 0,
        kick: -2,
        'kick [talons]': -2,
        club: -1,
        push: -1,
        frenzy: 0,
        charge: 'Vs',
        'death from above': 'Vs',
        'dfa [talons]': 'Vs',
        'airmech ram': 'Vs',
    } as const;
    readonly escalatingFailureLabels = ['3+', '5+', '7+', '11+', '!!'] as const;
    readonly usesUacJamming = true;
    readonly supportsSkidding = true;
    readonly supportsSecondaryTargetSideBack = true;
    readonly supportsLargeTarget = false;
    readonly artilleryFlatRangeModifier = null;
    readonly supportsApolloSaturationMode = false;

    /* TARGET ACQUISITION GEAR (TAG)
    Any unit in the battle force equipped with TAG, Light TAG or a C3 Master Computer (flag F_TAG)
    adds BV equal to the BV of each ton of semi-guided (flag M_SEMIGUIDED or M_HOMING) LRM ammunition 
    carried in the force (use the ammo BV for the appropriate-size LRM launcher). 
    Units whose only such piece of equipment is rear-mounted add half the BV instead. */
    override calculateTagBVCost(unit: CBTForceUnit): number {
        const components = unit.getUnit().comp;
        const hasTag = components.some(c => c.eq?.hasFlag('F_TAG'));
        if (!hasTag) return 0; // No TAG, no BV
        // Calculate total BV of semi-guided LRM ammo across all units in the force.
        // We must scan inventory/crits (not unit blueprints) because custom ammo may be loaded.
        const allUnits = unit.force.units();
        let totalSemiGuidedBV = 0;
        for (const forceUnit of allUnits) {
            if (!forceUnit.isLoaded()) continue; // Ensure unit is loaded so that inventory and crits are available
            if (forceUnit.getUnit().type === 'Mek') {
                // Check crit slots (Mek-type units where ammo swapping happens on crits)
                const crits = forceUnit.getCritSlots();
                for (const crit of crits) {
                    if (crit.eq instanceof AmmoEquipment 
                        && (crit.eq.hasMunitionType('M_SEMIGUIDED') || crit.eq.hasMunitionType('M_HOMING'))) {
                        const ammo = crit.eq;
                        const forceUnitComps = forceUnit.getUnit().comp;
                        // Check if the unit carrying this ammo has any weapon that can use it (matching ammoType and rackSize)
                        const hasMatchingWeapon = forceUnitComps.some(c =>
                            c.eq instanceof WeaponEquipment &&
                            c.eq.ammoType === ammo.ammoType &&
                            c.eq.rackSize === ammo.rackSize
                        );
                        if (!hasMatchingWeapon) continue; // No weapon can use this ammo, skip
                        // Determine if at least one matching weapon is front-mounted
                        const hasNonRearWeapon = forceUnitComps.some(c =>
                            c.eq instanceof WeaponEquipment &&
                            c.eq.ammoType === ammo.ammoType &&
                            c.eq.rackSize === ammo.rackSize &&
                            !c.rear
                        );
                        const multiplier = hasNonRearWeapon ? 1 : 0.5;
                        totalSemiGuidedBV += Math.round(multiplier * crit.eq.bv);
                    }
                }
            } else {
                // Check direct inventory entries (vehicles, ProtoMeks, etc.)
                const inventory = forceUnit.getInventory();
                for (const item of inventory) {
                    if (item.equipment instanceof AmmoEquipment 
                    && (item.equipment.hasMunitionType('M_SEMIGUIDED') || item.equipment.hasMunitionType('M_HOMING'))) {
                        totalSemiGuidedBV += item.equipment.bv;
                    }
                }
            }
        }
        return Math.round(totalSemiGuidedBV);
    };
}

export const CORE_2026_GAME_RULES = new GameRules();
export const TW_GAME_RULES = new TWGameRules();

function normalizeToHitProfile(value: number | readonly number[]): number[] {
    if (typeof value === 'number') return [value];
    return value.length > 0 ? [...value] : [0];
}

function valueAtRange(profile: readonly number[], range?: RangeBrackets | null): number {
    const index = range ? TO_HIT_MODIFIER_RANGE_INDEX[range] : 0;
    return profile[Math.min(index, profile.length - 1)] ?? 0;
}

function sameProfile(left: readonly number[], right: readonly number[]): boolean {
    return left.length === right.length && left.every((value, index) => value === right[index]);
}

function emptyToHitResolution(): ToHitResolution {
    return { profile: [], value: null, changed: false, weakened: false };
}