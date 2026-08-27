// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import { inject, Injectable } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import {
    MekCriticalChanceDialogComponent,
    type MekCriticalChanceDialogData,
} from '../components/page-viewer/mek-critical-chance-dialog.component';
import {
    MekCriticalHitDialogComponent,
    type MekCriticalHitDialogData,
    type MekCriticalHitDialogResult,
} from '../components/page-viewer/mek-critical-hit-dialog.component';
import {
    MekFloatingCriticalDialogComponent,
    type MekFloatingCriticalDialogData,
    type MekFloatingCriticalDialogResult,
} from '../components/page-viewer/mek-floating-critical-dialog.component';
import { getMekLocationLabel } from '../models/entity/types';
import type { CBTForceUnit } from '../models/cbt-force-unit.model';
import type {
    MekHitArc,
    SerializedPendingMekCritical,
    SerializedMekCriticalChanceResult,
} from '../models/force-serialization';
import type { MekExplosionProtection } from '../models/rules/game-rules';
import {
    applyMekBlowOff,
    hasRollableMekCriticalSlot,
    mekCriticalChanceCanBlowOff,
    mekCriticalChanceModifiers,
    mekCriticalRollLocation,
    randomValidMekCriticalRoll,
    resolveMekCriticalChance,
    usesIndustrialMekCriticalChanceTable,
    type MekCriticalChanceResult,
    type MekCriticalHitOptions,
} from '../utils/mek-critical-hit.util';
import { resolveMekFallHitLocation, twoD6Total } from '../utils/mek-falling.util';
import { clusterTableForUnit } from '../utils/record-sheet-reference-table';
import { isConsciousnessCheck } from '../utils/unit-check.util';
import { uuidv7 } from '../utils/uuid.util';
import { CBTAutomationToastService } from './cbt-automation-toast.service';
import { DialogsService } from './dialogs.service';
import { MekCriticalHitAutomationService } from './mek-critical-hit-automation.service';
import { ToastService } from './toast.service';
import { UnitCheckResolutionService } from './unit-check-resolution.service';

export interface PendingMekCriticalChanceRequest {
    readonly id?: string;
    readonly location: string;
    readonly locationDestroyed?: boolean;
    readonly consolidateImmediately: boolean;
    readonly explosionProtection?: MekExplosionProtection;
    readonly hardenedArmorApplies?: boolean;
    readonly throughArmorHitArc?: MekHitArc;
    readonly pilotDamageGroup?: string;
}

export interface PendingMekCriticalRequest {
    readonly id?: string;
    readonly location: string;
    readonly targetLocation?: string;
    readonly hits: number;
    readonly locationDestroyed?: boolean;
    readonly consolidateImmediately: boolean;
    readonly pilotDamageGroup?: string;
}

@Injectable({ providedIn: 'root' })
export class MekCriticalResolutionService {
    private readonly dialogsService = inject(DialogsService);
    private readonly toastService = inject(ToastService);
    private readonly automationToasts = inject(CBTAutomationToastService);
    private readonly criticalHitAutomation = inject(MekCriticalHitAutomationService);
    private readonly unitChecks = inject(UnitCheckResolutionService);
    private readonly activeUnits = new WeakSet<CBTForceUnit>();

    async queueChance(unit: CBTForceUnit, request: PendingMekCriticalChanceRequest): Promise<void> {
        const id = this.enqueueChance(unit, request);
        if (id) await this.resumeChance(unit, id);
    }

    private enqueueChance(unit: CBTForceUnit, request: PendingMekCriticalChanceRequest): string | null {
        const id = request.id ?? uuidv7();
        const queued = unit.turnState().queuePendingCriticalChance({
            id,
            location: request.location,
            ...(request.locationDestroyed ? { locationDestroyed: true } : {}),
            ...(request.consolidateImmediately ? { consolidateImmediately: true } : {}),
            ...(request.explosionProtection !== undefined
                ? { explosionProtection: request.explosionProtection }
                : {}),
            ...(request.hardenedArmorApplies !== undefined
                ? { hardenedArmorApplies: request.hardenedArmorApplies }
                : {}),
            ...(request.throughArmorHitArc !== undefined
                ? { throughArmorHitArc: request.throughArmorHitArc }
                : {}),
            pilotDamageGroup: request.pilotDamageGroup
                ?? unit.turnState().currentPilotDamageGroup(),
        });
        return queued ? id : null;
    }

