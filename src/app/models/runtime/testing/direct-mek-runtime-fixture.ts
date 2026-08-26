// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import { AmmoEquipment, MiscEquipment, StructureEquipment, WeaponEquipment } from '../../equipment.model';
import { weaponEnhancementFlag } from '../../weapon-enhancement.model';
import type { EquipmentRegistry } from '../../equipment-lookup';
import { createTestEquipmentRegistry } from '../../entity/testing/test-equipment-registry';
import { parseMtf } from '../../entity/parsers/mtf-parser';
import { ParseContext } from '../../entity/parsers/parse-context';
import type { MekEntity } from '../../entity/entities/mek/mek-entity';
import type { GyroType } from '../../entity/components/gyro-data';
import type { CockpitType } from '../../entity/types/cockpit';
import type { SavedEntityIdentity } from '../../persisted-unit-state';
import {
    asSourceHash,
    asUnitProviderId,
    asUnitUuid,
} from '../../../services/unit-catalog/unit-catalog.types';
import { CORE_2026_RULESET, type CBTRuleset } from '../../cbt-ruleset.model';
import { asUnitInstanceId } from '../runtime-state';
import {
    buildMekRuntimeIndex,
    type MekRuntimeIndex,
    type MekIndexedEquipment,
} from '../mek-runtime-index';
import { createMekHeatContextV2, mekHeatCapabilityV2 } from '../mek-heat-state-v2';
import {
    createMekMechanicsContextV2,
    mekMechanicsContextCapabilityV2,
} from '../mek-mechanics-context-v2';
import { initializeUnitState, type InitializedUnitState } from '../unit-state-initializer';
import { CBTUnitInstance } from '../unit-instance';

const UUID = asUnitUuid('019f6767-0dcb-7bb8-992f-aef08202f5e1');

export interface DirectMekRuntimeFixture {
    readonly entity: MekEntity;
    readonly index: MekRuntimeIndex;
    readonly equipment: EquipmentRegistry;
    readonly identity: SavedEntityIdentity;
    readonly initialized: InitializedUnitState;
    readonly instance: CBTUnitInstance;
    equipmentComponent(equipmentId: string): MekIndexedEquipment;
    createInstance(instanceId: string): CBTUnitInstance;
}

/** One parsed MekEntity plus a separately owned pristine sparse runtime. */
export function createDirectMekRuntimeFixture(
    ruleset: CBTRuleset = CORE_2026_RULESET,
    instanceId = 'unit:direct-fixture',
    gyroType: GyroType = 'Standard',
): DirectMekRuntimeFixture {
    return createFixture(ruleset, instanceId, { gyroType });
}

/** Parsed Mek whose scenario explicitly disables forced withdrawal. */
export function createDirectNoForcedWithdrawalRuntimeFixture(
    ruleset: CBTRuleset = CORE_2026_RULESET,
    instanceId = 'unit:direct-no-forced-withdrawal-fixture',
): DirectMekRuntimeFixture {
    return createFixture(ruleset, instanceId, { forcedWithdrawal: false });
}

/** Parsed 55-ton partial-wing Mek used by direct jump-heat rules. */
export function createDirectPartialWingRuntimeFixture(
    ruleset: CBTRuleset = CORE_2026_RULESET,
    instanceId = 'unit:direct-partial-wing-fixture',
): DirectMekRuntimeFixture {
    return createFixture(ruleset, instanceId, { includePartialWing: true });
}

/** Parsed Mek with an ordinary configured C3 Master and a standby C3EM. */
export function createDirectC3MasterRuntimeFixture(
    ruleset: CBTRuleset = CORE_2026_RULESET,
    instanceId = 'unit:direct-c3-master-fixture',
): DirectMekRuntimeFixture {
    return createFixture(ruleset, instanceId, { includeC3Master: true });
}

/** Parsed active-probe Mek used by the direct binary-mode handler. */
export function createDirectBapRuntimeFixture(
    ruleset: CBTRuleset = CORE_2026_RULESET,
    instanceId = 'unit:direct-bap-fixture',
): DirectMekRuntimeFixture {
    return createFixture(ruleset, instanceId, { includeBap: true });
}

/** Parsed Bombast-equipped MekEntity plus a pristine sparse runtime. */
export function createDirectBombastRuntimeFixture(
    ruleset: CBTRuleset = CORE_2026_RULESET,
    instanceId = 'unit:direct-bombast-fixture',
): DirectMekRuntimeFixture {
    return createFixture(ruleset, instanceId, { includeBombast: true });
}

/** Parsed Flamer-equipped MekEntity used by the direct Total Warfare mode rules. */
export function createDirectFlamerRuntimeFixture(
    ruleset: CBTRuleset = CORE_2026_RULESET,
    instanceId = 'unit:direct-flamer-fixture',
): DirectMekRuntimeFixture {
    return createFixture(ruleset, instanceId, { includeFlamer: true });
}

/** Parsed RISC Laser Pulse Module-to-laser link plus a pristine sparse runtime. */
export function createDirectRiscLaserPulseRuntimeFixture(
    ruleset: CBTRuleset = CORE_2026_RULESET,
    instanceId = 'unit:direct-risc-laser-pulse-fixture',
): DirectMekRuntimeFixture {
    return createFixture(ruleset, instanceId, { includeRiscLaserPulse: true });
}

/** Parsed Laser Insulator-to-laser link plus a pristine sparse runtime. */
export function createDirectLaserInsulatorRuntimeFixture(
    ruleset: CBTRuleset = CORE_2026_RULESET,
    instanceId = 'unit:direct-laser-insulator-fixture',
): DirectMekRuntimeFixture {
    return createFixture(ruleset, instanceId, { includeLaserInsulator: true });
}

/** Parsed Apollo-to-MRM link plus a pristine sparse runtime. */
export function createDirectApolloRuntimeFixture(
    ruleset: CBTRuleset = CORE_2026_RULESET,
    instanceId = 'unit:direct-apollo-fixture',
): DirectMekRuntimeFixture {
    return createFixture(ruleset, instanceId, { includeApollo: true });
}

