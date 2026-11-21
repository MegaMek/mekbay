// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import { compareText } from '../../utils/string.util';
import type { AmmoSelectionCompatibilityFacts } from '../../utils/ammo-validity.util';
import {
    comparativePilotingModifier,
    infantryTarget,
    PHYSICAL_ATTACK_KINDS,
    physicalAttackAlwaysHits,
    physicalAttackMeetsBuildingCover,
    physicalAttackMeetsWaterCover,
    physicalAttackTakesMovement,
    physicalHitTable,
    physicalTargetIssue,
    physicalTargetModifier,
    type HitTable,
    type PhysicalAttackKind,
    type PhysicalAttackReach,
} from '../rules/physical-attack-rules';
import { isHandClawFlags } from '../entity/utils/physical-weapon-kernel';
import type { OptionalRules } from '../options.model';
import { recordSheetInventoryMountName } from '../../utils/sheets/record-sheet-inventory-equipment';
import type { EquipmentStatus } from '../equipment-status.model';
import { asComponentId, type ComponentId, type LocationId } from '../entity/entity-identifiers';
import type { MekEntity } from '../entity/entities/mek/mek-entity';
import type { EquipmentTechBase } from '../entity/types/tech';
import type { EntityWeaponHitModifier } from '../entity/types/weapon';
import {
    ammoMatchesWeapon,
    AmmoEquipment,
    Equipment,
    WeaponEquipment,
    type AmmoType,
    type WeaponDamage,
} from '../equipment.model';
import type { BombCapacity, BombLoad } from '../aerospace-bomb.model';
import type { CBTRuleset } from '../cbt-ruleset.model';
import type { UnitUuid } from '../../services/unit-catalog/unit-catalog.types';
import type {
    AttackerAmmoSelection,
    AttackerActionTarget,
    AttackerSelection,
    AttackerLocalTargetState,
    AttackerTargetingState,
} from './attacker-targeting-state';
import { attackerActionSelection } from './attacker-targeting-state';
import type { EncounterTargetId, TargetRegistrySnapshot } from './encounter-runtime';
import type { TnTargetNumberCalculatorState, TnTargetUnitType } from '../target-number-calculator.model';
import type { MekUnitQueryPort } from './unit-instance';
import type { WeaponType } from '../weapon-types.model';
import type { UnitType } from '../entity/types';
import { canPerformMekAction } from './mek-action-availability';
import type { MekPhysicalAttackEffectV2 } from './mek-physical-attack-v2';
import { activeTargetCalculator, type TargetingTarget } from './targeting-target';
import {
    calculateTargetTnModifierBreakdown,
    calculateTargetTnModifier,
    getTnTargetModifierGroupTotals,
    TN_INDIRECT_FIRE_MODIFIER,
    TN_SKIDDING_ATTACKER,
    type TnRangeBracket,
    type TnTargetModifierBreakdownEntry,
} from '../target-number-calculator.model';
import { componentLocationIds, equipmentForComponent, mountedEquipmentForComponent, type MekRuntimeIndex } from './mek-runtime-index';
import {
    ammoSourceFeedsWeapon,
    entityWeaponTechBasesForAmmo,
    entityAmmoSelectionCompatibilityFacts,
    hotLoadedAmmoForWeapon,
    mekAmmoDefaultMunitionKey,
    mekAmmoLoadouts,
    weaponAcceptsAmmo,
    type AmmoLoadout,
} from './mek-ammo';
import { mekComponentModes } from './mek-component-rules';
import { mekRiscLaserPulseActive, mekRiscLaserPulseLink } from './component-risc-laser-pulse';
import { RISC_LASER_PULSE_HEAT_BONUS, riscLaserPulseToHitAdjustment } from '../risc-laser-mode.model';
import { prototypeLaserMaximumExtraHeat } from '../prototype-laser-heat.model';
import { rapidFireAutocannonShotCount } from './component-rapid-fire-autocannon';
import { MAGNETIC_CLAW_SHAKE_OFF_MODIFIER } from '../rules/anti-mek-attack-rules';
import {
    AIMED_SHOT_MODIFIER,
    aimedShot,
    aimedShotIgnoresComputer,
    aimedShotKind,
    type AimedShot,
    type AimedShotKind,
    type AimedShotTarget,
    type AimedShotWeapon,
} from '../rules/aimed-shot-rules';
import { laserInsulatorAdjustedHeat } from '../laser-insulator.model';
import type { EntityMountedEquipment } from '../entity/types/equipment';
import { mekLaserInsulatorWeakened } from './component-laser-insulator';
import { applyFlamerWeaponTypes, flamerDisplayLabel } from '../flamer-mode.model';
import { bombastLaserEquipmentProfile } from '../bombast-laser-mode.model';
import { BOMBAST_LASER_CHARGED_STATE } from './component-bombast-laser';
import {
    mekUnitWaterState,
    mekWeaponTargetSubject,
    resolveMekTargetingAmmo,
} from './mek-targeting-rules';
import { weaponTargetAttackTraits, weaponTargetDisabledReasons } from './weapon-target-policy';
import {
    gameRulesFor,
    type C3DegradationSource,
    type CBTGameRules,
    type ComponentToHitSubject,
    type ComponentToHitTargetingComputerFacts,
    type ComponentToHitWeaponFacts,
    type ToHitAdjustment,
    type ToHitModifierBreakdownEntry,
    type ToHitRequest,
    type ToHitResolution,
} from '../rules/game-rules';
import {
    inventoryTargetNumberState,
    inventoryTargetRangeSelection,
    resolveTargetGuidance,
    type InventoryTargetRangeSelection,
} from '../../utils/inventory-target-number.util';
import type { PlatoonAttackFacts } from '../rules/conventional-infantry-combat-rules';
import { projectMekSpottingModifier } from './mek-turn-panel';
import { applyHagEquipmentWeaponTypes, hagEquipmentToHitAdjustments } from './component-hag-mode';
import type { MekCombatModifierProjectionResult } from './mek-combat-modifiers';
import { applyGaussPowerWeaponTypes } from './mek-gauss-power';
import { applyComponentApolloWeaponTypes } from './component-apollo';
import { isApolloEquipment, apolloToHitAdjustment } from '../apollo-mode.model';
import { isArtemisEquipment, artemisVToHitAdjustment } from '../artemis-equipment.model';
import {
    ppcCapacitorChargedForWeapon,
    ppcCapacitorFiringHeat,
    ppcCapacitorWeaponDamage,
    ppcCapacitorWeaponTypes,
} from './component-ppc-capacitor';
import type { EquipmentRowOrderState } from './equipment-row-order';
import { AEROSPACE_RANGE_BRACKETS, type AerospaceRangeLimits } from '../../utils/aerospace-range.util';
import type { UnitModifierBreakdownEntry } from '../combat-modifier';
import type { MotiveModes } from '../motiveModes.model';
import {
    inventoryControlDamageRange,
    resolveInventoryControlWeaponDamage,
} from '../../utils/inventory-control-damage.util';
import type { EquipmentRegistry } from '../equipment-lookup';
import { resolveAmmoWeaponProfile } from '../ammo-weapon-profile.model';
import type { TooltipLine } from '../../components/tooltip/tooltip.component';
import {
    isWeaponEnhancementEquipment,
} from '../entity/utils/equipment-link-rules';
import { isTargetingComputerEquipment } from '../entity/utils/targeting-computer';
import { resolveComponentBayRuntime, type ComponentBayRuntimeFacts } from './component-bay-runtime';
import { shieldWeaponToHitAdjustment } from './component-shield-mode';

export interface EquipmentPanelLocation {
    readonly locationId: LocationId;
    readonly code: string;
    readonly status: EquipmentStatus;
    readonly exposed: boolean;
}

export interface EquipmentPanelAmmoLoadout {
    readonly munitionKey: string;
    readonly displayName: string;
    readonly capacity: number;
    readonly equipment: AmmoEquipment;
}

export interface EquipmentPanelAmmoSource {
    readonly componentId: ComponentId;
    readonly label: string;
    readonly location: string;
    readonly status: EquipmentStatus;
    readonly munitionKey: string;
    readonly remaining: number;
    readonly capacity: number;
    readonly hotLoaded?: boolean;
    readonly loadouts: readonly EquipmentPanelAmmoLoadout[];
}

export interface EquipmentPanelWeapon {
    /** Per-shot value shown in the equipment table. */
    readonly heat: number;
    /** Total heat applied when this mode fires. */
    readonly firingHeat: number;
    /** Variable ground heat is resolved from die evidence when fired. */
    readonly heatSuffix?: '*';
    readonly selectable: boolean;
    /** The weapon fired this turn: it cannot fire again until End Turn, or until the fire is undone. */
    readonly firedThisTurn?: true;
    readonly damage: WeaponEquipment['damage'];
    readonly damageText: string;
    readonly damageTextByRange: Readonly<Record<TnRangeBracket, string>>;
    /** Absent for aerospace bays, which attack with a combined value instead. */
    readonly damageByRange?: Readonly<Record<TnRangeBracket, WeaponDamage | null>>;
    /** Exact rules-owned hit resolution; the UI never rebuilds equipment rules. */
    readonly hit: EquipmentPanelHitResolution;
    readonly toHitModifier: WeaponEquipment['toHitModifier'];
    readonly hitModifierBreakdown: readonly ToHitModifierBreakdownEntry[];
    /** Target-independent Artemis V modifier; indirect fire removes it per target. */
    readonly artemisVModifier?: number;
    readonly ranges: readonly number[];
    readonly minimumRange: number;
    /** Aerospace sheet values stay separate from tactical weapon ranges. */
    readonly aerospace?: Readonly<{
        readonly attackValues: readonly [number, number, number, number];
        readonly rangeLimits: AerospaceRangeLimits;
        readonly maximumBracket: TnRangeBracket;
        readonly capital: boolean;
    }>;
    readonly selection?: AttackerSelection;
    readonly ammoSelection?: AttackerAmmoSelection;
    readonly ammoSources: readonly EquipmentPanelAmmoSource[];
    readonly underwater: boolean;
    readonly attackerSubmerged: boolean;
    readonly disabledTargetReasons: Readonly<Record<string, string>>;
    /** Effective weapon types after selected ammunition and current mode effects. */
    readonly effectiveWeaponTypes?: readonly WeaponType[];
    readonly attackerIsConventionalInfantry?: boolean;
    /** A conventional platoon's own attack or disposable weapon, resolved by troopers (TW p. 217; TO:AuE p. 116). */
    readonly platoon?: PlatoonAttackFacts;
}

