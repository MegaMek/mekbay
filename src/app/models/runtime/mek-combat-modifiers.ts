// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import { ImmutableIndex } from '../entity/immutable-collections';
import type {
    ComponentId,
    CriticalSlotId,
    LocationId,
} from '../entity/entity-identifiers';
import type { IntrinsicWeapon } from '../entity/types/weapon';
import { isPhysicalWeaponEquipment } from '../entity/utils/physical-weapon';
import { WeaponEquipment } from '../equipment.model';
import { TN_PRONE_ATTACKER } from '../target-number-calculator.model';
import type { ToHitModifierBreakdownEntry } from '../rules/game-rules';
import { mekHeatEffects } from '../rules/mek-heat-rules';
import type {
    MekExactComponentGroup,
    MekLimbProfile,
    MekMechanicsProfile,
} from './mek-mechanics-profile';
import {
    componentLocationIds,
    equipmentForComponent,
    type MekRuntimeIndex,
} from './mek-runtime-index';

export interface MekCombatModifierRuntimeFacts {
    readonly currentHeat: number;
    readonly conditions: ReadonlySet<'shutdown' | 'prone' | 'disconnected'>;
    readonly dedicatedPilotPresent: boolean;
    readonly dedicatedPilotFunctional: boolean;
    readonly dedicatedGunneryOfficerPresent: boolean;
    readonly dedicatedGunneryOfficerFunctional: boolean;
    componentAvailable(componentId: ComponentId): boolean;
    criticalSlotUnavailable(slotId: CriticalSlotId): boolean;
    locationDestroyed(locationId: LocationId): boolean;
}

export interface MekCombatModifierProjection {
    readonly kind: 'supported';
    readonly ranged: readonly ToHitModifierBreakdownEntry[];
    readonly physical: readonly ToHitModifierBreakdownEntry[];
    readonly intrinsic: ReadonlyMap<string, readonly ToHitModifierBreakdownEntry[]>;
    readonly components: ReadonlyMap<ComponentId, readonly ToHitModifierBreakdownEntry[]>;
}

export type MekCombatModifierProjectionResult = MekCombatModifierProjection | Readonly<{
    kind: 'unsupported';
    blockers: readonly string[];
}>;

/**
 * Current attack modifiers from one immutable Mek profile plus sparse runtime
 * facts. Availability and physical damage remain owned by their existing
 * projections; this projection only owns the modifier breakdown.
 */
export function projectMekCombatModifiers(
    profile: MekMechanicsProfile,
    index: MekRuntimeIndex,
    facts: MekCombatModifierRuntimeFacts,
): MekCombatModifierProjection {
    const arms = armStatuses(profile, index, facts);
    const legs = profile.limbs.filter(limb => limb.kind === 'leg');
    const ranged = commonRangedModifiers(profile, index, facts, legs);
    const physical = commonPhysicalModifiers(profile, facts);
    const intrinsic = new Map<string, readonly ToHitModifierBreakdownEntry[]>();
    for (const action of index.intrinsicActions) {
        intrinsic.set(action.id, intrinsicModifiers(action, arms, legs, profile, facts));
    }
    const components = new Map<ComponentId, readonly ToHitModifierBreakdownEntry[]>();
    for (const [componentId, component] of index.components) {
        if (component.kind !== 'equipment') continue;
        const equipment = equipmentForComponent(index, componentId);
        if (!equipment) continue;
        const locations = componentLocationIds(index, componentId)
            .map(locationId => index.locations.get(locationId)?.code)
            .filter(code => code !== undefined);
        const modifiers = isPhysicalWeaponEquipment(equipment)
            ? physicalComponentModifiers(locations, arms)
            : equipment instanceof WeaponEquipment
                ? rangedComponentModifiers(locations, arms, profile.rulesFlavor)
                : Object.freeze([]);
        if (modifiers.length > 0) components.set(componentId, modifiers);
    }
    return Object.freeze({
        kind: 'supported',
        ranged,
        physical,
        intrinsic: new ImmutableIndex(intrinsic),
        components: new ImmutableIndex(components),
    });
}

