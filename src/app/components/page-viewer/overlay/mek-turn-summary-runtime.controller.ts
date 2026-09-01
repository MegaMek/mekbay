// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import { DestroyRef, computed, signal, type Signal, type WritableSignal } from '@angular/core';

import type { CBTMekForceMember } from '../../../models/force-member.model';
import type { MekEquipmentChoice } from '../../../models/cbt-force.model';
import type { UnitCover } from '../../../models/unit-cover.model';
import {
    MEK_ACTION_DECLARATION_SCHEMA_VERSION,
    MEK_MOVEMENT_DECLARATION_SCHEMA_VERSION,
    type MekLegalActionProjectionV2,
    type MekMovementModeV2,
    type MekPilotCheckDiceEvidenceV2,
    type MekPilotCheckOutcomeV2,
} from '../../../models/runtime/mek-movement-psr-v2';
import type { MekTurnPanelSnapshot } from '../../../models/runtime/mek-turn-panel';
import { selectedWeaponHeat } from '../../../models/runtime/equipment-panel';
import type { CBTUnitCommand } from '../../../models/runtime/unit-instance';
import type { OptionsService } from '../../../services/options.service';
import type { ToastService } from '../../../services/toast.service';
import { actionableMekPilotChecks } from './page-turn-summary.util';

const MOVEMENT_MODES = new Set<MekMovementModeV2>(['stationary', 'walk', 'run', 'sprint', 'jump', 'UMU']);
const MAX_VISIBLE_FAILURE_STEPS = 5;

export interface MekEscalatingFailureControlRow {
    readonly componentId: string;
    readonly label: string;
    readonly damaged: boolean;
    readonly active: boolean;
    readonly sequenceChoices: readonly MekEquipmentChoice[];
    readonly statusChoice?: MekEquipmentChoice;
}

/** Typed runtime adapter for the established turn-summary presentation. */
export class MekTurnSummaryRuntimeController {
    public readonly busy = signal(false);
    public readonly member: CBTMekForceMember;
    public readonly snapshot: WritableSignal<MekTurnPanelSnapshot>;
    public readonly movementActions: Signal<readonly MekLegalActionProjectionV2[]>;
    public readonly unitActions: Signal<readonly MekLegalActionProjectionV2[]>;
    public readonly pendingChecks: Signal<MekTurnPanelSnapshot['movementState']['checks']>;
    public readonly currentMovement: Signal<MekTurnPanelSnapshot['movementState']['movement']>;
    public readonly movementDistance: Signal<number>;
    public readonly currentAction: Signal<MekTurnPanelSnapshot['movementState']['action']>;
    public readonly equipmentTrackControlRows: Signal<readonly MekEscalatingFailureControlRow[]>;

    private readonly options: OptionsService;
    private readonly toast: ToastService;
    private readonly movementDistancePreview = signal<{
        readonly mode: MekMovementModeV2;
        readonly value: number;
    } | null>(null);

