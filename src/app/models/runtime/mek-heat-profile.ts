// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import {
    heatSinkDissipationRate,
    unsupportedMekHeatFlag,
} from '../heat-equipment.model';
import { isHeatDissipatingArmor } from '../construction-equipment.model';
import { isLaserInsulatorEquipment } from '../laser-insulator.model';
import { bombastLaserModes, isBombastLaserEquipment } from '../bombast-laser-mode.model';
import type { CBTRuleset } from '../cbt-ruleset.model';
import type { MekEntity } from '../entity/entities/mek/mek-entity';
import { MiscEquipment, WeaponEquipment, type Equipment } from '../equipment.model';
import {
    isPhysicalWeaponEquipment,
    isSpotWelderEquipment,
} from '../entity/utils/physical-weapon';
import { STANDARD_MOVEMENT_CALCULATION } from '../entity/types';
import type { ComponentId, CriticalSlotId } from '../entity/entity-identifiers';
import { isPpcCapacitorEquipment, isPpcCapacitorPair } from './component-ppc-capacitor';
import { getVibrobladeProfileFromFlags } from '../rules/vibroblade-rules';
import {
    isChameleonShieldEquipment,
    isNullSignatureEquipment,
    isStealthEquipment,
    isSwitchableStealthEquipment,
    isVoidSignatureEquipment,
} from '../stealth-equipment.model';
import { mekComponentModes } from './mek-component-rules';
import { isMekLaserInsulatorPair } from './component-laser-insulator';
import {
    isMekRiscLaserPulsePair,
} from './component-risc-laser-pulse';
import { isRiscLaserPulseEnhancement } from '../risc-laser-mode.model';
import { escalatingFailureHeatProviders } from './component-escalating-failure';
import {
    PARTIAL_WING_HEAT_DISSIPATION_BONUS,
    isJumpJetEquipment,
    isJumpBoosterEquipment,
    isPartialWingEquipment,
    isSuperCooledMyomerEquipment,
    jumpJetKind,
} from '../jump-equipment.model';
import {
    equipmentForComponent,
    mountedEquipmentForComponent,
    type MekRuntimeIndex,
    type MekIndexedComponent,
} from './mek-runtime-index';
import { isNovaCewsEquipment } from './component-electronic-suite';
import {
    isGroundMobileHpgEquipment,
} from './component-mobile-hpg';
import { isMobileHpgEquipment } from '../aerospace-support-equipment.model';

export const MEK_HEAT_PROFILE_SCHEMA_VERSION = 3 as const;

export interface MekHeatSinkGroup {
    /** One installed mount. Multi-slot sinks therefore lose cooling only once. */
    readonly componentId: ComponentId;
    readonly allocation: 'engine' | 'external';
    readonly units: number;
    readonly dissipationPerUnit: 1 | 2;
    readonly dissipation: number;
    readonly criticalSlotIds: readonly CriticalSlotId[];
    readonly legMounted: boolean;
}

export interface MekHeatSystemGroup {
    readonly componentId: ComponentId;
    readonly criticalSlotIds: readonly CriticalSlotId[];
}

export interface MekEngineHeatProfile {
    readonly type: string;
    readonly xxl: boolean;
    readonly fusion: boolean;
    /** Industrial ICE/Fuel Cell Meks alone waive ordinary ground-movement heat. */
    readonly heatlessIndustrialGroundMovement: boolean;
    readonly systems: readonly MekHeatSystemGroup[];
    readonly componentIds: readonly ComponentId[];
    readonly criticalSlotIds: readonly CriticalSlotId[];
    readonly heatPerCriticalHit: 5;
    readonly maximumCriticalHeat: 10;
    readonly movementHeatByMode: Readonly<{
        readonly stationary: number;
        readonly walk: number;
        readonly run: number;
        readonly sprint: number;
        readonly UMU: 1 | 2;
    }>;
}

export type MekJumpHeatKind =
    | 'none'
    | 'standard'
    | 'improved'
    | 'prototype-improved';

export interface MekJumpHeatProfile {
    readonly installedMp: number;
    readonly kind: MekJumpHeatKind;
    /** Conventional jump jets only. */
    readonly componentIds: readonly ComponentId[];
    /** Entity-authored alternate jump systems whose use generates no heat. */
    readonly boosterComponentIds: readonly ComponentId[];
    readonly criticalSlotIds: readonly CriticalSlotId[];
}

export interface MekSuperCooledMyomerHeatProfile {
    readonly componentIds: readonly ComponentId[];
    readonly criticalSlotIds: readonly CriticalSlotId[];
    readonly dissipationLossPerCriticalHit: 0 | 1 | 2;
}

export interface MekPartialWingHeatProfile {
    readonly componentIds: readonly ComponentId[];
    readonly criticalSlotIds: readonly CriticalSlotId[];
    readonly dissipationBonus: 3;
    readonly dissipationLossPerCriticalHit: 1;
    readonly jumpHeatDistanceReduction: 1 | 2;
}

