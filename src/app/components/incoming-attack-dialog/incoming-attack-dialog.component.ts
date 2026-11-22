// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import { buildingCollateral } from '../../models/rules/infantry-building-damage';

import { DIALOG_DATA, DialogRef } from '@angular/cdk/dialog';
import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';

import type { ComponentId } from '../../models/entity/entity-identifiers';
import { interceptedReport, missileDefenseSystems } from '../../models/runtime/anti-missile-defense';
import type { CBTForceMember } from '../../models/force-member.model';
import { toHitSucceeds } from '../../models/rules/weapon-attack-resolution';
import { attackDamageSource } from '../../models/rules/armor-damage-rules';
import { infernoEffect, infernoEffectText } from '../../models/rules/inferno-rules';
import {
    attackDamagePreview,
    infernoMissilesThisTurn,
    readAttackThermalEffects,
    weaponHitLocation,
    type AttackHitLocation,
} from '../../models/runtime/attack-hit-location';
import type { AttackEvent } from '../../services/game-events.service';
import { OptionsService } from '../../services/options.service';
import { attackReleasesSwarm, attackSwarms } from '../../services/attack-resolution.service';
import { physicalAttackAlwaysHits } from '../../models/rules/physical-attack-rules';
import {
    ATTACK_ARC_LABELS,
    AttackReportComponent,
    attackReportAim,
    attackReportGroup,
    type AttackReportWeapon,
} from '../attack-report/attack-report.component';

