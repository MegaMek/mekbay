// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import { inject, Injectable } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import {
    PendingUnitCheckDialogComponent,
    type PendingUnitCheckDialogData,
} from '../components/pending-unit-check-dialog/pending-unit-check-dialog.component';
import type { CBTForceUnit } from '../models/cbt-force-unit.model';
import { getMekLocationLabel } from '../models/entity/types';
import type { SerializedPendingUnitCheck } from '../models/force-serialization';
import type { PSRCheck } from '../models/rules/unit-type-rules';
import {
    UNIT_CHECK_CAUSE,
    UNIT_CHECK_KIND,
    type PendingUnitCheckKind,
    type UnitCheckCause,
    unitCheckIsCrewOwned,
    unitCheckNotificationGroupLabel,
} from '../models/unit-check.model';
import {
    getPreferredHeatAmmoExplosionCandidates,
    type HeatAmmoExplosionCandidate,
} from '../utils/heat-effects.util';
import { applyMekHeatAmmoExplosion } from '../utils/mek-critical-hit.util';
import {
    canRetryAeroControlRecovery,
    isAeroControlRecoveryCheck,
    isAmmoExplosionCheck,
    isHeatControlRecoveryCheck,
    isPendingUnitCheckEntry,
    pendingCheckReviewEntryKey,
    pendingCheckReviewGroupList,
    pendingPsrCommittedOutcome,
    pendingUnitCheckAutomaticEffect,
    pendingUnitCheckAutomationKey,
    pendingUnitCheckCrewId,
    pendingUnitCheckIsApprovedAutomatic,
    pendingUnitCheckIsResolved,
    pendingUnitCheckLabel,
    type PendingCheckReviewEntry,
    type PendingUnitCheckEntry,
    type PendingUnitCheckOf,
    pendingUnitCheckGroupStage,
    pendingUnitCheckOutcome,
    pendingUnitCheckUsesPilotAutomation,
} from '../utils/unit-check.util';
import { uuidv7 } from '../utils/uuid.util';
import { CBTAutomationToastService } from './cbt-automation-toast.service';
import { DialogsService } from './dialogs.service';
import { OptionsService } from './options.service';
import { ToastService } from './toast.service';

interface AutomaticCheckNotification {
    readonly check: SerializedPendingUnitCheck;
    readonly effect: string | null;
}

@Injectable({ providedIn: 'root' })
export class UnitCheckResolutionService {
    private readonly dialogs = inject(DialogsService);
    private readonly options = inject(OptionsService);
    private readonly toasts = inject(ToastService);
    private readonly automationToasts = inject(CBTAutomationToastService);
    private active = false;

    async open(
        units: readonly CBTForceUnit[],
        atPhaseEnd = false,
        manualResolution = false,
    ): Promise<boolean> {
        const uniqueUnits = Array.from(new Map(units.map(unit => [unit.id, unit])).values());
        if (this.active) return false;
        this.discardDisabledPilotAutomation(uniqueUnits);
        uniqueUnits.forEach(unit => unit.turnState().refreshPendingUnitCheckTargets());
        this.applyAutomaticUnitCheckStages(uniqueUnits, atPhaseEnd, manualResolution);
        if (pendingCheckReviewGroupList(uniqueUnits, atPhaseEnd, manualResolution).length === 0) return true;

        this.active = true;
        try {
            const ref = this.dialogs.createDialog<boolean>(PendingUnitCheckDialogComponent, {
                disableClose: false,
                data: <PendingUnitCheckDialogData>{
                    units: uniqueUnits,
                    atPhaseEnd,
                    manualResolution,
                    applyResolved: (entries, forcedPsrFailures) => {
                        this.applyResolved(entries, atPhaseEnd, forcedPsrFailures, manualResolution);
                        this.applyAutomaticUnitCheckStages(
                            uniqueUnits,
                            atPhaseEnd,
                            manualResolution,
                        );
                    },
                },
            });
            return (await firstValueFrom(ref.closed)) === true;
        } finally {
            this.active = false;
        }
    }

