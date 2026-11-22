// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import {
    mekHitLocationTable,
    mekPhysicalLocationRows,
    type MekHitArc,
} from '../../utils/record-sheet-reference-table';
import type { ArmorFaceId, LocationId } from '../entity/entity-identifiers';
import type { CBTRuleset } from '../cbt-ruleset.model';
import { attackDamageSource, reflectedHeat, resolveArmorDamage, rifleHitDamage, struckOutsideHeat, type DamageSource } from '../rules/armor-damage-rules';
import type { TnTargetUnitType } from '../target-number-calculator.model';
import type { CBTRuntimeArmorFace, CBTUnitRuntimeIndex } from './cbt-unit-runtime';
import type { AeroCriticalType } from '../rules/aero-critical-rules';
import { getMekLocationParent, getTopologyFor, isMekLegLocation, MEK_TORSO_LOCATIONS } from '../entity/types/mek';
import { structureConstructionKind } from '../construction-equipment.model';
import { isMekEntity, isProtoMekEntity } from '../entity/utils/entity-type-guards';
import type { CBTForceMember } from '../force-member.model';
import type { HitTable } from '../rules/physical-attack-rules';
import { damageGroups, PLATOON_DAMAGE_GROUP, type HitLocationDice, type TwoDice } from '../rules/weapon-attack-resolution';
import { getMekLocationLabel } from '../entity/types/mek';
import { compositeStructurePipCarries, resolveMekHitLocation, resolveMekStructureDamage } from './mek-fall-rules';
import { INFERNO_HEAT_PER_MISSILE, type InfernoMissile } from '../rules/inferno-rules';
import { aimedShotStrikes, type AimedShotRoll } from '../rules/aimed-shot-rules';
import { swarmHitLocation } from '../rules/anti-mek-attack-rules';
import { isVehicleEntity } from '../entity/utils/entity-type-guards';
import type { AttackHitGroup, AttackWeaponReport } from '../../services/game-events.service';
import type { MekEntity } from '../entity/entities/mek/mek-entity';
import { roll2D6, rollD6, twoD6Total } from './mek-automation-rules';
import { targetMekConfig } from './aimed-shot-choices';
import type { BaseEntity } from '../entity/base-entity';
import { hasMekRuntime, hasNonMekRuntime, type CBTUnitSnapshot } from '../cbt-unit-snapshot';
import { isModularArmorEquipment } from '../modular-armor.model';
import type { MekRuntimeIndex } from './mek-runtime-index';
import type { MekUnitQueryPort } from './unit-instance';
import {
    nonMekHitArcs,
    resolveNonMekHitLocation,
    type NonMekHitArc,
    type NonMekHitEffect,
} from './non-mek-hit-location';

export type AttackHitLocation =
    | Readonly<{ kind: 'miss'; label: string }>
    | Readonly<{ kind: 'mek'; label: string; location: string; rear: boolean; throughArmorCritical: boolean; floatingCritical?: true }>
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

/** A unit whose armor can reduce outside heat: heat-dissipating, or laser-reflective under TW (`reflectedHeat`). */
function hasHeatReducingArmor(snapshot: CBTUnitSnapshot | null): snapshot is CBTUnitSnapshot {
    return snapshot !== null
        && [...snapshot.entity.armorByLocation().values()].some(armor => armor.type === 'HEAT_DISSIPATING' || armor.type === 'REFLECTIVE');
}

type WeaponLocationTable = Pick<AttackWeaponReport, 'arc' | 'aim'> & { readonly partialCover?: boolean; readonly table?: HitTable };
type LocationRoll = Omit<AttackHitGroup, 'damage'>;

export function weaponHitLocation(
    member: CBTForceMember,
    arc: MekHitArc,
    weapon: WeaponLocationTable,
    group: LocationRoll,
): AttackHitLocation | null {
    return readAttackHitLocation(member, weapon.arc ?? arc, group.location, group.aux,
        weapon.partialCover === true, weapon.table, weapon.aim, group.floating);
}

