// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import type { ComponentId, LocationId } from '../entity/entity-identifiers';
import { isTalonFlags } from '../entity/utils/physical-weapon-kernel';
import type { AttackerTargetingState } from './attacker-targeting-state';
import {
    groupAvailable,
    type MekGroupAvailabilityFacts,
    type MekLimbProfile,
    type MekMechanicsProfile,
} from './mek-mechanics-profile';
import { componentLocationIds, equipmentForComponent, type MekRuntimeIndex } from './mek-runtime-index';
import { QUAD_FRONT_LEG_LOCATIONS, QUAD_REAR_LEG_LOCATIONS, TRIPOD_LEG_LOCATIONS } from '../entity/types/mek';

/** A front kick, or a quad's kick into its rear arc (TW p. 147; Core p. 238). */
export type MekKickKind = 'kick' | 'mule-kick';

export interface MekKickingLegFacts extends MekGroupAvailabilityFacts {
    /** Whether the part of a component in one location still works (talons span every leg). */
    componentAvailableAt(componentId: ComponentId, locationId: LocationId): boolean;
    /** Whether a weapon mounted in the location fired this turn. */
    weaponFiredAt(locationId: LocationId): boolean;
}


/**
 * The legs a kick uses. A kick is made with one chosen leg (Core p. 81): any leg of a biped or tripod, as the tripod
 * rules (Core's tripod appendix; Interstellar Operations' Tripod Physical Attacks) only limit it to the front arc.
 * A quad kicks forward with a front leg and mule kicks with its rear legs (TW p. 147; Core p. 238).
 */
export function kickLegIds(index: MekRuntimeIndex, kind: MekKickKind): readonly LocationId[] {
    const locations = [...index.locations.values()];
    const quad = locations.some(location => location.code === 'FLL');
    // A biped has no CL, so the tripod's legs cover both.
    const codes: readonly string[] = !quad ? TRIPOD_LEG_LOCATIONS
        : kind === 'mule-kick' ? QUAD_REAR_LEG_LOCATIONS : QUAD_FRONT_LEG_LOCATIONS;
    return locations.filter(location => codes.includes(location.code)).map(location => location.id);
}

/** Locations holding a weapon fired this turn; a leg holding one cannot kick (TW p. 147, Core p. 81). */
export function weaponFiredLocationIds(
    index: MekRuntimeIndex,
    targeting: AttackerTargetingState,
): ReadonlySet<LocationId> {
    const fired = new Set<LocationId>();
    for (const [componentId, component] of targeting.components) {
        if (component.selection === undefined) continue;
        for (const locationId of componentLocationIds(index, componentId)) fired.add(locationId);
    }
    return fired;
}

function kickLegLimbs(profile: MekMechanicsProfile, index: MekRuntimeIndex, kind: MekKickKind): readonly MekLimbProfile[] {
    const legIds = kickLegIds(index, kind);
    return profile.limbs.filter(limb => legIds.includes(limb.locationId));
}

/**
 * Legs whose destroyed actuators weaken a kick: a Total Warfare front kick counts only the kicking leg (p. 147); a
 * Core kick every leg it may use (p. 81: "either leg apply to all kicks"), which for a quad means the legs of the
 * kick's arc (p. 238). A mule kick is one kick with both rear legs in either ruleset (TW p. 147: "both legs used in
 * the kick").
 */
export function kickActuatorLegs(
    profile: MekMechanicsProfile,
    index: MekRuntimeIndex,
    kind: MekKickKind,
    kickingLeg: MekLimbProfile | null,
): readonly MekLimbProfile[] {
    return kind === 'kick' && kickingLeg !== null && profile.rulesFlavor === 'total-warfare'
        ? [kickingLeg]
        : kickLegLimbs(profile, index, kind);
}

/**
 * Legs whose talons add to the kick: the kicking leg, or both rear legs for a mule kick (Core p. 81). Null means
 * every talon (death from above, or no leg can kick).
 */
export function kickTalonLegs(
    profile: MekMechanicsProfile,
    index: MekRuntimeIndex,
    kind: MekKickKind,
    kickingLeg: MekLimbProfile | null,
): readonly MekLimbProfile[] | null {
    if (kind === 'mule-kick') return kickLegLimbs(profile, index, kind);
    return kickingLeg === null ? null : [kickingLeg];
}

/**
 * Whether the talons add to the attack: each of `legs` needs working talons, and a destroyed foot actuator in a leg
 * destroys its talons (TO:AUE). With no legs given every talon must work. Null without talons.
 */
export function kickTalonsIntact(
    profile: MekMechanicsProfile,
    index: MekRuntimeIndex,
    facts: MekKickingLegFacts,
    legs: readonly MekLimbProfile[] | null,
): boolean | null {
    const talons = profile.physicalWeapons.filter(group =>
        isTalonFlags(equipmentForComponent(index, group.componentId)?.flags ?? new Set()));
    if (talons.length === 0) return null;
    if (legs === null) return talons.every(group => groupAvailable(group, facts));
    return legs.length > 0 && legs.every(leg => {
        const legTalons = talons.filter(group => group.locationIds.includes(leg.locationId));
        return legTalons.length > 0
            && legTalons.every(group => facts.componentAvailableAt(group.componentId, leg.locationId))
            && leg.actuators.every(actuator => actuator.kind !== 'foot' || groupAvailable(actuator, facts));
    });
}

/**
 * The leg to kick with: an intact leg of the kick whose weapons did not fire this turn, giving the best kick. A mule
 * kick uses both rear legs, so either one destroyed or firing a weapon rules it out (TW p. 147). Each destroyed upper
 * or lower leg actuator adds +2 and halves damage, a foot only adds +1, and talons only add damage, so the leg with
 * the most damage also has the lowest to-hit modifier: no choice is ever worse on one count and better on the other.
 */
export function selectMekKickingLeg(
    profile: MekMechanicsProfile,
    index: MekRuntimeIndex,
    facts: MekKickingLegFacts,
    kind: MekKickKind,
): MekLimbProfile | null {
    const legs = kickLegLimbs(profile, index, kind);
    if (kind === 'mule-kick') {
        return legs.some(leg => facts.locationDestroyed(leg.locationId) || facts.weaponFiredAt(leg.locationId))
            ? null : legs[0] ?? null;
    }
    let best: { readonly leg: MekLimbProfile; readonly damage: number; readonly modifier: number } | null = null;
    for (const leg of legs) {
        if (facts.locationDestroyed(leg.locationId) || facts.weaponFiredAt(leg.locationId)) continue;
        const lost = kickActuatorLegs(profile, index, kind, leg)
            .flatMap(limb => limb.actuators)
            .filter(actuator => !groupAvailable(actuator, facts));
        const halvings = lost.filter(actuator => actuator.kind === 'upper-leg' || actuator.kind === 'lower-leg').length;
        const modifier = 2 * halvings + lost.filter(actuator => actuator.kind === 'foot').length;
        const talons = kickTalonsIntact(profile, index, facts, kickTalonLegs(profile, index, kind, leg));
        const damage = (talons ? 1.5 : 1) / 2 ** halvings;
        if (best === null || damage > best.damage || (damage === best.damage && modifier < best.modifier)) {
            best = { leg, damage, modifier };
        }
    }
    return best?.leg ?? null;
}