export interface EquipmentPanelHitResolution {
    readonly default: ToHitResolution;
    readonly byRange: Readonly<Record<TnRangeBracket, ToHitResolution>>;
    readonly indirectByRange: Readonly<Record<TnRangeBracket, ToHitResolution>>;
}

export interface EquipmentPanelModifier {
    readonly name: string;
    readonly status?: 'destroyed' | 'disabled' | 'warning';
}

/** The panel's ranged weapon rows in Entity order: the rows a saved weapon order permutes. */
export function equipmentPanelWeapons(snapshot: Pick<EquipmentPanelSnapshot, 'components'>): readonly EquipmentPanelComponent[] {
    return snapshot.components.filter(row => row.weapon !== undefined);
}

export function equipmentPanelAttachments(
    mounts: readonly EntityMountedEquipment[],
    statusOf: (mount: EntityMountedEquipment) => EquipmentStatus,
) {
    // Any Artemis guides its own missiles' attack values; Artemis V and Apollo also adjust the to-hit roll
    const fireControl = mounts.find(mount =>
        isArtemisEquipment(mount.equipment) || isApolloEquipment(mount.equipment));
    const modifiers = mounts.flatMap(mount => {
        const equipment = mount.equipment;
        if (!equipment || !isWeaponEnhancementEquipment(equipment)) return [];
        const status = statusOf(mount);
        return [Object.freeze({
            name: equipment.shortName || equipment.name,
            ...(status === 'available' ? {} : { status }),
        })];
    });
    return { modifiers: Object.freeze(modifiers), fireControl: fireControl?.equipment,
        fireControlStatus: fireControl ? statusOf(fireControl) : 'available' as const };
}

export interface EquipmentPanelWeaponDamage {
    readonly default: string;
    readonly byRange: Readonly<Record<TnRangeBracket, string>>;
    /** The resolved damage each text above formats. */
    readonly valuesByRange: Readonly<Record<TnRangeBracket, WeaponDamage | null>>;
}

export interface EquipmentPanelAttackMember {
    readonly componentId: ComponentId;
    readonly selectable: boolean;
    readonly selection?: AttackerSelection;
    readonly ammoSelection?: AttackerAmmoSelection;
    readonly ammoSources: readonly EquipmentPanelAmmoSource[];
}

/** Derived combat grouping; canonical installed components remain unchanged. */
export interface EquipmentPanelAttackGroup {
    readonly kind: 'weapon-bay';
    readonly source: 'authored-bay' | 'synthetic-bay';
    readonly members: readonly EquipmentPanelAttackMember[];
}

export interface EquipmentPanelComponent {
    readonly componentId: ComponentId;
    readonly label: string;
    readonly equipment?: Equipment;
    readonly locations: readonly EquipmentPanelLocation[];
    readonly status: EquipmentStatus;
    readonly previewStatus: EquipmentStatus;
    /** Exact entity/rules modes; authored SVG mode labels are never authoritative. */
    readonly modes: readonly string[];
    readonly defaultMode?: string;
    readonly mode?: string;
    readonly jammed: boolean;
    /** One combat attack backed by several canonical weapon mounts. */
    readonly attack?: EquipmentPanelAttackGroup;
    /** One resolved Entity-authored bay relationship; never reconstructed by the panel. */
    readonly bay?: ComponentBayRuntimeFacts;
    readonly heatWeakened?: boolean;
    readonly modifiers?: readonly EquipmentPanelModifier[];
    readonly weapon?: EquipmentPanelWeapon;
    readonly ammo?: Readonly<{
        readonly defaultMunitionKey: string;
        readonly munitionKey: string;
        readonly displayName: string;
        readonly remaining: number;
        readonly capacity: number;
        readonly loadouts: readonly EquipmentPanelAmmoLoadout[];
        readonly hotLoaded?: boolean;
        readonly weaponTechBases?: readonly EquipmentTechBase[];
        readonly compatibilityFacts?: AmmoSelectionCompatibilityFacts;
    }>;
}

export interface EquipmentPanelTarget {
    readonly targetId: EncounterTargetId;
    readonly letter: string;
    readonly name: string;
    readonly color: string;
    readonly readOnly: boolean;
    readonly unitType?: TnTargetUnitType;
    readonly calculator?: TnTargetNumberCalculatorState;
    readonly local?: AttackerLocalTargetState;
}

export interface WeaponTargetPresentation {
    readonly rangeSelection: InventoryTargetRangeSelection | null;
    readonly targetNumberText: string;
    readonly outOfRange: boolean;
    readonly weaponToHitModifier: number;
    readonly attackerMovementModifier: number;
    readonly rangeModifier: number;
    readonly minimumRangeModifier: number;
    readonly targetModifier: number;
    readonly targetModifierBreakdown: readonly EffectiveTargetModifier[] | null;
    readonly hitResolution: ToHitResolution | null;
    readonly hitText: string;
    /** The bracket the weapon's damage is read at: the real range, never the C3-shortened one. */
    readonly damageRange: TnRangeBracket | null;
    readonly damageText: string;
    readonly targetNumberBreakdown: Readonly<{
        readonly total: number;
        readonly lines: readonly TooltipLine[];
    }> | null;
    /** How the weapon may make an aimed shot at this target; null when it may not. */
    readonly aimedShotKind: AimedShotKind | null;
    /** The aimed shot these numbers are for; null for a normal attack. */
    readonly aim: AimedShot | null;
}

/**
 * The attacking unit's facts every target number for its weapons shares, wherever it is shown: the record sheet, its
 * target menus and the equipment dialog.
 */
export interface WeaponAttackContext {
    readonly gunnery: number;
    readonly pilotingSkill: number;
    readonly movementMode: MotiveModes | null;
    readonly allowExtremeRange: boolean;
    readonly missingMovementModifier: boolean;
    readonly attackModifierBreakdown: readonly UnitModifierBreakdownEntry[];
    readonly c3DegradationSource: C3DegradationSource;
    readonly c3Available: boolean;
}

/** Converts the force target row into the detached target facts shared by sheet and panel UI. */
export function projectTargetingTarget(
    target: EquipmentPanelTarget,
    ruleset: CBTRuleset,
): TargetingTarget {
    const distance = target.local?.distance ?? 1;
    return Object.freeze({
        id: target.targetId,
        letter: target.letter,
        name: target.name,
        color: target.color,
        readOnly: target.readOnly,
        ...(target.unitType === undefined ? {} : { unitType: target.unitType }),
        distance,
        ...(target.local?.c3Distance === undefined ? {} : { c3Distance: target.local.c3Distance }),
        ...(target.local?.useC3 === true ? { useC3: true } : {}),
        tnModifier: target.local?.manualTnOverride?.modifier ?? calculateTargetTnModifier({
            unitType: target.unitType,
            range: distance,
            ...target.calculator,
            ...target.local?.calculator,
        }, gameRulesFor(ruleset)),
        ...((target.calculator !== undefined || target.local?.calculator !== undefined)
            ? { tnCalculator: Object.freeze({ ...target.calculator, ...target.local?.calculator }) }
            : {}),
        ...(target.local?.manualTnOverride === undefined
            ? partialCover(target, distance, ruleset)
            : { manualTnModifier: target.local.manualTnOverride.modifier }),
    });
}

function partialCover(target: EquipmentPanelTarget, distance: number, ruleset: CBTRuleset) {
    const cover = calculateTargetTnModifierBreakdown({
        unitType: target.unitType,
        range: distance,
        ...target.calculator,
        ...target.local?.calculator,
    }, gameRulesFor(ruleset)).find(entry => entry.id === 'partial-cover' && entry.modifier !== 0);
    return cover === undefined ? {} : {
        partialCover: Object.freeze({ modifier: cover.modifier, water: cover.partialCoverSource === 'water' }),
    };
}

/**
 * One authoritative Entity + runtime calculation for sheet and equipment target presentation. `aimAt` reads the
 * numbers for an aimed shot at that location (null: a normal attack) in place of the weapon's declared aim.
 */