/** Reroll covered legs, accept a second 2 as a torso hit (Core p. 95, TO:AR p. 75). */
export function rollFloatingMekHitLocation(entity: Pick<MekEntity, 'chassisConfig'>, arc: MekHitArc, partialCover = false, aux?: number) {
    const table = mekHitLocationTable(entity);
    for (;;) {
        const dice = roll2D6();
        let result = resolveMekHitLocation(table, arc, 2, aux, twoD6Total(dice));
        if (partialCover && (result.location === null || isMekLegLocation(entity.chassisConfig, result.location))) continue;
        if (result.location === null) result = resolveMekHitLocation(table, arc, 2, rollD6(), twoD6Total(dice));
        return { dice, result };
    }
}

/** Record a qualifying shot's reroll once, for previews and delivery. A successful aimed shot bypasses the table. */
export function rollFloatingCriticals<T extends LocationRoll>(member: CBTForceMember | null, arc: MekHitArc,
    weapon: WeaponLocationTable, groups: readonly T[], unitType?: TnTargetUnitType): readonly T[] {
    const chassis = member ? (isMekEntity(member.entity) ? member.entity : null)
        : unitType && !unitType.startsWith('mek-') ? null : { chassisConfig: targetMekConfig(unitType) };
    if (!chassis || (weapon.table ?? 'standard') !== 'standard') return groups;
    const direction = weapon.arc ?? arc;
    const aimed = weapon.aim && aimedShotStrikes(weapon.aim.roll) && (!member || readAimedLocation(member, direction, weapon.aim.location));
    return groups.map(group => {
        const hit = !aimed && group.location.length === 2
            ? standardMekTableHit(chassis, direction, twoD6Total(group.location), group.aux, weapon.aim) : null;
        if (!hit?.throughArmorCritical) return group.floating ? { ...group, floating: undefined } : group;
        if (group.floating) return group;
        const cover = weapon.partialCover || weapon.aim?.rerolls !== undefined;
        const { dice } = rollFloatingMekHitLocation(chassis, direction, cover, group.aux);
        return { ...group, floating: dice };
    });
}

/** A missed aimed shot in partial cover rerolls legs (Core p. 70). */
function standardMekTableHit(chassis: Pick<MekEntity, 'chassisConfig'>, arc: MekHitArc,
    total: number, aux: number, aim?: AimedShotRoll) {
    const table = mekHitLocationTable(chassis);
    const initial = resolveMekHitLocation(table, arc, total, aux);
    if (!aim?.rerolls || (initial.location && !isMekLegLocation(chassis.chassisConfig, initial.location))) return initial;
    for (const dice of aim.rerolls) {
        const reroll = resolveMekHitLocation(table, arc, twoD6Total(dice), aux);
        if (reroll.location && !isMekLegLocation(chassis.chassisConfig, reroll.location)) return reroll;
    }
    return null;
}

/**
 * Where one weapon's outside heat strikes, as rolled: every inferno missile; a heat-causing weapon's first hit (a
 * first roll into partial cover delivers none, TW p. 102); or each 2-point group of a platoon, with its share of the
 * heat (TW p. 215; MegaMek InfantryHeatWeaponHandler). A null location is heat without a hit location.
 */
export function attackHeatHits(
    member: CBTForceMember,
    arc: MekHitArc,
    weapon: AttackWeaponReport,
): readonly Readonly<{ location: AttackHitLocation | null; heat: number }>[] {
    if (weapon.inferno) {
        return weapon.groups.map(group => ({ location: weaponHitLocation(member, arc, weapon, group), heat: INFERNO_HEAT_PER_MISSILE }));
    }
    if (!weapon.heat) return [];
    if (!weapon.groups.length) return [{ location: null, heat: weapon.heat }];
    // Only a platoon's heat comes in several groups; a weapon's heat rides its single hit.
    const shares = weapon.groups.length > 1 ? damageGroups(weapon.heat, PLATOON_DAMAGE_GROUP) : [weapon.heat];
    return weapon.groups.map((group, index) => ({ location: weaponHitLocation(member, arc, weapon, group), heat: shares[index] ?? 0 }));
}

