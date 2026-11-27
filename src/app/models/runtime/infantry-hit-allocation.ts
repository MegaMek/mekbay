// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import type { CBTRuleset } from '../cbt-ruleset.model';
import type { BaseEntity } from '../entity/base-entity';
import type { ArmorType } from '../entity/types';
import { resolveArmorDamage, attackDamageSource, type DamageSource } from '../rules/armor-damage-rules';
import type { CBTForceMember } from '../force-member.model';
import { isBattleArmorEntity, isInfantryEntity } from '../entity/utils/entity-type-guards';
import { toHitSucceeds } from '../rules/weapon-attack-resolution';
import { interiorInfantryDamage } from '../rules/infantry-building-damage';
import { infantryCasualties } from '../rules/infantry-hit-damage';
import type { AttackEvent, AttackHitGroup, AttackWeaponReport } from '../../services/game-events.service';

interface Suit { code: string; armor: number; internal: number; armorType: ArmorType | null }

/** Each ordinary group gets one live suit, with no overflow. AE hits each living suit (TW p. 219). */
export function allocateSuitGroups(groups: readonly AttackHitGroup[], suits: Suit[], area: boolean,
    d6: () => number, ruleset: CBTRuleset, source: DamageSource, entity?: BaseEntity): AttackHitGroup[] {
    return groups.flatMap(group => {
        const living = suits.filter(suit => suit.internal > 0);
        if (!living.length || !group.damage) return [];
        let recipients = living;
        if (!area) {
            let face = group.aux;
            let selected = living.find(suit => suit.code === `Trooper ${face}`);
            while (!selected) {
                face = d6();
                selected = living.find(suit => suit.code === `Trooper ${face}`);
            }
            recipients = [selected];
        }
        return recipients.map(suit => {
            const hit = resolveArmorDamage(ruleset, group.damage, suit.armor, suit.armorType, source, entity);
            suit.armor -= hit.armorDamage;
            suit.internal = Math.max(0, suit.internal - hit.remainingDamage);
            // Damage delivery applies armor to the original hit on this suit.
            return { ...group, trooperLocation: suit.code };
        });
    });
}

/** A manual target uses standard foot infantry unless the player has its actual defensive facts. */
export function reportedInfantryCasualties(weapon: AttackWeaponReport, mechanized: boolean, divisor: number, fallback: () => number): number {
    if (weapon.inferno || weapon.narcPod || weapon.swarmStrike || !toHitSucceeds(weapon.toHit, weapon.targetNumber)) return 0;
    let index = 0;
    const die = () => weapon.infantryDice?.[index++] ?? fallback();
    const burst = Array.from({ length: weapon.infantryBurstDice ?? 0 }, die).reduce((sum, value) => sum + value, 0);
    const infantryAttack = weapon.physical === 'vibro-claw' || weapon.physical === 'brush-off' || weapon.physical === 'thrash';
    return infantryCasualties(infantryAttack ? 'infantry' : weapon.infantryClass ?? 'ordinary',
        weapon.types, [...weapon.groups.map(group => group.damage), ...(burst ? [burst] : [])],
        mechanized, weapon.infantryInOpen === true, divisor, die, weapon.infantryBuilding);
}

/** Count actual losses across successive hits. With an unknown tabletop strength, report the rolled casualties. */
export function infantryCasualtyCounter(strength: number | undefined): (damage: number) => number {
    let remaining = strength;
    return damage => {
        if (remaining === undefined) return damage;
        const losses = Math.min(remaining, damage);
        remaining -= losses;
        return losses;
    };
}

/** Roll once on receipt so the dialog, accepted hits and pending damage use the same targets and casualties. */
export function allocateInfantryHits(member: CBTForceMember, event: AttackEvent, d6: () => number): AttackEvent {
    const entity = member.entity;
    if (!isBattleArmorEntity(entity) && !isInfantryEntity(entity)) return event;
    const sheet = member.nonMekRecordSheetSnapshot();
    if (!sheet) return event;
    const suits = sheet.locations.filter(row => row.code.startsWith('Trooper ') && row.previewRemainingInternal > 0)
        .map(row => ({ code: row.code, internal: row.previewRemainingInternal,
            armor: row.armor.reduce((sum, face) => sum + face.previewRemaining, 0), armorType: entity.armorAt(row.code).type }));
    const ruleset = member.force.getUnitSnapshot(member.id)?.ruleset ?? 'total-warfare';
    const countCasualties = infantryCasualtyCounter(sheet.locations.find(row => row.code === 'Infantry')?.previewRemainingInternal ?? 0);
    return { ...event, weapons: event.weapons.map(weapon => {
        if (weapon.inferno || weapon.narcPod || weapon.swarmStrike || !toHitSucceeds(weapon.toHit, weapon.targetNumber)) return weapon;
        if (isBattleArmorEntity(entity)) {
            const groups = weapon.infantryBuilding ? weapon.groups.map(group => ({ ...group,
                damage: interiorInfantryDamage(group.damage, weapon.infantryBuilding) })) : weapon.groups;
            return { ...weapon, groups: allocateSuitGroups(groups, suits, weapon.types.includes('AE'), d6, ruleset, attackDamageSource(weapon), entity) };
        }
        if (!weapon.infantryBurstDice && !weapon.groups.length) return weapon;
        const damage = reportedInfantryCasualties(weapon, entity.isMechanized(), entity.armorDivisor(), d6);
        const casualties = countCasualties(damage);
        return { ...weapon, groups: [{ ...(weapon.groups[0] ?? { location: weapon.toHit, aux: 1 }), trooperLocation: 'Infantry', damage: casualties }] };
    }) };
}
