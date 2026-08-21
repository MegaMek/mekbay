// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import type { CBTForceUnit } from '../cbt-force-unit.model';
import type { AmmoMunitionFlag } from '../ammo-munition-flags.type';
import { AmmoEquipment, Equipment, isTorpedoAmmo, MiscEquipment, WeaponEquipment, type RangeBrackets } from '../equipment.model';
import type { EquipmentRegistry } from '../equipment-lookup';
import type { InventoryControlRuntimeTarget } from '../inventory-control-runtime-state.model';
import { MountedEquipment } from '../mounted-equipment.model';
import { resolveAmmoWeaponProfile } from '../ammo-weapon-profile.model';
import type { TnTargetUnitType } from '../target-number-calculator.model';

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
export type SemiGuidedAdjustmentSource = 'movement' | 'terrain';

export type MekExplosionProtection = 'none' | 'case' | 'case-ii';

export interface MekImmediateCriticalExplosionContext {
    readonly hitEntry: MountedEquipment | null;
    readonly hitEquipment: Equipment | null;
    readonly remainingAmmoDamage: number;
    readonly remainingAmmoShots: number;
    readonly mountedCriticalSlots: number;
    readonly previousComponentCriticalHits: number;
    readonly explosiveWeapon: boolean;
    readonly parentOperational: boolean;
    readonly hasUsableAmmo: boolean;
}

export interface MekImmediateCriticalExplosion {
    readonly equipment: string;
    readonly rawDamage: number;
    readonly pilotHits: number;
    readonly automaticCriticalEntry?: MountedEquipment;
}

export interface MekExplosionDamageContext {
    readonly damage: number;
    readonly protection: MekExplosionProtection;
    readonly remainingInternal: number;
    readonly remainingArmor: number;
    readonly originalArmor: number;
    readonly torso: boolean;
    /** Core's standard 20-point cap was exceeded before damage transferred here. */
    readonly armorBlowoutPending?: boolean;
}

export interface MekExplosionDamageResolution {
    readonly internalDamage: number;
    readonly armorDamage: number;
    readonly armorRear: boolean;
    readonly stopsTransfer: boolean;
}

/** No failure roll is made for this tracked use. */
export const ESCALATING_FAILURE_NO_CHECK_TARGET = 0;
/** First impossible 2D6 target; represents automatic failure. */
export const ESCALATING_FAILURE_AUTO_FAIL_TARGET = 13;

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

interface AmmoMunitionRule {
    readonly munitionType: AmmoMunitionFlag;
    readonly shotsMultiplier: number;
    readonly baseAmmoBvMultiplier?: number;
}

export interface IndirectFireContext {
    readonly weaponUnderwater: boolean;
    readonly targetHasUnderwaterLayer: boolean;
}

export type NarcBeaconAttackRestriction = 'infantry' | 'building';

export interface NarcBeaconAttackContext {
    readonly targetInsideBuilding: boolean;
    readonly targetIsInfantry: boolean;
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
    abstract readonly escalatingFailureTargets: readonly number[];
    abstract readonly radicalHeatSinkFailureTargets: readonly number[];
    abstract readonly blueShieldFailureTargets: readonly number[];
    abstract readonly emergencyCoolantSystemFailureTargets: readonly number[];
    abstract readonly viralJammerFailureTargets: readonly number[];
    abstract readonly usesUacJamming: boolean;
    abstract readonly supportsSkidding: boolean;
    abstract readonly supportsSecondaryTargetSideBack: boolean;
    abstract readonly supportsLargeTarget: boolean;
    abstract readonly artilleryFlatRangeModifier: number | null;
    abstract readonly supportsApolloSaturationMode: boolean;
    abstract readonly supportsBombastLaserRules: boolean;
    abstract readonly supportsFlamerModes: boolean;
    abstract readonly narcHomingTargetModifier: number;
    abstract readonly narcIndirectFireIgnoresAllTerrain: boolean;
    abstract readonly indirectFireUsesSpotterPartialCover: boolean;
    abstract readonly semiGuidedIgnoresCover: boolean;
    abstract readonly semiGuidedIgnoresIndirectFireModifier: boolean;
    abstract readonly physicalLocationRows: readonly PhysicalLocationRow[];
    protected readonly ammoMunitionRules: readonly AmmoMunitionRule[] = [];

