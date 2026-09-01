// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import { compareText } from '../../utils/string.util';
import type { EquipmentStatus } from '../equipment-status.model';
import { asComponentId, type ComponentId, type LocationId } from '../entity/entity-identifiers';
import type { MekEntity } from '../entity/entities/mek/mek-entity';
import type { EntityWeaponHitModifier } from '../entity/types/weapon';
import {
    ammoMatchesWeapon,
    AmmoEquipment,
    Equipment,
    WeaponEquipment,
    type AmmoType,
    type WeaponDamage,
} from '../equipment.model';
import type { CBTRuleset } from '../cbt-ruleset.model';
import type {
    AttackerAmmoSelection,
    AttackerActionTarget,
    AttackerSelection,
    AttackerLocalTargetState,
    AttackerTargetingState,
} from './attacker-targeting-state';
import { attackerActionSelection } from './attacker-targeting-state';
import { mekWeaponAmmoMatches } from './mek-weapon-fire-v2';
import type { EncounterTargetId, TargetRegistrySnapshot } from './encounter-runtime';
import type { TnTargetNumberCalculatorState, TnTargetUnitType } from '../target-number-calculator.model';
import type { MekUnitQueryPort } from './unit-instance';
import type { WeaponType } from '../weapon-types.model';
import type { UnitType } from '../entity/types';
import { canPerformMekAction } from './mek-action-availability';
import type { MekPhysicalAttackEffectV2 } from './mek-physical-attack-v2';
import type {
    InventoryControlRuntimeTarget,
    InventoryControlRuntimeRangeKey,
} from '../inventory-control-runtime-state.model';
import { getEffectiveInventoryControlCalculatorState } from '../inventory-control-runtime-state.model';
import {
    calculateTargetTnModifierBreakdown,
    calculateTargetTnModifier,
    getDefaultAttackerMovementModifier,
    getTnTargetModifierGroupTotals,
    TN_INDIRECT_FIRE_MODIFIER,
    TN_SKIDDING_ATTACKER,
    type TnRangeBracket,
    type TnTargetModifierBreakdownEntry,
} from '../target-number-calculator.model';
import { componentLocationIds, equipmentForComponent, type MekRuntimeIndex } from './mek-runtime-index';
import { mekAmmoDefaultMunitionKey, mekAmmoLoadouts, mekIntrinsicMagazine, type AmmoLoadout } from './mek-ammo';
import { mekComponentModes } from './mek-component-rules';
import { mekRiscLaserPulseActive, mekRiscLaserPulseLink } from './component-risc-laser-pulse';
import { RISC_LASER_PULSE_HEAT_BONUS } from '../risc-laser-mode.model';
import { prototypeLaserMaximumExtraHeat } from '../prototype-laser-heat.model';
import { rapidFireAutocannonShotCount } from './component-rapid-fire-autocannon';
import { mekLaserInsulatorAdjustedHeat, mekLaserInsulatorWeakened } from './component-laser-insulator';
import { applyFlamerWeaponTypes, flamerDisplayLabel } from '../flamer-mode.model';
import { bombastLaserEquipmentProfile } from '../bombast-laser-mode.model';
import { BOMBAST_LASER_CHARGED_STATE } from './component-bombast-laser';
import {
    isMekWeaponUnderwater,
    mekUnitWaterState,
    weaponTargetAttackTraits,
    weaponTargetDisabledReason,
    resolveMekTargetingAmmo,
} from './mek-targeting-rules';
import {
    gameRulesFor,
    ATTACK_MOVEMENT_MODIFIER_BREAKDOWN_PRIORITY,
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
import { projectMekSpottingModifier } from './mek-turn-panel';
import { applyHagEquipmentWeaponTypes, hagEquipmentToHitAdjustments } from './component-hag-mode';
import type { MekCombatModifierProjectionResult } from './mek-combat-modifiers';
import { applyGaussPowerWeaponTypes } from './mek-gauss-power';
import { applyComponentApolloWeaponTypes, componentApolloToHitAdjustment } from './component-apollo';
import {
    PPC_CAPACITOR_HEAT_BONUS,
    ppcCapacitorChargedForWeapon,
    ppcCapacitorWeaponDamage,
    ppcCapacitorWeaponTypes,
} from './component-ppc-capacitor';
import type { EquipmentRowOrderState } from './equipment-row-order';
import { AEROSPACE_RANGE_BRACKETS, type AerospaceRangeLimits } from '../../utils/aerospace-range.util';
import type { UnitModifierBreakdownEntry } from '../combat-modifier';
import {
    inventoryControlDamageRange,
    resolveInventoryControlDamageText,
} from '../../utils/inventory-control-damage.util';
import type { EquipmentRegistry } from '../equipment-lookup';
import { resolveAmmoWeaponProfile } from '../ammo-weapon-profile.model';
import type { TooltipLine } from '../../components/tooltip/tooltip.component';
import {
    isArtemisVCompatibleWeapon,
    isArtemisVEquipment,
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
    readonly damage: WeaponEquipment['damage'];
    readonly damageText: string;
    readonly damageTextByRange: Readonly<Record<InventoryControlRuntimeRangeKey, string>>;
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
        readonly maximumBracket: InventoryControlRuntimeRangeKey;
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
}

export interface EquipmentPanelHitResolution {
    readonly default: ToHitResolution;
    readonly byRange: Readonly<Record<InventoryControlRuntimeRangeKey, ToHitResolution>>;
    readonly indirectByRange: Readonly<Record<InventoryControlRuntimeRangeKey, ToHitResolution>>;
}

export interface EquipmentPanelModifier {
    readonly name: string;
    readonly status?: 'destroyed' | 'disabled' | 'warning';
}

export interface EquipmentPanelWeaponDamage {
    readonly default: string;
    readonly byRange: Readonly<Record<InventoryControlRuntimeRangeKey, string>>;
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
    readonly damageText: string;
    readonly targetNumberBreakdown: Readonly<{
        readonly total: number;
        readonly lines: readonly TooltipLine[];
    }> | null;
}

export interface WeaponTargetPresentationOptions {
    readonly pilotingSkill?: number;
    readonly allowExtremeRange?: boolean;
    readonly missingMovementModifier?: boolean;
    readonly attackModifierBreakdown?: readonly UnitModifierBreakdownEntry[];
    readonly c3DegradationSource?: C3DegradationSource;
    readonly c3Available?: boolean;
}

/** Converts the force target row into the detached target facts shared by sheet and panel UI. */
export function equipmentPanelRuntimeTarget(
    target: EquipmentPanelTarget,
    ruleset: CBTRuleset,
): InventoryControlRuntimeTarget {
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
            ? {}
            : { manualTnModifier: target.local.manualTnOverride.modifier }),
    });
}

