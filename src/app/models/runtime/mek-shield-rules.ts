// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import type { ComponentId, CriticalSlotId, LocationId } from '../entity/entity-identifiers';
import type { MekMechanicsProfile, MekShieldGroup } from './mek-mechanics-profile';

export type MekShieldTrack = 'absorption' | 'capacity';

export interface MekShieldRuntimeFactsV2 {
    componentDestroyed(componentId: ComponentId): boolean;
    criticalSlotUnavailable(slotId: CriticalSlotId): boolean;
    locationDestroyed(locationId: LocationId): boolean;
    shieldDamage(componentId: ComponentId, track: MekShieldTrack): number;
}

export interface MekShieldProjectionV2 {
    readonly componentId: ComponentId;
    readonly locationId: LocationId;
    readonly locationCode: 'LA' | 'RA';
    readonly size: MekShieldGroup['size'];
    readonly bashBonus: number;
    readonly maximumAbsorption: number;
    readonly maximumCapacity: number;
    readonly absorption: number;
    readonly capacity: number;
    readonly absorptionDamage: number;
    readonly capacityDamage: number;
    readonly operational: boolean;
    readonly retainsMobilityPenalty: boolean;
}

/**
 * Resolves shield tracks once from construction topology plus sparse runtime facts.
 * Critical and actuator losses are derived; only combat damage is stored.
 */
export function projectMekShieldsV2(
    profile: MekMechanicsProfile,
    facts: MekShieldRuntimeFactsV2,
): readonly MekShieldProjectionV2[] {
    return Object.freeze(profile.shields.map(shield => projectShield(profile, shield, facts)));
}

function projectShield(
    profile: MekMechanicsProfile,
    shield: MekShieldGroup,
    facts: MekShieldRuntimeFactsV2,
): MekShieldProjectionV2 {
    const location = profile.locations.find(candidate =>
        shield.locationIds.includes(candidate.locationId)
        && (candidate.code === 'LA' || candidate.code === 'RA'));
    if (!location || (location.code !== 'LA' && location.code !== 'RA')) {
        throw new Error(`Shield ${shield.componentId} is not mounted in an arm`);
    }

    const destroyed = facts.componentDestroyed(shield.componentId)
        || facts.locationDestroyed(location.locationId);
    const destroyedCriticals = shield.criticalSlotIds
        .filter(slotId => facts.criticalSlotUnavailable(slotId)).length;
    const allCriticalsUnavailable = shield.criticalSlotIds.length > 0
        && destroyedCriticals === shield.criticalSlotIds.length;
    const actuatorPenalty = shieldActuatorPenalty(profile, location.locationId, facts);
    const absorption = destroyed ? 0 : Math.max(
        0,
        shield.damageAbsorption
            - destroyedCriticals
            - actuatorPenalty
            - facts.shieldDamage(shield.componentId, 'absorption'),
    );
    const capacity = destroyed ? 0 : Math.max(
        0,
        shield.damageCapacity
            - destroyedCriticals * 5
            - actuatorPenalty
            - facts.shieldDamage(shield.componentId, 'capacity'),
    );
    const operational = absorption > 0 && capacity > 0;
    const quadruped = profile.form === 'quad' || profile.form === 'quadvee';
    const retainsMobilityPenalty = !quadruped
        && shield.size !== 'small'
        && !destroyed
        && (profile.rulesFlavor === 'total-warfare'
            ? !allCriticalsUnavailable
            : operational);

    return Object.freeze({
        componentId: shield.componentId,
        locationId: location.locationId,
        locationCode: location.code,
        size: shield.size,
        bashBonus: shield.bashBonus,
        maximumAbsorption: shield.damageAbsorption,
        maximumCapacity: shield.damageCapacity,
        absorption,
        capacity,
        absorptionDamage: shield.damageAbsorption - absorption,
        capacityDamage: shield.damageCapacity - capacity,
        operational,
        retainsMobilityPenalty,
    });
}

function shieldActuatorPenalty(
    profile: MekMechanicsProfile,
    locationId: LocationId,
    facts: MekShieldRuntimeFactsV2,
): number {
    const limb = profile.limbs.find(candidate => candidate.locationId === locationId);
    if (!limb) return 0;
    return limb.actuators.reduce((penalty, actuator) => {
        if (actuator.criticalSlotIds.every(slotId => !facts.criticalSlotUnavailable(slotId))) {
            return penalty;
        }
        return penalty + (actuator.kind === 'shoulder' ? 2 : 1);
    }, 0);
}
