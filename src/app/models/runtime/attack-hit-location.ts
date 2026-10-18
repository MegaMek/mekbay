// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import {
    mekHitLocationTable,
    mekPhysicalLocationRows,
    type MekHitArc,
} from '../../utils/record-sheet-reference-table';
import type { LocationId } from '../entity/entity-identifiers';
import type { AeroCriticalType } from '../rules/aero-critical-rules';
import { MEK_TORSO_LOCATIONS } from '../entity/types/mek';
import { isMekEntity } from '../entity/utils/entity-type-guards';
import type { CBTForceMember } from '../force-member.model';
import type { HitTable } from '../rules/physical-attack-rules';
import type { HitLocationDice } from '../rules/weapon-attack-resolution';
import { getMekLocationLabel } from '../entity/types/mek';
import { resolveMekHitLocation } from './mek-fall-rules';
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
    }>;

/**
 * Reads one hit-location roll on the struck unit's own table, as the unit stands now. Null when this unit has
 * no hit-location table here (infantry and battle armor allocate damage by trooper).
 */
export function readAttackHitLocation(
    member: CBTForceMember,
    arc: MekHitArc,
    roll: HitLocationDice,
    aux: number,
    partialCover = false,
    table: HitTable = 'standard',
): AttackHitLocation | null {
    const total = roll.reduce((sum: number, die) => sum + die, 0);
    const entity = member.entity;
    if (isMekEntity(entity) && table !== 'standard') {
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
        const result = resolveMekHitLocation(mekHitLocationTable(entity), arc, total, aux);
        if (!result.location) return null;
        // TW and Core p.66: a leg hit on a 'Mech in partial cover strikes the cover instead.
        if (partialCover && entity.locationIsLeg(result.location)) return Object.freeze({ kind: 'miss', label: 'Cover' });
        const rear = result.rear && MEK_TORSO_LOCATIONS.has(result.location);
        return Object.freeze({
            kind: 'mek',
            label: `${result.locationLabel ?? result.location}${rear ? ' (rear)' : ''}`,
            location: result.location,
            rear: result.rear,
            throughArmorCritical: result.throughArmorCritical,
        });
    }
    const snapshot = member.nonMekRecordSheetSnapshot();
    if (!snapshot) return null;
    // The attacker records four directions; six-sided vehicles take side attacks on their front quarters.
    const sixArcs = nonMekHitArcs(entity).length === 6;
    const nonMekArc: NonMekHitArc = sixArcs && arc === 'left' ? 'front-left'
        : sixArcs && arc === 'right' ? 'front-right' : arc;
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
    });
}