    abstract resolveC3Targeting(target: InventoryControlRuntimeTarget, degradationSource: C3DegradationSource): C3TargetingResolution;
    abstract resolveC3TargetingModifier(degradationSource: C3DegradationSource, rangeBracketImprovement: number): ToHitModifierBreakdownEntry | null;
    abstract getSemiGuidedAdjustment(modifierValue: number, source: SemiGuidedAdjustmentSource): number;
    abstract getNarcBeaconAttackRestriction(context: NarcBeaconAttackContext): NarcBeaconAttackRestriction | null;
    abstract allowsTagDesignation(targetType: TnTargetUnitType | undefined): boolean;
    abstract getExplosiveWeaponDamage(weapon: WeaponEquipment, mountedCriticalSlots: number): number;
    abstract resolveMekExplosionDamage(context: MekExplosionDamageContext): MekExplosionDamageResolution;
    abstract getMekExplosionProtectionNote(protection: MekExplosionProtection): string | null;
    protected abstract canFireTorpedoesIndirectly(context: IndirectFireContext): boolean;

    /** Resolves immediate Mek explosion effects after handler-owned delayed cases are excluded. */
    getMekImmediateCriticalExplosion(
        context: MekImmediateCriticalExplosionContext,
    ): MekImmediateCriticalExplosion | null {
        const equipment = context.hitEquipment;
        if (!equipment) return null;

        if (equipment instanceof AmmoEquipment) {
            const rawDamage = equipment.ammoType === 'COOLANT_POD'
                ? (context.remainingAmmoShots > 0 ? this.coolantPodExplosionDamage : 0)
                : equipment.isExplosive() ? context.remainingAmmoDamage : 0;
            return rawDamage > 0
                ? this.immediateMekExplosion(equipment.name, rawDamage)
                : null;
        }

        const hitEntry = context.hitEntry;
        if (!hitEntry) return null;

        if (equipment instanceof WeaponEquipment) {
            if (!context.explosiveWeapon || context.previousComponentCriticalHits > 0) return null;
            if (equipment.hasFlag('F_HVAC') && !context.hasUsableAmmo) return null;
            return this.immediateMekExplosion(
                hitEntry.getDisplayName(),
                this.getExplosiveWeaponDamage(equipment, context.mountedCriticalSlots),
            );
        }

        if (!(equipment instanceof MiscEquipment)
            || !equipment.isExplosive()
            || context.previousComponentCriticalHits > 0) return null;

        if (equipment.hasFlag('F_BLUE_SHIELD')) {
            const active = hitEntry.states.get('blueShieldUsedThisTurn') === 'true';
            return active ? this.immediateMekExplosion(hitEntry.getDisplayName(), 5) : null;
        }

        if (equipment.hasFlag('F_RISC_LASER_PULSE_MODULE')) {
            const laser = hitEntry.parent;
            return laser && context.parentOperational
                ? {
                    ...this.immediateMekExplosion(hitEntry.getDisplayName(), 2),
                    automaticCriticalEntry: laser,
                }
                : null;
        }

        if (equipment.hasAllFlags(['F_JUMP_JET', 'S_IMPROVED', 'S_PROTOTYPE'])) {
            return this.immediateMekExplosion(hitEntry.getDisplayName(), 10);
        }

        if (equipment.hasFlag('F_FUEL')) {
            return this.immediateMekExplosion(hitEntry.getDisplayName(), 20);
        }

        if (equipment.hasFlag('F_EMERGENCY_COOLANT_SYSTEM')) {
            return this.immediateMekExplosion(hitEntry.getDisplayName(), 5);
        }

        return this.immediateMekExplosion(
            hitEntry.getDisplayName(),
            context.mountedCriticalSlots * 2,
        );
    }

    getMekInternalExplosionPilotHits(): number {
        return this.id === 'core2026' ? 1 : 2;
    }

    private get coolantPodExplosionDamage(): number {
        return this.id === 'core2026' ? 2 : 10;
    }

    private immediateMekExplosion(
        equipment: string,
        rawDamage: number,
    ): MekImmediateCriticalExplosion {
        return {
            equipment,
            rawDamage: Math.max(0, rawDamage),
            pilotHits: this.getMekInternalExplosionPilotHits(),
        };
    }

