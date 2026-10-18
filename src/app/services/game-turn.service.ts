// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import { Injectable, Injector, computed, effect, inject, signal } from '@angular/core';
import { merge } from 'rxjs';

import { CBTForce } from '../models/cbt-force.model';
import { isCBTForceMember, type CBTForceMember } from '../models/force-member.model';
import {
    TURN_STEPS,
    compareTurnPositions,
    gameTurnPosition,
    joinTurnPosition,
    unitTurnStatus,
    type TurnPosition,
    type TurnStep,
    type UnitTurnStatus,
} from '../models/rules/turn-sequence';
import { ForceWorkspaceStateService } from './force-workspace-state.service';
import { GameEventsService } from './game-events.service';
import type { LobbyParticipant } from '../models/lobby.model';
import { LobbyService } from './lobby.service';
import { InitiativeService } from './initiative.service';
import { heatAutomationPolicy, OptionsService, realPhasesEnabled } from './options.service';
import { ToastService } from './toast.service';

/** One unit taking part in the real-phase game, as derived from its own durable turn facts. */
export interface GameTurnUnit {
    readonly member: CBTForceMember;
    readonly hostile: boolean;
    /** The player may complete steps for this unit (it belongs to a force they own). */
    readonly controllable: boolean;
    /** The game waits for this unit: someone acts for it, here or as a lobby player. */
    readonly paced: boolean;
    readonly destroyed: boolean;
    readonly position: TurnPosition;
    /** Where the tracker shows the unit and whether it is still acting there. */
    readonly step: TurnStep;
    readonly status: UnitTurnStatus;
}

/**
 * The real-phase game clock. Nothing is stored here: every unit owns its progress (turn counter
 * and completed steps), and the game position is derived from every loaded CBT unit someone acts for.
 */
@Injectable({ providedIn: 'root' })
export class GameTurnService {
    private readonly options = inject(OptionsService);
    private readonly workspace = inject(ForceWorkspaceStateService);
    private readonly injector = inject(Injector);
    private readonly toast = inject(ToastService);
    private readonly gameEvents = inject(GameEventsService);
    private readonly revision = signal(0);
    private readonly busyUnits = signal<ReadonlySet<CBTForceMember>>(new Set());
    private readonly joining = new Set<CBTForceMember>();
    /**
     * Units the player restarted or moved back here: they stay where they were put and never join the turn
     * other forces show (this session only).
     */
    private readonly placedHere = new Set<string>();

    readonly enabled = computed(() => realPhasesEnabled(this.options));

    private readonly participants = computed(() => {
        this.revision();
        if (!this.enabled()) return [];
        return this.workspace.loadedForces().flatMap(slot => slot.force.members().filter(isCBTForceMember)
            .flatMap(member => {
                const snapshot = member.force.getUnitSnapshot(member.id);
                const controllable = !member.force.readOnly();
                const forceId = member.force.instanceId();
                return snapshot ? [{
                    member,
                    hostile: slot.alignment === 'enemy',
                    controllable,
                    paced: controllable || this.pacingPlayer(forceId) !== null,
                    destroyed: snapshot.query.destroyed(),
                    position: { turn: snapshot.state.turn.turnCounter, step: snapshot.state.turn.turnStep },
                }] : [];
            }));
    });

    /** The game is wherever its slowest live paced unit is. */
    readonly game = computed(() => gameTurnPosition(this.participants()
        .filter(unit => !unit.destroyed && unit.paced)
        .map(unit => unit.position)));

    readonly units = computed<readonly GameTurnUnit[]>(() => {
        const game = this.game();
        return this.participants().map(unit => {
            const status = game ? unitTurnStatus(unit.position, game) : { step: 0, status: 'done' as const };
            return Object.freeze({ ...unit, step: TURN_STEPS[status.step], status: status.status });
        });
    });

    constructor() {
        // A unit added to a game under way joins it where the units in play are.
        effect(() => {
            const units = this.participants();
            const inPlay = gameTurnPosition(units
                .filter(unit => unit.paced && !unit.destroyed && (unit.position.turn > 0 || unit.position.step > 0))
                .map(unit => unit.position));
            for (const unit of units) {
                const join = joinTurnPosition(unit.position, inPlay);
                if (!join || !unit.controllable || unit.destroyed || this.joining.has(unit.member)
                    || this.placedHere.has(unit.member.id)) continue;
                this.joining.add(unit.member);
                queueMicrotask(() => void unit.member.force.dispatchUnitCommand(unit.member.id, {
                    type: 'join-turn', turn: join.turn, step: join.step,
                }).finally(() => this.joining.delete(unit.member)));
            }
        });
        effect(onCleanup => {
            if (!this.enabled()) return;
            const forces = this.workspace.loadedForces().map(slot => slot.force);
            // A force this client does not own changes in memory only (a rules switch), through its session.
            const subscription = merge(...forces.flatMap(force => force instanceof CBTForce
                ? [force.changed, force.sessionChanged]
                : [force.changed]))
                .subscribe(() => this.revision.update(value => value + 1));
            onCleanup(() => subscription.unsubscribe());
        });
        // The lobby host restarted the game (the server relays restarts from the host only).
        this.gameEvents.received.subscribe(({ toForce, event, fromDisplayName }) => {
            const force = event.kind === 'restart'
                ? this.ownedForces().find(candidate => candidate.instanceId() === toForce)
                : undefined;
            if (!force) return;
            void this.restart(force).then(restarted => {
                if (restarted) this.toast.showToast(`${fromDisplayName ?? 'The host'} restarted the game at turn 1`, 'info');
            });
        });
    }

