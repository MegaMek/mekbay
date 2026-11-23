// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import { isShelteringBuilding } from '../models/unit-cover.model';
import { isInfantryBuildingType, type InfantryBuildingType } from '../models/rules/infantry-building-damage';

import { Injectable, Injector, inject } from '@angular/core';
import { Subject } from 'rxjs';

import {
    hitTableDice,
    PHYSICAL_ATTACK_KINDS,
    type HitTable,
    type PhysicalAttackKind,
} from '../models/rules/physical-attack-rules';
import { AIMED_SHOT_LEG_REROLLS, type AimedShotRoll } from '../models/rules/aimed-shot-rules';
import type { ArmorSpecialAmmo } from '../models/rules/armor-damage-rules';
import type { HitLocationDice, TwoDice } from '../models/rules/weapon-attack-resolution';
import { battleArmorMissileColumns } from '../utils/cluster-hit-table';
import { INFANTRY_HIT_CLASSES, type InfantryHitClass } from '../models/rules/infantry-hit-damage';
import { WEAPON_TYPES, type WeaponType } from '../models/weapon-types.model';
import type { TnAttackDirection } from '../models/target-number-calculator.model';
import { ForceWorkspaceStateService } from './force-workspace-state.service';
import { LobbyService } from './lobby.service';
import { WsService } from './ws.service';

const MAX_TARGET_DISTANCE = 1000;
const MAX_ATTACK_ROWS = 64;
const MAX_DAMAGE = 1000;
const HIT_ARCS: readonly TnAttackDirection[] = ['front', 'left', 'right', 'rear', 'front-left', 'front-right', 'rear-left', 'rear-right', 'above', 'below'];

/** A player set the distance between their unit and an opposing unit. */
export interface TargetDistanceEvent {
    readonly kind: 'target-distance';
    readonly fromForce: string;
    readonly fromUnit: string;
    readonly toUnit: string;
    readonly distance: number;
}

/** One hit-location roll and the damage it carries; the defender reads the roll on its own table. */
export interface AttackHitGroup {
    /** CF absorbed by this group, including zero when the building can intercept a covered leg. */
    readonly buildingDamage?: number;
    /** Assigned locally by the recipient after reading its surviving troopers. */
    readonly trooperLocation?: string;
    /** Locally chosen hex/floor of a linked building. */
    readonly buildingLocation?: string;
    readonly damage: number;
    readonly location: HitLocationDice;
    /** The final floating hit-location roll after a possible through-armor critical (Core p. 95, TO:AR p. 75). */
    readonly floating?: TwoDice;
    /** The extra d6 some tables need (tripod legs, dual turrets). */
    readonly aux: number;
}

export interface MissileDefenseOutcome {
    readonly hits: number;
    readonly damage: readonly number[];
    readonly heat: number;
    readonly absorbed?: readonly number[];
}

