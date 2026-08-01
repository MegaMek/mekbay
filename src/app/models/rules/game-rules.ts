/*
 * Copyright (C) 2026 The MegaMek Team. All Rights Reserved.
 *
 * This file is part of MekBay.
 */

import type { CBTForceUnit } from '../cbt-force-unit.model';
import { AmmoEquipment, Equipment, WeaponEquipment, type RangeBrackets } from '../equipment.model';
import type { InventoryControlRuntimeTarget } from '../inventory-control-runtime-state.model';
import { MountedEquipment } from '../mounted-equipment.model';

export type HitModifier = number | 'Vs' | '*' | null;
export interface ToHitModifierBreakdownEntry {
    readonly label: string;
    readonly modifier: number;
    readonly negative?: boolean;
    readonly kind?: 'heat';
    readonly designBaseline?: boolean;
}
export type ToHitAdjustment =
    | { readonly kind: 'replace-base'; readonly value: number | readonly number[]; readonly label?: string }
    | { readonly kind: 'add'; readonly value: number; readonly weakened?: boolean; readonly label?: string; readonly breakdown?: readonly ToHitModifierBreakdownEntry[] }
    | { readonly kind: 'unsupported' };

export interface ToHitRequest {
    subject: Equipment | MountedEquipment;
    range?: RangeBrackets | null;
    stateModifier?: number;
    stateModifierBreakdown?: readonly ToHitModifierBreakdownEntry[];
    stateWeakened?: boolean;
    adjustments?: readonly ToHitAdjustment[];
}

export interface ToHitResolution {
    readonly profile: readonly number[];
    readonly value: HitModifier;
    readonly changed: boolean;
    readonly weakened: boolean;
    readonly modifierBreakdown: readonly ToHitModifierBreakdownEntry[];
}

export interface ToHitHeatSeparation {
    readonly hitModifier: HitModifier;
    readonly hitModifierBreakdown: readonly ToHitModifierBreakdownEntry[];
    readonly heatFireModifier: number;
}

export type C3DegradationSource = 'none' | 'unit' | 'network-member';
export type C3DegradationLabel = 'DEGRADED' | 'JAMMED';

export interface C3TargetingResolution {
    readonly target: InventoryControlRuntimeTarget;
    readonly degradationSource: C3DegradationSource;
}

const TO_HIT_MODIFIER_RANGE_INDEX: Record<RangeBrackets, number> = {
    short: 0,
    medium: 1,
    long: 2,
    extreme: 2,
};

export function validatedToHitModifierBreakdown(
    modifier: number,
    breakdown: readonly ToHitModifierBreakdownEntry[] | undefined,
    fallbackLabel = 'Hit Modifier'
): ToHitModifierBreakdownEntry[] {
    if (breakdown?.reduce((total, entry) => total + entry.modifier, 0) === modifier) return [...breakdown];
    return modifier === 0 ? [] : [{ label: fallbackLabel, modifier }];
}

export function separateHeatFireModifier(resolution: ToHitResolution): ToHitHeatSeparation {
    const heatFireModifier = resolution.modifierBreakdown.reduce(
        (total, entry) => total + (entry.kind === 'heat' ? entry.modifier : 0),
        0
    );
    return {
        hitModifier: typeof resolution.value === 'number'
            ? resolution.value - heatFireModifier
            : resolution.value,
        hitModifierBreakdown: resolution.modifierBreakdown.filter(entry => entry.kind !== 'heat'),
        heatFireModifier
    };
}

export abstract class CBTGameRules {
    abstract readonly id: 'core2026' | 'tw';
    abstract readonly c3DegradationLabel: C3DegradationLabel;
    abstract readonly escalatingFailureLabels: readonly string[];
    abstract readonly usesUacJamming: boolean;
    abstract readonly supportsSkidding: boolean;
    abstract readonly supportsSecondaryTargetSideBack: boolean;
    abstract readonly supportsLargeTarget: boolean;
    abstract readonly artilleryFlatRangeModifier: number | null;
    abstract readonly supportsApolloSaturationMode: boolean;
    abstract readonly supportsBombastLaserRules: boolean;

