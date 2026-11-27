// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import { inject, Injectable } from '@angular/core';

import { isMagnetClawEquipment } from '../models/battle-armor-equipment.model';
import { isBattleArmorEntity } from '../models/entity/utils/entity-type-guards';
import { nonMekFliesAtElevation } from '../models/runtime/non-mek-airborne-state';
import type { CBTForceMember } from '../models/force-member.model';
import {
    MAGNETIC_CLAW_SHAKE_OFF_MODIFIER,
    swarmShakeOffDamage,
    type SwarmShakeOffCause,
    type SwarmShakeOffDamage,
} from '../models/rules/anti-mek-attack-rules';
import { roll2D6, rollD6 } from '../models/runtime/mek-automation-rules';
import { uuidv4 } from '../utils/uuid.util';
import type { AttackEvent, AttackHitGroup, AttackWeaponReport } from './game-events.service';
import { GameEventsService } from './game-events.service';
import { InventoryControlOpforService } from './inventory-control-opfor.service';
import { ToastService } from './toast.service';
import { UnitNameService } from './unit-name.service';

const CAUSE_LABELS: Readonly<Record<SwarmShakeOffCause['kind'], string>> = Object.freeze({
    jump: 'jump',
    fall: 'fall',
    erratic: 'erratic manoeuvres',
    'deep-water': 'deep water',
});

/**
 * Swarming infantry and the unit it swarms, across the forces open here (TW pp. 220-222). The infantry's own swarm
 * names the unit it clings to, and is the one record of who swarms whom; the swarmed unit only knows it is swarmed.
 */
@Injectable({ providedIn: 'root' })
export class SwarmService {
    private readonly opfor = inject(InventoryControlOpforService);
    private readonly gameEvents = inject(GameEventsService);
    private readonly unitNames = inject(UnitNameService);
    private readonly toast = inject(ToastService);

    /** The infantry swarming the unit, when its force is open here. */
    swarmer(member: CBTForceMember): CBTForceMember | null {
        return this.opfor.swarmerOf(member)?.member ?? null;
    }

    /** The name of the infantry swarming the unit, when its force is open here. */
    swarmerName(member: CBTForceMember): string | null {
        const swarmer = this.swarmer(member);
        return swarmer === null ? null : this.unitNames.name(swarmer.entity);
    }

    /**
     * The points each battle armor trooper swarming the unit still has, by trooper number, for the hits that strike it
     * (`splitSwarmedHits`); null for a platoon, or for infantry whose force is not open here.
     */
    swarmerTroopers(member: CBTForceMember): ReadonlyMap<number, number> | null {
        const swarmer = this.swarmer(member);
        if (!swarmer || !isBattleArmorEntity(swarmer.entity)) return null;
        return new Map((swarmer.nonMekRecordSheetSnapshot()?.locations ?? []).flatMap(location => {
            const trooper = /^Trooper (\d+)$/.exec(location.code);
            return trooper ? [[Number(trooper[1]), location.previewRemainingInternal
                + location.armor.reduce((sum, face) => sum + face.previewRemaining, 0)] as const] : [];
        }));
    }

    /**
     * Sends the infantry swarming `member` the hits of `attack` that struck it instead (TW p. 222), each an automatic
     * hit on its trooper or, for a platoon, marked off as from infantry. Without the infantry's force open here, the
     * player is told what to apply on its sheet.
     */
    strikeSwarmer(
        member: CBTForceMember,
        attack: AttackEvent,
        strikes: readonly Readonly<{ weapon: AttackWeaponReport; damage: number; trooper?: number }>[],
    ): void {
        if (strikes.length === 0) return;
        const swarmer = this.opfor.swarmerOf(member);
        const fromForce = member.force.instanceId();
        const total = strikes.reduce((sum, strike) => sum + strike.damage, 0);
        if (swarmer === null || !fromForce) {
            this.toast.showToast(`${strikes.length} ${strikes.length === 1 ? 'hit' : 'hits'} (${total} damage) struck `
                + 'the swarming infantry. Apply it on the infantry\'s sheet.', 'info');
            return;
        }
        const weapons = strikes.map(({ weapon, damage, trooper }) => Object.freeze({
            name: `${weapon.name} (struck while swarming)`,
            types: weapon.types,
            targetNumber: weapon.targetNumber,
            toHit: weapon.toHit,
            swarmStrike: Object.freeze(trooper === undefined ? {} : { trooper }),
            groups: Object.freeze([Object.freeze({ damage, location: roll2D6(), aux: rollD6() })]),
        } satisfies AttackWeaponReport));
        const name = this.unitNames.name(swarmer.member.entity);
        void this.gameEvents.send(swarmer.forceId, Object.freeze({
            kind: 'attack',
            id: uuidv4(),
            fromForce,
            fromUnit: member.id,
            attacker: attack.attacker,
            toUnit: swarmer.member.id,
            turn: attack.turn,
            arc: 'front',
            weapons: Object.freeze(weapons),
        })).then(sent => this.toast.showToast(sent
            ? `${strikes.length} ${strikes.length === 1 ? 'hit' : 'hits'} (${total} damage) struck ${name}`
            : `Hits struck ${name}, but its owner could not be told`, sent ? 'info' : 'error'));
    }