export function projectWeaponTargetPresentation(
    row: EquipmentPanelComponent,
    target: TargetingTarget | null,
    attack: WeaponAttackContext,
    ruleset: CBTRuleset,
    aimAt?: string | null,
): WeaponTargetPresentation {
    const weapon = row.weapon;
    const selection = weapon?.selection;
    const manualRange = selection?.kind === 'manual-range' ? selection.range : null;
    if (!weapon) return emptyWeaponTargetPresentation();
    const rules = gameRulesFor(ruleset);
    const c3Target = target === null || attack.c3Available
        ? target
        : stripC3Distance(target);
    const c3Resolution = c3Target === null
        ? null
        : rules.resolveC3Targeting(c3Target, attack.c3DegradationSource);
    const calculationTarget = c3Resolution?.target ?? null;
    const selectedAmmo = selectedAmmoEquipment(weapon.ammoSources, weapon.ammoSelection);
    const targetNumberFacts = Object.freeze({
        componentId: row.componentId,
        physical: false,
        aerospaceWeapon: weapon.aerospace === undefined ? null : Object.freeze({
            capital: weapon.aerospace.capital,
            maxRangeBracket: weapon.aerospace.maximumBracket,
        }),
        infantryRangeModifiers: weapon.platoon?.rangeModifiers ?? null,
    });
    const display = weaponTargetDisplay(weapon);
    const rangeInput = {
        targetNumberFacts,
        display,
        extremeRange: weapon.ranges[3] ?? null,
        allowExtremeRange: attack.allowExtremeRange,
        selectedAmmo,
    } as const;
    const calculatedRangeSelection = inventoryTargetRangeSelection({
        ...rangeInput,
        target: calculationTarget,
    });
    const rangeSelection: InventoryTargetRangeSelection | null = calculatedRangeSelection ?? (manualRange === null
        ? null
        : Object.freeze({
            range: manualRange,
            maximumRange: manualRange,
            outOfRange: false,
            outOfLongRange: false,
            outOfExtremeRange: false,
            minimumRangeModifier: 0,
            distance: weapon.ranges[['short', 'medium', 'long', 'extreme'].indexOf(manualRange)] ?? 0,
            c3Distance: null,
        }));
    const weaponRangeSelection = inventoryTargetRangeSelection({
        ...rangeInput,
        target: target === null ? null : stripC3Distance(target),
    });
    const weaponRuleRange = weaponRangeSelection?.range ?? manualRange;
    const computedHit = equipmentPanelHitAtRange(
        weapon.hit,
        weaponRuleRange,
        target !== null && activeTargetCalculator(target)?.indirectFire === true,
    );
    const aiming = target === null ? null : aimedShotFacts(row, target, selectedAmmo, computedHit);
    const aimLocation = aimAt !== undefined
        ? aimAt
        : selection?.kind === 'target' && selection.targetId === target?.id ? selection.aim ?? null : null;
    const aim = aiming === null || aimLocation === null
        ? null
        : aimedShot(ruleset, aiming.weapon, aiming.target, aimLocation);
    const hitResolution = aim !== null && aimedShotIgnoresComputer(aim, aiming!.weapon)
        ? withoutTargetingComputer(computedHit)
        : computedHit;
    const attackModifierBreakdown = attack.attackModifierBreakdown;
    const attackerMovementModifier = attackModifierBreakdown.reduce(
        (total, modifier) => total + modifier.modifier,
        0,
    );
    const targetProjection = target === null
        ? null
        : effectiveWeaponTargetModifier(row, target, ruleset, rangeSelection?.range, aim);
    const targetModifier = targetProjection?.modifier ?? 0;
    const targetNumber = inventoryTargetNumberState({
        ...rangeInput,
        target: calculationTarget === null || targetProjection === null
            ? calculationTarget
            : Object.freeze({ ...calculationTarget, tnModifier: targetModifier }),
        gunnerySkill: attack.gunnery,
        pilotingSkill: attack.pilotingSkill,
        missingMovementModifier: attack.missingMovementModifier,
        attackModifierBreakdown,
        hitResolution,
        targetModifier,
        targetModifierBreakdown: targetProjection?.breakdown,
        c3DegradationSource: c3Resolution?.degradationSource ?? 'none',
        gameRules: rules,
    }, rangeSelection);
    const rangeModifier = rangeSelection === null
        ? 0
        : selectedAmmo?.category === 'Artillery' && rules.artilleryFlatRangeModifier !== null
            ? rules.artilleryFlatRangeModifier
            : rangeSelection.rangeModifier
                ?? ({ short: 0, medium: 2, long: 4, extreme: 6 } as const)[rangeSelection.range];
    const weaponToHitModifier = typeof hitResolution.value === 'number' ? hitResolution.value : 0;
    return Object.freeze({
        rangeSelection,
        targetNumberText: targetNumber.text,
        outOfRange: rangeSelection?.outOfRange === true,
        weaponToHitModifier,
        attackerMovementModifier,
        rangeModifier,
        minimumRangeModifier: rangeSelection?.minimumRangeModifier ?? 0,
        targetModifier,
        targetModifierBreakdown: targetProjection?.breakdown ?? null,
        hitResolution,
        hitText: formatEquipmentPanelHit(hitResolution, attackModifierBreakdown, target !== null, weaponRuleRange !== null),
        damageRange: weaponRuleRange,
        damageText: weaponRuleRange === null
            ? weapon.damageText
            : weapon.damageTextByRange[weaponRuleRange],
        targetNumberBreakdown: targetNumber.breakdown === null
            ? null
            : Object.freeze({
                total: targetNumber.breakdown.total,
                lines: Object.freeze([...targetNumber.breakdown.lines]),
            }),
        aimedShotKind: aiming === null ? null : aimedShotKind(ruleset, aiming.weapon, aiming.target),
        aim,
    });
}

/**
 * What the aimed-shot rules read of a weapon and its target. Under a manual target number nothing says whether the
 * target is immobile or in cover, so there is no aimed shot; a target with no facts set is mobile and in the open.
 */
function aimedShotFacts(
    row: EquipmentPanelComponent,
    target: TargetingTarget,
    selectedAmmo: AmmoEquipment | null,
    hit: ToHitResolution,
): Readonly<{ weapon: AimedShotWeapon; target: AimedShotTarget }> | null {
    const equipment = row.equipment;
    if (target.manualTnModifier !== undefined || !(equipment instanceof WeaponEquipment)) return null;
    const calculator = activeTargetCalculator(target) ?? {};
    return Object.freeze({
        weapon: Object.freeze({
            types: resolveEffectiveWeaponTypes(row, selectedAmmo),
            // A platoon and a machine gun array roll the Cluster Hits Table; rapid fire is one shot or a burst.
            singleHit: row.weapon?.platoon === undefined
                && !equipment.hasFlag('F_MGA')
                && rapidFireAutocannonShotCount(equipment, row.mode) === 1,
            computerAided: hit.modifierBreakdown.some(entry => entry.kind === 'targeting-computer'),
        }),
        target: Object.freeze({
            unitType: target.unitType,
            immobile: calculator.immobile === true,
            indirectFire: calculator.indirectFire === true,
            partialCover: target.partialCover !== undefined,
        }),
    });
}

/** The weapon's to-hit without its targeting computer's -1, for the aimed shots that go without it. */
function withoutTargetingComputer(hit: ToHitResolution): ToHitResolution {
    const computer = hit.modifierBreakdown.find(entry => entry.kind === 'targeting-computer');
    if (!computer || typeof hit.value !== 'number') return hit;
    return Object.freeze({
        ...hit,
        profile: Object.freeze(hit.profile.map(value => value - computer.modifier)),
        value: hit.value - computer.modifier,
        modifierBreakdown: Object.freeze(hit.modifierBreakdown.filter(entry => entry !== computer)),
    });
}

/** Resolves every selectable range once in the Entity/rules projection. */
export function projectEquipmentPanelHit(
    rules: CBTGameRules,
    request: ToHitRequest,
    indirectAdjustments: readonly ToHitAdjustment[] = request.adjustments ?? [],
): EquipmentPanelHitResolution {
    const byRange = resolveEquipmentPanelHitsByRange(rules, request, request.adjustments);
    const indirectByRange = indirectAdjustments === request.adjustments
        ? byRange
        : resolveEquipmentPanelHitsByRange(rules, request, indirectAdjustments);
    return Object.freeze({
        default: Object.freeze(rules.resolveToHit(request)),
        byRange,
        indirectByRange,
    });
}

/** Formats the exact damage profile used by the equipment table and targets. */
export function projectEquipmentPanelWeaponDamage(
    equipmentCatalog: EquipmentRegistry,
    componentId: ComponentId,
    weapon: WeaponEquipment,
    selectedAmmo: AmmoEquipment | null,
    damageOverride: WeaponEquipment['damage'],
    effectiveWeaponTypes: readonly WeaponType[],
    maximumMultiplier = 1,
): EquipmentPanelWeaponDamage {
    const ammoProfile = resolveAmmoWeaponProfile(selectedAmmo);
    const component = Object.freeze({ componentId, physical: false, weapon });
    const context = {
        selectedAmmo,
        ammoProfile,
        equipmentCatalog,
        damageOverride,
    } as const;
    const rules = {
        applyWeaponTypes: () => new Set(effectiveWeaponTypes),
        ...(maximumMultiplier <= 1 ? {} : {
            applyDamageEffects: (_componentId: ComponentId, damage: WeaponDamage) => ({
                ...damage,
                maximum: damage.maximum * maximumMultiplier,
                unit: 'shot' as const,
            }),
        }),
    } as const;
    const resolveAt = (range: TnRangeBracket | null) =>
        resolveInventoryControlWeaponDamage(component, {
            ...context,
            selectedRange: inventoryControlDamageRange(range),
        }, rules);
    const byRange = AEROSPACE_RANGE_BRACKETS.map(range => [range, resolveAt(range)] as const);
    return Object.freeze({
        default: resolveAt(null)?.text ?? '—',
        byRange: Object.freeze(Object.fromEntries(byRange.map(([range, resolved]) => [
            range,
            resolved?.text ?? '—',
        ])) as Record<TnRangeBracket, string>),
        valuesByRange: Object.freeze(Object.fromEntries(byRange.map(([range, resolved]) => [
            range,
            resolved?.damage ?? null,
        ])) as Record<TnRangeBracket, WeaponDamage | null>),
    });
}

function resolveEquipmentPanelHitsByRange(
    rules: CBTGameRules,
    request: ToHitRequest,
    adjustments: readonly ToHitAdjustment[] | undefined,
): Readonly<Record<TnRangeBracket, ToHitResolution>> {
    return Object.freeze(Object.fromEntries(AEROSPACE_RANGE_BRACKETS.map(range => [
        range,
        Object.freeze(rules.resolveToHit({ ...request, range, adjustments })),
    ])) as Record<TnRangeBracket, ToHitResolution>);
}

function equipmentPanelHitAtRange(
    hit: EquipmentPanelHitResolution,
    range: TnRangeBracket | null,
    indirect: boolean,
): ToHitResolution {
    if (range === null) return hit.default;
    return (indirect ? hit.indirectByRange : hit.byRange)[range];
}

function weaponTargetDisplay(weapon: EquipmentPanelWeapon): Readonly<{
    min: string;
    short: string;
    medium: string;
    long: string;
}> {
    const ranges = weapon.aerospace?.rangeLimits ?? weapon.ranges;
    return Object.freeze({
        min: weapon.aerospace === undefined ? weapon.minimumRange.toString() : '—',
        short: ranges[0]?.toString() ?? '—',
        medium: ranges[1]?.toString() ?? '—',
        long: ranges[2]?.toString() ?? '—',
    });
}

function stripC3Distance(target: TargetingTarget): TargetingTarget {
    const { c3Distance: _c3Distance, useC3: _useC3, ...withoutC3 } = target;
    return Object.freeze(withoutC3);
}

