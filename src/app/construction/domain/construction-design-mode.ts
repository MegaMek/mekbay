// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
import { untracked } from '@angular/core';
import type { BaseEntity } from '../../models/entity/base-entity';
import { MekEntity, MekWithArmsEntity } from '../../models/entity/entities/mek/mek-entity';
import { VehicleEntity } from '../../models/entity/entities/vehicle/vehicle-entity';
import { parseEntity } from '../../models/entity/parse-entity';
import { encodeNativeEntity } from '../../models/entity/write-entity';
import { getConstructionFields } from './construction-fields';
import { AmmoEquipment, ArmorEquipment, MiscEquipment } from '../../models/equipment.model';
import { getMekHeatSinkType } from '../../models/entity/types/heat-sink';
import { calculateVehicleWeightBreakdown } from '../../models/entity/utils/weight/vehicle-weight';
import { calculateSupportVehicleWeightBreakdown } from '../../models/entity/utils/weight/support-vehicle-weight';
import { constructionFamilyMessages } from './construction-family-rules';
import { constructionEquipmentConflictMessages } from './construction-equipment-conflicts';
import { constructionOmniApplies } from './construction-system-rules';

/** TechManual: Omni base chassis, armor and fixed equipment survive every configuration. */
export function supportsConstructionReconfiguration(entity: BaseEntity): boolean {
    return entity.omni() && constructionOmniApplies(entity);
}

/** Biped Omni lower-arm and hand actuators are always pod mounted (TechManual, p. 79). */
export function constructionPodField(entity: BaseEntity, id: string): boolean {
    return entity instanceof MekWithArmsEntity && ['leftLowerArm', 'rightLowerArm', 'leftHand', 'rightHand'].includes(id);
}

/** Old native vehicle files may leave turret mass automatic; freeze the loaded capacity for refits. */
export function establishConstructionOmniBase(entity: BaseEntity): void {
    if (!(entity instanceof VehicleEntity) || !entity.omni()) return;
    const weights = entity.isSupportVehicle() ? calculateSupportVehicleWeightBreakdown(entity) : calculateVehicleWeightBreakdown(entity);
    if (entity.hasTurret() && entity.baseChassisTurretWeight() < 0) entity.baseChassisTurretWeight.set(weights.turret);
    if (entity.hasDualTurret() && entity.baseChassisTurret2Weight() < 0) entity.baseChassisTurret2Weight.set(weights.dualTurret);
}

export function constructionReconfigurationIssues(entity: BaseEntity): readonly string[] {
    if (entity instanceof MekEntity) {
        const issues = [...constructionFamilyMessages(entity), ...constructionEquipmentConflictMessages(entity)]
            .filter(message => ['MEK_JUMP_RUN_LIMIT', 'MEK_JUMP_WALK_LIMIT', 'MEK_UMU_JUMP_CONFLICT'].includes(message.code)).map(message => message.message);
        if (entity.equipment().some(mount => mount.omniPodMounted && mount.equipment instanceof MiscEquipment
            && mount.equipment.isHeatSink && getMekHeatSinkType(mount.equipment) !== entity.heatSinkType())) {
            issues.push('Pod heat sinks must use the fixed chassis heat-sink type.');
        }
        return issues;
    }
    if (!(entity instanceof VehicleEntity)) return [];
    const issues = constructionFamilyMessages(entity).filter(message => message.code === 'VEHICLE_OMNI_TURRET_CAPACITY').map(message => message.message);
    for (const [locations, weight] of [[['Turret', 'Front Turret'], entity.baseChassisTurretWeight()], [['Rear Turret'], entity.baseChassisTurret2Weight()]] as const) {
        if (weight < 0) continue;
        for (const mount of entity.equipment()) {
            if (!locations.some(location => location === mount.location) || mount.equipment instanceof AmmoEquipment
                || (locations[0] !== 'Rear Turret' && mount.equipment instanceof ArmorEquipment)) continue;
            const tons = mount.getTonnage(entity);
            if (tons === undefined) issues.push(`Cannot determine turret mass for ${mount.displayName(true)}.`);
        }
    }
    return issues;
}

/** Normalize only the permitted pod changes; the native codec remains the design source of truth. */
export function constructionOmniBaseSource(entity: BaseEntity): string {
    const format = entity instanceof MekEntity ? 'mtf' : 'blk';
    const source = encodeNativeEntity(entity);
    return untracked(() => {
        const base = parseEntity(source, `omni-base.${format}`, entity.getEquipmentRegistry()).entity;
        base.setEquipment(base.equipment().filter(mount => !mount.omniPodMounted || mount.equipment?.omniFixedOnly)
            .sort((a, b) => a.location.localeCompare(b.location) || a.equipmentId.localeCompare(b.equipmentId)
                || a.displayName(true).localeCompare(b.displayName(true)) || Number(a.armored) - Number(b.armored)
                || (a.size ?? 0) - (b.size ?? 0) || (a.facing ?? 0) - (b.facing ?? 0)));
        for (const field of getConstructionFields(base)) if (constructionPodField(base, field.id)) field.set(false);
        // Fixed equipment can shift slots inside its established location, but cannot move body locations.
        if (base instanceof MekEntity) {
            const order = base.equipment().map(mount => mount.mountId);
            for (const location of base.validLocations) base.arrangeEquipment(location, order);
        }
        return encodeNativeEntity(base);
    });
}
