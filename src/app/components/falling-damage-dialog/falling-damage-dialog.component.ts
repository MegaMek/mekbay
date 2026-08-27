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
import { unitCoverWaterDepth } from '../../models/unit-cover.model';
import {
    isResolvedMekFallHitLocation,
    resolvedMekFallDamageGroups,
    resolveMekFallDamage,
    resolveMekFallHitLocation,
    resolveMekFallOrientation,
    twoD6ForTotal,
    twoD6Total,
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
    readonly hitLocationDice: readonly [number, number] | null;
    readonly tripodLegRoll: number | null;
}

interface FallingDamageGroupRow extends FallingDamageGroupRoll {
    readonly index: number;
    readonly damage: number;
    readonly hitLocationRoll: number | null;
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
    readonly fallDamage = resolveMekFallDamage(
        this.rulesId,
        this.tons,
        this.levelsFallen,
        unitCoverWaterDepth(this.data.unit.turnState().cover()),
    );
    readonly totalDamage = this.fallDamage.totalDamage;
    readonly damageGroups = resolvedMekFallDamageGroups(this.fallDamage);
    readonly hitLocationTable: MekHitLocationTable = clusterTableForUnit(this.data.unit.getUnit()).hitLocationTable
        ?? 'biped';
    readonly orientationRoll = signal<number | null>(this.pending?.orientationRoll ?? null);
    private readonly groupRolls = signal<readonly FallingDamageGroupRoll[]>(
        this.damageGroups.map((_damage, index) => {
            const pendingRoll = this.pending?.damageRolls[index];
            return {
                hitLocationDice: pendingRoll?.hitLocationDice ?? null,
                tripodLegRoll: pendingRoll?.tripodLegRoll ?? null,
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
        return this.groupRolls().map((roll, index) => {
            const hitLocationRoll = roll.hitLocationDice ? twoD6Total(roll.hitLocationDice) : null;
            return {
                index,
                damage: this.damageGroups[index],
                ...roll,
                hitLocationRoll,
                result: orientation && hitLocationRoll !== null
                    ? resolveMekFallHitLocation(
                        this.hitLocationTable,
                        orientation.hitArc,
                        hitLocationRoll,
                        roll.tripodLegRoll ?? undefined,
                    )
                    : null,
            };
        });
    });
    readonly allResolved = computed(() => {
        if (!this.orientation()) return false;
        return this.groupRows().every(row => row.result && isResolvedMekFallHitLocation(row.result));
    });
    readonly sourceMessage = this.data.trigger.source === 'stand-attempt'
        ? 'The stand-up attempt failed, so the Mek falls again.'
        : 'A failed Piloting Skill Roll caused the Mek to fall.';
    readonly armorNote = this.data.unit.hasArmorType('IMPACT_RESISTANT')
        ? 'Impact-Resistant Armor is resolved against the armor in each struck location.'
        : null;

    setOrientationRoll(roll: number | null): void {
        this.orientationRoll.set(validRoll(roll, 1, 6));
        this.persistRolls();
    }

    setHitLocationRoll(index: number, roll: number | null): void {
        this.updateGroupRoll(index, {
            hitLocationDice: twoD6ForTotal(roll),
        });
    }

    setTripodLegRoll(index: number, roll: number | null): void {
        this.updateGroupRoll(index, {
            tripodLegRoll: validRoll(roll, 1, 6),
        });
    }

    rollAllResults(random: () => number = Math.random): void {
        const orientationRoll = rollD6(random);
        const orientation = resolveMekFallOrientation(this.rulesId, orientationRoll);
        this.orientationRoll.set(orientationRoll);
        this.groupRolls.set(this.damageGroups.map(() => {
            const hitLocationDice = [rollD6(random), rollD6(random)] as const;
            const hitLocationRoll = twoD6Total(hitLocationDice);
            const preliminary = resolveMekFallHitLocation(
                this.hitLocationTable,
                orientation.hitArc,
                hitLocationRoll,
            );
            const needsTripodLeg = preliminary.location === null
                && preliminary.tripodLegModifier !== undefined;
            return {
                hitLocationDice,
                tripodLegRoll: needsTripodLeg ? rollD6(random) : null,
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
        );
    }
}

function validRoll(value: number | null, min: number, max: number): number | null {
    return value !== null && Number.isInteger(value) && value >= min && value <= max ? value : null;
}

function rollD6(random: () => number): number {
    return Math.floor(random() * 6) + 1;
}