/**
 * Previews an attack's heat and inferno missiles in weapon order. Each weapon's heat strikes before its damage, past
 * the destroyed locations the attack's earlier hits leave, and meets the armor there as the hit is applied
 * (`struckOutsideHeat`, Core p. 201).
 */
export function readAttackThermalEffects(
    member: CBTForceMember,
    arc: MekHitArc,
    weapons: readonly AttackWeaponReport[],
    ledger = attackDamageLedger(),
): { heat: number; inferno: InfernoMissile[] } {
    let heat = 0;
    const inferno: InfernoMissile[] = [];
    if (!weapons.some(weapon => weapon.heat || weapon.inferno)) return { heat, inferno };
    const snapshot = member.force.getUnitSnapshot(member.id);
    const reducing = hasHeatReducingArmor(snapshot) ? snapshot : null;
    const protectedUnit = reducing && hasMekRuntime(reducing) ? reducing : null;
    const armorLeft = (faceId: ArmorFaceId) => ledger.armor.get(faceId) ?? snapshot!.query.remainingArmor(faceId, 'preview');
    const destroyed = (locationId: LocationId) => !!protectedUnit && (destroyedByLedger(protectedUnit.index, ledger, locationId)
        || protectedUnit.query.locationStatus(locationId, 'preview') === 'destroyed');
    // A heat-tracking non-Mek takes heat where it strikes, which laser-reflective armor there may halve.
    const nonMekHeat = (amount: number, locationId: LocationId, source: DamageSource) => {
        const face = snapshot && struckArmorFace(snapshot.index, locationId, false);
        const code = snapshot?.index.locations.get(locationId)?.code;
        return face && code && armorLeft(face.id) > 0
            ? reflectedHeat(snapshot!.ruleset, snapshot!.entity.armorAt(code).type, source, amount) : amount;
    };
    const deal = reducing ? attackDamagePreview(member, reducing.ruleset, undefined, ledger) : null;
    const missile = (location: AttackHitLocation | null, sent: number, delivered: number): InfernoMissile =>
        ({ location, ...(delivered === sent ? {} : { heat: delivered }) });
    for (const weapon of weapons) {
        for (const hit of attackHeatHits(member, arc, weapon)) {
            if (hit.location?.kind === 'miss') {
                if (weapon.inferno) inferno.push(missile(hit.location, hit.heat, 0));
                continue;
            }
            if (hit.location?.kind === 'non-mek') {
                const delivered = nonMekHeat(hit.heat, hit.location.locationId, attackDamageSource(weapon));
                if (weapon.inferno) inferno.push(missile(hit.location, hit.heat, delivered));
                else heat += delivered;
                continue;
            }
            const delivered = protectedUnit
                ? struckOutsideHeat(protectedUnit, hit.heat, hit.location ? { code: hit.location.location, rear: hit.location.rear } : null,
                    face => armorLeft(face.id), destroyed, attackDamageSource(weapon))
                : hit.heat;
            if (weapon.inferno) inferno.push(missile(hit.location, hit.heat, delivered));
            else heat += delivered;
        }
        if (!deal || weapon.inferno) continue;
        for (const group of weapon.groups) {
            const location = weaponHitLocation(member, arc, weapon, group);
            if (group.damage && location && location.kind !== 'miss') deal(location, group.damage, attackDamageSource(weapon));
        }
    }
    return { heat, inferno };
}