interface ArmStatus {
    readonly code: 'LA' | 'RA';
    readonly missingHand: boolean;
    readonly missingLowerArm: boolean;
    readonly destroyedShoulder: boolean;
    readonly destroyedHand: boolean;
    readonly destroyedUpperArm: boolean;
    readonly destroyedLowerArm: boolean;
    readonly aesInstalled: boolean;
    readonly aesFunctional: boolean;
}

function commonRangedModifiers(
    profile: MekMechanicsProfile,
    index: MekRuntimeIndex,
    facts: MekCombatModifierRuntimeFacts,
    legs: readonly MekLimbProfile[],
): readonly ToHitModifierBreakdownEntry[] {
    const modifiers: ToHitModifierBreakdownEntry[] = [];
    if (profile.form === 'tripod'
        && facts.dedicatedGunneryOfficerPresent
        && !facts.dedicatedGunneryOfficerFunctional) {
        modifiers.push(weakened('Dedicated Gunnery Officer disabled', 2));
    }
    if (facts.conditions.has('prone')) {
        let modifier = TN_PRONE_ATTACKER;
        let label = 'Prone';
        if (profile.form === 'tripod' || profile.form === 'quad' || profile.form === 'quadvee') {
            label = profile.form === 'tripod' ? 'Prone Tripod' : 'Prone Quad';
            modifier = profile.form === 'tripod' ? 1 : 0;
            const destroyedLeg = legs.some(leg => facts.locationDestroyed(leg.locationId));
            const damagedHip = legs.some(leg => {
                const hip = leg.actuators.find(actuator => actuator.kind === 'hip');
                return hip !== undefined && !groupAvailable(hip, facts);
            });
            if (destroyedLeg || damagedHip) modifier = TN_PRONE_ATTACKER;
        }
        modifiers.push(weakened(label, modifier));
    }

    const sensorSlots = profile.sensors.criticalSlotIds;
    const destroyedSensors = sensorSlots.filter(facts.criticalSlotUnavailable).length;
    const destroyedHeadSensors = sensorSlots.filter(slotId => {
        const slot = index.slots.get(slotId);
        return slot !== undefined
            && index.locations.get(slot.locationId)?.code === 'HD'
            && facts.criticalSlotUnavailable(slotId);
    }).length;
    if (profile.cockpit.torsoMounted && destroyedHeadSensors >= 2) {
        modifiers.push(weakened('Head Sensors Destroyed (Torso-Mounted Cockpit)', 4));
    }
    const fireModifier = mekHeatEffects(facts.currentHeat).fireModifier;
    if (fireModifier !== 0) {
        modifiers.push(Object.freeze({
            label: 'Heat - Fire Modifier',
            modifier: fireModifier,
            weakened: true,
            kind: 'heat' as const,
        }));
    }
    const sensorModifier = !profile.cockpit.torsoMounted && destroyedSensors > 0
        ? destroyedSensors * 2
        : profile.cockpit.torsoMounted && destroyedHeadSensors < 2 && destroyedSensors > 0
            ? destroyedSensors * 2
            : 0;
    if (sensorModifier !== 0) modifiers.push(weakened('Sensors Destroyed', sensorModifier));
    return freezeModifiers(modifiers);
}

function commonPhysicalModifiers(
    profile: MekMechanicsProfile,
    facts: MekCombatModifierRuntimeFacts,
): readonly ToHitModifierBreakdownEntry[] {
    const modifiers: ToHitModifierBreakdownEntry[] = [];
    if (profile.form === 'tripod' && facts.dedicatedPilotPresent) {
        modifiers.push(facts.dedicatedPilotFunctional
            ? modifier('Dedicated Pilot', -1)
            : weakened('Dedicated Pilot disabled', 2));
    }
    if (profile.declaredMassTons > 100) modifiers.push(modifier('Superheavy', 1));
    return freezeModifiers(modifiers);
}