/** Parsed targeting-computer-equipped MekEntity plus a pristine sparse runtime. */
export function createDirectTargetingComputerRuntimeFixture(
    ruleset: CBTRuleset = CORE_2026_RULESET,
    instanceId = 'unit:direct-targeting-computer-fixture',
): DirectMekRuntimeFixture {
    return createFixture(ruleset, instanceId, { includeTargetingComputer: true });
}

/** Parsed arm-AES MekEntity plus a pristine sparse runtime. */
export function createDirectAesRuntimeFixture(
    ruleset: CBTRuleset = CORE_2026_RULESET,
    instanceId = 'unit:direct-aes-fixture',
): DirectMekRuntimeFixture {
    return createFixture(ruleset, instanceId, { includeAes: true });
}

/** Parsed Mek with a complete two-arm AES installation. */
export function createDirectPairedAesRuntimeFixture(
    ruleset: CBTRuleset = CORE_2026_RULESET,
    instanceId = 'unit:direct-paired-aes-fixture',
): DirectMekRuntimeFixture {
    return createFixture(ruleset, instanceId, { includePairedArmAes: true });
}

/** Parsed Mek with every production escalating-failure equipment family. */
export function createDirectEscalatingFailureRuntimeFixture(
    ruleset: CBTRuleset = CORE_2026_RULESET,
    instanceId = 'unit:direct-escalating-failure-fixture',
): DirectMekRuntimeFixture {
    return createFixture(ruleset, instanceId, { includeEscalatingFailureEquipment: true });
}

/** Parsed Mek carrying the production immediate-explosion equipment families. */
export interface DirectExplosionRuntimeFixtureOptions {
    readonly structure?: 'Standard' | 'Composite';
    readonly protection?: 'case' | 'case-ii' | 'both';
}

export function createDirectExplosionRuntimeFixture(
    ruleset: CBTRuleset = CORE_2026_RULESET,
    options: DirectExplosionRuntimeFixtureOptions = {},
    instanceId = 'unit:direct-explosion-fixture',
): DirectMekRuntimeFixture {
    return createFixture(ruleset, instanceId, {
        includeExplosionEquipment: true,
        structure: options.structure,
        explosionProtection: options.protection,
    });
}

/** Parsed shield/Jump Jet/UMU/TSM Mek used by the direct Core/TW shield rules. */
export function createDirectShieldRuntimeFixture(
    ruleset: CBTRuleset = CORE_2026_RULESET,
    size: 'small' | 'medium' | 'large' = 'medium',
    instanceId = `unit:direct-${size}-shield-fixture`,
): DirectMekRuntimeFixture {
    return createFixture(ruleset, instanceId, { shieldSize: size });
}

/** Parsed leg-AES MekEntity plus a pristine sparse runtime. */
export function createDirectLegAesRuntimeFixture(
    ruleset: CBTRuleset = CORE_2026_RULESET,
    instanceId = 'unit:direct-leg-aes-fixture',
): DirectMekRuntimeFixture {
    return createFixture(ruleset, instanceId, { includeLegAes: true });
}

/** Parsed Mek with a complete two-leg AES installation. */
export function createDirectCompleteLegAesRuntimeFixture(
    ruleset: CBTRuleset = CORE_2026_RULESET,
    instanceId = 'unit:direct-complete-leg-aes-fixture',
): DirectMekRuntimeFixture {
    return createFixture(ruleset, instanceId, { includeCompleteLegAes: true });
}

/** Parsed 45-ton Ram Plate/Spikes Mek used by the direct Core/TW charge rules. */
export function createDirectChargeRuntimeFixture(
    ruleset: CBTRuleset = CORE_2026_RULESET,
    instanceId = 'unit:direct-charge-fixture',
): DirectMekRuntimeFixture {
    return createFixture(ruleset, instanceId, { includeChargeEquipment: true });
}

/** Parsed 55-ton Claw/TSM Mek used by direct actuator-sensitive damage rules. */
export function createDirectClawRuntimeFixture(
    ruleset: CBTRuleset = CORE_2026_RULESET,
    instanceId = 'unit:direct-claw-fixture',
): DirectMekRuntimeFixture {
    return createFixture(ruleset, instanceId, { includeClaw: true });
}

/** Parsed 100-ton small-Vibroblade/TSM Mek used by direct mode-sensitive damage rules. */
export function createDirectVibrobladeRuntimeFixture(
    ruleset: CBTRuleset = CORE_2026_RULESET,
    instanceId = 'unit:direct-vibroblade-fixture',
): DirectMekRuntimeFixture {
    return createFixture(ruleset, instanceId, { includeVibroblade: true });
}

/** Parsed Mek with independent MASC and Supercharger components. */
export function createDirectBoosterRuntimeFixture(
    ruleset: CBTRuleset = CORE_2026_RULESET,
    instanceId = 'unit:direct-booster-fixture',
): DirectMekRuntimeFixture {
    return createFixture(ruleset, instanceId, { includeSupercharger: true });
}

/** Parsed Mek with one airborne-only MASC-family Jet Booster. */
export function createDirectJetBoosterRuntimeFixture(
    ruleset: CBTRuleset = CORE_2026_RULESET,
    instanceId = 'unit:direct-jet-booster-fixture',
): DirectMekRuntimeFixture {
    return createFixture(ruleset, instanceId, { includeJetBooster: true });
}

/** Parsed tripod MekEntity plus a pristine sparse runtime. */
export function createDirectTripodRuntimeFixture(
    ruleset: CBTRuleset = CORE_2026_RULESET,
    instanceId = 'unit:direct-tripod-fixture',
): DirectMekRuntimeFixture {
    return createFixture(ruleset, instanceId, { configuration: 'tripod' });
}

/** Parsed Quad MekEntity plus a pristine sparse runtime. */
export function createDirectQuadRuntimeFixture(
    ruleset: CBTRuleset = CORE_2026_RULESET,
    instanceId = 'unit:direct-quad-fixture',
): DirectMekRuntimeFixture {
    return createFixture(ruleset, instanceId, { configuration: 'quad' });
}

/** Parsed superheavy MekEntity plus a pristine sparse runtime. */
export function createDirectSuperheavyRuntimeFixture(
    ruleset: CBTRuleset = CORE_2026_RULESET,
    instanceId = 'unit:direct-superheavy-fixture',
): DirectMekRuntimeFixture {
    return createFixture(ruleset, instanceId, { configuration: 'superheavy' });
}

