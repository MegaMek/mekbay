// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import {
    mekHitLocationTable,
    mekPhysicalLocationRows,
    type MekHitArc,
} from '../../utils/record-sheet-reference-table';
import type { ArmorFaceId, LocationId } from '../entity/entity-identifiers';
import type { CBTRuleset } from '../cbt-ruleset.model';
import { resolveArmorDamage, rifleHitDamage, type DamageSource } from '../rules/armor-damage-rules';
import type { TnTargetUnitType } from '../target-number-calculator.model';
import type { CBTRuntimeArmorFace, CBTUnitRuntimeIndex } from './cbt-unit-runtime';
import type { AeroCriticalType } from '../rules/aero-critical-rules';
import { MEK_TORSO_LOCATIONS } from '../entity/types/mek';
import { isMekEntity } from '../entity/utils/entity-type-guards';
import type { CBTForceMember } from '../force-member.model';
import type { HitTable } from '../rules/physical-attack-rules';
import type { HitLocationDice } from '../rules/weapon-attack-resolution';
import { getMekLocationLabel } from '../entity/types/mek';
import { resolveMekHitLocation } from './mek-fall-rules';
import type { InfernoMissile } from '../rules/inferno-rules';
import { aimedShotStrikes, type AimedShotRoll } from '../rules/aimed-shot-rules';
import { swarmHitLocation } from '../rules/anti-mek-attack-rules';
import { isVehicleEntity } from '../entity/utils/entity-type-guards';
import type { BaseEntity } from '../entity/base-entity';
import { hasNonMekRuntime, type CBTUnitSnapshot } from '../cbt-unit-snapshot';
import {
    nonMekHitArcs,
    resolveNonMekHitLocation,
    type NonMekHitArc,
    type NonMekHitEffect,
} from './non-mek-hit-location';

export type AttackHitLocation =
    | Readonly<{ kind: 'miss'; label: string }>
    | Readonly<{ kind: 'mek'; label: string; location: string; rear: boolean; throughArmorCritical: boolean }>
    | Readonly<{
        kind: 'non-mek';
        label: string;
        locationId: LocationId;
        /** The arc on the unit's own table (six-sided vehicles have quarters). */
        arc: NonMekHitArc;
        effects: readonly NonMekHitEffect[];
        aeroCritical?: AeroCriticalType;
        /** The roll named a destroyed or absent location, and the hit transfers here. */
        transferred?: true;
    }>;

/**
 * The outside heat an attack's heat-causing weapons apply: a weapon whose first hit-location roll strikes partial
 * cover delivers none (TW p. 102). The rules are silent on a hit split over several rolls, such as a flamer
 * platoon's; its heat follows the first roll.
 */
export function readAttackHeat(
    member: CBTForceMember,
    arc: MekHitArc,
    weapons: readonly Readonly<{
        heat?: number;
        arc?: MekHitArc;
        partialCover?: true;
        table?: HitTable;
        groups: readonly Readonly<{ location: HitLocationDice; aux: number }>[];
    }>[],
): number {
    return weapons.reduce((sum, weapon) => {
        const first = weapon.groups[0];
        const location = first === undefined ? null : readAttackHitLocation(member, weapon.arc ?? arc, first.location,
            first.aux, weapon.partialCover === true, weapon.table);
        return location?.kind === 'miss' ? sum : sum + (weapon.heat ?? 0);
    }, 0);
}

/** Inferno missiles that already struck the unit this turn, for the every-three effects (TW pp. 141-142). */
export function infernoMissilesThisTurn(snapshot: CBTUnitSnapshot | null): number {
    return snapshot !== null && hasNonMekRuntime(snapshot)
        ? (snapshot.state.turn.infernoMissiles ?? 0) + (snapshot.state.pendingCombat.infernoMissiles ?? 0)
        : 0;
}