    async resumeChance(
        unit: CBTForceUnit,
        pendingId?: string,
        manualResolution = false,
    ): Promise<void> {
        if (this.hasImmediateConsciousness(unit)
            && !await this.resolveImmediateConsciousness(unit)) return;
        if (!manualResolution && unit.automationMode('criticalHitChanceCheck') === 'yes') {
            const pendingHitId = await this.runExclusive(
                unit,
                () => Promise.resolve(this.resolveChanceAutomatically(unit, pendingId)),
            );
            if (pendingHitId) await this.resume(unit, pendingHitId);
            return;
        }
        const pendingHitId = await this.runExclusive(unit, async () => {
            const turnState = unit.turnState();
            const next = turnState.getNextPendingCriticalEvent();
            if (turnState.pendingFallCount() > 0
                || next?.type !== 'mek-critical-chance'
                || (pendingId !== undefined && next.id !== pendingId)) return null;
            const pending = next;

            if (pending.locationDestroyed && !hasRollableMekCriticalSlot(unit, pending.location, {
                transfer: false,
                explosiveSlotsOnly: true,
            })) {
                turnState.discardPendingCriticalChance(pending.id);
                return null;
            }

            const activePending = pending;

            const ref = this.dialogsService.createDialog<MekCriticalChanceResult | undefined>(
                MekCriticalChanceDialogComponent,
                {
                    disableClose: false,
                    data: <MekCriticalChanceDialogData>{
                        locationLabel: getMekLocationLabel(activePending.location) ?? activePending.location,
                        canBlowOff: mekCriticalChanceCanBlowOff(activePending.location),
                        industrialMek: usesIndustrialMekCriticalChanceTable(unit),
                        modifiers: mekCriticalChanceModifiers(unit, activePending.location, {
                            explosionProtection: activePending.explosionProtection,
                            hardenedArmorApplies: activePending.hardenedArmorApplies,
                        }),
                        initialResult: deserializeChanceResult(activePending.result),
                        initialRoll: activePending.roll,
                        onResultChange: result => turnState.setPendingCriticalChanceResult(
                            activePending.id,
                            result ? serializeChanceResult(result) : undefined,
                        ),
                        onRollChange: roll => turnState.setPendingCriticalChanceRoll(
                            activePending.id,
                            roll,
                        ),
                    },
                },
            );
            const result = await firstValueFrom(ref.closed);
            // Dismissal leaves the serialized check available from the overlay.
            if (!result) return null;

            if (result.kind === 'none') {
                turnState.discardPendingCriticalChance(activePending.id);
                return null;
            }
            if (result.kind === 'blown-off') {
                this.applyBlowOffResult(
                    unit,
                    activePending.location,
                    activePending.consolidateImmediately ?? false,
                );
                turnState.discardPendingCriticalChance(activePending.id);
                return null;
            }

            const queued = turnState.replacePendingCriticalChanceWithHits({
                id: activePending.id,
                targetLocation: activePending.locationDestroyed
                    ? activePending.location
                    : mekCriticalRollLocation(unit, activePending.location),
                remainingHits: result.count,
                ...(activePending.throughArmorHitArc !== undefined && unit.usesFloatingCriticals()
                    ? { floatingLocation: { hitArc: activePending.throughArmorHitArc } }
                    : {}),
                ...(unit.gameRules.id === 'tw' && activePending.explosionProtection === 'case-ii'
                    ? { caseII: { status: 'pending' as const } }
                    : {}),
            });
            if (!queued) return null;
            return activePending.id;
        });

        if (pendingHitId) await this.resume(unit, pendingHitId, manualResolution);
    }

