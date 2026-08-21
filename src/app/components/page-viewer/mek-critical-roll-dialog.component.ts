// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import { ChangeDetectionStrategy, Component, computed, inject, signal, viewChild } from '@angular/core';
import { DIALOG_DATA, DialogRef } from '@angular/cdk/dialog';
import type { CBTForceUnit } from '../../models/cbt-force-unit.model';
import { getMekLocationLabel } from '../../models/entity/types';
import type { CriticalSlot } from '../../models/force-serialization';
import {
    getMekExplosionProtection,
    getRollableMekCriticalSlots,
    mekCriticalRollDiceCount,
    mekCriticalRollForSlot,
    mekCriticalRollLocation,
    mekCriticalSlotRollability,
    mekCriticalSlotIndexForRoll,
    randomValidMekCriticalRoll,
    type MekCriticalHitPreview,
    type MekExplosionLocationDamage,
    type MekCriticalRollOptions,
    type MekCriticalRollOutcome,
} from '../../utils/mek-critical-hit.util';
import { MekCriticalHitAutomationService } from '../../services/mek-critical-hit-automation.service';
import { DiceRollerComponent } from '../dice-roller/dice-roller.component';

export interface MekCriticalRollDialogData {
    readonly unit: CBTForceUnit;
    readonly location: string;
    readonly targetLocation?: string;
    readonly requiredHits: number;
    readonly locationDestroyed?: boolean;
    readonly consolidateImmediately: boolean;
    readonly pendingCriticalId?: string;
    readonly manual?: boolean;
    readonly caseIICheckRequired?: boolean;
    readonly caseIICheckPassed?: boolean;
    readonly caseIICheckResult?: 'resolve' | 'discard';
    readonly pilotDamageGroup?: string;
    readonly canUndoToChance?: boolean;
}

export interface MekCriticalRollDialogResult {
    readonly completed: boolean;
    readonly interruptedForConsciousness?: boolean;
    readonly remainingHits?: number;
    readonly undoToChance?: true;
}

interface CriticalSlotRow {
    readonly slotIndex: number;
    readonly slot: CriticalSlot | null;
    readonly destroyed: boolean;
}

interface CriticalExplosionDisplay {
    readonly equipment: string;
    readonly rawDamage: number;
    readonly pilotHits: number;
    readonly locations: readonly MekExplosionLocationDamage[];
    readonly phaseEnd: boolean;
    readonly automaticCriticalMessage?: string;
}