function intrinsicModifiers(
    action: IntrinsicWeapon,
    arms: ReadonlyMap<string, ArmStatus>,
    legs: readonly MekLimbProfile[],
    profile: MekMechanicsProfile,
    facts: MekCombatModifierRuntimeFacts,
): readonly ToHitModifierBreakdownEntry[] {
    if (typeof action.hitModifierAdjustment !== 'number') return Object.freeze([]);
    const modifiers: ToHitModifierBreakdownEntry[] = [];
    const pristineSystemModifier = intrinsicPristineSystemModifier(action, arms, legs, profile);
    const nonSystemModifier = action.hitModifierAdjustment - pristineSystemModifier;
    if (nonSystemModifier !== 0) modifiers.push(modifier(action.name, nonSystemModifier));

    switch (action.kind) {
        case 'punch': {
            const arm = arms.get(action.locations[0] ?? '');
            if (arm) {
                addArmActuators(modifiers, arm, { hand: 1, upper: 2, lower: 2 }, true);
                addArmAes(modifiers, arm, -1);
            }
            break;
        }
        case 'club':
            addTwoArmModifiers(modifiers, arms, 'club');
            break;
        case 'push':
            addTwoArmModifiers(modifiers, arms, 'push');
            break;
        case 'kick': {
            const availableLegs = legs.filter(leg => !facts.locationDestroyed(leg.locationId));
            const destroyedLegActuators = availableLegs.reduce((total, leg) => total
                + leg.actuators.filter(actuator =>
                    (actuator.kind === 'upper-leg' || actuator.kind === 'lower-leg')
                    && !groupAvailable(actuator, facts)).length, 0);
            const destroyedFeet = availableLegs.reduce((total, leg) => total
                + leg.actuators.filter(actuator => actuator.kind === 'foot'
                    && !groupAvailable(actuator, facts)).length, 0);
            if (destroyedLegActuators > 0) {
                modifiers.push(weakened(
                    countedDestroyedLabel('Leg Actuator', destroyedLegActuators),
                    destroyedLegActuators * 2,
                ));
            }
            if (destroyedFeet > 0) {
                modifiers.push(weakened(
                    countedDestroyedLabel('Foot Actuator', destroyedFeet),
                    destroyedFeet,
                ));
            }
            const legAes = legAesStatus(legs, profile, facts);
            if (legAes.installed) {
                modifiers.push(legAes.functional
                    ? modifier('Leg AES', -1)
                    : weakened('Leg AES Destroyed', 0));
            }
            break;
        }
    }
    return freezeModifiers(modifiers);
}

function intrinsicPristineSystemModifier(
    action: IntrinsicWeapon,
    arms: ReadonlyMap<string, ArmStatus>,
    legs: readonly MekLimbProfile[],
    profile: MekMechanicsProfile,
): number {
    switch (action.kind) {
        case 'punch': {
            const arm = arms.get(action.locations[0] ?? '');
            return arm === undefined ? 0
                : (arm.missingHand ? 1 : 0)
                    + (arm.missingLowerArm ? 2 : 0)
                    - (arm.aesInstalled ? 1 : 0);
        }
        case 'club':
        case 'push':
            return pairedArmAesInstalled(arms) ? -1 : 0;
        case 'kick':
            return legAesInstalled(legs, profile) ? -1 : 0;
        default:
            return 0;
    }
}

function physicalComponentModifiers(
    locations: readonly string[],
    arms: ReadonlyMap<string, ArmStatus>,
): readonly ToHitModifierBreakdownEntry[] {
    const modifiers: ToHitModifierBreakdownEntry[] = [];
    for (const code of locations) {
        const arm = arms.get(code);
        if (!arm) continue;
        addArmActuators(modifiers, arm, { hand: 2, upper: 2, lower: 2 }, false);
        addArmAes(modifiers, arm, -1);
    }
    return freezeModifiers(modifiers);
}