    private resolveChanceAutomatically(unit: CBTForceUnit, pendingId?: string): string | null {
        const turnState = unit.turnState();
        const next = turnState.getNextPendingCriticalEvent();
        if (turnState.pendingFallCount() > 0
            || next?.type !== 'mek-critical-chance'
            || (pendingId !== undefined && next.id !== pendingId)) return null;
        const pending = next;

        if (pending.locationDestroyed && !hasRollableMekCriticalSlot(unit, pending.location, {
            transfer: false,
            explosiveSlotsOnly: true,
        })) {
            turnState.discardPendingCriticalChance(pending.id);
            this.automationToasts.show(
                unit,
                `Critical chance in ${getMekLocationLabel(pending.location) ?? pending.location}: no applicable critical slots`,
                'success',
            );
            return null;
        }

        const dice = pending.roll ?? [this.rollD6(), this.rollD6()] as const;
        if (!pending.roll) turnState.setPendingCriticalChanceRoll(pending.id, dice);
        const industrialMek = usesIndustrialMekCriticalChanceTable(unit);
        const total = Math.min(
            industrialMek ? 14 : 12,
            dice[0] + dice[1] + mekCriticalChanceModifiers(unit, pending.location, {
                explosionProtection: pending.explosionProtection,
                hardenedArmorApplies: pending.hardenedArmorApplies,
            }).reduce((sum, modifier) =>
                sum + (!modifier.optional || modifier.enabled !== false ? modifier.value : 0), 0),
        );
        const result = deserializeChanceResult(pending.result) ?? resolveMekCriticalChance(
            total,
            mekCriticalChanceCanBlowOff(pending.location),
            industrialMek,
        );
        if (pending.result === undefined) {
            turnState.setPendingCriticalChanceResult(pending.id, serializeChanceResult(result));
        }

        if (result.kind === 'none') {
            turnState.discardPendingCriticalChance(pending.id);
            this.automationToasts.show(
                unit,
                `Critical chance in ${getMekLocationLabel(pending.location) ?? pending.location}: no critical hits (roll ${total})`,
                'success',
            );
            return null;
        }
        if (result.kind === 'blown-off') {
            this.applyBlowOffResult(
                unit,
                pending.location,
                pending.consolidateImmediately ?? false,
                true,
            );
            turnState.discardPendingCriticalChance(pending.id);
            return null;
        }

        const floatingCritical = pending.throughArmorHitArc !== undefined && unit.usesFloatingCriticals();
        const targetLocation = pending.locationDestroyed
            ? pending.location
            : mekCriticalRollLocation(unit, pending.location);
        const queued = turnState.replacePendingCriticalChanceWithHits({
            id: pending.id,
            targetLocation,
            remainingHits: result.count,
            ...(floatingCritical
                ? { floatingLocation: { hitArc: pending.throughArmorHitArc! } }
                : {}),
            ...(unit.gameRules.id === 'tw' && pending.explosionProtection === 'case-ii'
                ? { caseII: { status: 'pending' as const } }
                : {}),
        });
        if (queued) {
            const location = floatingCritical
                ? `floating from ${getMekLocationLabel(pending.location) ?? pending.location}`
                : `in ${getMekLocationLabel(targetLocation) ?? targetLocation}`;
            this.automationToasts.show(
                unit,
                `Critical chance: ${result.count} critical hit${result.count === 1 ? '' : 's'} ${location} (roll ${total})`,
                'error',
            );
        }
        return queued ? pending.id : null;
    }