function formatEquipmentPanelHit(
    resolution: ToHitResolution,
    attackModifierBreakdown: readonly UnitModifierBreakdownEntry[],
    hasTarget: boolean,
    hasSelectedRange: boolean,
): string {
    const attackModifier = attackModifierBreakdown.reduce((total, entry) => total + entry.modifier, 0);
    if (!hasTarget && !hasSelectedRange && resolution.profile.length > 1) {
        return resolution.profile
            .map(value => formatSignedModifier(value + attackModifier))
            .join('/');
    }
    const value = resolution.value;
    if (value === null) return '';
    if (value === 'Vs') {
        if (resolution.modifierBreakdown.length === 0 && attackModifier === 0) return value;
        const modifier = resolution.modifierBreakdown.reduce(
            (total, entry) => total + entry.modifier,
            attackModifier,
        );
        const prefix = resolution.modifierBreakdown.length > 0 ? 'VS' : value;
        return `${prefix}${formatSignedModifier(modifier)}`;
    }
    return typeof value === 'number' ? formatSignedModifier(value + attackModifier) : value;
}

function formatSignedModifier(value: number): string {
    return value >= 0 ? `+${value}` : value.toString();
}

function emptyWeaponTargetPresentation(): WeaponTargetPresentation {
    return Object.freeze({
        rangeSelection: null,
        targetNumberText: '',
        outOfRange: false,
        weaponToHitModifier: 0,
        attackerMovementModifier: 0,
        rangeModifier: 0,
        minimumRangeModifier: 0,
        targetModifier: 0,
        targetModifierBreakdown: null,
        hitResolution: null,
        hitText: '',
        damageRange: null,
        damageText: '—',
        targetNumberBreakdown: null,
        aimedShotKind: null,
        aim: null,
    });
}

export type EffectiveTargetModifier = Omit<TnTargetModifierBreakdownEntry, 'id'> & {
    readonly id: TnTargetModifierBreakdownEntry['id'] | 'precision' | 'aimed-shot';
    readonly ignored?: true;
};
interface EffectiveWeaponTargetProjection {
    readonly modifier: number;
    readonly breakdown: readonly EffectiveTargetModifier[] | null;
}
const FLAK_TARGET_UNIT_TYPES = new Set<TnTargetUnitType>(['aero', 'vtol-wige']);
const PRECISION_AMMO_TYPES = new Set<AmmoType>(['AC', 'LAC', 'AC_IMP', 'PAC']);

function effectiveWeaponTargetModifier(
    row: EquipmentPanelComponent,
    target: TargetingTarget,
    ruleset: CBTRuleset,
    rangeBracket?: TnRangeBracket,
    aim: AimedShot | null = null,
): EffectiveWeaponTargetProjection {
    const weapon = row.weapon;
    // An aimed shot at a target with no facts set still has its own modifier to add.
    const calculator = activeTargetCalculator(target) ?? (aim === null ? undefined : {});
    const selectedAmmo = selectedAmmoEquipment(weapon?.ammoSources ?? [], weapon?.ammoSelection);
    if (!calculator) return Object.freeze({ modifier: target.tnModifier, breakdown: null });
    const rules = gameRulesFor(ruleset);
    const raw = calculateTargetTnModifierBreakdown({
        ...calculator,
        unitType: target.unitType,
        range: target.distance,
    }, rules);
    const effectiveWeaponTypes = resolveEffectiveWeaponTypes(row, selectedAmmo);
    const attackTraits = weaponTargetAttackTraits(row.equipment, selectedAmmo, effectiveWeaponTypes);
    let effective: EffectiveTargetModifier[] = calculateTargetTnModifierBreakdown({
        ...calculator,
        unitType: target.unitType,
        range: target.distance,
        rangeBracket,
        attackerIsConventionalInfantry: weapon?.attackerIsConventionalInfantry === true,
    }, rules).map(modifier => ({
        ...modifier,
        ...((modifier.partialCoverSource === 'water' && weapon?.attackerSubmerged === true)
            || (modifier.id === 'battle-armor' && weapon?.attackerIsConventionalInfantry === true)
            || (modifier.id === 'immobile' && !rules.attackBenefitsFromImmobile(attackTraits))
            ? { ignored: true as const }
            : {}),
    }));
    if (calculator.isAirborne === true
        && target.unitType !== undefined
        && FLAK_TARGET_UNIT_TYPES.has(target.unitType)
        && effectiveWeaponTypes.includes('F')) {
        effective.push({ id: 'flak', label: 'Flak', modifier: -2 });
    }
    if (aim !== null) {
        // An aimed shot takes no partial-cover modifier; one at the head trades the immobile -4 for +3, as does
        // one a targeting computer aims at a mobile target, which has no -4 to trade.
        effective = effective.map(modifier => ({
            ...modifier,
            ...(modifier.id === 'partial-cover' || (aim.head && modifier.id === 'immobile')
                ? { ignored: true as const }
                : {}),
        }));
        if (aim.head || aim.kind === 'targeting-computer') {
            effective.push({
                id: 'aimed-shot',
                label: aim.head ? 'Aimed shot (head)' : 'Aimed shot',
                modifier: AIMED_SHOT_MODIFIER,
            });
        }
    }
    if (!selectedAmmo) {
        return targetModifierProjection(target, raw, effective);
    }
    const narcCapable = selectedAmmo.hasMunitionType('M_NARC_CAPABLE');
    const guidance = resolveTargetGuidance(calculator, target.unitType, {
        semiGuided: selectedAmmo.hasMunitionType('M_SEMIGUIDED'),
        narcCapableAboveWater: narcCapable && row.weapon?.underwater !== true,
        narcCapableUnderwater: narcCapable && row.weapon?.underwater === true,
    }, rules);
    const noSpotter = guidance.narc && calculator.indirectFire === true;
    if (noSpotter || (calculator.indirectFire && guidance.semiGuided)) {
        effective = effective.map(modifier => ({
            ...modifier,
            ...((guidance.narc && modifier.ignoredByNarcGuidance === true)
                || (guidance.semiGuided && modifier.ignoredBySemiGuidedGuidance === true)
                ? { ignored: true as const }
                : {}),
        }));
    }
    if (guidance.semiGuided && !calculator.indirectFire && rules.semiGuidedIgnoresCover) {
        effective = effective.map(modifier => ({
            ...modifier,
            ...(modifier.adjustmentGroup === 'partial-cover' ? { ignored: true as const } : {}),
        }));
    }
    const adjustments: EffectiveTargetModifier[] = [];
    if (guidance.semiGuided) {
        const adjustment = ([
            ['movement', 'target-movement'],
            ['terrain', 'terrain'],
        ] as const).reduce((total, [source, group]) => {
            const value = effective
                .filter(modifier => modifier.ignored !== true && modifier.adjustmentGroup === group)
                .reduce((sum, modifier) => sum + modifier.modifier, 0);
            return total + rules.getSemiGuidedAdjustment(value, source);
        }, 0);
        const indirect = calculator.indirectFire && rules.semiGuidedIgnoresIndirectFireModifier
            ? TN_INDIRECT_FIRE_MODIFIER
            : 0;
        const modifier = -(adjustment + indirect);
        if (modifier !== 0) adjustments.push({ id: 'semi-guided', label: 'Semi-Guided', modifier });
    }
    if (guidance.narc && !calculator.indirectFire && rules.narcHomingTargetModifier !== 0) {
        adjustments.push({ id: 'narc', label: 'NARC', modifier: rules.narcHomingTargetModifier });
    }
    const precision = precisionAmmoTargetModifier(row, selectedAmmo, raw);
    if (precision !== null) adjustments.push(precision);
    return targetModifierProjection(target, raw, [...effective, ...adjustments]);
}

function targetModifierProjection(
    target: TargetingTarget,
    raw: readonly TnTargetModifierBreakdownEntry[],
    effective: readonly EffectiveTargetModifier[],
): EffectiveWeaponTargetProjection {
    return Object.freeze({
        modifier: target.tnModifier + sumTargetModifiers(effective) - sumTargetModifiers(raw),
        breakdown: Object.freeze(effective.map(entry => Object.freeze({ ...entry }))),
    });
}

function sumTargetModifiers(entries: readonly EffectiveTargetModifier[]): number {
    return entries.reduce(
        (total, modifier) => total + (modifier.ignored === true ? 0 : modifier.modifier),
        0,
    );
}

export function resolveEffectiveWeaponTypes(
    row: EquipmentPanelComponent,
    selectedAmmo: AmmoEquipment | null,
): readonly WeaponType[] {
    if (row.weapon?.effectiveWeaponTypes) return row.weapon.effectiveWeaponTypes;
    if (!(row.equipment instanceof WeaponEquipment)) return [];
    return equipmentPanelWeaponTypes(row.equipment, selectedAmmo);
}

/** Base weapon/ammunition types shared by all Entity family projections. */
export function equipmentPanelWeaponTypes(
    weapon: WeaponEquipment,
    selectedAmmo: AmmoEquipment | null,
): readonly WeaponType[] {
    const types = new Set(weapon.getWeaponTypes());
    selectedAmmo?.getRemovedDamageTypes().forEach(type => types.delete(type));
    selectedAmmo?.getWeaponTypes().forEach(type => types.add(type));
    return [...types];
}

function precisionAmmoTargetModifier(
    row: EquipmentPanelComponent,
    selectedAmmo: AmmoEquipment,
    raw: readonly TnTargetModifierBreakdownEntry[],
): EffectiveTargetModifier | null {
    const weapon = row.equipment;
    if (!(weapon instanceof WeaponEquipment)
        || !selectedAmmo.hasMunitionType('M_PRECISION')
        || !PRECISION_AMMO_TYPES.has(weapon.ammoType)
        || !PRECISION_AMMO_TYPES.has(selectedAmmo.ammoType)
        || !ammoMatchesWeapon(weapon, selectedAmmo)) return null;
    const movement = getTnTargetModifierGroupTotals(raw)['target-movement'];
    const modifier = -Math.min(2, Math.max(0, movement));
    return modifier === 0 ? null : { id: 'precision', label: 'Precision', modifier };
}

