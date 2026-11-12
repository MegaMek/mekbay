// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import type { CBTRuleset } from '../cbt-ruleset.model';
import type { BaseEntity } from '../entity/base-entity';
import type { LocationId } from '../entity/entity-identifiers';
import {
    isBattleArmorEntity,
    isInfantryEntity,
    isProtoMekEntity,
    isVehicleEntity,
} from '../entity/utils/entity-type-guards';
import type { AmmoEquipment } from '../equipment.model';
import type { AttackHitLocation } from '../runtime/attack-hit-location';

/** Each inferno missile adds 2 heat to a Mek, aerospace fighter or small craft (TW p. 142; Core p. 192). */
export const INFERNO_HEAT_PER_MISSILE = 2;

/** The one name Inferno munitions show by: platoon damage and attack hit groups. */
export const INFERNO_LABEL = 'Inferno';

/** Outside heat sources are cumulative to at most 15 heat in a turn (TW p. 159; Core p. 102). */
export const MAX_OUTSIDE_HEAT_PER_TURN = 15;

/** The outside heat a unit holds after `added` more this turn; heat past the cap is wasted. */
export function addOutsideHeat(current: number, added: number): number {
    return Math.min(MAX_OUTSIDE_HEAT_PER_TURN, current + added);
}

/** Inferno missiles deliver no damage; their effect depends on the unit they strike (TW pp. 141-142). */
export function isInfernoAmmo(ammo: AmmoEquipment | null | undefined): boolean {
    return ammo?.hasMunitionType('M_INFERNO') === true;
}

/** An SRM platoon that hits fires one inferno missile per 2 points of its damage, rounded down (TW p. 142). */
export function platoonInfernoMissiles(damage: number): number {
    return Math.floor(Math.max(0, damage) / 2);
}

/** One inferno missile that struck: its hit-location roll read on the struck unit's table, null without one. */
export type InfernoMissile = Readonly<{ location: AttackHitLocation | null }>;

/** What the inferno missiles of one attack do to the unit they strike (TW pp. 141-142; MegaMek deliverInfernoMissiles). */
export type InfernoEffect =
    | Readonly<{ kind: 'heat'; heat: number }>
    | Readonly<{ kind: 'troopers'; troopers: number }>
    | Readonly<{ kind: 'battle-armor-troopers'; troopers: number }>
    | Readonly<{ kind: 'vehicle-criticals'; locationIds: readonly LocationId[] }>
    | Readonly<{ kind: 'protomek-locations'; locationIds: readonly LocationId[] }>
    | Readonly<{ kind: 'structural-integrity'; damage: number }>
    | Readonly<{ kind: 'none' }>;

const NO_EFFECT: InfernoEffect = Object.freeze({ kind: 'none' });
const CONVENTIONAL_FIGHTERS = new Set(['ConvFighter', 'FixedWingSupport']);

/** Fire-resistant armor ignores the heat of heat-causing weapons and inferno missiles (TW pp. 142, 228). */
export function isFireResistant(entity: BaseEntity): boolean {
    return isBattleArmorEntity(entity) && entity.uniformArmor()?.armor?.armorType === 'BA_FIRE_RESIST';
}

/**
 * Core inferno missiles roll no hit location (Core p. 192), so partial cover cannot stop them; Total Warfare reads each
 * missile's roll, and one striking cover misses (TW p. 102).
 */
export function infernoMeetsCover(ruleset: CBTRuleset): boolean {
    return ruleset !== 'core-2026';
}

/**
 * The missiles of one attack that struck the unit. A Mek's missile read as a miss struck partial cover; a ProtoMek's
 * near miss still struck it, and its effect is decided by the roll for each set of three (TW p. 142).
 */
function struckMissiles(entity: BaseEntity, missiles: readonly InfernoMissile[]): readonly InfernoMissile[] {
    return isProtoMekEntity(entity) ? missiles : missiles.filter(missile => missile.location?.kind !== 'miss');
}

/** How many of one attack's missiles count toward the unit's inferno total for the turn. */
export function infernoMissilesStruck(entity: BaseEntity, missiles: readonly InfernoMissile[]): number {
    return struckMissiles(entity, missiles).length;
}

/**
 * What one attack's missiles do to the unit they strike. `earlier` is how many inferno missiles already struck it
 * this turn: the every-three effects count the turn's total (TW pp. 141-142).
 */
export function infernoEffect(entity: BaseEntity, missiles: readonly InfernoMissile[], earlier = 0): InfernoEffect {
    const striking = struckMissiles(entity, missiles);
    const everyThird = Math.floor((earlier + striking.length) / 3) - Math.floor(earlier / 3);
    // Meks, aerospace fighters and small craft take the heat (TW p. 113).
    if (entity.tracksHeat()) return Object.freeze({ kind: 'heat', heat: INFERNO_HEAT_PER_MISSILE * striking.length });
    // Neither infantry effect is modified by terrain or infantry type.
    if (isInfantryEntity(entity)) return Object.freeze({ kind: 'troopers', troopers: 3 * striking.length });
    if (isBattleArmorEntity(entity)) {
        return isFireResistant(entity) ? NO_EFFECT : Object.freeze({ kind: 'battle-armor-troopers', troopers: everyThird });
    }
    if (isVehicleEntity(entity)) {
        // Every missile rolls on the critical hits table of the location it strikes.
        return Object.freeze({ kind: 'vehicle-criticals', locationIds: Object.freeze(striking.flatMap(missile =>
            missile.location?.kind === 'non-mek' ? [missile.location.locationId] : [])) });
    }
    if (isProtoMekEntity(entity)) {
        // The roll of the missile that completes each set of three names the destroyed location. A near miss, or a
        // location already destroyed or absent, destroys none: transfer moves damage, not destruction (MegaMek
        // deliverInfernoMissiles destroys the rolled location).
        return Object.freeze({ kind: 'protomek-locations', locationIds: Object.freeze(striking.flatMap((missile, index) =>
            (earlier + index) % 3 === 2 && missile.location?.kind === 'non-mek' && !missile.location.transferred
                ? [missile.location.locationId] : [])) });
    }
    if (CONVENTIONAL_FIGHTERS.has(entity.entityType)) {
        return Object.freeze({ kind: 'structural-integrity', damage: everyThird });
    }
    return NO_EFFECT;
}

/** Whether the effect counts sets of three over the turn, so the unit keeps a total of the missiles that struck it. */
export function infernoEffectCountsTurn(effect: InfernoEffect): boolean {
    return effect.kind === 'battle-armor-troopers' || effect.kind === 'protomek-locations'
        || effect.kind === 'structural-integrity';
}

/** The effect as the struck unit's player reads it. */
export function infernoEffectText(effect: InfernoEffect): string {
    switch (effect.kind) {
        case 'heat': return `+${effect.heat} outside heat`;
        case 'troopers': return `${effect.troopers} troopers eliminated`;
        case 'battle-armor-troopers': return `${effect.troopers} random trooper${effect.troopers === 1 ? '' : 's'} eliminated`;
        case 'vehicle-criticals': return `${effect.locationIds.length} critical roll${effect.locationIds.length === 1 ? '' : 's'}`;
        case 'protomek-locations': return `${effect.locationIds.length} location${effect.locationIds.length === 1 ? '' : 's'} destroyed`;
        case 'structural-integrity': return `${effect.damage} structural integrity`;
        case 'none': return 'No effect';
    }
}