    async queue(unit: CBTForceUnit, request: PendingMekCriticalRequest): Promise<void> {
        const id = request.id ?? uuidv7();
        const queued = unit.turnState().queuePendingCriticalHits({
            id,
            location: request.location,
            targetLocation: request.targetLocation ?? request.location,
            remainingHits: request.hits,
            ...(request.locationDestroyed ? { locationDestroyed: true } : {}),
            ...(request.consolidateImmediately ? { consolidateImmediately: true } : {}),
            pilotDamageGroup: request.pilotDamageGroup
                ?? unit.turnState().currentPilotDamageGroup(),
        });
        if (queued) await this.resume(unit, id);
    }

    async resume(
        unit: CBTForceUnit,
        pendingId?: string,
        manualResolution = false,
    ): Promise<void> {
        if (!manualResolution && unit.automationMode('criticalHitChanceCheck') === 'yes') {
            await this.resumeAutomatically(unit, pendingId);
            return;
        }
        while (true) {
            if (this.hasImmediateConsciousness(unit)
                && !await this.resolveImmediateConsciousness(unit)) return;
            const opened = await this.runExclusive(unit, async () => {
                const turnState = unit.turnState();
                const next = turnState.getNextPendingCriticalEvent();
                if (turnState.pendingFallCount() > 0
                    || next?.type !== 'mek-critical-hit'
                    || (pendingId !== undefined && next.id !== pendingId)) return undefined;
                const pending = next;

                if (pending.floatingLocation) {
                    const floating = pending.floatingLocation;
                    const ref = this.dialogsService.createDialog<MekFloatingCriticalDialogResult | undefined>(
                        MekFloatingCriticalDialogComponent,
                        {
                            disableClose: false,
                            data: <MekFloatingCriticalDialogData>{
                                unit,
                                hitArc: floating.hitArc,
                                initialDice: floating.hitLocationDice,
                                initialTripodLegRoll: floating.tripodLegRoll,
                                onDraftChange: (dice, tripodLegRoll) =>
                                    turnState.setPendingFloatingCriticalLocation(
                                        pending.id,
                                        dice,
                                        tripodLegRoll,
                                    ),
                            },
                        },
                    );
                    const result = await firstValueFrom(ref.closed);
                    if (!result) return { kind: 'closed' as const, pendingId: pending.id };
                    if (result.action === 'skip') {
                        return turnState.discardPendingCriticalHits(pending.id)
                            ? { kind: 'floating-skipped' as const, pendingId: pending.id }
                            : { kind: 'closed' as const, pendingId: pending.id };
                    }
                    const targetLocation = mekCriticalRollLocation(unit, result.location);
                    if (!turnState.resolvePendingFloatingCriticalLocation(pending.id, targetLocation)) {
                        return { kind: 'closed' as const, pendingId: pending.id };
                    }
                    return { kind: 'floating-resolved' as const, pendingId: pending.id };
                }

                const ref = this.dialogsService.createDialog<MekCriticalHitDialogResult>(
                    MekCriticalHitDialogComponent,
                    {
                        disableClose: false,
                        data: <MekCriticalHitDialogData>{
                            unit,
                            location: pending.location,
                            targetLocation: pending.targetLocation,
                            requiredHits: pending.remainingHits,
                            locationDestroyed: pending.locationDestroyed ?? false,
                            consolidateImmediately: pending.consolidateImmediately ?? false,
                            pendingCriticalId: pending.id,
                            caseIICheckRequired: pending.caseII !== undefined,
                            caseIICheckPassed: pending.caseII?.status === 'passed',
                            caseIICheckResult: pending.caseII?.status === 'pending'
                                ? pending.caseII.result
                                : undefined,
                            caseIICheckRoll: pending.caseII?.status === 'pending'
                                ? pending.caseII.roll
                                : undefined,
                            pilotDamageGroup: pending.pilotDamageGroup,
                            canUndoToChance: pending.chanceOrigin !== undefined,
                        },
                    },
                );
                return {
                    kind: 'critical-hit' as const,
                    pendingId: pending.id,
                    result: await firstValueFrom(ref.closed),
                };
            });
            if (!opened) return;
            if (opened.kind === 'closed') return;
            if (opened.kind === 'floating-resolved') continue;
            if (opened.kind === 'floating-skipped') return;
            if (opened.result?.undoToChance) {
                if (unit.turnState().replacePendingCriticalHitWithChance(opened.pendingId)) {
                    await this.resumeChance(unit, opened.pendingId, manualResolution);
                }
                return;
            }
            if (!opened.result?.interruptedForConsciousness) return;
        }
    }