    /** What the infantry swarming the unit adds to a roll to remove it: magnetic claws make it 1 harder (TW p. 222). */
    removalModifier(member: CBTForceMember): number {
        return this.swarmer(member)?.entity.equipment().some(mount => isMagnetClawEquipment(mount.equipment))
            ? MAGNETIC_CLAW_SHAKE_OFF_MODIFIER : 0;
    }

    /**
     * Sends the infantry swarming `member` what it takes coming off (`swarmShakeOffDamage`); its owner accepting it
     * releases the infantry. False when the infantry holds on (UMU MP in deep water). The swarmed unit's own SWARMED
     * condition is its caller's to clear. Without the infantry's force open here, the player is told what to apply on
     * its sheet.
     */
    shakeOff(member: CBTForceMember, cause: SwarmShakeOffCause): boolean {
        const swarmer = this.opfor.swarmerOf(member);
        const fromForce = member.force.instanceId();
        if (swarmer === null || !fromForce) {
            this.toast.showToast(`Swarming infantry shaken off (${CAUSE_LABELS[cause.kind]}): `
                + `${unknownSwarmerText(cause)}. Apply it on the infantry's sheet.`, 'info');
            return true;
        }
        const infantry = swarmer.member.entity;
        const damage = swarmShakeOffDamage(cause, {
            battleArmor: isBattleArmorEntity(infantry),
            umu: infantry.umuMP() > 0,
            flies: infantry.jumpMP() > 0 || nonMekFliesAtElevation(infantry),
        });
        if (damage === null) return false;
        void this.send(member, fromForce, swarmer, shakeOffReport(cause, damage, activeTroopers(swarmer.member)));
        return true;
    }

    private async send(
        member: CBTForceMember,
        fromForce: string,
        swarmer: NonNullable<ReturnType<InventoryControlOpforService['swarmerOf']>>,
        report: AttackWeaponReport,
    ): Promise<void> {
        const name = this.unitNames.name(swarmer.member.entity);
        const sent = await this.gameEvents.send(swarmer.forceId, Object.freeze({
            kind: 'attack',
            id: uuidv4(),
            fromForce,
            fromUnit: member.id,
            attacker: this.unitNames.name(member.entity),
            toUnit: swarmer.member.id,
            turn: member.force.getUnitSnapshot(member.id)?.state.turn.turnCounter ?? 0,
            arc: 'front',
            weapons: Object.freeze([report]),
        }));
        this.toast.showToast(sent
            ? `${name} ${report.name.charAt(0).toLowerCase()}${report.name.slice(1)}`
            : `${name} shaken off, but its owner could not be told: ${report.name}`, sent ? 'info' : 'error');
    }
}

/** The battle armor troopers still fighting, or a conventional platoon's strength. */
function activeTroopers(member: CBTForceMember): number {
    const locations = member.nonMekRecordSheetSnapshot()?.locations ?? [];
    return isBattleArmorEntity(member.entity)
        ? locations.filter(location => location.code.startsWith('Trooper ') && location.previewRemainingInternal > 0).length
        : locations.find(location => location.code === 'Infantry')?.previewRemainingInternal ?? 0;
}

/** What infantry not open here takes: battle armor and a platoon may differ, and only its owner knows its UMU MP. */
function unknownSwarmerText(cause: SwarmShakeOffCause): string {
    const battleArmor = swarmShakeOffDamage(cause, { battleArmor: true, umu: false });
    const platoon = swarmShakeOffDamage(cause, { battleArmor: false, umu: false });
    if (battleArmor === null || platoon === null) return 'no damage';
    const text = shakeOffText(battleArmor) === shakeOffText(platoon) ? shakeOffText(battleArmor)
        : `battle armor ${shakeOffText(battleArmor)}, a platoon ${shakeOffText(platoon)}`;
    return battleArmor.kind === 'destroyed' ? `${text} unless it has UMU MP` : text;
}

function shakeOffText(damage: SwarmShakeOffDamage): string {
    switch (damage.kind) {
        case 'destroyed': return 'destroyed in the water';
        case 'none': return 'no damage';
        case 'per-trooper': return `${damage.damage} damage to each trooper`;
        case 'dice': return `one ${damage.dice}D6 hit`;
    }
}

/**
 * The shake-off as the infantry's owner receives it: an automatic hit that releases the swarm, its damage one group
 * per trooper or one rolled hit. The location dice are rolled for the report's shape; infantry take damage by
 * trooper on their sheet.
 */
function shakeOffReport(cause: SwarmShakeOffCause, damage: SwarmShakeOffDamage, troopers: number): AttackWeaponReport {
    const group = (points: number): AttackHitGroup => Object.freeze({ damage: points, location: roll2D6(), aux: rollD6() });
    const rolled = damage.kind === 'dice' ? Array.from({ length: damage.dice }, rollD6) : [];
    const total = rolled.reduce((sum, die) => sum + die, 0);
    const label = `Shaken off (${CAUSE_LABELS[cause.kind]})`;
    return Object.freeze({
        name: damage.kind === 'dice' ? `${label}: ${damage.dice}D6 = ${total}`
            : damage.kind === 'per-trooper' ? `${label}: ${damage.damage} to each trooper`
                : `${label}: ${shakeOffText(damage)}`,
        types: Object.freeze([]),
        targetNumber: 0,
        toHit: roll2D6(),
        swarmRelease: true,
        groups: Object.freeze(damage.kind === 'dice' ? [group(total)]
            : damage.kind === 'per-trooper' ? Array.from({ length: troopers }, () => group(damage.damage))
                : []),
    });
}
