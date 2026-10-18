// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import { NgTemplateOutlet } from '@angular/common';
import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';

import type { CBTForceMember } from '../../models/force-member.model';
import type { HitTable } from '../../models/rules/physical-attack-rules';
import type { HitLocationDice, TwoDice } from '../../models/rules/weapon-attack-resolution';
import { readAttackHitLocation } from '../../models/runtime/attack-hit-location';
import type { MekHitArc } from '../../utils/record-sheet-reference-table';
import { DiceRollerComponent } from '../dice-roller/dice-roller.component';

export interface AttackReportGroup {
    readonly damage: number;
    readonly location: HitLocationDice;
    /** Null when the struck unit's table is not available here: the roll is read on its sheet. */
    readonly label: string | null;
    readonly throughArmorCritical?: boolean;
}

export interface AttackReportWeapon {
    readonly name: string;
    readonly targetNumber: number;
    readonly toHit: TwoDice;
    readonly hit: boolean;
    readonly jammed?: boolean;
    readonly cluster: Readonly<{ dice: TwoDice; modifier: number; projectiles: number; hits: number }> | null;
    readonly groups: readonly AttackReportGroup[];
}

/** Which roll of a weapon an edit sets: to-hit, cluster, or a hit-location group by index. */
export type AttackReportRoll = 'to-hit' | 'cluster' | number;

export interface AttackReportRollEdit {
    readonly weapon: number;
    readonly roll: AttackReportRoll;
    readonly total: number;
}

export const ATTACK_ARC_LABELS: Readonly<Record<MekHitArc, string>> = Object.freeze({
    front: 'Front', left: 'Left side', right: 'Right side', rear: 'Rear',
});

/** One damage group as reported, read on the struck unit's own table when that unit is open here. */
export function attackReportGroup(
    defender: CBTForceMember | null,
    arc: MekHitArc,
    damage: number,
    location: HitLocationDice,
    aux: number,
    partialCover: boolean,
    table: HitTable = 'standard',
): AttackReportGroup {
    const read = defender ? readAttackHitLocation(defender, arc, location, aux, partialCover, table) : null;
    return Object.freeze({
        damage,
        location,
        label: read?.label ?? null,
        throughArmorCritical: read?.kind === 'mek' && read.throughArmorCritical,
    });
}

const TWO_D6_TOTALS = Object.freeze([2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
const ONE_D6_TOTALS = Object.freeze([1, 2, 3, 4, 5, 6]);
const CLUSTER_MODIFIERS = Object.freeze([-4, -3, -2, -1, 0, 1, 2, 3, 4]);

/** The dice, totals and outcome of each weapon in one attack; editable while the attacker resolves it. */
@Component({
    selector: 'attack-report',
    imports: [DiceRollerComponent, NgTemplateOutlet],
    changeDetection: ChangeDetectionStrategy.OnPush,
    templateUrl: './attack-report.component.html',
    styleUrl: './attack-report.component.scss',
})
export class AttackReportComponent {
    readonly weapons = input.required<readonly AttackReportWeapon[]>();
    readonly editable = input(false);

    readonly rollSet = output<AttackReportRollEdit>();
    readonly clusterModifierSet = output<Readonly<{ weapon: number; modifier: number }>>();
    readonly rerolled = output<number>();

    protected readonly clusterModifiers = CLUSTER_MODIFIERS;

    /** The totals a roll of these dice can show: 2D6, or 1D6 on the punch and kick tables. */
    protected totals(dice: readonly number[]): readonly number[] {
        return dice.length === 1 ? ONE_D6_TOTALS : TWO_D6_TOTALS;
    }

    protected sum(dice: readonly number[]): number {
        return dice.reduce((total, die) => total + die, 0);
    }

    protected setRoll(weapon: number, roll: AttackReportRoll, event: Event): void {
        this.rollSet.emit({ weapon, roll, total: Number((event.target as HTMLSelectElement).value) });
    }

    protected setClusterModifier(weapon: number, event: Event): void {
        this.clusterModifierSet.emit({ weapon, modifier: Number((event.target as HTMLSelectElement).value) });
    }

    protected signed(value: number): string {
        return value > 0 ? `+${value}` : value < 0 ? `−${-value}` : '±0';
    }
}