/** One authoritative Entity + runtime calculation for sheet and equipment target presentation. */
export function projectWeaponTargetPresentation(
    row: EquipmentPanelComponent,
    target: InventoryControlRuntimeTarget | null,
    crewGunnery: number,
    attackerMoveMode: Parameters<typeof getDefaultAttackerMovementModifier>[0],
    ruleset: CBTRuleset,
    options: WeaponTargetPresentationOptions = {},
): WeaponTargetPresentation {
    const weapon = row.weapon;
    const selection = weapon?.selection;
    const manualRange = selection?.kind === 'manual-range' ? selection.range : null;
    if (!weapon) return emptyWeaponTargetPresentation();
    const rules = gameRulesFor(ruleset);
    const c3Target = target === null || options.c3Available !== false
        ? target
        : stripC3Distance(target);
    const c3Resolution = c3Target === null
        ? null
        : rules.resolveC3Targeting(c3Target, options.c3DegradationSource ?? 'none');
    const calculationTarget = c3Resolution?.target ?? null;
    const selectedAmmo = selectedAmmoEquipment(weapon.ammoSources, weapon.ammoSelection);
    const targetNumberFacts = Object.freeze({
        componentId: row.componentId,
        physical: false,
        aerospaceWeapon: weapon.aerospace === undefined ? null : Object.freeze({
            capital: weapon.aerospace.capital,
            maxRangeBracket: weapon.aerospace.maximumBracket,
        }),
    });
    const display = weaponTargetDisplay(weapon);
    const rangeInput = {
        targetNumberFacts,
        display,
        extremeRange: weapon.ranges[3] ?? null,
        allowExtremeRange: options.allowExtremeRange === true,
        selectedAmmo,
    } as const;
    const calculatedRangeSelection = inventoryTargetRangeSelection({
        ...rangeInput,
        target: calculationTarget,
    });
    const rangeSelection = calculatedRangeSelection ?? (manualRange === null
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
    const hitResolution = equipmentPanelHitAtRange(
        weapon.hit,
        weaponRuleRange,
        target !== null && getEffectiveInventoryControlCalculatorState(target)?.indirectFire === true,
    );
    const attackModifierBreakdown = options.attackModifierBreakdown
        ?? defaultAttackMovementBreakdown(attackerMoveMode);
    const attackerMovementModifier = attackModifierBreakdown.reduce(
        (total, modifier) => total + modifier.modifier,
        0,
    );
    const targetProjection = target === null
        ? null
        : effectiveWeaponTargetModifier(row, target, ruleset, rangeSelection?.range);
    const targetModifier = targetProjection?.modifier ?? 0;
    const targetNumber = inventoryTargetNumberState({
        ...rangeInput,
        target: calculationTarget === null || targetProjection === null
            ? calculationTarget
            : Object.freeze({ ...calculationTarget, tnModifier: targetModifier }),
        gunnerySkill: crewGunnery,
        pilotingSkill: options.pilotingSkill ?? 5,
        missingMovementModifier: options.missingMovementModifier === true,
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
            : ({ short: 0, medium: 2, long: 4, extreme: 6 } as const)[rangeSelection.range];
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
        damageText: weaponRuleRange === null
            ? weapon.damageText
            : weapon.damageTextByRange[weaponRuleRange],
        targetNumberBreakdown: targetNumber.breakdown === null
            ? null
            : Object.freeze({
                total: targetNumber.breakdown.total,
                lines: Object.freeze([...targetNumber.breakdown.lines]),
            }),
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
    const damageAt = (range: InventoryControlRuntimeRangeKey | null): string =>
        resolveInventoryControlDamageText(component, {
            ...context,
            selectedRange: inventoryControlDamageRange(range),
        }, rules) ?? '—';
    return Object.freeze({
        default: damageAt(null),
        byRange: Object.freeze(Object.fromEntries(AEROSPACE_RANGE_BRACKETS.map(range => [
            range,
            damageAt(range),
        ])) as Record<InventoryControlRuntimeRangeKey, string>),
    });
}

function resolveEquipmentPanelHitsByRange(
    rules: CBTGameRules,
    request: ToHitRequest,
    adjustments: readonly ToHitAdjustment[] | undefined,
): Readonly<Record<InventoryControlRuntimeRangeKey, ToHitResolution>> {
    return Object.freeze(Object.fromEntries(AEROSPACE_RANGE_BRACKETS.map(range => [
        range,
        Object.freeze(rules.resolveToHit({ ...request, range, adjustments })),
    ])) as Record<InventoryControlRuntimeRangeKey, ToHitResolution>);
}

function equipmentPanelHitAtRange(
    hit: EquipmentPanelHitResolution,
    range: InventoryControlRuntimeRangeKey | null,
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

function stripC3Distance(target: InventoryControlRuntimeTarget): InventoryControlRuntimeTarget {
    const { c3Distance: _c3Distance, useC3: _useC3, ...withoutC3 } = target;
    return Object.freeze(withoutC3);
}

function defaultAttackMovementBreakdown(
    mode: Parameters<typeof getDefaultAttackerMovementModifier>[0],
): readonly UnitModifierBreakdownEntry[] {
    const modifier = getDefaultAttackerMovementModifier(mode);
    if (modifier === 0) return Object.freeze([]);
    const label = mode == null ? 'Movement' : `${mode[0]?.toUpperCase()}${mode.slice(1)}`;
    return Object.freeze([Object.freeze({
        label,
        modifier,
        priority: ATTACK_MOVEMENT_MODIFIER_BREAKDOWN_PRIORITY,
    })]);
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
        damageText: '—',
        targetNumberBreakdown: null,
    });
}

export type EffectiveTargetModifier = Omit<TnTargetModifierBreakdownEntry, 'id'> & {
    readonly id: TnTargetModifierBreakdownEntry['id'] | 'precision';
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
    target: InventoryControlRuntimeTarget,
    ruleset: CBTRuleset,
    rangeBracket?: TnRangeBracket,
): EffectiveWeaponTargetProjection {
    const weapon = row.weapon;
    const calculator = getEffectiveInventoryControlCalculatorState(target);
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
    target: InventoryControlRuntimeTarget,
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

function resolveEffectiveWeaponTypes(
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

export function equipmentWeaponToHitModifier(
    row: EquipmentPanelComponent,
    target: InventoryControlRuntimeTarget | null = null,
    range: InventoryControlRuntimeRangeKey | null = null,
): number {
    if (row.weapon?.hit !== undefined) {
        const indirect = target !== null
            && getEffectiveInventoryControlCalculatorState(target)?.indirectFire === true;
        const value = equipmentPanelHitAtRange(row.weapon.hit, range, indirect).value;
        return typeof value === 'number' ? value : 0;
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
        && getEffectiveInventoryControlCalculatorState(target)?.indirectFire === true;
    return indirect ? base - (row.weapon?.artemisVModifier ?? 0) : base;
}

export interface MekPhysicalAttackRow {
    readonly target: AttackerActionTarget;
    readonly label: string;
    readonly locationIds: readonly LocationId[];
    readonly locationCodes: readonly string[];
    readonly hitModifiers: readonly EntityWeaponHitModifier[];
    readonly hitModifierBreakdown: readonly ToHitModifierBreakdownEntry[];
    readonly available: boolean;
    readonly selectable: boolean;
    readonly effect: MekPhysicalAttackEffectV2;
    readonly firingHeat: number;
    readonly selection?: AttackerSelection;
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
    combatModifiers: MekCombatModifierProjectionResult = query.mekCombatModifiers(),
    stateModifiers: readonly ToHitModifierBreakdownEntry[] = combineAttackModifiers(
        combatModifiers.kind === 'supported' ? combatModifiers.physical : [],
        mekTurnAttackModifiers(entity, index, ruleset, query),
    ),
): MekPhysicalAttackPresentation {
    const projection = query.mekPhysicalAttacks();
    if (projection.kind === 'unsupported') return projection;
    return Object.freeze({
        kind: 'supported',
        attacks: Object.freeze(projection.attacks.map(attack => {
            const selection = attack.selectable
                ? attackerActionSelection(targeting, attack.target)
                : undefined;
            const hit = physicalAttackHitResolution(
                index,
                attack.target,
                ruleset,
                stateModifiers,
                combatModifiers,
            );
            return Object.freeze({
                ...attack,
                hitModifiers: hit.modifiers,
                hitModifierBreakdown: hit.breakdown,
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
    readonly entityUuid: string;
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
}

export function selectedWeaponHeat(
    snapshot: Pick<EquipmentPanelSnapshot, 'components' | 'physicalAttacks'>,
): Readonly<{ hasSelection: boolean; value: number }> {
    const selected = snapshot.components.filter(row =>
        row.status === 'available'
        && row.weapon?.selectable === true
        && row.weapon.selection !== undefined);
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

export function projectMekEquipmentPanel(
    entity: MekEntity,
    index: MekRuntimeIndex,
    ruleset: CBTRuleset,
    query: MekUnitQueryPort,
    registry: TargetRegistrySnapshot,
): EquipmentPanelSnapshot {
    const targeting = query.attackerTargetingState();
    const targets = projectEquipmentTargets(targeting, registry);
    const combatModifiers = query.mekCombatModifiers();
    const turnModifiers = mekTurnAttackModifiers(entity, index, ruleset, query);
    const rangedModifiers = combineAttackModifiers(
        combatModifiers.kind === 'supported' ? combatModifiers.ranged : [],
        turnModifiers,
        voidSignatureWeaponModifiers(query),
    );
    const physicalModifiers = combineAttackModifiers(
        combatModifiers.kind === 'supported' ? combatModifiers.physical : [],
        turnModifiers,
    );
    const components = projectMekEquipmentComponents(
        entity,
        index,
        ruleset,
        query,
        targeting,
        targets,
        combatModifiers,
        rangedModifiers,
    );
    const physicalProjection = projectMekPhysicalAttackPresentation(
        entity, index, ruleset, query, targeting, combatModifiers, physicalModifiers,
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

/** Shared entity/runtime equipment projection used by sheets and equipment UI. */
export function projectMekEquipmentComponents(
    entity: MekEntity,
    index: MekRuntimeIndex,
    ruleset: CBTRuleset,
    query: MekUnitQueryPort,
    targeting?: AttackerTargetingState,
    targets: readonly EquipmentPanelTarget[] = [],
    combatModifiers: MekCombatModifierProjectionResult = query.mekCombatModifiers(),
    stateModifiers: readonly ToHitModifierBreakdownEntry[] = combineAttackModifiers(
        combatModifiers.kind === 'supported' ? combatModifiers.ranged : [],
        mekTurnAttackModifiers(entity, index, ruleset, query),
        voidSignatureWeaponModifiers(query),
    ),
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
                ? component.mount.displayName()
                : component.systemType;
            const rapidFireShotCount = equipment instanceof WeaponEquipment
                ? rapidFireAutocannonShotCount(equipment, mode)
                : 1;
            const flamerLabel = equipment instanceof WeaponEquipment
                ? flamerDisplayLabel(baseLabel, equipment, mode)
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
            const selected = targeting?.components.get(componentId);
            const bombast = bombastLaserEquipmentProfile(equipment, ruleset, mode);
            const baseWeaponHeat = equipment instanceof WeaponEquipment
                ? bombast?.heat ?? equipment.heat
                : 0;
            const operatingWeaponHeat = equipment instanceof WeaponEquipment
                ? mekLaserInsulatorAdjustedHeat(index, query, componentId, baseWeaponHeat)
                : baseWeaponHeat;
            const bombastCharged = ruleset === 'core-2026'
                && query.componentBombastLaser(componentId)?.chargeState === BOMBAST_LASER_CHARGED_STATE;
            const ammoSources = equipment instanceof WeaponEquipment
                ? compatibleAmmoSources(entity, index, ruleset, componentId, equipment, mode, query)
                : Object.freeze([]);
            const selectedAmmo = equipment instanceof WeaponEquipment
                ? resolveMekTargetingAmmo(
                    entity,
                    index,
                    ruleset,
                    query,
                    componentId,
                    selected?.ammo,
                )
                : null;
            const ammoProfile = resolveAmmoWeaponProfile(selectedAmmo);
            const underwater = equipment instanceof WeaponEquipment
                && isMekWeaponUnderwater(entity, index, query, componentId);
            const bombastToHit = bombast === null
                ? undefined
                : bombastCharged ? 0 : bombast.toHitModifier;
            const artemisVToHit = equipment instanceof WeaponEquipment
                ? artemisVToHitAdjustment(
                    index,
                    query,
                    componentId,
                    selectedAmmo,
                )
                : null;
            const apolloToHit = equipment instanceof WeaponEquipment
                ? componentApolloToHitAdjustment(index, query, componentId, ruleset)
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
            const ppcCapacitorHeat = ppcCapacitorCharged ? PPC_CAPACITOR_HEAT_BONUS : 0;
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
                ...(riscLaserPulse === null ? [] : [{
                    kind: 'add' as const,
                    label: riscLaserPulseActive
                        ? riscLaserPulse.moduleLabel
                        : `${riscLaserPulse.moduleLabel} Inactive`,
                    modifier: riscLaserPulseActive ? -2 : 0,
                    weakened: !riscLaserPulseActive,
                }]),
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
                )
                : null;
            const hitRequest: ToHitRequest | null = equipment instanceof WeaponEquipment
                ? Object.freeze({
                    subject: toHitSubject!,
                    stateModifiers: combineAttackModifiers(
                        stateModifiers,
                        combatModifiers.kind === 'supported'
                            ? combatModifiers.components.get(componentId) ?? []
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
            const linkedEnhancementId = index.relationships.linkedSourceByTarget.get(componentId);
            const linkedEnhancement = linkedEnhancementId === undefined
                ? undefined
                : equipmentForComponent(index, linkedEnhancementId);
            const linkedEnhancementStatus = linkedEnhancementId === undefined
                ? 'available'
                : query.componentStatus(linkedEnhancementId);
            const laserInsulatorWeakened = equipment instanceof WeaponEquipment
                ? mekLaserInsulatorWeakened(index, query, componentId)
                : null;
            const modifiers: readonly EquipmentPanelModifier[] = linkedEnhancement !== undefined
                && isWeaponEnhancementEquipment(linkedEnhancement)
                ? Object.freeze([Object.freeze({
                    name: linkedEnhancement.shortName || linkedEnhancement.name,
                    ...(linkedEnhancementStatus === 'available'
                        ? {}
                        : { status: linkedEnhancementStatus as 'destroyed' | 'disabled' }),
                })])
                : Object.freeze([]);
            const weapon = !(equipment instanceof WeaponEquipment)
                ? undefined
                : Object.freeze({
                    heat: operatingWeaponHeat + riscLaserPulseHeat + ppcCapacitorHeat,
                    firingHeat: (operatingWeaponHeat + riscLaserPulseHeat + ppcCapacitorHeat)
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
                    damage: effectiveDamage,
                    damageText: damage!.default,
                    damageTextByRange: damage!.byRange,
                    hit: hit!,
                    toHitModifier: hit!.default.profile.length === 1
                        ? hit!.default.profile[0]!
                        : Object.freeze([...hit!.default.profile]),
                    hitModifierBreakdown: Object.freeze([...hit!.default.modifierBreakdown]),
                    ...(artemisVToHit === null
                        ? {}
                        : { artemisVModifier: artemisVToHit.modifier }),
                    ranges: Object.freeze([...(ammoProfile?.ranges ?? equipment.ranges)]),
                    minimumRange: ammoProfile?.minimumRange ?? equipment.minimumRange,
                    ...(selected?.selection === undefined ? {} : { selection: selected.selection }),
                    ...(selected?.ammo === undefined ? {} : { ammoSelection: selected.ammo }),
                    ammoSources,
                    underwater,
                    attackerSubmerged,
                    effectiveWeaponTypes,
                    disabledTargetReasons: mekWeaponTargetDisabledReasons(
                        entity,
                        index,
                        ruleset,
                        query,
                        componentId,
                        equipment,
                        selected?.ammo,
                        targets,
                        underwater,
                    ),
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
                ...(laserInsulatorWeakened === null
                    ? {}
                    : { heatWeakened: laserInsulatorWeakened }),
                ...(modifiers.length === 0 ? {} : { modifiers }),
                ...(weapon === undefined ? {} : { weapon }),
                ...(ammo === undefined ? {} : { ammo }),
            });
        }));
}

function artemisVToHitAdjustment(
    index: MekRuntimeIndex,
    query: MekUnitQueryPort,
    weaponId: ComponentId,
    ammo: AmmoEquipment | null,
): Extract<ToHitAdjustment, { readonly kind: 'add' }> | null {
    const sourceId = index.relationships.linkedSourceByTarget.get(weaponId);
    if (sourceId === undefined) return null;
    const source = equipmentForComponent(index, sourceId);
    const weapon = equipmentForComponent(index, weaponId);
    if (!source || !weapon
        || !isArtemisVEquipment(source)
        || !isArtemisVCompatibleWeapon(weapon)) return null;

    const status = query.componentStatus(sourceId);
    const jammed = query.hasCondition('jammed');
    const stealthEcm = query.c3DisruptedByStealth();
    const compatibleAmmo = ammo?.hasMunitionType('M_ARTEMIS_V_CAPABLE') === true;
    const weakened = status !== 'available' || jammed || stealthEcm || !compatibleAmmo;
    const label = source.shortName || source.name;
    return Object.freeze({
        kind: 'add' as const,
        label: status === 'destroyed'
            ? `${label} Destroyed`
            : status === 'disabled'
                ? `${label} Disabled`
                : jammed
                    ? 'Unit Jammed'
                    : stealthEcm
                        ? 'Stealth ECM'
                        : ammo === null
                            ? 'Artemis V Ammo Not Selected'
                            : compatibleAmmo ? label : `Incompatible Ammo (${ammo.name})`,
        modifier: weakened ? 0 : -1,
        weakened,
    });
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
    types = applyHagEquipmentWeaponTypes(equipment, mode, types);
    types = applyFlamerWeaponTypes(equipment, mode, types);
    types = applyGaussPowerWeaponTypes(equipment, query.componentGaussPower(componentId), types);
    types = applyComponentApolloWeaponTypes(index, query, componentId, ruleset, types);
    types = ppcCapacitorWeaponTypes(
        types,
        ppcCapacitorChargedForWeapon(entity, index, query, componentId),
    );
    return Object.freeze({
        equipment,
        effectiveWeaponTypes: Object.freeze([...types]),
    });
}

function mekWeaponTargetDisabledReasons(
    entity: MekEntity,
    index: MekRuntimeIndex,
    ruleset: CBTRuleset,
    query: MekUnitQueryPort,
    weaponId: ComponentId,
    weapon: WeaponEquipment,
    ammoSelection: AttackerAmmoSelection | undefined,
    targets: readonly EquipmentPanelTarget[],
    underwater: boolean,
): Readonly<Record<string, string>> {
    const selectedAmmo = resolveMekTargetingAmmo(
        entity, index, ruleset, query, weaponId, ammoSelection,
    );
    return projectWeaponTargetDisabledReasons(weapon, selectedAmmo, ruleset, targets, underwater);
}

export function projectWeaponTargetDisabledReasons(
    weapon: WeaponEquipment,
    selectedAmmo: AmmoEquipment | null,
    ruleset: CBTRuleset,
    targets: readonly EquipmentPanelTarget[],
    underwater: boolean,
): Readonly<Record<string, string>> {
    return Object.freeze(Object.fromEntries(targets.flatMap(target => {
        const calculator = Object.freeze({ ...target.calculator, ...target.local?.calculator });
        const reason = weaponTargetDisabledReason(weapon, selectedAmmo, ruleset, {
            ...(target.unitType === undefined ? {} : { unitType: target.unitType }),
            ...(Object.keys(calculator).length === 0 ? {} : { calculator }),
            ...(target.local?.manualTnOverride === undefined ? {} : { manualTnOverride: true }),
        }, underwater);
        return reason === null ? [] : [[target.targetId, reason] as const];
    })) as Record<string, string>);
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
                .filter(loadout => mekWeaponAmmoMatches(weapon, loadout.equipment, mode));
            const intrinsic = mekIntrinsicMagazine(entity, index, sourceId, ruleset);
            if (loadouts.length === 0
                || (intrinsic !== null && intrinsic.ownerComponentId !== weaponId)) return null;
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
                loadouts: freezeLoadouts(loadouts),
            });
        })
        .filter((row): row is EquipmentPanelAmmoSource => row !== null)
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
        loadouts: freezeLoadouts(loadouts),
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
