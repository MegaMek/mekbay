// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import { compareText } from '../../utils/string.util';
import { isPlainRecord } from '../../utils/json-value.util';
import type { CBTRuleset } from '../cbt-ruleset.model';
import {
    c3EquipmentTraits,
    type C3EquipmentTraits,
    type C3NetworkType,
    type C3Role,
} from '../c3-network.model';
import { COCKPIT_DATA } from '../entity/components/cockpit-data';
import { ENGINE_DATA, type EnginePowerSource } from '../entity/components/engine-data';
import { GYRO_DATA } from '../entity/components/gyro-data';
import type { MekEntity } from '../entity/entities/mek/mek-entity';
import { LamEntity } from '../entity/entities/mek/lam-entity';
import {
    isPhysicalWeaponEquipment,
    isShieldEquipment,
    resolveShieldProfile,
    resolveShieldSize,
    type ShieldProfile,
} from '../entity/utils/physical-weapon';
import {
    RUN_WITHOUT_MASC_CALCULATION,
    STANDARD_MOVEMENT_CALCULATION,
} from '../entity/types';
import type { ComponentId, CriticalSlotId, LocationId } from '../entity/entity-identifiers';
import type { MekRuntimeIndex, MekIndexedComponent } from './mek-runtime-index';
import { isModularArmorEquipment } from '../modular-armor.model';
import { isHardenedArmor } from '../construction-equipment.model';
import {
    isMascEquipment,
    isSuperchargerEquipment,
} from './component-escalating-failure';
import {
    isJumpJetEquipment,
    isPartialWingEquipment,
    isUmuEquipment,
    jumpJetKind,
} from '../jump-equipment.model';
import {
    isActuatorEnhancementSystem,
    tripleStrengthMyomerKind,
} from '../myomer-equipment.model';
import { isDroneOperatingSystemEquipment } from '../drone-operating-system.model';
import { isRamPlateEquipment, isSpikesEquipment } from '../physical-augmentation.model';

export const PUBLISHED_MEK_MECHANICS_PROFILE_SCHEMA_VERSION = 2 as const;

export type MekLocationRole =
    | 'head'
    | 'center-torso'
    | 'left-torso'
    | 'right-torso'
    | 'left-arm'
    | 'right-arm'
    | 'left-leg'
    | 'right-leg'
    | 'center-leg'
    | 'front-left-leg'
    | 'front-right-leg'
    | 'rear-left-leg'
    | 'rear-right-leg';

export interface MekLocationMechanics {
    readonly locationId: LocationId;
    readonly code: string;
    readonly role: MekLocationRole;
    /** A location lost with this parent, rather than ordinary damage transfer. */
    readonly parentLocationId: LocationId | null;
    readonly damageTransferLocationId: LocationId | null;
    readonly limbKind?: 'arm' | 'leg';
}

export interface MekExactComponentGroup {
    readonly componentId: ComponentId;
    readonly criticalSlotIds: readonly CriticalSlotId[];
    readonly locationIds: readonly LocationId[];
}

export interface MekSystemGroup extends MekExactComponentGroup {
    readonly system: string;
}

export interface MekSystemTopology {
    readonly groups: readonly MekSystemGroup[];
    readonly componentIds: readonly ComponentId[];
    readonly criticalSlotIds: readonly CriticalSlotId[];
}

export interface MekEquipmentGroup extends MekExactComponentGroup {
    readonly equipmentId: string;
}

export interface MekShieldGroup extends MekEquipmentGroup, ShieldProfile {
    readonly size: 'small' | 'medium' | 'large';
}

export type MekJumpJetKind = 'standard' | 'improved' | 'prototype-improved';

export interface MekJumpJetGroup extends MekEquipmentGroup {
    readonly kind: MekJumpJetKind;
}

export type MekTripleStrengthMyomerKind = 'standard' | 'prototype' | 'industrial';

export interface MekTripleStrengthMyomerGroup extends MekEquipmentGroup {
    readonly kind: MekTripleStrengthMyomerKind;
}

export type MekActuatorKind =
    | 'shoulder'
    | 'upper-arm'
    | 'lower-arm'
    | 'hand'
    | 'hip'
    | 'upper-leg'
    | 'lower-leg'
    | 'foot';

export interface MekActuatorGroup extends MekSystemGroup {
    readonly kind: MekActuatorKind;
}

export interface MekLimbProfile {
    readonly locationId: LocationId;
    readonly role: MekLocationRole;
    readonly kind: 'arm' | 'leg';
    readonly parentLocationId: LocationId | null;
    readonly actuators: readonly MekActuatorGroup[];
}

export interface MekEngineMechanics extends MekSystemTopology {
    readonly type: string;
    readonly powerSource: EnginePowerSource;
    readonly fusionFamily: boolean;
    readonly rating: number;
    readonly destructionHitThreshold: 3;
}

export interface MekCockpitMechanics extends MekSystemTopology {
    readonly type: string;
    readonly main: MekSystemGroup;
    readonly commandConsole?: MekSystemGroup;
    readonly torsoMounted: boolean;
    readonly industrial: boolean;
    readonly primitive: boolean;
    readonly canEject: boolean;
}

export interface MekGyroMechanics extends MekSystemTopology {
    readonly type: string;
    readonly heavyDuty: boolean;
    /** Zero means the Mek has no gyro. Heavy-duty failure differs by ruleset. */
    readonly destructionHitThreshold: 0 | 2 | 3 | 4;
}

export interface MekSensorMechanics extends MekSystemTopology {
    readonly weaponFireDisableHitThreshold: 2 | 3;
}

export interface MekArmorVariant {
    readonly equipmentId: string;
    readonly type: string;
    readonly hardened: boolean;
    readonly locationIds: readonly LocationId[];
}

export interface MekOrdinaryC3Endpoint extends MekEquipmentGroup {
    readonly kind: 'ordinary';
    readonly networkType: C3NetworkType;
    readonly role: C3Role;
    readonly boosted: boolean;
}