export type MekHeatProvider =
    | {
        readonly kind: 'weapon';
        readonly componentId: ComponentId;
        readonly heat: number;
    }
    | {
        readonly kind: 'ppc-capacitor';
        readonly componentId: ComponentId;
        readonly weaponId: ComponentId;
        /** Passive source while charging or charged. */
        readonly heatWhileChargingOrCharged: 5;
        /** Added to the linked PPC's firing heat only while charged and usable. */
        readonly firingHeatBonusWhenCharged: 5;
    }
    | {
        readonly kind: 'radical-heat-sink';
        readonly componentId: ComponentId;
    }
    | {
        readonly kind: 'coolant-system';
        readonly componentId: ComponentId;
        readonly sourceId: 'radical-heat-sink' | 'risc-emergency-coolant';
        readonly label: 'Radical Heat Sink leak' | 'RISC coolant leak';
    }
    | {
        readonly kind: 'viral-jammer';
        readonly componentId: ComponentId;
        readonly heat: 12;
    }
    | {
        readonly kind: 'vibroblade';
        readonly componentId: ComponentId;
        readonly label: string;
        readonly heat: number;
    }
    | {
        readonly kind: 'stealth-system';
        readonly componentId: ComponentId;
        readonly label: 'Stealth' | 'Void Signature';
        readonly heat: 6 | 10;
    }
    | {
        readonly kind: 'nova-cews';
        readonly componentId: ComponentId;
        readonly heat: 2;
    }
    | {
        readonly kind: 'mobile-hpg';
        readonly componentId: ComponentId;
        readonly heat: 20 | 40;
    };

/**
 * Rules-resolved, framework-free heat topology for the currently bounded
 * simple-weapon/PPC lane. It deliberately contains no runtime state.
 */
export interface MekHeatProfile {
    readonly schemaVersion: typeof MEK_HEAT_PROFILE_SCHEMA_VERSION;
    /** Total Warfare adds one heat for every stand-up attempt; Core does not. */
    readonly heatPerStandAttempt: 0 | 1;
    readonly landAirMek: boolean;
    readonly declaredHeatSinkUnits: number;
    readonly baseDissipation: number;
    /** V1 turns off anonymous sink pips at the engine sink rate. */
    readonly dissipationPerDisabledSink: 0 | 1 | 2;
    readonly heatSinks: readonly MekHeatSinkGroup[];
    readonly engine: MekEngineHeatProfile;
    readonly jump: MekJumpHeatProfile;
    readonly superCooledMyomer: MekSuperCooledMyomerHeatProfile;
    readonly partialWing?: MekPartialWingHeatProfile;
    readonly providers: readonly MekHeatProvider[];
}

export type MekHeatProfileBlockerCode =
    | 'NOT_A_MEK'
    | 'INVALID_DECLARED_HEAT_SINK_COUNT'
    | 'INVALID_HEAT_SINK_GROUP'
    | 'HEAT_SINK_COUNT_MISMATCH'
    | 'MIXED_HEAT_SINK_DISSIPATION'
    | 'EXTERNAL_HEAT_SINK_WITHOUT_CRITICALS'
    | 'ENGINE_SYSTEM_MISSING'
    | 'ENGINE_SYSTEM_WITHOUT_CRITICALS'
    | 'UNSUPPORTED_ENGINE_SYSTEM'
    | 'JUMP_MP_WITHOUT_JUMP_SYSTEM'
    | 'JUMP_SYSTEM_WITHOUT_JUMP_MP'
    | 'JUMP_SYSTEM_WITHOUT_CRITICALS'
    | 'AMBIGUOUS_JUMP_SYSTEM_TYPE'
    | 'MIXED_JUMP_SYSTEM_TYPES'
    | 'SCM_WITHOUT_CRITICALS'
    | 'PARTIAL_WING_WITHOUT_CRITICALS'
    | 'INVALID_WEAPON_HEAT'
    | 'UNSUPPORTED_WEAPON_INTERACTION'
    | 'UNSUPPORTED_PPC_CAPACITOR_RELATION'
    | 'UNSUPPORTED_HEAT_AFFECTING_FLAG'
    | 'UNSUPPORTED_HEAT_AFFECTING_RELATION'
    | 'UNSUPPORTED_HEAT_AFFECTING_CONSTRUCTION';

export interface MekHeatProfileBlocker {
    readonly code: MekHeatProfileBlockerCode;
    /** Stable detail used by corpus review; never a localized UI string. */
    readonly feature: string;
    readonly componentIds: readonly ComponentId[];
    readonly message: string;
}

export type MekHeatProfileResult =
    | { readonly kind: 'supported'; readonly profile: MekHeatProfile }
    | { readonly kind: 'unsupported'; readonly blockers: readonly MekHeatProfileBlocker[] };

export interface MekHeatScenarioInput {
    readonly id: string;
    readonly options?: Readonly<Record<string, string | number | boolean>>;
}

export type MekHeatScenarioBlockerCode =
    | 'SCENARIO_ID_INVALID'
    | 'SCENARIO_OPTIONS_UNSUPPORTED';

export interface MekHeatScenarioBlocker {
    readonly code: MekHeatScenarioBlockerCode;
    readonly feature: string;
    readonly message: string;
}