/** Parsed torso-mounted-cockpit MekEntity plus a pristine sparse runtime. */
export function createDirectTorsoCockpitRuntimeFixture(
    ruleset: CBTRuleset = CORE_2026_RULESET,
    instanceId = 'unit:direct-torso-cockpit-fixture',
): DirectMekRuntimeFixture {
    return createFixture(ruleset, instanceId, { cockpitType: 'Torso-Mounted' });
}

/** Parsed command-console Mek used by direct dual-crew rules. */
export function createDirectCommandConsoleRuntimeFixture(
    ruleset: CBTRuleset = CORE_2026_RULESET,
    instanceId = 'unit:direct-command-console-fixture',
): DirectMekRuntimeFixture {
    return createFixture(ruleset, instanceId, { cockpitType: 'Command Console' });
}

/** Parsed small-cockpit drone Mek used by direct crew and PSR rules. */
export function createDirectDroneRuntimeFixture(
    ruleset: CBTRuleset = CORE_2026_RULESET,
    instanceId = 'unit:direct-drone-fixture',
): DirectMekRuntimeFixture {
    return createFixture(ruleset, instanceId, {
        cockpitType: 'Small',
        includeDroneOperatingSystem: true,
    });
}

/** Parsed two-panel Modular Armor Mek used by direct damage and movement rules. */
export function createDirectModularArmorRuntimeFixture(
    ruleset: CBTRuleset = CORE_2026_RULESET,
    instanceId = 'unit:direct-modular-armor-fixture',
): DirectMekRuntimeFixture {
    return createFixture(ruleset, instanceId, { includeModularArmor: true });
}

/** Parsed VSP Laser and targeting-computer Mek used by range-profile rules. */
export function createDirectVspRuntimeFixture(
    ruleset: CBTRuleset = CORE_2026_RULESET,
    instanceId = 'unit:direct-vsp-fixture',
): DirectMekRuntimeFixture {
    return createFixture(ruleset, instanceId, {
        includeTargetingComputer: true,
        includeVspLaser: true,
    });
}

interface DirectFixtureOptions {
    readonly forcedWithdrawal?: boolean;
    readonly includePartialWing?: boolean;
    readonly includeBombast?: boolean;
    readonly includeFlamer?: boolean;
    readonly includeRiscLaserPulse?: boolean;
    readonly includeLaserInsulator?: boolean;
    readonly includeApollo?: boolean;
    readonly includeTargetingComputer?: boolean;
    readonly includeAes?: boolean;
    readonly includePairedArmAes?: boolean;
    readonly includeLegAes?: boolean;
    readonly includeCompleteLegAes?: boolean;
    readonly includeChargeEquipment?: boolean;
    readonly includeClaw?: boolean;
    readonly includeVibroblade?: boolean;
    readonly includeSupercharger?: boolean;
    readonly includeJetBooster?: boolean;
    readonly includeEscalatingFailureEquipment?: boolean;
    readonly includeExplosionEquipment?: boolean;
    readonly structure?: 'Standard' | 'Composite';
    readonly explosionProtection?: 'case' | 'case-ii' | 'both';
    readonly includeC3Master?: boolean;
    readonly includeBap?: boolean;
    readonly includeDroneOperatingSystem?: boolean;
    readonly includeModularArmor?: boolean;
    readonly includeVspLaser?: boolean;
    readonly gyroType?: GyroType;
    readonly cockpitType?: CockpitType;
    readonly configuration?: 'biped' | 'quad' | 'tripod' | 'superheavy';
    readonly shieldSize?: 'small' | 'medium' | 'large';
}

function createFixture(
    ruleset: CBTRuleset,
    instanceId: string,
    options: DirectFixtureOptions,
): DirectMekRuntimeFixture {
    const registry = directMekEquipmentRegistry();
    const entity = parseMtf(
        directMekMtf(options),
        new ParseContext('direct-runtime.mtf', registry),
    );
    entity.reconcileEquipmentRelationships();
    const index = buildMekRuntimeIndex(entity);
    const identity: SavedEntityIdentity = Object.freeze({
        origin: 'megamek',
        provider: asUnitProviderId('mm-data'),
        uuid: UUID,
        sourceHashAtSave: asSourceHash('A'.repeat(27)),
        sourceFormat: 'mtf',
    });
    const initialized = initializeUnitState(entity, identity, {
        initializerRevision: 1,
        profileId: 'pristine',
        deployment: { id: 'default' },
        scenario: {
            id: 'megamek',
            ruleset,
            ...(options.forcedWithdrawal === undefined
                ? {}
                : { options: { forcedWithdrawal: options.forcedWithdrawal } }),
        },
    });
    const createInstance = (id: string): CBTUnitInstance => {
        const heat = createMekHeatContextV2(entity, index, ruleset, { id: 'megamek' });
        const mechanics = createMekMechanicsContextV2(
            entity,
            index,
            ruleset,
            {
                id: 'megamek',
                ...(options.forcedWithdrawal === undefined
                    ? {}
                    : { options: { forcedWithdrawal: options.forcedWithdrawal } }),
            },
        );
        if (heat.kind !== 'supported' || mechanics.kind !== 'supported') {
            throw new Error(`Direct Mek fixture must support heat and mechanics: ${JSON.stringify({
                heat: mekHeatCapabilityV2(heat, entity),
                mechanics: mekMechanicsContextCapabilityV2(mechanics),
            })}`);
        }
        return new CBTUnitInstance(
            asUnitInstanceId(id),
            initialized.baselineRef,
            entity,
            ruleset,
            initialized.state,
            initialized.deployment.crewAssignment,
            heat,
            mechanics,
        );
    };
    const instance = createInstance(instanceId);
    const equipmentComponent = (equipmentId: string): MekIndexedEquipment => {
        const component = [...index.components.values()].find(candidate =>
            candidate.kind === 'equipment' && candidate.mount.equipmentId === equipmentId);
        if (!component || component.kind !== 'equipment') {
            throw new Error(`Missing direct fixture component ${equipmentId}`);
        }
        return component;
    };
    return Object.freeze({
        entity,
        index,
        equipment: registry,
        identity,
        initialized,
        instance,
        equipmentComponent,
        createInstance,
    });
}

