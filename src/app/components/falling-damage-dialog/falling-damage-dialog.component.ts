// SPDX-License-Identifier: GPL-3.0-or-later

import { DIALOG_DATA, DialogRef } from '@angular/cdk/dialog';
import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';

import type { CBTRuleset } from '../../models/cbt-ruleset.model';
import {
    resolveMekFallDamage,
    resolveMekFallHitLocation,
    resolveMekFallOrientation,
    resolvedMekFallDamageGroups,
    type MekFallDamageBreakdown,
    type MekFallHitLocationResult,
    type MekFallOrientation,
} from '../../models/runtime/mek-fall-rules';
import type { MekHitLocationTable } from '../../utils/record-sheet-reference-table';

export interface FallingDamageDialogData {
    readonly unitName: string;
    readonly sourceMessage: string;
    readonly ruleset: CBTRuleset;
    readonly tons: number;
    readonly levelsFallen: number;
    readonly waterDepth: number;
    readonly hitLocationTable: MekHitLocationTable;
    readonly armorNote?: string;
}

export interface ResolvedMekFallDamageGroup extends MekFallHitLocationResult {
    readonly damage: number;
}

export interface AcceptedFallingDamageDialogResult {
    readonly action: 'accept';
    readonly damage: MekFallDamageBreakdown;
    readonly orientation: MekFallOrientation;
    readonly groups: readonly ResolvedMekFallDamageGroup[];
}

export type FallingDamageDialogResult = AcceptedFallingDamageDialogResult
    | { readonly action: 'skip' }
    | { readonly action: 'close' };

interface FallingDamageGroupRoll {
    readonly hitLocationRoll: number | null;
    readonly tripodLegRoll: number | null;
}

interface FallingDamageGroupRow extends FallingDamageGroupRoll {
    readonly index: number;
    readonly damage: number;
    readonly result: MekFallHitLocationResult | null;
}

@Component({
    selector: 'falling-damage-dialog',
    imports: [],
    changeDetection: ChangeDetectionStrategy.OnPush,
    templateUrl: './falling-damage-dialog.component.html',
    styleUrls: [
        '../page-viewer/overlay/page-psr-warning-panel.component.scss',
        './falling-damage-dialog.component.scss',
    ],
})
export class FallingDamageDialogComponent {
    readonly data = inject<FallingDamageDialogData>(DIALOG_DATA);
    private readonly dialogRef = inject<DialogRef<FallingDamageDialogResult | undefined>>(DialogRef);
    readonly damage = resolveMekFallDamage(
        this.data.ruleset,
        this.data.tons,
        this.data.levelsFallen,
        this.data.waterDepth,
    );
    readonly totalDamage = this.damage.totalDamage;
    readonly damageGroups = resolvedMekFallDamageGroups(this.damage);
    readonly orientationRoll = signal<number | null>(null);
    private readonly groupRolls = signal<readonly FallingDamageGroupRoll[]>(
        this.damageGroups.map(() => ({ hitLocationRoll: null, tripodLegRoll: null })),
    );
    readonly d6Rolls = [1, 2, 3, 4, 5, 6] as const;
    readonly twoD6Rolls = [2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12] as const;
    readonly orientation = computed(() => {
        const roll = this.orientationRoll();
        return roll === null ? null : resolveMekFallOrientation(this.data.ruleset, roll);
    });
    readonly groupRows = computed<readonly FallingDamageGroupRow[]>(() => {
        const orientation = this.orientation();
        return this.groupRolls().map((roll, index) => ({
            index,
            damage: this.damageGroups[index]!,
            ...roll,
            result: orientation && roll.hitLocationRoll !== null
                ? resolveMekFallHitLocation(
                    this.data.hitLocationTable,
                    orientation.hitArc,
                    roll.hitLocationRoll,
                    roll.tripodLegRoll ?? undefined,
                )
                : null,
        }));
    });
    readonly allResolved = computed(() => this.orientation() !== null
        && this.groupRows().every(row => row.result !== null && row.result.location !== null));

    setOrientationRoll(roll: number | null): void {
        this.orientationRoll.set(validRoll(roll, 1, 6));
    }

    setHitLocationRoll(index: number, roll: number | null): void {
        this.updateGroupRoll(index, { hitLocationRoll: validRoll(roll, 2, 12) });
    }

    setTripodLegRoll(index: number, roll: number | null): void {
        this.updateGroupRoll(index, { tripodLegRoll: validRoll(roll, 1, 6) });
    }

    rollOrientation(random: () => number = Math.random): void {
        this.orientationRoll.set(randomD6(random));
    }

    rollHitLocations(random: () => number = Math.random): void {
        if (this.orientationRoll() === null) return;
        this.groupRolls.set(this.damageGroups.map(() => rollDamageGroup(
            this.data.hitLocationTable,
            this.orientation()!.hitArc,
            random,
        )));
    }

    rollAllResults(random: () => number = Math.random): void {
        this.rollOrientation(random);
        this.rollHitLocations(random);
    }

    apply(): void {
        const orientation = this.orientation();
        if (!orientation || !this.allResolved()) return;
        this.dialogRef.close(Object.freeze({
            action: 'accept',
            damage: this.damage,
            orientation,
            groups: Object.freeze(this.groupRows().map(row => Object.freeze({
                ...row.result!,
                damage: row.damage,
            }))),
        }));
    }

    skip(): void {
        this.dialogRef.close({ action: 'skip' });
    }

    close(): void {
        this.dialogRef.close({ action: 'close' });
    }

    signed(value: number): string {
        return value > 0 ? `+${value}` : String(value);
    }

    private updateGroupRoll(index: number, update: Partial<FallingDamageGroupRoll>): void {
        this.groupRolls.update(current => current.map((roll, rollIndex) =>
            rollIndex === index ? { ...roll, ...update } : roll));
    }
}

export function resolveAutomaticFallingDamage(
    data: FallingDamageDialogData,
    random: () => number = Math.random,
): AcceptedFallingDamageDialogResult {
    const damage = resolveMekFallDamage(
        data.ruleset,
        data.tons,
        data.levelsFallen,
        data.waterDepth,
    );
    const orientation = resolveMekFallOrientation(data.ruleset, randomD6(random));
    const groups = resolvedMekFallDamageGroups(damage).map(group => {
        const roll = rollDamageGroup(data.hitLocationTable, orientation.hitArc, random);
        return Object.freeze({
            ...resolveMekFallHitLocation(
                data.hitLocationTable,
                orientation.hitArc,
                roll.hitLocationRoll!,
                roll.tripodLegRoll ?? undefined,
            ),
            damage: group,
        });
    });
    return Object.freeze({ action: 'accept', damage, orientation, groups: Object.freeze(groups) });
}

function rollDamageGroup(
    table: MekHitLocationTable,
    arc: MekFallOrientation['hitArc'],
    random: () => number,
): FallingDamageGroupRoll {
    const hitLocationRoll = randomD6(random) + randomD6(random);
    const unresolved = resolveMekFallHitLocation(table, arc, hitLocationRoll);
    return Object.freeze({
        hitLocationRoll,
        tripodLegRoll: unresolved.location === null ? randomD6(random) : null,
    });
}

function randomD6(random: () => number): number {
    return Math.floor(random() * 6) + 1;
}

function validRoll(value: number | null, min: number, max: number): number | null {
    return value !== null && Number.isInteger(value) && value >= min && value <= max ? value : null;
}