    public constructor(
        member: CBTMekForceMember,
        options: OptionsService,
        toast: ToastService,
        destroyRef: DestroyRef,
    ) {
        this.member = member;
        this.options = options;
        this.toast = toast;
        this.snapshot = signal(this.requiredSnapshot());
        this.movementActions = computed(() => {
            const movement = this.snapshot().movement;
            const selectedMode = this.snapshot().movementState.movement?.mode;
            return movement.kind === 'supported'
                ? movement.actions.filter(action =>
                    MOVEMENT_MODES.has(action.kind as MekMovementModeV2)
                    && (action.kind === 'stationary'
                        || action.kind === selectedMode
                        || (action.maximumMp ?? 0) > 0))
                : [];
        });
        this.unitActions = computed(() => {
            const movement = this.snapshot().movement;
            return movement.kind === 'supported'
                ? movement.actions.filter(action => !MOVEMENT_MODES.has(action.kind as MekMovementModeV2))
                : [];
        });
        this.pendingChecks = computed(() => actionableMekPilotChecks(
            this.snapshot().movementState.checks,
            this.snapshot().movementState.automaticFalls.length > 0,
        ).filter(check => check.status === 'pending'));
        this.currentMovement = computed(() => this.snapshot().movementState.movement);
        this.movementDistance = computed(() => {
            const current = this.currentMovement();
            const preview = this.movementDistancePreview();
            return current && preview?.mode === current.mode ? preview.value : current?.distance ?? 0;
        });
        this.currentAction = computed(() => this.snapshot().movementState.action);
        this.equipmentTrackControlRows = computed(() => {
            this.snapshot();
            const statuses = new Map(
                (this.member.force.getEquipmentPanelSnapshot(this.member.id)?.components ?? [])
                    .map(component => [component.componentId, component.status] as const),
            );
            return Object.freeze(this.member.force.getMekEquipmentInteractions('turn-summary')
                .filter(row => row.instanceId === this.member.id)
                .map(row => {
                    const choices = row.choices.filter(choice =>
                        choice.interactionKind === 'escalating-failure');
                    const statusChoice = choices.find(choice => choice.failureTarget === undefined);
                    const allSequenceChoices = choices.filter(choice => choice.failureTarget !== undefined);
                    const active = allSequenceChoices.some(choice =>
                        choice.active && choice.selectionTone !== 'muted');
                    const result: MekEscalatingFailureControlRow = Object.freeze({
                        componentId: row.componentId,
                        label: row.componentLabel,
                        damaged: statuses.get(row.componentId) === 'destroyed',
                        active,
                        sequenceChoices: Object.freeze(visibleEscalatingFailureSteps(allSequenceChoices)),
                        ...(statusChoice === undefined ? {} : { statusChoice }),
                    });
                    return result;
                })
                .filter(row => (!row.damaged || row.active) && row.sequenceChoices.length > 0));
        });
        const subscription = member.force.changed.subscribe(() => this.refresh());
        destroyRef.onDestroy(() => {
            subscription.unsubscribe();
            this.movementDistancePreview.set(null);
        });
    }

    public actionTitle(action: MekLegalActionProjectionV2): string {
        return [...action.reasons, ...action.warnings].map(message => message.message).join('; ');
    }

    public movementMaximum(mode: MekMovementModeV2): number {
        const movement = this.snapshot().movement;
        if (movement.kind !== 'supported') return 0;
        return this.currentMovement()?.mode === mode
            ? movement.declaration?.maximumMp ?? 0
            : movement.actions.find(action => action.kind === mode)?.maximumMp ?? 0;
    }

    public movementCapacity(mode: MekMovementModeV2): number {
        const movement = this.snapshot().movement;
        return movement.kind === 'supported'
            ? movement.actions.find(action => action.kind === mode)?.maximumMp ?? 0
            : 0;
    }

    public movementAction(mode: MekMovementModeV2): MekLegalActionProjectionV2 | undefined {
        return this.movementActions().find(action => action.kind === mode);
    }

    public selectedWeaponsHeat(): number | null {
        const panel = this.member.force.getEquipmentPanelSnapshot(this.member.id);
        if (!panel) return null;
        const selected = selectedWeaponHeat(panel);
        return selected.hasSelection ? selected.value : null;
    }

    public movementMinimum(mode: MekMovementModeV2): number {
        const movement = this.snapshot().movement;
        return movement.kind === 'supported'
            ? movement.actions.find(action => action.kind === mode)?.minimumMp ?? 0
            : 0;
    }

    public async selectMovement(action: MekLegalActionProjectionV2): Promise<void> {
        if (!MOVEMENT_MODES.has(action.kind as MekMovementModeV2)) return;
        this.movementDistancePreview.set(null);
        const mode = action.kind as MekMovementModeV2;
        if (this.currentMovement()?.mode === mode) {
            await this.dispatch({ type: 'clear-mek-movement' });
            return;
        }
        if (!action.legal) return;
        await this.dispatch({
            type: 'declare-mek-movement',
            declaration: {
                schemaVersion: MEK_MOVEMENT_DECLARATION_SCHEMA_VERSION,
                mode,
                distance: action.minimumMp ?? 0,
                boosterComponentIds: mode === 'run' || mode === 'sprint'
                    ? this.snapshot().activeBoosterComponentIds
                    : [],
            },
        });
    }