function directMekEquipmentRegistry() {
    const compositeStructure = new StructureEquipment({
        id: 'IS Composite', name: 'Composite', type: 'structure',
        flags: ['F_COMPOSITE'], tech: { base: 'IS' }, structure: { typeId: 5 },
    });
    const laser = new WeaponEquipment({
        id: 'ISMediumLaser', name: 'Medium Laser', type: 'weapon',
        flags: ['F_ENERGY', 'F_LASER', 'F_DIRECT_FIRE'], stats: { criticalSlots: 1, bv: 46 },
        weapon: { damage: 5, heat: 3, ranges: [3, 6, 9, 12] },
    });
    const riscLaserPulse = new MiscEquipment({
        id: 'Test RISC Laser Pulse Module', name: 'RISC Laser Pulse Module', type: 'misc',
        flags: [weaponEnhancementFlag(), 'F_RISC_LASER_PULSE_MODULE'],
        stats: { criticalSlots: 1, bv: 20, explosive: true },
    });
    const laserInsulator = new MiscEquipment({
        id: 'Test Laser Insulator', name: 'Laser Insulator', type: 'misc',
        flags: [weaponEnhancementFlag(), 'F_LASER_INSULATOR'],
        stats: { criticalSlots: 1, bv: 20 },
    });
    const mrm = new WeaponEquipment({
        id: 'Test MRM', name: 'Test MRM', type: 'weapon',
        flags: ['F_MRM', 'F_MISSILE'], stats: { criticalSlots: 1, bv: 56 },
        weapon: { ammoType: 'MRM', rackSize: 10, damage: 1, heat: 4, ranges: [3, 8, 15, 16] },
    });
    const apollo = new MiscEquipment({
        id: 'Test Apollo', name: 'Apollo Fire Control System', type: 'misc',
        flags: [weaponEnhancementFlag(), 'F_APOLLO'], stats: { criticalSlots: 1, bv: 20 },
    });
    const ac = new WeaponEquipment({
        id: 'Test AC', name: 'Test AC', type: 'weapon',
        flags: ['F_AC', 'F_DIRECT_FIRE'], modes: ['Single', 'Rapid'],
        stats: { criticalSlots: 1, bv: 70 },
        weapon: { ammoType: 'AC_ULTRA', damage: 5, heat: 1, ranges: [6, 12, 18, 24] },
    });
    const flamer = new WeaponEquipment({
        id: 'Test Flamer', name: 'Test Flamer', type: 'weapon',
        flags: ['F_FLAMER', 'F_ENERGY'], stats: { criticalSlots: 1, bv: 6 },
        weapon: { damage: 2, heat: 3, ranges: [1, 2, 3, 4] },
    });
    const ammo = new AmmoEquipment({
        id: 'Test Ammo', name: 'Test Ammo', type: 'ammo',
        stats: { bv: 10, explosive: true },
        ammo: { type: 'AC_ULTRA', rackSize: 5, shots: 20, damagePerShot: 1 },
    });
    const mml = new WeaponEquipment({
        id: 'Test MML', name: 'Test MML', type: 'weapon',
        flags: ['F_MISSILE'], stats: { criticalSlots: 1, bv: 50 },
        weapon: { ammoType: 'MML', rackSize: 5, damage: 1, heat: 3, ranges: [3, 6, 9, 12] },
    });
    const atm = new WeaponEquipment({
        id: 'Test ATM', name: 'Test ATM', type: 'weapon',
        flags: ['F_MISSILE'], stats: { criticalSlots: 1, bv: 50 },
        weapon: { ammoType: 'ATM', rackSize: 6, damage: 2, heat: 4, ranges: [5, 10, 15, 20] },
    });
    const atmAmmo = new AmmoEquipment({
        id: 'Test ATM Ammo', name: 'Test ATM Ammo', type: 'ammo',
        stats: { bv: 12 },
        ammo: { type: 'ATM', rackSize: 6, shots: 10, munitionType: ['M_STANDARD'] },
    });
    const ppc = new WeaponEquipment({
        id: 'Test PPC', name: 'Test PPC', type: 'weapon',
        flags: ['F_PPC', 'F_PPC_CAPACITOR_COMPATIBLE', 'F_DIRECT_FIRE', 'F_ENERGY'],
        stats: { criticalSlots: 1, bv: 88 },
        weapon: { damage: 5, heat: 5, ranges: [6, 12, 18, 24] },
    });
    const ppcCapacitor = new MiscEquipment({
        id: 'Test PPC Capacitor', name: 'Test PPC Capacitor', type: 'misc',
        flags: [weaponEnhancementFlag(), 'F_PPC_CAPACITOR'],
        stats: { criticalSlots: 1, bv: 20 },
    });
    const masc = new MiscEquipment({
        id: 'Test MASC', name: 'Test MASC', type: 'misc',
        flags: ['F_MASC'], stats: { criticalSlots: 1, bv: 15 },
    });
    const hag = new WeaponEquipment({
        id: 'Test HAG', name: 'Test HAG', type: 'weapon',
        flags: ['F_HAG', 'F_GAUSS', 'F_BALLISTIC', 'F_DIRECT_FIRE'],
        stats: { criticalSlots: 1, bv: 80, explosive: true },
        weapon: { damage: 'cluster', heat: 4, ranges: [8, 16, 24, 32] },
    });
    const stealth = new MiscEquipment({
        id: 'Test Stealth', name: 'Test Stealth', type: 'misc',
        flags: ['F_STEALTH'], modes: ['On', 'Off'],
        stats: { criticalSlots: 1, bv: 20 },
    });
    const ecm = new MiscEquipment({
        id: 'Test ECM', name: 'Test ECM', type: 'misc',
        flags: ['F_ECM'], stats: { criticalSlots: 1, bv: 20 },
    });
    const angelEcm = new MiscEquipment({
        id: 'Test Angel ECM', name: 'Test Angel ECM', type: 'misc',
        flags: ['F_ECM', 'F_ANGEL_ECM'], stats: { criticalSlots: 1, bv: 30 },
    });
    const artemisLauncher = new WeaponEquipment({
        id: 'Test Artemis Launcher', name: 'Test Artemis Launcher', type: 'weapon',
        flags: ['F_MISSILE', 'F_ARTEMIS_COMPATIBLE'], stats: { criticalSlots: 1, bv: 60 },
        weapon: { ammoType: 'LRM', rackSize: 10, damage: 1, heat: 4, ranges: [7, 14, 21, 28] },
    });
    const artemisV = new MiscEquipment({
        id: 'Test Artemis V', name: 'Test Artemis V', type: 'misc',
        flags: [weaponEnhancementFlag(), 'F_ARTEMIS_V'], stats: { criticalSlots: 1, bv: 20 },
    });
    const artemisAmmo = new AmmoEquipment({
        id: 'Test Artemis Ammo', name: 'Test Artemis Ammo', type: 'ammo',
        stats: { bv: 12 },
        ammo: {
            type: 'LRM',
            rackSize: 10,
            shots: 12,
            munitionType: ['M_ARTEMIS_V_CAPABLE', 'M_SEMIGUIDED'],
        },
    });
    const c3EmergencyMaster = new MiscEquipment({
        id: 'Test C3 Emergency Master', name: 'Test C3 Emergency Master', type: 'misc',
        flags: ['F_C3EM'], stats: { criticalSlots: 1, bv: 35 },
    });
    const c3Master = new MiscEquipment({
        id: 'Test C3 Master', name: 'Test C3 Master', type: 'misc',
        flags: ['F_C3M'], stats: { criticalSlots: 1, bv: 35 },
    });
    const bap = new MiscEquipment({
        id: 'Test BAP', name: 'Test Active Probe', type: 'misc',
        flags: ['F_BAP'], modes: ['On', 'Off'], stats: { criticalSlots: 1, bv: 10 },
    });
    const bombast = new WeaponEquipment({
        id: 'Test Bombast Laser', name: 'Test Bombast Laser', type: 'weapon',
        flags: ['F_BOMBAST_LASER', 'F_ENERGY', 'F_DIRECT_FIRE'],
        stats: { criticalSlots: 1, bv: 120 },
        weapon: { damage: [8, 12, 16], heat: 9, ranges: [5, 10, 15, 20] },
    });
    const heatSink = new MiscEquipment({
        id: 'Heat Sink', name: 'Heat Sink', type: 'misc',
        flags: ['F_HEAT_SINK'], stats: { criticalSlots: 1 },
    });
    const targetingComputer = new MiscEquipment({
        id: 'IS Targeting Computer', name: 'Targeting Computer', type: 'misc',
        flags: ['F_TARGETING_COMPUTER'], stats: { criticalSlots: 1, bv: 20 },
    });
    const droneOperatingSystem = new MiscEquipment({
        id: 'Test Drone Operating System', name: 'Drone Operating System', type: 'misc',
        flags: ['F_DRONE_OPERATING_SYSTEM'], stats: { criticalSlots: 1, bv: 20 },
    });
    const modularArmor = new MiscEquipment({
        id: 'Test Modular Armor', name: 'Modular Armor', type: 'misc',
        flags: ['F_MODULAR_ARMOR'], stats: { criticalSlots: 1, bv: 10 },
    });
    const vspLaser = new WeaponEquipment({
        id: 'Test Medium VSP Laser', name: 'Medium VSP Laser', type: 'weapon',
        flags: ['F_DIRECT_FIRE', 'F_ENERGY', 'F_LASER', 'F_PULSE', 'F_VSP'],
        stats: { criticalSlots: 1, bv: 50, toHitModifier: [-3, -2, -1] },
        weapon: { damage: [9, 7, 5], heat: 7, ranges: [2, 5, 9, 12] },
    });
    const aes = new MiscEquipment({
        id: 'Test AES', name: 'Test AES', type: 'misc',
        flags: ['F_ACTUATOR_ENHANCEMENT_SYSTEM'], stats: { criticalSlots: 1, bv: 20 },
    });
    const radicalHeatSink = new MiscEquipment({
        id: 'Test Radical Heat Sink', name: 'Radical Heat Sink System', type: 'misc',
        flags: ['F_RADICAL_HEATSINK'], stats: { criticalSlots: 1, bv: 10 },
    });
    const blueShield = new MiscEquipment({
        id: 'Test Blue Shield', name: 'Blue Shield Particle Field Damper', type: 'misc',
        flags: ['F_BLUE_SHIELD'], stats: { criticalSlots: 1, bv: 10, explosive: true },
    });
    const emergencyCoolant = new MiscEquipment({
        id: 'Test RISC Emergency Coolant', name: 'RISC Emergency Coolant System', type: 'misc',
        flags: ['F_EMERGENCY_COOLANT_SYSTEM'], stats: { criticalSlots: 1, bv: 10, explosive: true },
    });
    const viralJammer = new MiscEquipment({
        id: 'Test RISC Viral Jammer', name: 'RISC Viral Jammer (Decoy)', type: 'misc',
        flags: ['F_VIRAL_JAMMER_DECOY'], stats: { criticalSlots: 1, bv: 10 },
    });
    const smallShield = new MiscEquipment({
        id: 'Test Small Shield', name: 'Test Small Shield', type: 'misc',
        flags: ['F_SHIELD', 'S_SHIELD_SMALL'], stats: { criticalSlots: 3, bv: 10 },
    });
    const mediumShield = new MiscEquipment({
        id: 'Test Medium Shield', name: 'Test Medium Shield', type: 'misc',
        flags: ['F_SHIELD', 'S_SHIELD_MEDIUM'], stats: { criticalSlots: 5, bv: 20 },
    });
    const largeShield = new MiscEquipment({
        id: 'Test Large Shield', name: 'Test Large Shield', type: 'misc',
        flags: ['F_SHIELD', 'S_SHIELD_LARGE'], stats: { criticalSlots: 7, bv: 30 },
    });
    const jumpJet = new MiscEquipment({
        id: 'Test Jump Jet', name: 'Test Jump Jet', type: 'misc',
        flags: ['F_JUMP_JET'], stats: { criticalSlots: 1 },
    });
    const partialWing = new MiscEquipment({
        id: 'Test Partial Wing', name: 'Partial Wing', type: 'misc',
        flags: ['F_PARTIAL_WING'], stats: { criticalSlots: 3 },
    });
    const umu = new MiscEquipment({
        id: 'Test UMU', name: 'Test UMU', type: 'misc',
        flags: ['F_UMU'], stats: { criticalSlots: 1 },
    });
    const tsm = new MiscEquipment({
        id: 'Test TSM', name: 'Test TSM', type: 'misc',
        flags: ['F_TSM'], stats: { criticalSlots: 1 },
    });
    const ramPlate = new MiscEquipment({
        id: 'Test Ram Plate', name: 'Ram Plate', type: 'misc',
        flags: ['F_RAM_PLATE'], stats: { criticalSlots: 1 },
    });
    const spikes = new MiscEquipment({
        id: 'Test Spikes', name: 'Spikes', type: 'misc',
        flags: ['F_SPIKES'], stats: { criticalSlots: 1 },
    });
    const claw = new MiscEquipment({
        id: 'Test Claw', name: 'Claw', type: 'misc',
        flags: ['F_HAND_WEAPON', 'S_CLAW'], stats: { criticalSlots: 1 },
    });
    const vibroblade = new MiscEquipment({
        id: 'Test Small Vibroblade', name: 'Vibroblade (Small)', type: 'misc',
        flags: ['F_CLUB', 'S_VIBRO_SMALL'], stats: { criticalSlots: 1 },
    });
    const supercharger = new MiscEquipment({
        id: 'Test Supercharger', name: 'Supercharger', type: 'misc',
        flags: ['F_MASC', 'S_SUPERCHARGER'], stats: { criticalSlots: 1 },
    });
    const jetBooster = new MiscEquipment({
        id: 'Test Jet Booster', name: 'Jet Booster', type: 'misc',
        flags: ['F_MASC', 'F_JET_BOOSTER'], stats: { criticalSlots: 1 },
    });
    const explosiveWeapon = new WeaponEquipment({
        id: 'Test Explosive Weapon', name: 'Explosive Weapon', type: 'weapon',
        flags: ['F_ENERGY'], stats: { criticalSlots: 1, explosive: true },
        weapon: { damage: 5, explosionDamage: 15 },
    });
    const inertWeapon = new WeaponEquipment({
        id: 'Test Inert Weapon', name: 'Inert Weapon', type: 'weapon',
        flags: ['F_ENERGY'], stats: { criticalSlots: 1, explosive: false },
        weapon: { damage: 5, explosionDamage: 15 },
    });
    const explosiveAc = new WeaponEquipment({
        id: 'Test Explosive AC', name: 'Explosive AC', type: 'weapon',
        flags: ['F_AC', 'F_BALLISTIC', 'F_DIRECT_FIRE'],
        stats: { criticalSlots: 1, explosive: true },
        weapon: { ammoType: 'AC', rackSize: 5, damage: 5, explosionDamage: 15 },
    });
    const explosiveMisc = new MiscEquipment({
        id: 'Test Explosive Misc', name: 'Explosive Misc', type: 'misc',
        stats: { criticalSlots: 1, explosive: true },
    });
    const inertMisc = new MiscEquipment({
        id: 'Test Inert Misc', name: 'Inert Misc', type: 'misc',
        stats: { criticalSlots: 1, explosive: false },
    });
    const prototypeImprovedJumpJet = new MiscEquipment({
        id: 'Test Prototype Improved Jump Jet', name: 'Prototype Improved Jump Jet', type: 'misc',
        flags: ['F_JUMP_JET', 'S_IMPROVED', 'S_PROTOTYPE'],
        stats: { criticalSlots: 1, explosive: true },
    });
    const fuel = new MiscEquipment({
        id: 'Test Fuel', name: 'Extended Fuel Tank', type: 'misc',
        flags: ['F_FUEL'], stats: { criticalSlots: 1, explosive: true },
    });
    const coolantPod = new AmmoEquipment({
        id: 'Test Coolant Pod', name: 'Coolant Pod', type: 'ammo',
        stats: { criticalSlots: 1 }, ammo: { type: 'COOLANT_POD', shots: 1 },
    });
    const caseEquipment = new MiscEquipment({
        id: 'Test CASE', name: 'CASE', type: 'misc',
        flags: ['F_CASE'], stats: { criticalSlots: 1 },
    });
    const caseIIEquipment = new MiscEquipment({
        id: 'Test CASE II', name: 'CASE II', type: 'misc',
        flags: ['F_CASE_II'], stats: { criticalSlots: 1 },
    });
    return createTestEquipmentRegistry({
        [compositeStructure.id]: compositeStructure,
        [laser.id]: laser,
        [riscLaserPulse.id]: riscLaserPulse,
        [laserInsulator.id]: laserInsulator,
        [mrm.id]: mrm,
        [apollo.id]: apollo,
        [ac.id]: ac,
        [flamer.id]: flamer,
        [ammo.id]: ammo,
        [mml.id]: mml,
        [atm.id]: atm,
        [atmAmmo.id]: atmAmmo,
        [ppc.id]: ppc,
        [ppcCapacitor.id]: ppcCapacitor,
        [masc.id]: masc,
        [hag.id]: hag,
        [stealth.id]: stealth,
        [ecm.id]: ecm,
        [angelEcm.id]: angelEcm,
        [artemisLauncher.id]: artemisLauncher,
        [artemisV.id]: artemisV,
        [artemisAmmo.id]: artemisAmmo,
        [c3EmergencyMaster.id]: c3EmergencyMaster,
        [c3Master.id]: c3Master,
        [bap.id]: bap,
        [bombast.id]: bombast,
        [heatSink.id]: heatSink,
        [targetingComputer.id]: targetingComputer,
        [droneOperatingSystem.id]: droneOperatingSystem,
        [modularArmor.id]: modularArmor,
        [vspLaser.id]: vspLaser,
        [aes.id]: aes,
        [radicalHeatSink.id]: radicalHeatSink,
        [blueShield.id]: blueShield,
        [emergencyCoolant.id]: emergencyCoolant,
        [viralJammer.id]: viralJammer,
        [smallShield.id]: smallShield,
        [mediumShield.id]: mediumShield,
        [largeShield.id]: largeShield,
        [jumpJet.id]: jumpJet,
        [partialWing.id]: partialWing,
        [umu.id]: umu,
        [tsm.id]: tsm,
        [ramPlate.id]: ramPlate,
        [spikes.id]: spikes,
        [claw.id]: claw,
        [vibroblade.id]: vibroblade,
        [supercharger.id]: supercharger,
        [jetBooster.id]: jetBooster,
        [explosiveWeapon.id]: explosiveWeapon,
        [inertWeapon.id]: inertWeapon,
        [explosiveAc.id]: explosiveAc,
        [explosiveMisc.id]: explosiveMisc,
        [inertMisc.id]: inertMisc,
        [prototypeImprovedJumpJet.id]: prototypeImprovedJumpJet,
        [fuel.id]: fuel,
        [coolantPod.id]: coolantPod,
        [caseEquipment.id]: caseEquipment,
        [caseIIEquipment.id]: caseIIEquipment,
    });
}