export type MekHeatScenarioSupportResult =
    | { readonly kind: 'supported' }
    | { readonly kind: 'unsupported'; readonly blockers: readonly MekHeatScenarioBlocker[] };

/**
 * Compile immutable heat topology without retaining a registry, Angular
 * signal, MountedEquipment, or runtime owner. Unsupported layouts are data,
 * not exceptions, so admission can fail before a command is dispatched.
 */
export function compileMekHeatProfile(
    entity: MekEntity,
    index: MekRuntimeIndex,
    ruleset: CBTRuleset,
): MekHeatProfileResult {
    const blockers: MekHeatProfileBlocker[] = [];
    const slotsByComponent = indexCriticalSlots(index);
    const heatSinks = compileHeatSinks(entity, index, slotsByComponent, blockers);
    const engine = compileEngine(entity, index, slotsByComponent, blockers);
    const jump = compileJump(entity, index, slotsByComponent, blockers);
    const declaredHeatSinkUnits = entity.totalHeatSinks();
    const rates = new Set(heatSinks.map(group => group.dissipationPerUnit));
    const disabledRate: 0 | 1 | 2 | undefined = rates.size === 1
        ? [...rates][0]
        : rates.size === 0 && declaredHeatSinkUnits === 0 ? 0 : undefined;
    if (rates.size > 1) blockers.push(profileBlocker(
        'MIXED_HEAT_SINK_DISSIPATION',
        [...rates].sort().join('/'),
        heatSinks.map(group => group.componentId),
        'The bounded heat profile cannot turn off anonymous pips across mixed sink dissipation rates',
    ));

    const superCooledMyomer = compileSuperCooledMyomer(
        index,
        slotsByComponent,
        disabledRate ?? 1,
        blockers,
    );
    const partialWing = compilePartialWing(entity, index, slotsByComponent, blockers);
    const providers = compileHeatProviders(entity, index, ruleset, blockers);
    classifyUnsupportedConstruction(entity, index, blockers);
    classifyUnsupportedEquipmentHeat(index, blockers);

    const installedHeatSinkUnits = heatSinks.reduce((total, group) => total + group.units, 0);
    if (!Number.isSafeInteger(declaredHeatSinkUnits) || declaredHeatSinkUnits < 0) {
        blockers.push(profileBlocker(
            'INVALID_DECLARED_HEAT_SINK_COUNT',
            String(declaredHeatSinkUnits),
            [],
            'The bounded Mek heat profile requires a non-negative integral declared heat-sink count',
        ));
    }
    if (installedHeatSinkUnits !== declaredHeatSinkUnits) blockers.push(profileBlocker(
        'HEAT_SINK_COUNT_MISMATCH',
        `${installedHeatSinkUnits}/${declaredHeatSinkUnits}`,
        heatSinks.map(group => group.componentId),
        `Installed heat-sink units ${installedHeatSinkUnits} do not match declared count ${declaredHeatSinkUnits}`,
    ));

    if (blockers.length > 0 || disabledRate === undefined) return unsupported(blockers);
    const profile: MekHeatProfile = Object.freeze({
        schemaVersion: MEK_HEAT_PROFILE_SCHEMA_VERSION,
        heatPerStandAttempt: ruleset === 'total-warfare' ? 1 : 0,
        landAirMek: entity.isLandAirMek(),
        declaredHeatSinkUnits,
        baseDissipation: heatSinks.reduce((total, group) => total + group.dissipation, 0),
        dissipationPerDisabledSink: disabledRate,
        heatSinks: Object.freeze(heatSinks),
        engine,
        jump,
        superCooledMyomer,
        ...(partialWing === undefined ? {} : { partialWing }),
        providers: Object.freeze(providers),
    });
    return Object.freeze({ kind: 'supported', profile });
}

/** Mechanics-owned options are admitted only when their exact values are heat-inert. */
export function evaluateMekHeatScenarioSupport(
    input: unknown,
): MekHeatScenarioSupportResult {
    const blockers: MekHeatScenarioBlocker[] = [];
    if (!isRecord(input) || Object.getPrototypeOf(input) !== Object.prototype) {
        blockers.push(scenarioBlocker(
            'SCENARIO_ID_INVALID',
            '$',
            'Heat scenario input must be one exact plain record',
        ));
        return Object.freeze({ kind: 'unsupported', blockers: Object.freeze(blockers) });
    }
    for (const key of Object.keys(input).filter(key => key !== 'id' && key !== 'options').sort(compareText)) {
        blockers.push(scenarioBlocker(
            'SCENARIO_OPTIONS_UNSUPPORTED',
            key,
            `Scenario field ${key} is not part of the bounded heat input`,
        ));
    }
    if (typeof input['id'] !== 'string'
        || input['id'].trim().length === 0 || input['id'].includes('\0')) {
        blockers.push(scenarioBlocker(
            'SCENARIO_ID_INVALID',
            'id',
            'Heat settlement requires one nonempty detached scenario identifier',
        ));
    }
    const options = input['options'];
    if (options !== undefined) {
        if (!isRecord(options)) {
            blockers.push(scenarioBlocker(
                'SCENARIO_OPTIONS_UNSUPPORTED',
                '<invalid-options>',
                'Scenario heat options must be a plain record',
            ));
        } else {
            for (const key of Object.keys(options)
                .filter(key => key !== 'forcedWithdrawal' && key !== 'sprinting')
                .sort(compareText)) {
                blockers.push(scenarioBlocker(
                    'SCENARIO_OPTIONS_UNSUPPORTED',
                    key,
                    `Scenario option ${key} has no explicit bounded heat semantics`,
                ));
            }
            for (const key of ['forcedWithdrawal', 'sprinting'] as const) {
                if (Object.prototype.hasOwnProperty.call(options, key)
                    && typeof options[key] !== 'boolean') {
                    blockers.push(scenarioBlocker(
                        'SCENARIO_OPTIONS_UNSUPPORTED',
                        key,
                        `Scenario option ${key} must be an exact boolean`,
                    ));
                }
            }
        }
    }
    if (blockers.length === 0) return Object.freeze({ kind: 'supported' });
    return Object.freeze({
        kind: 'unsupported',
        blockers: Object.freeze(blockers.sort(compareScenarioBlockers)),
    });
}