export interface MekEmergencyC3Endpoint extends MekEquipmentGroup {
    readonly kind: 'emergency-master';
    readonly networkType: 'c3';
    readonly standbyRole: 'slave';
    readonly activatedRole: 'master';
    readonly boosted: false;
}

export interface MekMechanicsMovement {
    /** Pristine construction MP before damage, heat, boosters, or equipment penalties. */
    readonly baseWalkMp: number;
    readonly baseRunMp: number;
    readonly baseJumpMp: number;
    readonly baseUmuMp: number;
    readonly motiveType: string;
    readonly lamType?: string;
}

/**
 * Framework-free construction and exact hit topology needed by the first Mek
 * destruction/movement/physical/C3 mechanics wave. It contains no mutable
 * runtime state and never retains a registry, owner, signal, or mounted object.
 */
export interface MekMechanicsProfile {
    readonly schemaVersion: typeof PUBLISHED_MEK_MECHANICS_PROFILE_SCHEMA_VERSION;
    readonly rulesFlavor: CBTRuleset;
    readonly form: 'biped' | 'quad' | 'tripod' | 'lam' | 'quadvee';
    readonly configuration: 'biped' | 'quad' | 'tripod' | 'lam' | 'quadvee';
    readonly declaredMassTons: number;
    readonly locations: readonly MekLocationMechanics[];
    readonly engine: MekEngineMechanics;
    readonly cockpit: MekCockpitMechanics;
    readonly gyro: MekGyroMechanics;
    readonly sensors: MekSensorMechanics;
    readonly limbs: readonly MekLimbProfile[];
    readonly movement: MekMechanicsMovement;
    readonly myomerType: string;
    readonly jumpJets: readonly MekJumpJetGroup[];
    readonly umus: readonly MekEquipmentGroup[];
    readonly partialWings: readonly MekEquipmentGroup[];
    readonly tripleStrengthMyomer: readonly MekTripleStrengthMyomerGroup[];
    readonly masc: readonly MekEquipmentGroup[];
    readonly superchargers: readonly MekEquipmentGroup[];
    readonly actuatorEnhancementSystems: readonly MekEquipmentGroup[];
    readonly droneOperatingSystems: readonly MekEquipmentGroup[];
    readonly modularArmor: readonly MekEquipmentGroup[];
    readonly spikes: readonly MekEquipmentGroup[];
    readonly ramPlates: readonly MekEquipmentGroup[];
    readonly physicalWeapons: readonly MekEquipmentGroup[];
    readonly shields: readonly MekShieldGroup[];
    readonly armorVariants: readonly MekArmorVariant[];
    readonly ordinaryC3Endpoints: readonly MekOrdinaryC3Endpoint[];
    readonly emergencyC3Endpoints: readonly MekEmergencyC3Endpoint[];
}

export type MekMechanicsProfileBlockerCode =
    | 'NOT_A_MEK'
    | 'UNSUPPORTED_FORM'
    | 'UNSUPPORTED_RULESET'
    | 'INVALID_BASE_MOVEMENT'
    | 'INVALID_LOCATION_IDENTITY'
    | 'DUPLICATE_LOCATION_ROLE'
    | 'MISSING_CANONICAL_LOCATION'
    | 'UNEXPECTED_CANONICAL_LOCATION'
    | 'AMBIGUOUS_LOCATION_PARENT'
    | 'INVALID_COMPONENT_IDENTITY'
    | 'INVALID_CRITICAL_SLOT_IDENTITY'
    | 'DUPLICATE_CRITICAL_SLOT_COORDINATE'
    | 'CRITICAL_SLOT_REFERENCES_MISSING_COMPONENT'
    | 'COMPONENT_SLOT_TOPOLOGY_MISMATCH'
    | 'MISSING_REQUIRED_SYSTEM'
    | 'DUPLICATE_REQUIRED_SYSTEM'
    | 'SYSTEM_WITHOUT_CRITICALS'
    | 'SYSTEM_LOCATION_AMBIGUOUS'
    | 'MISSING_REQUIRED_ACTUATOR'
    | 'DUPLICATE_ACTUATOR'
    | 'FEATURE_WITHOUT_CRITICALS'
    | 'AMBIGUOUS_EQUIPMENT_ROLE'
    | 'JUMP_MP_WITHOUT_JUMP_JET'
    | 'JUMP_JET_WITHOUT_JUMP_MP'
    | 'UNSUPPORTED_ENGINE_VARIANT'
    | 'UNSUPPORTED_COCKPIT_VARIANT'
    | 'UNSUPPORTED_GYRO_VARIANT'
    | 'AMBIGUOUS_COCKPIT_TOPOLOGY'
    | 'AMBIGUOUS_C3_ENDPOINT';

export interface MekMechanicsProfileBlocker {
    readonly code: MekMechanicsProfileBlockerCode;
    readonly feature: string;
    readonly componentIds: readonly ComponentId[];
    readonly criticalSlotIds: readonly CriticalSlotId[];
    readonly message: string;
}

export type MekMechanicsProfileResult =
    | { readonly kind: 'supported'; readonly profile: MekMechanicsProfile }
    | { readonly kind: 'unsupported'; readonly blockers: readonly MekMechanicsProfileBlocker[] };

export interface MekMechanicsScenarioInput {
    readonly id: string;
    readonly options?: Readonly<{
        readonly forcedWithdrawal?: boolean;
        readonly sprinting?: boolean;
    }>;
}

export interface MekMechanicsScenarioRules {
    readonly forcedWithdrawal: boolean;
    readonly sprinting: boolean;
}

export type MekMechanicsScenarioBlockerCode =
    | 'SCENARIO_INPUT_INVALID'
    | 'SCENARIO_ID_INVALID'
    | 'SCENARIO_OPTIONS_UNSUPPORTED';

export interface MekMechanicsScenarioBlocker {
    readonly code: MekMechanicsScenarioBlockerCode;
    readonly feature: string;
    readonly message: string;
}

