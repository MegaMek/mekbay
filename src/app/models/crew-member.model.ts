// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import type { CBTUnitSnapshot } from './cbt-unit-snapshot';
import type { CrewPositionId } from './entity/entity-identifiers';
import { ImmutableIndex } from './entity/immutable-collections';

export const MAX_CREW_WOUNDS = 6;
export const CRIPPLED_CREW_WOUND_THRESHOLD = 4;
export const DEFAULT_GUNNERY_SKILL = 4;
export const DEFAULT_PILOTING_SKILL = 5;

/** Detached crew row used by force previews and import/export DTOs. */
export interface CrewMemberDetails {
    readonly id: number;
    readonly name: string;
    readonly gunnery: number;
    readonly piloting: number;
    readonly aeroGunnery?: number;
    readonly aeroPiloting?: number;
}

export type CrewMemberEffectiveState = 'healthy' | 'ejected' | 'unconscious' | 'dead' | 'vacant';
export type CrewMemberState = CrewMemberEffectiveState | 'killed' | 'stunned';

/** Sparse combat facts stored by every CBT unit runtime. */
export interface CrewMemberRuntimeState {
    readonly wounds: number;
    readonly unconscious: boolean;
    readonly ejected: boolean;
    /** One stored fact, presented as Dead for wound tracks or Killed for manual switches. */
    readonly dead?: true;
    /** Earliest turn for an automated recovery roll; null means no queued recovery. */
    readonly recoveryReadyTurn?: number | null;
}

interface CrewMemberStatusUpdate {
    readonly unconscious: boolean;
    readonly ejected: boolean;
    /** Omitted preserves a pending schedule; null explicitly means none. */
    readonly recoveryReadyTurn?: number | null;
}

export interface CrewMemberStateUpdate extends CrewMemberStatusUpdate {
    readonly wounds: number;
}

export interface ManualCrewDeathUpdate extends CrewMemberStatusUpdate {
    readonly dead: boolean;
}

const HEALTHY_CREW_STATE: CrewMemberRuntimeState = Object.freeze({
    wounds: 0,
    unconscious: false,
    ejected: false,
});

/**
 * Immutable view of one crew member's combat state.
 *
 * Runtime snapshots continue to store plain frozen facts. Use `from` while
 * evaluating or changing one member and `toRuntimeState` at the state boundary.
 */
export class CrewMember implements CrewMemberRuntimeState {
    static readonly healthy = new CrewMember(HEALTHY_CREW_STATE);
    /** A query-only view of an unoccupied station; vacancy is an assignment fact. */
    static readonly vacant = new CrewMember(HEALTHY_CREW_STATE);

    readonly wounds: number;
    readonly unconscious: boolean;
    readonly ejected: boolean;
    readonly dead?: true;
    readonly recoveryReadyTurn?: number | null;

    private constructor(state: CrewMemberRuntimeState) {
        this.wounds = state.wounds;
        this.unconscious = state.unconscious;
        this.ejected = state.ejected;
        if (state.dead === true) this.dead = true;
        if (state.recoveryReadyTurn !== undefined) {
            this.recoveryReadyTurn = state.recoveryReadyTurn;
        }
        Object.freeze(this);
    }

    static from(state?: CrewMemberRuntimeState): CrewMember {
        if (state === undefined) return CrewMember.healthy;
        return state instanceof CrewMember ? state : new CrewMember(state);
    }

    effectiveState(derivedDead = false): CrewMemberEffectiveState {
        if (this === CrewMember.vacant) return 'vacant';
        if (derivedDead || this.dead === true) return 'dead';
        if (this.ejected) return 'ejected';
        if (this.unconscious) return 'unconscious';
        return 'healthy';
    }

    hasState(state: CrewMemberState, derivedDead = false): boolean {
        if (this === CrewMember.vacant) return state === 'vacant';
        switch (state) {
            case 'vacant': return false;
            case 'dead':
            case 'killed': return derivedDead || this.dead === true;
            case 'ejected': return this.ejected;
            case 'unconscious':
            case 'stunned': return this.unconscious;
            case 'healthy': return this.effectiveState(derivedDead) === 'healthy';
        }
    }

    isAvailable(derivedDead = false): boolean {
        return !this.isFatallyWounded()
            && this.effectiveState(derivedDead) === 'healthy';
    }

    isAboard(derivedDead = false): boolean {
        const state = this.effectiveState(derivedDead);
        return state !== 'vacant' && state !== 'dead' && state !== 'ejected';
    }

    /** Aboard and not fatally wounded: still takes hits and rolls, even while unconscious. */
    isAliveAboard(): boolean {
        return this.isAboard() && !this.isFatallyWounded();
    }

    isCrippled(derivedDead = false): boolean {
        return this.isAboard(derivedDead)
            && this.wounds >= CRIPPLED_CREW_WOUND_THRESHOLD;
    }

    isFatallyWounded(): boolean {
        return this.wounds >= MAX_CREW_WOUNDS;
    }

    isDeathCommitted(): boolean {
        return this.dead === true;
    }

    /** Updates crew whose death follows the six-wound track. */
    withWoundTrackedState(update: CrewMemberStateUpdate): CrewMember {
        const correctingAutomaticDeath = this.isFatallyWounded()
            && update.wounds < MAX_CREW_WOUNDS;
        return this.updated(update, this.dead === true && !correctingAutomaticDeath);
    }

    /** A manual Killed switch uses the same canonical facts as six-wound death. */
    withManualDeath(update: ManualCrewDeathUpdate): CrewMember {
        return this.updated({
            ...update,
            wounds: update.dead ? MAX_CREW_WOUNDS : 0,
        }, update.dead);
    }