function compileHeatSinks(
    entity: MekEntity,
    index: MekRuntimeIndex,
    slotsByComponent: ReadonlyMap<ComponentId, readonly CriticalSlotId[]>,
    blockers: MekHeatProfileBlocker[],
): MekHeatSinkGroup[] {
    const groups: MekHeatSinkGroup[] = [];
    for (const [componentId, component] of sortedComponents(index)) {
        if (component.kind !== 'equipment') continue;
        const equipment = component.mount.equipment;
        if (!(equipment instanceof MiscEquipment) || !equipment.isHeatSink) continue;
        const units = equipment.heatSinkUnitsPerMount;
        const dissipationPerUnit = heatSinkDissipationRate(equipment);
        if (!Number.isSafeInteger(units) || units <= 0 || dissipationPerUnit === null) {
            blockers.push(profileBlocker(
                'INVALID_HEAT_SINK_GROUP',
                equipment.id,
                [componentId],
                `Heat sink ${equipment.id} has no supported positive unit/rate profile`,
            ));
            continue;
        }
        const allocation = component.mount.allocation.kind === 'engine' ? 'engine' : 'external';
        const criticalSlotIds = slotsByComponent.get(componentId) ?? Object.freeze([]);
        const legMounted = criticalSlotIds.some(slotId => {
            const slot = index.slots.get(slotId);
            const location = slot === undefined ? undefined : index.locations.get(slot.locationId);
            return location !== undefined && entity.locationIsLeg(location.code);
        });
        if (allocation === 'external' && criticalSlotIds.length === 0) blockers.push(profileBlocker(
            'EXTERNAL_HEAT_SINK_WITHOUT_CRITICALS',
            equipment.id,
            [componentId],
            `External heat sink ${equipment.id} has no immutable critical-slot topology`,
        ));
        groups.push(Object.freeze({
            componentId,
            allocation,
            units,
            dissipationPerUnit,
            dissipation: units * dissipationPerUnit,
            criticalSlotIds,
            legMounted,
        }));
    }
    return groups;
}

function compileEngine(
    entity: MekEntity,
    index: MekRuntimeIndex,
    slotsByComponent: ReadonlyMap<ComponentId, readonly CriticalSlotId[]>,
    blockers: MekHeatProfileBlocker[],
): MekEngineHeatProfile {
    const systems: MekHeatSystemGroup[] = [];
    for (const [componentId, component] of sortedComponents(index)) {
        if (component.kind !== 'system') continue;
        if (component.systemType !== 'Engine') {
            if (component.systemType.toLowerCase().includes('engine')) blockers.push(profileBlocker(
                'UNSUPPORTED_ENGINE_SYSTEM',
                component.systemType,
                [componentId],
                `Engine-like system ${component.systemType} is not the canonical Engine system`,
            ));
            continue;
        }
        const criticalSlotIds = slotsByComponent.get(componentId) ?? Object.freeze([]);
        if (criticalSlotIds.length === 0) blockers.push(profileBlocker(
            'ENGINE_SYSTEM_WITHOUT_CRITICALS',
            component.systemType,
            [componentId],
            'An Engine system component has no immutable critical-slot topology',
        ));
        systems.push(Object.freeze({ componentId, criticalSlotIds }));
    }
    const mountedEngine = entity.mountedEngine();
    const installed = mountedEngine.installed;
    if (installed && systems.length === 0) blockers.push(profileBlocker(
        'ENGINE_SYSTEM_MISSING',
        mountedEngine.type(),
        [],
        'An installed Mek engine has no canonical Engine system component',
    ));
    const xxl = mountedEngine.type() === 'XXL';
    const movementHeat = mountedEngine.movementHeat;
    const componentIds = Object.freeze(systems.map(system => system.componentId));
    const criticalSlotIds = freezeSortedUnique(systems.flatMap(system => system.criticalSlotIds));
    return Object.freeze({
        type: mountedEngine.type(),
        xxl,
        fusion: mountedEngine.isFusion,
        heatlessIndustrialGroundMovement: entity.isIndustrial()
            && (mountedEngine.powerSource === 'combustion'
                || mountedEngine.powerSource === 'fuel-cell'),
        systems: Object.freeze(systems),
        componentIds,
        criticalSlotIds,
        heatPerCriticalHit: 5,
        maximumCriticalHeat: 10,
        movementHeatByMode: Object.freeze({
            stationary: movementHeat.standing,
            walk: movementHeat.walk,
            run: movementHeat.run,
            sprint: movementHeat.sprint,
            UMU: xxl ? 2 as const : 1 as const,
        }),
    });
}