@Component({
    selector: 'mek-critical-roll-dialog',
    standalone: true,
    imports: [DiceRollerComponent],
    changeDetection: ChangeDetectionStrategy.OnPush,
    template: `
        <div class="panel glass preventZoomReset framed-borders has-shadow" (click)="$event.stopPropagation()">
            <div class="header">Critical Roll · {{ locationLabel }}</div>
            <div class="body">
                <div class="critical-dialog-body">
                    <div class="guided-progress">
                        {{ resolvedHits() }} / {{ data.requiredHits }} critical hits
                        {{ data.locationDestroyed ? 'resolved' : 'applied' }}
                    </div>
                    @if (data.locationDestroyed) {
                        <div class="explosion-protection" role="note">
                            Destroyed location: only hits on explosive components resolve; all others are discarded.
                        </div>
                    }
                    @if (explosionProtection !== 'none') {
                        <div class="explosion-protection" role="note">
                            <span class="protection-badge">{{ explosionProtectionLabel }}</span>
                            <span class="protection-note">{{ explosionProtectionNote }}</span>
                        </div>
                    }
                    @if (needsCaseIICheck()) {
                        <div class="case-ii-check" role="note">
                            <strong>CASE II critical check</strong>
                            <span>Roll 2D6 for this critical: resolve it on 2–7; discard it on 8+.</span>
                        </div>
                        <div class="critical-random-row">
                            <button
                                class="random-button large"
                                type="button"
                                aria-label="Roll the CASE II critical check"
                                title="Roll the CASE II critical check"
                                [disabled]="!canStartCaseIIRoll()"
                                (click)="rollCaseIICheck()"
                            ></button>
                            <div
                                class="critical-dice-trigger case-ii-dice-trigger"
                                role="button"
                                [attr.tabindex]="canStartCaseIIRoll() ? 0 : -1"
                                aria-label="Roll CASE II critical check dice"
                                [attr.aria-disabled]="!canStartCaseIIRoll()"
                                (click)="rollCaseIICheck()"
                                (keydown.enter)="rollCaseIICheck()"
                                (keydown.space)="rollCaseIICheck(); $event.preventDefault()"
                            >
                                <dice-roller #caseIIRoller [diceCount]="2" (finished)="onCaseIIFinished($event)" />
                            </div>
                        </div>
                        @if (caseIICheckResult(); as checkResult) {
                            <div class="critical-result" [class.no-critical]="checkResult === 'discard'" aria-live="polite">
                                {{ checkResult === 'discard'
                                    ? 'CASE II discards this critical hit.'
                                    : 'CASE II allows this critical hit.' }}
                            </div>
                        } @else {
                            <div class="case-ii-manual-options" aria-label="Enter a physical CASE II roll result">
                                <button class="bt-button primary" type="button" [disabled]="isAnyRolling()"
                                    (click)="applyCaseIICheck('resolve')">2–7 · RESOLVE CRITICAL</button>
                                <button class="bt-button danger" type="button" [disabled]="isAnyRolling()"
                                    (click)="applyCaseIICheck('discard')">8+ · DISCARD CRITICAL</button>
                            </div>
                        }
                    } @else if (selectedSlotIndex() === null) {
                        <div class="critical-random-row">
                            <button
                                class="random-button large"
                                type="button"
                                aria-label="Roll a random critical slot"
                                title="Roll a random critical slot"
                                [disabled]="!canStartRoll()"
                                (click)="roll()"
                            ></button>
                            <div
                                class="critical-dice-trigger"
                                role="button"
                                [attr.tabindex]="canStartRoll() ? 0 : -1"
                                aria-label="Roll critical slot dice"
                                [attr.aria-disabled]="!canStartRoll()"
                                (click)="roll()"
                                (keydown.enter)="roll()"
                                (keydown.space)="roll(); $event.preventDefault()"
                            >
                                <dice-roller
                                    #roller
                                    [diceCount]="diceCount"
                                    [showSum]="false"
                                    (finished)="onFinished($event)"
                                />
                            </div>
                        </div>
                    }

                    @if (outcome(); as currentOutcome) {
                        <div class="critical-result" [class.reroll]="!currentOutcome.applied" aria-live="polite">
                            {{ outcomeLabel(currentOutcome) }}
                        </div>
                        @if (currentOutcome.pendingExplosion; as pendingExplosion) {
                            <div class="explosion-result pending-explosion" role="note">
                                <strong>
                                    {{ pendingExplosion.equipment }} explosion pending
                                    ({{ pendingExplosion.rawDamage }} damage).
                                </strong>
                                <div>It resolves at phase end. Firing the weapon this phase prevents it.</div>
                            </div>
                        }
                    } @else if (currentDiscardReason(); as discardReason) {
                        <div class="critical-result no-critical" aria-live="polite">
                            {{ discardReason === 'case-ii'
                                ? 'CASE II discarded this critical hit.'
                                : 'Non-explosive physical roll recorded; critical discarded.' }}
                        </div>
                    } @else if (automationCancelled()) {
                        <div class="critical-result reroll">Critical review paused; the rolled hit has not been applied.</div>
                    } @else if (!hasRollableSlot()) {
                        <div class="critical-result reroll">No valid critical slots remain; excess critical hits are discarded.</div>
                    }
                    @if (explosionDisplay(); as explosion) {
                        <div class="explosion-result" [class.pending-explosion]="explosion.phaseEnd" role="note">
                            <strong>{{ explosion.equipment }} explosion: {{ explosion.rawDamage }} damage.</strong>
                            @for (damage of explosion.locations; track damage.location) {
                                <div>
                                    {{ locationName(damage.location) }}:
                                    @if (damage.internalDamage > 0) {
                                        {{ damage.internalDamage }} internal
                                    }
                                    @if (damage.armorDamage > 0) {
                                        @if (damage.internalDamage > 0) { · }
                                        {{ damage.armorDamage }} {{ damage.armorRear ? 'rear ' : '' }}armor
                                    }
                                    @if (damage.internalDamage === 0 && damage.armorDamage === 0) {
                                        No damage
                                    }
                                    @if (damage.protection !== 'none') {
                                        · {{ damage.protection === 'case-ii' ? 'CASE II' : 'CASE' }}
                                    }
                                </div>
                            }
                            @if (explosion.pilotHits > 0) {
                                <div>MechWarrior feedback: {{ explosion.pilotHits }} hit{{ explosion.pilotHits === 1 ? '' : 's' }}.</div>
                            }
                            @if (explosion.automaticCriticalMessage; as automaticCriticalMessage) {
                                <div>{{ automaticCriticalMessage }}</div>
                            }
                            @if (explosion.phaseEnd) {
                                <div>It resolves at phase end. Firing the weapon this phase prevents it.</div>
                            }
                        </div>
                    }
                    @if (showManualSlots()) {
                        <div class="critical-slot-options" aria-label="Choose a critical slot manually">
                            @for (row of manualSlotRows(); track row.slotIndex) {
                                @if (row.slot; as slot) {
                                    <div
                                        class="critical-slot-option"
                                        [class.critical-slot-hit]="isHighlightedSlot(slot)"
                                        [class.critical-slot-dimmed]="isDimmedSlot(slot)"
                                        [class.critical-slot-collapsed]="isCollapsedSlot(slot)"
                                    >
                                        <span class="critical-slot-number">{{ slotNumber(slot) }}</span>
                                        <span class="critical-slot-name">{{ slotLabel(slot) }}</span>
                                        @if (isSelectedSlot(slot)) {
                                            <button
                                                class="bt-button critical-slot-hit-button"
                                                type="button"
                                                [disabled]="isAnyRolling() || resolving()"
                                                (click)="undoSlotSelection()"
                                            >
                                                UNDO
                                            </button>
                                        } @else if (selectedSlotIndex() === null) {
                                            <button
                                                class="bt-button danger critical-slot-hit-button"
                                                type="button"
                                                [disabled]="!canStartRoll()"
                                                (click)="selectSlot(slot)"
                                            >
                                                HIT
                                            </button>
                                        }
                                    </div>
                                } @else {
                                    <div class="critical-slot-unavailable"
                                        [class.critical-slot-destroyed]="row.destroyed"
                                        [class.critical-slot-hit]="highlightedSlotNumber() === row.slotIndex + 1"
                                        [class.critical-slot-dimmed]="highlightedSlotNumber() !== null
                                            && highlightedSlotNumber() !== row.slotIndex + 1"
                                        aria-hidden="true"></div>
                                }
                            }
                        </div>
                        @if (canDiscardNonExplosiveResult()) {
                            <button class="bt-button critical-non-explosive-action" type="button"
                                (click)="discardCurrentCritical('non-explosive')">
                                PHYSICAL ROLL HIT A NON-EXPLOSIVE SLOT · DISCARD CRITICAL
                            </button>
                        }
                    }
                </div>
            </div>
            <div class="actions">
                <button
                    class="bt-button"
                    [class.primary]="caseIICheckResult() !== 'discard'"
                    [class.danger]="caseIICheckResult() === 'discard'"
                    type="button"
                    [disabled]="!canUsePrimary()"
                    (click)="primaryAction()">{{ primaryLabel() }}</button>
                @if (canUndoToChance()) {
                    <button class="bt-button critical-sequence-undo" type="button"
                        [disabled]="isAnyRolling() || resolving()"
                        (click)="undoToChance()">UNDO</button>
                }
                <button class="bt-button" type="button" [disabled]="isAnyRolling() || resolving()" (click)="close()">
                    {{ data.manual ? 'CANCEL' : 'CLOSE' }}
                </button>
            </div>
        </div>
    `,
    styleUrls: [
        './overlay/page-psr-warning-panel.component.scss',
        './mek-critical-dialog.component.scss',
    ],
})
export class MekCriticalRollDialogComponent {
    private readonly dialogRef = inject(DialogRef<MekCriticalRollDialogResult>);
    private readonly criticalHitAutomation = inject(MekCriticalHitAutomationService);
    readonly data = inject<MekCriticalRollDialogData>(DIALOG_DATA);
    readonly roller = viewChild<DiceRollerComponent>('roller');
    readonly caseIIRoller = viewChild<DiceRollerComponent>('caseIIRoller');
    readonly criticalRollOptions: MekCriticalRollOptions = {
        transfer: false,
        ...(this.data.locationDestroyed && { explosiveSlotsOnly: true }),
        ...(this.data.pilotDamageGroup
            ? { pilotDamageGroup: this.data.pilotDamageGroup }
            : {}),
    };
    readonly targetLocation = this.data.targetLocation ?? (this.data.locationDestroyed
        ? this.data.location
        : mekCriticalRollLocation(this.data.unit, this.data.location));
    readonly locationLabel = this.targetLocation === this.data.location
        ? getMekLocationLabel(this.targetLocation) ?? this.targetLocation
        : `${getMekLocationLabel(this.data.location) ?? this.data.location} → ${getMekLocationLabel(this.targetLocation) ?? this.targetLocation}`;
    readonly diceCount = mekCriticalRollDiceCount(this.targetLocation);
    readonly appliedHits = signal(0);
    readonly discardedHits = signal(0);
    readonly resolvedHits = computed(() => this.appliedHits() + this.discardedHits());
    readonly outcome = signal<MekCriticalRollOutcome | null>(null);
    readonly resolving = signal(false);
    readonly caseIICheckPassed = signal(this.data.caseIICheckPassed ?? false);
    readonly caseIICheckResult = signal<'resolve' | 'discard' | null>(this.data.caseIICheckResult ?? null);
    readonly currentDiscardReason = signal<'case-ii' | 'non-explosive' | null>(null);
    private readonly restoredRoll = this.data.pendingCriticalId
        ? this.data.unit.turnState().getPendingCriticalHit(this.data.pendingCriticalId)?.roll
        : undefined;
    readonly selectedSlotIndex = signal<number | null>(this.restoredRoll
        ? mekCriticalSlotIndexForRoll(this.targetLocation, this.restoredRoll)
        : null);
    readonly automationCancelled = signal(!!this.restoredRoll);
    private readonly pendingResults = signal<readonly number[] | null>(
        this.restoredRoll ? [...this.restoredRoll] : null,
    );
    readonly pendingHitPreview = computed<MekCriticalHitPreview | null>(() => {
        const results = this.pendingResults();
        return results
            ? this.criticalHitAutomation.previewRoll(
                this.data.unit,
                this.targetLocation,
                results,
                this.criticalRollOptions,
            )
            : null;
    });
    readonly explosionDisplay = computed<CriticalExplosionDisplay | null>(() => {
        const preview = this.pendingHitPreview()?.explosion;
        if (preview) {
            return {
                equipment: preview.equipment,
                rawDamage: preview.rawDamage,
                pilotHits: preview.pilotHits,
                locations: preview.locations,
                phaseEnd: preview.timing === 'phase-end',
                ...(preview.automaticCriticalEquipment
                    ? { automaticCriticalMessage: `${preview.automaticCriticalEquipment}: automatic critical will be applied.` }
                    : {}),
            };
        }

        const applied = this.outcome()?.explosion;
        if (!applied) return null;
        return {
            equipment: applied.equipment,
            rawDamage: applied.rawDamage,
            pilotHits: applied.pilotHits,
            locations: applied.locations,
            phaseEnd: false,
            ...(applied.automaticCritical
                ? {
                    automaticCriticalMessage: `${applied.automaticCritical.equipment} slot ${applied.automaticCritical.slotNumber}: ${applied.automaticCritical.armoredAbsorption
                        ? 'component armor absorbs the automatic critical'
                        : 'automatic critical applied'}.`,
                }
                : {}),
        };
    });
    readonly complete = computed(() => this.resolvedHits() >= this.data.requiredHits);
    readonly canUndoToChance = computed(() => (this.data.canUndoToChance ?? false)
        && this.resolvedHits() === 0);
    private readonly availableSlots = computed(() => getRollableMekCriticalSlots(
        this.data.unit,
        this.targetLocation,
        this.criticalRollOptions,
    ));
    private readonly lockedSlotRows = signal<readonly CriticalSlotRow[] | null>(
        this.restoredRoll ? this.createSlotRows(this.availableSlots()) : null,
    );
    readonly manualSlotRows = computed(() =>
        this.lockedSlotRows() ?? this.createSlotRows(this.availableSlots()));
    readonly hasRollableSlot = computed(() => this.availableSlots().length > 0);
    readonly isRolling = computed(() => this.roller()?.isRolling() ?? false);
    readonly isCaseIIRolling = computed(() => this.caseIIRoller()?.isRolling() ?? false);
    readonly isAnyRolling = computed(() => this.isRolling() || this.isCaseIIRolling());
    readonly needsCaseIICheck = computed(() => (this.data.caseIICheckRequired ?? false)
        && !this.caseIICheckPassed()
        && !this.complete()
        && !this.currentDiscardReason()
        && this.hasRollableSlot());
    readonly canStartCaseIIRoll = computed(() => this.needsCaseIICheck()
        && !this.isAnyRolling()
        && !this.resolving()
        && !this.caseIICheckResult());
    readonly canStartRoll = computed(() => !this.isRolling()
        && !this.needsCaseIICheck()
        && !this.resolving()
        && !this.complete()
        && !this.currentDiscardReason()
        && !this.pendingResults()
        && !this.outcome()
        && this.hasRollableSlot());
    readonly showManualSlots = computed(() => !this.needsCaseIICheck() && this.manualSlotRows().length > 0);
    readonly canDiscardNonExplosiveResult = computed(() => this.data.locationDestroyed === true
        && this.canStartRoll());
    readonly highlightedSlotNumber = computed<number | null>(() => {
        const outcome = this.outcome();
        if (outcome) return outcome.slotNumber;

        const results = this.pendingResults();
        if (!results) return null;
        const slotIndex = mekCriticalSlotIndexForRoll(this.targetLocation, results);
        return slotIndex === null ? null : slotIndex + 1;
    });
    readonly canUsePrimary = computed(() => !this.isAnyRolling()
        && !this.resolving()
        && (!!this.caseIICheckResult()
            || !!this.pendingResults()
            || !!this.outcome()
            || !!this.currentDiscardReason()
            || !this.hasRollableSlot()));
    readonly hasInterruptingConsciousness = computed(() =>
        this.data.unit.gameRules.id === 'tw'
        && this.data.unit.turnState().actionablePendingUnitChecks()
            .some(check => check.kind === 'consciousness'));
    // Keep the protection that applied when rolling began visible after an explosion destroys the location.
    readonly explosionProtection = getMekExplosionProtection(this.data.unit, this.targetLocation);
    readonly explosionProtectionLabel = this.explosionProtection === 'case-ii' ? '[CASE II]' : '[CASE]';
    readonly explosionProtectionNote = this.data.unit.gameRules.getMekExplosionProtectionNote(this.explosionProtection);

