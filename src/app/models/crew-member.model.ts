// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

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
    readonly asfGunnery?: number;
    readonly asfPiloting?: number;
}

export type CrewMemberEffectiveState = 'healthy' | 'ejected' | 'unconscious' | 'dead';
export type CrewMemberState = CrewMemberEffectiveState | 'killed' | 'stunned';

/** Sparse combat facts stored by every CBT unit runtime. */
export interface CrewMemberRuntimeState {
    readonly wounds: number;
    readonly unconscious: boolean;
    readonly ejected: boolean;
    /** Committed death; fatal Mek wounds remain pending until phase end. */
    readonly dead?: true;
    /** Earliest turn for an automated recovery roll; null means no queued recovery. */
    readonly recoveryReadyTurn?: number | null;
}

export interface CrewMemberStateUpdate {
    readonly wounds: number;
    readonly unconscious: boolean;
    readonly ejected: boolean;
    readonly dead?: boolean;
    /** Omitted preserves a pending schedule; null explicitly means none. */
    readonly recoveryReadyTurn?: number | null;
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
        if (derivedDead || this.dead === true) return 'dead';
        if (this.ejected) return 'ejected';
        if (this.unconscious) return 'unconscious';
        return 'healthy';
    }

    hasState(state: CrewMemberState, derivedDead = false): boolean {
        switch (state) {
            case 'dead':
            case 'killed': return derivedDead || this.dead === true;
            case 'ejected': return this.ejected;
            case 'unconscious':
            case 'stunned': return this.unconscious;
            case 'healthy': return this.effectiveState(derivedDead) === 'healthy';
        }
    }

    isAvailable(derivedDead = false): boolean {
        return this.effectiveState(derivedDead) === 'healthy';
    }

    isAboard(derivedDead = false): boolean {
        const state = this.effectiveState(derivedDead);
        return state !== 'dead' && state !== 'ejected';
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

    withState(update: CrewMemberStateUpdate): CrewMember {
        const recoveryReadyTurn = !update.unconscious
            ? undefined
            : update.recoveryReadyTurn !== undefined
                ? update.recoveryReadyTurn
                : this.recoveryReadyTurn;
        const dead = update.dead !== undefined
            ? update.dead
            : this.dead === true && update.wounds >= MAX_CREW_WOUNDS;
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
        return this.wounds === other.wounds
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
