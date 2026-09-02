// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import type { CBTRuleset } from '../cbt-ruleset.model';
import { AmmoEquipment, Equipment, WeaponEquipment, type RangeBrackets } from '../equipment.model';
import type { EquipmentRegistry } from '../equipment-lookup';
import type { EquipmentStatus } from '../equipment-status.model';
import type { ComponentId } from '../entity/entity-identifiers';
import type { IntrinsicWeaponKind } from '../entity/types/weapon';
import type { TargetingTarget } from '../runtime/targeting-target';
import { resolveAmmoWeaponProfile } from '../ammo-weapon-profile.model';
import type { TnTargetUnitType } from '../target-number-calculator.model';
import type { WeaponType } from '../weapon-types.model';
import { isHagEquipment } from '../hag-mode.model';
import { isFlamerEquipment } from '../flamer-mode.model';
import {
    isClubOrHandWeaponFlags,
    isClawFlags,
    isShieldFlags,
} from '../entity/utils/physical-weapon-kernel';
import { isDirectFireEquipment } from '../entity/utils/targeting-computer';
import {
    resolveAmmoBattleValue,
    resolveAmmoKgPerShot,
    resolveAmmoShots,
    type AmmoCapacityFacts,
} from './ammo-capacity-rules';

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

export interface ComponentToHitWeaponFacts {
    /** Catalog rule subject only; never a mounted component or mutable owner graph. */
    readonly equipment: WeaponEquipment;
    /** Frozen effective type snapshot, including the selected ammo/profile effects. */
    readonly effectiveWeaponTypes: readonly WeaponType[];
}

export interface ComponentToHitTargetingComputerFacts {
    readonly label: string;
    readonly status: EquipmentStatus;
}

export type ComponentToHitSource =
    | {
        readonly kind: 'intrinsic';
        readonly actionKind: IntrinsicWeaponKind;
    }
    | {
        readonly kind: 'equipment';
        /** Catalog rule subject only; never a mounted component or mutable owner graph. */
        readonly equipment: Equipment | null;
        readonly physical: boolean;
        /** Exact linked parent catalog subject used by the no-range eligibility rule. */
        readonly parentEquipment: Equipment | null;
    };

/** Immutable, stable-ID rule subject for one installed component. */
export interface ComponentToHitSubject {
    readonly kind: 'component';
    readonly componentId: ComponentId;
    readonly source: ComponentToHitSource;
    readonly locations: readonly string[];
    /** The exact parent-or-self weapon used by Mek linked-child targeting-computer rules. */
    readonly targetingComputerWeapon: ComponentToHitWeaponFacts | null;
    /** First installed targeting computer and its current status. */
    readonly targetingComputer: ComponentToHitTargetingComputerFacts | null;
}

export interface ToHitRequest {
    readonly subject: Equipment | ComponentToHitSubject;
    readonly range?: RangeBrackets | null;
    readonly stateModifiers?: readonly ToHitModifierBreakdownEntry[];
    readonly adjustments?: readonly ToHitAdjustment[];
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

export interface IndirectFireContext {
    readonly weaponUnderwater: boolean;
    readonly targetHasUnderwaterLayer: boolean;
}

export type NarcBeaconAttackRestriction = 'infantry' | 'building';

export interface NarcBeaconAttackContext {
    readonly targetInsideBuilding: boolean;
    readonly targetIsInfantry: boolean;
}

/** Attack-family facts needed to decide whether the target's Immobile modifier applies. */
export interface TargetAttackTraits {
    readonly areaEffect: boolean;
    readonly artillery: boolean;
    readonly artilleryCannon: boolean;
    readonly bomb: boolean;
    readonly mekMortarAirburst: boolean;
}

/** Force-owned operational facts used by TAG BV rules. */
export interface TagBattleValueFacts {
    readonly operationalTagCount: number;
    readonly homingArtilleryLauncherCount: number;
    readonly guidedAmmoBv: number;
}

export interface C3TargetingResolution {
    readonly target: TargetingTarget;
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
    abstract readonly id: CBTRuleset;
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