export interface AttackWeaponReport {
    readonly strayBuildingDamage?: number;
    readonly shelteringBuilding?: import('../models/unit-cover.model').ShelteringBuilding;
    readonly automaticBuildingHit?: true;
    /** A protected occupant's hit charged directly to the building hex's CF. */
    readonly cfHit?: true;
    readonly infantryClass?: InfantryHitClass;
    readonly infantryBuilding?: InfantryBuildingType;
    readonly collateralBuilding?: InfantryBuildingType;
    readonly infantryInOpen?: boolean;
    readonly infantryBurstDice?: number;
    readonly infantryDice?: readonly number[];
    readonly name: string;
    /** Weapon damage types, for armors that resist them. */
    readonly types: readonly WeaponType[];
    /** The target was in partial cover from this weapon: leg hits strike the cover. */
    readonly partialCover?: true;
    readonly targetNumber: number;
    readonly toHit: TwoDice;
    readonly cluster?: Readonly<{ dice: TwoDice; additionalDice?: readonly TwoDice[]; modifier: number; projectiles: number; hits: number }>;
    /** The table an attack's groups are read on (`hitTableDice`); otherwise the standard 2D6 table. */
    readonly table?: Exclude<HitTable, 'standard'>;
    /** A hit also rolls on the Determining Critical Hits Table: a leg attack, battle armor's swarm damage. */
    readonly critical?: true;
    /** A rifle: each hit loses 3 points where it strikes (`rifleHitDamage`). */
    readonly rifle?: true;
    readonly capitalScale?: true;
    /** Ammunition with a special effect on the armor struck. */
    readonly ammo?: ArmorSpecialAmmo;
    /** The size of the autocannon firing armor-piercing rounds, which sets its armor-piercing check. */
    readonly rackSize?: number;
    /**
     * The swarming infantry struck comes off the unit it swarms: a brush off that hits, or the infantry shaken off by
     * a jump, a fall or erratic manoeuvres.
     */
    readonly swarmRelease?: true;
    /**
     * A hit on the unit this infantry swarms that struck the infantry instead (TW p. 222): battle armor takes it on
     * `trooper` (from 1), a platoon as from infantry.
     */
    readonly swarmStrike?: Readonly<{ trooper?: number }>;
    /** A physical attack, whose outcome forces Piloting Skill Rolls on the struck Mek. */
    readonly physical?: PhysicalAttackKind;
    readonly mekPhysical?: true;
    readonly projectileDamage?: number;
    /** The column this attack strikes instead of the attack's direction (a DFA on a prone Mek or a vehicle). */
    readonly arc?: TnAttackDirection;
    /** Inferno missiles: each group is one missile whose effect the struck unit decides. */
    readonly inferno?: true;
    readonly narcPod?: true;
    readonly ams?: MissileDefenseOutcome & Readonly<{
        die: number;
        laser?: MissileDefenseOutcome;
        aerospace?: Readonly<{ av: number; groupSize: number; absorption: number }>;
    }>;
    /** Outside heat the weapon's hit applies to the struck unit. */
    readonly heat?: number;
    /** Each successful Battle Armor flamer carries this much outside heat to its own location. */
    readonly heatPerGroup?: number;
    /** The hit was an aimed shot: its one group strikes the named location when the aim roll says so. */
    readonly aim?: AimedShotRoll;
    readonly groups: readonly AttackHitGroup[];
}

/** A resolved weapon attack: the attacker's dice and outcome, for the defender to accept. */
export interface AttackEvent {
    readonly attackerUnderwater?: true;
    readonly kind: 'attack';
    readonly id: string;
    readonly fromForce: string;
    readonly fromUnit: string;
    readonly attacker: string;
    readonly toUnit: string;
    readonly turn: number;
    readonly arc: TnAttackDirection;
    readonly weapons: readonly AttackWeaponReport[];
}

/** The lobby host started the game over (the server relays it from the host only). */
export interface RestartEvent {
    readonly kind: 'restart';
}

export type GameEvent = TargetDistanceEvent | AttackEvent | RestartEvent;

export interface ReceivedGameEvent {
    /** The force (owned here) the event is addressed to. */
    readonly toForce: string;
    readonly event: GameEvent;
    /** Lobby display name of the sender; null when it came from a force open on this device. */
    readonly fromDisplayName: string | null;
}

/**
 * Delivers game events to the owner of a force: directly when that force is open and owned here,
 * otherwise through the lobby relay. Receivers apply events to their own forces only.
 */
@Injectable({ providedIn: 'root' })
export class GameEventsService {
    private readonly ws = inject(WsService);
    private readonly injector = inject(Injector);
    private readonly workspace = inject(ForceWorkspaceStateService);

    readonly received = new Subject<ReceivedGameEvent>();

    constructor() {
        this.ws.registerMessageHandler('lobbyEvent', msg => {
            const event = parseGameEvent(msg['event']);
            const toForce = msg['toInstanceId'];
            if (!event || typeof toForce !== 'string') return;
            this.received.next({
                toForce,
                event,
                fromDisplayName: typeof msg['fromDisplayName'] === 'string' ? msg['fromDisplayName'] : null,
            });
        });
    }