function directMekMtf(options: DirectFixtureOptions): string {
    if (options.includePartialWing) return directPartialWingMekMtf();
    if (options.shieldSize) return directShieldMekMtf(options.shieldSize);
    const includeBombast = options.includeBombast ?? false;
    const includeFlamer = options.includeFlamer ?? false;
    const includeRiscLaserPulse = options.includeRiscLaserPulse ?? false;
    const includeLaserInsulator = options.includeLaserInsulator ?? false;
    const includeApollo = options.includeApollo ?? false;
    const includeTargetingComputer = options.includeTargetingComputer ?? false;
    const includeDroneOperatingSystem = options.includeDroneOperatingSystem ?? false;
    const includeModularArmor = options.includeModularArmor ?? false;
    const includeVspLaser = options.includeVspLaser ?? false;
    const includeAes = options.includeAes ?? false;
    const includePairedArmAes = options.includePairedArmAes ?? false;
    const includeLegAes = options.includeLegAes ?? false;
    const includeCompleteLegAes = options.includeCompleteLegAes ?? false;
    const includeChargeEquipment = options.includeChargeEquipment ?? false;
    const includeClaw = options.includeClaw ?? false;
    const includeVibroblade = options.includeVibroblade ?? false;
    const includeSupercharger = options.includeSupercharger ?? false;
    const includeJetBooster = options.includeJetBooster ?? false;
    const includeEscalatingFailureEquipment = options.includeEscalatingFailureEquipment ?? false;
    const includeExplosionEquipment = options.includeExplosionEquipment ?? false;
    const configuration = options.configuration ?? 'biped';
    if (configuration === 'quad') return directQuadMekMtf(options);
    const tripod = configuration === 'tripod';
    const superheavy = configuration === 'superheavy';
    const mass = tripod ? 60 : superheavy ? 105 : includeChargeEquipment ? 45
        : includeClaw ? 55 : includeVibroblade ? 100 : 20;
    const engine = tripod ? 300 : superheavy ? 315 : includeChargeEquipment ? 225
        : includeClaw ? 275 : includeVibroblade ? 300 : 100;
    const cockpit = tripod ? 'Tripod' : options.cockpitType;
    const rightTorsoEquipment = [
        ...(includeBombast ? ['Test Bombast Laser'] : []),
        ...(includeFlamer ? ['Test Flamer'] : []),
        ...(includeTargetingComputer ? ['IS Targeting Computer'] : []),
        ...(includeDroneOperatingSystem ? ['Test Drone Operating System'] : []),
        ...(includeModularArmor ? ['Test Modular Armor', 'Test Jump Jet'] : []),
        ...(includeVspLaser ? ['Test Medium VSP Laser'] : []),
        ...(includeAes ? ['Heat Sink'] : []),
        ...(includeChargeEquipment ? ['Test Ram Plate'] : []),
        ...(includeClaw || includeVibroblade ? ['Test TSM'] : []),
        ...(includeEscalatingFailureEquipment ? [
            'Test Radical Heat Sink',
            'Test Blue Shield',
            'Test RISC Emergency Coolant',
            'Test RISC Viral Jammer',
        ] : []),
        ...(includeExplosionEquipment ? [
            'Test Explosive Weapon',
            'Test Inert Weapon',
            'Test Explosive AC',
            'Test Explosive Misc',
            'Test Inert Misc',
            'Test Prototype Improved Jump Jet',
            'Test Fuel',
            'Test RISC Emergency Coolant',
            'Test Coolant Pod',
        ] : []),
        ...(options.explosionProtection === 'case' || options.explosionProtection === 'both'
            ? ['Test CASE'] : []),
        ...(options.explosionProtection === 'case-ii' || options.explosionProtection === 'both'
            ? ['Test CASE II'] : []),
    ];
    const leftArmEquipment = [
        'ISMediumLaser',
        ...(includeRiscLaserPulse ? ['Test RISC Laser Pulse Module'] : []),
        ...(includeLaserInsulator ? ['Test Laser Insulator'] : []),
        'Test AC',
        'Test Ammo',
        'Test MML',
        'Test ATM',
        'Test ATM Ammo',
        'Test PPC',
        ...(!includeRiscLaserPulse && !includeLaserInsulator
            ? [includePairedArmAes ? 'Test AES' : 'Test PPC Capacitor']
            : []),
    ];
    const leftTorsoEquipment = [
        'Test HAG',
        'Test Stealth',
        'Test ECM',
        'Test Angel ECM',
        'Test Artemis Launcher',
        'Test Artemis V',
        'Test Artemis Ammo',
        'Test C3 Emergency Master',
        ...(options.includeC3Master ? ['Test C3 Master'] : []),
        ...(options.includeBap ? ['Test BAP'] : []),
        ...(includeModularArmor ? ['Test Modular Armor', 'Test Jump Jet'] : []),
        ...(includeApollo ? ['Test MRM', 'Test Apollo'] : []),
    ];
    const rightArmExtra = includeAes || includePairedArmAes
        ? 'Test AES'
        : includeSupercharger ? 'Test Supercharger'
            : includeJetBooster ? 'Test Jet Booster' : '-Empty-';
    const rightTorso = rightTorsoEquipment.length === 0 ? '' : `Right Torso:
${[...rightTorsoEquipment, ...Array(12 - rightTorsoEquipment.length).fill('-Empty-')].join('\n')}
`;
    const leftLegEquipment = [
        ...(includeLegAes || includeCompleteLegAes ? ['Test AES'] : []),
        ...(includeChargeEquipment ? ['Test Spikes'] : []),
    ];
    const leftLeg = leftLegEquipment.length === 0 ? '' : `Left Leg:
Hip
Upper Leg Actuator
Lower Leg Actuator
Foot Actuator
${[...leftLegEquipment, ...Array(8 - leftLegEquipment.length).fill('-Empty-')].join('\n')}
`;
    const rightLeg = includeCompleteLegAes ? `Right Leg:
Hip
Upper Leg Actuator
Lower Leg Actuator
Foot Actuator
Test AES
${Array(7).fill('-Empty-').join('\n')}
` : '';
    return `uuid:${UUID}
chassis:Direct Fixture
model:DF-1
Config:${tripod ? 'Tripod' : 'Biped'}
techbase:Inner Sphere
era:3050
mass:${mass}
engine:${engine} Fusion Engine
${cockpit ? `cockpit:${cockpit}\n` : ''}gyro:${options.gyroType ?? 'Standard'}
structure:${options.structure ?? 'Standard'}
heat sinks:10 Single
walk mp:5
jump mp:${includeModularArmor ? 2 : 0}
armor:Standard(Inner Sphere)
LA armor:5
RA armor:5
LT armor:5
RT armor:5
CT armor:5
HD armor:3
LL armor:5
RL armor:5
${tripod ? 'CL armor:5\n' : ''}Left Arm:
Shoulder
Upper Arm Actuator
Lower Arm Actuator
Hand Actuator
${leftArmEquipment.join('\n')}
Right Arm:
Shoulder
Upper Arm Actuator
Lower Arm Actuator
Hand Actuator
${includeClaw ? 'Test Claw' : includeVibroblade ? 'Test Small Vibroblade' : includeAes ? 'ISMediumLaser' : 'Heat Sink'}
Heat Sink
Heat Sink
Heat Sink
Heat Sink
Heat Sink
Test MASC
${rightArmExtra}
Left Torso:
${[...leftTorsoEquipment, ...Array(12 - leftTorsoEquipment.length).fill('-Empty-')].join('\n')}
${rightTorso}
${tripod ? `Center Leg:
Hip
Upper Leg Actuator
Lower Leg Actuator
Foot Actuator
-Empty-
-Empty-
-Empty-
-Empty-
-Empty-
-Empty-
-Empty-
-Empty-
` : ''}
${leftLeg}
${rightLeg}
`;
}

