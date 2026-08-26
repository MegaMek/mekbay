// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import { getActiveStealthTnModifiers, type StealthEquipmentFacts } from '../stealth-equipment.model';
import {
    canTnTargetTypeBeLarge,
    getTargetMovementBracketForDistance,
    resolveTnTargetWaterState,
    type TnTargetUnitType,
} from '../target-number-calculator.model';
import { isUnitBuildingLevel, isUnitWaterDepth } from '../unit-cover.model';
import { getForceOpforInventoryTargetId } from '../../utils/inventory-control-opfor-target.util';
import { asEncounterTargetId } from './encounter-runtime';
import type { ReadyNonMekUnit } from './ready-non-mek-unit';
import type { ReadyMekUnit } from './ready-unit-factory';
import { entityUnitLabel } from './cbt-unit-label';
import type { InventoryControlTargetRosterRow } from '../cbt-force-api';

export function mekTargetRosterRow(
    forceInstanceId: string,
    unit: ReadyMekUnit,
): InventoryControlTargetRosterRow {
    const entity = unit.getUnit();
    const query = unit.getInstance().query();
    const turn = query.turnState();
    const movement = query.mekMovementPsrState().movement;
    const immobile = query.hasCondition('immobile');
    const prone = query.hasCondition('prone');
    const form = entity.chassisConfig;
    const unitType: TnTargetUnitType = form === 'Quad' || form === 'QuadVee'
        ? 'mek-quad'
        : form === 'Tripod' ? 'mek-tripod' : 'mek-biped';
    const cover = turn.cover;
    const targetMovementDistance = movement?.distance ?? null;
    const largeTarget = entity.tonnage() > 100;
    const stealth = query.stealthTnModifiers(targetMovementDistance ?? 0, 'preview');
    const waterState = resolveTnTargetWaterState({
        unitType,
        ...(isUnitWaterDepth(cover) ? { waterDepth: cover } : {}),
        largeTarget,
        prone,
    });
    let narcAboveWater = false;
    let narcUnderwater = false;
    for (const location of unit.getIndex().locations.values()) {
        if (query.locationCondition(location.id, 'narc', 'committed') <= 0
            || query.remainingInternal(location.id, 'committed') <= 0) continue;
        const underwater = waterState.submerged
            || (waterState.partiallyUnderwater && entity.locationIsLeg(location.code));
        if (underwater) narcUnderwater = true;
        else narcAboveWater = true;
    }
    return Object.freeze({
        instanceId: unit.instanceId,
        targetId: asEncounterTargetId(getForceOpforInventoryTargetId(forceInstanceId, unit.instanceId)),
        name: entityUnitLabel(entity, unit.instanceId),
        unitType,
        tnCalculator: Object.freeze({
            isAirborne: movement?.mode === 'jump' || turn.airborne === true,
            targetMovementBracket: targetMovementDistance === null
                ? null
                : getTargetMovementBracketForDistance(targetMovementDistance)?.id ?? null,
            targetMovementDistance,
            skidding: query.hasCondition('skidding'),
            prone,
            immobile,
            targetHexCover: cover === 'light' || cover === 'heavy' ? cover : 'none',
            ...(isUnitWaterDepth(cover) ? { waterDepth: cover } : {}),
            ...(isUnitBuildingLevel(cover) ? { buildingCover: cover } : {}),
            targetHeight: largeTarget ? 3 : 2,
            largeTarget,
            narcAboveWater,
            narcUnderwater,
            tagged: query.hasCondition('tagged'),
            ecmShielded: query.hasCondition('ecm-shielded'),
            ...(stealth === undefined ? {} : { stealth }),
        }),
        projection: 'v2' as const,
    });
}

export function entityTargetRosterRow(
    forceInstanceId: string,
    unit: ReadyNonMekUnit,
): InventoryControlTargetRosterRow {
    const entity = unit.getUnit();
    const runtime = unit.getInstance();
    const turn = runtime.turnState();
    const targetMovementDistance = turn.movement?.distance ?? null;
    const unitType = nonMekTargetUnitType(entity);
    const stealthEquipment: StealthEquipmentFacts[] = [];
    for (const component of unit.getIndex().components.values()) {
        const equipment = component.mount.equipment;
        if (equipment === undefined) continue;
        stealthEquipment.push(Object.freeze({
            componentId: component.id,
            equipment,
            mode: runtime.componentMode(component.id),
            operational: runtime.componentStatus(component.id) === 'available',
        }));
    }
    const unavailable = runtime.destroyed() || runtime.hasCondition('shutdown');
    const stealth = getActiveStealthTnModifiers(
        stealthEquipment,
        targetMovementDistance ?? 0,
        unavailable,
    );
    const largeTarget = canTnTargetTypeBeLarge(unitType)
        && (entity.weightClass() === 'Super Heavy' || entity.weightClass() === 'Large Support');
    return Object.freeze({
        instanceId: unit.instanceId,
        targetId: asEncounterTargetId(getForceOpforInventoryTargetId(forceInstanceId, unit.instanceId)),
        name: entityUnitLabel(entity, unit.instanceId),
        unitType,
        tnCalculator: Object.freeze({
            isAirborne: turn.movement?.mode === 'jump' || turn.airborne === true,
            targetMovementBracket: targetMovementDistance === null
                ? null
                : getTargetMovementBracketForDistance(targetMovementDistance)?.id ?? null,
            targetMovementDistance,
            skidding: runtime.hasCondition('skidding'),
            prone: runtime.hasCondition('prone'),
            immobile: runtime.hasCondition('immobile')
                || runtime.hasCondition('immobilized')
                || entity.motiveType() === 'None',
            targetHexCover: 'none',
            targetHeight: 1,
            largeTarget,
            narcAboveWater: false,
            narcUnderwater: false,
            tagged: runtime.hasCondition('tagged'),
            ecmShielded: runtime.hasCondition('ecm-shielded'),
            ...(stealth === undefined ? {} : { stealth }),
        }),
        projection: 'v2',
    });
}

function nonMekTargetUnitType(entity: ReturnType<ReadyNonMekUnit['getUnit']>): TnTargetUnitType {
    switch (entity.unitType()) {
        case 'Mek':
            return entity.unitSubtype().includes('Quad') ? 'mek-quad'
                : entity.unitSubtype().includes('Tripod') ? 'mek-tripod' : 'mek-biped';
        case 'Infantry':
            return entity.entityType === 'BattleArmor' ? 'battle-armor' : 'infantry';
        case 'ProtoMek': return 'protoMek';
        case 'VTOL': return 'vtol-wige';
        case 'Aero': return 'aero';
        case 'Tank': return entity.motiveType() === 'WiGE' ? 'vtol-wige' : 'vehicle';
        default: return 'vehicle';
    }
}