    abstract resolveC3Targeting(target: InventoryControlRuntimeTarget, degradationSource: C3DegradationSource): C3TargetingResolution;
    abstract resolveC3TargetingModifier(degradationSource: C3DegradationSource, rangeBracketImprovement: number): ToHitModifierBreakdownEntry | null;

    resolveToHit(request: ToHitRequest): ToHitResolution {
        const entry = request.subject instanceof MountedEquipment ? request.subject : null;
        const equipment = entry?.equipment ?? (request.subject instanceof Equipment ? request.subject : null);
        const adjustments = request.adjustments ?? [];
        const unsupported = adjustments.some(adjustment => adjustment.kind === 'unsupported');
        const replacement = adjustments.find(adjustment => adjustment.kind === 'replace-base');
        const hasBaseReplacement = replacement !== undefined;
        if (unsupported || (entry && !this.supportsToHit(entry) && !hasBaseReplacement)) return emptyToHitResolution();

        if (entry?.isIntrinsicPhysicalAttack()) {
            const physicalValue = this.physicalBaseHitModifiers[entry.name.toLowerCase()] ?? null;
            if (physicalValue === null || physicalValue === 'Vs') {
                return { profile: [], value: physicalValue, changed: false, weakened: request.stateWeakened ?? false, modifierBreakdown: [] };
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
        if (entry.isPhysicalWeapon()) return true;
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
        const replacement = adjustments.find(adjustment => adjustment.kind === 'replace-base');
        const value = !request.range && profile.length > 1 ? '*' : valueAtRange(profile, request.range);
        const selectedValue = valueAtRange(profile, request.range);
        const changed = !sameProfile(profile, rulesProfile);
        const stateBreakdown = validatedToHitModifierBreakdown(stateModifier, request.stateModifierBreakdown);
        const designModifier = stateBreakdown.reduce(
            (total, entry) => total + (entry.designBaseline === true ? entry.modifier : 0),
            0
        );
        const weakened = request.stateWeakened === true
            || adjustments.some(adjustment => adjustment.kind === 'add' && adjustment.weakened === true)
            || stateBreakdown.some(entry => entry.negative === true && entry.modifier > 0)
            || selectedValue > baseValue + designModifier;
        const modifierBreakdown = typeof value === 'number'
            ? this.resolveModifierBreakdown(baseValue, stateModifier, request.stateModifierBreakdown, adjustments, replacement?.label)
            : [];
        return { profile, value, changed, weakened, modifierBreakdown };
    }

    private resolveModifierBreakdown(
        baseValue: number,
        stateModifier: number,
        stateBreakdown: readonly ToHitModifierBreakdownEntry[] | undefined,
        adjustments: readonly ToHitAdjustment[],
        replacementLabel?: string
    ): ToHitModifierBreakdownEntry[] {
        const result: ToHitModifierBreakdownEntry[] = [];
        if (baseValue !== 0) result.push({ label: replacementLabel ?? 'Hit Modifier', modifier: baseValue });
        result.push(...validatedToHitModifierBreakdown(stateModifier, stateBreakdown));
        for (const adjustment of adjustments) {
            if (adjustment.kind !== 'add') continue;
            result.push(...validatedToHitModifierBreakdown(adjustment.value, adjustment.breakdown, adjustment.label));
        }
        return result;
    }
}

export class GameRules extends CBTGameRules {
    readonly id = 'core2026' as const;
    readonly c3DegradationLabel = 'DEGRADED' as const;
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
    readonly supportsBombastLaserRules = true;

    override resolveC3Targeting(target: InventoryControlRuntimeTarget, degradationSource: C3DegradationSource): C3TargetingResolution {
        return { target, degradationSource };
    }

    override resolveC3TargetingModifier(degradationSource: C3DegradationSource, rangeBracketImprovement: number): ToHitModifierBreakdownEntry | null {
        return degradationSource !== 'none' && rangeBracketImprovement > 0
            ? { label: 'ECM', modifier: rangeBracketImprovement, negative: true }
            : null;
    }

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
    readonly c3DegradationLabel = 'JAMMED' as const;
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
    readonly supportsBombastLaserRules = false;

    override resolveC3Targeting(target: InventoryControlRuntimeTarget, degradationSource: C3DegradationSource): C3TargetingResolution {
        return {
            target: degradationSource === 'none' || target.c3Distance === undefined
                ? target
                : { ...target, c3Distance: undefined },
            degradationSource
        };
    }

    override resolveC3TargetingModifier(_degradationSource: C3DegradationSource, _rangeBracketImprovement: number): ToHitModifierBreakdownEntry | null {
        return null;
    }

    /* TARGET ACQUISITION GEAR (TAG)
    Any unit in the battle force equipped with TAG, Light TAG or a C3 Master Computer (flag F_TAG)
    adds BV equal to the BV of each ton of semi-guided (flag M_SEMIGUIDED or M_HOMING) LRM ammunition 
    carried in the force (use the ammo BV for the appropriate-size LRM launcher). */
    override calculateTagBVCost(unit: CBTForceUnit): number {
        const tagCount = unit.getOperationalMountedEquipmentByFlag('F_TAG').length;
        if (tagCount === 0) return 0;

        const guidedAmmoBV = unit.force.units().reduce((total, forceUnit) =>
            total + this.calculateGuidedAmmoBV(forceUnit), 0);
        return Math.round(guidedAmmoBV * tagCount);
    }

    private calculateGuidedAmmoBV(unit: CBTForceUnit): number {
        if (!unit.isLoaded()) return 0;
        const launchers = unit.getInventory().filter(entry =>
            entry.equipment instanceof WeaponEquipment && !unit.isEquipmentUnavailable(entry));
        if (launchers.length === 0) return 0;

        if (unit.getUnit().type === 'Mek') {
            return unit.getCritSlots().reduce((total, crit) => {
                const ammo = crit.eq;
                if (!(ammo instanceof AmmoEquipment)
                    || !isTagGuidedAmmo(ammo)
                    || unit.isEquipmentUnavailable(crit)
                    || !hasUsableAmmo(crit.totalAmmo, crit.consumed)
                    || !hasCompatibleLauncher(ammo, launchers)
                    || !ammo.hasFixedBV()) return total;
                return total + ammo.bv;
            }, 0);
        }

        return unit.getInventory().reduce((total, mount) => {
            const ammo = resolveMountedAmmo(unit, mount);
            if (!(ammo instanceof AmmoEquipment)
                || !isTagGuidedAmmo(ammo)
                || unit.isEquipmentUnavailable(mount)
                || !hasUsableAmmo(mount.totalAmmo, mount.consumed)
                || !hasCompatibleLauncher(ammo, launchers)
                || !ammo.hasFixedBV()) return total;
            return total + ammo.bv;
        }, 0);
    }
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
    return { profile: [], value: null, changed: false, weakened: false, modifierBreakdown: [] };
}

function isTagGuidedAmmo(ammo: AmmoEquipment): boolean {
    return ammo.hasMunitionType('M_SEMIGUIDED') || ammo.hasMunitionType('M_HOMING');
}

function hasUsableAmmo(totalAmmo: number | undefined, consumed: number | undefined): boolean {
    return totalAmmo === undefined || totalAmmo > (consumed ?? 0);
}

function hasCompatibleLauncher(ammo: AmmoEquipment, launchers: readonly MountedEquipment[]): boolean {
    return launchers.some(mount => mount.equipment instanceof WeaponEquipment
        && mount.equipment.ammoType === ammo.ammoType
        && mount.equipment.rackSize === ammo.rackSize);
}

function resolveMountedAmmo(unit: CBTForceUnit, mount: MountedEquipment): AmmoEquipment | null {
    if (!(mount.equipment instanceof AmmoEquipment)) return null;

    const selectedAmmo = mount.ammo
        ? unit.getEquipmentRegistry().findEquipment(mount.ammo)
        : null;
    return selectedAmmo instanceof AmmoEquipment ? selectedAmmo : mount.equipment;
}