export type MekMechanicsScenarioSupportResult =
    | { readonly kind: 'supported'; readonly rules: MekMechanicsScenarioRules }
    | { readonly kind: 'unsupported'; readonly blockers: readonly MekMechanicsScenarioBlocker[] };

interface CompileIndexes {
    readonly locationOrder: ReadonlyMap<LocationId, number>;
    readonly slotsByComponent: ReadonlyMap<ComponentId, readonly CriticalSlotId[]>;
    readonly locationIdsByComponent: ReadonlyMap<ComponentId, readonly LocationId[]>;
}

interface CompiledFeatures {
    readonly jumpJets: MekJumpJetGroup[];
    readonly umus: MekEquipmentGroup[];
    readonly partialWings: MekEquipmentGroup[];
    readonly tripleStrengthMyomer: MekTripleStrengthMyomerGroup[];
    readonly masc: MekEquipmentGroup[];
    readonly superchargers: MekEquipmentGroup[];
    readonly actuatorEnhancementSystems: MekEquipmentGroup[];
    readonly droneOperatingSystems: MekEquipmentGroup[];
    readonly modularArmor: MekEquipmentGroup[];
    readonly spikes: MekEquipmentGroup[];
    readonly ramPlates: MekEquipmentGroup[];
    readonly physicalWeapons: MekEquipmentGroup[];
    readonly shields: MekShieldGroup[];
    readonly ordinaryC3Endpoints: MekOrdinaryC3Endpoint[];
    readonly emergencyC3Endpoints: MekEmergencyC3Endpoint[];
}

const LOCATION_ROLE_BY_CODE: Readonly<Record<string, MekLocationRole>> = Object.freeze({
    HD: 'head', CT: 'center-torso', LT: 'left-torso', RT: 'right-torso',
    LA: 'left-arm', RA: 'right-arm', LL: 'left-leg', RL: 'right-leg', CL: 'center-leg',
    FLL: 'front-left-leg', FRL: 'front-right-leg', RLL: 'rear-left-leg', RRL: 'rear-right-leg',
});

const FORM_LOCATION_CODES = Object.freeze({
    biped: Object.freeze(['HD', 'CT', 'LT', 'RT', 'LA', 'RA', 'LL', 'RL']),
    lam: Object.freeze(['HD', 'CT', 'LT', 'RT', 'LA', 'RA', 'LL', 'RL']),
    tripod: Object.freeze(['HD', 'CT', 'LT', 'RT', 'LA', 'RA', 'LL', 'RL', 'CL']),
    quad: Object.freeze(['HD', 'CT', 'LT', 'RT', 'FLL', 'FRL', 'RLL', 'RRL']),
    quadvee: Object.freeze(['HD', 'CT', 'LT', 'RT', 'FLL', 'FRL', 'RLL', 'RRL']),
} as const);

const LOCATION_PARENT_CODE: Readonly<Record<string, string>> = Object.freeze({
    LA: 'LT', RA: 'RT', FLL: 'LT', FRL: 'RT',
});

const DAMAGE_TRANSFER_CODE: Readonly<Record<string, string>> = Object.freeze({
    HD: 'CT', LT: 'CT', RT: 'CT', LA: 'LT', RA: 'RT', LL: 'LT', RL: 'RT', CL: 'CT',
    FLL: 'LT', FRL: 'RT', RLL: 'LT', RRL: 'RT',
});

const ACTUATOR_SYSTEMS = Object.freeze([
    ['Shoulder', 'shoulder'],
    ['Upper Arm Actuator', 'upper-arm'],
    ['Lower Arm Actuator', 'lower-arm'],
    ['Hand Actuator', 'hand'],
    ['Hip', 'hip'],
    ['Upper Leg Actuator', 'upper-leg'],
    ['Lower Leg Actuator', 'lower-leg'],
    ['Foot Actuator', 'foot'],
] as const satisfies readonly (readonly [string, MekActuatorKind])[]);

const REQUIRED_ARM_ACTUATORS = Object.freeze(['shoulder'] as const);
const REQUIRED_LEG_ACTUATORS = Object.freeze(['hip', 'upper-leg', 'lower-leg', 'foot'] as const);

function mekForm(entity: MekEntity): keyof typeof FORM_LOCATION_CODES {
    switch (entity.chassisConfig) {
        case 'Biped': return 'biped';
        case 'Quad': return 'quad';
        case 'Tripod': return 'tripod';
        case 'LAM': return 'lam';
        case 'QuadVee': return 'quadvee';
    }
}