function compileJump(
    entity: MekEntity,
    index: MekRuntimeIndex,
    slotsByComponent: ReadonlyMap<ComponentId, readonly CriticalSlotId[]>,
    blockers: MekHeatProfileBlocker[],
): MekJumpHeatProfile {
    const kinds = new Set<Exclude<MekJumpHeatKind, 'none'>>();
    const componentIds: ComponentId[] = [];
    const boosterComponentIds: ComponentId[] = [];
    const criticalSlotIds: CriticalSlotId[] = [];
    for (const [componentId, component] of sortedComponents(index)) {
        if (component.kind !== 'equipment') continue;
        const equipment = component.mount.equipment;
        if (!equipment) continue;
        if (isJumpBoosterEquipment(equipment)) {
            boosterComponentIds.push(componentId);
            const slots = slotsByComponent.get(componentId) ?? Object.freeze([]);
            criticalSlotIds.push(...slots);
            if (slots.length === 0) blockers.push(profileBlocker(
                'JUMP_SYSTEM_WITHOUT_CRITICALS',
                equipment.id,
                [componentId],
                `Jump booster ${equipment.id} has no immutable critical-slot topology`,
            ));
            continue;
        }
        if (!isJumpJetEquipment(equipment)) continue;
        const kind = jumpJetKind(equipment);
        if (kind === null) blockers.push(profileBlocker(
            'AMBIGUOUS_JUMP_SYSTEM_TYPE',
            equipment.id,
            [componentId],
            `Jump system ${equipment.id} has contradictory subtype flags`,
        ));
        else kinds.add(kind);
        componentIds.push(componentId);
        const slots = slotsByComponent.get(componentId) ?? Object.freeze([]);
        criticalSlotIds.push(...slots);
        if (slots.length === 0) blockers.push(profileBlocker(
            'JUMP_SYSTEM_WITHOUT_CRITICALS',
            equipment.id,
            [componentId],
            `Jump system ${equipment.id} has no immutable critical-slot topology`,
        ));
    }
    const conventionalMp = entity.computeJumpMP({
        ...STANDARD_MOVEMENT_CALCULATION,
        ignoreModularArmor: true,
        ignoreShield: true,
    });
    const installedMp = entity.computeJumpMP({
        ...STANDARD_MOVEMENT_CALCULATION,
        ignoreModularArmor: true,
        ignoreShield: true,
        includeAlternateJumpSystems: true,
    });
    if (conventionalMp > 0 && componentIds.length === 0) blockers.push(profileBlocker(
        'JUMP_MP_WITHOUT_JUMP_SYSTEM',
        String(conventionalMp),
        [],
        `Conventional jump MP ${conventionalMp} has no supported jump-jet component`,
    ));
    if (conventionalMp === 0 && componentIds.length > 0) blockers.push(profileBlocker(
        'JUMP_SYSTEM_WITHOUT_JUMP_MP',
        String(componentIds.length),
        componentIds,
        'Jump-jet components exist while installed jump MP is zero',
    ));
    if (installedMp > 0 && componentIds.length === 0 && boosterComponentIds.length === 0) {
        blockers.push(profileBlocker(
            'JUMP_MP_WITHOUT_JUMP_SYSTEM',
            String(installedMp),
            [],
            `Installed jump MP ${installedMp} has no supported jump system`,
        ));
    }
    if (installedMp === 0 && boosterComponentIds.length > 0) blockers.push(profileBlocker(
        'JUMP_SYSTEM_WITHOUT_JUMP_MP',
        String(boosterComponentIds.length),
        boosterComponentIds,
        'Jump-booster components exist while installed jump MP is zero',
    ));
    if (kinds.size > 1) blockers.push(profileBlocker(
        'MIXED_JUMP_SYSTEM_TYPES',
        [...kinds].sort(compareText).join('/'),
        componentIds,
        'The bounded jump-heat rule cannot choose among mixed jump-system types',
    ));
    return Object.freeze({
        installedMp,
        kind: componentIds.length === 0 || kinds.size !== 1 ? 'none' : [...kinds][0]!,
        componentIds: Object.freeze(componentIds),
        boosterComponentIds: Object.freeze(boosterComponentIds),
        criticalSlotIds: freezeSortedUnique(criticalSlotIds),
    });
}

