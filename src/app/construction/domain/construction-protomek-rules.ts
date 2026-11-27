// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import { ProtoMekEntity } from '../../models/entity/entities';
import { AmmoEquipment, Equipment, MiscEquipment } from '../../models/equipment.model';
import type { BaseEntity } from '../../models/entity/base-entity';
import type { EntityMountedEquipment, EntityValidationMessage } from '../../models/entity/types';
import { getNumCriticalSlots } from '../../models/entity/utils/equipment-helpers';
import { isImprovedJumpJetEquipment } from '../../models/jump-equipment.model';

/** TestProtoMek.requiresSlot: these systems occupy the body without using item slots. */
export function constructionProtoMekRequiresSlot(equipment: Equipment): boolean {
  return (
    !(equipment instanceof AmmoEquipment) &&
    !(equipment instanceof MiscEquipment && equipment.hasAnyFlag(['F_MASC', 'F_UMU', 'F_JUMP_JET', 'F_EI_INTERFACE']))
  );
}

export function constructionProtoMekSlotCapacity(entity: ProtoMekEntity, location: string): number | null {
  if (location === 'Torso') return (entity.tonnage() > 9 ? 3 : 2) * (entity.isQuad() ? 2 : 1);
  if (location.endsWith('Arm')) return entity.isQuad() ? 0 : 1;
  if (location === 'Main Gun') return !entity.hasMainGun() ? 0 : entity.isQuad() && entity.tonnage() > 9 ? 2 : 1;
  return location === 'Body' ? null : 0;
}

/** Armor reserves torso slots even if there is no corresponding equipment mount. */
export function constructionProtoMekLocationUsage(
  entity: ProtoMekEntity,
  location: string,
  ignore?: EntityMountedEquipment,
): { slots: number; tons: number; maxSlots: number; maxTons: number } {
  const mounts = entity
    .getEquipmentAtLocation(location)
    .filter(
      (mount) =>
        mount.mountId !== ignore?.mountId &&
        mount.equipment &&
        mount.equipment.type !== 'armor' &&
        constructionProtoMekRequiresSlot(mount.equipment),
    );
  const armor = entity.uniformArmor()?.armor;
  const armorSlots = location === 'Torso' && armor ? (getNumCriticalSlots(entity, armor) ?? 0) : 0;
  const maxTons =
    location === 'Main Gun' && entity.hasMainGun()
      ? Infinity
      : location === 'Torso'
        ? entity.isQuad()
          ? entity.tonnage() > 9
            ? 8
            : 5
          : entity.tonnage() > 9
            ? 4
            : 2
        : location.endsWith('Arm') && !entity.isQuad()
          ? entity.tonnage() > 9
            ? 1
            : 0.5
          : 0;
  return {
    slots: mounts.length + armorSlots,
    tons: mounts.reduce((sum, mount) => sum + (mount.getTonnage(entity) ?? 0), 0),
    maxSlots: constructionProtoMekSlotCapacity(entity, location) ?? 0,
    maxTons,
  };
}

export function constructionProtoMekMessages(entity: BaseEntity): EntityValidationMessage[] {
  if (!(entity instanceof ProtoMekEntity)) return [];
  const messages: EntityValidationMessage[] = [];
  const add = (code: string, message: string, category: EntityValidationMessage['category'], location?: string) =>
    messages.push({ code, message, category, location, severity: 'error' });
  if (!Number.isInteger(entity.tonnage()))
    add('PROTO_TONNAGE_INCREMENT', 'ProtoMeks require whole-ton chassis weights.', 'weight');
  const maximum = entity.equipment().some((mount) => isImprovedJumpJetEquipment(mount.equipment))
    ? Math.ceil(entity.originalWalkMP() * 1.5)
    : entity.originalWalkMP();
  if (entity.installedJumpJetMP() > maximum)
    add('PROTO_JUMP_LIMIT', `This ProtoMek permits at most ${maximum} jump MP.`, 'movement');
  if (entity.equipment().filter((mount) => mount.equipment?.hasFlag('F_UMU')).length > maximum)
    add('PROTO_UMU_LIMIT', `This ProtoMek permits at most ${maximum} UMU MP.`, 'movement');
  for (const mount of entity.equipment()) {
    if (mount.rearMounted && mount.location !== 'Torso')
      add('PROTO_REAR_LOCATION', 'Only torso equipment can be rear mounted.', 'equipment', mount.location);
    const equipment = mount.equipment;
    if (equipment?.hasFlag('S_PROTO_QMS') && !entity.isQuad())
      add('PROTO_QUAD_MELEE', 'Quad melee systems require a quad ProtoMek.', 'equipment', mount.location);
    if (equipment?.hasFlag('S_PROTOMEK_WEAPON') && entity.isQuad())
      add('PROTO_BIPED_MELEE', 'Arm melee weapons cannot be mounted on quad ProtoMeks.', 'equipment', mount.location);
  }
  for (const location of new Set([...entity.validLocations, ...entity.equipment().map((mount) => mount.location)])) {
    const usage = constructionProtoMekLocationUsage(entity, location);
    if (usage.slots > usage.maxSlots)
      add(
        'PROTO_LOCATION_SLOTS',
        `${location} uses ${usage.slots} of ${usage.maxSlots} slots, including armor.`,
        'crit',
        location,
      );
    if (usage.tons > usage.maxTons + 1e-9)
      add('PROTO_LOCATION_WEIGHT', `${location} equipment exceeds its ${usage.maxTons} t limit.`, 'weight', location);
  }
  return messages;
}