    /** Resolves whether the force's owner received the event. */
    async send(toForce: string, event: GameEvent): Promise<boolean> {
        const local = this.workspace.loadedForces().some(slot =>
            slot.force.instanceId() === toForce && !slot.force.readOnly());
        if (local) {
            // A local event passes the same validation a relayed one does.
            const parsed = parseGameEvent(event);
            if (parsed) queueMicrotask(() => this.received.next({ toForce, event: parsed, fromDisplayName: null }));
            return parsed !== null;
        }
        // Resolved on use: the lobby service depends on the force builder, which owns the OPFOR consumers.
        if (!this.injector.get(LobbyService).publisherOf(toForce)) return false;
        const reply = await this.ws.sendAndWaitForResponse(
            { action: 'relayLobbyEvent', toInstanceId: toForce, event },
            { suppressGlobalError: true },
        );
        return reply?.['action'] === 'lobbyEventRelayed' && Number(reply['delivered']) > 0;
    }
}

/** Lobby events come from other players' clients: accept only well-formed, bounded payloads. */
export function parseGameEvent(value: unknown): GameEvent | null {
    if (value === null || typeof value !== 'object' || Array.isArray(value)) return null;
    const record = value as Record<string, unknown>;
    if (record['kind'] === 'target-distance') {
        const { fromForce, fromUnit, toUnit, distance } = record;
        if (!isId(fromForce) || !isId(fromUnit) || !isId(toUnit) || !isInteger(distance, 0, MAX_TARGET_DISTANCE)) {
            return null;
        }
        return Object.freeze({ kind: 'target-distance', fromForce, fromUnit, toUnit, distance: distance as number });
    }
    if (record['kind'] === 'restart') return Object.freeze({ kind: 'restart' });
    if (record['kind'] === 'attack') {
        const { id, fromForce, fromUnit, attacker, toUnit, turn, arc, weapons, attackerUnderwater } = record;
        if (!isId(id) || !isId(fromForce) || !isId(fromUnit) || !isId(attacker) || !isId(toUnit)
            || (attackerUnderwater !== undefined && attackerUnderwater !== true)
            || !isInteger(turn, 0, 100_000) || !HIT_ARCS.includes(arc as TnAttackDirection)
            || !Array.isArray(weapons) || weapons.length > MAX_ATTACK_ROWS) {
            return null;
        }
        const reports = weapons.map(parseWeaponReport);
        if (reports.some(report => report === null)) return null;
        return Object.freeze({
            kind: 'attack', id, fromForce, fromUnit, attacker, toUnit, ...(attackerUnderwater === true ? { attackerUnderwater: true as const } : {}), turn: turn as number, arc: arc as TnAttackDirection,
            weapons: Object.freeze(reports as AttackWeaponReport[]),
        });
    }
    return null;
}

