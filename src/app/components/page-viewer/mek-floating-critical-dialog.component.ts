// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import { DIALOG_DATA, DialogRef } from '@angular/cdk/dialog';
import { ChangeDetectionStrategy, Component, computed, inject, signal, viewChild } from '@angular/core';
import type { CBTForceUnit } from '../../models/cbt-force-unit.model';
import type { MekHitArc } from '../../models/force-serialization';
import { resolveMekFallHitLocation } from '../../utils/mek-falling.util';
import {
    clusterTableForUnit,
    hitLocationRows,
    type MekHitLocationTable,
} from '../../utils/record-sheet-reference-table';
import { DiceRollerComponent } from '../dice-roller/dice-roller.component';

export interface MekFloatingCriticalDialogData {
    readonly unit: CBTForceUnit;
    readonly hitArc: MekHitArc;
    readonly initialLocationRoll?: number;
    readonly initialRoll?: readonly [number, number];
    readonly initialTripodLegRoll?: number;
    readonly onDraftChange?: (
        locationRoll: number | null,
        dice: readonly [number, number] | null,
        tripodLegRoll: number | null,
    ) => void;
}

export type MekFloatingCriticalDialogResult =
    | { readonly action: 'apply'; readonly location: string }
    | { readonly action: 'skip' };

interface FloatingCriticalLocationRow {
    readonly roll: number;
    readonly label: string;
    readonly requiresTripodLegRoll: boolean;
}

@Component({
    selector: 'mek-floating-critical-dialog',
    standalone: true,
    imports: [DiceRollerComponent],
    changeDetection: ChangeDetectionStrategy.OnPush,
    template: `
        <div class="panel glass preventZoomReset framed-borders has-shadow" (click)="$event.stopPropagation()">
            <div class="header">Floating Critical: {{ facingLabel }}</div>
            <div class="body">
                <div class="critical-dialog-body">
                    <div
                        class="critical-random-row"
                        [class.roll-disabled]="isRolling()"
                        (click)="roll()"
                    >
                        <button
                            class="random-button huge"
                            type="button"
                            aria-label="Roll floating critical location"
                            title="Roll floating critical location"
                            [disabled]="isRolling()"
                        ></button>
                        <div
                            class="critical-dice-trigger"
                            role="button"
                            [attr.tabindex]="isRolling() ? -1 : 0"
                            aria-label="Roll floating critical location dice"
                            [attr.aria-disabled]="isRolling()"
                            (keydown.enter)="roll()"
                            (keydown.space)="roll(); $event.preventDefault()"
                        >
                            <dice-roller
                                #roller
                                [diceCount]="2"
                                [initialResults]="initialDice"
                                (finished)="onFinished($event)"
                            />
                        </div>
                    </div>

                    <div class="floating-location-options" role="listbox" [attr.aria-label]="facingLabel + ' hit locations'">
                        @for (row of locationRows; track row.roll) {
                            <button
                                class="floating-location-option"
                                [class.selected]="locationRoll() === row.roll"
                                type="button"
                                role="option"
                                [attr.data-roll]="row.roll"
                                [attr.aria-selected]="locationRoll() === row.roll"
                                [disabled]="isRolling()"
                                (click)="selectLocation(row); $event.stopPropagation()"
                            >
                                <span class="floating-location-number">{{ row.roll }}</span>
                                <span class="floating-location-name">{{ row.label }}</span>
                            </button>
                        }
                    </div>

                    @if (needsTripodLegRoll()) {
                        <div class="floating-tripod-leg-picker">
                            <strong>Tripod leg</strong>
                            <span>Choose the additional 1D6 result.</span>
                            <div class="floating-tripod-leg-options" role="radiogroup" aria-label="Tripod leg roll">
                                @for (roll of d6Rolls; track roll) {
                                    <button
                                        class="bt-button"
                                        [class.selected]="tripodLegRoll() === roll"
                                        type="button"
                                        role="radio"
                                        [attr.aria-checked]="tripodLegRoll() === roll"
                                        (click)="selectTripodLeg(roll)"
                                    >{{ roll }}</button>
                                }
                            </div>
                        </div>
                    }
                </div>
            </div>
            <div class="actions">
                <button
                    class="bt-button primary"
                    type="button"
                    [disabled]="isRolling() || !selectedLocation()"
                    (click)="apply()"
                >APPLY</button>
                <button class="bt-button" type="button" [disabled]="isRolling()" (click)="skip()">SKIP</button>
                <button class="bt-button" type="button" [disabled]="isRolling()" (click)="close()">CLOSE</button>
            </div>
        </div>
    `,
    styleUrls: [
        './overlay/page-psr-warning-panel.component.scss',
        './mek-critical-dialog.component.scss',
        './mek-floating-critical-dialog.component.scss',
    ],
})
export class MekFloatingCriticalDialogComponent {
    private readonly dialogRef = inject(DialogRef<MekFloatingCriticalDialogResult | undefined>);
    readonly data = inject<MekFloatingCriticalDialogData>(DIALOG_DATA);
    readonly roller = viewChild<DiceRollerComponent>('roller');
    readonly hitLocationTable: MekHitLocationTable = clusterTableForUnit(this.data.unit.getUnit()).hitLocationTable
        ?? 'biped';
    readonly facingLabel = floatingCriticalFacingLabel(this.data.hitArc);
    readonly initialDice = validDice(this.data.initialRoll, 2) as readonly [number, number] | null;
    readonly d6Rolls = [1, 2, 3, 4, 5, 6] as const;
    readonly locationRows = hitLocationRows(this.hitLocationTable).map((_row, index) =>
        floatingLocationRow(this.hitLocationTable, index + 2, this.data.hitArc));
    readonly locationRoll = signal<number | null>(validLocationRoll(this.data.initialLocationRoll));
    readonly tripodLegRoll = signal<number | null>(validTripodLegRoll(this.data.initialTripodLegRoll));
    readonly isRolling = computed(() => this.roller()?.isRolling() ?? false);
    readonly selectedResult = computed(() => {
        const roll = this.locationRoll();
        return roll === null
            ? null
            : resolveMekFallHitLocation(
                this.hitLocationTable,
                this.data.hitArc,
                roll,
                this.tripodLegRoll() ?? undefined,
            );
    });
    readonly selectedLocation = computed(() => this.selectedResult()?.location ?? null);
    readonly needsTripodLegRoll = computed(() => {
        const selected = this.locationRows.find(row => row.roll === this.locationRoll());
        return selected?.requiresTripodLegRoll === true && this.selectedLocation() === null;
    });

