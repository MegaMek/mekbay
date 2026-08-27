// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { DIALOG_DATA, DialogRef } from '@angular/cdk/dialog';
import type {
    CBTForceUnit,
    CBTMekFallDamageRoll,
    CBTUnitAutomationTrigger,
} from '../../models/cbt-force-unit.model';
import {
    isImpactResistantArmor,
    isResolvedMekFallHitLocation,
    mekFallDamage,
    mekFallDamageGroups,
    resolveMekFallHitLocation,
    resolveMekFallOrientation,
    type MekFallHitLocationResult,
    type MekFallOrientation,
    type ResolvedMekFallDamageGroup,
} from '../../utils/mek-falling.util';
import { clusterTableForUnit, type MekHitLocationTable } from '../../utils/record-sheet-reference-table';

export type FallingAutomationTrigger = Extract<CBTUnitAutomationTrigger, { readonly kind: 'falling' }>;

export interface FallingDamageDialogData {
    readonly unit: CBTForceUnit;
    readonly trigger: FallingAutomationTrigger;
}

export interface AcceptedFallingDamageDialogResult {
    readonly action: 'accept';
    readonly orientation: MekFallOrientation;
    readonly groups: readonly ResolvedMekFallDamageGroup[];
}

export type FallingDamageDialogResult = AcceptedFallingDamageDialogResult
    | { readonly action: 'ignore' }
    | { readonly action: 'close' };

interface FallingDamageGroupRoll {
    readonly hitLocationRoll: number | null;
    readonly hitLocationDice: readonly [number, number] | null;
    readonly tripodLegRoll: number | null;
    readonly tripodLegDice: readonly [number] | null;
}

interface FallingDamageGroupRow extends FallingDamageGroupRoll {
    readonly index: number;
    readonly damage: number;
    readonly result: MekFallHitLocationResult | null;
}

@Component({
    selector: 'falling-damage-dialog',
    standalone: true,
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
    private readonly pending = this.data.unit.getPendingFall(this.data.trigger.id);

    readonly rulesId = this.data.unit.gameRules.id;
    readonly tons = this.data.unit.getUnit().tons;
    readonly levelsFallen = this.data.trigger.levelsFallen;
    readonly totalDamage = mekFallDamage(this.tons, this.levelsFallen);
    readonly damageGroups = mekFallDamageGroups(this.totalDamage);
    readonly hitLocationTable: MekHitLocationTable = clusterTableForUnit(this.data.unit.getUnit()).hitLocationTable
        ?? 'biped';
    readonly orientationRoll = signal<number | null>(this.pending?.orientationRoll ?? null);
    readonly orientationDice = signal<readonly [number] | null>(this.pending?.orientationDice ?? null);
    private readonly groupRolls = signal<readonly FallingDamageGroupRoll[]>(
        this.damageGroups.map((_damage, index) => {
            const pendingRoll = this.pending?.damageRolls[index];
            return {
                hitLocationRoll: pendingRoll?.hitLocationRoll ?? null,
                hitLocationDice: pendingRoll?.hitLocationDice ?? null,
                tripodLegRoll: pendingRoll?.tripodLegRoll ?? null,
                tripodLegDice: pendingRoll?.tripodLegDice ?? null,
            };
        }),
    );

    readonly d6Rolls = [1, 2, 3, 4, 5, 6] as const;
    readonly twoD6Rolls = [2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12] as const;
    readonly orientation = computed(() => {
        const roll = this.orientationRoll();
        return roll === null ? null : resolveMekFallOrientation(this.rulesId, roll);
    });
    readonly groupRows = computed<readonly FallingDamageGroupRow[]>(() => {
        const orientation = this.orientation();
        return this.groupRolls().map((roll, index) => ({
            index,
            damage: this.damageGroups[index],
            ...roll,
            result: orientation && roll.hitLocationRoll !== null
                ? resolveMekFallHitLocation(
                    this.hitLocationTable,
                    orientation.hitArc,
                    roll.hitLocationRoll,
                    roll.tripodLegRoll ?? undefined,
                )
                : null,
        }));
    });
    readonly allResolved = computed(() => {
        if (!this.orientation()) return false;
        return this.groupRows().every(row => row.result && isResolvedMekFallHitLocation(row.result));
    });
    readonly sourceMessage = this.data.trigger.source === 'stand-attempt'
        ? 'The stand-up attempt failed, so the Mek falls again.'
        : 'A failed Piloting Skill Roll caused the Mek to fall.';
    readonly armorNote = isImpactResistantArmor(this.data.unit.getUnit().armorType)
        ? 'Impact-Resistant Armor halves each group that reaches intact armor, rounding down to a minimum of 1 damage.'
        : null;

    setOrientationRoll(roll: number | null): void {
        this.orientationRoll.set(validRoll(roll, 1, 6));
        this.orientationDice.set(null);
        this.persistRolls();
    }

    setHitLocationRoll(index: number, roll: number | null): void {
        this.updateGroupRoll(index, {
            hitLocationRoll: validRoll(roll, 2, 12),
            hitLocationDice: null,
        });
    }

    setTripodLegRoll(index: number, roll: number | null): void {
        this.updateGroupRoll(index, {
            tripodLegRoll: validRoll(roll, 1, 6),
            tripodLegDice: null,
        });
    }

    rollAllResults(random: () => number = Math.random): void {
        const orientationRoll = rollD6(random);
        const orientation = resolveMekFallOrientation(this.rulesId, orientationRoll);
        this.orientationRoll.set(orientationRoll);
        this.orientationDice.set([orientationRoll]);
        this.groupRolls.set(this.damageGroups.map(() => {
            const hitLocationDice = [rollD6(random), rollD6(random)] as const;
            const hitLocationRoll = hitLocationDice[0] + hitLocationDice[1];
            const preliminary = resolveMekFallHitLocation(
                this.hitLocationTable,
                orientation.hitArc,
                hitLocationRoll,
            );
            const needsTripodLeg = preliminary.location === null
                && preliminary.tripodLegModifier !== undefined;
            const tripodLegDice = needsTripodLeg ? [rollD6(random)] as const : null;
            return {
                hitLocationRoll,
                hitLocationDice,
                tripodLegRoll: tripodLegDice?.[0] ?? null,
                tripodLegDice,
            };
        }));
        this.persistRolls();
    }

    apply(): void {
        const orientation = this.orientation();
        if (!orientation || !this.allResolved()) return;
        const groups = this.groupRows().map(row => ({
            ...row.result!,
            damage: row.damage,
        })) as ResolvedMekFallDamageGroup[];
        this.dialogRef.close({ action: 'accept', orientation, groups });
    }

    ignore(): void {
        this.dialogRef.close({ action: 'ignore' });
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
        this.persistRolls();
    }

    private persistRolls(): void {
        this.data.unit.setPendingFallRolls(
            this.data.trigger.id,
            this.orientationRoll(),
            this.groupRolls() satisfies readonly CBTMekFallDamageRoll[],
            this.orientationDice(),
        );
    }
}

function validRoll(value: number | null, min: number, max: number): number | null {
    return value !== null && Number.isInteger(value) && value >= min && value <= max ? value : null;
}

function rollD6(random: () => number): number {
    return Math.floor(random() * 6) + 1;
}
