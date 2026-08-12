// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import type { CBTForceUnit } from '../cbt-force-unit.model';
import { AmmoEquipment, Equipment, WeaponEquipment, type RangeBrackets } from '../equipment.model';
import type { EquipmentRegistry } from '../equipment-lookup';
import type { InventoryControlRuntimeTarget } from '../inventory-control-runtime-state.model';
import { MountedEquipment } from '../mounted-equipment.model';

export type HitModifier = number | 'Vs' | '*' | null;

export const SKILL_BREAKDOWN_PRIORITY = -100; // Priority for display order in tooltips
export const ATTACK_MOVEMENT_MODIFIER_BREAKDOWN_PRIORITY = -50; // Priority for display order in tooltips

export interface ToHitModifierBreakdownEntry {
    readonly label: string;
    readonly modifier: number;
    readonly priority?: number;
    readonly weakened?: boolean;
    readonly kind?: 'heat';
}

export type ToHitAdjustment =
    | { readonly kind: 'replace-base'; readonly value: number | readonly number[]; readonly label: string }
    | { readonly kind: 'add'; readonly modifier: number; readonly label: string; readonly weakened?: boolean }
    | { readonly kind: 'unsupported' };

export interface ToHitRequest {
    subject: Equipment | MountedEquipment;
    range?: RangeBrackets | null;
    stateModifiers?: readonly ToHitModifierBreakdownEntry[];
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

export interface PhysicalLocationRow {
    readonly roll: number;
    readonly punchLeftSide: string;
    readonly punchFrontRear: string;
    readonly punchRightSide: string;
    readonly kickLeftSide: string;
    readonly kickFrontRear: string;
    readonly kickRightSide: string;
}

const CORE_2026_PHYSICAL_LOCATION_ROWS: readonly PhysicalLocationRow[] = [
    { roll: 1, punchLeftSide: 'LT', punchFrontRear: 'RA', punchRightSide: 'RT', kickLeftSide: 'LL', kickFrontRear: 'RL', kickRightSide: 'RL' },
    { roll: 2, punchLeftSide: 'LT', punchFrontRear: 'RT', punchRightSide: 'RT', kickLeftSide: 'LL', kickFrontRear: 'RL', kickRightSide: 'RL' },
    { roll: 3, punchLeftSide: 'CT', punchFrontRear: 'CT', punchRightSide: 'CT', kickLeftSide: 'LL', kickFrontRear: 'RL', kickRightSide: 'RL' },
    { roll: 4, punchLeftSide: 'LA', punchFrontRear: 'LT', punchRightSide: 'RA', kickLeftSide: 'LL', kickFrontRear: 'LL', kickRightSide: 'RL' },
    { roll: 5, punchLeftSide: 'LA', punchFrontRear: 'LA', punchRightSide: 'RA', kickLeftSide: 'LL', kickFrontRear: 'LL', kickRightSide: 'RL' },
    { roll: 6, punchLeftSide: 'HD', punchFrontRear: 'HD', punchRightSide: 'HD', kickLeftSide: 'LL', kickFrontRear: 'LL', kickRightSide: 'RL' },
];

const TW_PHYSICAL_LOCATION_ROWS: readonly PhysicalLocationRow[] = [
    { roll: 1, punchLeftSide: 'LT', punchFrontRear: 'LA', punchRightSide: 'RT', kickLeftSide: 'LL', kickFrontRear: 'RL', kickRightSide: 'RL' },
    { roll: 2, punchLeftSide: 'LT', punchFrontRear: 'LT', punchRightSide: 'RT', kickLeftSide: 'LL', kickFrontRear: 'RL', kickRightSide: 'RL' },
    { roll: 3, punchLeftSide: 'CT', punchFrontRear: 'CT', punchRightSide: 'CT', kickLeftSide: 'LL', kickFrontRear: 'RL', kickRightSide: 'RL' },
    { roll: 4, punchLeftSide: 'LA', punchFrontRear: 'RT', punchRightSide: 'RA', kickLeftSide: 'LL', kickFrontRear: 'LL', kickRightSide: 'RL' },
    { roll: 5, punchLeftSide: 'LA', punchFrontRear: 'RA', punchRightSide: 'RA', kickLeftSide: 'LL', kickFrontRear: 'LL', kickRightSide: 'RL' },
    { roll: 6, punchLeftSide: 'HD', punchFrontRear: 'HD', punchRightSide: 'HD', kickLeftSide: 'LL', kickFrontRear: 'LL', kickRightSide: 'RL' },
];

const TO_HIT_MODIFIER_RANGE_INDEX: Record<RangeBrackets, number> = {
    short: 0,
    medium: 1,
    long: 2,
    extreme: 2,
};
const BASE_HIT_MODIFIER_LABEL = 'Base Hit Modifier';
const HOMING_ARTILLERY_TAG_BV_PER_LAUNCHER = 50;

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
    abstract readonly physicalLocationRows: readonly PhysicalLocationRow[];

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
        const stateBreakdown = [...(request.stateModifiers ?? [])];
        const adjustmentBreakdowns = adjustments
            .filter((adjustment): adjustment is Extract<ToHitAdjustment, { readonly kind: 'add' }> => adjustment.kind === 'add')
            .filter(adjustment => adjustment.modifier !== 0 || adjustment.weakened !== undefined)
            .map(({ label, modifier, weakened }) => ({
                label,
                modifier,
                ...(weakened !== undefined && { weakened })
            }));

