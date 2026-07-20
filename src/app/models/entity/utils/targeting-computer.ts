import type { BaseEntity } from '../base-entity';

export function getTargetingComputerRelevantWeight(entity: BaseEntity): number | undefined {
    let weight = 0;

    for (const mount of entity.equipment()) {
        const equipment = mount.equipment;
        if (!equipment) continue;

        const relevantWeapon = equipment.type === 'weapon'
            && equipment.hasFlag('F_DIRECT_FIRE')
            && !equipment.hasFlag('F_TASER');
        if (!relevantWeapon && !equipment.hasFlag('F_RISC_LASER_PULSE_MODULE')) continue;

        const tonnage = mount.getTonnage(entity);
        if (tonnage === undefined) return undefined;
        weight += tonnage;
    }

    return weight;
}