export function selectedAmmoEquipment(
    ammoSources: readonly EquipmentPanelAmmoSource[],
    selection?: AttackerAmmoSelection,
): AmmoEquipment | null {
    const sources = selection?.preferredSourceId === undefined
        ? ammoSources
        : ammoSources.filter(source => source.componentId === selection.preferredSourceId);
    for (const source of sources) {
        const munitionKey = selection?.munitionKey ?? source.munitionKey;
        const loadout = source.loadouts.find(candidate => candidate.munitionKey === munitionKey);
        if (loadout) return loadout.equipment;
    }
    return null;
}

export function selectedAmmoIsHotLoaded(
    ammoSources: readonly EquipmentPanelAmmoSource[],
    selection?: AttackerAmmoSelection,
): boolean {
    const source = ammoSources.find(source => source.remaining > 0 && source.status === 'available'
        && (selection?.preferredSourceId === undefined || source.componentId === selection.preferredSourceId)
        && (selection?.munitionKey === undefined || source.munitionKey === selection.munitionKey)
        && source.loadouts.some(loadout => loadout.munitionKey === source.munitionKey));
    return source?.hotLoaded === true;
}

/** A weapon's own to-hit modifier, and whether damage or other impairment weakened it (shown red). */
export function equipmentWeaponToHit(
    row: EquipmentPanelComponent,
    target: TargetingTarget | null = null,
    range: TnRangeBracket | null = null,
): Readonly<{ modifier: number; weakened: boolean }> {
    if (row.weapon?.hit !== undefined) {
        const indirect = target !== null
            && activeTargetCalculator(target)?.indirectFire === true;
        const resolution = equipmentPanelHitAtRange(row.weapon.hit, range, indirect);
        return Object.freeze({
            modifier: typeof resolution.value === 'number' ? resolution.value : 0,
            weakened: resolution.weakened,
        });
    }
    const modifier = row.weapon?.toHitModifier ?? row.equipment?.toHitModifier;
    const base = typeof modifier === 'number'
        ? modifier
        : Array.isArray(modifier)
            ? modifier[Math.max(0, row.mode === undefined ? 0 : row.modes.indexOf(row.mode))]
                ?? modifier[0]
                ?? 0
            : 0;
    const indirect = target !== null
        && activeTargetCalculator(target)?.indirectFire === true;
    return Object.freeze({ modifier: indirect ? base - (row.weapon?.artemisVModifier ?? 0) : base, weakened: false });
}

export interface MekPhysicalAttackRow {
    readonly target: AttackerActionTarget;
    /** The printed name, without the kicking leg the label adds. */
    readonly name?: string;
    readonly label: string;
    readonly locationIds: readonly LocationId[];
    readonly locationCodes: readonly string[];
    readonly hitModifiers: readonly EntityWeaponHitModifier[];
    readonly hitModifierBreakdown: readonly ToHitModifierBreakdownEntry[];
    readonly available: boolean;
    readonly selectable: boolean;
    readonly effect: MekPhysicalAttackEffectV2;
    readonly firingHeat: number;
    /** Whether Depth 1 water around a standing target covers it from this attack (`physicalAttackMeetsWaterCover`). */
    readonly meetsWaterCover: boolean;
    /** Whether a building's partial cover counts against this attack (`physicalAttackMeetsBuildingCover`). */
    readonly meetsBuildingCover?: boolean;
    /** The resolvable attack; null for an attack the resolution does not roll. */
    readonly kind?: PhysicalAttackKind | null;
    /** The table the attack strikes a standing 'Mech on (`physicalHitTable`); the standard table when absent. */
    readonly hitTable?: HitTable;
    /** Targets this attack reaches only in the attacker's hex (`physicalTargetIssue`). */
    readonly reach?: PhysicalAttackReach;
    /** The one target the attack may be made at: the unit a swarming unit clings to. */
    readonly onlyTarget?: string;
    /** Damage points that share a hit-location roll, where the attack's kind does not say (`physicalDamageGroupSize`). */
    readonly damageGroupSize?: number;
    /** A hit also rolls on the Determining Critical Hits Table: a leg attack, and battle armor's swarm damage. */
    readonly critical?: true;
    readonly selection?: AttackerSelection;
}

/** Whether the row may be declared at the target: its reach, and the one target a swarming unit attacks. */
export function physicalRowTargetIssue(
    row: Pick<MekPhysicalAttackRow, 'kind' | 'reach' | 'onlyTarget'>,
    target: Parameters<typeof physicalTargetIssue>[2] & Readonly<{ id: string }>,
): ReturnType<typeof physicalTargetIssue> {
    return row.onlyTarget !== undefined && row.onlyTarget !== target.id
        ? 'invalid'
        : physicalTargetIssue(row.kind, row.reach, target);
}

/**
 * A physical attack's target number against one target: Piloting plus the attack's, the attacker's and the
 * target's modifiers. Charges and DFAs also take the comparative Piloting modifier, so they need the target's
 * skill; without it there is no number. Infantry have no Piloting Skill, so a DFA against them compares none
 * (TW p. 144).
 */
export function physicalAttackTargetNumber(
    row: PhysicalAttackTargetRow,
    piloting: number,
    attack: Pick<WeaponAttackContext, 'attackModifierBreakdown'> | null,
    target: PhysicalAttackTarget,
    comparative?: Readonly<{ piloting: number; immobile: boolean }>,
): number | null {
    if (physicalAttackAlwaysHits(row.kind)) return 0;
    const [base, extra] = row.hitModifiers;
    const attackModifier = !physicalAttackTakesMovement(row.kind) ? 0
        : (attack?.attackModifierBreakdown ?? []).reduce((total, item) => total + item.modifier, 0);
    const targetModifier = physicalAttackTargetModifiers(row, target).reduce((total, item) => total + item.modifier, 0);
    if (typeof base === 'number') return piloting + base + attackModifier + targetModifier;
    if (base !== 'versus') return null;
    const versus = row.kind === 'death-from-above' && infantryTarget(target.unitType) ? 0
        : comparative && comparativePilotingModifier(piloting, comparative.piloting, comparative.immobile);
    if (versus === undefined) return null;
    return piloting + versus + (typeof extra === 'number' ? extra : 0) + attackModifier + targetModifier;
}

type PhysicalAttackTargetRow = Pick<MekPhysicalAttackRow, 'hitModifiers'>
    & Partial<Pick<MekPhysicalAttackRow, 'meetsWaterCover' | 'meetsBuildingCover' | 'kind'>>;
type PhysicalAttackTarget = Pick<TargetingTarget, 'tnModifier' | 'partialCover' | 'unitType' | 'tnCalculator'>;

/**
 * The target's part of a physical attack's target number: its modifier, less Depth 1 water cover the attack does
 * not meet, and +3 for kicking or DFAing infantry (`physicalTargetModifier`).
 */
export function physicalAttackTargetModifiers(
    row: PhysicalAttackTargetRow,
    target: PhysicalAttackTarget,
): readonly Readonly<{ label: string; modifier: number }>[] {
    // A brush off is the swarmed 'Mech's own Piloting Skill Roll: only magnetic claws make it harder (TW p. 222).
    if (row.kind === 'brush-off') {
        return Object.freeze(target.tnCalculator?.magneticClaws === true
            ? [Object.freeze({ label: 'Magnetic Claws', modifier: MAGNETIC_CLAW_SHAKE_OFF_MODIFIER })]
            : []);
    }
    const uncovered = target.partialCover !== undefined && !physicalAttackMeetsPartialCover(row, target)
        ? target.partialCover.modifier : 0;
    const unitType = physicalTargetModifier(row.kind ?? null, target.unitType);
    return Object.freeze([
        Object.freeze({ label: 'Target', modifier: target.tnModifier - uncovered }),
        ...(unitType === null ? [] : [unitType]),
    ]);
}

/**
 * Whether the target's partial cover counts against a physical attack: its +1 is in the target number, and a hit on
 * the standard table that resolves to a leg strikes the cover (TW p. 102; Core pp. 66, 77).
 */
export function physicalAttackMeetsPartialCover(
    row: Partial<Pick<MekPhysicalAttackRow, 'meetsWaterCover' | 'meetsBuildingCover'>>,
    target: Pick<TargetingTarget, 'partialCover'>,
): boolean {
    if (target.partialCover === undefined) return false;
    return (target.partialCover.water ? row.meetsWaterCover : row.meetsBuildingCover) !== false;
}

export type MekPhysicalAttackPresentation =
    | Readonly<{
        kind: 'supported';
        attacks: readonly MekPhysicalAttackRow[];
    }>
    | Readonly<{
        kind: 'unsupported';
        blockers: readonly string[];
    }>;

export function projectMekPhysicalAttackPresentation(
    entity: MekEntity,
    index: MekRuntimeIndex,
    ruleset: CBTRuleset,
    query: MekUnitQueryPort,
    targeting: AttackerTargetingState,
    modifiers: MekAttackModifierSets,
): MekPhysicalAttackPresentation {
    const projection = query.mekPhysicalAttacks();
    if (projection.kind === 'unsupported') return projection;
    const water = mekUnitWaterState(entity, query);
    const prone = query.hasCondition('prone');
    const swarmed = query.hasCondition('swarmed');
    const kindOf = (target: AttackerActionTarget): PhysicalAttackKind | null => target.kind === 'component'
        ? 'weapon'
        : PHYSICAL_ATTACK_KINDS.find(candidate =>
            candidate === entity.intrinsicWeapons().find(weapon => weapon.id === target.actionId)?.kind) ?? null;
    const hitTable = (target: AttackerActionTarget) => {
        const kind = kindOf(target);
        if (kind === null) return 'standard';
        const equipment = target.kind === 'component'
            ? index.components.get(target.componentId)?.mount?.equipment
            : undefined;
        return physicalHitTable(kind, equipment !== undefined && isHandClawFlags(equipment.flags));
    };
    return Object.freeze({
        kind: 'supported',
        // Thrashing is listed only while the 'Mech is prone, the only time it can thrash; brushing infantry off only
        // while it is swarmed.
        attacks: Object.freeze(projection.attacks.filter(attack => (prone || kindOf(attack.target) !== 'thrash')
            && (swarmed || kindOf(attack.target) !== 'brush-off')).map(attack => {
            const kind = kindOf(attack.target);
            const reach: PhysicalAttackReach | undefined = kind === 'thrash'
                ? swarmed ? 'unswarming-infantry-in-hex' : 'infantry-in-hex'
                : kind === 'punch' && prone ? 'vehicle-in-hex'
                    : kind === 'brush-off' ? 'swarming-infantry' : undefined;
            const selection = attack.selectable
                ? attackerActionSelection(targeting, attack.target)
                : undefined;
            const hit = physicalAttackHitResolution(
                index,
                attack.target,
                ruleset,
                modifiers.physical,
                modifiers.combat,
            );
            return Object.freeze({
                ...attack,
                hitModifiers: hit.modifiers,
                hitModifierBreakdown: hit.breakdown,
                meetsWaterCover: physicalAttackMeetsWaterCover(ruleset, kind, hitTable(attack.target), water),
                meetsBuildingCover: physicalAttackMeetsBuildingCover(ruleset, kind, hitTable(attack.target)),
                kind,
                hitTable: hitTable(attack.target),
                ...(reach === undefined ? {} : { reach }),
                available: attack.selectable
                    ? canPerformMekAction(
                        entity,
                        index,
                        query,
                        attack.target,
                        'physical-attack',
                        ruleset,
                    )
                    : attack.target.kind === 'component'
                        && query.componentStatus(attack.target.componentId) === 'available',
                ...(selection === undefined ? {} : { selection }),
            });
        })),
    });
}