    roll(): void {
        if (!this.canStartRoll()) return;
        this.lockManualSlots();
        this.outcome.set(null);
        this.automationCancelled.set(false);
        const results = randomValidMekCriticalRoll(
            this.data.unit,
            this.targetLocation,
            Math.random,
            this.criticalRollOptions,
        );
        if (!results) return;
        this.roller()?.roll(results);
    }

    rollCaseIICheck(): void {
        if (!this.canStartCaseIIRoll()) return;
        this.caseIIRoller()?.roll();
    }

    onCaseIIFinished(event: { readonly results: readonly number[] }): void {
        const result = event.results.reduce((total, die) => total + die, 0) >= 8
            ? 'discard'
            : 'resolve';
        this.caseIICheckResult.set(result);
        const pendingId = this.data.pendingCriticalId;
        if (pendingId) this.data.unit.turnState().setPendingCriticalCaseIICheckResult(pendingId, result);
    }

    applyCaseIICheck(result: 'resolve' | 'discard'): void {
        if (this.isAnyRolling() || this.resolving() || !this.needsCaseIICheck()) return;
        if (result === 'discard') {
            this.discardCurrentCritical('case-ii');
            return;
        }
        const pendingId = this.data.pendingCriticalId;
        if (pendingId && !this.data.unit.turnState().passPendingCriticalCaseIICheck(pendingId)) return;
        this.caseIICheckPassed.set(true);
        this.caseIICheckResult.set(null);
    }