    private discardDisabledPilotAutomation(units: readonly CBTForceUnit[]): void {
        if (this.options.cbtAutomationMode('pilotHitsAndConsciousnessCheck') !== 'no') return;
        units.forEach(unit => unit.turnState().discardPendingUnitChecks(check =>
            pendingUnitCheckUsesPilotAutomation(check)));
    }

    /** Rolls and applies every currently actionable check whose automation is set to YES. */
    private applyAutomaticUnitCheckStages(
        units: readonly CBTForceUnit[],
        atPhaseEnd: boolean,
        manualResolution: boolean,
    ): void {
        while (true) {
            const stage = pendingUnitCheckGroupStage(units, atPhaseEnd);
            if (stage.length === 0) return;

            const automatic = stage.filter(({ check }) =>
                (!manualResolution
                    && this.options.cbtAutomationMode(pendingUnitCheckAutomationKey(check)) === 'yes')
                || pendingUnitCheckIsApprovedAutomatic(check));
            if (automatic.length === 0) return;

            const resolved = automatic.flatMap(({ unit, check }) => {
                const notify = !manualResolution
                    && this.options.cbtAutomationMode(pendingUnitCheckAutomationKey(check)) === 'yes';
                let current = unit.turnState().getPendingUnitCheck(check.id);
                if (!current) return [];

                if (pendingUnitCheckOutcome(current) === undefined) {
                    if (current.target === undefined) return [];
                    const dice = [this.rollD6(), this.rollD6()] as const;
                    const outcome = dice[0] + dice[1] >= current.target ? 'success' : 'failed';
                    if (!unit.turnState().setPendingUnitCheckOutcome(current.id, outcome, dice)) return [];
                    current = unit.turnState().getPendingUnitCheck(current.id);
                    if (!current) return [];
                }

                if (isAmmoExplosionCheck(current) && pendingUnitCheckOutcome(current) === 'failed') {
                    const choices = getPreferredHeatAmmoExplosionCandidates(unit);
                    if (choices.length > 0 && !current.selectionId) {
                        const choice = choices[Math.floor(Math.random() * choices.length)];
                        unit.turnState().setPendingUnitCheckSelection(current.id, choice.id);
                        current = unit.turnState().getPendingUnitCheck(current.id);
                        if (!current) return [];
                    }
                }

                return pendingUnitCheckIsResolved(unit, current)
                    ? [{ unit, check: current, notify }]
                    : [];
            });
            if (resolved.length === 0) return;

            const touchedUnits = new Set<CBTForceUnit>();
            const notifications = new Map<CBTForceUnit, AutomaticCheckNotification[]>();
            resolved.forEach(({ unit, check, notify }) => {
                const effect = this.applyOutcome(unit, check);
                if (notify) {
                    const unitNotifications = notifications.get(unit) ?? [];
                    unitNotifications.push({ check, effect });
                    notifications.set(unit, unitNotifications);
                }
                touchedUnits.add(unit);
            });
            notifications.forEach((results, unit) => this.showAutomaticCheckToasts(unit, results));
            touchedUnits.forEach(unit => unit.turnState().refreshPendingUnitCheckTargets());
        }
    }

    private rollD6(): number {
        return Math.floor(Math.random() * 6) + 1;
    }

    private showAutomaticCheckToast(
        unit: CBTForceUnit,
        check: SerializedPendingUnitCheck,
        effect: string | null,
    ): void {
        const outcome = pendingUnitCheckOutcome(check);
        if (!outcome) return;
        this.automationToasts.show(
            unit,
            `${pendingUnitCheckLabel(check)}: ${this.automaticCheckResultText(check, effect)}`,
            outcome === 'success' ? 'success' : 'error',
        );
    }

