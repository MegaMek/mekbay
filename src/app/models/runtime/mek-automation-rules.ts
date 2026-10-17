// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import type { CBTUnitSnapshot } from '../cbt-unit-snapshot';
import type { CrewMember } from '../crew-member.model';
import type { ComponentId, CrewPositionId } from '../entity/entity-identifiers';
import type { EntityMountedEquipment } from '../entity/types';
import { AmmoEquipment } from '../equipment.model';
import { heatEffectValue, MEK_HEAT_EFFECTS } from '../rules/heat-effect-rules';
import type { AutomationMode } from '../options.model';
import type { CBTRuntimeCrewPosition } from './cbt-unit-runtime';
import { ammoExplosionDamagePerShot, ammoRackSize } from './mek-critical-hit-v2';

export type HeatControlCheckKind = 'shutdown' | 'startup' | 'ammo-explosion';

export interface HeatAutomationCheck<Kind extends string = HeatControlCheckKind> {
    readonly kind: Kind;
    readonly target?: number;
    readonly automaticOutcome?: 'success' | 'failed';
}

export interface HeatControlFacts {
    /** The unit's heat-scale targets; undefined below the first threshold. */
    readonly shutdownTarget: number | undefined;
    readonly ammoExplosionTarget: number | undefined;
    readonly shutdown: boolean;
    /** A conscious pilot or controller who can roll against shutdown. */
    readonly activeController: boolean;
    readonly hasExplosiveAmmo: boolean;
}

/** Cumulative shutdown, restart, and ammunition checks every heat-tracking unit makes after end-turn heat. */
export function heatControlChecks(facts: HeatControlFacts): readonly HeatAutomationCheck[] {
    const target = facts.shutdownTarget;
    const checks: HeatAutomationCheck[] = [];
    if (facts.shutdown) {
        if (target === undefined) {
            checks.push(Object.freeze({ kind: 'startup', automaticOutcome: 'success' }));
        } else if (facts.activeController && target <= 12) {
            checks.push(Object.freeze({ kind: 'startup', target }));
        }
    } else if (target !== undefined) {
        checks.push(Object.freeze(target > 12 || !facts.activeController
            ? { kind: 'shutdown', automaticOutcome: 'failed' }
            : { kind: 'shutdown', target }));
    }
    if (facts.hasExplosiveAmmo && facts.ammoExplosionTarget !== undefined) {
        checks.push(Object.freeze({ kind: 'ammo-explosion', target: facts.ammoExplosionTarget }));
    }
    return Object.freeze(checks);
}

export interface MekHeatAutomationFacts
    extends Omit<HeatControlFacts, 'shutdownTarget' | 'ammoExplosionTarget'> {
    readonly heat: number;
}

/** The Mek heat scale's heat-control checks. */
export function mekHeatAutomationChecks(
    { heat, ...facts }: MekHeatAutomationFacts,
): readonly HeatAutomationCheck[] {
    return heatControlChecks({
        ...facts,
        shutdownTarget: heatEffectValue(MEK_HEAT_EFFECTS, 'shutdown', heat),
        ammoExplosionTarget: heatEffectValue(MEK_HEAT_EFFECTS, 'ammo-explosion', heat),
    });
}

export interface HeatAmmoExplosionCandidate {
    readonly componentId: ComponentId;
    readonly mount: EntityMountedEquipment;
    readonly damagePerShot: number;
    readonly shots: number;
}

/**
 * Bins a failed heat ammunition-explosion check can detonate, for every unit
 * family: available ammunition whose loaded munition is explosive, has shots
 * left, and deals damage, narrowed to the most destructive (damage per shot,
 * then remaining shots).
 */
export function heatAmmoExplosionCandidates(
    snapshot: CBTUnitSnapshot,
): readonly HeatAmmoExplosionCandidate[] {
    const candidates = [...snapshot.index.components.values()].flatMap(component => {
        const mount = component.mount;
        if (!mount || !(mount.equipment instanceof AmmoEquipment)
            || snapshot.query.componentStatus(component.id, 'committed') !== 'available') return [];
        const ammo = snapshot.query.ammoEquipment(component.id);
        const damagePerShot = ammo?.isExplosive()
            ? ammoRackSize(ammo) * ammoExplosionDamagePerShot(ammo)
            : 0;
        const shots = snapshot.query.remainingAmmo(component.id);
        return damagePerShot > 0 && shots > 0
            ? [Object.freeze({ componentId: component.id, mount, damagePerShot, shots })]
            : [];
    });
    if (candidates.length <= 1) return Object.freeze(candidates);
    const highestDamage = Math.max(...candidates.map(candidate => candidate.damagePerShot));
    const mostDestructive = candidates.filter(candidate =>
        candidate.damagePerShot === highestDamage);
    const mostShots = Math.max(...mostDestructive.map(candidate => candidate.shots));
    return Object.freeze(mostDestructive.filter(candidate => candidate.shots === mostShots));
}

export function rollD6(random: () => number = Math.random): number {
    return Math.max(1, Math.min(6, Math.floor(random() * 6) + 1));
}

export function roll2D6(random: () => number = Math.random): readonly [number, number] {
    return Object.freeze([rollD6(random), rollD6(random)] as const);
}

export function twoD6Total(dice: readonly [number, number]): number {
    return dice[0] + dice[1];
}

/** Target to remain conscious after the current cumulative wound count. */
export function mekConsciousnessTarget(wounds: number): number | undefined {
    const normalized = Math.max(0, Math.trunc(wounds));
    return normalized >= 6 ? undefined : [undefined, 3, 5, 7, 10, 11][normalized];
}

/** First turn a newly unconscious crew member may roll to recover; `no` leaves recovery to the user. */
export function consciousnessRecoveryReadyTurn(mode: AutomationMode, turnCounter: number): number | null {
    return mode === 'no' ? null : turnCounter + 1;
}

/** Target of the recovery roll an unconscious crew member is due this turn, if any. */
export function dueConsciousnessRecoveryTarget(member: CrewMember, turnCounter: number): number | undefined {
    const readyTurn = member.recoveryReadyTurn;
    if (!member.unconscious || !member.isAliveAboard() || readyTurn === null
        || readyTurn !== undefined && readyTurn > turnCounter) return undefined;
    return mekConsciousnessTarget(member.wounds);
}

/** Crew stations in rules order, primary station first. */
export function orderedCrewPositions(snapshot: CBTUnitSnapshot): readonly CBTRuntimeCrewPosition[] {
    return [...snapshot.index.crewPositions.values()]
        .sort((left, right) => left.occurrence - right.occurrence);
}

/** The assigned crew member's name, when one was entered. */
export function assignedCrewName(snapshot: CBTUnitSnapshot, positionId: CrewPositionId): string | undefined {
    return snapshot.crewAssignment.positions
        .find(position => position.positionId === positionId)?.name.trim() || undefined;
}

/** A crew member's name, or their station number when unnamed. */
export function crewPositionLabel(snapshot: CBTUnitSnapshot, positionId: CrewPositionId): string {
    return assignedCrewName(snapshot, positionId)
        ?? `Crew ${(snapshot.index.crewPositions.get(positionId)?.occurrence ?? 0) + 1}`;
}
