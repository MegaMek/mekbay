// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import { infantryCasualtyDiceCount } from '../../models/rules/infantry-hit-damage';
import { infantryCasualtyCounter, reportedInfantryCasualties } from '../../models/runtime/infantry-hit-allocation';
import { isInfantryEntity } from '../../models/entity/utils/entity-type-guards';
import { missileDefenseSystems } from '../../models/runtime/anti-missile-defense';
import { buildingCollateral } from '../../models/rules/infantry-building-damage';

import { DIALOG_DATA, DialogRef } from '@angular/cdk/dialog';
import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';

import type { ComponentId } from '../../models/entity/entity-identifiers';
import type { BuildingChargeHex } from '../../models/runtime/building-cf';
import type { CBTForceMember } from '../../models/force-member.model';
import { hitTableDice, physicalAttackAlwaysHits, type PhysicalAttackKind } from '../../models/rules/physical-attack-rules';
import { heatWeaponDice, resolveHeatWeaponHit } from '../../models/rules/heat-weapon-rules';
import { AIMED_SHOT_LEG_REROLLS, type AimedShotRoll } from '../../models/rules/aimed-shot-rules';
import { LASER_INSULATOR_FAILURE_TARGET } from '../../models/laser-insulator.model';
import {
    attackEffect,
    attackGroups,
    needsClusterRoll,
    toHitSucceeds,
    resolveWeaponAttack,
    aerospaceHeatDice,
    type HitLocationDice,
    type TwoDice,
    type WeaponAttackProfile,
} from '../../models/rules/weapon-attack-resolution';
import { shelterHitReport, shelterGroupDamage, shelterDamage, attackDamageLedger, attackDamagePreview, rollFloatingCriticals, readAttackThermalEffects, type AttackDamageLedger } from '../../models/runtime/attack-hit-location';
import { attackDamageSource } from '../../models/rules/armor-damage-rules';
import type { CBTRuleset } from '../../models/cbt-ruleset.model';
import type { TnTargetUnitType } from '../../models/target-number-calculator.model';
import { roll2D6, rollD6 } from '../../models/runtime/mek-automation-rules';
import type { AttackHitGroup, AttackWeaponReport } from '../../services/game-events.service';
import type { TnAttackDirection } from '../../models/target-number-calculator.model';
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
    readonly arc: TnAttackDirection;
    /** The struck unit when its force is open here, so hit locations can be read on its table. */
    readonly defender: CBTForceMember | null;
    /** Where hits are sent: the owner of a linked OPFOR unit. */
    readonly delivery: Readonly<{ toForce: string; toUnit: string }> | null;
    /** The attacker's ruleset, which reads the damage each hit deals where it strikes. */
    readonly ruleset: CBTRuleset;
    /** The target's declared type, when its unit is not open here. */
    readonly unitType?: TnTargetUnitType;
    /** Present when charging a TW building. An unlinked target has no known hex CF. */
    readonly buildingChargeHexes?: readonly BuildingChargeHex[];
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
    /** The current CF of the charged building hex, or null for a manually recorded building. */
    readonly buildingChargeCf?: number | null;
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
    readonly arc: TnAttackDirection;
    readonly weapons: readonly AttackWeaponReport[];
}

interface WeaponRolls {
    readonly infantryDice?: readonly number[];
    readonly toHit: TwoDice;
    readonly cluster: TwoDice;
    readonly additionalClusters: readonly TwoDice[];
    readonly clusterModifier: number;
    readonly amsDie?: number;
    readonly amsDice?: readonly number[];
    readonly laserAms?: boolean;
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
    protected readonly chargeHexes = signal(this.data.targets.map(target =>
        target.buildingChargeHexes?.length === 1 ? target.buildingChargeHexes[0] : undefined));

    protected selectChargeHex(target: number, location: string): void {
        const hex = this.data.targets[target].buildingChargeHexes?.find(choice => choice.location === location);
        this.chargeHexes.update(current => current.map((choice, t) => t === target ? hex : choice));
    }

    protected readonly awaitingHex = computed(() => this.data.targets.some((target, t) =>
        !!target.buildingChargeHexes?.length && !this.chargeHexes()[t]));