    private showAutomaticCheckToasts(
        unit: CBTForceUnit,
        results: readonly AutomaticCheckNotification[],
    ): void {
        const crewGroups = new Map<PendingUnitCheckKind, AutomaticCheckNotification[]>();
        for (const result of results) {
            if (!unitCheckIsCrewOwned(result.check.kind)) {
                this.showAutomaticCheckToast(unit, result.check, result.effect);
                continue;
            }
            const group = crewGroups.get(result.check.kind) ?? [];
            group.push(result);
            crewGroups.set(result.check.kind, group);
        }

        for (const [kind, group] of crewGroups) {
            if (group.length === 1) {
                const result = group[0];
                this.showAutomaticCheckToast(unit, result.check, result.effect);
                continue;
            }
            const failed = group.some(({ check }) => pendingUnitCheckOutcome(check) === 'failed');
            const summaries = group.map(({ check, effect }) => {
                const crewId = pendingUnitCheckCrewId(check);
                const crewName = unit.getCrewMember(crewId)?.getName?.() || `Crew ${crewId + 1}`;
                return `${crewName}: ${this.automaticCheckResultText(check, effect)}`;
            });
            this.automationToasts.show(
                unit,
                `${unitCheckNotificationGroupLabel(kind)} — ${summaries.join('; ')}`,
                failed ? 'error' : 'success',
            );
        }
    }

    private automaticCheckResultText(
        check: SerializedPendingUnitCheck,
        effect: string | null,
    ): string {
        const outcome = pendingUnitCheckOutcome(check);
        if (!outcome) return '';
        const result = check.result;
        const detail = result?.kind === 'roll' && check.target !== undefined
            ? ` (${result.dice[0] + result.dice[1]} vs ${check.target}+)`
            : result?.kind === 'automatic'
                ? ' (automatic)'
                : '';
        return `${outcome === 'success' ? 'PASSED' : 'FAILED'}${detail}${effect ? ` — ${effect}` : ''}`;
    }

    private applyResolved(
        entries: readonly PendingCheckReviewEntry[],
        atPhaseEnd = false,
        forcedPsrFailures: ReadonlySet<string> = new Set<string>(),
        manualResolution = false,
    ): void {
        const units = Array.from(new Map(entries.map(entry => [entry.unit.id, entry.unit])).values());
        const submittedUnitChecks = new Map<CBTForceUnit, Set<string>>();
        const submittedPsrs = new Map<CBTForceUnit, Set<string>>();
        for (const entry of entries) {
            const submitted = isPendingUnitCheckEntry(entry) ? submittedUnitChecks : submittedPsrs;
            const ids = submitted.get(entry.unit) ?? new Set<string>();
            if (!entry.check.id) continue;
            ids.add(entry.check.id);
            submitted.set(entry.unit, ids);
        }

        // The dialog reviews the full list at once, but effects are still
        // applied one rules stage at a time. A newly-created interrupt is not
        // in the submitted list, so it pauses the loop and becomes the next row.
        while (true) {
            const stage = pendingUnitCheckGroupStage(units, atPhaseEnd);
            if (stage.length > 0) {
                const resolved: PendingUnitCheckEntry[] = [];
                for (const { unit, check } of stage) {
                    const current = unit.turnState().getPendingUnitCheck(check.id);
                    if (!submittedUnitChecks.get(unit)?.has(check.id)
                        || !current
                        || !pendingUnitCheckIsResolved(unit, current)) return;
                    resolved.push({ unit, check: current });
                }

                const touchedUnits = new Set<CBTForceUnit>();
                for (const { unit, check } of resolved) {
                    this.applyOutcome(unit, check);
                    touchedUnits.add(unit);
                }
                touchedUnits.forEach(unit => unit.turnState().refreshPendingUnitCheckTargets());
                continue;
            }

            const psrEntries = pendingCheckReviewGroupList(units, atPhaseEnd, manualResolution)
                .filter(entry => !isPendingUnitCheckEntry(entry));
            if (psrEntries.length === 0) return;

            const resolvedPsrs = psrEntries.flatMap(entry => {
                const checkId = entry.check.id;
                if (!checkId || !submittedPsrs.get(entry.unit)?.has(checkId)) return [];
                const current = entry.unit.turnState().getPSRChecks()
                    .find(check => check.id === checkId);
                if (!current) return [];
                const outcome = forcedPsrFailures.has(pendingCheckReviewEntryKey(entry))
                    ? 'failed'
                    : pendingPsrCommittedOutcome(entry.unit, current)
                        ?? entry.unit.psrOutcomeSelections()[checkId];
                return outcome ? [{ unit: entry.unit, check: current, outcome }] : [];
            });
            if (resolvedPsrs.length !== psrEntries.length) return;

            const appliedIds = new Map<CBTForceUnit, Set<string>>();
            for (const { unit, check, outcome } of resolvedPsrs) {
                this.applyPsrOutcome(unit, check, outcome);
                const ids = appliedIds.get(unit) ?? new Set<string>();
                ids.add(check.id!);
                appliedIds.set(unit, ids);
            }
            for (const [unit, ids] of appliedIds) {
                unit.psrOutcomeSelections.update(current => Object.fromEntries(
                    Object.entries(current).filter(([id]) => !ids.has(id)),
                ));
                unit.psrDiceSelections.update(current => Object.fromEntries(
                    Object.entries(current).filter(([id]) => !ids.has(id)),
                ));
                unit.turnState().refreshPendingUnitCheckTargets();
            }
        }
    }