function rangedComponentModifiers(
    locations: readonly string[],
    arms: ReadonlyMap<string, ArmStatus>,
    ruleset: MekMechanicsProfile['rulesFlavor'],
): readonly ToHitModifierBreakdownEntry[] {
    const modifiers: ToHitModifierBreakdownEntry[] = [];
    if (locations.length === 1) {
        const arm = arms.get(locations[0]);
        if (arm) addArmAes(modifiers, arm, -1);
    }
    for (const code of locations) {
        const arm = arms.get(code);
        if (!arm) continue;
        if (arm.destroyedShoulder) {
            modifiers.push(weakened(`Shoulder Destroyed (${code})`, 4));
            continue;
        }
        if (arm.destroyedUpperArm) {
            modifiers.push(weakened(`Upper Arm Actuator Destroyed (${code})`, 1));
        }
        if (arm.destroyedLowerArm && ruleset === 'total-warfare') {
            modifiers.push(weakened(`Lower Arm Actuator Destroyed (${code})`, 1));
        }
    }
    return freezeModifiers(modifiers);
}

function armStatuses(
    profile: MekMechanicsProfile,
    index: MekRuntimeIndex,
    facts: MekCombatModifierRuntimeFacts,
): ReadonlyMap<string, ArmStatus> {
    const result = new Map<string, ArmStatus>();
    for (const limb of profile.limbs.filter(candidate => candidate.kind === 'arm')) {
        const code = index.locations.get(limb.locationId)?.code;
        if (code !== 'LA' && code !== 'RA') continue;
        const actuator = (kind: MekLimbProfile['actuators'][number]['kind']) =>
            limb.actuators.find(candidate => candidate.kind === kind);
        const shoulder = actuator('shoulder');
        const hand = actuator('hand');
        const upper = actuator('upper-arm');
        const lower = actuator('lower-arm');
        const aes = profile.actuatorEnhancementSystems.filter(group =>
            group.locationIds.includes(limb.locationId));
        result.set(code, Object.freeze({
            code,
            missingHand: hand === undefined,
            missingLowerArm: lower === undefined,
            destroyedShoulder: shoulder !== undefined && !groupAvailable(shoulder, facts),
            destroyedHand: hand !== undefined && !groupAvailable(hand, facts),
            destroyedUpperArm: upper !== undefined && !groupAvailable(upper, facts),
            destroyedLowerArm: lower !== undefined && !groupAvailable(lower, facts),
            aesInstalled: aes.length > 0,
            aesFunctional: aes.length > 0 && aes.every(group => groupAvailable(group, facts)),
        }));
    }
    return new ImmutableIndex(result);
}

function addArmActuators(
    modifiers: ToHitModifierBreakdownEntry[],
    arm: ArmStatus,
    values: Readonly<{ hand: number; upper: number; lower: number }>,
    includeMissing: boolean,
): void {
    if (arm.destroyedHand) {
        modifiers.push(weakened(`Hand Actuator Destroyed (${arm.code})`, values.hand));
    } else if (includeMissing && arm.missingHand) {
        modifiers.push(modifier(`Hand Actuator Missing (${arm.code})`, values.hand));
    }
    if (arm.destroyedUpperArm) {
        modifiers.push(weakened(`Upper Arm Actuator Destroyed (${arm.code})`, values.upper));
    }
    if (arm.destroyedLowerArm) {
        modifiers.push(weakened(`Lower Arm Actuator Destroyed (${arm.code})`, values.lower));
    } else if (includeMissing && arm.missingLowerArm) {
        modifiers.push(modifier(`Lower Arm Actuator Missing (${arm.code})`, values.lower));
    }
}

