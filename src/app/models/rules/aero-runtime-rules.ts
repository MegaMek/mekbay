// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import type { CBTRuleset } from '../cbt-ruleset.model';
import type { CrewMemberState } from '../crew-member.model';
import { isDroneOperatingSystemEquipment } from '../drone-operating-system.model';
import type { AeroEntity } from '../entity/entities/aero/aero-entity';
import { projectComponentLocationStatuses } from '../runtime/component-status-projection';
import type { NonMekRuntimeIndex } from '../runtime/non-mek-runtime-index';
import type {
NonMekUnitRuntimeState,
} from '../runtime/non-mek-unit-instance';
import type { UnitConditionKey } from '../unit-condition.model';
import type { ToHitModifierBreakdownEntry } from './game-rules';
import { gameRulesFor } from './game-rules';
import { AERO_HEAT_EFFECTS,heatEffectValue } from './heat-effect-rules';

export interface AeroHeatEffects {
    readonly fireModifier: number;
    readonly randomMovementTarget?: number;
    readonly shutdownTarget?: number;
    readonly ammoExplosionTarget?: number;
    readonly pilotDamageTarget?: number;
}

export interface AeroRuntimeRulesProjection {
    readonly destroyed: boolean;
    readonly computedConditions: readonly UnitConditionKey[];
    readonly conditionControlKeys: readonly UnitConditionKey[];
    readonly crewStateControlKeys: readonly CrewMemberState[];
    readonly crewStateDisplayKeys: readonly CrewMemberState[];
    readonly heat: Readonly<{
        readonly tracked: boolean;
        readonly current: number;
        readonly pending: number | null;
        readonly heatsinksOff: number;
        readonly heatSinkCount: number;
        readonly dissipation: number;
        readonly effects: AeroHeatEffects;
    }>;
    readonly modifiers: Readonly<{
        readonly ranged: readonly ToHitModifierBreakdownEntry[];
        readonly physical: readonly ToHitModifierBreakdownEntry[];
    }>;
}

export function aeroHeatEffects(heat: number): AeroHeatEffects {
    const effects: {
        fireModifier: number;
        randomMovementTarget?: number;
        shutdownTarget?: number;
        ammoExplosionTarget?: number;
        pilotDamageTarget?: number;
    } = { fireModifier: 0 };
    effects.fireModifier = heatEffectValue(AERO_HEAT_EFFECTS, 'fire', heat) ?? 0;
    const random = heatEffectValue(AERO_HEAT_EFFECTS, 'random-movement', heat);
    const shutdown = heatEffectValue(AERO_HEAT_EFFECTS, 'shutdown', heat);
    const ammo = heatEffectValue(AERO_HEAT_EFFECTS, 'ammo-explosion', heat);
    const pilot = heatEffectValue(AERO_HEAT_EFFECTS, 'pilot-damage', heat);
    if (random !== undefined) effects.randomMovementTarget = random;
    if (shutdown !== undefined) effects.shutdownTarget = shutdown;
    if (ammo !== undefined) effects.ammoExplosionTarget = ammo;
    if (pilot !== undefined) effects.pilotDamageTarget = pilot;
    return Object.freeze(effects);
}

/** Effective aerospace rules derived only from the Entity and its sparse state. */
export function projectAeroRuntimeRules(
    entity: AeroEntity,
    index: NonMekRuntimeIndex,
    state: NonMekUnitRuntimeState,
    ruleset: CBTRuleset,
): AeroRuntimeRulesProjection {
    const si = [...index.locations.values()].find(location => location.code === 'SI');
    const siDestroyed = si !== undefined
        && si.internalPoints > 0
        && (state.locations.get(si.id)?.internalDamage ?? 0) >= si.internalPoints;
    const damageTrackDestroyed = [...index.damageTracks.values()].some(track =>
        ((track.system === 'engine' && track.stage === (['SmallCraft', 'DropShip', 'JumpShip', 'WarShip', 'SpaceStation'].includes(entity.entityType) ? 6 : 3))
            || (track.system === 'fire-control' && track.stage === 3))
        && (state.damageTracks.get(track.id)?.hits ?? 0) > 0);

    const statuses = projectComponentLocationStatuses(index, state).committed;
    const drone = [...index.components.values()].find(component =>
        isDroneOperatingSystemEquipment(component.mount.equipment));
    const disconnected = drone !== undefined && statuses.get(drone.id) !== 'available';
    const computedConditions: readonly UnitConditionKey[] = disconnected
        ? Object.freeze<UnitConditionKey[]>(['disconnected'])
        : Object.freeze<UnitConditionKey[]>([]);
    const conditionControlKeys: UnitConditionKey[] = ['swarmed', 'tagged', 'ecm-shielded'];
    if (gameRulesFor(ruleset).supportsSkidding) conditionControlKeys.push('skidding');
    conditionControlKeys.push('jammed');
    if (drone !== undefined) conditionControlKeys.push('disconnected');

    const tracked = entity.tracksHeat();
    const heatSinkCount = tracked ? Math.max(0, entity.engineHeatSinks()) : 0;
    const normalDissipation = tracked ? Math.max(0, entity.heatCapacity(false)) : 0;
    const dissipationPerSink = heatSinkCount === 0
        ? 0
        : normalDissipation / heatSinkCount;
    const dissipation = Math.max(
        0,
        normalDissipation - state.heat.heatsinksOff * dissipationPerSink,
    );
    const effects = aeroHeatEffects(tracked ? state.heat.current : 0);
    const ranged = effects.fireModifier === 0
        ? Object.freeze([])
        : Object.freeze([Object.freeze({
            label: 'Heat - Fire Modifier',
            modifier: effects.fireModifier,
            weakened: true,
            kind: 'heat' as const,
        })]);

    return Object.freeze({
        destroyed: state.explicitlyDestroyed || siDestroyed || damageTrackDestroyed,
        computedConditions,
        conditionControlKeys: Object.freeze(conditionControlKeys),
        crewStateControlKeys: Object.freeze([]),
        crewStateDisplayKeys: Object.freeze([]),
        heat: Object.freeze({
            tracked,
            current: tracked ? state.heat.current : 0,
            pending: tracked ? state.heat.pendingOverride ?? null : null,
            heatsinksOff: tracked ? state.heat.heatsinksOff : 0,
            heatSinkCount,
            dissipation,
            effects,
        }),
        modifiers: Object.freeze({ ranged, physical: Object.freeze([]) }),
    });
}