    private applyPsrOutcome(
        unit: CBTForceUnit,
        check: PSRCheck,
        outcome: 'success' | 'failed',
    ): void {
        if (check.resolution) {
            unit.resolveRuleCheck(check.resolution.key, check.resolution.token, outcome);
        } else if (check.id) {
            unit.turnState().resolvePSRCheck(check.id, outcome);
        }
    }

    private applyOutcome(unit: CBTForceUnit, check: SerializedPendingUnitCheck): string | null {
        const outcome = pendingUnitCheckOutcome(check);
        if (!outcome) return null;
        let appliedEffect: string | null = null;

        switch (check.kind) {
            case UNIT_CHECK_KIND.HEAT_SHUTDOWN:
                this.applyShutdown(unit, check, outcome);
                break;
            case UNIT_CHECK_KIND.SHUTDOWN_RECOVERY:
                if (outcome === 'success') unit.setCondition('shutdown', false);
                break;
            case UNIT_CHECK_KIND.HEAT_AMMO_EXPLOSION:
                if (outcome === 'failed') appliedEffect = this.applyAmmoExplosion(unit, check);
                break;
            case UNIT_CHECK_KIND.HEAT_RANDOM_MOVEMENT:
                this.applyRandomMovement(unit, check, outcome);
                break;
            case UNIT_CHECK_KIND.HEAT_PILOT_DAMAGE:
            case UNIT_CHECK_KIND.HEAT_LIFE_SUPPORT:
                if (outcome === 'failed') {
                    appliedEffect = this.pilotHitsAppliedEffect(
                        unit.applyHeatCrewHits(check.hits, check.pilotDamageGroup),
                    );
                }
                break;
            case UNIT_CHECK_KIND.LIFE_SUPPORT_DROWNING:
                if (outcome === 'failed') {
                    appliedEffect = this.pilotHitsAppliedEffect(
                        unit.applyLifeSupportDrowningCrewHits(check.hits, check.pilotDamageGroup),
                    );
                }
                break;
            case UNIT_CHECK_KIND.SEATBELT:
                if (outcome === 'failed') {
                    appliedEffect = this.pilotHitsAppliedEffect(
                        unit.applyPilotHits(1, check.pilotDamageGroup, check.crewId),
                    );
                }
                break;
            case UNIT_CHECK_KIND.CONSCIOUSNESS:
                this.applyConsciousness(unit, check, outcome);
                break;
            case UNIT_CHECK_KIND.CONSCIOUSNESS_RECOVERY:
                this.applyConsciousnessRecovery(unit, check, outcome);
                break;
            case UNIT_CHECK_KIND.AERO_CONTROL_RECOVERY:
                this.applyAeroControlRecovery(unit, check, outcome);
                break;
        }
        unit.turnState().discardPendingUnitCheck(check.id);
        return appliedEffect ?? pendingUnitCheckAutomaticEffect(check, outcome);
    }

    private applyShutdown(
        unit: CBTForceUnit,
        check: PendingUnitCheckOf<typeof UNIT_CHECK_KIND.HEAT_SHUTDOWN>,
        outcome: 'success' | 'failed',
    ): void {
        if (outcome === 'success') return;
        const newlyShutdown = !unit.getCondition('shutdown');
        unit.setCondition('shutdown', true);
        if (newlyShutdown && unit.gameRules.id === 'tw' && unit.getUnit().type === 'Mek') {
            unit.turnState().setPSRCheckState({
                ...unit.turnState().getPSRCheckState(),
                shutdown: true,
            });
        }
        if (check.target === undefined
            && this.options.cbtAutomationMode('heatEffectsCheck') !== 'yes') {
            this.toasts.showToast('Automatic shutdown from heat', 'error');
        }
    }