    onFinished(event: { readonly results: number[] }): void {
        this.stageResults(event.results);
    }

    selectSlot(slot: CriticalSlot): void {
        if (!this.canStartRoll() || slot.slot === undefined) return;
        this.stageResults(mekCriticalRollForSlot(this.targetLocation, slot.slot));
    }

    private stageResults(results: readonly number[]): void {
        if (this.resolving() || this.complete() || this.pendingResults() || this.outcome()) return;
        const slotIndex = mekCriticalSlotIndexForRoll(this.targetLocation, results);
        if (slotIndex === null) return;
        if (!this.persistRoll(results)) return;
        this.lockManualSlots();
        this.pendingResults.set([...results]);
        this.selectedSlotIndex.set(slotIndex);
        this.automationCancelled.set(false);
    }

    undoSlotSelection(): void {
        if (this.selectedSlotIndex() === null || !this.pendingResults()
            || this.isAnyRolling() || this.resolving()) return;
        if (!this.clearPersistedRoll()) return;
        this.pendingResults.set(null);
        this.selectedSlotIndex.set(null);
        this.automationCancelled.set(false);
        this.unlockManualSlots();
    }

    private async resolvePendingRoll(): Promise<void> {
        const results = this.pendingResults();
        if (!results || this.resolving()) return;

        this.resolving.set(true);
        const resolution = await this.criticalHitAutomation.applyRoll(
            this.data.unit,
            this.targetLocation,
            results,
            this.data.consolidateImmediately,
            this.criticalRollOptions,
        ).finally(() => this.resolving.set(false));
        if (resolution.cancelled) {
            this.automationCancelled.set(true);
            return;
        }

        this.pendingResults.set(null);
        this.selectedSlotIndex.set(null);
        this.automationCancelled.set(false);
        const outcome = resolution.outcome;
        if (!outcome?.applied) {
            if (this.data.locationDestroyed && outcome?.reason === 'non-explosive') {
                this.resolvePersistedHit();
                this.outcome.set(outcome);
                this.discardedHits.update(value => value + 1);
                if (this.complete()) this.completeDialog();
                return;
            }
            this.clearPersistedRoll();
            this.outcome.set(null);
            this.unlockManualSlots();
            this.roll();
            return;
        }
        this.resolvePersistedHit();
        this.outcome.set(outcome);
        this.appliedHits.update(value => value + 1);
        if (this.complete()) this.completeDialog(this.hasInterruptingConsciousness());
    }

