// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import { Injectable, Injector, inject } from '@angular/core';
import { Subject } from 'rxjs';

import { PHYSICAL_ATTACK_KINDS, type PhysicalAttackKind } from '../models/rules/physical-attack-rules';
import type { HitLocationDice, TwoDice } from '../models/rules/weapon-attack-resolution';
import { WEAPON_TYPES, type WeaponType } from '../models/weapon-types.model';
import type { MekHitArc } from '../utils/record-sheet-reference-table';
import { ForceWorkspaceStateService } from './force-workspace-state.service';
import { LobbyService } from './lobby.service';
import { WsService } from './ws.service';

const MAX_TARGET_DISTANCE = 1000;
const MAX_ATTACK_ROWS = 64;
const MAX_DAMAGE = 1000;
const HIT_ARCS: readonly MekHitArc[] = ['front', 'left', 'right', 'rear'];

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
    readonly damage: number;
    readonly location: HitLocationDice;
    /** The extra d6 some tables need (tripod legs, dual turrets). */
    readonly aux: number;
}

export interface AttackWeaponReport {
    readonly name: string;
    /** Weapon damage types, for armors that resist them. */
    readonly types: readonly WeaponType[];
    /** The target was in partial cover from this weapon: leg hits strike the cover. */
    readonly partialCover?: true;
    readonly targetNumber: number;
    readonly toHit: TwoDice;
    readonly cluster?: Readonly<{ dice: TwoDice; modifier: number; projectiles: number; hits: number }>;
    /** The 1D6 table a physical attack's groups are read on; otherwise the standard 2D6 table. */
    readonly table?: 'punch' | 'kick';
    /** A physical attack, whose outcome forces Piloting Skill Rolls on the struck Mek. */
    readonly physical?: PhysicalAttackKind;
    /** The column this attack strikes instead of the attack's direction (a DFA on a prone Mek or a vehicle). */
    readonly arc?: MekHitArc;
    readonly groups: readonly AttackHitGroup[];
}

/** A resolved weapon attack: the attacker's dice and outcome, for the defender to accept. */
export interface AttackEvent {
    readonly kind: 'attack';
    readonly id: string;
    readonly fromForce: string;
    readonly fromUnit: string;
    readonly attacker: string;
    readonly toUnit: string;
    readonly turn: number;
    readonly arc: MekHitArc;
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
        const { id, fromForce, fromUnit, attacker, toUnit, turn, arc, weapons } = record;
        if (!isId(id) || !isId(fromForce) || !isId(fromUnit) || !isId(attacker) || !isId(toUnit)
            || !isInteger(turn, 0, 100_000) || !HIT_ARCS.includes(arc as MekHitArc)
            || !Array.isArray(weapons) || weapons.length > MAX_ATTACK_ROWS) {
            return null;
        }
        const reports = weapons.map(parseWeaponReport);
        if (reports.some(report => report === null)) return null;
        return Object.freeze({
            kind: 'attack', id, fromForce, fromUnit, attacker, toUnit, turn: turn as number, arc: arc as MekHitArc,
            weapons: Object.freeze(reports as AttackWeaponReport[]),
        });
    }
    return null;
}

function parseWeaponReport(value: unknown): AttackWeaponReport | null {
    if (value === null || typeof value !== 'object' || Array.isArray(value)) return null;
    const { name, types, partialCover, targetNumber, toHit, cluster, table, physical, arc, groups } = value as Record<string, unknown>;
    if (!isId(name) || !isInteger(targetNumber, -100, 100) || !isTwoDice(toHit)
        || !Array.isArray(types) || types.length > WEAPON_TYPES.length
        || !types.every(type => WEAPON_TYPES.includes(type as WeaponType))
        || (partialCover !== undefined && partialCover !== true)
        || (table !== undefined && table !== 'punch' && table !== 'kick')
        || (physical !== undefined && !PHYSICAL_ATTACK_KINDS.includes(physical as PhysicalAttackKind))
        || (arc !== undefined && !HIT_ARCS.includes(arc as MekHitArc))
        || !Array.isArray(groups) || groups.length > MAX_ATTACK_ROWS) {
        return null;
    }
    // The punch and kick tables roll 1D6; the standard table 2D6.
    const diceCount = table === undefined ? 2 : 1;
    let parsedCluster: AttackWeaponReport['cluster'];
    if (cluster !== undefined) {
        const { dice, modifier, projectiles, hits } = (cluster ?? {}) as Record<string, unknown>;
        if (!isTwoDice(dice) || !isInteger(modifier, -100, 100)
            || !isInteger(projectiles, 1, MAX_DAMAGE) || !isInteger(hits, 0, MAX_DAMAGE)) return null;
        parsedCluster = Object.freeze({ dice, modifier, projectiles, hits });
    }
    const parsedGroups = groups.map(group => {
        const { damage, location, aux } = (group ?? {}) as Record<string, unknown>;
        return isInteger(damage, 1, MAX_DAMAGE) && isDice(location, diceCount) && isInteger(aux, 1, 6)
            ? Object.freeze({ damage, location: location as HitLocationDice, aux })
            : null;
    });
    if (parsedGroups.some(group => group === null)) return null;
    return Object.freeze({
        name, types: Object.freeze([...types] as WeaponType[]), ...(partialCover ? { partialCover: true as const } : {}),
        targetNumber, toHit,
        ...(parsedCluster === undefined ? {} : { cluster: parsedCluster }),
        ...(table === undefined ? {} : { table: table as 'punch' | 'kick' }),
        ...(physical === undefined ? {} : { physical: physical as PhysicalAttackKind }),
        ...(arc === undefined ? {} : { arc: arc as MekHitArc }),
        groups: Object.freeze(parsedGroups as AttackHitGroup[]),
    });
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