    private updated(update: CrewMemberStateUpdate, dead: boolean): CrewMember {
        const recoveryReadyTurn = !update.unconscious
            ? undefined
            : update.recoveryReadyTurn !== undefined
                ? update.recoveryReadyTurn
                : this.recoveryReadyTurn;
        return new CrewMember({
            wounds: update.wounds,
            unconscious: update.unconscious,
            ejected: update.ejected,
            ...(dead ? { dead: true } : {}),
            ...(recoveryReadyTurn === undefined ? {} : { recoveryReadyTurn }),
        });
    }

    commitDeath(): CrewMember {
        if (!this.isFatallyWounded() || this.isDeathCommitted()) return this;
        return new CrewMember({ ...this.toRuntimeState(), dead: true });
    }

    equals(other: CrewMember): boolean {
        return (this === CrewMember.vacant) === (other === CrewMember.vacant)
            && this.wounds === other.wounds
            && this.unconscious === other.unconscious
            && this.ejected === other.ejected
            && this.dead === other.dead
            && this.recoveryReadyTurn === other.recoveryReadyTurn;
    }

    isPristine(): boolean {
        return this.wounds === 0
            && !this.unconscious
            && !this.ejected
            && this.dead !== true
            && this.recoveryReadyTurn === undefined;
    }

    toRuntimeState(): CrewMemberRuntimeState {
        return Object.freeze({
            wounds: this.wounds,
            unconscious: this.unconscious,
            ejected: this.ejected,
            ...(this.dead === true ? { dead: true as const } : {}),
            ...(this.recoveryReadyTurn === undefined
                ? {}
                : { recoveryReadyTurn: this.recoveryReadyTurn }),
        });
    }
}

/** One crew edit for every unit family; `dead` is the manual Killed switch. */
export interface CrewStateEdit extends CrewMemberStateUpdate {
    readonly dead?: boolean;
}

/** The sparse crew invariant every runtime family and the save codec enforce. */
export function isSparseCrewMemberState(crew: CrewMemberRuntimeState): boolean {
    return Number.isSafeInteger(crew.wounds) && crew.wounds >= 0 && crew.wounds <= MAX_CREW_WOUNDS
        && typeof crew.unconscious === 'boolean'
        && typeof crew.ejected === 'boolean'
        && (crew.dead === undefined || (crew.dead === true && crew.wounds === MAX_CREW_WOUNDS))
        && validRecoveryReadyTurn(crew.recoveryReadyTurn, crew.unconscious)
        && (crew.wounds > 0 || crew.unconscious || crew.ejected);
}

/** Applies one crew edit to the sparse crew map; null when the edit is invalid or changes nothing. */
export function withCrewMemberState(
    crew: ReadonlyMap<CrewPositionId, CrewMemberRuntimeState>,
    positionId: CrewPositionId,
    edit: CrewStateEdit,
): ReadonlyMap<CrewPositionId, CrewMemberRuntimeState> | null {
    if (!Number.isSafeInteger(edit.wounds) || edit.wounds < 0 || edit.wounds > MAX_CREW_WOUNDS
        || typeof edit.unconscious !== 'boolean'
        || typeof edit.ejected !== 'boolean'
        || (edit.dead !== undefined && typeof edit.dead !== 'boolean')
        || !validRecoveryReadyTurn(edit.recoveryReadyTurn, edit.unconscious)) {
        return null;
    }
    const current = CrewMember.from(crew.get(positionId));
    const next = edit.dead === undefined
        ? current.withWoundTrackedState(edit)
        : current.withManualDeath({
            unconscious: edit.unconscious,
            ejected: edit.ejected,
            recoveryReadyTurn: edit.recoveryReadyTurn,
            dead: edit.dead,
        });
    if (current.equals(next)) return null;
    const result = new Map(crew);
    if (next.isPristine()) result.delete(positionId);
    else result.set(positionId, next.toRuntimeState());
    return new ImmutableIndex(result);
}

/** A recovery turn is queued only for unconscious crew; null means none is queued. */
function validRecoveryReadyTurn(value: number | null | undefined, unconscious: boolean): boolean {
    return value === undefined
        || (unconscious && (value === null || (Number.isSafeInteger(value) && value >= 0)));
}

export interface ActiveCrewController {
    readonly positionId: CrewPositionId;
    readonly occurrence: number;
    readonly piloting: number;
    readonly member: CrewMember;
}

/**
 * The crew member who controls the unit: the primary station when able,
 * otherwise the able member with the best skill. Vacant, ejected, dead, fatally
 * wounded, and unconscious stations never control; `recoveredPositions` are
 * unconscious crew whose pending recovery roll already succeeded.
 */
export function activeCrewController(
    snapshot: CBTUnitSnapshot,
    skill: 'piloting' | 'aeroPiloting',
    recoveredPositions: ReadonlySet<CrewPositionId> = new Set<CrewPositionId>(),
): ActiveCrewController | null {
    const candidates = [...snapshot.index.crewPositions.values()].flatMap(position => {
        const member = snapshot.query.crewState(position.id);
        if (!member.isAliveAboard()
            || member.unconscious && !recoveredPositions.has(position.id)) return [];
        const assignment = snapshot.crewAssignment.positions.find(candidate =>
            candidate.positionId === position.id);
        return [Object.freeze({
            positionId: position.id,
            occurrence: position.occurrence,
            piloting: assignment?.[skill] ?? DEFAULT_PILOTING_SKILL,
            member,
        })];
    });
    return candidates.find(candidate => candidate.occurrence === 0)
        ?? candidates.sort((left, right) =>
            left.piloting - right.piloting
            || left.occurrence - right.occurrence
            || left.positionId.localeCompare(right.positionId))[0]
        ?? null;
}
