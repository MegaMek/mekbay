// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import type { BaseEntity } from '../../models/entity/base-entity';
import {
  BattleArmorEntity,
  InfantryEntity,
  MekEntity,
  ProtoMekEntity,
  VehicleEntity,
  StaticEmplacementEntity,
} from '../../models/entity/entities';
import { AmmoEquipment, ArmorEquipment, Equipment } from '../../models/equipment.model';
import type { EquipmentFlag } from '../../models/equipment-flags.type';
import type { EntityMountedEquipment, EntityValidationMessage } from '../../models/entity/types';
import { chassisEquipmentKind } from '../../models/chassis-equipment.model';
import { isSimpleCamoEquipment } from '../../models/stealth-equipment.model';
import { buildingHexKey, parseBuildingLocation } from '../../models/entity/types/building';

type Matches = (equipment: Equipment) => boolean;
const flags =
  (...values: EquipmentFlag[]): Matches =>
  (equipment) =>
    equipment.hasAnyFlag(values);
const masc: Matches = (equipment) => equipment.hasFlag('F_MASC') && !equipment.hasFlag('S_SUPERCHARGER');
const myomer = flags('F_TSM', 'F_INDUSTRIAL_TSM', 'F_SCM');
const c3 = flags('F_C3S', 'F_C3SBS', 'F_C3M', 'F_C3MBS', 'F_C3I');
const stealth: Matches = (equipment) => equipment instanceof ArmorEquipment && equipment.armorType === 'STEALTH';

/** TestEntity/TestMek/TestBattleArmor combinations. Candidate checks report only conflicts involving the new choice.
 * Dependencies (ECM, links, all-leg AES, etc.) remain issues so installation order cannot deadlock the editor.
 */
