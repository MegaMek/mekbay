import type { BaseEntity } from '../base-entity';
import { isSupportVehicle, type SupportVehicle } from '../entities/support-vehicle';
import { FixedWingSupportEntity } from '../entities/aero/fixed-wing-support-entity';
import { SupportVtolEntity } from '../entities/vehicle/support-vtol-entity';
import type { TechRating } from '../types';

const TECH_RATINGS: readonly TechRating[] = ['A', 'B', 'C', 'D', 'E', 'F'];

export function getEquipmentEngineWeight(entity: BaseEntity): number {
    if (isSupportVehicle(entity)) {
        return getSupportVehicleEngineWeight(entity);
    }

    const usesTankEngine = entity.entityType === 'Tank'
        || entity.entityType === 'Naval'
        || entity.entityType === 'VTOL';
    let weight = entity.mountedEngine().getWeight({ tank: usesTankEngine });
    if (entity.motiveType() === 'Hover' && usesTankEngine) {
        weight = Math.max(weight, Math.ceil(entity.tonnage() * 0.4) / 2);
    }
    return weight;
}

function getSupportVehicleEngineWeight(
    entity: BaseEntity & SupportVehicle,
): number {
    let movementPoints = entity.originalWalkMP();
    if (entity.motiveType() === 'Rail' || entity.motiveType() === 'MagLev') {
        movementPoints = Math.max(0, movementPoints - 2);
    }

    const engine = entity.mountedEngine();
    const rating = TECH_RATINGS[entity.engineTechRating()] ?? 'A';
    const multiplier = engine.descriptor().svWeightMultipliers[rating];
    let weight = getBaseEngineValue(entity) * (4 + (movementPoints * movementPoints))
        * multiplier * entity.tonnage();

    if (engine.type() === 'Fusion' && entity.engineTechRating() >= 3) {
        weight = Math.max(weight, 0.25);
    } else if (engine.type() === 'Fusion' || engine.type() === 'Fission') {
        weight = Math.max(weight, 5);
    }
    if (entity.motiveType() === 'Hover') {
        weight = Math.max(weight, entity.tonnage() * 0.2);
    }

    return entity.weightClass() === 'Small Support'
        ? Math.round(weight * 1000) / 1000
        : Math.round(weight * 2) / 2;
}

function getBaseEngineValue(
    entity: BaseEntity & SupportVehicle,
): number {
    const tonnage = entity.tonnage();
    if (entity instanceof SupportVtolEntity) {
        if (tonnage < 5) return 0.002;
        return entity.weightClass() === 'Large Support' ? 0.004 : 0.0025;
    }
    if (entity instanceof FixedWingSupportEntity) {
        if (tonnage < 5) return 0.005;
        return tonnage <= 100 ? 0.01 : 0.015;
    }

    const isLarge = entity.weightClass() === 'Large Support';
    switch (entity.motiveType()) {
        case 'Airship': return tonnage < 5 ? 0.005 : 0.008;
        case 'Hover': return tonnage < 5 ? 0.0025 : isLarge ? 0.008 : 0.004;
        case 'Naval':
        case 'Hydrofoil':
        case 'Submarine': return tonnage < 5 ? 0.004 : 0.007;
        case 'Tracked': return tonnage < 5 ? 0.006 : isLarge ? 0.025 : 0.013;
        case 'Wheeled': return tonnage < 5 ? 0.0025 : isLarge ? 0.015 : 0.0075;
        case 'WiGE': return tonnage < 5 ? 0.003 : isLarge ? 0.006 : 0.005;
        case 'Rail':
        case 'MagLev': return tonnage < 5 ? 0.003 : isLarge ? 0.005 : 0.004;
        default: return 0;
    }
}