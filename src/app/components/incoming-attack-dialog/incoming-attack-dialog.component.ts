// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import { DIALOG_DATA, DialogRef } from '@angular/cdk/dialog';
import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';

import type { CBTForceMember } from '../../models/force-member.model';
import { toHitSucceeds } from '../../models/rules/weapon-attack-resolution';
import { infernoEffect, infernoEffectText } from '../../models/rules/inferno-rules';
import { infernoMissilesThisTurn, readAttackHeat, readInfernoMissiles } from '../../models/runtime/attack-hit-location';
import type { AttackEvent } from '../../services/game-events.service';
import { OptionsService } from '../../services/options.service';
import {
    ATTACK_ARC_LABELS,
    AttackReportComponent,
    attackReportGroup,
    type AttackReportWeapon,
} from '../attack-report/attack-report.component';

export interface IncomingAttackDialogData {
    readonly event: AttackEvent;
    readonly member: CBTForceMember;
    readonly unitName: string;
    /** The sending player's lobby name; null when the attacker is on this device. */
    readonly fromDisplayName: string | null;
    /** Accepted damage waits for the end of the phase. */
    readonly pending: boolean;
}

/** Shows an opponent's resolved attack on one of this player's units; closes true to accept the damage. */
@Component({
    selector: 'incoming-attack-dialog',
    imports: [AttackReportComponent],
    changeDetection: ChangeDetectionStrategy.OnPush,
    templateUrl: './incoming-attack-dialog.component.html',
    styleUrl: './incoming-attack-dialog.component.scss',
})
export class IncomingAttackDialogComponent {
    private readonly dialogRef = inject<DialogRef<boolean>>(DialogRef);
    protected readonly data = inject<IncomingAttackDialogData>(DIALOG_DATA);
    protected readonly arcLabel = ATTACK_ARC_LABELS[this.data.event.arc];
    /** With critical automation off, critical and motive effects are rolled on the sheet. */
    protected readonly manualCriticals = inject(OptionsService).cbtAutomationMode('criticalHitChanceCheck') === 'no';

    protected readonly weapons = computed<readonly AttackReportWeapon[]>(() => this.data.event.weapons.map(weapon => ({
        name: weapon.name,
        targetNumber: weapon.targetNumber,
        toHit: weapon.toHit,
        hit: toHitSucceeds(weapon.toHit, weapon.targetNumber),
        cluster: weapon.cluster ?? null,
        inferno: weapon.inferno === true,
        groups: weapon.groups.map(group => attackReportGroup(this.data.member, weapon.arc ?? this.data.event.arc,
            group.damage, group.location, group.aux, weapon.partialCover === true, weapon.table)),
    })));
    /** Damage per struck location, in the order first struck. */
    protected readonly summary = computed(() => {
        const totals = new Map<string, number>();
        for (const group of this.weapons().filter(weapon => !weapon.inferno).flatMap(weapon => weapon.groups)
            .filter(group => group.damage > 0)) {
            const label = group.label ?? '?';
            totals.set(label, (totals.get(label) ?? 0) + group.damage);
        }
        return [...totals].map(([label, damage]) => ({ label, damage }));
    });
    protected readonly totalDamage = computed(() => this.summary().reduce((sum, row) => sum + row.damage, 0));
    /** Outside heat the attack's heat-causing weapons apply. */
    protected readonly heat = computed(() => readAttackHeat(this.data.member, this.data.event.arc, this.data.event.weapons));
    /** What the attack's inferno missiles do to this unit; null without inferno hits. */
    protected readonly inferno = computed(() => {
        const missiles = readInfernoMissiles(this.data.member, this.data.event.arc, this.data.event.weapons);
        const earlier = infernoMissilesThisTurn(this.data.member.force.getUnitSnapshot(this.data.member.id));
        return missiles.length === 0 ? null : infernoEffectText(infernoEffect(this.data.member.entity, missiles, earlier));
    });
    /** Infantry and battle armor allocate damage by trooper: the player applies it on the sheet. */
    protected readonly applicable = computed(() =>
        this.weapons().every(weapon => weapon.inferno || weapon.groups.every(group => group.label !== null)));

    protected accept(): void {
        this.dialogRef.close(true);
    }

    protected ignore(): void {
        this.dialogRef.close(false);
    }
}