export function constructionEquipmentConflictMessages(
  entity: BaseEntity,
  candidate?: Equipment,
  ignoreMount?: EntityMountedEquipment,
  candidateLocation?: string,
): EntityValidationMessage[] {
  const messages: EntityValidationMessage[] = [];
  const equipment = entity
    .equipment()
    .filter((mount) => mount.mountId !== ignoreMount?.mountId)
    .flatMap((mount) => (mount.equipment && mount.equipment.type !== 'armor' ? [mount.equipment] : []));
  const armor =
    candidate instanceof ArmorEquipment
      ? [candidate]
      : [...entity.armorByLocation().values()].map((material) => material.armor);
  const installed = [
    ...equipment,
    ...armor,
    ...(candidate && !(candidate instanceof ArmorEquipment) ? [candidate] : []),
  ];
  const has = (predicate: Matches) => installed.some(predicate);
  const add = (code: string, message: string) =>
    messages.push({ code, message, category: 'equipment', severity: 'error' });
  const pair = (code: string, message: string, first: Matches, second: Matches, firstPresent = has(first)) => {
    if (firstPresent && has(second) && (!candidate || first(candidate) || second(candidate))) add(code, message);
  };
  const limit = (code: string, message: string, matches: Matches, maximum: number) => {
    if (entity instanceof StaticEmplacementEntity && entity.isMobile()) {
      if (candidate && !matches(candidate)) return;
      const selectedHex = candidateLocation ? parseBuildingLocation(candidateLocation)?.hex : undefined;
      const counts = entity.coordinates().filter(hex => !selectedHex || buildingHexKey(hex) === buildingHexKey(selectedHex))
        .map(hex => entity.getEquipmentInHex(hex).filter(mount => mount.mountId !== ignoreMount?.mountId
          && mount.equipment && matches(mount.equipment)).length);
      // The palette has no destination yet; keep an item available while any hex can accept it.
      const exceeds = candidate ? (selectedHex ? counts.some(count => count >= maximum)
        : counts.every(count => count >= maximum)) : counts.some(count => count > maximum);
      if (exceeds) add(code, `At most ${maximum} ${candidate?.name ?? 'items of this type'} per Mobile Structure hex.`);
      return;
    }
    if (
      (!candidate || matches(candidate)) &&
      equipment.filter(matches).length + Number(!!candidate && matches(candidate)) > maximum
    )
      add(code, message);
  };
  pair(
    'COOLANT_SYSTEM_CONFLICT',
    'Coolant pods cannot be combined with a RISC emergency coolant system.',
    flags('F_EMERGENCY_COOLANT_SYSTEM'),
    (eq) => eq instanceof AmmoEquipment && eq.ammoType === 'COOLANT_POD',
  );
  limit(
    'EMERGENCY_COOLANT_LIMIT',
    'A unit can mount only one RISC emergency coolant system.',
    flags('F_EMERGENCY_COOLANT_SYSTEM'),
    1,
  );
  limit('MINESWEEPER_LIMIT', 'A unit can mount only one minesweeper.', flags('F_MINESWEEPER'), 1);
  limit('FIELD_KITCHEN_LIMIT', 'A unit can mount at most three field kitchens.', flags('F_FIELD_KITCHEN'), 3);
  limit(
    'DRONE_SYSTEM_CONFLICT',
    'A unit can mount only one robotic control system.',
    flags('F_SRCS', 'F_SASRCS', 'F_CASPAR', 'F_CASPAR_II'),
    1,
  );
  limit(
    'COMMUNICATIONS_SET_LIMIT',
    'A unit can mount only one additional communications system; adjust its tonnage.',
    flags('F_COMMUNICATIONS'),
    1,
  );
  const hoists =
    entity instanceof MekEntity ? 2 : entity instanceof VehicleEntity || entity.isSupportVehicle()
      || entity instanceof StaticEmplacementEntity && entity.isMobile() ? 4 : null;
  if (hoists !== null)
    limit('LIFT_HOIST_LIMIT', `This unit can mount at most ${hoists} lift hoists.`, flags('F_LIFT_HOIST'), hoists);
  const network = flags('F_C3S', 'F_C3SBS', 'F_C3M', 'F_C3MBS', 'F_C3I', 'F_NOVA');
  if (!candidate || network(candidate)) {
    const hierarchical = has(flags('F_C3S', 'F_C3SBS'));
    let networks = Number(hierarchical) + installed.filter(flags('F_C3I', 'F_NOVA')).length;
    if (networks && !hierarchical) networks += installed.filter(flags('F_C3M', 'F_C3MBS')).length;
    if (networks > 1) add('NETWORK_SYSTEM_CONFLICT', 'A unit cannot combine multiple network systems.');
  }
  const artemis = flags('F_ARTEMIS', 'F_ARTEMIS_V', 'F_ARTEMIS_PROTO');
  if (
    (!candidate || artemis(candidate)) &&
    ['F_ARTEMIS', 'F_ARTEMIS_V', 'F_ARTEMIS_PROTO'].filter((flag) => has(flags(flag as EquipmentFlag))).length > 1
  )
    add('ARTEMIS_GENERATION', 'All Artemis systems must be of the same generation.');

  if (entity instanceof MekEntity) {
    const advanced = entity.myomerType() !== 'Standard' || has(myomer);
    pair('MEK_MASC_MYOMER', 'MASC cannot be combined with advanced myomers.', myomer, masc, advanced);
    pair(
      'MEK_AES_MASC',
      'Actuator enhancement systems cannot be combined with MASC.',
      flags('F_ACTUATOR_ENHANCEMENT_SYSTEM'),
      masc,
    );
    pair(
      'MEK_AES_TARGETING',
      'Actuator enhancement systems cannot be combined with targeting computers.',
      flags('F_ACTUATOR_ENHANCEMENT_SYSTEM'),
      flags('F_TARGETING_COMPUTER'),
    );
    pair(
      'MEK_AES_MYOMER',
      'Actuator enhancement systems cannot be combined with advanced myomers.',
      myomer,
      flags('F_ACTUATOR_ENHANCEMENT_SYSTEM'),
      advanced,
    );
    pair(
      'MEK_NULL_STEALTH',
      'Null-signature systems cannot be combined with stealth armor.',
      flags('F_NULL_SIG'),
      stealth,
    );
    pair(
      'MEK_NULL_TARGETING',
      'Null-signature systems cannot be combined with targeting computers.',
      flags('F_NULL_SIG'),
      flags('F_TARGETING_COMPUTER'),
    );
    pair(
      'MEK_NULL_VOID',
      'Null-signature and void-signature systems cannot be combined.',
      flags('F_NULL_SIG'),
      flags('F_VOID_SIG'),
    );
    pair('MEK_NULL_C3', 'Null-signature systems cannot be combined with C3 or C3i.', flags('F_NULL_SIG'), c3);
    pair(
      'MEK_VOID_STEALTH',
      'Void-signature systems cannot be combined with stealth armor.',
      flags('F_VOID_SIG'),
      stealth,
    );
    pair(
      'MEK_VOID_TARGETING',
      'Void-signature systems cannot be combined with targeting computers.',
      flags('F_VOID_SIG'),
      flags('F_TARGETING_COMPUTER'),
    );
    pair(
      'MEK_VOID_C3',
      'Void-signature systems cannot be combined with C3, C3i or Nova CEWS.',
      flags('F_VOID_SIG'),
      (eq) => c3(eq) || eq.hasAnyFlag(['F_NOVA', 'F_NAVAL_C3']),
    );
    pair(
      'MEK_CHAMELEON_SIGNATURE',
      'Chameleon shields cannot be combined with stealth armor or void-signature systems.',
      flags('F_CHAMELEON_SHIELD'),
      (eq) => stealth(eq) || eq.hasFlag('F_VOID_SIG'),
    );
    pair(
      'MEK_HARJEL_GENERATION',
      'HarJel II and HarJel III cannot be combined.',
      flags('F_HARJEL_II'),
      flags('F_HARJEL_III'),
    );
    pair('MEK_UMU_JUMP_CONFLICT', 'UMUs cannot be combined with jump jets.', flags('F_UMU'), flags('F_JUMP_JET'));
    pair(
      'MEK_WING_BOOSTER_CONFLICT',
      'Partial wings cannot be combined with jump boosters.',
      flags('F_PARTIAL_WING'),
      flags('F_JUMP_BOOSTER'),
    );
    for (const flag of ['F_QUAD_TURRET', 'F_HEAD_TURRET', 'F_TARGETING_COMPUTER'] as const)
      limit(
        'MEK_SINGLE_SYSTEM',
        `Only one ${flag.replace('F_', '').toLowerCase().replaceAll('_', ' ')} may be installed.`,
        flags(flag),
        1,
      );
  }
  if (entity instanceof BattleArmorEntity) {
    pair(
      'BA_CAMO_MIMETIC_CONFLICT',
      'A camo system cannot be combined with mimetic armor (TechManual errata, p. 253).',
      isSimpleCamoEquipment,
      (eq) => eq instanceof ArmorEquipment && eq.armorType === 'BA_MIMETIC',
    );
    pair(
      'BA_WING_BOOSTER_CONFLICT',
      'Partial wings and jump boosters cannot be combined.',
      flags('F_PARTIAL_WING'),
      flags('F_JUMP_BOOSTER'),
    );
    pair(
      'BA_MYOMER_MECHANICAL_CONFLICT',
      'Myomer boosters and mechanical jump boosters cannot be combined.',
      masc,
      flags('F_MECHANICAL_JUMP_BOOSTER'),
    );
    pair(
      'BA_MYOMER_ARMOR_CONFLICT',
      'Myomer boosters cannot be combined with mimetic or stealth armor.',
      masc,
      (eq) => eq instanceof ArmorEquipment && (eq.armorType === 'BA_MIMETIC' || eq.armorType.startsWith('BA_STEALTH')),
    );
  }
  if (entity instanceof ProtoMekEntity)
    limit('PROTO_MELEE_LIMIT', 'Only one ProtoMek melee system is permitted.', flags('F_PROTOMEK_MELEE'), 1);
  if (entity instanceof InfantryEntity)
    limit('INFANTRY_ARMOR_KIT_LIMIT', 'Infantry can carry only one armor kit.', flags('F_ARMOR_KIT'), 1);
  if (entity.isSupportVehicle()) {
    for (const [first, second] of [
      ['armored-chassis', 'ultra-light'],
      ['bicycle', 'monocycle'],
      ['snowmobile', 'dune-buggy'],
      ['snowmobile', 'amphibious'],
      ['snowmobile', 'off-road'],
      ['dune-buggy', 'amphibious'],
      ['dune-buggy', 'off-road'],
    ] as const)
      pair(
        'SUPPORT_MOD_CONFLICT',
        `${first} and ${second} chassis modifications cannot be combined.`,
        (eq) => chassisEquipmentKind(eq) === first,
        (eq) => chassisEquipmentKind(eq) === second,
      );
    pair(
      'SUPPORT_FIRE_CONTROL_CONFLICT',
      'Basic and advanced fire control cannot be combined.',
      flags('F_BASIC_FIRE_CONTROL'),
      flags('F_ADVANCED_FIRE_CONTROL'),
    );
  }
  return messages;
}