    private async resumeAutomatically(unit: CBTForceUnit, pendingId?: string): Promise<void> {
        while (true) {
            if (this.hasImmediateConsciousness(unit)
                && !await this.resolveImmediateConsciousness(unit)) return;
            const step = await this.runExclusive(
                unit,
                () => this.resolveCriticalHitAutomatically(unit, pendingId),
            );
            if (step !== 'continue') return;
        }
    }

    private async resolveCriticalHitAutomatically(
        unit: CBTForceUnit,
        pendingId?: string,
    ): Promise<'continue' | 'stopped'> {
        const turnState = unit.turnState();
        const next = turnState.getNextPendingCriticalEvent();
        if (turnState.pendingFallCount() > 0
            || next?.type !== 'mek-critical-hit'
            || (pendingId !== undefined && next.id !== pendingId)) return 'stopped';
        const pending = next;

        if (pending.floatingLocation) {
            return this.resolveFloatingCriticalAutomatically(unit, pending)
                ? 'continue'
                : 'stopped';
        }

        if (pending.caseII?.status === 'pending') {
            let result = pending.caseII.result;
            let dice = pending.caseII.roll;
            if (!result) {
                dice = dice ?? [this.rollD6(), this.rollD6()] as const;
                result = dice[0] + dice[1] >= 8 ? 'discard' : 'resolve';
                turnState.setPendingCriticalCaseIICheckResult(pending.id, result, dice);
            }
            this.automationToasts.show(
                unit,
                `CASE II critical check: ${result === 'discard' ? 'PASSED' : 'FAILED'}${dice ? ` (${dice[0] + dice[1]} vs 8+)` : ' (automatic)'}`,
                result === 'discard' ? 'success' : 'error',
            );
            if (result === 'discard') {
                return turnState.resolvePendingCriticalHit(pending.id) ? 'continue' : 'stopped';
            }
            return turnState.passPendingCriticalCaseIICheck(pending.id) ? 'continue' : 'stopped';
        }

        const options: MekCriticalHitOptions = {
            transfer: false,
            ...(pending.locationDestroyed ? { explosiveSlotsOnly: true } : {}),
            ...(pending.pilotDamageGroup
                ? { pilotDamageGroup: pending.pilotDamageGroup }
                : {}),
        };
        if (!hasRollableMekCriticalSlot(unit, pending.targetLocation, options)) {
            turnState.discardPendingCriticalHits(pending.id);
            this.automationToasts.show(
                unit,
                `Critical hit in ${getMekLocationLabel(pending.targetLocation) ?? pending.targetLocation}: no applicable critical slots`,
                'success',
            );
            return 'stopped';
        }

        const results = pending.roll ?? randomValidMekCriticalRoll(
            unit,
            pending.targetLocation,
            Math.random,
            options,
        );
        if (!results) {
            turnState.discardPendingCriticalHits(pending.id);
            this.automationToasts.show(
                unit,
                `Critical hit in ${getMekLocationLabel(pending.targetLocation) ?? pending.targetLocation}: no applicable critical slots`,
                'success',
            );
            return 'stopped';
        }
        if (!pending.roll && !turnState.setPendingCriticalRoll(pending.id, results)) return 'stopped';

        const resolution = await this.criticalHitAutomation.applyRoll(
            unit,
            pending.targetLocation,
            results,
            pending.consolidateImmediately ?? false,
            options,
        );
        if (resolution.cancelled) return 'stopped';
        if (resolution.outcome?.applied) {
            const equipment = resolution.outcome.equipment ?? `slot ${resolution.outcome.slotNumber}`;
            this.automationToasts.show(
                unit,
                `Critical hit in ${getMekLocationLabel(pending.targetLocation) ?? pending.targetLocation}: ${equipment} (slot ${resolution.outcome.slotNumber})${resolution.outcome.armoredAbsorption ? '; component armor absorbed the hit' : ''}`,
                'error',
            );
        }
        if (!resolution.outcome?.applied) {
            if (pending.locationDestroyed && resolution.outcome?.reason === 'non-explosive') {
                return turnState.resolvePendingCriticalHit(pending.id) ? 'continue' : 'stopped';
            }
            turnState.clearPendingCriticalRoll(pending.id);
            return 'continue';
        }
        return turnState.resolvePendingCriticalHit(pending.id) ? 'continue' : 'stopped';
    }