        if (entry?.isIntrinsicPhysicalAttack()) {
            const physicalValue = this.physicalBaseHitModifiers[entry.name.toLowerCase()] ?? null;
            if (physicalValue === null || physicalValue === 'Vs') {
                const modifierBreakdown = this.resolveModifierBreakdown(
                    0,
                    stateBreakdown,
                    adjustmentBreakdowns,
                    BASE_HIT_MODIFIER_LABEL,
                );
                const weakened = modifierBreakdown.some(modifier => modifier.weakened === true);
                return {
                    profile: [],
                    value: physicalValue,
                    changed: false,
                    weakened,
                    modifierBreakdown: physicalValue === 'Vs' ? modifierBreakdown : [],
                };
            }
            return this.composeToHit([physicalValue], request, adjustments, stateBreakdown, adjustmentBreakdowns);
        }
        if (!equipment) return emptyToHitResolution();

        const rulesProfile = this.getRulesProfile(equipment);
        const baseProfile = replacement?.kind === 'replace-base'
            ? normalizeToHitProfile(replacement.value)
            : rulesProfile;
        return this.composeToHit(baseProfile, request, adjustments, stateBreakdown, adjustmentBreakdowns, rulesProfile);
    }

    getAmmoShots(ammo: AmmoEquipment, equipmentRegistry?: EquipmentRegistry): number {
        return ammo.shots;
    }

    getAmmoBV(ammo: AmmoEquipment, equipmentRegistry?: EquipmentRegistry): number | "variable" {
        return ammo.bv;
    }

    getAmmoKgPerShot(ammo: AmmoEquipment, equipmentRegistry?: EquipmentRegistry): number {
        const shots = this.getAmmoShots(ammo, equipmentRegistry);
        if (shots <= 0) return 0;
        return ammo.hasCustomKgPerShot
            ? ammo.kgPerShot * ammo.shots / shots
            : 1000 / shots;
    }

    calculateTagBVCost(unit: CBTForceUnit): number {
        const tagCount = unit.getOperationalMountedEquipmentByFlag('F_TAG').length;
        if (tagCount === 0) return 0;

        const launcherCount = unit.force.units().reduce(
            (total, forceUnit) => total + countHomingAmmoLaunchers(forceUnit),
            0,
        );
        return HOMING_ARTILLERY_TAG_BV_PER_LAUNCHER * launcherCount * tagCount;
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
        stateBreakdown: readonly ToHitModifierBreakdownEntry[],
        adjustmentBreakdowns: readonly ToHitModifierBreakdownEntry[],
        rulesProfile: readonly number[] = baseProfile
    ): ToHitResolution {
        const stateModifier = stateBreakdown.reduce((total, entry) => total + entry.modifier, 0);
        const adjustmentModifier = adjustments.reduce(
            (total, adjustment) => total + (adjustment.kind === 'add' ? adjustment.modifier : 0),
            0
        );
        const totalModifier = stateModifier + adjustmentModifier;
        const profile = baseProfile.map(value => value + totalModifier);
        const baseValue = valueAtRange(baseProfile, request.range);
        const replacement = adjustments.find(adjustment => adjustment.kind === 'replace-base');
        const value = !request.range && profile.length > 1 ? '*' : valueAtRange(profile, request.range);
        const changed = !sameProfile(profile, rulesProfile);
        const baseLabel = replacement?.label ?? BASE_HIT_MODIFIER_LABEL;
        const weakened = adjustmentBreakdowns.some(entry => entry.weakened === true)
            || stateBreakdown.some(entry => entry.weakened === true);
        const modifierBreakdown = typeof value === 'number'
            ? this.resolveModifierBreakdown(baseValue, stateBreakdown, adjustmentBreakdowns, baseLabel)
            : [];
        return { profile, value, changed, weakened, modifierBreakdown };
    }

    private resolveModifierBreakdown(
        baseValue: number,
        stateBreakdown: readonly ToHitModifierBreakdownEntry[],
        adjustmentBreakdowns: readonly ToHitModifierBreakdownEntry[],
        baseLabel: string
    ): ToHitModifierBreakdownEntry[] {
        const result: ToHitModifierBreakdownEntry[] = [];
        if (baseValue !== 0) result.push({ label: baseLabel, modifier: baseValue });
        result.push(...stateBreakdown);
        result.push(...adjustmentBreakdowns);
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
    readonly physicalLocationRows = CORE_2026_PHYSICAL_LOCATION_ROWS;

    override resolveC3Targeting(target: InventoryControlRuntimeTarget, degradationSource: C3DegradationSource): C3TargetingResolution {
        return { target, degradationSource };
    }

    override resolveC3TargetingModifier(degradationSource: C3DegradationSource, rangeBracketImprovement: number): ToHitModifierBreakdownEntry | null {
        return degradationSource !== 'none' && rangeBracketImprovement > 0
            ? { label: 'ECM', modifier: rangeBracketImprovement, weakened: true }
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

    override getAmmoShots(ammo: AmmoEquipment, equipmentRegistry?: EquipmentRegistry): number {
        const multiplier = ammo.hasMunitionType('M_PRECISION')
            ? 0.6
            : ammo.hasMunitionType('M_ARMOR_PIERCING')
                ? 0.8
                : null;
        if (multiplier === null) return ammo.shots;

        const baseShots = equipmentRegistry?.getBaseAmmo(ammo)?.shots;
        return baseShots === undefined ? ammo.shots : Math.floor(baseShots * multiplier);
    }

    override getAmmoBV(ammo: AmmoEquipment, equipmentRegistry?: EquipmentRegistry): number | "variable" {
        if (!ammo.hasMunitionType('M_AX_HEAD')) return ammo.bv;
        return equipmentRegistry?.getBaseAmmo(ammo)?.bv ?? ammo.bv;
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
    readonly physicalLocationRows = TW_PHYSICAL_LOCATION_ROWS;

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

    override getAmmoBV(ammo: AmmoEquipment, equipmentRegistry?: EquipmentRegistry): number | "variable" {
        if (!ammo.hasMunitionType('M_AX_HEAD')) return ammo.bv;
        const baseAmmo = equipmentRegistry?.getBaseAmmo(ammo);
        if (!baseAmmo) return ammo.bv;
        return typeof baseAmmo.bv === 'number' ? baseAmmo.bv * 2 : baseAmmo.bv;
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
            entry.equipment instanceof WeaponEquipment && unit.isEquipmentOperational(entry));
        if (launchers.length === 0) return 0;

        if (unit.getUnit().type === 'Mek') {
            return unit.getCritSlots().reduce((total, crit) => {
                const ammo = crit.eq;
                if (!(ammo instanceof AmmoEquipment)
                    || !isTagGuidedAmmo(ammo)
                    || !unit.isEquipmentOperational(crit)
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
                || !unit.isEquipmentOperational(mount)
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

function countHomingAmmoLaunchers(unit: CBTForceUnit): number {
    if (!unit.isLoaded()) return 0;

    const potentialLauncers = unit.getInventory().filter(entry =>
        entry.equipment instanceof WeaponEquipment
        && entry.equipment.hasFlag('F_ARTILLERY')
        && unit.isEquipmentOperational(entry));
    if (potentialLauncers.length === 0) return 0;

    const ammoSources = unit.getUnit().type === 'Mek'
        ? unit.getCritSlots().map(crit => ({
            ammo: crit.eq,
            source: crit,
            totalAmmo: crit.totalAmmo,
            consumed: crit.consumed,
        }))
        : unit.getInventory().map(mount => ({
            ammo: resolveMountedAmmo(unit, mount),
            source: mount,
            totalAmmo: mount.totalAmmo,
            consumed: mount.consumed,
        }));

    return potentialLauncers.filter(launcher => ammoSources.some(({ ammo, source, totalAmmo, consumed }) =>
        ammo instanceof AmmoEquipment
        && ammo.hasMunitionType('M_HOMING')
        && unit.isEquipmentOperational(source)
        && hasUsableAmmo(totalAmmo, consumed)
        && hasCompatibleLauncher(ammo, [launcher]))).length;
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