function physicalAttackHitResolution(
    index: MekRuntimeIndex,
    target: AttackerActionTarget,
    ruleset: CBTRuleset,
    stateModifiers: readonly ToHitModifierBreakdownEntry[],
    combatModifiers: MekCombatModifierProjectionResult,
): Readonly<{
    modifiers: readonly EntityWeaponHitModifier[];
    breakdown: readonly ToHitModifierBreakdownEntry[];
}> {
    const rules = gameRulesFor(ruleset);
    if (target.kind === 'intrinsic') {
        const action = index.intrinsicActions.find(candidate => candidate.id === target.actionId);
        if (!action) return Object.freeze({ modifiers: Object.freeze([]), breakdown: Object.freeze([]) });
        if (action.hitModifierAdjustment === 'variable') {
            return Object.freeze({
                modifiers: Object.freeze(['variable' as const]),
                breakdown: Object.freeze([...stateModifiers]),
            });
        }
        const subject: ComponentToHitSubject = Object.freeze({
            kind: 'component',
            componentId: asComponentId(action.id),
            source: Object.freeze({ kind: 'intrinsic', actionKind: action.kind }),
            locations: action.locations,
            targetingComputerWeapon: null,
            targetingComputer: null,
        });
        const fallbackAdjustment = typeof action.hitModifierAdjustment === 'number'
            && action.hitModifierAdjustment !== 0
            ? [Object.freeze({
                label: action.name,
                modifier: action.hitModifierAdjustment,
            })]
            : [];
        const actionModifiers = combatModifiers.kind === 'supported'
            ? combatModifiers.intrinsic.get(action.id) ?? []
            : fallbackAdjustment;
        const resolution = rules.resolveToHit({
            subject,
            stateModifiers: combineAttackModifiers(stateModifiers, actionModifiers),
        });
        const modifiers: EntityWeaponHitModifier[] = resolution.value === 'Vs'
            ? ['versus']
            : typeof resolution.value === 'number' ? [resolution.value] : [];
        if (resolution.value === 'Vs') {
            const modifier = resolution.modifierBreakdown.reduce((sum, item) => sum + item.modifier, 0);
            if (modifier !== 0) modifiers.push(modifier);
        }
        return Object.freeze({
            modifiers: Object.freeze(modifiers),
            breakdown: Object.freeze([...resolution.modifierBreakdown]),
        });
    }
    const equipment = equipmentForComponent(index, target.componentId);
    if (!equipment) return Object.freeze({ modifiers: Object.freeze([]), breakdown: Object.freeze([]) });
    const componentModifiers = combatModifiers.kind === 'supported'
        ? combatModifiers.components.get(target.componentId) ?? []
        : [];
    const resolution = rules.resolveToHit({
        subject: equipment,
        stateModifiers: combineAttackModifiers(stateModifiers, componentModifiers),
    });
    const modifiers: EntityWeaponHitModifier[] = resolution.value === 'Vs'
        ? ['versus']
        : typeof resolution.value === 'number' ? [resolution.value] : [];
    return Object.freeze({
        modifiers: Object.freeze(modifiers),
        breakdown: Object.freeze([...resolution.modifierBreakdown]),
    });
}

/**
 * Total equipment-panel read model. Definition facts come from the entity,
 * mutable facts from the sparse runtime query, and target names from the
 * force-owned target registry. SVG nodes are display-only and never inputs.
 */
export interface EquipmentPanelSnapshot {
    readonly entityUuid: UnitUuid;
    readonly ruleset: CBTRuleset;
    readonly stateRevision: number;
    readonly targetRegistryRevision: number;
    readonly displayName: string;
    readonly unitType: UnitType;
    readonly tracksHeat: boolean;
    readonly heat: Readonly<{
        readonly current: number;
        readonly pending: number | null;
        readonly sinksOff: number;
    }>;
    readonly crew: Readonly<{
        readonly gunnery: number;
        readonly piloting: number;
    }>;
    readonly components: readonly EquipmentPanelComponent[];
    readonly physicalAttacks: readonly MekPhysicalAttackRow[];
    readonly equipmentRowOrder?: EquipmentRowOrderState;
    readonly physicalAttackBlockers: readonly string[];
    readonly targets: readonly EquipmentPanelTarget[];
    /** Present when the unit has bomb hardpoints. */
    readonly bombs?: EquipmentPanelBombs;
}

export interface EquipmentPanelBombs {
    readonly capacity: BombCapacity;
    readonly loads: readonly BombLoad[];
}

/** The weapon rows selected to fire. */
export function selectedWeaponRows(components: readonly EquipmentPanelComponent[]): readonly EquipmentPanelComponent[] {
    return components.filter(row => row.status === 'available'
        && row.weapon?.selectable === true
        && row.weapon.selection !== undefined);
}

export function selectedWeaponHeat(
    snapshot: Pick<EquipmentPanelSnapshot, 'components' | 'physicalAttacks'>,
): Readonly<{ hasSelection: boolean; value: number }> {
    const selected = selectedWeaponRows(snapshot.components);
    const selectedPhysical = snapshot.physicalAttacks.filter(row =>
        row.available
        && row.selectable
        && row.selection !== undefined
        && row.firingHeat > 0);
    return Object.freeze({
        hasSelection: selected.length > 0 || selectedPhysical.length > 0,
        value: selected.reduce((total, row) => total + (row.weapon?.firingHeat ?? 0), 0)
            + selectedPhysical.reduce((total, row) => total + row.firingHeat, 0),
    });
}

function mekTurnAttackModifiers(
    entity: MekEntity,
    index: MekRuntimeIndex,
    ruleset: CBTRuleset,
    query: MekUnitQueryPort,
): readonly ToHitModifierBreakdownEntry[] {
    const modifiers: ToHitModifierBreakdownEntry[] = [];
    if (gameRulesFor(ruleset).supportsSkidding && query.hasCondition('skidding')) {
        modifiers.push({ label: 'Skidding', modifier: TN_SKIDDING_ATTACKER });
    }
    if (query.turnState().spotting) {
        const modifier = projectMekSpottingModifier(entity, index, query);
        if (modifier !== 0) modifiers.push({ label: 'Spotting', modifier });
    }
    return Object.freeze(modifiers.map(modifier => Object.freeze(modifier)));
}

/** The attack modifiers every ranged and physical row of one Mek state shares. */
export interface MekAttackModifierSets {
    readonly combat: MekCombatModifierProjectionResult;
    readonly ranged: readonly ToHitModifierBreakdownEntry[];
    readonly physical: readonly ToHitModifierBreakdownEntry[];
}

export function mekAttackModifierSets(
    entity: MekEntity,
    index: MekRuntimeIndex,
    ruleset: CBTRuleset,
    query: MekUnitQueryPort,
): MekAttackModifierSets {
    const combat = query.mekCombatModifiers();
    const turnModifiers = mekTurnAttackModifiers(entity, index, ruleset, query);
    return Object.freeze({
        combat,
        ranged: combineAttackModifiers(
            combat.kind === 'supported' ? combat.ranged : [],
            turnModifiers,
            voidSignatureWeaponModifiers(query),
        ),
        physical: combineAttackModifiers(
            combat.kind === 'supported' ? combat.physical : [],
            turnModifiers,
        ),
    });
}

/** The one Mek equipment projection: the dialog panel, and the record sheet's rows and targets. */
export function projectMekEquipmentPanel(
    entity: MekEntity,
    index: MekRuntimeIndex,
    ruleset: CBTRuleset,
    query: MekUnitQueryPort,
    registry: TargetRegistrySnapshot,
    optionalRules: OptionalRules,
    modifiers: MekAttackModifierSets = mekAttackModifierSets(entity, index, ruleset, query),
): EquipmentPanelSnapshot {
    const targeting = query.attackerTargetingState();
    const targets = projectEquipmentTargets(targeting, registry);
    const components = projectMekEquipmentComponents(
        entity,
        index,
        ruleset,
        query,
        targeting,
        targets,
        modifiers,
        optionalRules,
    );
    const physicalProjection = projectMekPhysicalAttackPresentation(
        entity, index, ruleset, query, targeting, modifiers,
    );
    const physicalAttacks = physicalProjection.kind === 'unsupported'
        ? Object.freeze([])
        : physicalProjection.attacks;
    const heat = query.heatState();
    const firstCrew = query.crewAssignment().positions
        .slice()
        .sort((left, right) => compareText(left.positionId, right.positionId))[0];
    const equipmentRowOrder = query.equipmentRowOrder?.();
    return Object.freeze({
        entityUuid: entity.uuid(),
        ruleset,
        stateRevision: query.stateRevision,
        targetRegistryRevision: registry.revision,
        displayName: entity.displayName(),
        unitType: entity.unitType(),
        tracksHeat: entity.tracksHeat(),
        heat: Object.freeze({
            current: heat.current,
            pending: heat.pendingOverride ?? null,
            sinksOff: heat.heatsinksOff,
        }),
        crew: Object.freeze({
            gunnery: firstCrew?.gunnery ?? 4,
            piloting: firstCrew?.piloting ?? 5,
        }),
        components,
        physicalAttacks,
        ...(equipmentRowOrder === undefined ? {} : { equipmentRowOrder }),
        physicalAttackBlockers: physicalProjection.kind === 'unsupported'
            ? physicalProjection.blockers
            : Object.freeze([]),
        targets,
    });
}