    private resolveFloatingCriticalAutomatically(
        unit: CBTForceUnit,
        pending: SerializedPendingMekCritical,
    ): boolean {
        const floating = pending.floatingLocation;
        if (!floating) return false;
        const dice = floating.hitLocationDice ?? [this.rollD6(), this.rollD6()] as const;
        const locationRoll = twoD6Total(dice);
        const table = clusterTableForUnit(unit.getUnit()).hitLocationTable ?? 'biped';
        const preliminary = resolveMekFallHitLocation(table, floating.hitArc, locationRoll);
        const needsTripodLeg = preliminary.location === null
            && preliminary.tripodLegModifier !== undefined;
        const tripodLegRoll = needsTripodLeg
            ? floating.tripodLegRoll ?? this.rollD6()
            : null;
        const result = resolveMekFallHitLocation(
            table,
            floating.hitArc,
            locationRoll,
            tripodLegRoll ?? undefined,
        );
        if (!result.location) return false;

        unit.turnState().setPendingFloatingCriticalLocation(
            pending.id,
            dice,
            tripodLegRoll,
        );
        const targetLocation = mekCriticalRollLocation(unit, result.location);
        const resolved = unit.turnState().resolvePendingFloatingCriticalLocation(
            pending.id,
            targetLocation,
        );
        if (resolved) {
            this.automationToasts.show(
                unit,
                `Floating critical location: ${getMekLocationLabel(targetLocation) ?? targetLocation} (roll ${locationRoll})`,
                'info',
            );
        }
        return resolved;
    }

    async openManual(unit: CBTForceUnit, location: string, consolidateImmediately: boolean): Promise<void> {
        await this.runExclusive(unit, async () => {
            await this.runManualHits(unit, {
                location,
                targetLocation: mekCriticalRollLocation(unit, location),
                hits: 1,
                consolidateImmediately,
            }, false);
        });
    }

    async openManualChance(unit: CBTForceUnit, location: string, consolidateImmediately: boolean): Promise<void> {
        await this.runExclusive(unit, async () => {
            while (true) {
                const result = await this.openManualChanceStep(unit, location);
                if (!result || result.kind === 'none') return;
                if (result.kind === 'blown-off') {
                    this.applyBlowOffResult(unit, location, consolidateImmediately);
                    return;
                }

                const hitResult = await this.runManualHits(unit, {
                    location,
                    targetLocation: mekCriticalRollLocation(unit, location),
                    hits: result.count,
                    consolidateImmediately,
                }, true);
                if (hitResult !== 'undo') return;
            }
        });
    }

    private async openManualChanceStep(
        unit: CBTForceUnit,
        location: string,
    ): Promise<MekCriticalChanceResult | undefined> {
        const ref = this.dialogsService.createDialog<MekCriticalChanceResult | undefined>(
            MekCriticalChanceDialogComponent,
            {
                disableClose: false,
                data: <MekCriticalChanceDialogData>{
                    locationLabel: getMekLocationLabel(location) ?? location,
                    canBlowOff: mekCriticalChanceCanBlowOff(location),
                    industrialMek: usesIndustrialMekCriticalChanceTable(unit),
                    modifiers: mekCriticalChanceModifiers(unit, location),
                    manual: true,
                },
            },
        );
        return firstValueFrom(ref.closed);
    }