    primaryLabel(): string {
        const caseIICheckResult = this.caseIICheckResult();
        if (caseIICheckResult === 'resolve') return 'RESOLVE';
        if (caseIICheckResult === 'discard') return 'DISCARD';
        if (this.outcome() && this.hasInterruptingConsciousness()) return 'CONTINUE';
        if (!this.hasRollableSlot()) return 'DISCARD';
        if (this.outcome() || this.currentDiscardReason()) return 'NEXT';
        return 'APPLY';
    }

    primaryAction(): void {
        if (!this.canUsePrimary()) return;
        const caseIICheckResult = this.caseIICheckResult();
        if (caseIICheckResult) {
            this.applyCaseIICheck(caseIICheckResult);
            return;
        }
        if (this.pendingResults()) {
            void this.resolvePendingRoll();
            return;
        }
        if (this.outcome() && this.hasInterruptingConsciousness()) {
            this.close(true);
            return;
        }
        if (!this.hasRollableSlot()) {
            this.discardPersistedHits();
            this.completeDialog();
            return;
        }
        if (this.outcome() || this.currentDiscardReason()) {
            this.outcome.set(null);
            this.currentDiscardReason.set(null);
            this.caseIICheckPassed.set(false);
            this.unlockManualSlots();
        }
    }

    outcomeLabel(outcome: MekCriticalRollOutcome): string {
        if (!outcome.applied) {
            if (outcome.reason === 'non-explosive') {
                const equipment = outcome.equipment ? `: ${outcome.equipment}` : '';
                return `Slot ${outcome.slotNumber}${equipment} is not explosive — critical discarded.`;
            }
            const reason = outcome.reason === 'already-damaged'
                ? 'already damaged'
                : outcome.reason === 'unhittable' ? 'unhittable' : 'empty';
            return `Slot ${outcome.slotNumber} is ${reason} — rerolling.`;
        }
        if (outcome.armoredAbsorption) {
            return `Slot ${outcome.slotNumber}: ${outcome.equipment} — armored slot absorbs the hit.`;
        }
        return `Slot ${outcome.slotNumber}: ${outcome.equipment} critical slot destroyed.`;
    }