/** The inferno missiles of an attack's weapons, each read on the struck unit's own table. */
export function readInfernoMissiles(
    member: CBTForceMember,
    arc: MekHitArc,
    weapons: readonly Readonly<{
        inferno?: true;
        noHitLocation?: true;
        arc?: MekHitArc;
        partialCover?: true;
        table?: HitTable;
        groups: readonly Readonly<{ location: HitLocationDice; aux: number }>[];
    }>[],
): readonly InfernoMissile[] {
    return Object.freeze(weapons.filter(weapon => weapon.inferno).flatMap(weapon => weapon.groups.map(group =>
        Object.freeze({
            location: weapon.noHitLocation ? null : readAttackHitLocation(member, weapon.arc ?? arc, group.location,
                group.aux, weapon.partialCover === true, weapon.table),
        }))));
}

/** One location an aimed shot may name, with what is left of it on the side the attack strikes. */
export interface AimedShotLocation {
    readonly code: string;
    readonly label: string;
    /** Armor left on the struck face (a torso's rear armor from behind). */
    readonly armor: number;
    /** The struck face is the location's rear armor. */
    readonly rearFace: boolean;
    /** Armor left on the front face. */
    readonly frontArmor: number;
    readonly structure: number;
    readonly destroyed: boolean;
}

/**
 * The locations of a unit an aimed shot from this direction may name, as the unit stands now: every location of a
 * 'Mech, and on a vehicle those its hit-location table gives that direction, so never the far side or the body
 * (TW p. 110 names no vehicle locations; this is MegaMek's reading). Other units have none.
 */
export function aimedShotLocations(member: CBTForceMember, arc: MekHitArc): readonly AimedShotLocation[] {
    const entity = member.entity;
    if (isMekEntity(entity)) {
        return Object.freeze((member.mekRecordSheetSnapshot()?.locations ?? []).map(location => {
            const rear = arc === 'rear' && MEK_TORSO_LOCATIONS.has(location.code);
            const armor = (face: 'front' | 'rear') =>
                location.armor.find(candidate => candidate.face === face)?.previewRemaining ?? 0;
            return Object.freeze({
                code: location.code,
                label: getMekLocationLabel(location.code) ?? location.code,
                armor: armor(rear ? 'rear' : 'front'),
                rearFace: rear,
                frontArmor: armor('front'),
                structure: location.previewRemainingInternal,
                destroyed: location.previewStructurallyDestroyed || location.previewDetached,
            });
        }));
    }
    const snapshot = member.nonMekRecordSheetSnapshot();
    if (!snapshot || !isVehicleEntity(entity)) return Object.freeze([]);
    const hitArc = nonMekHitArc(entity, arc);
    const struck = new Set<string>();
    for (let roll = 2; roll <= 12; roll++) {
        for (let aux = 1; aux <= 6; aux++) {
            const code = resolveNonMekHitLocation(entity, snapshot, hitArc, roll, () => aux)?.locationCode;
            if (code !== undefined) struck.add(code);
        }
    }
    return Object.freeze(snapshot.locations.filter(location => struck.has(location.sheetCode)).map(location => {
        const armor = location.armor.find(face => face.face === 'front')?.previewRemaining ?? 0;
        return Object.freeze({
            code: location.sheetCode,
            label: location.sheetCode,
            armor,
            rearFace: false,
            frontArmor: armor,
            structure: location.previewRemainingInternal,
            destroyed: location.previewRemainingInternal === 0,
        });
    }));
}

/** The attacker records four directions; six-sided vehicles take side attacks on their front quarters. */
function nonMekHitArc(entity: BaseEntity, arc: MekHitArc): NonMekHitArc {
    const sixArcs = nonMekHitArcs(entity).length === 6;
    return sixArcs && arc === 'left' ? 'front-left' : sixArcs && arc === 'right' ? 'front-right' : arc;
}