function addArmAes(
    modifiers: ToHitModifierBreakdownEntry[],
    arm: ArmStatus,
    value: number,
): void {
    if (!arm.aesInstalled) return;
    modifiers.push(arm.aesFunctional
        ? modifier(`Arm AES (${arm.code})`, value)
        : weakened(`Arm AES Destroyed (${arm.code})`, 0));
}

function addTwoArmModifiers(
    modifiers: ToHitModifierBreakdownEntry[],
    arms: ReadonlyMap<string, ArmStatus>,
    attack: 'club' | 'push',
): void {
    const pair = (['LA', 'RA'] as const)
        .map(code => arms.get(code))
        .filter((arm): arm is ArmStatus => arm !== undefined);
    if (attack === 'push') {
        for (const arm of pair) {
            if (arm.destroyedShoulder) {
                modifiers.push(weakened(`Shoulder Destroyed (${arm.code})`, 2));
            }
        }
    } else {
        for (const arm of pair) {
            addArmActuators(modifiers, arm, { hand: 2, upper: 2, lower: 2 }, false);
        }
    }
    const functional = pair.filter(arm => arm.aesFunctional);
    if (attack === 'push' && pairedArmAesInstalled(arms)) {
        modifiers.push(functional.length === 2
            ? modifier('Paired Arm AES', -1)
            : weakened('Arm AES Destroyed', 0));
    } else if (attack === 'club' && functional.length > 0) {
        modifiers.push(modifier(
            functional.length === 2 ? 'Paired Arm AES' : `Arm AES (${functional[0].code})`,
            -1,
        ));
    } else if (attack === 'club'
        && pair.some(arm => arm.aesInstalled)
        && pair.every(arm => !arm.aesFunctional)) {
        modifiers.push(weakened('Arm AES Destroyed', 0));
    }
}

function pairedArmAesInstalled(arms: ReadonlyMap<string, ArmStatus>): boolean {
    return arms.get('LA')?.aesInstalled === true && arms.get('RA')?.aesInstalled === true;
}

function legAesInstalled(
    legs: readonly MekLimbProfile[],
    profile: MekMechanicsProfile,
): boolean {
    return legs.length > 0 && legs.every(leg => profile.actuatorEnhancementSystems.some(group =>
        group.locationIds.includes(leg.locationId)));
}

function legAesStatus(
    legs: readonly MekLimbProfile[],
    profile: MekMechanicsProfile,
    facts: MekCombatModifierRuntimeFacts,
): Readonly<{ installed: boolean; functional: boolean }> {
    const installed = legAesInstalled(legs, profile);
    return Object.freeze({
        installed,
        functional: installed && legs.every(leg => profile.actuatorEnhancementSystems
            .filter(group => group.locationIds.includes(leg.locationId))
            .every(group => groupAvailable(group, facts))),
    });
}

function groupAvailable(
    group: MekExactComponentGroup,
    facts: Pick<MekCombatModifierRuntimeFacts,
        'componentAvailable' | 'criticalSlotUnavailable' | 'locationDestroyed'>,
): boolean {
    return facts.componentAvailable(group.componentId)
        && group.criticalSlotIds.every(slotId => !facts.criticalSlotUnavailable(slotId))
        && group.locationIds.every(locationId => !facts.locationDestroyed(locationId));
}

function countedDestroyedLabel(name: string, count: number): string {
    return count === 1 ? `${name} Destroyed` : `${name}s Destroyed ×${count}`;
}

function modifier(label: string, value: number): ToHitModifierBreakdownEntry {
    return Object.freeze({ label, modifier: value });
}

function weakened(label: string, value: number): ToHitModifierBreakdownEntry {
    return Object.freeze({ label, modifier: value, weakened: true });
}

function freezeModifiers(
    modifiers: readonly ToHitModifierBreakdownEntry[],
): readonly ToHitModifierBreakdownEntry[] {
    return Object.freeze(modifiers.map(item => Object.freeze({ ...item })));
}