export type IncomingAttackChoice = boolean | Readonly<{ buildingLocation?: string; defenses: readonly Readonly<{ weapon: number; componentId: ComponentId }>[] }>;

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
    private readonly dialogRef = inject<DialogRef<IncomingAttackChoice>>(DialogRef);
    protected readonly data = inject<IncomingAttackDialogData>(DIALOG_DATA);
    protected readonly arcLabel = ATTACK_ARC_LABELS[this.data.event.arc];
    protected readonly defenses = signal<ReadonlyMap<number, ComponentId>>(new Map());
    protected readonly buildingLocations = this.data.member.entity.entityType === 'BuildingEntity'
        ? this.data.member.nonMekRecordSheetSnapshot()?.locations.map(row => row.code) ?? [] : [];
    protected readonly buildingLocation = signal(this.buildingLocations.length === 1 ? this.buildingLocations[0] : '');
    private readonly reportedWeapons = computed(() => this.data.event.weapons.map((weapon, index) => {
        const resolved = this.defenses().has(index) ? interceptedReport(weapon) : weapon;
        return this.buildingLocation() ? { ...resolved, groups: resolved.groups.map(group => ({ ...group, buildingLocation: this.buildingLocation() })) } : resolved;
    }));
    protected defenseChoices(index: number) {
        if (!this.data.event.weapons[index].ams) return [];
        const { member, event } = this.data;
        const unit = member.force.getUnitSnapshot(member.id);
        if (!unit) return [];
        const reservedAmmo = new Map<ComponentId, number>();
        const assigned = new Map<ComponentId, number>();
        const available = () => missileDefenseSystems(unit.entity, unit.index, unit.state, unit.query, unit.ruleset, event.arc, reservedAmmo);
        for (const [weapon, id] of this.defenses()) {
            if (weapon === index) continue;
            const system = available().find(candidate => candidate.id === id);
            if (!system) continue;
            assigned.set(id, (assigned.get(id) ?? 0) + 1);
            if (system.bin) reservedAmmo.set(system.bin, (reservedAmmo.get(system.bin) ?? 0) + 1);
        }
        return available().filter(system => (assigned.get(system.id) ?? 0) < system.remaining);
    }
    protected assignDefense(index: number, id: string): void {
        const assigned = new Map(this.defenses());
        const system = this.defenseChoices(index).find(option => option.id === id);
        if (system) assigned.set(index, system.id);
        else assigned.delete(index);
        this.defenses.set(assigned);
    }

    /** With critical automation off, critical and motive effects are rolled on the sheet. */
    protected readonly manualCriticals = inject(OptionsService).cbtAutomationMode('criticalHitChanceCheck') === 'no';

    protected readonly weapons = computed<readonly AttackReportWeapon[]>(() => {
        // Hits are previewed in the order this unit takes them; inferno missiles and swarm strikes deal none here.
        const ruleset = this.data.member.force.getUnitSnapshot(this.data.member.id)?.ruleset;
        const deal = ruleset ? attackDamagePreview(this.data.member, ruleset) : null;
        return this.reportedWeapons().map((weapon, index) => {
            const source = attackDamageSource(weapon);
            const preview = deal && !weapon.inferno && !weapon.swarmStrike
                ? (location: AttackHitLocation | null, damage: number) => deal(location, damage, source) : undefined;
            return {
                name: weapon.name,
                targetNumber: weapon.targetNumber,
                // Infantry shaken off, or struck by a hit on the unit it swarms, takes its damage without a to-hit roll.
                ...(physicalAttackAlwaysHits(weapon.physical)
                    || ((weapon.swarmRelease || weapon.swarmStrike) && weapon.physical === undefined)
                    ? { automaticHit: true as const } : {}),
                toHit: weapon.toHit,
                hit: toHitSucceeds(weapon.toHit, weapon.targetNumber),
                cluster: weapon.cluster ?? null,
                inferno: weapon.inferno === true,
                narcPod: weapon.narcPod,
                collateral: buildingCollateral(weapon, weapon.groups.reduce((sum, group) => sum + group.damage, 0)),
                amsDie: this.defenses().has(index) ? weapon.ams?.die : undefined,
                ...(weapon.aim ? { aim: attackReportAim(weapon.aim) } : {}),
                groups: weapon.groups.map(group => attackReportGroup(this.data.member, this.data.event.arc, weapon, group, preview)),
            };
        });
    });
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
    protected readonly narc = computed(() => this.reportedWeapons().some(weapon => weapon.narcPod && weapon.groups.some(group => {
        const hit = weaponHitLocation(this.data.member, this.data.event.arc, weapon, group);
        return hit && hit.kind !== 'miss';
    })));
    protected readonly totalDamage = computed(() => this.summary().reduce((sum, row) => sum + row.damage, 0));
    /** Infantry took hold of this unit with the attack, or let go of it; this infantry came off the unit it swarmed. */
    protected readonly swarm = computed(() => {
        if (attackReleasesSwarm(this.data.event.weapons)) return 'Shaken off';
        const swarmed = attackSwarms(this.data.event.weapons);
        return swarmed === null ? null : swarmed ? 'Swarmed' : 'Swarm ended';
    });
    /** Outside heat the attack's heat-causing weapons apply. */
    private readonly thermal = computed(() => readAttackThermalEffects(this.data.member, this.data.event.arc, this.reportedWeapons()));
    protected readonly heat = computed(() => this.thermal().heat);
    /** What the attack's inferno missiles do to this unit; null without inferno hits. */
    protected readonly inferno = computed(() => {
        const missiles = this.thermal().inferno;
        const earlier = infernoMissilesThisTurn(this.data.member.force.getUnitSnapshot(this.data.member.id));
        return missiles.length === 0 ? null : infernoEffectText(infernoEffect(this.data.member.entity, missiles, earlier));
    });
    /** Infantry and battle armor allocate damage by trooper: the player applies it on the sheet. */
    protected readonly applicable = computed(() =>
        this.weapons().every(weapon => weapon.inferno || weapon.groups.every(group => group.label !== null)));

    protected accept(): void {
        const defenses = [...this.defenses()].map(([weapon, componentId]) => ({ weapon, componentId }));
        const buildingLocation = this.buildingLocation();
        this.dialogRef.close(defenses.length || buildingLocation ? { defenses, ...(buildingLocation ? { buildingLocation } : {}) } : true);
    }

    protected ignore(): void {
        this.dialogRef.close(false);
    }
}