/** The named location of an aimed shot that strikes it; null when the unit has no such location to aim at. */
function readAimedLocation(member: CBTForceMember, arc: MekHitArc, code: string): AttackHitLocation | null {
    const entity = member.entity;
    if (isMekEntity(entity)) {
        if (!entity.locationOrder.some(location => location === code)) return null;
        const rear = arc === 'rear' && MEK_TORSO_LOCATIONS.has(code);
        return Object.freeze({
            kind: 'mek',
            label: `${getMekLocationLabel(code) ?? code}${rear ? ' (rear)' : ''}`,
            location: code,
            rear: arc === 'rear',
            throughArmorCritical: false,
        });
    }
    const location = aimedShotLocations(member, arc).find(candidate => candidate.code === code);
    if (!location) return null;
    const locationId = member.nonMekRecordSheetSnapshot()?.locations.find(candidate => candidate.sheetCode === code)
        ?.locationId;
    // The named location is struck without its table roll, so without that roll's critical or motive effect.
    return locationId === undefined ? null : Object.freeze({
        kind: 'non-mek', label: location.label, locationId, arc: nonMekHitArc(entity, arc), effects: Object.freeze([]),
    });
}

/**
 * Reads one hit-location roll on the struck unit's own table, as the unit stands now. Null when this unit has
 * no hit-location table here (infantry and battle armor allocate damage by trooper). An aimed shot strikes the
 * location it names when its own roll says so, and is read on the table otherwise.
 */
export function readAttackHitLocation(
    member: CBTForceMember,
    arc: MekHitArc,
    roll: HitLocationDice,
    aux: number,
    partialCover = false,
    table: HitTable = 'standard',
    aim?: AimedShotRoll,
): AttackHitLocation | null {
    const total = roll.reduce((sum: number, die) => sum + die, 0);
    const entity = member.entity;
    const aimed = aim !== undefined && aimedShotStrikes(aim.roll) ? readAimedLocation(member, arc, aim.location) : null;
    if (aimed) return aimed;
    if (isMekEntity(entity) && table === 'swarm') {
        // Swarming infantry strikes where it clings, whatever side the attack is recorded from (TW p. 222).
        const hit = swarmHitLocation(mekHitLocationTable(entity) === 'quad', total);
        return Object.freeze({
            kind: 'mek',
            label: `${getMekLocationLabel(hit.location) ?? hit.location}${hit.rear ? ' (rear)' : ''}`,
            location: hit.location,
            rear: hit.rear,
            throughArmorCritical: false,
        });
    }
    if (isMekEntity(entity) && (table === 'punch' || table === 'kick')) {
        const ruleset = member.force.getUnitSnapshot(member.id)?.ruleset;
        if (!ruleset) return null;
        // Quad and tripod cells may name the front or rear leg pair.
        const row = mekPhysicalLocationRows(mekHitLocationTable(entity), ruleset).find(candidate => candidate.roll === total);
        if (!row) return null;
        const cell = row[`${table}${arc === 'left' ? 'LeftSide' : arc === 'right' ? 'RightSide' : 'FrontRear'}`];
        const [front, rear = front] = cell.split('/');
        const location = arc === 'rear' ? rear! : front!;
        const rearArmor = arc === 'rear' && MEK_TORSO_LOCATIONS.has(location);
        return Object.freeze({
            kind: 'mek',
            label: `${getMekLocationLabel(location) ?? location}${rearArmor ? ' (rear)' : ''}`,
            location,
            rear: arc === 'rear',
            throughArmorCritical: false,
        });
    }
    if (isMekEntity(entity)) {
        // An aimed shot at a 'Mech in partial cover rerolls a leg result until another location comes up
        // (Core p. 70); should every roll made ahead be a leg, the shot strikes the location it named.
        const results = [total, ...(aim?.rerolls ?? []).map(dice => dice[0] + dice[1])]
            .map(candidate => resolveMekHitLocation(mekHitLocationTable(entity), arc, candidate, aux));
        const result = aim?.rerolls === undefined
            ? results[0]
            : results.find(candidate => candidate.location && !entity.locationIsLeg(candidate.location));
        if (!result) return readAimedLocation(member, arc, aim!.location);
        if (!result.location) return null;
        // TW and Core p.66: a leg hit on a 'Mech in partial cover strikes the cover instead.
        if (partialCover && entity.locationIsLeg(result.location)) return Object.freeze({ kind: 'miss', label: 'Cover' });
        const rear = result.rear && MEK_TORSO_LOCATIONS.has(result.location);
        return Object.freeze({
            kind: 'mek',
            label: `${result.locationLabel ?? result.location}${rear ? ' (rear)' : ''}`
                + (result === results[0] ? '' : ' (leg rerolled)'),
            location: result.location,
            rear: result.rear,
            throughArmorCritical: result.throughArmorCritical,
        });
    }
    const snapshot = member.nonMekRecordSheetSnapshot();
    if (!snapshot) return null;
    const nonMekArc = nonMekHitArc(entity, arc);
    const result = resolveNonMekHitLocation(entity, snapshot, nonMekArc, total, () => aux);
    if (!result) return null;
    if (result.locationCode === 'MISS') return Object.freeze({ kind: 'miss', label: 'Miss' });
    const location = snapshot.locations.find(candidate => candidate.sheetCode === result.locationCode);
    if (!location) return null;
    const effects = result.effects ?? [];
    const marker = effects.includes('critical') ? ' · critical' : effects.includes('motive') ? ' · motive' : '';
    return Object.freeze({
        kind: 'non-mek',
        label: (result.transferredFrom ? `${location.sheetCode} (from ${result.transferredFrom})` : location.sheetCode)
            + marker,
        locationId: location.locationId,
        arc: nonMekArc,
        effects,
        ...(result.aeroCritical === undefined ? {} : { aeroCritical: result.aeroCritical }),
        ...(result.transferredFrom ? { transferred: true as const } : {}),
    });
}