    private applyAmmoExplosion(
        unit: CBTForceUnit,
        check: PendingUnitCheckOf<typeof UNIT_CHECK_KIND.HEAT_AMMO_EXPLOSION>,
    ): string {
        const choices = getPreferredHeatAmmoExplosionCandidates(unit);
        const candidate = choices.find(choice => choice.id === check.selectionId)
            ?? (choices.length === 1 ? choices[0] : undefined);
        if (!candidate) {
            return 'no eligible ammunition remains; no explosion applied';
        }

        if (unit.getUnit().type === 'Aero') {
            return this.applyAeroAmmoExplosion(unit, candidate, check.pilotDamageGroup)
                ?? 'no ammunition explosion applied';
        }

        const explosion = applyMekHeatAmmoExplosion(unit, candidate.id, check.pilotDamageGroup);
        if (!explosion) return 'no ammunition explosion applied';
        const details = [
            `${explosion.equipment} exploded for ${explosion.rawDamage} damage in ${this.locationLabel(candidate.location)}`,
        ];
        if (explosion.pilotHits > 0) details.push(this.pilotHitsAppliedEffect(explosion.pilotHits));
        if (explosion.automaticCritical) {
            details.push(
                `automatic critical: ${explosion.automaticCritical.equipment} in ${this.locationLabel(explosion.automaticCritical.location)} (slot ${explosion.automaticCritical.slotNumber})`,
            );
        }
        return details.join('; ');
    }

    private applyAeroAmmoExplosion(
        unit: CBTForceUnit,
        candidate: HeatAmmoExplosionCandidate,
        pilotHitGroup?: string,
    ): string | null {
        const entry = candidate.entry;
        if (!entry) return null;
        const caseProtected = unit.getInventory().some(item =>
            item.equipment?.hasAnyFlag(['F_CASE', 'F_CASE_P', 'F_CASE_II'])
            && unit.isEquipmentOperational(item));
        const siDamage = Math.max(1, Math.floor(candidate.rawDamage / (caseProtected ? 20 : 10)));

        for (const snapshot of entry.critSlots ?? []) {
            const slot = unit.findCurrentCriticalSlot(snapshot);
            if (!slot || slot.destroyed) continue;
            unit.applyHitToCritSlot(slot, Math.max(1, (slot.armored ? 2 : 1) - (slot.hits ?? 0)), true);
        }
        entry.setPendingDestroyed(undefined);
        entry.setCommittedDestroyed(true);
        unit.setInventoryEntry(entry);
        unit.addInternalHits('SI', siDamage, true);
        const pilotHits = unit.applyInternalExplosionCrewHits(1, pilotHitGroup);
        return `${candidate.equipment} exploded for ${candidate.rawDamage} damage in ${this.locationLabel(candidate.location)}; ${siDamage} SI damage applied; ${this.pilotHitsAppliedEffect(pilotHits)}`;
    }

    private pilotHitsAppliedEffect(hits: number): string {
        return hits > 0
            ? `${hits} pilot hit${hits === 1 ? '' : 's'} applied`
            : 'no pilot hits applied';
    }

    private locationLabel(location: string | undefined): string {
        return location ? getMekLocationLabel(location) ?? location : 'unknown location';
    }

