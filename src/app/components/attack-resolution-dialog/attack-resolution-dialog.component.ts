// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import { DIALOG_DATA, DialogRef } from '@angular/cdk/dialog';
import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';

import type { ComponentId } from '../../models/entity/entity-identifiers';
import type { CBTForceMember } from '../../models/force-member.model';
import type { PhysicalAttackKind } from '../../models/rules/physical-attack-rules';
import {
    damageGroups,
    needsClusterRoll,
    resolveWeaponAttack,
    type HitLocationDice,
    type TwoDice,
    type WeaponAttackProfile,
} from '../../models/rules/weapon-attack-resolution';
import { roll2D6, rollD6 } from '../../models/runtime/mek-automation-rules';
import type { AttackWeaponReport } from '../../services/game-events.service';
import type { MekHitArc } from '../../utils/record-sheet-reference-table';
import {
    ATTACK_ARC_LABELS,
    AttackReportComponent,
    attackReportGroup,
    type AttackReportRollEdit,
    type AttackReportWeapon,
} from '../attack-report/attack-report.component';

export interface AttackResolutionTarget {
    readonly name: string;
    readonly letter: string;
    readonly color: string;
    readonly arc: MekHitArc;
    /** The struck unit when its force is open here, so hit locations can be read on its table. */
    readonly defender: CBTForceMember | null;
    /** Where hits are sent: the owner of a linked OPFOR unit. */
    readonly delivery: Readonly<{ toForce: string; toUnit: string }> | null;
    readonly profiles: readonly WeaponAttackProfile[];
}

export interface AttackResolutionDialogData {
    readonly attacker: string;
    readonly targets: readonly AttackResolutionTarget[];
}

/** A resolved physical attack, for the consequences on the attacker's side. */
export interface PhysicalAttackOutcome {
    readonly kind: PhysicalAttackKind;
    readonly hit: boolean;
    /** The struck unit's tonnage when it is open here: a charge costs the attacker 1 point per 10 tons. */
    readonly targetTons: number | null;
}

/** What the attacker settles when the dialog closes: hits to send, weapons that jammed, physical outcomes. */
export interface AttackResolution {
    readonly deliveries: readonly AttackDelivery[];
    readonly jammed: readonly ComponentId[];
    readonly physical: readonly PhysicalAttackOutcome[];
}

export interface AttackDelivery {
    readonly name: string;
    readonly toForce: string;
    readonly toUnit: string;
    readonly arc: MekHitArc;
    readonly weapons: readonly AttackWeaponReport[];
}

interface WeaponRolls {
    readonly toHit: TwoDice;
    readonly cluster: TwoDice;
    readonly clusterModifier: number;
    /** One roll per possible location group; a smaller cluster result uses the first ones. */
    readonly locations: readonly Readonly<{ dice: HitLocationDice; aux: number }>[];
}

@Component({
    selector: 'attack-resolution-dialog',
    imports: [AttackReportComponent],
    changeDetection: ChangeDetectionStrategy.OnPush,
    templateUrl: './attack-resolution-dialog.component.html',
    styleUrl: './attack-resolution-dialog.component.scss',
})
export class AttackResolutionDialogComponent {
    private readonly dialogRef = inject<DialogRef<AttackResolution>>(DialogRef);
    protected readonly data = inject<AttackResolutionDialogData>(DIALOG_DATA);
    protected readonly arcLabels = ATTACK_ARC_LABELS;

    private readonly rolls = signal(this.data.targets.map(target => target.profiles.map(rollWeapon)));

    protected readonly targets = computed(() => this.data.targets.map((target, t) => {
        const weapons = target.profiles.map((profile, w) => reportWeapon(target, profile, this.rolls()[t][w]));
        return {
            target,
            weapons,
            hits: weapons.reduce((sum, weapon) => sum + weapon.groups.length, 0),
            damage: weapons.reduce((sum, weapon) =>
                sum + weapon.groups.reduce((total, group) => total + group.damage, 0), 0),
        };
    }));
    protected readonly deliverable = computed(() => this.data.targets.filter(target => target.delivery !== null));

    protected rerollAll(): void {
        this.rolls.set(this.data.targets.map(target => target.profiles.map(rollWeapon)));
    }

    protected reroll(target: number, weapon: number): void {
        this.updateWeapon(target, weapon, () => rollWeapon(this.data.targets[target].profiles[weapon]));
    }

    protected setRoll(target: number, edit: AttackReportRollEdit): void {
        const dice = diceForTotal(edit.total);
        this.updateWeapon(target, edit.weapon, rolls => edit.roll === 'to-hit' ? { ...rolls, toHit: dice }
            : edit.roll === 'cluster' ? { ...rolls, cluster: dice }
                : { ...rolls, locations: rolls.locations.map((location, index) => index !== edit.roll ? location
                    : { ...location, dice: location.dice.length === 1 ? Object.freeze([edit.total] as const) : dice }) });
    }