    public async setMovementDistance(value: number): Promise<void> {
        const current = this.currentMovement();
        if (!current || !Number.isSafeInteger(value)) return;
        const preview = this.previewMovementDistance(value);
        if (!preview) return;
        try {
            await this.dispatch({
                type: 'declare-mek-movement',
                declaration: { ...current, distance: preview.value },
            });
        } finally {
            if (this.movementDistancePreview() === preview) this.movementDistancePreview.set(null);
        }
    }

    /** Local drag preview; persistence remains a single command on valueCommit. */
    public previewMovementDistance(value: number): { readonly mode: MekMovementModeV2; readonly value: number } | null {
        const current = this.currentMovement();
        if (!current || !Number.isFinite(value)) return null;
        const preview = Object.freeze({
            mode: current.mode,
            value: Math.max(
                this.movementMinimum(current.mode),
                Math.min(this.movementMaximum(current.mode), Math.round(value)),
            ),
        });
        this.movementDistancePreview.set(preview);
        return preview;
    }

    public async setAirborne(airborne: boolean | null): Promise<void> {
        const turn = this.snapshot().turn;
        await this.dispatch({
            type: 'replace-turn-state',
            turn: {
                ...turn,
                airborne,
                phaseStateChanged: true,
            },
        });
    }

    public async toggleSpotting(): Promise<void> {
        if (!this.snapshot().canTakeActiveActions
            || this.currentMovement()?.mode === 'sprint') return;
        const turn = this.snapshot().turn;
        await this.dispatch({
            type: 'replace-turn-state',
            turn: {
                ...turn,
                spotting: !turn.spotting,
            },
        });
    }

    public async selectCover(cover: UnitCover | null): Promise<void> {
        const turn = this.snapshot().turn;
        await this.dispatch({
            type: 'replace-turn-state',
            turn: { ...turn, cover: turn.cover === cover ? null : cover },
        });
    }

    public async selectEquipmentTrackChoice(choice: MekEquipmentChoice): Promise<void> {
        if (this.busy() || choice.disabled) return;
        this.busy.set(true);
        try {
            const result = await this.member.force.dispatchMekEquipmentChoice(choice.token);
            if (!result.accepted) this.toast.showToast(`Equipment action rejected: ${result.reason}`, 'error');
        } finally {
            this.busy.set(false);
            this.refresh();
        }
    }

    public async selectAction(action: MekLegalActionProjectionV2): Promise<void> {
        if (action.kind !== 'shutdown' && action.kind !== 'startup') return;
        if (this.currentAction()?.kind === action.kind) {
            await this.dispatch({ type: 'clear-mek-action' });
            return;
        }
        if (!action.legal) return;
        await this.dispatch({
            type: 'declare-mek-action',
            action: { schemaVersion: MEK_ACTION_DECLARATION_SCHEMA_VERSION, kind: action.kind },
        });
    }

    public prepareStand(): Promise<boolean> {
        return this.dispatch({ type: 'prepare-mek-stand' });
    }

    public resolveStandAttempt(
        carefulStand: boolean,
        evidence?: MekPilotCheckDiceEvidenceV2,
    ): Promise<boolean> {
        return this.dispatch({ type: 'resolve-mek-stand-attempt', carefulStand, evidence });
    }

    public resolveStandOutcome(
        carefulStand: boolean,
        outcome: MekPilotCheckOutcomeV2,
    ): Promise<boolean> {
        const movement = this.snapshot().movement;
        if (movement.kind !== 'supported') return Promise.resolve(false);
        if (!movement.standing.requiresPilotCheck) {
            return outcome === 'success'
                ? this.resolveStandAttempt(carefulStand)
                : Promise.resolve(false);
        }
        const target = movement.standing.targetNumber - (carefulStand ? 2 : 0);
        const dice = diceForMekPilotCheckOutcome(target, outcome);
        return dice
            ? this.resolveStandAttempt(carefulStand, { dice, claimedOutcome: outcome })
            : Promise.resolve(false);
    }

    public adjustStandAttempts(delta: number): Promise<boolean> {
        return this.dispatch({ type: 'adjust-mek-stand-attempts', delta });
    }