/** The armor face a hit on this location strikes: a torso's rear from behind, otherwise the front or only face. */
export function struckArmorFace(
    index: CBTUnitRuntimeIndex,
    locationId: LocationId,
    rear: boolean,
): CBTRuntimeArmorFace | undefined {
    const faces = (index.locations.get(locationId)?.armorFaceIds ?? []).map(faceId => index.armorFaces.get(faceId));
    return faces.find(face => face?.face === (rear ? 'rear' : 'front')) ?? (rear ? undefined : faces[0]);
}

/**
 * Previews what an attack's hits deal to the struck unit, read in the order they are applied: a rifle hit loses 3
 * points where it strikes (`rifleHitDamage`), against the armor the attack's earlier hits leave on that face. Damage
 * moving on from a destroyed location, modular armor, and hits that strike swarming infantry instead are not followed;
 * the hits as applied always are.
 */
export function attackDamagePreview(
    member: CBTForceMember | null,
    ruleset: CBTRuleset,
    unitType?: TnTargetUnitType,
): (location: AttackHitLocation | null, damage: number, source: DamageSource) => number {
    const snapshot = member?.force.getUnitSnapshot(member.id) ?? null;
    const armorLeft = new Map<ArmorFaceId, number>();
    return (location, damage, source) => {
        const rifle = source.kind === 'weapon' && source.rifle === true;
        if (!snapshot) return rifle ? rifleHitDamage(ruleset, damage, { unitType }) : damage;
        const struck = location?.kind === 'mek'
            ? [...snapshot.index.locations.values()].find(candidate => candidate.code === location.location)
            : location?.kind === 'non-mek' ? snapshot.index.locations.get(location.locationId) : undefined;
        if (!struck) return damage;
        const face = struckArmorFace(snapshot.index, struck.id,
            location?.kind === 'mek' && location.rear && MEK_TORSO_LOCATIONS.has(struck.code));
        if (!face) return damage;
        const armor = armorLeft.get(face.id) ?? snapshot.query.remainingArmor(face.id, 'preview');
        const dealt = rifle
            ? rifleHitDamage(snapshot.ruleset, damage, { entity: snapshot.entity, location: struck.code, armor })
            : damage;
        armorLeft.set(face.id, armor - resolveArmorDamage(snapshot.ruleset, dealt, armor,
            snapshot.entity.armorAt(struck.code).type, source).armorDamage);
        return dealt;
    };
}