    /** Lobby players the game waits for on its current step: the host may advance without them. */
    readonly stalledBy = computed<readonly LobbyParticipant[]>(() => {
        const step = this.game()?.step;
        const players = this.units()
            .filter(unit => unit.paced && !unit.controllable && !unit.destroyed
                && unit.status === 'acting' && unit.step.index === step)
            .map(unit => this.pacingPlayer(unit.member.force.instanceId()));
        return [...new Map(players.flatMap(player => player ? [[player.publicId, player] as const] : [])).values()];
    });

    unitFor(member: CBTForceMember | null): GameTurnUnit | null {
        return member ? this.units().find(unit => unit.member === member) ?? null : null;
    }

    isBusy(member: CBTForceMember): boolean {
        return this.busyUnits().has(member);
    }

    /** Units the player still has to act with on the current step. */
    readonly pendingControllableUnits = computed(() => this.units()
        .filter(unit => unit.controllable && !unit.destroyed && unit.status === 'acting'));

    /**
     * Completes the unit's current step. A step that closes its phase runs the End Phase boundary
     * (committing the phase's damage and resolving its checks); Heat ends the unit's turn; every other
     * step is marked.
     */
    async completeStep(member: CBTForceMember): Promise<boolean> {
        const unit = this.unitFor(member);
        if (!unit || !unit.controllable || unit.destroyed || unit.status !== 'acting' || this.isBusy(member)) return false;
        this.busyUnits.update(units => new Set([...units, member]));
        try {
            if (unit.step.kind === 'heat') {
                const result = await member.force.dispatchUnitCommand(member.id, {
                    type: 'end-turn',
                    policy: heatAutomationPolicy(this.options),
                });
                const ended = this.positionOf(member).turn > unit.position.turn;
                // An accepted End Turn that does not advance is blocked by the unit's heat, not cancelled.
                if (result.accepted && !ended) {
                    this.toast.showToast(`The turn did not end: resolve the unit's heat on its sheet`, 'error');
                }
                return ended;
            }
            if (unit.step.endsPhase) {
                const result = await member.force.dispatchUnitCommand(member.id, { type: 'end-phase' });
                // A cancelled review leaves the phase open; the step stays to be completed.
                if (!result.accepted || member.force.getUnitSnapshot(member.id)?.query.hasPendingPhaseChanges()) return false;
            }
            const result = await member.force.dispatchUnitCommand(member.id, {
                type: 'complete-turn-step',
                step: unit.step.index,
            });
            return result.accepted && result.changed;
        } catch (error) {
            this.toast.showToast(`Could not complete ${unit.step.label}: ${error instanceof Error ? error.message : error}`, 'error');
            return false;
        } finally {
            this.busyUnits.update(units => new Set([...units].filter(busy => busy !== member)));
        }
    }

    /** Completes the current step for every unit of the player's that is acting on it. */
    async completeStepForAll(stepIndex: number): Promise<void> {
        const step = TURN_STEPS[stepIndex];
        const units = this.pendingControllableUnits()
            .filter(candidate => candidate.step.index === stepIndex && !this.isBusy(candidate.member));
        if (!step || (!step.endsPhase && step.kind !== 'heat')) {
            for (const unit of units) await this.completeStep(unit.member);
            return;
        }
        // Phase and turn boundaries run once per force, with one combined review like the force-wide buttons.
        const byForce = new Map<CBTForceMember['force'], CBTForceMember[]>();
        for (const unit of units) byForce.set(unit.member.force, [...byForce.get(unit.member.force) ?? [], unit.member]);
        for (const [force, members] of byForce) {
            this.busyUnits.update(busy => new Set([...busy, ...members]));
            try {
                const instanceIds = members.map(member => member.id);
                if (step.kind === 'heat') {
                    const turns = new Map(members.map(member => [member.id, this.positionOf(member).turn]));
                    const result = await force.endTurnForAllUnits(instanceIds);
                    // As for one unit: an accepted End Turn that does not advance is blocked by heat, not cancelled.
                    const blocked = result.results.filter(row => row.accepted && turns.has(row.instanceId)
                        && this.positionOf(members.find(member => member.id === row.instanceId)!).turn
                            === turns.get(row.instanceId)).length;
                    if (blocked > 0) {
                        this.toast.showToast(`${blocked} unit${blocked === 1 ? '' : 's'} did not end the turn: `
                            + 'resolve their heat on their sheets', 'error');
                    }
                    continue;
                }
                await force.endPhaseForAllUnits(instanceIds);
                // A unit whose review was cancelled keeps its phase open and its step to complete.
                for (const member of members) {
                    if (force.getUnitSnapshot(member.id)?.query.hasPendingPhaseChanges()) continue;
                    await force.dispatchUnitCommand(member.id, { type: 'complete-turn-step', step: stepIndex });
                }
            } finally {
                this.busyUnits.update(busy => new Set([...busy].filter(member => !members.includes(member))));
            }
        }
    }