    locationName(location: string): string {
        return getMekLocationLabel(location) ?? location;
    }

    slotNumber(slot: CriticalSlot): number {
        return (slot.slot ?? 0) + 1;
    }

    slotLabel(slot: CriticalSlot): string {
        return slot.name?.trim() || slot.eq?.name || 'Equipment';
    }

    isHighlightedSlot(slot: CriticalSlot): boolean {
        return this.highlightedSlotNumber() === this.slotNumber(slot);
    }

    isSelectedSlot(slot: CriticalSlot): boolean {
        return slot.slot !== undefined && this.selectedSlotIndex() === slot.slot;
    }

    isDimmedSlot(slot: CriticalSlot): boolean {
        const highlighted = this.highlightedSlotNumber();
        return highlighted !== null && highlighted !== this.slotNumber(slot);
    }

    isCollapsedSlot(slot: CriticalSlot): boolean {
        return this.selectedSlotIndex() !== null && !this.isSelectedSlot(slot);
    }

    undoToChance(): void {
        if (!this.canUndoToChance() || this.isAnyRolling() || this.resolving()) return;
        this.dialogRef.close({ completed: false, undoToChance: true });
    }

    private persistRoll(results: readonly number[]): boolean {
        const pendingId = this.data.pendingCriticalId;
        return pendingId === undefined
            || this.data.unit.turnState().setPendingCriticalRoll(pendingId, results);
    }