    protected setClusterModifier(target: number, edit: Readonly<{ weapon: number; modifier: number }>): void {
        this.updateWeapon(target, edit.weapon, rolls => ({ ...rolls, clusterModifier: edit.modifier }));
    }

    protected send(): void {
        this.dialogRef.close(Object.freeze({
            deliveries: Object.freeze(this.targets().flatMap(({ target }, t) => target.delivery ? [Object.freeze({
                name: target.name,
                ...target.delivery,
                arc: target.arc,
                weapons: Object.freeze(target.profiles.map((profile, w) => deliveredWeapon(profile, this.rolls()[t][w]))),
            })] : [])),
            jammed: this.jammed(),
            physical: this.physical(),
        }));
    }

    /** Closing without sending still settles the rolls the attacker made, such as a jam or a missed DFA. */
    protected close(): void {
        this.dialogRef.close(Object.freeze({ deliveries: Object.freeze([]), jammed: this.jammed(), physical: this.physical() }));
    }

    private physical(): readonly PhysicalAttackOutcome[] {
        return Object.freeze(this.data.targets.flatMap((target, t) => target.profiles.flatMap((profile, w) =>
            profile.physical === undefined ? [] : [Object.freeze({
                kind: profile.physical,
                hit: resolveWeaponAttack(profile, this.rolls()[t][w].toHit, null).hit,
                targetTons: target.defender?.entity.tonnage() ?? null,
            })])));
    }

    private jammed(): readonly ComponentId[] {
        return Object.freeze(this.data.targets.flatMap((target, t) => target.profiles.flatMap((profile, w) =>
            profile.componentId !== null
                && resolveWeaponAttack(profile, this.rolls()[t][w].toHit, this.rolls()[t][w].cluster).jammed
                ? [profile.componentId] : [])));
    }

    private updateWeapon(target: number, weapon: number, update: (rolls: WeaponRolls) => WeaponRolls): void {
        this.rolls.update(all => all.map((weapons, t) => t !== target ? weapons
            : weapons.map((rolls, w) => w === weapon ? update(rolls) : rolls)));
    }
}

function rollWeapon(profile: WeaponAttackProfile): WeaponRolls {
    const groups = damageGroups(profile.projectiles * profile.damagePerHit, profile.groupSize).length;
    return Object.freeze({
        toHit: roll2D6(),
        cluster: roll2D6(),
        clusterModifier: 0,
        locations: Object.freeze(Array.from({ length: groups }, () => Object.freeze({
            dice: profile.table === 'standard' ? roll2D6() : Object.freeze([rollD6()] as const),
            aux: rollD6(),
        }))),
    });
}

/** A set total shown as the closest pair of faces. */
function diceForTotal(total: number): TwoDice {
    return Object.freeze([Math.ceil(total / 2), Math.floor(total / 2)] as const);
}

function reportWeapon(target: AttackResolutionTarget, profile: WeaponAttackProfile, rolls: WeaponRolls): AttackReportWeapon {
    const cluster = needsClusterRoll(profile);
    const outcome = resolveWeaponAttack(profile, rolls.toHit, rolls.cluster, rolls.clusterModifier);
    return Object.freeze({
        name: profile.name,
        targetNumber: profile.targetNumber,
        toHit: rolls.toHit,
        hit: outcome.hit,
        jammed: outcome.jammed,
        cluster: cluster
            ? Object.freeze({ dice: rolls.cluster, modifier: rolls.clusterModifier, projectiles: profile.projectiles, hits: outcome.hits })
            : null,
        groups: Object.freeze(outcome.groups.map((damage, index) => attackReportGroup(target.defender,
            profile.arc ?? target.arc, damage, rolls.locations[index].dice, rolls.locations[index].aux,
            profile.partialCover, profile.table))),
    });
}

function deliveredWeapon(profile: WeaponAttackProfile, rolls: WeaponRolls): AttackWeaponReport {
    const outcome = resolveWeaponAttack(profile, rolls.toHit, rolls.cluster, rolls.clusterModifier);
    return Object.freeze({
        name: profile.name,
        types: profile.types,
        ...(profile.partialCover ? { partialCover: true as const } : {}),
        targetNumber: profile.targetNumber,
        toHit: rolls.toHit,
        ...(profile.table === 'standard' ? {} : { table: profile.table }),
        ...(profile.physical === undefined ? {} : { physical: profile.physical }),
        ...(profile.arc === undefined ? {} : { arc: profile.arc }),
        ...(outcome.hit && needsClusterRoll(profile) ? {
            cluster: Object.freeze({
                dice: rolls.cluster, modifier: rolls.clusterModifier, projectiles: profile.projectiles, hits: outcome.hits,
            }),
        } : {}),
        groups: Object.freeze(outcome.groups.map((damage, index) =>
            Object.freeze({ damage, location: rolls.locations[index].dice, aux: rolls.locations[index].aux }))),
    });
}