function parseWeaponReport(value: unknown): AttackWeaponReport | null {
    if (value === null || typeof value !== 'object' || Array.isArray(value)) return null;
    const {
        name, types, partialCover, targetNumber, toHit, cluster, table, physical, arc, inferno, heat, aim, infantryClass, infantryInOpen, infantryBurstDice, infantryDice,
        critical, rifle, capitalScale, ammo, rackSize, swarmRelease, swarmStrike, ams, narcPod, mekPhysical, projectileDamage, heatPerGroup, groups,
    } = value as Record<string, unknown>;
    const { infantryBuilding, collateralBuilding, shelteringBuilding, automaticBuildingHit, cfHit, strayBuildingDamage } = value as Record<string, unknown>;
    if (strayBuildingDamage !== undefined && (!isInteger(strayBuildingDamage, 1, MAX_DAMAGE) || cfHit || physical || inferno || narcPod)) return null;
    if (cfHit !== undefined && (cfHit !== true || shelteringBuilding !== undefined || automaticBuildingHit !== true)) return null;
    if (shelteringBuilding !== undefined && !isShelteringBuilding(shelteringBuilding)) return null;
    if (automaticBuildingHit !== undefined && (automaticBuildingHit !== true || targetNumber !== 2)) return null;
    if ((infantryBuilding !== undefined && !isInfantryBuildingType(infantryBuilding))
        || (collateralBuilding !== undefined && !isInfantryBuildingType(collateralBuilding))
        || (infantryBuilding && collateralBuilding)) return null;
    if (!isId(name) || !isInteger(targetNumber, -100, 100) || !isTwoDice(toHit)
        || !Array.isArray(types) || types.length > WEAPON_TYPES.length
        || !types.every(type => WEAPON_TYPES.includes(type as WeaponType))
        || (infantryClass !== undefined && !INFANTRY_HIT_CLASSES.includes(infantryClass as InfantryHitClass))
        || (infantryInOpen !== undefined && typeof infantryInOpen !== 'boolean')
        || (infantryDice !== undefined && (!Array.isArray(infantryDice) || infantryDice.length > MAX_DAMAGE * 4 + 16
            || !infantryDice.every(die => isInteger(die, 1, 6))))
        || (infantryBurstDice !== undefined && (infantryClass !== 'infantry' || !isInteger(infantryBurstDice, 1, 16)))
        || (partialCover !== undefined && partialCover !== true)
        || (narcPod !== undefined && (narcPod !== true || inferno !== undefined || physical !== undefined))
        || (inferno !== undefined && inferno !== true)
        || (heat !== undefined && !isInteger(heat, 1, MAX_DAMAGE))
        || (heatPerGroup !== undefined && (!isInteger(heatPerGroup, 1, MAX_DAMAGE) || !Array.isArray(groups)
            || heatPerGroup * groups.length !== heat))
        || (table !== undefined && table !== 'punch' && table !== 'kick' && table !== 'swarm')
        || (critical !== undefined && critical !== true)
        || (rifle !== undefined && (rifle !== true || physical !== undefined))
        || (capitalScale !== undefined && (capitalScale !== true || physical !== undefined))
        || (ammo !== undefined && ammo !== 'armor-piercing' && ammo !== 'acid' && ammo !== 'tandem-charge')
        || (rackSize !== undefined && (ammo !== 'armor-piercing' || !isInteger(rackSize, 1, MAX_DAMAGE)))
        || (swarmRelease !== undefined && swarmRelease !== true)
        || (swarmStrike !== undefined && !isSwarmStrike(swarmStrike))
        || (projectileDamage !== undefined && !isInteger(projectileDamage, 1, MAX_DAMAGE))
        || (mekPhysical !== undefined && (mekPhysical !== true || physical === undefined))
        || (physical !== undefined && !PHYSICAL_ATTACK_KINDS.includes(physical as PhysicalAttackKind))
        || (arc !== undefined && !HIT_ARCS.includes(arc as TnAttackDirection))
        || !Array.isArray(groups) || groups.length > MAX_ATTACK_ROWS) {
        return null;
    }
    let intercepted: AttackWeaponReport['ams'];
    if (ams !== undefined) {
        const { die, laser, aerospace } = (ams ?? {}) as Record<string, unknown>;
        const standard = parseDefenseOutcome(ams, groups.length);
        const laserResult = laser === undefined ? undefined : parseDefenseOutcome(laser, groups.length);
        if (!isInteger(die, 1, 6) || !standard || laserResult === null) return null;
        let aero: NonNullable<AttackWeaponReport['ams']>['aerospace'];
        if (aerospace !== undefined) {
            const { av, groupSize, absorption } = (aerospace ?? {}) as Record<string, unknown>;
            if (!isInteger(av, 1, MAX_DAMAGE) || !isInteger(groupSize, 1, MAX_DAMAGE)
                || !isInteger(absorption, 0, MAX_DAMAGE) || Math.ceil(av / groupSize) !== groups.length) return null;
            aero = { av, groupSize, absorption };
        }
        intercepted = Object.freeze({ die, ...standard, ...(laserResult ? { laser: laserResult } : {}), ...(aero ? { aerospace: aero } : {}) });
    }
    // An aimed shot is one weapon hit read on the standard table.
    let parsedAim: AimedShotRoll | undefined;
    if (aim !== undefined) {
        const { location, roll, rerolls } = (aim ?? {}) as Record<string, unknown>;
        if (table !== undefined || physical !== undefined || inferno !== undefined || cluster !== undefined
            || groups.length > 1 || !isId(location) || location.length > 16
            || !(isDice(roll, 1) || isDice(roll, 2))
            || (rerolls !== undefined && (!Array.isArray(rerolls) || rerolls.length > AIMED_SHOT_LEG_REROLLS
                || !rerolls.every(isTwoDice)))) return null;
        parsedAim = Object.freeze({
            location,
            roll: Object.freeze([...roll as number[]]),
            ...(rerolls === undefined ? {} : { rerolls: Object.freeze(rerolls as TwoDice[]) }),
        });
    }
    // The punch and kick tables roll 1D6; the standard and swarm tables 2D6.
    const diceCount = hitTableDice((table ?? 'standard') as HitTable);
    let parsedCluster: AttackWeaponReport['cluster'];
    if (cluster !== undefined) {
        const { dice, additionalDice, modifier, projectiles, hits } = (cluster ?? {}) as Record<string, unknown>;
        if (!isTwoDice(dice) || !isInteger(modifier, -100, 100)
            || !isInteger(projectiles, 1, MAX_DAMAGE) || !isInteger(hits, 0, MAX_DAMAGE)) return null;
        if (additionalDice !== undefined && (!Array.isArray(additionalDice)
            || additionalDice.length !== battleArmorMissileColumns(projectiles).length - 1 || !additionalDice.every(isTwoDice))) return null;
        parsedCluster = Object.freeze({ dice, modifier, projectiles, hits,
            ...(Array.isArray(additionalDice) ? { additionalDice: Object.freeze([...additionalDice]) } : {}) });
    }
    const parsedGroups = groups.map(group => {
        const { damage, location, aux, floating, buildingDamage, buildingLocation } = (group ?? {}) as Record<string, unknown>;
        // A heat-causing weapon's hit that only heats rolls its location with no damage.
        return (buildingDamage === undefined || isInteger(buildingDamage, 0, MAX_DAMAGE))
            && (buildingLocation === undefined || isId(buildingLocation))
            && isInteger(damage, 0, MAX_DAMAGE) && isDice(location, diceCount) && isInteger(aux, 1, 6)
            && (floating === undefined || (table === undefined && isTwoDice(floating)))
            ? Object.freeze({ damage, location: location as HitLocationDice, aux, ...(floating ? { floating } : {}),
                ...(typeof buildingDamage === 'number' ? { buildingDamage } : {}),
                ...(typeof buildingLocation === 'string' ? { buildingLocation } : {}) })
            : null;
    });
    if (parsedGroups.some(group => group === null || (narcPod && group.damage !== 0)
        || (cfHit && (!group.buildingLocation || group.buildingDamage !== undefined)))) return null;
    if (intercepted && [intercepted, intercepted.laser].some(outcome => outcome && (outcome.heat > (typeof heat === 'number' ? heat : 0)
        || (parsedCluster && outcome.hits > parsedCluster.hits)
        || outcome.damage.some((damage, i) => damage > parsedGroups[i]!.damage
            || (outcome.absorbed?.[i] ?? 0) > (parsedGroups[i]!.buildingDamage ?? 0))))) return null;
    const aero = intercepted?.aerospace;
    if (aero && parsedGroups.some((entry, i) => {
        const base = Math.min(aero.groupSize, aero.av - i * aero.groupSize);
        const absorbed = Math.min(aero.absorption, base);
        return entry!.damage !== base - absorbed || (entry!.buildingDamage ?? 0) !== absorbed;
    })) return null;
    return Object.freeze({
        ...(infantryClass === undefined ? {} : { infantryClass: infantryClass as InfantryHitClass }),
        ...(infantryBuilding ? { infantryBuilding } : {}),
        ...(collateralBuilding ? { collateralBuilding } : {}),
        ...(shelteringBuilding ? { shelteringBuilding } : {}),
        ...(typeof strayBuildingDamage === 'number' ? { strayBuildingDamage } : {}),
        ...(automaticBuildingHit ? { automaticBuildingHit: true as const } : {}),
        ...(cfHit ? { cfHit: true as const } : {}),
        ...(typeof infantryInOpen === 'boolean' ? { infantryInOpen } : {}),
        ...(Array.isArray(infantryDice) ? { infantryDice: Object.freeze([...infantryDice]) } : {}),
        ...(typeof infantryBurstDice === 'number' ? { infantryBurstDice } : {}),
        name, types: Object.freeze([...types] as WeaponType[]), ...(partialCover ? { partialCover: true as const } : {}),
        targetNumber, toHit,
        ...(parsedCluster === undefined ? {} : { cluster: parsedCluster }),
        ...(table === undefined ? {} : { table: table as Exclude<HitTable, 'standard'> }),
        ...(critical ? { critical: true as const } : {}),
        ...(rifle ? { rifle: true as const } : {}),
        ...(capitalScale ? { capitalScale: true as const } : {}),
        ...(ammo === undefined ? {} : { ammo: ammo as ArmorSpecialAmmo }),
        ...(rackSize === undefined ? {} : { rackSize: rackSize as number }),
        ...(swarmRelease ? { swarmRelease: true as const } : {}),
        ...(swarmStrike === undefined ? {} : {
            swarmStrike: Object.freeze((swarmStrike as { trooper?: number }).trooper === undefined
                ? {} : { trooper: (swarmStrike as { trooper: number }).trooper }),
        }),
        ...(physical === undefined ? {} : { physical: physical as PhysicalAttackKind }),
        ...(typeof projectileDamage === 'number' ? { projectileDamage } : {}),
        ...(mekPhysical === true ? { mekPhysical: true as const } : {}),
        ...(arc === undefined ? {} : { arc: arc as TnAttackDirection }),
        ...(inferno ? { inferno: true as const } : {}),
        ...(narcPod ? { narcPod: true as const } : {}),
        ...(intercepted ? { ams: intercepted } : {}),
        ...(heat === undefined ? {} : { heat: heat as number }),
        ...(heatPerGroup === undefined ? {} : { heatPerGroup: heatPerGroup as number }),
        ...(parsedAim === undefined ? {} : { aim: parsedAim }),
        groups: Object.freeze(parsedGroups as AttackHitGroup[]),
    });
}