/** Compile one detached, immutable mechanics topology or explicit blockers. */
export function compileMekMechanicsProfile(
    entity: MekEntity,
    index: MekRuntimeIndex,
    ruleset: CBTRuleset,
): MekMechanicsProfileResult {
    const blockers: MekMechanicsProfileBlocker[] = [];
    const form = mekForm(entity);
    const engineType = entity.mountedEngine().type();
    const cockpitType = entity.cockpitType();
    const gyroType = entity.gyroType();
    const baseWalkMp = entity.computeWalkMP({
        ...STANDARD_MOVEMENT_CALCULATION,
        ignoreModularArmor: true,
        ignoreShield: true,
    });
    const baseRunMp = entity.computeRunMP({
        ...RUN_WITHOUT_MASC_CALCULATION,
        ignoreModularArmor: true,
        ignoreShield: true,
    });
    const baseJumpMp = entity.computeJumpMP({
        ...STANDARD_MOVEMENT_CALCULATION,
        ignoreModularArmor: true,
        ignoreShield: true,
    });
    validateBaseMovement(baseWalkMp, baseJumpMp, entity.motiveType(), blockers);

    const locations = compileLocations(index, form, blockers);
    const indexes = compileIndexes(index, locations);

    const engineDescriptor = ENGINE_DATA[engineType];
    if (!engineDescriptor) blockers.push(profileBlocker(
        'UNSUPPORTED_ENGINE_VARIANT', engineType, [], [],
        `Engine variant ${engineType} has no immutable mechanics classification`,
    ));
    const cockpitDescriptor = COCKPIT_DATA[cockpitType];
    if (!cockpitDescriptor) blockers.push(profileBlocker(
        'UNSUPPORTED_COCKPIT_VARIANT', cockpitType, [], [],
        `Cockpit variant ${cockpitType} has no immutable mechanics classification`,
    ));
    const gyroDescriptor = GYRO_DATA[gyroType];
    if (!gyroDescriptor) blockers.push(profileBlocker(
        'UNSUPPORTED_GYRO_VARIANT', gyroType, [], [],
        `Gyro variant ${gyroType} has no immutable mechanics classification`,
    ));

    const engineTopology = compileSingletonSystem(
        index, indexes, 'Engine', engineType !== 'None', blockers,
    );
    const cockpitTopology = compileSingletonSystem(index, indexes, 'Cockpit', true, blockers);
    const gyroTopology = compileSingletonSystem(index, indexes, 'Gyro', gyroType !== 'None', blockers);
    const sensorTopology = compileSingletonSystem(index, indexes, 'Sensors', true, blockers);
    const limbs = compileLimbs(index, indexes, locations, blockers);
    const features = compileFeatures(index, indexes, blockers);

    if (baseJumpMp > 0 && features.jumpJets.length === 0) blockers.push(profileBlocker(
        'JUMP_MP_WITHOUT_JUMP_JET', String(baseJumpMp), [], [],
        'Base jump MP has no exact jump-jet component topology',
    ));
    if (baseJumpMp === 0 && features.jumpJets.length > 0) blockers.push(profileBlocker(
        'JUMP_JET_WITHOUT_JUMP_MP', String(features.jumpJets.length),
        features.jumpJets.map(group => group.componentId),
        features.jumpJets.flatMap(group => group.criticalSlotIds),
        'Jump-jet components exist while base jump MP is zero',
    ));

    const cockpitGroups = cockpitTopology.groups;
    let mainCockpit: MekSystemGroup | undefined;
    let commandConsole: MekSystemGroup | undefined;
    if (cockpitGroups.length === 1) {
        const group = cockpitGroups[0]!;
        if (cockpitDescriptor?.hasCommandConsoleBonus) {
            if (group.criticalSlotIds.length !== 2) blockers.push(profileBlocker(
                'AMBIGUOUS_COCKPIT_TOPOLOGY', cockpitType, [group.componentId], group.criticalSlotIds,
                'A command-console cockpit requires exactly two ordered Cockpit critical slots',
            ));
            if (group.criticalSlotIds.length >= 1) mainCockpit = splitSystemGroup(
                index, group, group.criticalSlotIds.slice(0, 1), indexes,
            );
            if (group.criticalSlotIds.length >= 2) commandConsole = splitSystemGroup(
                index, group, group.criticalSlotIds.slice(1), indexes,
            );
        } else {
            mainCockpit = group;
        }
    }

    const armorVariants = compileArmorVariants(locations, index);
    if (blockers.length > 0
        || !engineDescriptor || !cockpitDescriptor || !gyroDescriptor
        || !mainCockpit) return unsupported(blockers);

    const engine: MekEngineMechanics = Object.freeze({
        ...engineTopology,
        type: engineType,
        powerSource: engineDescriptor.powerSource,
        fusionFamily: engineDescriptor.powerSource === 'fusion',
        rating: entity.mountedEngine().rating,
        destructionHitThreshold: 3,
    });
    const cockpit: MekCockpitMechanics = Object.freeze({
        ...cockpitTopology,
        type: cockpitType,
        main: mainCockpit,
        ...(commandConsole ? { commandConsole } : {}),
        torsoMounted: cockpitDescriptor.hasTorsoSlots,
        industrial: cockpitDescriptor.isIndustrial,
        primitive: cockpitDescriptor.isPrimitive,
        canEject: cockpitDescriptor.canEject,
    });
    const gyro: MekGyroMechanics = Object.freeze({
        ...gyroTopology,
        type: gyroType,
        heavyDuty: gyroType === 'Heavy Duty',
        destructionHitThreshold: gyroType === 'None'
            ? 0
            : gyroType === 'Heavy Duty'
                ? ruleset === 'core-2026' ? 4 : 3
                : 2,
    });
    const sensors: MekSensorMechanics = Object.freeze({
        ...sensorTopology,
        weaponFireDisableHitThreshold: cockpitDescriptor.hasTorsoSlots ? 3 : 2,
    });
    const profile: MekMechanicsProfile = Object.freeze({
        schemaVersion: PUBLISHED_MEK_MECHANICS_PROFILE_SCHEMA_VERSION,
        rulesFlavor: ruleset,
        form,
        configuration: form,
        declaredMassTons: entity.tonnage(),
        locations: Object.freeze(locations),
        engine,
        cockpit,
        gyro,
        sensors,
        limbs: Object.freeze(limbs),
        movement: Object.freeze({
            baseWalkMp,
            baseRunMp,
            baseJumpMp,
            baseUmuMp: entity.installedUmuMP(),
            motiveType: entity.motiveType(),
            ...(entity instanceof LamEntity ? { lamType: entity.lamType() } : {}),
        }),
        myomerType: entity.myomerType(),
        jumpJets: Object.freeze(features.jumpJets),
        umus: Object.freeze(features.umus),
        partialWings: Object.freeze(features.partialWings),
        tripleStrengthMyomer: Object.freeze(features.tripleStrengthMyomer),
        masc: Object.freeze(features.masc),
        superchargers: Object.freeze(features.superchargers),
        actuatorEnhancementSystems: Object.freeze(features.actuatorEnhancementSystems),
        droneOperatingSystems: Object.freeze(features.droneOperatingSystems),
        modularArmor: Object.freeze(features.modularArmor),
        spikes: Object.freeze(features.spikes),
        ramPlates: Object.freeze(features.ramPlates),
        physicalWeapons: Object.freeze(features.physicalWeapons),
        shields: Object.freeze(features.shields),
        armorVariants: Object.freeze(armorVariants),
        ordinaryC3Endpoints: Object.freeze(features.ordinaryC3Endpoints),
        emergencyC3Endpoints: Object.freeze(features.emergencyC3Endpoints),
    });
    return Object.freeze({ kind: 'supported', profile });
}