    public resolveCheckOutcome(
        checkId: string,
        targetNumber: number,
        outcome: MekPilotCheckOutcomeV2,
        rolledDice?: readonly [number, number],
    ): Promise<boolean> {
        const dice = rolledDice ?? diceForMekPilotCheckOutcome(targetNumber, outcome);
        return dice
            ? this.dispatch({
                type: 'resolve-mek-pilot-check',
                checkId,
                evidence: { dice, claimedOutcome: outcome },
            })
            : Promise.resolve(false);
    }

    public async setHeat(value: number): Promise<void> {
        const heat = Math.max(0, Math.min(999, Number(value) || 0));
        await this.dispatch(this.options.options().trackPhaseAndTurn
            ? { type: 'set-pending-heat', heat }
            : { type: 'set-heat', heat });
    }

    public async setHeatsinksOff(value: number): Promise<void> {
        const projection = this.snapshot().heatProjection;
        const maximum = projection.kind === 'supported' ? projection.projection.capacity : 0;
        await this.dispatch({
            type: 'set-heatsinks-off',
            heatsinksOff: Math.max(0, Math.min(maximum, Number(value) || 0)),
        });
    }

    public async applyHeat(): Promise<void> {
        await this.dispatch({ type: 'apply-heat', policy: this.heatPolicy() });
    }

    public boundary(type: 'commit-pending' | 'cancel-pending' | 'end-phase' | 'end-turn'): Promise<boolean> {
        return this.dispatch(type === 'end-turn' ? { type, policy: this.heatPolicy() } : { type });
    }

    private async dispatch(command: CBTUnitCommand): Promise<boolean> {
        if (this.busy()) return false;
        this.busy.set(true);
        try {
            const result = await this.member.force.dispatchMekUnitCommand(this.member.id, {
                ...command,
            } as CBTUnitCommand);
            if (!result.accepted) this.toast.showToast('This force is read-only.', 'error');
            return result.accepted;
        } finally {
            this.busy.set(false);
            this.refresh();
        }
    }

    private refresh(): void {
        const snapshot = this.member.force.getMekTurnPanelSnapshot(this.member.id, this.heatPolicy());
        if (snapshot) this.snapshot.set(snapshot);
    }

    private requiredSnapshot(): MekTurnPanelSnapshot {
        const snapshot = this.member.force.getMekTurnPanelSnapshot(this.member.id, this.heatPolicy());
        if (!snapshot) throw new Error('The selected Mek is no longer admitted');
        return snapshot;
    }

    private heatPolicy(): 'automatic' | 'manual' {
        return this.options.cbtAutomationMode('heatAndDissipationResolution') === 'yes'
            ? 'automatic'
            : 'manual';
    }
}

export function diceForMekPilotCheckOutcome(
    target: number,
    outcome: MekPilotCheckOutcomeV2,
): readonly [number, number] | null {
    const sum = outcome === 'success' ? Math.max(2, target) : Math.min(12, target - 1);
    if (sum < 2 || sum > 12) return null;
    const first = Math.max(1, Math.min(6, sum - 1));
    const second = sum - first;
    return second >= 1 && second <= 6 ? [first, second] : [sum - 6, 6];
}

/** Origin/next's five-step sliding window, shared by every runtime family. */
export function visibleEscalatingFailureSteps<Choice extends Readonly<{
    active: boolean;
    disabled: boolean;
    selectionTone?: 'selected' | 'muted';
}>>(choices: readonly Choice[]): Choice[] {
    if (choices.length <= MAX_VISIBLE_FAILURE_STEPS) return [...choices];
    const selectedIndex = choices.findIndex(choice =>
        choice.active && choice.selectionTone !== 'muted');
    const nextIndex = choices.findIndex(choice => !choice.disabled && !choice.active);
    const lastActiveIndex = choices.reduce(
        (lastIndex, choice, index) => choice.active ? index : lastIndex,
        -1,
    );
    const focusIndex = selectedIndex >= 0
        ? selectedIndex
        : nextIndex >= 0 ? nextIndex : Math.max(0, lastActiveIndex);
    const start = Math.max(0, Math.min(
        focusIndex - Math.floor(MAX_VISIBLE_FAILURE_STEPS / 2),
        choices.length - MAX_VISIBLE_FAILURE_STEPS,
    ));
    return choices.slice(start, start + MAX_VISIBLE_FAILURE_STEPS);
}
