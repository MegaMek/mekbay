// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import { DIALOG_DATA, DialogRef } from '@angular/cdk/dialog';
import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';

import type { ComponentId } from '../../models/entity/entity-identifiers';
import type { CBTForceMember } from '../../models/force-member.model';
import { hitTableDice, physicalAttackAlwaysHits, type PhysicalAttackKind } from '../../models/rules/physical-attack-rules';
import { heatWeaponDice, resolveHeatWeaponHit } from '../../models/rules/heat-weapon-rules';
import { AIMED_SHOT_LEG_REROLLS, type AimedShotRoll } from '../../models/rules/aimed-shot-rules';
import { LASER_INSULATOR_FAILURE_TARGET } from '../../models/laser-insulator.model';
import {
    attackGroups,
    needsClusterRoll,
    resolveWeaponAttack,
    type HitLocationDice,
    type TwoDice,
    type WeaponAttackProfile,
} from '../../models/rules/weapon-attack-resolution';
import { attackDamageLedger, attackDamagePreview, rollFloatingCriticals, readAttackThermalEffects, type AttackDamageLedger } from '../../models/runtime/attack-hit-location';
import { attackDamageSource } from '../../models/rules/armor-damage-rules';
import type { CBTRuleset } from '../../models/cbt-ruleset.model';
import type { TnTargetUnitType } from '../../models/target-number-calculator.model';
import { roll2D6, rollD6 } from '../../models/runtime/mek-automation-rules';
import type { AttackHitGroup, AttackWeaponReport } from '../../services/game-events.service';
import type { MekHitArc } from '../../utils/record-sheet-reference-table';
import {
    ATTACK_ARC_LABELS,
    AttackReportComponent,
    attackReportAim,
    attackReportGroup,
    type AttackReportRollEdit,
    type AttackReportWeapon,
} from '../attack-report/attack-report.component';

export interface AttackResolutionTarget {
    /** The target's encounter target id. */
    readonly targetId: string;
    readonly name: string;
    readonly letter: string;
    readonly color: string;
    readonly arc: MekHitArc;
    /** The struck unit when its force is open here, so hit locations can be read on its table. */
    readonly defender: CBTForceMember | null;
    /** Where hits are sent: the owner of a linked OPFOR unit. */
    readonly delivery: Readonly<{ toForce: string; toUnit: string }> | null;
    /** The attacker's ruleset, which reads the damage each hit deals where it strikes. */
    readonly ruleset: CBTRuleset;
    /** The target's declared type, when its unit is not open here. */
    readonly unitType?: TnTargetUnitType;
    readonly profiles: readonly WeaponAttackProfile[];
}

export interface AttackResolutionDialogData {
    readonly attacker: string;
    readonly targets: readonly AttackResolutionTarget[];
    readonly floatingCriticals?: boolean;
}

/** A resolved physical attack, for the consequences on the attacker's side. */
export interface PhysicalAttackOutcome {
    readonly kind: PhysicalAttackKind;
    readonly hit: boolean;
    /** The struck unit's tonnage when it is open here: a charge costs the attacker 1 point per 10 tons. */
    readonly targetTons: number | null;
    /** The target's encounter target id: a successful swarm takes hold of it. */
    readonly targetId: string;
    /** The attack's damage: a brush off that misses deals it to the attacker. */
    readonly damage: number;
}

/** What the attacker settles when the dialog closes: hits to send, weapons that jammed, physical outcomes. */
export interface AttackResolution {
    readonly deliveries: readonly AttackDelivery[];
    readonly jammed: readonly ComponentId[];
    /** Insulated lasers that suffer a critical hit (`LASER_INSULATOR_FAILURE_TARGET`). */
    readonly insulatorFailed: readonly ComponentId[];
    readonly burnedOutPpcs: readonly ComponentId[];
    /** Weapons whose lock-on roll failed (`locksOnTarget`): they fire nothing and make no heat. */
    readonly noLock: readonly ComponentId[];
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
    readonly locations: readonly Omit<AttackHitGroup, 'damage'>[];
    /** A heat weapon's dice; each hit reads the first ones it needs. */
    readonly heat: readonly number[];
    /** The side an attack that strikes a random side hits. */
    readonly side?: MekHitArc;
    /** An aimed shot's roll, and the leg rerolls of one at a target in partial cover. */
    readonly aim?: Readonly<{ roll: HitLocationDice; rerolls: readonly TwoDice[] }>;
    /** An insulated laser's failure roll, read after a to-hit roll of 2. */
    readonly insulator?: TwoDice;
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

    private readonly rolls = signal(this.rollAll());