    abstract resolveC3Targeting(target: TargetingTarget, degradationSource: C3DegradationSource): C3TargetingResolution;
    abstract resolveC3TargetingModifier(degradationSource: C3DegradationSource, rangeBracketImprovement: number): ToHitModifierBreakdownEntry | null;
    abstract getSemiGuidedAdjustment(modifierValue: number, source: SemiGuidedAdjustmentSource): number;
    abstract getNarcBeaconAttackRestriction(context: NarcBeaconAttackContext): NarcBeaconAttackRestriction | null;
    abstract allowsTagDesignation(targetType: TnTargetUnitType | undefined): boolean;
    abstract attackBenefitsFromImmobile(traits: TargetAttackTraits): boolean;
    abstract getExplosiveWeaponDamage(weapon: WeaponEquipment, mountedCriticalSlots: number): number;
    abstract resolveMekExplosionDamage(context: MekExplosionDamageContext): MekExplosionDamageResolution;
    abstract getMekExplosionProtectionNote(protection: MekExplosionProtection): string | null;
    abstract hullBreachCheckSucceeds(total: number): boolean;
    abstract getHullBreachCheckRangeLabel(): string;
    protected abstract canFireTorpedoesIndirectly(context: IndirectFireContext): boolean;

    get escalatingFailureLabels(): readonly string[] {
        return this.escalatingFailureTargets.map(formatEscalatingFailureTarget);
    }

    canFireIndirectly(
        weapon: WeaponEquipment,
        selectedAmmo: AmmoEquipment | null,
        context: IndirectFireContext,
    ): boolean {
        if (!weapon.hasFlag('F_INDIRECT_FIRE')) return false;
        if (weapon.ammoType === 'MML' && resolveAmmoWeaponProfile(selectedAmmo)?.id !== 'mml-lrm') {
            return false;
        }
        return !isTorpedoAmmo(selectedAmmo) || this.canFireTorpedoesIndirectly(context);
    }

