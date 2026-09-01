// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import type { CrewMemberState } from '../crew.model';
import type { AeroEntity } from '../entity/entities/aero/aero-entity';
import type { NonMekRuntimeIndex } from '../runtime/non-mek-runtime-index';
import type {
    NonMekUnitRuntimeState,
} from '../runtime/non-mek-unit-instance';
import type { ToHitModifierBreakdownEntry } from './game-rules';
import { gameRulesFor } from './game-rules';
import type { CBTRuleset } from '../cbt-ruleset.model';
import { isDroneOperatingSystemEquipment } from '../drone-operating-system.model';
import { projectNonMekComponentStatuses } from '../runtime/non-mek-component-status';
import type { UnitConditionKey } from '../unit-condition.model';

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

const AERO_HEAT_SCALE = Object.freeze([
    { heat: 5, randomMovementTarget: 5 },
    { heat: 8, fireModifier: 1 },
    { heat: 10, randomMovementTarget: 6 },
    { heat: 13, fireModifier: 2 },
    { heat: 14, shutdownTarget: 4 },
    { heat: 15, randomMovementTarget: 7 },
    { heat: 17, fireModifier: 3 },
    { heat: 18, shutdownTarget: 6 },
    { heat: 19, ammoExplosionTarget: 4 },
    { heat: 20, randomMovementTarget: 8 },
    { heat: 21, pilotDamageTarget: 6 },
    { heat: 22, shutdownTarget: 8 },
    { heat: 23, ammoExplosionTarget: 6 },
    { heat: 24, fireModifier: 4 },
    { heat: 25, randomMovementTarget: 10 },
    { heat: 26, shutdownTarget: 10 },
    { heat: 27, pilotDamageTarget: 9 },
    { heat: 28, ammoExplosionTarget: 8 },
    { heat: 30, shutdownTarget: 100 },
] as const);

const DESTROYING_DAMAGE_TRACKS = new Set(['engine_hit_3', 'fcs_hit_3']);

export function aeroHeatEffects(heat: number): AeroHeatEffects {
    const effects: {
        fireModifier: number;
        randomMovementTarget?: number;
        shutdownTarget?: number;
        ammoExplosionTarget?: number;
        pilotDamageTarget?: number;
    } = { fireModifier: 0 };
    for (const row of AERO_HEAT_SCALE) {
        if (heat < row.heat) break;
        if ('fireModifier' in row) effects.fireModifier = row.fireModifier;
        if ('randomMovementTarget' in row) effects.randomMovementTarget = row.randomMovementTarget;
        if ('shutdownTarget' in row) effects.shutdownTarget = row.shutdownTarget;
        if ('ammoExplosionTarget' in row) effects.ammoExplosionTarget = row.ammoExplosionTarget;
        if ('pilotDamageTarget' in row) effects.pilotDamageTarget = row.pilotDamageTarget;
    }
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
        DESTROYING_DAMAGE_TRACKS.has(track.sheetId)
        && (state.damageTracks.get(track.id)?.hits ?? 0) > 0);

    const statuses = projectNonMekComponentStatuses(index, state).committed;
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