/** Compile bounded scenario options; every unknown or malformed value fails closed. */
export function evaluateMekMechanicsScenarioSupport(
    input: unknown,
): MekMechanicsScenarioSupportResult {
    const blockers: MekMechanicsScenarioBlocker[] = [];
    if (!isPlainRecord(input)) {
        blockers.push(scenarioBlocker('SCENARIO_INPUT_INVALID', '$', 'Scenario input must be a plain record'));
        return unsupportedScenario(blockers);
    }
    for (const key of Object.keys(input).filter(key => key !== 'id' && key !== 'options').sort(compareText)) {
        blockers.push(scenarioBlocker(
            'SCENARIO_INPUT_INVALID', key, `Scenario field ${key} is not part of the bounded mechanics input`,
        ));
    }
    if (typeof input['id'] !== 'string' || input['id'].trim().length === 0 || input['id'].includes('\0')) {
        blockers.push(scenarioBlocker(
            'SCENARIO_ID_INVALID', 'id', 'Mek mechanics require one nonempty detached scenario identifier',
        ));
    }
    let forcedWithdrawal = true;
    let sprinting = false;
    const options = input['options'];
    if (options !== undefined) {
        if (!isPlainRecord(options)) {
            blockers.push(scenarioBlocker(
                'SCENARIO_OPTIONS_UNSUPPORTED', '<invalid-options>',
                'Scenario mechanics options must be a plain record',
            ));
        } else {
            for (const key of Object.keys(options)
                .filter(key => key !== 'forcedWithdrawal' && key !== 'sprinting')
                .sort(compareText)) {
                blockers.push(scenarioBlocker(
                    'SCENARIO_OPTIONS_UNSUPPORTED', key,
                    `Scenario option ${key} has no explicit bounded Mek mechanics semantics`,
                ));
            }
            if (Object.prototype.hasOwnProperty.call(options, 'forcedWithdrawal')) {
                if (typeof options['forcedWithdrawal'] !== 'boolean') blockers.push(scenarioBlocker(
                    'SCENARIO_OPTIONS_UNSUPPORTED', 'forcedWithdrawal',
                    'Scenario option forcedWithdrawal must be an exact boolean',
                ));
                else forcedWithdrawal = options['forcedWithdrawal'];
            }
            if (Object.prototype.hasOwnProperty.call(options, 'sprinting')) {
                if (typeof options['sprinting'] !== 'boolean') blockers.push(scenarioBlocker(
                    'SCENARIO_OPTIONS_UNSUPPORTED', 'sprinting',
                    'Scenario option sprinting must be an exact boolean',
                ));
                else sprinting = options['sprinting'];
            }
        }
    }
    if (blockers.length > 0) return unsupportedScenario(blockers);
    return Object.freeze({
        kind: 'supported',
        rules: Object.freeze({ forcedWithdrawal, sprinting }),
    });
}

function compileLocations(
    index: MekRuntimeIndex,
    form: keyof typeof FORM_LOCATION_CODES,
    blockers: MekMechanicsProfileBlocker[],
): MekLocationMechanics[] {
    const expectedCodes: readonly string[] = FORM_LOCATION_CODES[form];
    const byCode = new Map<string, LocationId[]>();
    for (const location of index.locations.values()) {
        const values = byCode.get(location.code) ?? [];
        values.push(location.id);
        byCode.set(location.code, values);
    }
    for (const [code, ids] of byCode) if (ids.length > 1) blockers.push(profileBlocker(
        'DUPLICATE_LOCATION_ROLE', code, [], [], `Location role ${code} is represented ${ids.length} times`,
    ));
    for (const code of expectedCodes) if (!byCode.has(code)) blockers.push(profileBlocker(
        'MISSING_CANONICAL_LOCATION', code, [], [], `Mek form ${form} requires canonical location ${code}`,
    ));
    for (const code of [...byCode.keys()].sort(compareText)) if (!expectedCodes.includes(code)) blockers.push(profileBlocker(
        'UNEXPECTED_CANONICAL_LOCATION', code, [], [], `Mek form ${form} does not define canonical location ${code}`,
    ));

    return expectedCodes.flatMap(code => {
        const ids = byCode.get(code);
        const role = LOCATION_ROLE_BY_CODE[code];
        if (ids?.length !== 1 || !role) return [];
        const parentCode = LOCATION_PARENT_CODE[code];
        const transferCode = DAMAGE_TRANSFER_CODE[code];
        const parentLocationId = parentCode ? uniqueLocationId(byCode, parentCode) : null;
        const damageTransferLocationId = transferCode ? uniqueLocationId(byCode, transferCode) : null;
        if ((parentCode && !parentLocationId) || (transferCode && !damageTransferLocationId)) blockers.push(profileBlocker(
            'AMBIGUOUS_LOCATION_PARENT', `${code}->${parentCode ?? transferCode}`, [], [],
            `Canonical parent/transfer topology for ${code} cannot be resolved exactly`,
        ));
        const limbKind = role.endsWith('-arm') ? 'arm' : role.endsWith('-leg') ? 'leg' : undefined;
        return [Object.freeze({
            locationId: ids[0]!, code, role, parentLocationId, damageTransferLocationId,
            ...(limbKind ? { limbKind } : {}),
        })];
    });
}

