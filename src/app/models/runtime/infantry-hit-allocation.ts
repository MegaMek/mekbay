// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import type { CBTForceMember } from '../force-member.model';
import { isBattleArmorEntity, isInfantryEntity } from '../entity/utils/entity-type-guards';
import { toHitSucceeds } from '../rules/weapon-attack-resolution';
import { interiorInfantryDamage } from '../rules/infantry-building-damage';
import { infantryCasualties } from '../rules/infantry-hit-damage';
import type { AttackEvent, AttackHitGroup } from '../../services/game-events.service';

interface Suit { code: string; remaining: number }

/** Each ordinary group gets one live suit, with no overflow. AE hits each living suit (TW p. 219). */
export function allocateSuitGroups(groups: readonly AttackHitGroup[], suits: Suit[], area: boolean,
    d6: () => number): AttackHitGroup[] {
    return groups.flatMap(group => {
        const living = suits.filter(suit => suit.remaining > 0);
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
            const damage = Math.min(suit.remaining, group.damage);
            suit.remaining -= damage;
            return { ...group, damage, trooperLocation: suit.code };
        });
    });
}

/** Roll once on receipt so the dialog, accepted hits and pending damage use the same targets and casualties. */
export function allocateInfantryHits(member: CBTForceMember, event: AttackEvent, d6: () => number): AttackEvent {
    const entity = member.entity;
    if (!isBattleArmorEntity(entity) && !isInfantryEntity(entity)) return event;
    const sheet = member.nonMekRecordSheetSnapshot();
    if (!sheet) return event;
    const suits = sheet.locations.filter(row => row.code.startsWith('Trooper ') && row.previewRemainingInternal > 0)
        .map(row => ({ code: row.code, remaining: row.previewRemainingInternal + row.armor.reduce((sum, f) => sum + f.previewRemaining, 0) }));
    let remaining = sheet.locations.find(row => row.code === 'Infantry')?.previewRemainingInternal ?? 0;
    return { ...event, weapons: event.weapons.map(weapon => {
        if (weapon.inferno || weapon.narcPod || weapon.swarmStrike || !toHitSucceeds(weapon.toHit, weapon.targetNumber)) return weapon;
        if (isBattleArmorEntity(entity)) {
            const groups = weapon.infantryBuilding ? weapon.groups.map(group => ({ ...group,
                damage: interiorInfantryDamage(group.damage, weapon.infantryBuilding) })) : weapon.groups;
            return { ...weapon, groups: allocateSuitGroups(groups, suits, weapon.types.includes('AE'), d6) };
        }
        const infantryAttack = weapon.physical === 'vibro-claw' || weapon.physical === 'brush-off' || weapon.physical === 'thrash';
        const burst = Array.from({ length: weapon.infantryBurstDice ?? 0 }, () => d6()).reduce((sum, die) => sum + die, 0);
        if (!burst && !weapon.groups.length) return weapon;
        const damage = infantryCasualties(infantryAttack ? 'infantry' : weapon.infantryClass ?? 'ordinary',
            weapon.types, [...weapon.groups.map(group => group.damage), ...(burst ? [burst] : [])], entity.isMechanized(), weapon.infantryInOpen === true,
            entity.armorDivisor(), d6, weapon.infantryBuilding);
        const casualties = Math.min(remaining, damage);
        remaining -= casualties;
        return { ...weapon, groups: [{ ...(weapon.groups[0] ?? { location: weapon.toHit, aux: 1 }), trooperLocation: 'Infantry', damage: casualties }] };
    }) };
}