function compileSuperCooledMyomer(
    index: MekRuntimeIndex,
    slotsByComponent: ReadonlyMap<ComponentId, readonly CriticalSlotId[]>,
    dissipationLossPerCriticalHit: 0 | 1 | 2,
    blockers: MekHeatProfileBlocker[],
): MekSuperCooledMyomerHeatProfile {
    const componentIds: ComponentId[] = [];
    const criticalSlotIds: CriticalSlotId[] = [];
    for (const [componentId, component] of sortedComponents(index)) {
        const equipment = component.kind === 'equipment' ? component.mount.equipment : undefined;
        if (!equipment || !isSuperCooledMyomerEquipment(equipment)) continue;
        componentIds.push(componentId);
        const slots = slotsByComponent.get(componentId) ?? Object.freeze([]);
        criticalSlotIds.push(...slots);
        if (slots.length === 0) blockers.push(profileBlocker(
            'SCM_WITHOUT_CRITICALS',
            equipment.id,
            [componentId],
            'Super-cooled myomer has no immutable critical-slot topology',
        ));
    }
    return Object.freeze({
        componentIds: Object.freeze(componentIds),
        criticalSlotIds: freezeSortedUnique(criticalSlotIds),
        dissipationLossPerCriticalHit,
    });
}

function compilePartialWing(
    entity: MekEntity,
    index: MekRuntimeIndex,
    slotsByComponent: ReadonlyMap<ComponentId, readonly CriticalSlotId[]>,
    blockers: MekHeatProfileBlocker[],
): MekPartialWingHeatProfile | undefined {
    const componentIds: ComponentId[] = [];
    const criticalSlotIds: CriticalSlotId[] = [];
    for (const [componentId, component] of sortedComponents(index)) {
        const equipment = component.kind === 'equipment' ? component.mount.equipment : undefined;
        if (!equipment || !isPartialWingEquipment(equipment)) continue;
        componentIds.push(componentId);
        const slots = slotsByComponent.get(componentId) ?? Object.freeze([]);
        criticalSlotIds.push(...slots);
        if (slots.length === 0) blockers.push(profileBlocker(
            'PARTIAL_WING_WITHOUT_CRITICALS',
            equipment.id,
            [componentId],
            'Partial wing has no immutable critical-slot topology',
        ));
    }
    if (componentIds.length === 0) return undefined;
    return Object.freeze({
        componentIds: Object.freeze(componentIds),
        criticalSlotIds: freezeSortedUnique(criticalSlotIds),
        dissipationBonus: PARTIAL_WING_HEAT_DISSIPATION_BONUS,
        dissipationLossPerCriticalHit: 1,
        jumpHeatDistanceReduction: entity.tonnage() <= 55 ? 2 : 1,
    });
}

