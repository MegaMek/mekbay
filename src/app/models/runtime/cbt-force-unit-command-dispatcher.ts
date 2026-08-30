// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import type { Injector } from '@angular/core';
import { DirectMekAutomationService } from '../../services/direct-mek-automation.service';
import { DirectNonMekAutomationService } from '../../services/direct-non-mek-automation.service';
import type { CBTForce } from '../cbt-force.model';
import type {
    CBTForceEndTurnAllResult,
    CBTForceEndTurnUnitResult,
    CBTMekUnitCommandResult,
    CBTNonMekUnitCommandResult,
} from '../cbt-force-api';
import { hasMekRuntime, type CBTUnitSnapshot } from '../cbt-unit-snapshot';
import type { NonMekUnitCommand } from './non-mek-unit-instance';
import { createCommandId, type UnitInstanceId } from './runtime-state';
import type { CBTUnitCommand } from './unit-instance';
import type { MekHeatAutomationPolicyV2 } from './mek-heat-state-v2';

export interface CBTForceUnitCommandBoundary {
    readonly readOnly: () => boolean;
    readonly instanceIds: () => readonly UnitInstanceId[];
    readonly snapshot: (instanceId: UnitInstanceId) => CBTUnitSnapshot | null;
    readonly heatPolicy: () => MekHeatAutomationPolicyV2;
    readonly dispatchMekCore: (
        instanceId: UnitInstanceId,
        command: CBTUnitCommand,
    ) => Promise<CBTMekUnitCommandResult>;
    readonly dispatchNonMekCore: (
        instanceId: UnitInstanceId,
        command: NonMekUnitCommand,
    ) => Promise<CBTNonMekUnitCommandResult>;
    readonly endTurnForAllCore: () => Promise<CBTForceEndTurnAllResult>;
}

/**
 * Coordinates optional UI automation around force-owned command reduction.
 * It never owns Entity or runtime state; every accepted mutation crosses one
 * of the authoritative callbacks supplied by CBTForce.
 */
export class CBTForceUnitCommandDispatcher {
    constructor(
        private readonly force: CBTForce,
        private readonly injector: Injector,
        private readonly boundary: CBTForceUnitCommandBoundary,
    ) {}

    dispatchNonMek(
        instanceId: UnitInstanceId,
        command: NonMekUnitCommand,
    ): Promise<CBTNonMekUnitCommandResult> {
        return this.dispatchNonMekWithAutomation(instanceId, command, true);
    }

    dispatchMek(
        instanceId: UnitInstanceId,
        command: CBTUnitCommand,
    ): Promise<CBTMekUnitCommandResult> {
        return this.dispatchMekWithAutomation(instanceId, command, true);
    }

    endTurnForAll(): Promise<CBTForceEndTurnAllResult> {
        return this.mekAutomation() || this.nonMekAutomation()
            ? this.endTurnForAllWithAutomation()
            : this.boundary.endTurnForAllCore();
    }

    private async dispatchNonMekWithAutomation(
        instanceId: UnitInstanceId,
        command: NonMekUnitCommand,
        automate: boolean,
    ): Promise<CBTNonMekUnitCommandResult> {
        const automation = automate ? this.nonMekAutomation() : null;
        if (!automation) return this.boundary.dispatchNonMekCore(instanceId, command);
        const prepared = await automation.prepareCommand(this.force, instanceId, command);
        const result = await this.boundary.dispatchNonMekCore(instanceId, prepared.command);
        await automation.afterCommand(
            this.force,
            instanceId,
            prepared,
            result,
            (generated, generatedAutomate = true) =>
                this.dispatchNonMekWithAutomation(instanceId, generated, generatedAutomate),
        );
        return result;
    }