    private readonly rolls = signal(this.rollAll());
    protected readonly manualTargets = signal<ReadonlySet<number>>(new Set());
    protected readonly hasCommittedDefense = computed(() => this.rolls().some(rows => rows.some(row => row.amsDice !== undefined)));
    protected readonly awaitingManual = computed(() => this.targets().some((row, t) =>
        (!row.target.delivery || this.manualTargets().has(t)) && row.awaiting.some(Boolean)));

    protected readonly targets = computed(() => this.data.targets.map((target, t) => {
        // Hits are previewed in the order the struck unit takes them.
        const ledger = attackDamageLedger();
        const deal = attackDamagePreview(target.defender, target.ruleset, target.unitType, ledger);
        const strength = target.defender && isInfantryEntity(target.defender.entity)
            ? target.defender.nonMekRecordSheetSnapshot()?.locations.find(row => row.code === 'Infantry')?.previewRemainingInternal
            : undefined;
        const countCasualties = infantryCasualtyCounter(strength);
        const rolls = this.rolls()[t];
        const awaiting = target.profiles.map((profile, w) => {
            if (!profile.missileDefense || rolls[w].amsDice !== undefined || !toHitSucceeds(rolls[w].toHit, profile.targetNumber)) return false;
            if (!target.delivery || this.manualTargets().has(t)) return true;
            const snap = target.defender?.force.getUnitSnapshot(target.defender.id);
            return !snap || missileDefenseSystems(target.defender!.entity, snap.index, snap.state, snap.query,
                snap.ruleset, profile.arc ?? target.arc).length > 0;
        });
        const weapons = target.profiles.map((profile, w): AttackReportWeapon => {
            // A hidden hit cannot spend preview armor or troopers and reveal its result through the next weapon.
            if (awaiting[w]) return {
                name: profile.name, targetNumber: profile.targetNumber, toHit: rolls[w].toHit, hit: true, groups: [],
                ...(profile.automaticBuildingHit ? { automaticHit: true as const, rollForEffects: true as const } : {}),
                cluster: needsClusterRoll(profile) ? clusterReport(profile, rolls[w], 0) : null,
            };
            return reportWeapon(target, profile, rolls[w], deal, ledger, countCasualties);
        });
        return {
            target, weapons, awaiting,
            locked: rolls.map(roll => roll.amsDice !== undefined),
            hits: weapons.reduce((sum, weapon) => sum + weapon.groups.length, 0),
            damage: weapons.reduce((sum, weapon) => weapon.inferno ? sum
                : sum + weapon.groups.reduce((total, group) => total + group.damage, 0), 0),
        };
    }));
    protected readonly deliverable = computed(() => this.targets().filter(({ target, weapons }, t) =>
        (!this.manualTargets().has(t) && target.delivery !== null && weapons.some(weapon => !weapon.capacitorBurnout))
        || target.profiles.some((profile, index) => profile.shelteringBuilding && weapons[index].buildingDamage)));

    protected rerollAll(): void {
        if (!this.hasCommittedDefense()) this.rolls.set(this.rollAll());
    }

    protected reroll(target: number, weapon: number): void {
        if (this.rolls()[target][weapon].amsDice !== undefined) return;
        this.updateWeapon(target, weapon, () => rollWeapon(this.data.targets[target].profiles[weapon], this.data.targets[target]));
    }

    protected setRoll(target: number, edit: AttackReportRollEdit): void {
        if (this.rolls()[target][edit.weapon].amsDice !== undefined) return;
        const dice = diceForTotal(edit.total);
        if (typeof edit.roll === 'object') {
            const index = edit.roll.additionalCluster;
            this.updateWeapon(target, edit.weapon, rolls => ({ ...rolls,
                additionalClusters: rolls.additionalClusters.map((current, i) => i === index ? dice : current) }));
            return;
        }
        this.updateWeapon(target, edit.weapon, rolls => edit.roll === 'to-hit' ? { ...rolls, toHit: dice }
            : edit.roll === 'cluster' ? { ...rolls, cluster: dice }
            : edit.roll === 'insulator' ? { ...rolls, insulator: dice }
            : edit.roll === 'heat' ? { ...rolls, heat: heatDiceForTotal(rolls.heat, this.heatDiceUsed(target, edit.weapon), edit.total) }
            : edit.roll === 'aim' ? { ...rolls, aim: rolls.aim && { ...rolls.aim,
                roll: rolls.aim.roll.length === 1 ? Object.freeze([edit.total] as const) : dice } }
                : { ...rolls, locations: rolls.locations.map((location, index) => index !== edit.roll ? location
                    : { ...location, location: location.location.length === 1 ? Object.freeze([edit.total] as const) : dice }) });
    }