    protected readonly targets = computed(() => this.data.targets.map((target, t) => {
        // Hits are previewed in the order the struck unit takes them.
        const ledger = attackDamageLedger();
        const deal = attackDamagePreview(target.defender, target.ruleset, target.unitType, ledger);
        const weapons = target.profiles.map((profile, w) => reportWeapon(target, profile, this.rolls()[t][w], deal, ledger));
        return {
            target,
            weapons,
            hits: weapons.reduce((sum, weapon) => sum + weapon.groups.length, 0),
            damage: weapons.reduce((sum, weapon) => weapon.inferno ? sum
                : sum + weapon.groups.reduce((total, group) => total + group.damage, 0), 0),
        };
    }));
    protected readonly deliverable = computed(() => this.targets().filter(({ target, weapons }) =>
        target.delivery !== null && weapons.some(weapon => !weapon.capacitorBurnout)));

    protected rerollAll(): void {
        this.rolls.set(this.rollAll());
    }

    protected reroll(target: number, weapon: number): void {
        this.updateWeapon(target, weapon, () => rollWeapon(this.data.targets[target].profiles[weapon]));
    }

    protected setRoll(target: number, edit: AttackReportRollEdit): void {
        const dice = diceForTotal(edit.total);
        this.updateWeapon(target, edit.weapon, rolls => edit.roll === 'to-hit' ? { ...rolls, toHit: dice }
            : edit.roll === 'cluster' ? { ...rolls, cluster: dice }
            : edit.roll === 'insulator' ? { ...rolls, insulator: dice }
            : edit.roll === 'heat' ? { ...rolls, heat: heatDiceForTotal(rolls.heat, this.heatDiceUsed(target, edit.weapon), edit.total) }
            : edit.roll === 'aim' ? { ...rolls, aim: rolls.aim && { ...rolls.aim,
                roll: rolls.aim.roll.length === 1 ? Object.freeze([edit.total] as const) : dice } }
                : { ...rolls, locations: rolls.locations.map((location, index) => index !== edit.roll ? location
                    : { ...location, location: location.location.length === 1 ? Object.freeze([edit.total] as const) : dice }) });
    }

    protected setClusterModifier(target: number, edit: Readonly<{ weapon: number; modifier: number }>): void {
        this.updateWeapon(target, edit.weapon, rolls => ({ ...rolls, clusterModifier: edit.modifier }));
    }

    protected send(): void {
        this.dialogRef.close(Object.freeze({
            deliveries: Object.freeze(this.targets().flatMap(({ target, weapons }, t) => {
                if (!target.delivery) return [];
                const reports = target.profiles.flatMap((profile, w) => weapons[w].capacitorBurnout
                    ? [] : [deliveredWeapon(profile, this.rolls()[t][w])]);
                return reports.length ? [Object.freeze({
                    name: target.name, ...target.delivery, arc: target.arc, weapons: Object.freeze(reports),
                })] : [];
            })),
            jammed: this.jammed(),
            insulatorFailed: this.insulatorFailed(),
            burnedOutPpcs: this.burnedOutPpcs(),
            noLock: this.noLock(),
            physical: this.physical(),
        }));
    }

    /** Closing without sending still settles the rolls the attacker made, such as a jam or a missed DFA. */
    protected close(): void {
        this.dialogRef.close(Object.freeze({
            deliveries: Object.freeze([]), jammed: this.jammed(), insulatorFailed: this.insulatorFailed(),
            burnedOutPpcs: this.burnedOutPpcs(), noLock: this.noLock(), physical: this.physical(),
        }));
    }

    private physical(): readonly PhysicalAttackOutcome[] {
        return Object.freeze(this.data.targets.flatMap((target, t) => target.profiles.flatMap((profile, w) =>
            profile.physical === undefined ? [] : [Object.freeze({
                kind: profile.physical,
                hit: physicalAttackAlwaysHits(profile.physical)
                    || resolveWeaponAttack(profile, this.rolls()[t][w].toHit, null).hit,
                targetTons: target.defender?.entity.tonnage() ?? null,
                targetId: target.targetId,
                damage: profile.damagePerHit,
            })])));
    }

    private jammed(): readonly ComponentId[] {
        return Object.freeze(this.data.targets.flatMap((target, t) => target.profiles.flatMap((profile, w) =>
            profile.componentId !== null
                && resolveWeaponAttack(profile, this.rolls()[t][w].toHit, this.rolls()[t][w].cluster).jammed
                ? [profile.componentId] : [])));
    }

    private insulatorFailed(): readonly ComponentId[] {
        return Object.freeze(this.data.targets.flatMap((target, t) => target.profiles.flatMap((profile, w) =>
            profile.componentId !== null && insulatorCheck(this.rolls()[t][w])?.failed ? [profile.componentId] : [])));
    }