function directPartialWingMekMtf(): string {
    return `uuid:${UUID}
chassis:Direct Partial Wing Fixture
model:DPW-1
Config:Biped
techbase:Inner Sphere
era:3050
mass:55
engine:275 Fusion Engine
gyro:Standard
structure:Standard
heat sinks:10 Single
walk mp:5
jump mp:6
armor:Standard(Inner Sphere)
LA armor:5
RA armor:5
LT armor:5
RT armor:5
CT armor:5
HD armor:3
LL armor:5
RL armor:5
Left Torso:
Test Jump Jet
Test Jump Jet
Test Jump Jet
Test Jump Jet
Test Partial Wing
Test Partial Wing
Test Partial Wing
${Array(5).fill('-Empty-').join('\n')}
`;
}

function directShieldMekMtf(size: 'small' | 'medium' | 'large'): string {
    const shieldName = `Test ${size[0]!.toUpperCase()}${size.slice(1)} Shield`;
    const shieldSlots = size === 'large' ? 7 : size === 'medium' ? 5 : 3;
    const leftArm = [
        'Shoulder',
        'Upper Arm Actuator',
        'Lower Arm Actuator',
        'Hand Actuator',
        ...Array(shieldSlots).fill(shieldName),
        ...Array(8 - shieldSlots).fill('-Empty-'),
    ];
    return `uuid:${UUID}
chassis:Direct Shield Fixture
model:DS-${size[0]!.toUpperCase()}
Config:Biped
techbase:Inner Sphere
era:3050
mass:20
engine:100 Fusion Engine
gyro:Standard
structure:Standard
heat sinks:10 Single
walk mp:5
jump mp:3
armor:Standard(Inner Sphere)
LA armor:5
RA armor:5
LT armor:5
RT armor:5
CT armor:5
HD armor:3
LL armor:5
RL armor:5
Left Arm:
${leftArm.join('\n')}
Right Arm:
Shoulder
Upper Arm Actuator
Lower Arm Actuator
Hand Actuator
${[...Array(6).fill('Heat Sink'), ...Array(2).fill('-Empty-')].join('\n')}
Left Torso:
Test Jump Jet
Test Jump Jet
Test Jump Jet
Test UMU
Test UMU
Test TSM
${Array(6).fill('-Empty-').join('\n')}
`;
}

function directQuadMekMtf(options: DirectFixtureOptions): string {
    const leg = `Hip
Upper Leg Actuator
Lower Leg Actuator
Foot Actuator
${Array(8).fill('-Empty-').join('\n')}`;
    return `uuid:${UUID}
chassis:Direct Quad Fixture
model:DQ-1
Config:Quad
techbase:Inner Sphere
era:3050
mass:20
engine:100 Fusion Engine
gyro:${options.gyroType ?? 'Standard'}
structure:Standard
heat sinks:10 Single
walk mp:5
jump mp:0
armor:Standard(Inner Sphere)
FLL armor:5
FRL armor:5
LT armor:5
RT armor:5
CT armor:5
HD armor:3
RLL armor:5
RRL armor:5
Front Left Leg:
${leg}
Front Right Leg:
${leg}
Rear Left Leg:
${leg}
Rear Right Leg:
${leg}
Left Torso:
${Array(10).fill('Heat Sink').join('\n')}
-Empty-
-Empty-
`;
}