    private applyRandomMovement(
        unit: CBTForceUnit,
        check: PendingUnitCheckOf<typeof UNIT_CHECK_KIND.HEAT_RANDOM_MOVEMENT>,
        outcome: 'success' | 'failed',
    ): void {
        if (outcome === 'success') {
            const hasHeatControlEffect = unit.turnState().getPendingUnitChecks()
                .some(isHeatControlRecoveryCheck);
            if (check.target === undefined) {
                const endedHeatControlEffect = unit.turnState()
                    .discardPendingUnitChecks(isHeatControlRecoveryCheck) > 0;
                if (endedHeatControlEffect) {
                    unit.setCondition('out-of-control', false);
                    unit.setCondition('random-movement', false);
                }
            } else if (hasHeatControlEffect) {
                // A successful repeat Avoid Roll suppresses heat-generated
                // random movement next turn, but the unit remains out of control
                // until its separate Control Roll succeeds.
                unit.setCondition('random-movement', false);
            }
            return;
        }

        unit.setCondition('random-movement', true);
        unit.setCondition('out-of-control', true);
        this.queueAeroControlRecovery(unit, 1, UNIT_CHECK_CAUSE.HEAT_RANDOM_MOVEMENT);
    }

    private applyConsciousness(
        unit: CBTForceUnit,
        check: PendingUnitCheckOf<typeof UNIT_CHECK_KIND.CONSCIOUSNESS>,
        outcome: 'success' | 'failed',
    ): void {
        if (outcome === 'success') return;
        const crewId = check.crewId;
        const crew = unit.getCrewMember(crewId);
        if (!crew || crew.getState() === 'dead' || crew.getState() === 'ejected') return;

        const recoveryDelay = 1;
        unit.setCrewState(crewId, 'unconscious', recoveryDelay);
        if (unit.rules.getActivePilotCrewId() === null) {
            unit.turnState().failPendingPSRChecks();
            if (unit.getUnit().type === 'Aero' && unit.turnState().airborne() !== false) {
                unit.setCondition('out-of-control', true);
                this.queueAeroControlRecovery(unit, recoveryDelay);
            }
        }
    }

    private applyConsciousnessRecovery(
        unit: CBTForceUnit,
        check: PendingUnitCheckOf<typeof UNIT_CHECK_KIND.CONSCIOUSNESS_RECOVERY>,
        outcome: 'success' | 'failed',
    ): void {
        const crewId = check.crewId;
        const crew = unit.getCrewMember(crewId);
        if (!crew || crew.getState() !== 'unconscious') return;
        if (outcome === 'success') {
            unit.setCrewState(crewId, 'healthy');
            return;
        }
        unit.queueConsciousnessRecovery(crewId, 1, check.id);
    }

    private applyAeroControlRecovery(
        unit: CBTForceUnit,
        check: PendingUnitCheckOf<typeof UNIT_CHECK_KIND.AERO_CONTROL_RECOVERY>,
        outcome: 'success' | 'failed',
    ): void {
        if (outcome === 'success') {
            unit.setCondition('out-of-control', false);
            if (check.cause === UNIT_CHECK_CAUSE.HEAT_RANDOM_MOVEMENT) {
                unit.setCondition('random-movement', false);
            }
            return;
        }
        if (!canRetryAeroControlRecovery(unit)) return;
        unit.turnState().queuePendingUnitCheck({
            id: uuidv7(),
            kind: UNIT_CHECK_KIND.AERO_CONTROL_RECOVERY,
            ...(check.cause ? { cause: check.cause } : {}),
            ...this.aeroControlResolution(unit),
            readyTurn: unit.turnState().getTurnCounter() + 1,
        });
    }

    private queueAeroControlRecovery(
        unit: CBTForceUnit,
        delay: number,
        cause?: UnitCheckCause,
    ): boolean {
        if (unit.turnState().getPendingUnitChecks().some(isAeroControlRecoveryCheck)) return false;
        return unit.turnState().queuePendingUnitCheck({
            id: uuidv7(),
            kind: UNIT_CHECK_KIND.AERO_CONTROL_RECOVERY,
            ...(cause ? { cause } : {}),
            ...this.aeroControlResolution(unit),
            readyTurn: unit.turnState().getTurnCounter() + Math.max(1, Math.trunc(delay)),
        });
    }

    private aeroControlResolution(
        unit: CBTForceUnit,
    ): { target: number } | { result: { kind: 'automatic'; outcome: 'failed' } } {
        const target = unit.rules.getStandardControlRollTarget();
        return target <= 12 && (unit.rules.isRemoteDrone() || unit.rules.getActivePilotCrewId() !== null)
            ? { target }
            : { result: { kind: 'automatic', outcome: 'failed' } };
    }
}