    private async dispatchMekWithAutomation(
        instanceId: UnitInstanceId,
        command: CBTUnitCommand,
        automate: boolean,
    ): Promise<CBTMekUnitCommandResult> {
        const automation = automate ? this.mekAutomation() : null;
        let effectiveCommand = command;
        if (automation && command.type === 'end-turn') {
            const initial = this.boundary.snapshot(instanceId);
            if (initial && hasMekRuntime(initial)
                && command.expectedRevision === initial.query.stateRevision) {
                const movement = initial.query.mekMovementPsrState();
                const needsPhaseBoundary = initial.query.hasPendingCombat()
                    || movement.checks.some(check => check.status === 'pending')
                    || movement.automaticFalls.length > 0;
                if (needsPhaseBoundary) {
                    const phase = await this.dispatchMekWithAutomation(instanceId, {
                        type: 'end-phase',
                        commandId: createCommandId(),
                        expectedRevision: initial.query.stateRevision,
                    }, true);
                    if (!phase.accepted) return phase;
                    const refreshed = this.boundary.snapshot(instanceId);
                    if (!refreshed || !hasMekRuntime(refreshed)) {
                        return Object.freeze({
                            accepted: false,
                            reason: 'NOT_ADMITTED',
                            currentRevision: null,
                        });
                    }
                    effectiveCommand = { ...command, expectedRevision: refreshed.query.stateRevision };
                }
            }
        }
        if (!automation) return this.boundary.dispatchMekCore(instanceId, effectiveCommand);
        const before = this.boundary.snapshot(instanceId);
        const prepared = await automation.prepareCommand(this.force, instanceId, effectiveCommand);
        const result = await this.boundary.dispatchMekCore(instanceId, prepared.command);
        await automation.afterCommand(
            this.force,
            instanceId,
            before,
            prepared,
            result,
            (generated, generatedAutomate = true) =>
                this.dispatchMekWithAutomation(instanceId, generated, generatedAutomate),
        );
        return result;
    }

    private async endTurnForAllWithAutomation(): Promise<CBTForceEndTurnAllResult> {
        const instanceIds = this.boundary.instanceIds();
        if (this.boundary.readOnly()) {
            return Object.freeze({
                accepted: false,
                changed: false,
                atomic: false as const,
                results: Object.freeze(instanceIds.map(instanceId => Object.freeze({
                    instanceId,
                    accepted: false,
                    changed: false,
                    reason: 'READ_ONLY',
                }))),
            });
        }
        const results: CBTForceEndTurnUnitResult[] = [];
        for (const instanceId of instanceIds) {
            const snapshot = this.boundary.snapshot(instanceId);
            if (!snapshot) {
                results.push(Object.freeze({
                    instanceId,
                    accepted: false,
                    changed: false,
                    reason: 'NOT_ADMITTED',
                }));
                continue;
            }
            if (hasMekRuntime(snapshot)) {
                const result = await this.dispatchMek(instanceId, {
                    type: 'end-turn',
                    commandId: createCommandId(),
                    expectedRevision: snapshot.query.stateRevision,
                    policy: this.boundary.heatPolicy(),
                });
                results.push(Object.freeze({
                    instanceId,
                    accepted: result.accepted,
                    changed: result.accepted && !result.idempotent,
                    ...(!result.accepted ? { reason: result.reason } : {}),
                }));
                continue;
            }
            const result = await this.dispatchNonMek(instanceId, {
                kind: 'end-turn',
                expectedRevision: snapshot.query.stateRevision,
            });
            results.push(Object.freeze({
                instanceId,
                accepted: result.accepted,
                changed: result.accepted && result.changed,
                ...(!result.accepted ? { reason: result.reason } : {}),
            }));
        }
        return Object.freeze({
            accepted: results.every(result => result.accepted),
            changed: results.some(result => result.changed),
            atomic: false as const,
            results: Object.freeze(results),
        });
    }

    private mekAutomation(): DirectMekAutomationService | null {
        const candidate = this.injector.get(DirectMekAutomationService, null, { optional: true });
        return candidate
            && typeof candidate.prepareCommand === 'function'
            && typeof candidate.afterCommand === 'function'
            ? candidate
            : null;
    }

    private nonMekAutomation(): DirectNonMekAutomationService | null {
        const candidate = this.injector.get(DirectNonMekAutomationService, null, { optional: true });
        return candidate
            && typeof candidate.prepareCommand === 'function'
            && typeof candidate.afterCommand === 'function'
            ? candidate
            : null;
    }
}
