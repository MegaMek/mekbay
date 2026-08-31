// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import { ChangeDetectionStrategy, Component, computed, inject, signal, viewChild } from '@angular/core';
import { DIALOG_DATA, DialogRef } from '@angular/cdk/dialog';

import type { LocationId } from '../../models/entity/entity-identifiers';
import { getMekLocationLabel } from '../../models/entity/types';
import type { CBTMekForceMember } from '../../models/force-member.model';
import type {
    MekCriticalMutationTarget,
    MekCriticalRollPlanV2,
    MekCriticalRollProfileV2,
} from '../../models/runtime/mek-critical-hit-v2';
import { createCommandId } from '../../models/runtime/runtime-state';
import { ToastService } from '../../services/toast.service';
import { DiceRollerComponent } from '../dice-roller/dice-roller.component';
import { hasMekRuntime } from '../../models/cbt-unit-snapshot';

export interface MekCriticalRollDialogData {
    readonly member: CBTMekForceMember;
    readonly locationId: LocationId;
    readonly requiredHits?: number;
    readonly target: MekCriticalMutationTarget;
}

export interface MekCriticalRollDialogResult {
    readonly completed: boolean;
}

@Component({
    selector: 'mek-critical-roll-dialog',
    imports: [DiceRollerComponent],
    changeDetection: ChangeDetectionStrategy.OnPush,
    template: `
        <div class="panel glass preventZoomReset framed-borders has-shadow" (click)="$event.stopPropagation()">
            <div class="header">Critical Roll · {{ locationLabel() }}</div>
            <div class="body">
                <div class="critical-dialog-body">
                    @if (data.requiredHits !== undefined) {
                        <div class="guided-progress">
                            {{ appliedHits() }} / {{ data.requiredHits }} critical hits applied
                        </div>
                    }
                    @if (initialExplosionProtection !== 'none') {
                        <div class="explosion-protection" role="note">
                            <span class="protection-badge">{{ explosionProtectionLabel }}</span>
                            <span class="protection-note">{{ initialExplosionProtectionNote }}</span>
                        </div>
                    }
                    <dice-roller #roller [diceCount]="profile().diceCount" (finished)="onFinished($event)" />

                    @if (outcome(); as currentOutcome) {
                        <div class="critical-result" aria-live="polite">
                            {{ outcomeLabel(currentOutcome) }}
                        </div>
                        @if (currentOutcome.explosion; as explosion) {
                            <div class="explosion-result">
                                <strong>{{ explosion.equipment }} explodes for {{ explosion.rawDamage }} damage.</strong>
                                @for (damage of explosion.locations; track damage.locationId) {
                                    <div>
                                        {{ locationName(damage.locationCode) }}:
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
                                        automatic critical applied.
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
                    [disabled]="roller.isRolling() || applying()"
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
    private readonly toast = inject(ToastService);
    readonly data = inject<MekCriticalRollDialogData>(DIALOG_DATA);
    readonly roller = viewChild<DiceRollerComponent>('roller');
    readonly profile = signal(this.readProfile());
    readonly appliedHits = signal(0);
    readonly outcome = signal<Extract<MekCriticalRollPlanV2, { readonly kind: 'applied' }> | null>(null);
    readonly discarded = signal(false);
    readonly applying = signal(false);
    readonly complete = computed(() =>
        this.discarded()
        || (this.data.requiredHits !== undefined && this.appliedHits() >= this.data.requiredHits));
    readonly hasRollableSlot = computed(() => this.profile().validRolls.length > 0);
    readonly locationLabel = computed(() => {
        const profile = this.profile();
        const source = this.locationName(profile.sourceLocationCode);
        const target = this.locationName(profile.targetLocationCode);
        return profile.sourceLocationId === profile.targetLocationId ? target : `${source} → ${target}`;
    });
    readonly initialExplosionProtection = this.profile().explosionProtection;
    readonly initialExplosionProtectionNote = this.profile().explosionProtectionNote;
    readonly explosionProtectionLabel = this.initialExplosionProtection === 'case-ii' ? '[CASE II]' : '[CASE]';

    roll(): void {
        if (this.complete()) {
            this.close();
            return;
        }
        const validRolls = this.profile().validRolls;
        if (validRolls.length === 0) {
            this.discarded.set(true);
            this.close();
            return;
        }
        this.outcome.set(null);
        const roll = validRolls[Math.min(validRolls.length - 1, Math.floor(Math.random() * validRolls.length))]!;
        this.roller()?.roll(roll);
    }

    async onFinished(event: { readonly results: readonly number[] }): Promise<void> {
        const unit = this.data.member.force.getUnitSnapshot(this.data.member.id);
        if (!unit || !hasMekRuntime(unit)) {
            this.toast.showToast('This unit is no longer in the force', 'error');
            this.close();
            return;
        }
        const plan = unit.query.mekCriticalRoll(this.data.locationId, event.results, this.data.target);
        if (plan.kind !== 'applied') {
            this.refreshProfile();
            this.roll();
            return;
        }

        this.applying.set(true);
        const result = await this.data.member.force.dispatchMekUnitCommand(this.data.member.id, {
            type: 'apply-mek-critical-roll',
            commandId: createCommandId(),
            expectedRevision: unit.query.stateRevision,
            locationId: this.data.locationId,
            results: event.results,
            target: this.data.target,
        });
        this.applying.set(false);
        this.refreshProfile();
        if (!result.accepted) {
            this.toast.showToast(`Critical roll rejected: ${result.reason}`, 'error');
            return;
        }
        this.outcome.set(plan);
        this.appliedHits.update(value => value + 1);
    }

    rollButtonLabel(): string {
        if (this.discarded()) return 'CRITICALS DISCARDED';
        if (this.complete()) return 'CRITICALS APPLIED';
        if (!this.hasRollableSlot()) return 'DISCARD REMAINING';
        if (this.data.requiredHits === undefined) return 'ROLL CRITICAL';
        return `ROLL CRITICAL (${this.appliedHits() + 1}/${this.data.requiredHits})`;
    }

    outcomeLabel(outcome: Extract<MekCriticalRollPlanV2, { readonly kind: 'applied' }>): string {
        if (outcome.armoredAbsorption) {
            return `Slot ${outcome.slotNumber}: ${outcome.equipment} — armored slot absorbs the hit.`;
        }
        return `Slot ${outcome.slotNumber}: ${outcome.equipment} critical slot destroyed.`;
    }

    locationName(locationCode: string): string {
        return getMekLocationLabel(locationCode) ?? locationCode;
    }

    close(): void {
        this.dialogRef.close({
            completed: this.data.requiredHits === undefined || this.complete(),
        });
    }

    private readProfile(): MekCriticalRollProfileV2 {
        const unit = this.data.member.force.getUnitSnapshot(this.data.member.id);
        if (!unit || !hasMekRuntime(unit)) {
            throw new Error(`Classic Mek ${this.data.member.id} is no longer owned`);
        }
        return unit.query.mekCriticalRollProfile(this.data.locationId, this.data.target);
    }

    private refreshProfile(): void {
        const unit = this.data.member.force.getUnitSnapshot(this.data.member.id);
        if (unit && hasMekRuntime(unit)) {
            this.profile.set(unit.query.mekCriticalRollProfile(this.data.locationId, this.data.target));
        }
    }
}