    protected recordOnTable(target: number): void {
        this.manualTargets.update(set => new Set([...set, target]));
    }

    protected confirmManualDefense(target: number, weapon: number, count: number, laser = false): void {
        const row = this.data.targets[target];
        const profile = row.profiles[weapon];
        if ((row.delivery && !this.manualTargets().has(target)) || !this.targets()[target].awaiting[weapon]
            || !Number.isSafeInteger(count) || count < 0 || count > (profile.aerospace ? 128 : 1)) return;
        this.dialogRef.disableClose = true;
        this.updateWeapon(target, weapon, rolls => ({ ...rolls, laserAms: laser,
            amsDice: Array.from({ length: count }, (_, i) => i === 0 ? rolls.amsDie! : rollD6()) }));
    }

    protected setClusterModifier(target: number, edit: Readonly<{ weapon: number; modifier: number }>): void {
        if (this.rolls()[target][edit.weapon].amsDice === undefined)
            this.updateWeapon(target, edit.weapon, rolls => ({ ...rolls, clusterModifier: edit.modifier }));
    }

    protected send(): void {
        this.dialogRef.close(Object.freeze({
            deliveries: Object.freeze(this.targets().flatMap<AttackDelivery>(({ target, weapons }, t) => {
                if (!target.delivery || this.manualTargets().has(t)) return target.profiles.flatMap((profile, w) => {
                    const ref = profile.shelteringBuilding;
                    const damage = weapons[w].buildingDamage;
                    return ref && damage ? [{ name: ref.location, toForce: ref.forceId, toUnit: ref.unitId,
                        arc: target.arc, weapons: [shelterHitReport(profile.name, damage, ref.location)] }] : [];
                });
                const chargeHex = this.chargeHexes()[t];
                const reports = target.profiles.flatMap((profile, w) => {
                    if (weapons[w].capacitorBurnout) return [];
                    const report = deliveredWeapon(profile, this.rolls()[t][w]);
                    return [chargeHex ? { ...report, groups: report.groups.map(group => ({ ...group, buildingLocation: chargeHex.location })) } : report];
                });
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
                    || this.targets()[t].weapons[w].hit,
                targetTons: target.defender?.entity.tonnage() ?? null,
                ...(profile.physical === 'charge' && target.buildingChargeHexes
                    ? { buildingChargeCf: this.chargeHexes()[t]?.cf ?? null } : {}),
                targetId: target.targetId,
                damage: profile.damagePerHit,
            })])));
    }

    private jammed(): readonly ComponentId[] {
        return Object.freeze(this.data.targets.flatMap((target, t) => target.profiles.flatMap((profile, w) =>
            profile.aerospace?.jamChecks
                ? profile.aerospace.jamChecks.filter(check => this.rolls()[t][w].toHit[0] + this.rolls()[t][w].toHit[1] <= check.threshold).map(check => check.id)
                : profile.componentId !== null && this.targets()[t].weapons[w].jammed ? [profile.componentId] : [])));
    }

    private insulatorFailed(): readonly ComponentId[] {
        return Object.freeze(this.data.targets.flatMap((target, t) => target.profiles.flatMap((profile, w) =>
            profile.componentId !== null && insulatorCheck(this.rolls()[t][w])?.failed ? [profile.componentId] : [])));
    }

    private noLock(): readonly ComponentId[] {
        return Object.freeze(this.data.targets.flatMap((target, t) => target.profiles.flatMap((profile, w) =>
            profile.componentId !== null && profile.lockRequired
                && !this.targets()[t].weapons[w].hit
                ? [profile.componentId] : [])));
    }

    private burnedOutPpcs(): readonly ComponentId[] {
        return Object.freeze(this.targets().flatMap(({ target, weapons }) => target.profiles.flatMap((profile, w) =>
            profile.componentId !== null && weapons[w].capacitorBurnout ? [profile.componentId] : [])));
    }