    canFireIndirectly(
        entry: MountedEquipment,
        selectedAmmo: AmmoEquipment | null,
        context: IndirectFireContext
    ): boolean {
        const weapon = entry.equipment;
        if (!(weapon instanceof WeaponEquipment) || !weapon.hasFlag('F_INDIRECT_FIRE')) return false;

        // An MML launcher has indirect capability only while using its LRM profile.
        if (weapon.ammoType === 'MML' && resolveAmmoWeaponProfile(selectedAmmo)?.id !== 'mml-lrm') {
            return false;
        }

        return !isTorpedoAmmo(selectedAmmo) || this.canFireTorpedoesIndirectly(context);
    }

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
        const rule = this.getAmmoMunitionRule(ammo);
        if (!rule) return ammo.shots;

        const baseShots = equipmentRegistry?.getBaseAmmo(ammo)?.shots;
        return baseShots === undefined ? ammo.shots : Math.floor(baseShots * rule.shotsMultiplier);
    }

    getAmmoBV(ammo: AmmoEquipment, equipmentRegistry?: EquipmentRegistry): number | "variable" {
        const rule = this.getAmmoMunitionRule(ammo);
        if (rule?.baseAmmoBvMultiplier === undefined) return ammo.bv;

        const baseAmmo = equipmentRegistry?.getBaseAmmo(ammo);
        if (!baseAmmo) return ammo.bv;
        return typeof baseAmmo.bv === 'number'
            ? baseAmmo.bv * rule.baseAmmoBvMultiplier
            : baseAmmo.bv;
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

    private getAmmoMunitionRule(ammo: AmmoEquipment): AmmoMunitionRule | undefined {
        return this.ammoMunitionRules.find(({ munitionType }) => ammo.hasMunitionType(munitionType));
    }

    protected getRulesProfile(equipment: Equipment): number[] {
        return normalizeToHitProfile(equipment.toHitModifier);
    }

    private supportsToHit(entry: MountedEquipment): boolean {
        const equipment = entry.equipment;
        if (entry.isPhysicalWeapon()) return true;
        if (!equipment) return false;
        if (!(equipment instanceof WeaponEquipment)
            && !equipment.flags.has('F_SHIELD')
            && !equipment.flags.has('F_CLUB')
            && !equipment.flags.has('F_HAND_WEAPON')) return false;
        if (equipment instanceof WeaponEquipment
            && equipment.hasNoRange()
            && !equipment.flags.has('F_SHIELD')
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
    readonly escalatingFailureTargets = [3, 5, 7, 10, 11] as const;
    readonly radicalHeatSinkFailureTargets = this.escalatingFailureTargets;
    // Blue Shield's first five uses are safe; Core starts escalating-failure checks on use six.
    readonly blueShieldFailureTargets = [
        ESCALATING_FAILURE_NO_CHECK_TARGET,
        ESCALATING_FAILURE_NO_CHECK_TARGET,
        ESCALATING_FAILURE_NO_CHECK_TARGET,
        ESCALATING_FAILURE_NO_CHECK_TARGET,
        ESCALATING_FAILURE_NO_CHECK_TARGET,
        ...this.escalatingFailureTargets,
    ] as const;
    readonly emergencyCoolantSystemFailureTargets = this.escalatingFailureTargets;
    readonly viralJammerFailureTargets = this.escalatingFailureTargets;
    readonly usesUacJamming = false;
    readonly supportsSkidding = false;
    readonly supportsSecondaryTargetSideBack = false;
    readonly supportsLargeTarget = true;
    readonly artilleryFlatRangeModifier = 4;
    readonly supportsApolloSaturationMode = true;
    readonly supportsBombastLaserRules = true;
    readonly supportsFlamerModes = false;
    readonly narcHomingTargetModifier = -1;
    readonly narcIndirectFireIgnoresAllTerrain = false;
    readonly indirectFireUsesSpotterPartialCover = false;
    readonly semiGuidedIgnoresCover = true;
    readonly semiGuidedIgnoresIndirectFireModifier = false;
    readonly physicalLocationRows = CORE_2026_PHYSICAL_LOCATION_ROWS;
    protected override readonly ammoMunitionRules: readonly AmmoMunitionRule[] = [
        { munitionType: 'M_PRECISION', shotsMultiplier: 0.6 },
        { munitionType: 'M_ARMOR_PIERCING', shotsMultiplier: 0.8 },
        { munitionType: 'M_AX_HEAD', shotsMultiplier: 1, baseAmmoBvMultiplier: 1 },
    ];

    override resolveC3Targeting(target: InventoryControlRuntimeTarget, degradationSource: C3DegradationSource): C3TargetingResolution {
        return { target, degradationSource };
    }

    override resolveC3TargetingModifier(degradationSource: C3DegradationSource, rangeBracketImprovement: number): ToHitModifierBreakdownEntry | null {
        return degradationSource !== 'none' && rangeBracketImprovement > 0
            ? { label: 'ECM', modifier: rangeBracketImprovement, weakened: true }
            : null;
    }

    override getSemiGuidedAdjustment(modifierValue: number, source: SemiGuidedAdjustmentSource): number {
        return source === 'terrain' ? Math.min(2, Math.max(0, modifierValue)) : 0;
    }

    override getNarcBeaconAttackRestriction(_context: NarcBeaconAttackContext): NarcBeaconAttackRestriction | null {
        return null;
    }

    override allowsTagDesignation(_targetType: TnTargetUnitType | undefined): boolean {
        return true;
    }

    override getExplosiveWeaponDamage(_weapon: WeaponEquipment, mountedCriticalSlots: number): number {
        return Math.max(0, mountedCriticalSlots) * 2;
    }

    override resolveMekExplosionDamage(context: MekExplosionDamageContext): MekExplosionDamageResolution {
        const damage = Math.max(0, context.damage);
        const cap = context.protection === 'case-ii' ? 1 : context.protection === 'case' ? 10 : 20;
        const internalDamage = Math.min(damage, cap);
        let armorDamage = 0;

        if (context.protection === 'none') {
            const armorBlowoutPending = context.armorBlowoutPending || damage > cap;
            if (armorBlowoutPending && context.remainingInternal > internalDamage) {
                armorDamage = context.remainingArmor;
            }
        } else if (damage > cap && context.remainingInternal > internalDamage) {
            armorDamage = Math.min(context.remainingArmor, 10, damage - cap);
        }

        return {
            internalDamage,
            armorDamage,
            armorRear: context.torso,
            stopsTransfer: context.protection !== 'none',
        };
    }

    override getMekExplosionProtectionNote(protection: MekExplosionProtection): string | null {
        if (protection === 'case') {
            return 'Caps internal damage at 10; if the location survives, up to 10 excess damage vents through its armor. Damage never transfers.';
        }
        if (protection === 'case-ii') {
            return 'Caps internal damage at 1; if the location survives, up to 10 excess damage vents through its armor. Damage never transfers; the resulting critical hit check has a −1 modifier.';
        }
        return null;
    }

    protected override canFireTorpedoesIndirectly(_context: IndirectFireContext): boolean {
        return false;
    }

    protected override getRulesProfile(equipment: Equipment): number[] {
        // Claws have a 0 hit modifier instead of TW's +1.
        if (equipment.flags.has('S_CLAW')) {
            return [0];
        }
        // MRM have 0 instead of +1 of TW
        if (equipment instanceof WeaponEquipment && equipment.hasFlag('F_MRM')) {
            return [0];
        }

        return super.getRulesProfile(equipment);
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
    readonly escalatingFailureTargets = [3, 5, 7, 11, ESCALATING_FAILURE_AUTO_FAIL_TARGET] as const;
    readonly radicalHeatSinkFailureTargets = [3, 5, 7, 10, 11, ESCALATING_FAILURE_AUTO_FAIL_TARGET] as const;
    // TO:AUE: six safe cumulative uses, then the avoid number rises by one until automatic failure.
    readonly blueShieldFailureTargets = [
        ESCALATING_FAILURE_NO_CHECK_TARGET,
        ESCALATING_FAILURE_NO_CHECK_TARGET,
        ESCALATING_FAILURE_NO_CHECK_TARGET,
        ESCALATING_FAILURE_NO_CHECK_TARGET,
        ESCALATING_FAILURE_NO_CHECK_TARGET,
        ESCALATING_FAILURE_NO_CHECK_TARGET,
        3, 4, 5, 6, 7, 8, 9, 10, 11, 12, ESCALATING_FAILURE_AUTO_FAIL_TARGET,
    ] as const;
    readonly emergencyCoolantSystemFailureTargets = [3, 5, 7, 10, ESCALATING_FAILURE_AUTO_FAIL_TARGET] as const;
    readonly viralJammerFailureTargets = [
        4, 5, 6, 7, 8, 9, 10, 11, 12, ESCALATING_FAILURE_AUTO_FAIL_TARGET,
    ] as const;
    readonly usesUacJamming = true;
    readonly supportsSkidding = true;
    readonly supportsSecondaryTargetSideBack = true;
    readonly supportsLargeTarget = false;
    readonly artilleryFlatRangeModifier = null;
    readonly supportsApolloSaturationMode = false;
    readonly supportsBombastLaserRules = false;
    readonly supportsFlamerModes = true;
    readonly narcHomingTargetModifier = 0; 
    // TODO: inarc should get a -1 modifier in TW Rules but we need to implement inarc pods... BLEARGH! 
    readonly narcIndirectFireIgnoresAllTerrain = true;
    readonly indirectFireUsesSpotterPartialCover = true;
    readonly semiGuidedIgnoresCover = false;
    readonly semiGuidedIgnoresIndirectFireModifier = true;
    readonly physicalLocationRows = TW_PHYSICAL_LOCATION_ROWS;
    protected override readonly ammoMunitionRules: readonly AmmoMunitionRule[] = [
        { munitionType: 'M_PRECISION', shotsMultiplier: 0.5 },
        { munitionType: 'M_ARMOR_PIERCING', shotsMultiplier: 0.5 },
        { munitionType: 'M_AX_HEAD', shotsMultiplier: 0.5, baseAmmoBvMultiplier: 2 },
    ];

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

    protected override canFireTorpedoesIndirectly(context: IndirectFireContext): boolean {
        // Without a map/body identifier, all recorded water belongs to one virtual body.
        return context.weaponUnderwater && context.targetHasUnderwaterLayer;
    }

    override getSemiGuidedAdjustment(modifierValue: number, source: SemiGuidedAdjustmentSource): number {
        return source === 'movement' ? Math.max(0, modifierValue) : 0;
    }

    override getNarcBeaconAttackRestriction(context: NarcBeaconAttackContext): NarcBeaconAttackRestriction | null {
        if (context.targetIsInfantry) return 'infantry';
        if (context.targetInsideBuilding) return 'building';
        return null;
    }

    override allowsTagDesignation(targetType: TnTargetUnitType | undefined): boolean {
        return targetType !== 'infantry' && targetType !== 'battle-armor';
    }

    override getExplosiveWeaponDamage(weapon: WeaponEquipment, _mountedCriticalSlots: number): number {
        return Math.max(0, weapon.weapon.explosionDamage);
    }

    override resolveMekExplosionDamage(context: MekExplosionDamageContext): MekExplosionDamageResolution {
        const damage = Math.max(0, context.damage);
        if (context.protection !== 'case-ii') {
            return {
                internalDamage: damage,
                armorDamage: 0,
                armorRear: context.torso,
                stopsTransfer: context.protection === 'case',
            };
        }

        const ventedDamage = Math.max(0, damage - 1);
        const armorCap = context.torso ? context.remainingArmor : Math.ceil(context.originalArmor / 2);
        return {
            internalDamage: damage > 0 && context.remainingInternal > 0 ? 1 : 0,
            armorDamage: Math.min(context.remainingArmor, armorCap, ventedDamage),
            armorRear: context.torso,
            stopsTransfer: true,
        };
    }

    override getMekExplosionProtectionNote(protection: MekExplosionProtection): string | null {
        if (protection === 'case') {
            return 'Takes full explosion damage in this location, but prevents any excess from transferring.';
        }
        if (protection === 'case-ii') {
            return 'Applies 1 internal damage and vents the remainder through rear armor, or up to half the original armor in a limb or head. Damage never transfers; each resulting critical hit is ignored on 8+.';
        }
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
    
    protected override getRulesProfile(equipment: Equipment): number[] {
        // Claws have a +1 hit modifier instead of Core 2026's 0.
        if (equipment.flags.has('S_CLAW')) {
            return [1];
        }

        // MRM have +1 instead of 0 of core
        if (equipment instanceof WeaponEquipment && equipment.hasFlag('F_MRM')) {
            return [1];
        }

        return super.getRulesProfile(equipment);
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