function compileHeatProviders(
    entity: MekEntity,
    index: MekRuntimeIndex,
    ruleset: CBTRuleset,
    blockers: MekHeatProfileBlocker[],
): MekHeatProvider[] {
    const providers: MekHeatProvider[] = [];
    const exactPpcRelations = new Set<string>();
    const exactLaserInsulatorRelations = new Set<string>();
    const exactRiscLaserRelations = new Set<string>();
    for (const [sourceId, targetId] of index.relationships.linkedTargetBySource) {
        if (isPpcCapacitorPair(entity, index, sourceId, targetId)) {
            exactPpcRelations.add(relationKey(sourceId, targetId));
            providers.push(Object.freeze({
                kind: 'ppc-capacitor',
                componentId: sourceId,
                weaponId: targetId,
                heatWhileChargingOrCharged: 5,
                firingHeatBonusWhenCharged: 5,
            }));
        } else if (isMekRiscLaserPulsePair(index, sourceId, targetId)) {
            exactRiscLaserRelations.add(relationKey(sourceId, targetId));
        } else if (isMekLaserInsulatorPair(index, sourceId, targetId)) {
            exactLaserInsulatorRelations.add(relationKey(sourceId, targetId));
        } else if (relationTouchesHeatModifier(index, sourceId, targetId)) {
            blockers.push(profileBlocker(
                'UNSUPPORTED_HEAT_AFFECTING_RELATION',
                `linked:${sourceId}->${targetId}`,
                [sourceId, targetId],
                'A linked heat/firing relation is outside the supported exact relation profiles',
            ));
        }
    }

    for (const [componentId, component] of sortedComponents(index)) {
        const equipment = component.kind === 'equipment' ? component.mount.equipment : undefined;
        const vibroblade = equipment === undefined ? null : getVibrobladeProfileFromFlags(equipment.flags);
        if (equipment && vibroblade) providers.push(Object.freeze({
            kind: 'vibroblade',
            componentId,
            label: equipment.shortName,
            heat: vibroblade.activeHeat,
        }));
        const stealthHeat = equipment === undefined ? null : stealthSystemHeat(equipment);
        if (stealthHeat !== null) {
            providers.push(Object.freeze({
                kind: 'stealth-system',
                componentId,
                label: isVoidSignatureEquipment(equipment) ? 'Void Signature' : 'Stealth',
                heat: stealthHeat,
            }));
        }
        if (equipment && isNovaCewsEquipment(equipment)) providers.push(Object.freeze({
            kind: 'nova-cews',
            componentId,
            heat: 2,
        }));
        if (equipment && isMobileHpgEquipment(equipment)) providers.push(Object.freeze({
            kind: 'mobile-hpg',
            componentId,
            heat: isGroundMobileHpgEquipment(equipment) ? 20 : 40,
        }));
        providers.push(...escalatingFailureHeatProviders(equipment, componentId));
        if (equipment && isPpcCapacitorEquipment(equipment)) {
            const targetId = index.relationships.linkedTargetBySource.get(componentId);
            if (!targetId || !exactPpcRelations.has(relationKey(componentId, targetId))) blockers.push(profileBlocker(
                'UNSUPPORTED_PPC_CAPACITOR_RELATION',
                equipment.id,
                targetId ? [componentId, targetId] : [componentId],
                `PPC capacitor ${equipment.id} has no exact supported capacitor-to-PPC relation`,
            ));
        }
        if (!(equipment instanceof WeaponEquipment) || isPhysicalWeaponEquipment(equipment)) continue;
        if (!Number.isFinite(equipment.heat) || equipment.heat < 0) {
            blockers.push(profileBlocker(
                'INVALID_WEAPON_HEAT',
                equipment.id,
                [componentId],
                `Weapon ${equipment.id} has invalid heat ${String(equipment.heat)}`,
            ));
            continue;
        }
        const heatAffectingRelations = [...index.relationships.linkedTargetBySource]
            .filter(([sourceId, targetId]) => {
                if (sourceId !== componentId && targetId !== componentId) return false;
                const source = equipmentForComponent(index, sourceId);
                return isPpcCapacitorEquipment(source)
                    || isRiscLaserPulseEnhancement(source)
                    || isLaserInsulatorEquipment(source);
            });
        const exactSupportedRelationsOnly = heatAffectingRelations.length === 0
            || (heatAffectingRelations.length === 1
                && (exactPpcRelations.has(relationKey(
                    heatAffectingRelations[0]![0],
                    heatAffectingRelations[0]![1],
                )) || exactRiscLaserRelations.has(relationKey(
                    heatAffectingRelations[0]![0],
                    heatAffectingRelations[0]![1],
                )) || exactLaserInsulatorRelations.has(relationKey(
                    heatAffectingRelations[0]![0],
                    heatAffectingRelations[0]![1],
                )))
                && heatAffectingRelations[0]![1] === componentId);
        const bayClaims = index.relationships.bays.filter(bay =>
            bay.controllerId === componentId || bay.memberIds.includes(componentId));
        const modes = mekComponentModes(entity, index, componentId, ruleset).modes;
        const bombastModes = bombastLaserModes(ruleset);
        const exactBombast = !isBombastLaserEquipment(equipment)
            || (modes.length === bombastModes.length
                && modes.every((mode, position) => mode === bombastModes[position]));
        const unsupported = bayClaims.length > 1 || !exactBombast || !exactSupportedRelationsOnly;
        if (unsupported) blockers.push(profileBlocker(
            'UNSUPPORTED_WEAPON_INTERACTION',
            equipment.id,
            [componentId],
            `Weapon ${equipment.id} is outside the bounded simple-fire/PPC heat profile`,
        ));
        else providers.push(Object.freeze({
            kind: 'weapon',
            componentId,
            heat: equipment.heat,
        }));
    }
    return providers.sort(compareProviders);
}

function classifyUnsupportedEquipmentHeat(
    index: MekRuntimeIndex,
    blockers: MekHeatProfileBlocker[],
): void {
    for (const [componentId, component] of sortedComponents(index)) {
        const equipment = component.kind === 'equipment' ? component.mount.equipment : undefined;
        if (!equipment) continue;
        const unsupportedFlag = unsupportedMekHeatFlag(equipment);
        if (unsupportedFlag !== undefined) {
            blockers.push(profileBlocker(
                'UNSUPPORTED_HEAT_AFFECTING_FLAG',
                unsupportedFlag,
                [componentId],
                `Component ${equipment.id} uses unsupported heat-affecting flag ${unsupportedFlag}`,
            ));
        }
        const linkedTargetId = index.relationships.linkedTargetBySource.get(componentId);
        const supportedRiscLaserPulse = linkedTargetId !== undefined
            && isMekRiscLaserPulsePair(index, componentId, linkedTargetId);
        if (equipment instanceof MiscEquipment && equipment.operatingHeat !== 0
            && unsupportedFlag === undefined
            && escalatingFailureHeatProviders(equipment, componentId).length === 0
            && !supportedRiscLaserPulse
            && stealthSystemHeat(equipment) === null
            && !isNovaCewsEquipment(equipment)
            && !isMobileHpgEquipment(equipment)
            && !isSpotWelderEquipment(equipment)
            && getVibrobladeProfileFromFlags(equipment.flags) === null) blockers.push(profileBlocker(
            'UNSUPPORTED_HEAT_AFFECTING_FLAG',
            `operating-heat:${equipment.operatingHeat}`,
            [componentId],
            `Component ${equipment.id} has unsupported operating heat ${equipment.operatingHeat}`,
        ));
    }
}