    private clearPersistedRoll(): boolean {
        const pendingId = this.data.pendingCriticalId;
        return pendingId === undefined
            || this.data.unit.turnState().clearPendingCriticalRoll(pendingId);
    }

    private resolvePersistedHit(): boolean {
        const pendingId = this.data.pendingCriticalId;
        return pendingId === undefined
            || this.data.unit.turnState().resolvePendingCriticalHit(pendingId);
    }

    private discardPersistedHits(): boolean {
        const pendingId = this.data.pendingCriticalId;
        return pendingId === undefined
            || this.data.unit.turnState().discardPendingCriticalHits(pendingId);
    }

    discardCurrentCritical(reason: 'case-ii' | 'non-explosive'): void {
        if (this.isAnyRolling() || this.resolving() || this.complete()) return;
        if (!this.resolvePersistedHit()) return;
        this.pendingResults.set(null);
        this.caseIICheckPassed.set(false);
        this.caseIICheckResult.set(null);
        this.currentDiscardReason.set(reason);
        this.discardedHits.update(value => value + 1);
        if (this.complete()) this.completeDialog();
    }

    private createSlotRows(slots: readonly CriticalSlot[]): readonly CriticalSlotRow[] {
        const slotsByIndex = new Map(slots.flatMap(slot =>
            slot.slot === undefined ? [] : [[slot.slot, slot] as const]));
        const slotCount = this.diceCount === 1 ? 6 : 12;
        return Array.from({ length: slotCount }, (_, slotIndex) => {
            const slot = slotsByIndex.get(slotIndex) ?? null;
            return {
                slotIndex,
                slot,
                // Color reflects why the underlying table slot is unavailable.
                // Explosion-only filtering must not hide that a component was already destroyed.
                destroyed: slot === null && mekCriticalSlotRollability(
                    this.data.unit,
                    this.targetLocation,
                    slotIndex,
                ) === 'already-damaged',
            };
        });
    }

    private lockManualSlots(): void {
        if (this.lockedSlotRows() !== null) return;
        this.lockedSlotRows.set(this.createSlotRows(this.availableSlots()));
    }

    private unlockManualSlots(): void {
        this.lockedSlotRows.set(null);
    }

    close(interruptedForConsciousness = false): void {
        if (this.roller()?.isRolling() || this.caseIIRoller()?.isRolling() || this.resolving()) return;
        const remainingHits = Math.max(0, this.data.requiredHits - this.resolvedHits());
        this.dialogRef.close({
            completed: this.complete(),
            ...(interruptedForConsciousness ? { interruptedForConsciousness: true } : {}),
            ...(interruptedForConsciousness && remainingHits > 0 ? { remainingHits } : {}),
        });
    }

    private completeDialog(interruptedForConsciousness = false): void {
        this.dialogRef.close({
            completed: true,
            ...(interruptedForConsciousness ? { interruptedForConsciousness: true } : {}),
        });
    }
}
