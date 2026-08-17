// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import { ChangeDetectionStrategy, Component, computed, inject, signal, viewChild } from '@angular/core';
import { DIALOG_DATA, DialogRef } from '@angular/cdk/dialog';
import type { CBTForceUnit } from '../../models/cbt-force-unit.model';
import { getMekLocationLabel } from '../../models/entity/types';
import {
    applyMekCriticalRoll,
    getMekExplosionProtection,
    hasRollableMekCriticalSlot,
    mekCriticalRollDiceCount,
    mekCriticalRollLocation,
    randomValidMekCriticalRoll,
    type MekCriticalRollOutcome,
} from '../../utils/mek-critical-hit.util';
import { DiceRollerComponent } from '../dice-roller/dice-roller.component';

export interface MekCriticalRollDialogData {
    readonly unit: CBTForceUnit;
    readonly location: string;
    readonly requiredHits?: number;
    readonly consolidateImmediately: boolean;
}

export interface MekCriticalRollDialogResult {
    readonly completed: boolean;
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
                    @if (data.requiredHits !== undefined) {
                        <div class="guided-progress">
                            {{ appliedHits() }} / {{ data.requiredHits }} critical hits applied
                        </div>
                    }
                    @if (explosionProtection !== 'none') {
                        <div class="explosion-protection" role="note">
                            <span class="protection-badge">{{ explosionProtectionLabel }}</span>
                            <span class="protection-note">{{ explosionProtectionNote }}</span>
                        </div>
                    }
                    <dice-roller #roller [diceCount]="diceCount" (finished)="onFinished($event)" />

                    @if (outcome(); as currentOutcome) {
                        <div class="critical-result" [class.reroll]="!currentOutcome.applied" aria-live="polite">
                            {{ outcomeLabel(currentOutcome) }}
                        </div>
                        @if (currentOutcome.explosion; as explosion) {
                            <div class="explosion-result">
                                <strong>{{ explosion.equipment }} explodes for {{ explosion.rawDamage }} damage.</strong>
                                @for (damage of explosion.locations; track damage.location) {
                                    <div>
                                        {{ locationName(damage.location) }}:
                                        {{ damage.internalDamage }} internal
                                        @if (damage.armorDamage > 0) {
                                            · {{ damage.armorDamage }} {{ damage.armorRear ? 'rear ' : '' }}armor
                                        }
                                        @if (damage.protection !== 'none') {
                                            · {{ damage.protection === 'case-ii' ? 'CASE II' : 'CASE' }}
                                        }
                                    </div>
                                }
                                <div>MechWarrior feedback: {{ explosion.pilotHits }} hit{{ explosion.pilotHits === 1 ? '' : 's' }}.</div>
                                @if (explosion.automaticCritical; as automatic) {
                                    <div>
                                        {{ automatic.equipment }} slot {{ automatic.slotNumber }}:
                                        {{ automatic.armoredAbsorption ? 'component armor absorbs the automatic critical' : 'automatic critical applied' }}.
                                    </div>
                                }
                            </div>
                        }
                        @if (currentOutcome.pendingExplosion; as pendingExplosion) {
                            <div class="explosion-result pending-explosion" role="note">
                                <strong>
                                    {{ pendingExplosion.equipment }} explosion pending
                                    ({{ pendingExplosion.rawDamage }} damage).
                                </strong>
                                <div>It resolves at phase end. Firing the weapon this phase prevents it.</div>
                            </div>
                        }
                    } @else if (!hasRollableSlot()) {
                        <div class="critical-result reroll">No valid critical slots remain; excess critical hits are discarded.</div>
                    }
                </div>
            </div>
            <div class="actions">
                <button
                    class="bt-button primary"
                    type="button"
                    [disabled]="complete() || roller.isRolling()"
                    (click)="roll()">
                    {{ rollButtonLabel() }}
                </button>
                <button class="bt-button" type="button" (click)="close()">DISMISS</button>
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
    readonly data = inject<MekCriticalRollDialogData>(DIALOG_DATA);
    readonly roller = viewChild<DiceRollerComponent>('roller');
    readonly targetLocation = mekCriticalRollLocation(this.data.unit, this.data.location);
    readonly locationLabel = this.targetLocation === this.data.location
        ? getMekLocationLabel(this.targetLocation) ?? this.targetLocation
        : `${getMekLocationLabel(this.data.location) ?? this.data.location} → ${getMekLocationLabel(this.targetLocation) ?? this.targetLocation}`;
    readonly diceCount = mekCriticalRollDiceCount(this.targetLocation);
    readonly appliedHits = signal(0);
    readonly outcome = signal<MekCriticalRollOutcome | null>(null);
    readonly discarded = signal(false);
    readonly complete = computed(() =>
        this.discarded()
        || (this.data.requiredHits !== undefined && this.appliedHits() >= this.data.requiredHits));
    readonly hasRollableSlot = computed(() => hasRollableMekCriticalSlot(
        this.data.unit,
        this.targetLocation,
        { transfer: false },
    ));
    // Keep the protection that applied when rolling began visible after an explosion destroys the location.
    readonly explosionProtection = getMekExplosionProtection(this.data.unit, this.targetLocation);
    readonly explosionProtectionLabel = this.explosionProtection === 'case-ii' ? '[CASE II]' : '[CASE]';
    readonly explosionProtectionNote = this.data.unit.gameRules.getMekExplosionProtectionNote(this.explosionProtection);

    roll(): void {
        if (this.complete()) return;
        if (!this.hasRollableSlot()) {
            this.discarded.set(true);
            return;
        }
        this.outcome.set(null);
        const results = randomValidMekCriticalRoll(
            this.data.unit,
            this.targetLocation,
            Math.random,
            { transfer: false },
        );
        if (!results) return;
        this.roller()?.roll(results);
    }

    onFinished(event: { readonly results: number[] }): void {
        const outcome = applyMekCriticalRoll(
            this.data.unit,
            this.targetLocation,
            event.results,
            this.data.consolidateImmediately,
            { transfer: false },
        );
        if (!outcome?.applied) {
            this.outcome.set(null);
            this.roll();
            return;
        }
        this.outcome.set(outcome);
        this.appliedHits.update(value => value + 1);
    }

    rollButtonLabel(): string {
        if (this.discarded()) return 'CRITICALS DISCARDED';
        if (this.complete()) return 'CRITICALS APPLIED';
        if (!this.hasRollableSlot()) return 'DISCARD REMAINING';
        if (this.data.requiredHits === undefined) return 'ROLL CRITICAL';
        return `ROLL CRITICAL (${this.appliedHits()+1}/${this.data.requiredHits})`;
    }

    outcomeLabel(outcome: MekCriticalRollOutcome): string {
        if (!outcome.applied) {
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

    close(): void {
        this.dialogRef.close({
            completed: this.data.requiredHits === undefined || this.complete(),
        });
    }
}