function compileIndexes(
    index: MekRuntimeIndex,
    locations: readonly MekLocationMechanics[],
): CompileIndexes {
    const locationOrder = new Map<LocationId, number>(locations.map((location, index) => [location.locationId, index]));
    const slotLists = new Map<ComponentId, CriticalSlotId[]>();
    const locationLists = new Map<ComponentId, LocationId[]>();
    for (const slot of sortedSlots(index, locationOrder)) {
        for (const componentId of slot.componentIds) {
            const slots = slotLists.get(componentId) ?? [];
            if (!slots.includes(slot.id)) slots.push(slot.id);
            slotLists.set(componentId, slots);
            const ids = locationLists.get(componentId) ?? [];
            if (!ids.includes(slot.locationId)) ids.push(slot.locationId);
            locationLists.set(componentId, ids);
        }
    }
    return Object.freeze({
        locationOrder,
        slotsByComponent: new Map([...slotLists].map(([id, slots]) => [id, Object.freeze(slots)])),
        locationIdsByComponent: new Map([...locationLists].map(([id, locationsForComponent]) => [
            id, Object.freeze(locationsForComponent),
        ])),
    });
}

function compileSingletonSystem(
    index: MekRuntimeIndex,
    indexes: CompileIndexes,
    system: string,
    required: boolean,
    blockers: MekMechanicsProfileBlocker[],
): MekSystemTopology {
    const groups = sortedComponents(index).flatMap(([componentId, component]) => {
        if (component.kind !== 'system' || component.systemType !== system) return [];
        const group = systemGroup(componentId, component.systemType, indexes);
        if (group.criticalSlotIds.length === 0) blockers.push(profileBlocker(
            'SYSTEM_WITHOUT_CRITICALS', system, [componentId], [],
            `Required system ${system} has no exact critical-slot topology`,
        ));
        return [group];
    });
    if (required && groups.length === 0) blockers.push(profileBlocker(
        'MISSING_REQUIRED_SYSTEM', system, [], [], `Mek entity is missing required system ${system}`,
    ));
    if (groups.length > 1) blockers.push(profileBlocker(
        'DUPLICATE_REQUIRED_SYSTEM', system, groups.map(group => group.componentId),
        groups.flatMap(group => group.criticalSlotIds),
        `Required system ${system} is represented by multiple logical components`,
    ));
    return systemTopology(groups);
}

function compileLimbs(
    index: MekRuntimeIndex,
    indexes: CompileIndexes,
    locations: readonly MekLocationMechanics[],
    blockers: MekMechanicsProfileBlocker[],
): MekLimbProfile[] {
    const byLocationAndKind = new Map<string, MekActuatorGroup[]>();
    for (const [system, kind] of ACTUATOR_SYSTEMS) {
        for (const [componentId, component] of sortedComponents(index)) {
            if (component.kind !== 'system' || component.systemType !== system) continue;
            const base = systemGroup(componentId, system, indexes);
            const group: MekActuatorGroup = Object.freeze({ ...base, kind });
            if (group.criticalSlotIds.length === 0) blockers.push(profileBlocker(
                'SYSTEM_WITHOUT_CRITICALS', system, [componentId], [],
                `Actuator ${system} has no exact critical-slot topology`,
            ));
            if (group.locationIds.length !== 1
                || !locations.some(location => location.locationId === group.locationIds[0] && location.limbKind)) {
                blockers.push(profileBlocker(
                    'SYSTEM_LOCATION_AMBIGUOUS', system, [componentId], group.criticalSlotIds,
                    `Actuator ${system} must belong to exactly one canonical limb`,
                ));
                continue;
            }
            const key = `${group.locationIds[0]}\0${kind}`;
            const values = byLocationAndKind.get(key) ?? [];
            values.push(group);
            byLocationAndKind.set(key, values);
        }
    }

    const result: MekLimbProfile[] = [];
    for (const location of locations.filter(item => item.limbKind !== undefined)) {
        const actuators: MekActuatorGroup[] = [];
        for (const [, kind] of ACTUATOR_SYSTEMS) {
            const groups = byLocationAndKind.get(`${location.locationId}\0${kind}`) ?? [];
            if (groups.length > 1) blockers.push(profileBlocker(
                'DUPLICATE_ACTUATOR', `${location.code}:${kind}`, groups.map(group => group.componentId),
                groups.flatMap(group => group.criticalSlotIds),
                `Limb ${location.code} has multiple ${kind} actuator components`,
            ));
            actuators.push(...groups);
        }
        const required: readonly MekActuatorKind[] = location.limbKind === 'arm'
            ? REQUIRED_ARM_ACTUATORS : REQUIRED_LEG_ACTUATORS;
        for (const kind of required) if (!actuators.some(actuator => actuator.kind === kind)) blockers.push(profileBlocker(
            'MISSING_REQUIRED_ACTUATOR', `${location.code}:${kind}`, [], [],
            `Limb ${location.code} is missing required ${kind} actuator topology`,
        ));
        result.push(Object.freeze({
            locationId: location.locationId,
            role: location.role,
            kind: location.limbKind!,
            parentLocationId: location.parentLocationId,
            actuators: Object.freeze(actuators),
        }));
    }
    return result;
}