    roll(): void {
        if (this.isRolling()) return;
        this.roller()?.roll();
    }

    onFinished(event: { readonly results: readonly number[]; readonly sum: number }): void {
        if (event.results.length !== 2 || !validDice(event.results, 2)) return;
        const dice = [event.results[0], event.results[1]] as const;
        const row = this.locationRows.find(candidate => candidate.roll === event.sum);
        const tripodRoll = row?.requiresTripodLegRoll
            ? Math.floor(Math.random() * 6) + 1
            : null;
        this.setDraft(event.sum, dice, tripodRoll);
    }

    selectLocation(row: FloatingCriticalLocationRow): void {
        if (this.isRolling()) return;
        this.setDraft(row.roll, null, null);
    }

    selectTripodLeg(roll: number): void {
        if (!Number.isInteger(roll) || roll < 1 || roll > 6) return;
        const locationRoll = this.locationRoll();
        if (locationRoll === null) return;
        this.setDraft(locationRoll, null, roll);
    }

    apply(): void {
        const location = this.selectedLocation();
        if (this.isRolling() || !location) return;
        this.dialogRef.close({ action: 'apply', location });
    }

    skip(): void {
        if (!this.isRolling()) this.dialogRef.close({ action: 'skip' });
    }

    close(): void {
        if (!this.isRolling()) this.dialogRef.close(undefined);
    }

    private setDraft(
        locationRoll: number,
        dice: readonly [number, number] | null,
        tripodLegRoll: number | null,
    ): void {
        this.locationRoll.set(locationRoll);
        this.tripodLegRoll.set(tripodLegRoll);
        this.data.onDraftChange?.(locationRoll, dice, tripodLegRoll);
    }
}

function floatingLocationRow(
    table: MekHitLocationTable,
    roll: number,
    hitArc: MekHitArc,
): FloatingCriticalLocationRow {
    const result = resolveMekFallHitLocation(table, hitArc, roll);
    return {
        roll,
        label: result.locationLabel ?? result.tableLabel,
        requiresTripodLegRoll: result.location === null,
    };
}

function floatingCriticalFacingLabel(hitArc: MekHitArc): string {
    if (hitArc === 'left') return 'Left Side';
    if (hitArc === 'right') return 'Right Side';
    if (hitArc === 'rear') return 'Rear';
    return 'Front';
}

function validLocationRoll(value: number | undefined): number | null {
    return value !== undefined && Number.isInteger(value) && value >= 2 && value <= 12 ? value : null;
}

function validTripodLegRoll(value: number | undefined): number | null {
    return value !== undefined && Number.isInteger(value) && value >= 1 && value <= 6 ? value : null;
}

function validDice(value: readonly number[] | undefined, count: number): readonly number[] | null {
    return value !== undefined
        && value.length === count
        && value.every(die => Number.isInteger(die) && die >= 1 && die <= 6)
        ? value
        : null;
}
