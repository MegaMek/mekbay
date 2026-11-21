// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import { NgTemplateOutlet } from '@angular/common';
import { physicalAttackTroopersHit, type PhysicalAttackKind } from '../../models/rules/physical-attack-rules';
import { isInfantryEntity } from '../../models/entity/utils/entity-type-guards';
import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';

import type { CBTForceMember } from '../../models/force-member.model';
import { INFERNO_LABEL } from '../../models/rules/inferno-rules';
import type { HitTable } from '../../models/rules/physical-attack-rules';
import type { HitLocationDice, TwoDice } from '../../models/rules/weapon-attack-resolution';
import { readAttackHitLocation, type AttackHitLocation } from '../../models/runtime/attack-hit-location';
import { aimedShotStrikes, type AimedShotRoll } from '../../models/rules/aimed-shot-rules';
import { getMekLocationLabel } from '../../models/entity/types/mek';
import type { MekHitArc } from '../../utils/record-sheet-reference-table';
import { DiceRollerComponent } from '../dice-roller/dice-roller.component';

export interface AttackReportGroup {
    /** Damage, or the conventional troopers it eliminates when `troopers`. */
    readonly damage: number;
    readonly troopers?: true;
    readonly location: HitLocationDice;
    /** Null when the struck unit's table is not available here: the roll is read on its sheet. */
    readonly label: string | null;
    readonly throughArmorCritical?: boolean;
}

export interface AttackReportWeapon {
    readonly name: string;
    readonly targetNumber: number;
    /** The attack hits without a to-hit roll (`physicalAttackAlwaysHits`). */
    readonly automaticHit?: true;
    readonly toHit: TwoDice;
    readonly hit: boolean;
    readonly jammed?: boolean;
    /** An insulated laser's failure roll after a to-hit roll of 2, and whether the laser suffers a critical hit. */
    readonly insulator?: Readonly<{ dice: TwoDice; failed: boolean }>;
    readonly cluster: Readonly<{ dice: TwoDice; modifier: number; projectiles: number; hits: number }> | null;
    /** Each group is one inferno missile rather than damage. */
    readonly inferno?: boolean;
    /**
     * Outside heat a heat-causing weapon's hit applies, with the heat dice it read (none for a flamer); `reduced` when
     * armor or partial cover reduces the heat.
     */
    readonly heat?: Readonly<{ dice: readonly number[]; value: number; reduced?: true }>;
    /** An aimed shot's roll, the location it names, and whether the roll strikes it. */
    readonly aim?: Readonly<{ dice: readonly number[]; label: string; strikes: boolean }>;
    readonly groups: readonly AttackReportGroup[];
}

/**
 * Which roll of a weapon an edit sets: to-hit, a laser insulator's failure, cluster, heat dice, aim, or a hit-location
 * group by index.
 */
export type AttackReportRoll = 'to-hit' | 'insulator' | 'cluster' | 'heat' | 'aim' | number;

/** An aimed shot as the report shows it. */
export function attackReportAim(aim: AimedShotRoll): NonNullable<AttackReportWeapon['aim']> {
    return Object.freeze({
        dice: aim.roll,
        label: getMekLocationLabel(aim.location) ?? aim.location,
        strikes: aimedShotStrikes(aim.roll),
    });
}

export interface AttackReportRollEdit {
    readonly weapon: number;
    readonly roll: AttackReportRoll;
    readonly total: number;
}

export const ATTACK_ARC_LABELS: Readonly<Record<MekHitArc, string>> = Object.freeze({
    front: 'Front', left: 'Left side', right: 'Right side', rear: 'Rear',
});

/**
 * One damage group as reported, read on the struck unit's own table when that unit is open here, dealing what `deal`
 * says it deals where it strikes (`attackDamagePreview`). A physical attack on conventional infantry reports the
 * troopers it eliminates (`physicalAttackTroopersHit`).
 */
export function attackReportGroup(
    defender: CBTForceMember | null,
    arc: MekHitArc,
    damage: number,
    location: HitLocationDice,
    aux: number,
    partialCover: boolean,
    table: HitTable = 'standard',
    physical?: PhysicalAttackKind,
    aim?: AimedShotRoll,
    critical = false,
    deal: (location: AttackHitLocation | null, damage: number) => number = (_, damage) => damage,
): AttackReportGroup {
    const read = defender ? readAttackHitLocation(defender, arc, location, aux, partialCover, table, aim) : null;
    const dealt = deal(read, damage);
    const infantry = defender !== null && physical !== undefined && isInfantryEntity(defender.entity)
        ? defender.entity : null;
    return Object.freeze({
        ...(infantry && physical
            ? { damage: physicalAttackTroopersHit(physical, dealt, infantry.isMechanized()), troopers: true as const }
            : { damage: dealt }),
        location,
        // Without the struck unit here, an aimed shot that strikes still names its location.
        label: read?.label ?? (!defender && aim && aimedShotStrikes(aim.roll) ? attackReportAim(aim).label : null),
        // A leg attack and battle armor's swarm damage roll for a critical hit wherever they strike a 'Mech.
        throughArmorCritical: read?.kind === 'mek' && (read.throughArmorCritical || critical),
    });
}

const ONE_D6_TOTALS = Object.freeze([1, 2, 3, 4, 5, 6]);
const TWO_D6_TOTALS = Object.freeze([2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
const THREE_D6_TOTALS = Object.freeze([3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18]);
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
    protected readonly infernoLabel = INFERNO_LABEL;

    /** The totals a roll of these dice can show: 1D6 (punch and kick tables), 2D6, or 3D6 (plasma). */
    protected totals(dice: readonly number[]): readonly number[] {
        return dice.length === 1 ? ONE_D6_TOTALS : dice.length === 3 ? THREE_D6_TOTALS : TWO_D6_TOTALS;
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