function compileFeatures(
    index: MekRuntimeIndex,
    indexes: CompileIndexes,
    blockers: MekMechanicsProfileBlocker[],
): CompiledFeatures {
    const result: CompiledFeatures = {
        jumpJets: [], umus: [], partialWings: [], tripleStrengthMyomer: [], masc: [], superchargers: [],
        actuatorEnhancementSystems: [], droneOperatingSystems: [], modularArmor: [],
        spikes: [], ramPlates: [], physicalWeapons: [], shields: [],
        ordinaryC3Endpoints: [], emergencyC3Endpoints: [],
    };
    for (const [componentId, component] of sortedComponents(index)) {
        if (component.kind !== 'equipment' || !component.mount.equipment) continue;
        const equipment = component.mount.equipment;
        const flags = equipment.flags;
        const base = equipmentGroup(componentId, component, indexes);
        let boundedFeature = false;
        if (isJumpJetEquipment(equipment)) {
            boundedFeature = true;
            const kind = jumpJetKind(equipment);
            if (kind === null) blockers.push(profileBlocker(
                'AMBIGUOUS_EQUIPMENT_ROLE', `${equipment.id}:jump-jet`, [componentId], base.criticalSlotIds,
                `Jump jet ${equipment.id} has contradictory subtype flags`,
            ));
            else result.jumpJets.push(Object.freeze({ ...base, kind }));
        }
        if (isUmuEquipment(equipment)) {
            boundedFeature = true;
            result.umus.push(base);
        }
        if (isPartialWingEquipment(equipment)) {
            boundedFeature = true;
            result.partialWings.push(base);
        }
        const tsmKind = tripleStrengthMyomerKind(equipment);
        if (tsmKind !== undefined) {
            boundedFeature = true;
            if (tsmKind === null) blockers.push(profileBlocker(
                'AMBIGUOUS_EQUIPMENT_ROLE', `${equipment.id}:tsm`, [componentId], base.criticalSlotIds,
                `Myomer ${equipment.id} has contradictory TSM classifications`,
            ));
            else result.tripleStrengthMyomer.push(Object.freeze({ ...base, kind: tsmKind }));
        }
        if (isMascEquipment(equipment)) {
            boundedFeature = true;
            if (isSuperchargerEquipment(equipment)) result.superchargers.push(base);
            else result.masc.push(base);
        }
        if (isActuatorEnhancementSystem(equipment)) {
            boundedFeature = true;
            result.actuatorEnhancementSystems.push(base);
        }
        if (isDroneOperatingSystemEquipment(equipment)) {
            boundedFeature = true;
            result.droneOperatingSystems.push(base);
        }
        if (isModularArmorEquipment(equipment)) {
            boundedFeature = true;
            result.modularArmor.push(base);
        }
        if (isSpikesEquipment(equipment)) {
            boundedFeature = true;
            result.spikes.push(base);
        }
        if (isRamPlateEquipment(equipment)) {
            boundedFeature = true;
            result.ramPlates.push(base);
        }
        if (isPhysicalWeaponEquipment(equipment)) {
            boundedFeature = true;
            result.physicalWeapons.push(base);
        }
        if (isShieldEquipment(equipment)) {
            boundedFeature = true;
            const profile = resolveShieldProfile(equipment);
            const size = resolveShieldSize(equipment);
            if (!profile || size === undefined) blockers.push(profileBlocker(
                'AMBIGUOUS_EQUIPMENT_ROLE', `${equipment.id}:shield`, [componentId], base.criticalSlotIds,
                `Shield ${equipment.id} does not select exactly one supported size`,
            ));
            else result.shields.push(Object.freeze({ ...base, ...profile, size }));
        }
        const c3 = c3EquipmentTraits(flags);
        if (c3.networkTypes.length > 0) {
            boundedFeature = true;
            compileC3Endpoint(base, c3, result, blockers);
        }
        if (boundedFeature && base.criticalSlotIds.length === 0) blockers.push(profileBlocker(
            'FEATURE_WITHOUT_CRITICALS', equipment.id, [componentId], [],
            `Mechanics feature ${equipment.id} has no exact critical-slot topology`,
        ));
        if (isJumpJetEquipment(equipment) && isUmuEquipment(equipment)) blockers.push(profileBlocker(
            'AMBIGUOUS_EQUIPMENT_ROLE', `${equipment.id}:jump/umu`, [componentId], base.criticalSlotIds,
            `Component ${equipment.id} cannot be both a jump jet and UMU`,
        ));
    }
    return result;
}

function compileC3Endpoint(
    base: MekEquipmentGroup,
    traits: C3EquipmentTraits,
    result: CompiledFeatures,
    blockers: MekMechanicsProfileBlocker[],
): void {
    const networkTypes: readonly C3NetworkType[] = traits.networkTypes;
    if (networkTypes.length !== 1) {
        blockers.push(profileBlocker(
            'AMBIGUOUS_C3_ENDPOINT', `${base.equipmentId}:network`, [base.componentId], base.criticalSlotIds,
            `C3 endpoint ${base.equipmentId} does not select exactly one network family`,
        ));
        return;
    }
    if (traits.emergencyMaster) {
        if (traits.contradictoryEmergencyRole) blockers.push(profileBlocker(
            'AMBIGUOUS_C3_ENDPOINT', `${base.equipmentId}:emergency`, [base.componentId], base.criticalSlotIds,
            `Emergency C3 endpoint ${base.equipmentId} has contradictory ordinary roles`,
        ));
        else result.emergencyC3Endpoints.push(Object.freeze({
            ...base, kind: 'emergency-master', networkType: 'c3',
            standbyRole: 'slave', activatedRole: 'master', boosted: false,
        }));
        return;
    }
    const networkType = networkTypes[0]!;
    const roles: readonly C3Role[] = traits.ordinaryRoles;
    if (roles.length !== 1) {
        blockers.push(profileBlocker(
            'AMBIGUOUS_C3_ENDPOINT', `${base.equipmentId}:role`, [base.componentId], base.criticalSlotIds,
            `C3 endpoint ${base.equipmentId} does not select exactly one ordinary role`,
        ));
        return;
    }
    result.ordinaryC3Endpoints.push(Object.freeze({
        ...base, kind: 'ordinary', networkType, role: roles[0]!,
        boosted: traits.boosted,
    }));
}

function compileArmorVariants(
    locations: readonly MekLocationMechanics[],
    index: MekRuntimeIndex,
): MekArmorVariant[] {
    const variants = new Map<string, {
        equipmentId: string;
        type: string;
        hardened: boolean;
        locationIds: LocationId[];
    }>();
    for (const location of locations) {
        const indexedLocation = index.locations.get(location.locationId);
        if (!indexedLocation) continue;
        const equipment = indexedLocation.armor.armor;
        const key = `${equipment.id}\0${equipment.armorType}`;
        const variant = variants.get(key) ?? {
            equipmentId: equipment.id,
            type: equipment.armorType,
            hardened: isHardenedArmor(equipment)
                || equipment.armorType.toUpperCase().includes('HARDENED'),
            locationIds: [],
        };
        variant.locationIds.push(location.locationId);
        variants.set(key, variant);
    }
    return [...variants.values()].sort((left, right) => compareText(left.equipmentId, right.equipmentId)
        || compareText(left.type, right.type)).map(variant => Object.freeze({
        equipmentId: variant.equipmentId,
        type: variant.type,
        hardened: variant.hardened,
        locationIds: Object.freeze(variant.locationIds),
    }));
}

