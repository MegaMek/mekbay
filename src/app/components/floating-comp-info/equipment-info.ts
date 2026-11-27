// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import { AmmoEquipment, type Equipment, WeaponEquipment } from '../../models/equipment.model';
import { type EntityTechBase, type TechDate, type TechAdvancementDates, techDateYear, formatTechDate } from '../../models/entity/types/tech';
import type { CBTGameRules } from '../../models/rules/game-rules';

export interface EquipmentInfoGroup {
    group: string;
    items: Array<{ label: string; value: string | number }>;
}

export function equipmentTypeLabel(typeClass: string, equipment?: Equipment | null): string {
    if (typeClass.split(' ').includes('ammo')) {
        if (!(equipment instanceof AmmoEquipment)) return 'Ammo';
        const labels = [equipment.category, ...(equipment.isExplosive() ? ['Explosive'] : [])];
        return `Ammo (${labels.join(', ')})`;
    }
    return typeClass.charAt(0).toUpperCase() + typeClass.slice(1);
}

export function equipmentToHitModifier(equipment: Equipment | null | undefined, rules: CBTGameRules): string | null {
    if (!equipment) return null;
    const modifiers = rules.resolveToHit({ subject: equipment }).profile;
    return modifiers.every(value => value === 0) ? null
        : modifiers.map(value => value > 0 ? `+${value}` : String(value)).join('/');
}

export function equipmentHeat(equipment: Equipment | null): string | null {
    if (!(equipment instanceof WeaponEquipment)) return null;
    if (equipment.heat === 0) return '—';
    const value = Number.isInteger(equipment.heat)
        ? equipment.heat.toString() : equipment.heat.toFixed(1).replace(/\.0$/, '');
    return `${value}${equipment.getRapidFireCount() > 0 ? '/s' : ''}`;
}

/** Shared technology and history presentation for catalog and construction inspectors. */
export function equipmentTechnologyGroups(eq: Equipment, techBase: EntityTechBase, mixed: boolean): EquipmentInfoGroup[] {
    const earliest = (a: TechDate, b: TechDate): TechDate => {
        const aY = techDateYear(a), bY = techDateYear(b);
        if (aY == null) return b;
        if (bY == null) return a;
        return aY <= bY ? a : b;
    };
    const latest = (a: TechDate, b: TechDate): TechDate => {
        const aY = techDateYear(a), bY = techDateYear(b);
        if (aY == null) return b;
        if (bY == null) return a;
        return aY >= bY ? a : b;
    };

    let dates: TechAdvancementDates;
    if (mixed) {
        const is = eq.tech.advancement?.is, clan = eq.tech.advancement?.clan;
        let extinct: TechDate;
        let reintroduced: TechDate;
        // Mixed technology remains available unless both bases have an extinction gap.
        if (is?.extinct && clan?.extinct) {
            extinct = latest(is.extinct, clan.extinct);
            reintroduced = earliest(is.reintroduced, clan.reintroduced);
            const extY = techDateYear(extinct), reintY = techDateYear(reintroduced);
            if (extY != null && reintY != null && extY >= reintY) {
                extinct = undefined;
                reintroduced = undefined;
            }
        }
        dates = {
            prototype: earliest(is?.prototype, clan?.prototype),
            production: earliest(is?.production, clan?.production),
            common: earliest(is?.common, clan?.common),
            extinct,
            reintroduced,
        };
    } else {
        dates = (techBase === 'Clan' ? eq.tech.advancement?.clan : eq.tech.advancement?.is) ?? {};
    }

    const historyItems = [
        { label: 'Prototype', value: formatTechDate(dates.prototype) },
        { label: 'Production', value: formatTechDate(dates.production) },
        { label: 'Common', value: formatTechDate(dates.common) },
        { label: 'Extinction', value: formatTechDate(dates.extinct) },
        { label: 'Reintroduction', value: formatTechDate(dates.reintroduced) },
    ].filter((item): item is { label: string; value: string } => !!item.value)
        .sort((a, b) => {
            const aYear = parseInt(a.value.replace(/^~/, ''), 10);
            const bYear = parseInt(b.value.replace(/^~/, ''), 10);
            if (isNaN(aYear)) return 1;
            if (isNaN(bYear)) return -1;
            return aYear - bYear;
        });

    const groups: EquipmentInfoGroup[] = [{
        group: 'Technology',
        items: [
            { label: 'Level', value: eq.level },
            { label: 'Rating', value: `${eq.techBase} | ${eq.rating}/${eq.availability}` },
        ],
    }];
    if (historyItems.length) groups.push({ group: 'History', items: historyItems });
    return groups;
}