    /**
     * The player's live units in the game's turn that moving to `stepIndex` would take forward or back.
     * Units that already ended the turn stay where they are.
     */
    stepMoves(stepIndex: number): Readonly<{ forward: readonly GameTurnUnit[]; back: readonly GameTurnUnit[] }> {
        const turn = this.game()?.turn;
        const mine = this.units().filter(unit => unit.controllable && !unit.destroyed && unit.position.turn === turn);
        return {
            forward: mine.filter(unit => unit.position.step < stepIndex),
            back: mine.filter(unit => unit.position.step > stepIndex),
        };
    }

    /**
     * Moves the player's units to `stepIndex` of the current turn. Units ahead go back to act on it again:
     * only their position changes, nothing they did is undone. Units behind complete their steps up to it.
     */
    async moveTo(stepIndex: number): Promise<void> {
        for (const { member } of this.stepMoves(stepIndex).back) {
            // A unit moved back to the first Movement stays there instead of joining the turn others show.
            this.placedHere.add(member.id);
            await member.force.dispatchUnitCommand(member.id, { type: 'rewind-turn-step', step: stepIndex });
        }
        await this.advanceTo(stepIndex);
    }

    /**
     * Completes steps for every unit of the player's until each stands on `stepIndex` of the current turn
     * or waits for other units there. Every phase boundary crossed runs as if completed step by step.
     */
    private async advanceTo(stepIndex: number): Promise<void> {
        const turn = this.game()?.turn;
        while (this.game()?.turn === turn) {
            const behind = this.pendingControllableUnits()
                .filter(unit => unit.step.index < stepIndex && !this.isBusy(unit.member));
            if (behind.length === 0) return;
            await this.completeStepForAll(Math.min(...behind.map(unit => unit.step.index)));
            // A cancelled review or blocked heat leaves the units where they were.
            if (behind.every(unit => compareTurnPositions(this.positionOf(unit.member), unit.position) === 0)) return;
        }
    }

    /**
     * Starts the game over at turn 1 Movement for every force the player controls, clearing their logs
     * and undo. The lobby host restarts the other players' forces too.
     */
    async restartGame(): Promise<void> {
        await Promise.all(this.ownedForces().map(force => this.restart(force)));
        // Resolved on use: the Initiative derives from this clock.
        this.injector.get(InitiativeService).clear();
        const lobby = this.injector.get(LobbyService).state();
        if (!lobby?.isHost) return;
        const others = lobby.participants.filter(player => !player.self).flatMap(player => player.instanceIds);
        const delivered = await Promise.all(others.map(toForce => this.gameEvents.send(toForce, { kind: 'restart' })));
        if (delivered.includes(false)) this.toast.showToast('Some players did not receive the restart', 'error');
    }

    private restart(force: CBTForce): Promise<boolean> {
        // Until every player has restarted, other forces still show the old turn: do not join it.
        for (const instanceId of force.getRuntimeInstanceIds()) this.placedHere.add(instanceId);
        return force.restartGame();
    }

    private ownedForces(): readonly CBTForce[] {
        return this.workspace.loadedForces().map(slot => slot.force)
            .filter((force): force is CBTForce => force instanceof CBTForce && !force.readOnly());
    }

    /**
     * The lobby player a force viewed here belongs to, while the game waits for them: a force with no
     * player behind it, or one the host marked away, never holds the game. The lobby is resolved on use:
     * it depends on the force builder.
     */
    private pacingPlayer(forceId: string | null): LobbyParticipant | null {
        const player = forceId === null ? null : this.injector.get(LobbyService).publisherOf(forceId);
        return player && !player.away ? player : null;
    }

    private positionOf(member: CBTForceMember): TurnPosition {
        const turn = member.force.getUnitSnapshot(member.id)?.state.turn;
        return { turn: turn?.turnCounter ?? 0, step: turn?.turnStep ?? 0 };
    }
}