function validateBaseMovement(
    walkMp: number,
    jumpMp: number,
    motiveType: string,
    blockers: MekMechanicsProfileBlocker[],
): void {
    for (const [feature, value] of [
        ['walkMp', walkMp], ['jumpMp', jumpMp],
    ] as const) if (!Number.isSafeInteger(value) || value < 0) blockers.push(profileBlocker(
        'INVALID_BASE_MOVEMENT', `${feature}:${String(value)}`, [], [],
        `Mek entity ${feature} must be a non-negative safe integer`,
    ));
    if (!motiveType.trim()) blockers.push(profileBlocker(
        'INVALID_BASE_MOVEMENT', 'motiveType', [], [], 'Mek entity motive type cannot be empty',
    ));
}

function systemGroup(
    componentId: ComponentId,
    system: string,
    indexes: CompileIndexes,
): MekSystemGroup {
    return Object.freeze({
        componentId,
        system,
        criticalSlotIds: indexes.slotsByComponent.get(componentId) ?? Object.freeze([]),
        locationIds: indexes.locationIdsByComponent.get(componentId) ?? Object.freeze([]),
    });
}

function equipmentGroup(
    componentId: ComponentId,
    component: MekIndexedComponent,
    indexes: CompileIndexes,
): MekEquipmentGroup {
    return Object.freeze({
        componentId,
        equipmentId: component.kind === 'equipment'
            ? component.mount.equipment?.id ?? component.mount.equipmentId
            : component.systemType,
        criticalSlotIds: indexes.slotsByComponent.get(componentId) ?? Object.freeze([]),
        locationIds: indexes.locationIdsByComponent.get(componentId) ?? Object.freeze([]),
    });
}

function systemTopology(groups: readonly MekSystemGroup[]): MekSystemTopology {
    return Object.freeze({
        groups: Object.freeze([...groups]),
        componentIds: Object.freeze(groups.map(group => group.componentId)),
        criticalSlotIds: freezeUnique(groups.flatMap(group => group.criticalSlotIds)),
    });
}

function splitSystemGroup(
    index: MekRuntimeIndex,
    group: MekSystemGroup,
    criticalSlotIds: readonly CriticalSlotId[],
    indexes: CompileIndexes,
): MekSystemGroup {
    const locationIds = freezeUnique(criticalSlotIds.flatMap(slotId => {
        const slot = index.slots.get(slotId);
        return slot ? [slot.locationId] : [];
    }).sort((left, right) => (indexes.locationOrder.get(left) ?? Number.MAX_SAFE_INTEGER)
        - (indexes.locationOrder.get(right) ?? Number.MAX_SAFE_INTEGER) || compareText(left, right)));
    return Object.freeze({
        componentId: group.componentId,
        system: group.system,
        criticalSlotIds: Object.freeze([...criticalSlotIds]),
        locationIds,
    });
}

function sortedComponents(
    index: MekRuntimeIndex,
): readonly (readonly [ComponentId, MekIndexedComponent])[] {
    return [...index.components].sort(([left], [right]) => compareText(left, right));
}

function sortedSlots(index: MekRuntimeIndex, locationOrder: ReadonlyMap<LocationId, number>) {
    return [...index.slots.values()].sort((left, right) =>
        (locationOrder.get(left.locationId) ?? Number.MAX_SAFE_INTEGER)
        - (locationOrder.get(right.locationId) ?? Number.MAX_SAFE_INTEGER)
        || left.slotIndex - right.slotIndex
        || compareText(left.id, right.id));
}

function uniqueLocationId(values: ReadonlyMap<string, readonly LocationId[]>, code: string): LocationId | null {
    const matches = values.get(code);
    return matches?.length === 1 ? matches[0]! : null;
}

function freezeUnique<T extends string>(values: readonly T[]): readonly T[] {
    return Object.freeze([...new Set(values)]);
}

function profileBlocker(
    code: MekMechanicsProfileBlockerCode,
    feature: string,
    componentIds: readonly ComponentId[],
    criticalSlotIds: readonly CriticalSlotId[],
    message: string,
): MekMechanicsProfileBlocker {
    return Object.freeze({
        code,
        feature,
        componentIds: Object.freeze([...new Set(componentIds)].sort(compareText)),
        criticalSlotIds: Object.freeze([...new Set(criticalSlotIds)].sort(compareText)),
        message,
    });
}

function unsupported(
    blockers: readonly MekMechanicsProfileBlocker[],
): MekMechanicsProfileResult {
    return Object.freeze({
        kind: 'unsupported',
        blockers: Object.freeze([...blockers].sort(compareProfileBlockers)),
    });
}

function scenarioBlocker(
    code: MekMechanicsScenarioBlockerCode,
    feature: string,
    message: string,
): MekMechanicsScenarioBlocker {
    return Object.freeze({ code, feature, message });
}

function unsupportedScenario(
    blockers: readonly MekMechanicsScenarioBlocker[],
): MekMechanicsScenarioSupportResult {
    return Object.freeze({
        kind: 'unsupported',
        blockers: Object.freeze([...blockers].sort((left, right) =>
            compareText(left.code, right.code) || compareText(left.feature, right.feature))),
    });
}

function compareProfileBlockers(
    left: MekMechanicsProfileBlocker,
    right: MekMechanicsProfileBlocker,
): number {
    return compareText(left.code, right.code)
        || compareText(left.feature, right.feature)
        || compareText(left.componentIds.join('\0'), right.componentIds.join('\0'));
}