function stealthSystemHeat(equipment: Equipment): 6 | 10 | null {
    if (!isSwitchableStealthEquipment(equipment)
        || (!isStealthEquipment(equipment)
            && !isChameleonShieldEquipment(equipment)
            && !isNullSignatureEquipment(equipment)
            && !isVoidSignatureEquipment(equipment))) return null;
    return isChameleonShieldEquipment(equipment) ? 6 : 10;
}

function classifyUnsupportedConstruction(
    entity: MekEntity,
    index: MekRuntimeIndex,
    blockers: MekHeatProfileBlocker[],
): void {
    if (entity.hasRiscHeatSinkOverrideKit()) blockers.push(profileBlocker(
        'UNSUPPORTED_HEAT_AFFECTING_CONSTRUCTION',
        'risc-heat-sink-override-kit',
        [],
        'The RISC heat-sink override kit has no bounded settlement profile',
    ));
    const materials = new Map<string, string>();
    for (const location of index.locations.values()) {
        const armorEquipment = location.armor.armor;
        if (isHeatDissipatingArmor(armorEquipment)) {
            materials.set(`${armorEquipment.id}:heat-dissipating`, 'heat-dissipating armor');
        }
    }
    for (const [feature, flag] of [...materials].sort(([left], [right]) => compareText(left, right))) {
        blockers.push(profileBlocker(
            'UNSUPPORTED_HEAT_AFFECTING_CONSTRUCTION',
            feature,
            [],
            `Armor construction uses unsupported heat-affecting rule ${flag}`,
        ));
    }
}

function relationTouchesHeatModifier(
    index: MekRuntimeIndex,
    sourceId: ComponentId,
    targetId: ComponentId,
): boolean {
    return [sourceId, targetId].some(componentId => {
        const equipment = equipmentForComponent(index, componentId);
        return isLaserInsulatorEquipment(equipment)
            || isRiscLaserPulseEnhancement(equipment)
            || isPpcCapacitorEquipment(equipment);
    });
}

function indexCriticalSlots(
    index: MekRuntimeIndex,
): ReadonlyMap<ComponentId, readonly CriticalSlotId[]> {
    const mutable = new Map<ComponentId, CriticalSlotId[]>();
    for (const slot of index.slots.values()) {
        for (const componentId of slot.componentIds) {
            const ids = mutable.get(componentId) ?? [];
            ids.push(slot.id);
            mutable.set(componentId, ids);
        }
    }
    return new Map([...mutable].map(([componentId, slotIds]) => [
        componentId,
        freezeSortedUnique(slotIds),
    ] as const));
}

function sortedComponents(
    index: MekRuntimeIndex,
): readonly (readonly [ComponentId, MekIndexedComponent])[] {
    return [...index.components].sort(([left], [right]) => compareText(left, right));
}

function freezeSortedUnique<T extends string>(values: readonly T[]): readonly T[] {
    return Object.freeze([...new Set(values)].sort(compareText));
}

function unsupported(
    blockers: readonly MekHeatProfileBlocker[],
): Extract<MekHeatProfileResult, { kind: 'unsupported' }> {
    const unique = new Map<string, MekHeatProfileBlocker>();
    for (const item of blockers) {
        const key = `${item.code}\0${item.feature}\0${item.componentIds.join('\0')}`;
        unique.set(key, item);
    }
    return Object.freeze({
        kind: 'unsupported',
        blockers: Object.freeze([...unique.values()].sort(compareProfileBlockers)),
    });
}

function profileBlocker(
    code: MekHeatProfileBlockerCode,
    feature: string,
    componentIds: readonly ComponentId[],
    message: string,
): MekHeatProfileBlocker {
    return Object.freeze({
        code,
        feature,
        componentIds: freezeSortedUnique(componentIds),
        message,
    });
}

function scenarioBlocker(
    code: MekHeatScenarioBlockerCode,
    feature: string,
    message: string,
): MekHeatScenarioBlocker {
    return Object.freeze({ code, feature, message });
}

function compareProfileBlockers(
    left: MekHeatProfileBlocker,
    right: MekHeatProfileBlocker,
): number {
    return compareText(left.code, right.code)
        || compareText(left.feature, right.feature)
        || compareText(left.componentIds.join('\0'), right.componentIds.join('\0'));
}

function compareScenarioBlockers(
    left: MekHeatScenarioBlocker,
    right: MekHeatScenarioBlocker,
): number {
    return compareText(left.code, right.code) || compareText(left.feature, right.feature);
}

function compareProviders(left: MekHeatProvider, right: MekHeatProvider): number {
    return compareText(left.kind, right.kind)
        || compareText(left.componentId, right.componentId)
        || compareText(left.kind === 'ppc-capacitor' ? left.weaponId : '',
            right.kind === 'ppc-capacitor' ? right.weaponId : '');
}

function relationKey(sourceId: ComponentId, targetId: ComponentId): string {
    return `${sourceId}\0${targetId}`;
}

function compareText(left: string, right: string): number {
    return left < right ? -1 : left > right ? 1 : 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}