export function projectEquipmentTargets(
    targeting: AttackerTargetingState,
    registry: TargetRegistrySnapshot,
): readonly EquipmentPanelTarget[] {
    return Object.freeze(registry.targets.map(target => Object.freeze({
        targetId: target.id,
        letter: target.letter,
        name: target.name,
        color: target.color,
        readOnly: target.readOnly === true,
        ...(target.unitType === undefined ? {} : { unitType: target.unitType }),
        ...(target.tnCalculator === undefined
            ? {}
            : { calculator: Object.freeze({ ...target.tnCalculator }) }),
        ...(targeting.targets.get(target.id) === undefined
            ? {}
            : { local: targeting.targets.get(target.id) }),
    })));
}

function projectMekEquipmentComponents(
    entity: MekEntity,
    index: MekRuntimeIndex,
    ruleset: CBTRuleset,
    query: MekUnitQueryPort,
    targeting: AttackerTargetingState,
    targets: readonly EquipmentPanelTarget[],
    attackModifiers: MekAttackModifierSets,
    optionalRules: OptionalRules,
): readonly EquipmentPanelComponent[] {
    const attackerSubmerged = mekUnitWaterState(entity, query).submerged;
    const targetingComputer = installedTargetingComputer(index, query);
    const rules = gameRulesFor(ruleset);
    return Object.freeze([...index.components]
        .map(([componentId, component]) => {
            const equipment = component.kind === 'equipment' ? component.mount.equipment : undefined;
            const locations = componentLocationIds(index, componentId)
                .map(locationId => {
                    const location = index.locations.get(locationId);
                    if (!location) throw new Error(`Component ${componentId} has unknown location ${locationId}`);
                    return Object.freeze({
                        locationId,
                        code: location.code,
                        status: query.componentStatusAtLocation(componentId, locationId),
                        exposed: (location.armorFaceIds ?? []).some(faceId => {
                            const face = index.armorFaces.get(faceId);
                            return face !== undefined
                                && face.maximumPoints > 0
                                && query.remainingArmor(faceId, 'preview') === 0;
                        }) ?? false,
                    });
                });
            const status = query.componentStatus(componentId);
            const previewStatus = query.componentStatus(componentId, 'preview');
            const mode = query.componentMode(componentId);
            const bayResolution = resolveComponentBayRuntime(index, query, componentId);
            const machineGunArrayMemberCount = bayResolution.kind === 'resolved'
                && bayResolution.facts.role === 'controller'
                && bayResolution.facts.relation.kind === 'machine-gun-array'
                ? bayResolution.facts.operationalMemberIds.length
                : 1;
            const modeDefinition = mekComponentModes(entity, index, componentId, ruleset);
            const baseLabel = component.kind === 'equipment'
                ? recordSheetInventoryMountName(entity, component.mount)
                : component.systemType;
            const rapidFireShotCount = equipment instanceof WeaponEquipment
                ? rapidFireAutocannonShotCount(equipment, mode)
                : 1;
            const flamerLabel = equipment instanceof WeaponEquipment
                ? flamerDisplayLabel(baseLabel, equipment, mode, ruleset, optionalRules)
                : baseLabel;
            const label = flamerLabel !== baseLabel
                ? flamerLabel
                : rapidFireShotCount > 1 && mode
                    ? `${baseLabel} (${mode})`
                : baseLabel;
            const loadouts = mekAmmoLoadouts(entity, index, componentId, ruleset);
            const ammo = loadouts.length === 0
                ? undefined
                : ammoSnapshot(entity, index, componentId, ruleset, loadouts, query);
            const selected = targeting.components.get(componentId);
            const bombast = bombastLaserEquipmentProfile(equipment, ruleset, mode);
            const baseWeaponHeat = equipment instanceof WeaponEquipment
                ? bombast?.heat ?? equipment.heat
                : 0;
            const bombastCharged = ruleset === 'core-2026'
                && query.componentBombastLaser(componentId)?.chargeState === BOMBAST_LASER_CHARGED_STATE;
            const ammoSources = equipment instanceof WeaponEquipment
                ? compatibleAmmoSources(entity, index, ruleset, componentId, equipment, mode, query)
                : Object.freeze([]);
            const targetSubject = mekWeaponTargetSubject(
                entity,
                index,
                ruleset,
                query,
                componentId,
                selected?.ammo,
            );
            const selectedAmmo = targetSubject?.selectedAmmo ?? null;
            const ammoProfile = resolveAmmoWeaponProfile(selectedAmmo);
            const underwater = targetSubject?.underwater ?? false;
            const bombastToHit = bombast === null
                ? undefined
                : bombastCharged ? 0 : bombast.toHitModifier;
            const { modifiers, fireControl, fireControlStatus } = equipmentPanelAttachments(
                component.kind === 'equipment' ? entity.getLinkingMounts(component.mount) : [],
                mount => query.componentStatus(asComponentId(mount.mountId)),
            );
            const artemisVToHit = equipment instanceof WeaponEquipment
                ? artemisVToHitAdjustment(
                    fireControl,
                    equipment,
                    fireControlStatus,
                    selectedAmmo,
                    query.hasCondition('jammed'),
                    query.c3DisruptedByStealth(),
                )
                : null;
            const apolloToHit = equipment instanceof WeaponEquipment
                ? apolloToHitAdjustment(fireControl, equipment, fireControlStatus, ruleset)
                : null;
            const riscLaserPulse = equipment instanceof WeaponEquipment
                ? mekRiscLaserPulseLink(index, componentId)
                : null;
            const riscLaserPulseActive = riscLaserPulse !== null
                && mekRiscLaserPulseActive(index, query, componentId);
            const riscLaserPulseHeat = riscLaserPulseActive
                ? RISC_LASER_PULSE_HEAT_BONUS
                : 0;
            const ppcCapacitorCharged = equipment instanceof WeaponEquipment
                && ppcCapacitorChargedForWeapon(entity, index, query, componentId);
            const ppcCapacitorHeat = ppcCapacitorCharged ? ppcCapacitorFiringHeat(query.turnState(), componentId) : 0;
            const shieldToHit = equipment instanceof WeaponEquipment
                ? shieldWeaponToHitAdjustment(entity, index, ruleset, query, componentId)
                : null;
            const prototypeMaximumHeat = equipment instanceof WeaponEquipment
                ? prototypeLaserMaximumExtraHeat(equipment.internalName)
                : 0;
            const toHitAdjustments = [
                ...(bombastToHit === undefined ? [] : [{
                    kind: 'replace-base' as const,
                    value: bombastToHit,
                    label: 'Bombast Laser',
                }]),
                ...hagEquipmentToHitAdjustments(index, componentId, mode),
                ...(artemisVToHit === null ? [] : [artemisVToHit]),
                ...(apolloToHit === null ? [] : [apolloToHit]),
                ...(riscLaserPulse ? [riscLaserPulseToHitAdjustment(riscLaserPulse.moduleLabel, riscLaserPulseActive)] : []),
                ...(shieldToHit === null ? [] : [shieldToHit]),
            ];
            const toHitSubject = equipment instanceof WeaponEquipment
                ? installedWeaponToHitSubject(
                    entity,
                    index,
                    ruleset,
                    query,
                    targeting,
                    componentId,
                    equipment,
                    locations.map(location => location.code),
                    targetingComputer,
                    optionalRules,
                )
                : null;
            const hitRequest: ToHitRequest | null = equipment instanceof WeaponEquipment
                ? Object.freeze({
                    subject: toHitSubject!,
                    stateModifiers: combineAttackModifiers(
                        attackModifiers.ranged,
                        attackModifiers.combat.kind === 'supported'
                            ? attackModifiers.combat.components.get(componentId) ?? []
                            : [],
                    ),
                    ...(toHitAdjustments.length === 0 ? {} : { adjustments: toHitAdjustments }),
                })
                : null;
            const indirectToHitAdjustments = artemisVToHit === null
                ? toHitAdjustments
                : toHitAdjustments.filter(adjustment => adjustment !== artemisVToHit);
            const hit = hitRequest === null
                ? null
                : projectEquipmentPanelHit(rules, hitRequest, indirectToHitAdjustments);
            const effectiveDamage = equipment instanceof WeaponEquipment
                ? ppcCapacitorWeaponDamage(
                    bombast?.damage ?? equipment.damage,
                    ppcCapacitorCharged,
                )
                : 0;
            const effectiveWeaponTypes = Object.freeze([
                ...(toHitSubject?.targetingComputerWeapon?.effectiveWeaponTypes
                    ?? (equipment instanceof WeaponEquipment ? equipment.getWeaponTypes() : [])),
            ]);
            const damage = equipment instanceof WeaponEquipment
                ? projectEquipmentPanelWeaponDamage(
                    entity.getEquipmentRegistry(),
                    componentId,
                    equipment,
                    selectedAmmo,
                    effectiveDamage,
                    effectiveWeaponTypes,
                    machineGunArrayMemberCount,
                )
                : null;
            const laserInsulatorWeakened = equipment instanceof WeaponEquipment
                ? mekLaserInsulatorWeakened(index, query, componentId)
                : undefined;
            const operatingWeaponHeat = laserInsulatorAdjustedHeat(
                baseWeaponHeat + riscLaserPulseHeat, laserInsulatorWeakened === false,
            ) + ppcCapacitorHeat;
            const weapon = !(equipment instanceof WeaponEquipment)
                ? undefined
                : Object.freeze({
                    heat: operatingWeaponHeat,
                    firingHeat: operatingWeaponHeat
                        * rapidFireShotCount * machineGunArrayMemberCount,
                    ...(prototypeMaximumHeat === 0 ? {} : { heatSuffix: '*' as const }),
                    selectable: canPerformMekAction(
                        entity,
                        index,
                        query,
                        { kind: 'component', componentId },
                        'fire',
                        ruleset,
                    ),
                    ...(query.turnState().firedWeapons?.includes(componentId) ? { firedThisTurn: true as const } : {}),
                    damage: effectiveDamage,
                    damageText: damage!.default,
                    damageTextByRange: damage!.byRange,
                    damageByRange: damage!.valuesByRange,
                    hit: hit!,
                    toHitModifier: hit!.default.profile.length === 1
                        ? hit!.default.profile[0]!
                        : Object.freeze([...hit!.default.profile]),
                    hitModifierBreakdown: Object.freeze([...hit!.default.modifierBreakdown]),
                    ...(artemisVToHit === null
                        ? {}
                        : { artemisVModifier: artemisVToHit.modifier }),
                    ranges: Object.freeze([...(ammoProfile?.ranges ?? equipment.ranges)]),
                    minimumRange: selectedAmmoIsHotLoaded(ammoSources, selected?.ammo)
                        ? 0 : ammoProfile?.minimumRange ?? equipment.minimumRange,
                    ...(selected?.selection === undefined ? {} : { selection: selected.selection }),
                    ...(selected?.ammo === undefined ? {} : { ammoSelection: selected.ammo }),
                    ammoSources,
                    underwater,
                    attackerSubmerged,
                    effectiveWeaponTypes,
                    disabledTargetReasons: weaponTargetDisabledReasons(targetSubject!, ruleset, targets),
                });
            return Object.freeze({
                componentId,
                label,
                ...(equipment === undefined ? {} : { equipment }),
                locations: Object.freeze(locations),
                status,
                previewStatus,
                modes: modeDefinition.modes,
                ...(modeDefinition.defaultMode === undefined
                    ? {}
                    : { defaultMode: modeDefinition.defaultMode }),
                ...(mode === undefined ? {} : { mode }),
                jammed: query.componentJammed(componentId),
                ...(bayResolution.kind === 'resolved' ? { bay: bayResolution.facts } : {}),
                ...(laserInsulatorWeakened === undefined
                    ? {}
                    : { heatWeakened: laserInsulatorWeakened }),
                ...(modifiers.length === 0 ? {} : { modifiers }),
                ...(weapon === undefined ? {} : { weapon }),
                ...(ammo === undefined ? {} : { ammo }),
            });
        }));
}