    private heatDiceUsed(target: number, weapon: number): number {
        return this.targets()[target].weapons[weapon].heat?.dice.length ?? 0;
    }

    private updateWeapon(target: number, weapon: number, update: (rolls: WeaponRolls) => WeaponRolls): void {
        this.rolls.update(all => all.map((weapons, t) => t !== target ? weapons
            : weapons.map((rolls, w) => w === weapon ? this.float(target, weapon, update(rolls)) : rolls)));
    }

    private rollAll(): WeaponRolls[][] {
        return this.data.targets.map((target, t) => target.profiles.map((profile, w) => this.float(t, w, rollWeapon(profile, target))));
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

function isConventionalTarget(target: AttackResolutionTarget): boolean {
    return target.defender ? isInfantryEntity(target.defender.entity) : target.unitType === 'infantry';
}

function rollWeapon(profile: WeaponAttackProfile, target: AttackResolutionTarget): WeaponRolls {
    const groups = attackGroups(profile, profile.projectiles).length;
    return Object.freeze({
        ...(isConventionalTarget(target) ? { infantryDice: Array.from({ length: infantryCasualtyDiceCount(
            profile.infantryClass, groups, profile.infantryBurstDice) }, () => rollD6()) } : {}),
        toHit: roll2D6(),
        cluster: roll2D6(),
        additionalClusters: profile.clusterColumns?.slice(1).map(() => roll2D6()) ?? [],
        clusterModifier: profile.clusterModifier ?? 0,
        ...(profile.missileDefense ? { amsDie: rollD6() } : {}),
        locations: Object.freeze(Array.from({ length: groups }, () => Object.freeze({
            location: hitTableDice(profile.table) === 2 ? roll2D6() : Object.freeze([rollD6()] as const),
            aux: rollD6(),
        }))),
        heat: Object.freeze(Array.from({ length: profile.aerospace ? aerospaceHeatDice(profile) : profile.heatWeapon ? heatWeaponDice(profile.heatWeapon.weapon) : 0 },
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
    if (profile.aerospace) return aerospaceHeatDice(profile);
    return heat ? resolveHeatWeaponHit(heat.weapon, 0, heat.mode, heat.ruleset, heat.target, dice).dice : 0;
}

function againstBuilding(profile: WeaponAttackProfile): WeaponAttackProfile {
    const target = { tracksHeat: false, fireResistant: false };
    return profile.heatWeapon ? { ...profile, heatWeapon: { ...profile.heatWeapon, target } } : profile;
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
    countCasualties: (damage: number) => number,
): AttackReportWeapon {
    const source = attackDamageSource(profile);
    const outcome = resolveWeaponAttack(profile, rolls.toHit, rolls.cluster, rolls.clusterModifier, rolls.heat,
        rolls.amsDice?.length ? rolls.amsDice.reduce((sum, die) => sum + die, 0) : undefined, rolls.additionalClusters, rolls.laserAms);
    const heat = profile.heatWeapon;
    const aim = aimedShotRoll(profile, rolls);
    const insulator = insulatorCheck(rolls);
    const delivered = deliveredWeapon(profile, rolls, outcome);
    const heatProfile = !outcome.hit && delivered.strayBuildingDamage ? againstBuilding(profile) : profile;
    const heatDice = rolls.heat.slice(0, heatDiceRead(heatProfile, rolls.heat));
    const casualty = isConventionalTarget(target) && outcome.hit && !profile.inferno && !profile.narcPod;
    const infantry = target.defender && isInfantryEntity(target.defender.entity) ? target.defender.entity : null;
    const casualties = casualty ? countCasualties(reportedInfantryCasualties(delivered, infantry?.isMechanized() ?? false,
        infantry?.armorDivisor() ?? 1, rollD6)) : 0;
    const unknownInfantry = casualty && !infantry;
    // Account for cover and the armor left by weapons earlier in the report.
    const heatValue = target.defender && outcome.heat > 0
        ? readAttackThermalEffects(target.defender, target.arc, [delivered], attackDamageLedger(ledger)).heat
        : outcome.heat;
    return Object.freeze({
        name: profile.name,
        targetNumber: profile.targetNumber,
        ...(physicalAttackAlwaysHits(profile.physical) || profile.automaticBuildingHit ? { automaticHit: true as const } : {}),
        ...(profile.automaticBuildingHit ? { rollForEffects: true as const } : {}),
        toHit: rolls.toHit,
        hit: outcome.hit,
        ...(outcome.capacitorBurnout ? { capacitorBurnout: true as const } : {}),
        jammed: outcome.jammed,
        ...(insulator ? { insulator } : {}),
        cluster: delivered.cluster ?? null,
        ...(profile.inferno ? { inferno: true } : {}),
        ...(profile.narcPod ? { narcPod: true } : {}),
        buildingDamage: shelterDamage(target.defender, target.arc, delivered, target.ruleset, target.unitType),
        collateral: buildingCollateral(profile, outcome.groups.reduce((sum, damage) => sum + damage, 0)),
        ...(rolls.amsDice?.length ? { amsDice: rolls.amsDice } : {}),
        ...((heat || profile.aerospace) && (outcome.heat > 0 || heatDice.length > 0)
            ? { heat: Object.freeze({
                dice: Object.freeze(heatDice), value: heatValue, ...(heatValue < outcome.heat ? { reduced: true as const } : {}),
            }) }
            : {}),
        ...(aim ? { aim: attackReportAim(aim) } : {}),
        ...(casualty && rolls.infantryDice?.length ? { casualtyDice: rolls.infantryDice.slice(0,
            infantryCasualtyDiceCount(profile.infantryClass, delivered.groups.filter(group => group.damage > 0).length, profile.infantryBurstDice)) } : {}),
        ...(unknownInfantry ? { manualInfantry: {
            mechanized: reportedInfantryCasualties(delivered, true, 1, rollD6),
            ...(delivered.infantryClass === 'infantry' || delivered.infantryClass?.startsWith('burst-') ? { armorApplies: true } : {}),
        } } : {}),
        // Inferno missiles deal no damage of their own: the struck unit decides their effect.
        groups: casualty ? [{ damage: casualties, troopers: true as const, label: 'Troopers', location: rolls.toHit }] : Object.freeze(delivered.groups.map(group => {
            const report = attackReportGroup(target.defender, target.arc, delivered, group,
                profile.inferno ? undefined : (location, damage) => deal(location, damage, source));
            if (!target.defender && group.buildingDamage !== undefined && shelterGroupDamage(null, target.arc, delivered, group, target.ruleset, target.unitType) > group.buildingDamage) {
                return { ...report, damage: 0, label: 'Building' };
            }
            return report;
        })),
    });
}

function clusterReport(profile: WeaponAttackProfile, rolls: WeaponRolls, hits: number): NonNullable<AttackWeaponReport['cluster']> {
    return { dice: rolls.cluster, modifier: rolls.clusterModifier, projectiles: profile.projectiles, hits,
        ...(rolls.additionalClusters.length ? { additionalDice: rolls.additionalClusters } : {}) };
}

function deliveredWeapon(profile: WeaponAttackProfile, rolls: WeaponRolls,
    outcome = resolveWeaponAttack(profile, rolls.toHit, rolls.cluster, rolls.clusterModifier, rolls.heat, undefined, rolls.additionalClusters)): AttackWeaponReport {
    let strayBuildingDamage = 0;
    if (outcome.buildingHits !== undefined || (profile.adjacentShelter === 'all-misses' && !profile.inferno
        && !profile.narcPod && !outcome.capacitorBurnout && (outcome.hit || !profile.lockRequired))) {
        const buildingProfile = againstBuilding(profile);
        const wallDamage = (hits: number) => attackEffect(buildingProfile, hits, rolls.heat).groups.reduce((sum, damage) => sum + damage, 0);
        if (outcome.buildingHits !== undefined) {
            strayBuildingDamage = wallDamage(outcome.buildingHits);
        } else {
            // BMM p. 72 includes misses within a salvo against a Mek. Intercepted missiles never reach the wall.
            const undefended = rolls.amsDice?.length
                ? resolveWeaponAttack(profile, rolls.toHit, rolls.cluster, rolls.clusterModifier, rolls.heat, undefined, rolls.additionalClusters)
                : outcome;
            strayBuildingDamage = Math.max(0, wallDamage(profile.projectiles) - wallDamage(undefended.hits));
        }
    }
    const aim = outcome.hit ? aimedShotRoll(profile, rolls) : undefined;
    const intercepted = outcome.hit && rolls.amsDie ? resolveWeaponAttack(profile, rolls.toHit, rolls.cluster,
        rolls.clusterModifier, rolls.heat, rolls.amsDie, rolls.additionalClusters) : null;
    const laser = intercepted && profile.missileDefense === 'total-warfare' && !profile.aerospace
        ? resolveWeaponAttack(profile, rolls.toHit, rolls.cluster, rolls.clusterModifier, rolls.heat, rolls.amsDie, rolls.additionalClusters, true) : null;
    const defense = (result: typeof outcome) => ({ hits: result.hits, damage: result.groups, heat: result.heat,
        ...(result.absorbed ? { absorbed: result.absorbed } : {}) });
    return Object.freeze({
        name: profile.name,
        infantryClass: profile.infantryClass,
        ...(strayBuildingDamage ? { strayBuildingDamage } : {}),
        ...(profile.automaticBuildingHit ? { automaticBuildingHit: true as const } : {}),
        ...(profile.shelteringBuilding ? { shelteringBuilding: profile.shelteringBuilding } : {}),
        ...(profile.infantryBuilding ? { infantryBuilding: profile.infantryBuilding } : {}),
        ...(profile.collateralBuilding ? { collateralBuilding: profile.collateralBuilding } : {}),
        infantryBurstDice: profile.infantryBurstDice,
        ...(rolls.infantryDice?.length ? { infantryDice: rolls.infantryDice } : {}),
        infantryInOpen: profile.infantryInOpen,
        types: profile.types,
        ...(profile.partialCover ? { partialCover: true as const } : {}),
        targetNumber: profile.targetNumber,
        toHit: rolls.toHit,
        ...(profile.table === 'standard' ? {} : { table: profile.table }),
        ...(profile.projectiles > 1 && profile.damagePerHit > 0 ? { projectileDamage: profile.damagePerHit } : {}),
        ...(profile.mekPhysical ? { mekPhysical: true as const } : {}),
        ...(profile.physical === undefined ? {} : { physical: profile.physical }),
        ...(profile.critical ? { critical: true as const } : {}),
        ...(profile.rifle ? { rifle: true as const } : {}),
        ...(profile.capitalScale ? { capitalScale: true as const } : {}),
        ...(profile.ammo ? { ammo: profile.ammo } : {}),
        ...(profile.rackSize === undefined ? {} : { rackSize: profile.rackSize }),
        // A brush off that hits knocks the swarming infantry off (TW p. 222).
        ...(profile.physical === 'brush-off' && outcome.hit ? { swarmRelease: true as const } : {}),
        ...((rolls.side ?? profile.arc) === undefined ? {} : { arc: rolls.side ?? profile.arc }),
        ...(profile.inferno ? { inferno: true as const } : {}),
        ...(profile.narcPod ? { narcPod: true as const } : {}),
        ...(intercepted ? { ams: { die: rolls.amsDie!, ...defense(intercepted),
            ...(laser ? { laser: defense(laser) } : {}),
            ...(profile.aerospace && profile.aerospace.attackValue > 0 ? { aerospace: {
                av: profile.aerospace.attackValue, groupSize: profile.aerospace.grouping === 'cluster' ? 5 : profile.aerospace.attackValue,
                absorption: profile.buildingAbsorption ?? 0,
            } } : {}) } } : {}),
        ...(outcome.heat > 0 ? { heat: outcome.heat } : {}),
        ...(outcome.heat && profile.squadFlamers ? { heatPerGroup: outcome.heat / outcome.hits } : {}),
        ...(aim ? { aim } : {}),
        ...((outcome.hit || outcome.buildingHits !== undefined) && needsClusterRoll(profile) ? {
            cluster: clusterReport(profile, rolls, outcome.buildingHits ?? outcome.hits),
        } : {}),
        groups: Object.freeze(outcome.groups.map((damage, index) =>
            Object.freeze({ damage, ...rolls.locations[index],
                ...(profile.buildingCover || outcome.absorbed ? { buildingDamage: outcome.absorbed?.[index] ?? 0 } : {}) }))),
    });
}