/** Inferno missiles that already struck the unit this turn, for the every-three effects (TW pp. 141-142). */
export function infernoMissilesThisTurn(snapshot: CBTUnitSnapshot | null): number {
    return snapshot !== null && hasNonMekRuntime(snapshot)
        ? (snapshot.state.turn.infernoMissiles ?? 0) + (snapshot.state.pendingCombat.infernoMissiles ?? 0)
        : 0;
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
    floating?: TwoDice,
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
        const initial = standardMekTableHit(entity, arc, total, aux, aim);
        if (!initial) return readAimedLocation(member, arc, aim!.location);
        const floated = initial.throughArmorCritical && floating !== undefined;
        const result = floated
            ? resolveMekHitLocation(mekHitLocationTable(entity), arc, initial.hitLocationRoll, aux, twoD6Total(floating))
            : initial;
        if (!result.location) return null;
        // TW and Core p.66: a leg hit on a 'Mech in partial cover strikes the cover instead.
        if (partialCover && entity.locationIsLeg(result.location)) return Object.freeze({ kind: 'miss', label: 'Cover' });
        const rear = result.rear && MEK_TORSO_LOCATIONS.has(result.location);
        return Object.freeze({
            kind: 'mek',
            label: `${result.locationLabel ?? result.location}${rear ? ' (rear)' : ''}`
                + (initial.hitLocationRoll === total ? '' : ' (leg rerolled)'),
            location: result.location,
            rear: result.rear,
            throughArmorCritical: result.throughArmorCritical,
            ...(floated ? { floatingCritical: true as const } : {}),
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

/** The armor, modular armor and structure an attack's earlier hits leave, read in the order the struck unit takes them. */
export interface AttackDamageLedger {
    readonly armor: Map<ArmorFaceId, number>;
    readonly internal: Map<LocationId, number>;
    readonly modular: Map<LocationId, number>;
}

export function attackDamageLedger(from?: AttackDamageLedger): AttackDamageLedger {
    return { armor: new Map(from?.armor), internal: new Map(from?.internal), modular: new Map(from?.modular) };
}

/** Modular armor points left on a Mek location's panels, which take a hit before the location's armor. */
export function modularArmorAt(
    snapshot: Readonly<{ index: MekRuntimeIndex; query: Pick<MekUnitQueryPort, 'modularArmorRemaining'> }>,
    locationId: LocationId,
    perspective: 'committed' | 'preview',
): number {
    return [...snapshot.index.components].filter(([componentId, component]) => component.kind === 'equipment'
        && isModularArmorEquipment(component.mount.equipment)
        && [...snapshot.index.slots.values()].some(slot => slot.locationId === locationId && slot.componentIds.includes(componentId)))
        .reduce((sum, [componentId]) => sum + snapshot.query.modularArmorRemaining(componentId, perspective), 0);
}

/** A location the attack's earlier hits destroyed, or a limb lost with the side torso it hangs from. */
function destroyedByLedger(index: CBTUnitRuntimeIndex, ledger: AttackDamageLedger, locationId: LocationId): boolean {
    const sections = [...index.locations.values()];
    const parent = getMekLocationParent(sections.map(section => section.code), index.locations.get(locationId)?.code ?? '');
    const parentId = parent ? sections.find(section => section.code === parent)?.id : undefined;
    return ledger.internal.get(locationId) === 0 || (parentId !== undefined && ledger.internal.get(parentId) === 0);
}

/**
 * Previews what an attack's hits deal to the struck unit, read in the order they are applied: a rifle hit loses 3
 * points where it strikes (`rifleHitDamage`), against the armor the attack's earlier hits leave on that face. A Mek
 * hit takes modular armor panels first and goes on through structure and inward past destroyed locations (Core,
 * Transferring Damage). Hits that strike swarming infantry instead are not followed; the hits as applied always are.
 */
export function attackDamagePreview(
    member: CBTForceMember | null,
    ruleset: CBTRuleset,
    unitType?: TnTargetUnitType,
    ledger = attackDamageLedger(),
): (location: AttackHitLocation | null, damage: number, source: DamageSource) => number {
    const snapshot = member?.force.getUnitSnapshot(member.id) ?? null;
    return (location, damage, source) => {
        const rifle = source.kind === 'weapon' && source.rifle === true;
        if (!snapshot) return rifle ? rifleHitDamage(ruleset, damage, { unitType }) : damage;
        const sections = [...snapshot.index.locations.values()];
        const struck = location?.kind === 'mek'
            ? sections.find(candidate => candidate.code === location.location)
            : location?.kind === 'non-mek' ? snapshot.index.locations.get(location.locationId) : undefined;
        if (!struck) return damage;
        const rear = (section: typeof struck) => location?.kind === 'mek' && location.rear && MEK_TORSO_LOCATIONS.has(section.code);
        const face = struckArmorFace(snapshot.index, struck.id, rear(struck));
        if (!face) return damage;
        const armorOf = (faceId: ArmorFaceId) => ledger.armor.get(faceId) ?? snapshot.query.remainingArmor(faceId, 'preview');
        const dealt = rifle
            ? rifleHitDamage(snapshot.ruleset, damage, { entity: snapshot.entity, location: struck.code, armor: armorOf(face.id) })
            : damage;
        const topology = location?.kind === 'mek' ? getTopologyFor(sections.map(section => section.code)) : undefined;
        // When a hit destroys a ProtoMek limb, later damage to it reaches the torso.
        const protoTorso = isProtoMekEntity(snapshot.entity) ? sections.find(section => section.code === 'Torso') : undefined;
        const internalOf = (locationId: LocationId) => ledger.internal.get(locationId) ?? snapshot.query.remainingInternal(locationId, 'preview');
        const kindOf = (code: string) => {
            const kind = structureConstructionKind(snapshot.entity.structureAt(code).structure);
            return kind === 'composite' || kind === 'reinforced' ? kind : 'standard';
        };
        const mek = hasMekRuntime(snapshot) ? snapshot : null;
        const modularOf = (locationId: LocationId) => ledger.modular.get(locationId) ?? (mek ? modularArmorAt(mek, locationId, 'preview') : 0);
        const destroyed = (id: LocationId) => destroyedByLedger(snapshot.index, ledger, id)
            || mek?.query.locationStatus(id, 'preview') === 'destroyed';
        // The next location can take a shared composite pip while its structure stands bare.
        const bareComposite = (candidate: typeof struck | undefined) => {
            const candidateFace = candidate && struckArmorFace(snapshot.index, candidate.id, rear(candidate));
            return !!candidate && !!candidateFace && kindOf(candidate.code) === 'composite' && armorOf(candidateFace.id) === 0
                && modularOf(candidate.id) === 0 && internalOf(candidate.id) > 0 && !destroyed(candidate.id);
        };
        let section: typeof struck | undefined = struck;
        let remaining = dealt;
        let sharedPip = false;
        while (section && (remaining > 0 || sharedPip)) {
            const sectionFace = struckArmorFace(snapshot.index, section.id, rear(section));
            if (!sectionFace) break;
            const next: string | null | undefined = topology?.[section.code as keyof typeof topology]?.transfersTo;
            const nextSection: typeof struck | undefined = next ? sections.find(candidate => candidate.code === next)
                : section !== protoTorso ? protoTorso : undefined;
            // A limb that went with its side torso earlier in the attack passes the whole hit on.
            if (!(topology && destroyed(section.id)) && !(protoTorso && internalOf(section.id) === 0)) {
                // Modular armor panels take the hit before the location's armor, as applying the damage does.
                if (topology && remaining > 0) {
                    const modular = modularOf(section.id);
                    const absorbed = Math.min(remaining, modular);
                    ledger.modular.set(section.id, modular - absorbed);
                    remaining -= absorbed;
                }
                const armor = armorOf(sectionFace.id);
                const resolved = resolveArmorDamage(snapshot.ruleset, remaining, armor, snapshot.entity.armorAt(section.code).type,
                    source, snapshot.entity);
                ledger.armor.set(sectionFace.id, armor - resolved.armorDamage);
                if (!topology && !protoTorso) break;
                const internal = internalOf(section.id);
                const received: boolean = sharedPip;
                const shared: number = received && internal > 0 ? 1 : 0;
                const kind = topology ? kindOf(section.code) : 'standard';
                const structure = resolveMekStructureDamage(resolved.remainingDamage, internal - shared, kind);
                const internalDamage: number = shared + structure.internalDamage;
                ledger.internal.set(section.id, internal - internalDamage);
                remaining = structure.overflowDamage;
                sharedPip = !received && compositeStructurePipCarries(snapshot.ruleset, kind, resolved.remainingDamage, internal, internalDamage)
                    && bareComposite(nextSection);
            }
            section = nextSection;
        }
        return dealt;
    };
}