function parseDefenseOutcome(value: unknown, groupCount: number): MissileDefenseOutcome | null {
    const { hits, damage, heat, absorbed } = (value ?? {}) as Record<string, unknown>;
    if (!isInteger(hits, 0, MAX_DAMAGE) || !isInteger(heat, 0, MAX_DAMAGE)
        || !Array.isArray(damage) || damage.length > groupCount || !damage.every(n => isInteger(n, 0, MAX_DAMAGE))
        || (absorbed !== undefined && (!Array.isArray(absorbed) || absorbed.length !== damage.length
            || !absorbed.every(n => isInteger(n, 0, MAX_DAMAGE))))) return null;
    return { hits, damage: Object.freeze([...damage]), heat, ...(Array.isArray(absorbed) ? { absorbed: Object.freeze([...absorbed]) } : {}) };
}

function isId(value: unknown): value is string {
    return typeof value === 'string' && value.length > 0 && value.length <= 128;
}

function isInteger(value: unknown, min: number, max: number): value is number {
    return Number.isSafeInteger(value) && (value as number) >= min && (value as number) <= max;
}

function isTwoDice(value: unknown): value is TwoDice {
    return isDice(value, 2);
}

function isDice(value: unknown, count: number): boolean {
    return Array.isArray(value) && value.length === count && value.every(die => isInteger(die, 1, 6));
}

function isSwarmStrike(value: unknown): boolean {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
    const keys = Object.keys(value);
    const trooper = (value as Record<string, unknown>)['trooper'];
    return keys.every(key => key === 'trooper') && (trooper === undefined || isInteger(trooper, 1, 6));
}