    private noLock(): readonly ComponentId[] {
        return Object.freeze(this.data.targets.flatMap((target, t) => target.profiles.flatMap((profile, w) =>
            profile.componentId !== null && profile.allHit
                && !resolveWeaponAttack(profile, this.rolls()[t][w].toHit, this.rolls()[t][w].cluster).hit
                ? [profile.componentId] : [])));
    }

    private burnedOutPpcs(): readonly ComponentId[] {
        return Object.freeze(this.targets().flatMap(({ target, weapons }) => target.profiles.flatMap((profile, w) =>
            profile.componentId !== null && weapons[w].capacitorBurnout ? [profile.componentId] : [])));
    }

    private heatDiceUsed(target: number, weapon: number): number {
        return heatDiceRead(this.data.targets[target].profiles[weapon], this.rolls()[target][weapon].heat);
    }

    private updateWeapon(target: number, weapon: number, update: (rolls: WeaponRolls) => WeaponRolls): void {
        this.rolls.update(all => all.map((weapons, t) => t !== target ? weapons
            : weapons.map((rolls, w) => w === weapon ? this.float(target, weapon, update(rolls)) : rolls)));
    }

    private rollAll(): WeaponRolls[][] {
        return this.data.targets.map((target, t) => target.profiles.map((profile, w) => this.float(t, w, rollWeapon(profile))));
    }

    private float(t: number, w: number, rolls: WeaponRolls): WeaponRolls {
        const target = this.data.targets[t];
        if (!this.data.floatingCriticals) return rolls;
        const profile = target.profiles[w];
        const arc = rolls.side ?? profile.arc ?? target.arc;
        const table = { table: profile.table, aim: aimedShotRoll(profile, rolls), partialCover: profile.partialCover };
        return { ...rolls, locations: rollFloatingCriticals(target.defender, arc, table, rolls.locations, target.unitType) };
    }
}

function rollWeapon(profile: WeaponAttackProfile): WeaponRolls {
    const groups = attackGroups(profile, profile.projectiles).length;
    return Object.freeze({
        toHit: roll2D6(),
        cluster: roll2D6(),
        clusterModifier: profile.clusterModifier ?? 0,
        locations: Object.freeze(Array.from({ length: groups }, () => Object.freeze({
            location: hitTableDice(profile.table) === 2 ? roll2D6() : Object.freeze([rollD6()] as const),
            aux: rollD6(),
        }))),
        heat: Object.freeze(Array.from({ length: profile.heatWeapon ? heatWeaponDice(profile.heatWeapon.weapon) : 0 },
            () => rollD6())),
        ...(profile.randomSide ? { side: rollSide() } : {}),
        ...(profile.aim ? { aim: Object.freeze({
            roll: profile.aim.dice === 2 ? roll2D6() : Object.freeze([rollD6()] as const),
            rerolls: Object.freeze(Array.from({ length: profile.aim.rerollLegs ? AIMED_SHOT_LEG_REROLLS : 0 }, roll2D6)),
        }) } : {}),
        ...(profile.insulated ? { insulator: roll2D6() } : {}),
    });
}

/** An insulated laser's failure roll, which only an unmodified to-hit roll of 2 calls for; undefined otherwise. */
function insulatorCheck(rolls: WeaponRolls): NonNullable<AttackReportWeapon['insulator']> | undefined {
    return rolls.insulator && rolls.toHit[0] + rolls.toHit[1] === 2 ? Object.freeze({
        dice: rolls.insulator,
        failed: rolls.insulator[0] + rolls.insulator[1] >= LASER_INSULATOR_FAILURE_TARGET,
    }) : undefined;
}

/** The aimed shot of a weapon as rolled; undefined for a normal attack. */
function aimedShotRoll(profile: WeaponAttackProfile, rolls: WeaponRolls): AimedShotRoll | undefined {
    return profile.aim && rolls.aim ? Object.freeze({
        location: profile.aim.location,
        roll: rolls.aim.roll,
        ...(profile.aim.rerollLegs ? { rerolls: rolls.aim.rerolls } : {}),
    }) : undefined;
}

/** One of the four sides alike: a D6 read 1 front, 2 rear, 3 left, 4 right, rerolling 5 and 6. */
function rollSide(): MekHitArc {
    for (;;) {
        const side = (['front', 'rear', 'left', 'right'] as const)[rollD6() - 1];
        if (side) return side;
    }
}

/** How many of the heat weapon's dice its hit reads: heat against a unit that tracks it, damage against others. */
function heatDiceRead(profile: WeaponAttackProfile, dice: readonly number[]): number {
    const heat = profile.heatWeapon;
    return heat ? resolveHeatWeaponHit(heat.weapon, 0, heat.mode, heat.ruleset, heat.target, dice).dice : 0;
}