    private async runManualHits(
        unit: CBTForceUnit,
        request: Omit<PendingMekCriticalRequest, 'id'>,
        canUndoToChance: boolean,
    ): Promise<'done' | 'cancelled' | 'undo'> {
        let remainingHits = request.hits;
        let undoAvailable = canUndoToChance;

        while (remainingHits > 0) {
            if (this.hasImmediateConsciousness(unit)
                && !await this.resolveImmediateConsciousness(unit)) return 'cancelled';

            const ref = this.dialogsService.createDialog<MekCriticalHitDialogResult>(
                MekCriticalHitDialogComponent,
                {
                    disableClose: false,
                    data: <MekCriticalHitDialogData>{
                        unit,
                        location: request.location,
                        targetLocation: request.targetLocation ?? request.location,
                        requiredHits: remainingHits,
                        locationDestroyed: request.locationDestroyed ?? false,
                        consolidateImmediately: request.consolidateImmediately,
                        pilotDamageGroup: request.pilotDamageGroup
                            ?? unit.turnState().currentPilotDamageGroup(),
                        canUndoToChance: undoAvailable,
                        manual: true,
                    },
                },
            );
            const result = await firstValueFrom(ref.closed);
            if (result?.undoToChance && undoAvailable) return 'undo';
            if (!result?.interruptedForConsciousness) {
                return result?.completed ? 'done' : 'cancelled';
            }

            remainingHits = result.remainingHits ?? (result.completed ? 0 : remainingHits);
            undoAvailable = false;
            if (!await this.resolveImmediateConsciousness(unit)) return 'cancelled';
            if (result.completed || remainingHits === 0) return 'done';
        }
        return 'done';
    }

    private applyBlowOffResult(
        unit: CBTForceUnit,
        location: string,
        consolidateImmediately: boolean,
        automatic = false,
    ): void {
        const blowOff = applyMekBlowOff(unit, location, consolidateImmediately);
        if (blowOff.kind === 'absorbed') {
            const message = `Critical chance in ${getMekLocationLabel(location) ?? location}: armored ${blowOff.equipment} absorbed the blow-off result`;
            if (automatic) this.automationToasts.show(unit, message, 'success');
            else this.toastService.showToast(`Armored ${blowOff.equipment} absorbs the blow-off result`, 'info');
            return;
        }
        const message = `${getMekLocationLabel(location) ?? location} blown off`;
        if (automatic) this.automationToasts.show(unit, `Critical chance: ${message}`, 'error');
        else this.toastService.showToast(message, 'error');
    }

    private async runExclusive<T>(unit: CBTForceUnit, action: () => Promise<T>): Promise<T | undefined> {
        if (this.activeUnits.has(unit)) return undefined;
        this.activeUnits.add(unit);
        try {
            return await action();
        } finally {
            this.activeUnits.delete(unit);
        }
    }

    private async resolveImmediateConsciousness(unit: CBTForceUnit): Promise<boolean> {
        await this.unitChecks.open([unit]);
        return !this.hasImmediateConsciousness(unit);
    }

    private hasImmediateConsciousness(unit: CBTForceUnit): boolean {
        return !unit.gameRules.aggregatedEndPhaseConsciousRolls
            && unit.turnState().actionablePendingUnitChecks()
                .some(isConsciousnessCheck);
    }

    private rollD6(): number {
        return Math.floor(Math.random() * 6) + 1;
    }

}

function serializeChanceResult(result: MekCriticalChanceResult): SerializedMekCriticalChanceResult {
    return result.kind === 'critical-hits' ? result.count : result.kind;
}

function deserializeChanceResult(
    result: SerializedMekCriticalChanceResult | undefined,
): MekCriticalChanceResult | undefined {
    if (result === undefined) return undefined;
    return typeof result === 'number' ? { kind: 'critical-hits', count: result } : { kind: result };
}