    resolveToHit(request: ToHitRequest): ToHitResolution {
        const component = request.subject instanceof Equipment ? null : request.subject;
        const equipment = component?.source.kind === 'equipment'
            ? component.source.equipment
            : request.subject instanceof Equipment ? request.subject : null;
        const adjustments = request.adjustments ?? [];
        const unsupported = adjustments.some(adjustment => adjustment.kind === 'unsupported');
        const replacement = adjustments.find(adjustment => adjustment.kind === 'replace-base');
        const hasBaseReplacement = replacement !== undefined;
        if (unsupported || (component && !this.supportsToHit(component) && !hasBaseReplacement)) return emptyToHitResolution();
        const stateBreakdown = [
            ...(component ? this.targetingComputerModifiers(component) : []),
            ...(request.stateModifiers ?? []),
        ];
        const adjustmentBreakdowns = adjustments
            .filter((adjustment): adjustment is Extract<ToHitAdjustment, { readonly kind: 'add' }> => adjustment.kind === 'add')
            .filter(adjustment => adjustment.modifier !== 0 || adjustment.weakened !== undefined)
            .map(({ label, modifier, weakened }) => ({
                label,
                modifier,
                ...(weakened !== undefined && { weakened })
            }));

        if (component?.source.kind === 'intrinsic') {
            const physicalValue = this.physicalBaseHitModifiers[component.source.actionKind] ?? null;
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
        return resolveAmmoShots(this.id, ammoCapacityFacts(ammo, equipmentRegistry));
    }

    getAmmoKgPerShot(ammo: AmmoEquipment, equipmentRegistry?: EquipmentRegistry): number {
        return resolveAmmoKgPerShot(this.id, ammoCapacityFacts(ammo, equipmentRegistry));
    }

    getAmmoBV(ammo: AmmoEquipment, equipmentRegistry?: EquipmentRegistry): number | 'variable' {
        return resolveAmmoBattleValue(this.id, ammoCapacityFacts(ammo, equipmentRegistry));
    }

    calculateTagBVCost(facts: TagBattleValueFacts): number {
        return 50
            * Math.max(0, facts.homingArtilleryLauncherCount)
            * Math.max(0, facts.operationalTagCount);
    }

    getMekInternalExplosionPilotHits(): number {
        return this.id === 'core-2026' ? 1 : 2;
    }

    protected abstract readonly physicalBaseHitModifiers: Readonly<Record<IntrinsicWeaponKind, number | 'Vs'>>;

    protected getRulesProfile(equipment: Equipment): number[] {
        return normalizeToHitProfile(equipment.toHitModifier);
    }

    private supportsToHit(subject: ComponentToHitSubject): boolean {
        if (subject.source.kind === 'intrinsic') return true;
        const { equipment, parentEquipment, physical } = subject.source;
        if (physical) return true;
        if (!equipment) return false;
        if (!(equipment instanceof WeaponEquipment)
            && !isShieldFlags(equipment.flags)
            && !isClubOrHandWeaponFlags(equipment.flags)) return false;
        if (equipment instanceof WeaponEquipment
            && equipment.hasNoRange()
            && !isShieldFlags(equipment.flags)
            && !isClubOrHandWeaponFlags(equipment.flags)
            && equipment.weapon.ammoType !== 'MML'
            && (!parentEquipment
                || (parentEquipment instanceof WeaponEquipment && parentEquipment.hasNoRange()))) return false;
        return true;
    }

    private targetingComputerModifiers(subject: ComponentToHitSubject): ToHitModifierBreakdownEntry[] {
        const weapon = subject.targetingComputerWeapon;
        const targetingComputer = subject.targetingComputer;
        if (!weapon || !targetingComputer || !this.targetingComputerEligible(weapon)) return [];
        if (targetingComputer.status === 'available') {
            return [{ label: targetingComputer.label, modifier: -1 }];
        }
        return [{
            label: `${targetingComputer.label} ${targetingComputer.status === 'destroyed' ? 'Destroyed' : 'Disabled'}`,
            modifier: 0,
            weakened: true,
        }];
    }

    private targetingComputerEligible(facts: ComponentToHitWeaponFacts): boolean {
        const weapon = facts.equipment;
        const types = new Set(facts.effectiveWeaponTypes);
        return isDirectFireEquipment(weapon)
            && !isFlamerEquipment(weapon)
            && !weapon.hasFlag('F_TASER')
            && !weapon.hasFlag('F_MG')
            && !weapon.hasFlag('F_MGA')
            && (types.has('DB') || types.has('DE') || types.has('P'))
            && !types.has('F')
            && (!types.has('C') || isHagEquipment(weapon));
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
            : [...stateBreakdown, ...adjustmentBreakdowns];
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
    readonly id = 'core-2026' as const;
    readonly c3DegradationLabel = 'DEGRADED' as const;
    readonly physicalBaseHitModifiers = {
        punch: -1,
        kick: -1,
        club: -1,
        push: -1,
        frenzy: 0,
        charge: 'Vs',
        'death-from-above': 'Vs',
        'airmek-ram': 'Vs',
    } as const;
    readonly escalatingFailureTargets = [3, 5, 7, 10, 11] as const;
    readonly radicalHeatSinkFailureTargets = this.escalatingFailureTargets;
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

    override resolveC3Targeting(target: TargetingTarget, degradationSource: C3DegradationSource): C3TargetingResolution {
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

    override attackBenefitsFromImmobile(traits: TargetAttackTraits): boolean {
        return !traits.areaEffect;
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
            return 'Caps internal damage at 1; if the location survives, up to 10 excess damage vents through its armor. Damage never transfers; each resulting critical hit is ignored on 8+.';
        }
        return null;
    }

    override hullBreachCheckSucceeds(total: number): boolean {
        return total >= 2 && total <= 4;
    }

    override getHullBreachCheckRangeLabel(): string {
        return '2–4';
    }

    protected override canFireTorpedoesIndirectly(_context: IndirectFireContext): boolean {
        return false;
    }

    protected override getRulesProfile(equipment: Equipment): number[] {
        if (isClawFlags(equipment.flags)) {
            return [0];
        }
        if (equipment instanceof WeaponEquipment && equipment.hasFlag('F_MRM')) {
            return [0];
        }
        return super.getRulesProfile(equipment);
    }

}

export class TWGameRules extends CBTGameRules {
    readonly id = 'total-warfare' as const;
    readonly c3DegradationLabel = 'JAMMED' as const;
    readonly physicalBaseHitModifiers = {
        punch: 0,
        kick: -2,
        club: -1,
        push: -1,
        frenzy: 0,
        charge: 'Vs',
        'death-from-above': 'Vs',
        'airmek-ram': 'Vs',
    } as const;
    readonly escalatingFailureTargets = [3, 5, 7, 11, ESCALATING_FAILURE_AUTO_FAIL_TARGET] as const;
    readonly radicalHeatSinkFailureTargets = [3, 5, 7, 10, 11, ESCALATING_FAILURE_AUTO_FAIL_TARGET] as const;
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
    readonly narcIndirectFireIgnoresAllTerrain = true;
    readonly indirectFireUsesSpotterPartialCover = true;
    readonly semiGuidedIgnoresCover = false;
    readonly semiGuidedIgnoresIndirectFireModifier = true;
    readonly physicalLocationRows = TW_PHYSICAL_LOCATION_ROWS;

    override resolveC3Targeting(target: TargetingTarget, degradationSource: C3DegradationSource): C3TargetingResolution {
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

    override attackBenefitsFromImmobile(traits: TargetAttackTraits): boolean {
        return !traits.artilleryCannon && !traits.bomb && !traits.mekMortarAirburst;
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

    override hullBreachCheckSucceeds(total: number): boolean {
        return total >= 10;
    }

    override getHullBreachCheckRangeLabel(): string {
        return '10+';
    }

    override calculateTagBVCost(facts: TagBattleValueFacts): number {
        return Math.round(Math.max(0, facts.guidedAmmoBv) * Math.max(0, facts.operationalTagCount));
    }

    protected override getRulesProfile(equipment: Equipment): number[] {
        if (isClawFlags(equipment.flags)) {
            return [1];
        }
        if (equipment instanceof WeaponEquipment && equipment.hasFlag('F_MRM')) {
            return [1];
        }
        return super.getRulesProfile(equipment);
    }

}

export const CORE_2026_GAME_RULES = new GameRules();
export const TW_GAME_RULES = new TWGameRules();

function ammoCapacityFacts(
    ammo: AmmoEquipment,
    equipmentRegistry?: EquipmentRegistry,
): AmmoCapacityFacts {
    const baseAmmo = equipmentRegistry?.getBaseAmmo(ammo);
    return {
        shots: ammo.shots,
        kgPerShot: ammo.kgPerShot,
        hasCustomKgPerShot: ammo.hasCustomKgPerShot,
        munitionTypes: ammo.munitionType,
        bv: ammo.bv,
        ...(baseAmmo === null || baseAmmo === undefined ? {} : {
            baseAmmoShots: baseAmmo.shots,
            baseAmmoBv: baseAmmo.bv,
        }),
    };
}

export function gameRulesFor(ruleset: CBTRuleset): CBTGameRules {
    return ruleset === 'total-warfare' ? TW_GAME_RULES : CORE_2026_GAME_RULES;
}

export function formatEscalatingFailureTarget(target: number): string {
    if (target === ESCALATING_FAILURE_NO_CHECK_TARGET) return '—';
    if (target >= ESCALATING_FAILURE_AUTO_FAIL_TARGET) return '!!';
    return `${target}+`;
}

function isTorpedoAmmo(ammo: AmmoEquipment | null): boolean {
    return ammo !== null && (
        ammo.ammoType === 'LRM_TORPEDO'
        || ammo.ammoType === 'SRM_TORPEDO'
        || ammo.ammoType === 'NLRM_TORPEDO'
        || ammo.munitionType.has('M_TORPEDO')
    );
}

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
