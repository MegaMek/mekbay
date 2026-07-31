import type { BaseEntity } from '../base-entity';

export function getFireControlWeaponWeight(entity: BaseEntity): number | undefined {
    let weight = 0;

    for (const mount of entity.equipment()) {
        const equipment = mount.equipment;
        if (equipment?.type !== 'weapon') continue;
        if (equipment.hasFlag('F_AMS')) continue;
        if (equipment.hasFlag('F_INFANTRY') && !equipment.hasFlag('F_INF_SUPPORT')) continue;

        const tonnage = mount.getTonnage(entity);
        if (tonnage === undefined) return undefined;
        weight += tonnage;
    }

    return weight;
}

export function getFireControlWeaponCost(entity: BaseEntity): number | undefined {
    let cost = 0;

    for (const mount of entity.equipment()) {
        if (mount.equipment?.type !== 'weapon') continue;

        const weaponCost = mount.getCost(entity);
        if (weaponCost === undefined) return undefined;
        cost += weaponCost;
    }

    return cost;
}