function installedTargetingComputer(
    index: MekRuntimeIndex,
    query: MekUnitQueryPort,
): ComponentToHitTargetingComputerFacts | null {
    for (const [componentId, component] of index.components) {
        if (component.kind !== 'equipment') continue;
        const equipment = component.mount.equipment;
        if (!equipment || !isTargetingComputerEquipment(equipment)) continue;
        return Object.freeze({
            label: equipment.name,
            status: query.componentStatus(componentId),
        });
    }
    return null;
}

function installedWeaponToHitSubject(
    entity: MekEntity,
    index: MekRuntimeIndex,
    ruleset: CBTRuleset,
    query: MekUnitQueryPort,
    targeting: AttackerTargetingState | undefined,
    componentId: ComponentId,
    equipment: WeaponEquipment,
    locations: readonly string[],
    targetingComputer: ComponentToHitTargetingComputerFacts | null,
    optionalRules: OptionalRules,
): ComponentToHitSubject {
    const linkedTargetId = index.relationships.linkedTargetBySource.get(componentId);
    const linkedTarget = linkedTargetId === undefined
        ? undefined
        : equipmentForComponent(index, linkedTargetId);
    const targetingComputerWeaponId = linkedTarget instanceof WeaponEquipment
        ? linkedTargetId!
        : componentId;
    const targetingComputerWeapon = linkedTarget instanceof WeaponEquipment
        ? linkedTarget
        : equipment;
    return Object.freeze({
        kind: 'component',
        componentId,
        source: Object.freeze({
            kind: 'equipment',
            equipment,
            physical: false,
            parentEquipment: linkedTarget ?? null,
        }),
        locations: Object.freeze([...locations]),
        targetingComputerWeapon: installedWeaponFacts(
            entity,
            index,
            ruleset,
            query,
            targeting,
            targetingComputerWeaponId,
            targetingComputerWeapon,
            optionalRules,
        ),
        targetingComputer,
    });
}

function installedWeaponFacts(
    entity: MekEntity,
    index: MekRuntimeIndex,
    ruleset: CBTRuleset,
    query: MekUnitQueryPort,
    targeting: AttackerTargetingState | undefined,
    componentId: ComponentId,
    equipment: WeaponEquipment,
    optionalRules: OptionalRules,
): ComponentToHitWeaponFacts {
    const ammo = resolveMekTargetingAmmo(
        entity,
        index,
        ruleset,
        query,
        componentId,
        targeting?.components.get(componentId)?.ammo,
    );
    let types: ReadonlySet<WeaponType> = new Set(equipment.getWeaponTypes());
    if (ammo) {
        const effective = new Set(types);
        ammo.getRemovedDamageTypes().forEach(type => effective.delete(type));
        ammo.getWeaponTypes().forEach(type => effective.add(type));
        types = effective;
    }
    const mode = query.componentMode(componentId);
    if (mekRiscLaserPulseActive(index, query, componentId)) types = new Set([...types, 'P']);
    types = applyHagEquipmentWeaponTypes(equipment, mode, types);
    types = applyFlamerWeaponTypes(equipment, mode, types, ruleset, optionalRules);
    types = applyGaussPowerWeaponTypes(equipment, query.componentGaussPower(componentId), types);
    types = applyComponentApolloWeaponTypes(index, query, componentId, ruleset, types);
    types = ppcCapacitorWeaponTypes(
        types,
        ppcCapacitorChargedForWeapon(entity, index, query, componentId),
    );
    if (hotLoadedAmmoForWeapon(index, query, componentId).length > 0) types = new Set([...types, 'X']);
    return Object.freeze({
        equipment,
        effectiveWeaponTypes: Object.freeze([...types]),
    });
}

function compatibleAmmoSources(
    entity: MekEntity,
    index: MekRuntimeIndex,
    ruleset: CBTRuleset,
    weaponId: ComponentId,
    weapon: WeaponEquipment,
    mode: string | undefined,
    query: MekUnitQueryPort,
): readonly EquipmentPanelAmmoSource[] {
    return Object.freeze([...index.components]
        .map(([sourceId, source]) => {
            const loadouts = mekAmmoLoadouts(entity, index, sourceId, ruleset)
                .filter(loadout => weaponAcceptsAmmo(weapon, loadout.equipment, mode));
            if (loadouts.length === 0
                || !ammoSourceFeedsWeapon(sourceId, mountedEquipmentForComponent(index, sourceId), weaponId, weapon)) return null;
            const current = query.ammoLoadout(sourceId);
            const currentEquipment = loadouts.find(loadout => loadout.munitionKey === current.munitionKey)?.equipment;
            const status = query.componentStatus(sourceId);
            return Object.freeze({
                componentId: sourceId,
                label: currentEquipment?.shortName || currentEquipment?.name
                    || (source.kind === 'equipment' ? source.mount.equipmentId : String(source.systemType)),
                location: componentLocationIds(index, sourceId)
                    .map(locationId => index.locations.get(locationId)?.code)
                    .filter(code => code !== undefined)
                    .join('/'),
                status,
                munitionKey: current.munitionKey,
                remaining: status === 'available' ? query.remainingAmmo(sourceId) : 0,
                capacity: query.ammoCapacity(sourceId),
                hotLoaded: query.ammoHotLoaded(sourceId),
                loadouts: freezeLoadouts(loadouts),
            });
        })
        .filter(row => row !== null)
        .sort((left, right) => compareText(left.componentId, right.componentId)));
}

function ammoSnapshot(
    entity: MekEntity,
    index: MekRuntimeIndex,
    componentId: ComponentId,
    ruleset: CBTRuleset,
    loadouts: readonly AmmoLoadout[],
    query: MekUnitQueryPort,
): EquipmentPanelComponent['ammo'] {
    const current = query.ammoLoadout(componentId);
    const selected = loadouts.find(loadout => loadout.munitionKey === current.munitionKey)
        ?? mekAmmoLoadouts(entity, index, componentId, ruleset)[0];
    if (selected === undefined) throw new Error(`Ammo source ${componentId} has no loadout`);
    const defaultMunitionKey = mekAmmoDefaultMunitionKey(entity, index, componentId);
    if (defaultMunitionKey === null) throw new Error(`Ammo source ${componentId} has no default loadout`);
    return Object.freeze({
        defaultMunitionKey,
        munitionKey: current.munitionKey,
        displayName: selected.equipment.shortName || selected.equipment.name,
        remaining: query.remainingAmmo(componentId),
        capacity: query.ammoCapacity(componentId),
        hotLoaded: query.ammoHotLoaded(componentId),
        loadouts: freezeLoadouts(loadouts),
        weaponTechBases: entityWeaponTechBasesForAmmo(entity, selected.equipment),
        compatibilityFacts: entityAmmoSelectionCompatibilityFacts(entity, loadouts.map(loadout => loadout.equipment)),
    });
}

function freezeLoadouts(loadouts: readonly AmmoLoadout[]): readonly EquipmentPanelAmmoLoadout[] {
    return Object.freeze(loadouts.map(loadout => Object.freeze({
        munitionKey: loadout.munitionKey,
        displayName: loadout.equipment.shortName || loadout.equipment.name,
        capacity: loadout.capacity,
        equipment: loadout.equipment,
    })));
}

function combineAttackModifiers(
    ...groups: readonly (readonly ToHitModifierBreakdownEntry[])[]
): readonly ToHitModifierBreakdownEntry[] {
    return Object.freeze(groups.flatMap(group => group));
}

function voidSignatureWeaponModifiers(
    query: MekUnitQueryPort,
): readonly ToHitModifierBreakdownEntry[] {
    return query.voidSignatureActive('preview')
        ? Object.freeze([{ label: 'Void Signature', modifier: 1 }])
        : Object.freeze([]);
}