/** Sets the first `used` heat dice to `total`, as evenly as six-sided dice allow. */
function heatDiceForTotal(dice: readonly number[], used: number, total: number): readonly number[] {
    const set = Array.from({ length: used }, (_, index) => Math.floor(total / used) + (index < total % used ? 1 : 0));
    return Object.freeze([...set, ...dice.slice(used)]);
}

/** A set total shown as the closest pair of faces. */
function diceForTotal(total: number): TwoDice {
    return Object.freeze([Math.ceil(total / 2), Math.floor(total / 2)] as const);
}

function reportWeapon(
    target: AttackResolutionTarget,
    profile: WeaponAttackProfile,
    rolls: WeaponRolls,
    deal: ReturnType<typeof attackDamagePreview>,
    ledger: AttackDamageLedger,
): AttackReportWeapon {
    const source = attackDamageSource(profile);
    const cluster = needsClusterRoll(profile);
    const outcome = resolveWeaponAttack(profile, rolls.toHit, rolls.cluster, rolls.clusterModifier, rolls.heat);
    const heat = profile.heatWeapon;
    const heatDice = rolls.heat.slice(0, heatDiceRead(profile, rolls.heat));
    const aim = aimedShotRoll(profile, rolls);
    const insulator = insulatorCheck(rolls);
    const delivered = deliveredWeapon(profile, rolls, outcome);
    // Account for cover and the armor left by weapons earlier in the report.
    const heatValue = target.defender && outcome.heat > 0
        ? readAttackThermalEffects(target.defender, target.arc, [delivered], attackDamageLedger(ledger)).heat
        : outcome.heat;
    return Object.freeze({
        name: profile.name,
        targetNumber: profile.targetNumber,
        ...(physicalAttackAlwaysHits(profile.physical) ? { automaticHit: true as const } : {}),
        toHit: rolls.toHit,
        hit: outcome.hit,
        ...(outcome.capacitorBurnout ? { capacitorBurnout: true as const } : {}),
        jammed: outcome.jammed,
        ...(insulator ? { insulator } : {}),
        cluster: cluster
            ? Object.freeze({ dice: rolls.cluster, modifier: rolls.clusterModifier, projectiles: profile.projectiles, hits: outcome.hits })
            : null,
        ...(profile.inferno ? { inferno: true } : {}),
        ...(heat && (outcome.heat > 0 || heatDice.length > 0)
            ? { heat: Object.freeze({
                dice: Object.freeze(heatDice), value: heatValue, ...(heatValue < outcome.heat ? { reduced: true as const } : {}),
            }) }
            : {}),
        ...(aim ? { aim: attackReportAim(aim) } : {}),
        // Inferno missiles deal no damage of their own: the struck unit decides their effect.
        groups: Object.freeze(delivered.groups.map(group => attackReportGroup(target.defender, target.arc, delivered, group,
            profile.inferno ? undefined : (location, dealt) => deal(location, dealt, source)))),
    });
}

function deliveredWeapon(profile: WeaponAttackProfile, rolls: WeaponRolls,
    outcome = resolveWeaponAttack(profile, rolls.toHit, rolls.cluster, rolls.clusterModifier, rolls.heat)): AttackWeaponReport {
    const aim = outcome.hit ? aimedShotRoll(profile, rolls) : undefined;
    return Object.freeze({
        name: profile.name,
        types: profile.types,
        ...(profile.partialCover ? { partialCover: true as const } : {}),
        targetNumber: profile.targetNumber,
        toHit: rolls.toHit,
        ...(profile.table === 'standard' ? {} : { table: profile.table }),
        ...(profile.physical === undefined ? {} : { physical: profile.physical }),
        ...(profile.critical ? { critical: true as const } : {}),
        ...(profile.rifle ? { rifle: true as const } : {}),
        ...(profile.ammo ? { ammo: profile.ammo } : {}),
        ...(profile.rackSize === undefined ? {} : { rackSize: profile.rackSize }),
        // A brush off that hits knocks the swarming infantry off (TW p. 222).
        ...(profile.physical === 'brush-off' && outcome.hit ? { swarmRelease: true as const } : {}),
        ...((rolls.side ?? profile.arc) === undefined ? {} : { arc: rolls.side ?? profile.arc }),
        ...(profile.inferno ? { inferno: true as const } : {}),
        ...(outcome.heat > 0 ? { heat: outcome.heat } : {}),
        ...(aim ? { aim } : {}),
        ...(outcome.hit && needsClusterRoll(profile) ? {
            cluster: Object.freeze({
                dice: rolls.cluster, modifier: rolls.clusterModifier, projectiles: profile.projectiles, hits: outcome.hits,
            }),
        } : {}),
        groups: Object.freeze(outcome.groups.map((damage, index) =>
            Object.freeze({ damage, ...rolls.locations[index] }))),
    });
}
