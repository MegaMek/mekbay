// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import type { BaseEntity } from '../../models/entity/base-entity';
import { MekEntity } from '../../models/entity/entities/mek/mek-entity';
import type { EntityMountedEquipment, EntityValidationMessage, MekSystemType } from '../../models/entity/types';
import { AmmoEquipment } from '../../models/equipment.model';
import { constructionSystemComponents, constructionSystemSlotKeys } from './construction-system-rules';

/** TO: AU&E p. 95; IO: Alternate Eras, Interface Cockpits and Superheavy Meks. */
export function constructionComponentArmorIssue(
    entity: BaseEntity,
    component: EntityMountedEquipment | MekSystemType,
): EntityValidationMessage | null {
    const issue = (code: string, message: string, location?: string): EntityValidationMessage =>
        ({ severity: 'error', category: 'equipment', code, message, location });
    if (!(entity instanceof MekEntity)) return issue('ARMORED_COMPONENT_CHASSIS', 'Component armor requires a BattleMek or IndustrialMek.');
    if (entity.isSuperHeavy()) return issue('SUPERHEAVY_ARMORED_COMPONENT', 'Superheavy Meks cannot have armored components.');
    if (typeof component === 'string') {
        return component === 'Cockpit' && entity.cockpitType() === 'Interface'
            ? issue('MEK_INTERFACE_ARMOR', 'Interface cockpits cannot use component armoring.') : null;
    }
    const equipment = component.equipment;
    if (!equipment) return null;
    if (equipment instanceof AmmoEquipment && equipment.ammoType !== 'COOLANT_POD') {
        return issue('ARMORED_AMMUNITION', `${equipment.name}: ammunition bins cannot be armored.`, component.location);
    }
    if (!equipment.hittable) {
        return issue('ARMORED_UNHITTABLE_COMPONENT', `${equipment.name}: components that cannot take critical hits cannot be armored.`, component.location);
    }
    if (component.allocation.kind === 'engine') {
        return issue('ARMORED_INTEGRAL_COMPONENT', `${equipment.name}: integral heat sinks are protected through the engine's critical-slot armor.`, component.location);
    }
    return null;
}

/** Also checks imported drafts; the inspector uses the same eligibility rule. */
export function constructionComponentArmorMessages(entity: BaseEntity): EntityValidationMessage[] {
    const mounts = entity.equipment().filter(mount => mount.armored);
    const systems = new Set<MekSystemType>();
    if (entity instanceof MekEntity) for (const slots of entity.criticalSlotGrid().values()) {
        for (const slot of slots) if (slot.type === 'system' && slot.armored) systems.add(slot.systemType);
    }
    if (!mounts.length && !systems.size) return [];
    const chassisIssue = constructionComponentArmorIssue(entity, 'Engine');
    if (chassisIssue) return [chassisIssue];
    const issues = [...mounts, ...systems].map(component => constructionComponentArmorIssue(entity, component))
        .filter(issue => issue !== null);
    if (entity instanceof MekEntity) {
        const slots = constructionSystemSlotKeys(entity);
        const armored = entity.armoredSystemSlots();
        for (const keys of constructionSystemComponents(slots).values()) {
            if (!keys.some(key => armored.has(key)) || keys.every(key => armored.has(key))) continue;
            issues.push({ severity: 'error', category: 'equipment', code: 'PARTIAL_COMPONENT_ARMOR',
                message: `${slots.get(keys[0])}: component armor covers every critical slot of the component (TO:AUE p. 95).`,
                location: keys[0].slice(0, keys[0].indexOf(':')) });
        }
    }
    return issues;
}
