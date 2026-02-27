/*
 * Copyright (C) 2025 The MegaMek Team. All Rights Reserved.
 *
 * This file is part of MekBay.
 *
 * MekBay is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License (GPL),
 * version 3 or (at your option) any later version,
 * as published by the Free Software Foundation.
 *
 * MekBay is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty
 * of MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.
 * See the GNU General Public License for more details.
 *
 * A copy of the GPL should have been included with this project;
 * if not, see <https://www.gnu.org/licenses/>.
 *
 * NOTICE: The MegaMek organization is a non-profit group of volunteers
 * creating free software for the BattleTech community.
 *
 * MechWarrior, BattleMech, `Mech and AeroTech are registered trademarks
 * of The Topps Company, Inc. All Rights Reserved.
 *
 * Catalyst Game Labs and the Catalyst Game Labs logo are trademarks of
 * InMediaRes Productions, LLC.
 *
 * MechWarrior Copyright Microsoft Corporation. MegaMek was created under
 * Microsoft's "Game Content Usage Rules"
 * <https://www.xbox.com/en-US/developers/rules> and it is not endorsed by or
 * affiliated with Microsoft.
 */

import { InfantryEntity } from '../entities/infantry/infantry-entity';
import {
  INFANTRY_SPECIALIZATION_FROM_BIT,
  InfantryMount,
  InfantrySpecialization,
  MotiveType,
  parseMotiveType,
} from '../types';
import { generateMountId, resetMountIdCounter } from '../utils/signal-helpers';
import { BuildingBlock } from './building-block';
import { getBlkTechBase, parseBaseBlk } from './blk-base-parser';
import { parseEquipmentLine } from './equipment-resolver';
import { ParseContext } from './parse-context';

// ============================================================================
// Predefined beast mounts (loaded from inline data matching infantry-mounts.json)
// ============================================================================

const PREDEFINED_MOUNTS: ReadonlyMap<string, InfantryMount> = new Map([
  ['Donkey',            { name: 'Donkey',            size: 'Large',      weight: 0.15, movementPoints: 2, movementMode: 'Leg',       burstDamage: 0,  vehicleDamage: 0, damageDivisor: 1.0, maxWaterDepth: 0,  secondaryGroundMP: 0, uwEndurance: 0 }],
  ['Coventry Kangaroo', { name: 'Coventry Kangaroo', size: 'Large',      weight: 0.11, movementPoints: 3, movementMode: 'Leg',       burstDamage: 1,  vehicleDamage: 1, damageDivisor: 1.0, maxWaterDepth: 0,  secondaryGroundMP: 0, uwEndurance: 0 }],
  ['Horse',             { name: 'Horse',             size: 'Large',      weight: 0.5,  movementPoints: 3, movementMode: 'Leg',       burstDamage: 0,  vehicleDamage: 0, damageDivisor: 1.0, maxWaterDepth: 0,  secondaryGroundMP: 0, uwEndurance: 0 }],
  ['Camel',             { name: 'Camel',             size: 'Large',      weight: 0.65, movementPoints: 2, movementMode: 'Leg',       burstDamage: 0,  vehicleDamage: 0, damageDivisor: 1.0, maxWaterDepth: 0,  secondaryGroundMP: 0, uwEndurance: 0 }],
  ['Branth',            { name: 'Branth',            size: 'Large',      weight: 0.72, movementPoints: 6, movementMode: 'VTOL',      burstDamage: 2,  vehicleDamage: 1, damageDivisor: 1.0, maxWaterDepth: 0,  secondaryGroundMP: 0, uwEndurance: 0 }],
  ['Odessan Raxx',      { name: 'Odessan Raxx',      size: 'Large',      weight: 2.4,  movementPoints: 2, movementMode: 'Leg',       burstDamage: 1,  vehicleDamage: 1, damageDivisor: 1.0, maxWaterDepth: 0,  secondaryGroundMP: 0, uwEndurance: 0 }],
  ['Tabiranth',         { name: 'Tabiranth',         size: 'Large',      weight: 0.25, movementPoints: 2, movementMode: 'Leg',       burstDamage: 1,  vehicleDamage: 1, damageDivisor: 1.0, maxWaterDepth: 0,  secondaryGroundMP: 0, uwEndurance: 0 }],
  ['Tariq',             { name: 'Tariq',             size: 'Large',      weight: 0.51, movementPoints: 5, movementMode: 'Leg',       burstDamage: 0,  vehicleDamage: 0, damageDivisor: 1.0, maxWaterDepth: 0,  secondaryGroundMP: 0, uwEndurance: 0 }],
  ['Elephant',          { name: 'Elephant',          size: 'Very Large', weight: 6.0,  movementPoints: 2, movementMode: 'Leg',       burstDamage: 1,  vehicleDamage: 1, damageDivisor: 2.0, maxWaterDepth: 1,  secondaryGroundMP: 0, uwEndurance: 0 }],
  ['Orca',              { name: 'Orca',              size: 'Very Large', weight: 7.2,  movementPoints: 5, movementMode: 'Submarine', burstDamage: 2,  vehicleDamage: 1, damageDivisor: 2.0, maxWaterDepth: -1, secondaryGroundMP: 0, uwEndurance: 180 }],
  ['Hipposaur',         { name: 'Hipposaur',         size: 'Monstrous',  weight: 35.5, movementPoints: 2, movementMode: 'Submarine', burstDamage: 10, vehicleDamage: 4, damageDivisor: 4.0, maxWaterDepth: -1, secondaryGroundMP: 1, uwEndurance: 2 }],
] as [string, InfantryMount][]);

/** Java BeastSize enum names → our BeastSize type */
const BEAST_SIZE_MAP: Record<string, 'Large' | 'Very Large' | 'Monstrous'> = {
  'LARGE': 'Large',
  'VERY_LARGE': 'Very Large',
  'MONSTROUS': 'Monstrous',
};

/**
 * Parse the compound `motion_type` string for infantry.
 * Handles: `"Beast:Name"`, `"Beast:Custom:csv..."`, `"Motorized SCUBA"`,
 * `"Microcopter"`, `"Microlite"`, and simple motive types.
 */
function parseInfantryMotionType(raw: string, entity: InfantryEntity, ctx: ParseContext): void {
  const trimmed = raw.trim();

  // ── Beast-mounted infantry ────────────────────────────────────────
  if (trimmed.startsWith('Beast:')) {
    entity.motiveType.set('Beast');
    const afterBeast = trimmed.slice(6); // strip "Beast:"

    if (afterBeast.startsWith('Custom:')) {
      // Custom beast: "Beast:Custom:name,SIZE,weight,mp,mode,burst,veh,div,water,groundMP,uw"
      const fields = afterBeast.slice(7).split(',');
      if (fields.length >= 11) {
        const size = BEAST_SIZE_MAP[fields[1]] ?? 'Large';
        entity.mount.set({
          name: fields[0],
          size,
          weight: parseFloat(fields[2]) || 0,
          movementPoints: parseInt(fields[3], 10) || 0,
          movementMode: parseMotiveType(fields[4]),
          burstDamage: parseInt(fields[5], 10) || 0,
          vehicleDamage: parseInt(fields[6], 10) || 0,
          damageDivisor: parseFloat(fields[7]) || 1,
          maxWaterDepth: parseInt(fields[8], 10) || 0,
          secondaryGroundMP: parseInt(fields[9], 10) || 0,
          uwEndurance: parseInt(fields[10], 10) || 0,
          custom: true,
        });
      } else {
        ctx.warn('motion_type', `Custom beast mount has ${fields.length} fields, expected 11: "${trimmed}"`);
      }
    } else {
      // Predefined beast: "Beast:Tariq"
      const predefined = PREDEFINED_MOUNTS.get(afterBeast);
      if (predefined) {
        entity.mount.set(predefined);
      } else {
        ctx.warn('motion_type', `Unknown beast mount: "${afterBeast}"`);
        entity.mount.set({
          name: afterBeast, size: 'Large', weight: 0, movementPoints: 0,
          movementMode: 'Leg', burstDamage: 0, vehicleDamage: 0,
          damageDivisor: 1, maxWaterDepth: 0, secondaryGroundMP: 0, uwEndurance: 0,
        });
      }
    }
    return;
  }

  // ── VTOL sub-variants ─────────────────────────────────────────────
  const lower = trimmed.toLowerCase();
  if (lower === 'microlite') {
    entity.motiveType.set('VTOL');
    entity.isMicrolite.set(true);
    return;
  }
  if (lower === 'microcopter' || lower === 'micro-copter') {
    entity.motiveType.set('VTOL');
    // isMicrolite stays false (default)
    return;
  }

  // ── UMU sub-variants ──────────────────────────────────────────────
  if (lower === 'motorized scuba') {
    entity.motiveType.set('UMU');
    entity.isMotorizedScuba.set(true);
    return;
  }
  if (lower === 'scuba') {
    entity.motiveType.set('UMU');
    // isMotorizedScuba stays false (default)
    return;
  }

  // ── Simple motive types ───────────────────────────────────────────
  entity.motiveType.set(parseMotiveType(trimmed));
}

// ============================================================================
// Public API
// ============================================================================

/**
 * Parse a BLK file for a conventional Infantry platoon.
 */
export function parseBlkInfantry(bb: BuildingBlock, ctx: ParseContext): InfantryEntity {
  resetMountIdCounter();
  const entity = new InfantryEntity();

  // ── Base parsing ──
  parseBaseBlk(bb, entity, ctx);
  const techBase = getBlkTechBase(bb);

  // ── Motive type ──
  if (bb.exists('motion_type')) {
    parseInfantryMotionType(bb.getFirstString('motion_type'), entity, ctx);
  }

  // ── Troopers Equipment (armor kits, etc. — stored in 'Infantry' location) ──
  if (bb.exists('Troopers Equipment')) {
    const lines = bb.getDataAsString('Troopers Equipment');
    for (const raw of lines) {
      const line = raw.trim();
      if (!line) continue;

      const parsed = parseEquipmentLine(line);
      const resolved = ctx.resolveEquipment(parsed.name, 'Troopers Equipment');

      entity.addEquipment({
        mountId: generateMountId(),
        equipmentId: parsed.name,
        equipment: resolved ?? undefined,
        location: 'Infantry',
        rearMounted: false,
        turretMounted: false,
        omniPodMounted: false,
        armored: false,
        size: parsed.size,
        shotsLeft: parsed.shots,
      });
    }
  }

  // ── Field Guns ──
  if (bb.exists('Field Guns Equipment')) {
    const lines = bb.getDataAsString('Field Guns Equipment');
    for (const raw of lines) {
      const line = raw.trim();
      if (!line) continue;

      const parsed = parseEquipmentLine(line);
      const resolved = ctx.resolveEquipment(parsed.name, 'Field Guns Equipment');

      entity.addEquipment({
        mountId: generateMountId(),
        equipmentId: parsed.name,
        equipment: resolved ?? undefined,
        location: 'Field Guns',
        rearMounted: false,
        turretMounted: false,
        omniPodMounted: false,
        armored: false,
        size: parsed.size,
        shotsLeft: parsed.shots,
      });
    }
  }

  // ── Squad configuration ──
  if (bb.exists('squad_size')) entity.squadSize.set(bb.getFirstInt('squad_size'));
  if (bb.exists('squadn'))    entity.squadCount.set(bb.getFirstInt('squadn'));

  // ── Weapons ──
  if (bb.exists('Primary'))      entity.primaryWeapon.set(bb.getFirstString('Primary'));
  if (bb.exists('Secondary'))    entity.secondaryWeapon.set(bb.getFirstString('Secondary'));
  if (bb.exists('secondn'))      entity.secondaryCount.set(bb.getFirstInt('secondn'));

  // ── Armor ──
  // lowercase 'armordivisor' matches Java BLKFile output
  if (bb.exists('armordivisor')) entity.armorDivisor.set(bb.getFirstDouble('armordivisor'));
  // legacy uppercase form
  else if (bb.exists('armorDivisor')) entity.armorDivisor.set(bb.getFirstDouble('armorDivisor'));
  if (bb.exists('armorKit'))     entity.armorKit.set(bb.getFirstString('armorKit'));

  // ── Infantry-specific boolean fields (Java uses existence check, value is "true") ──
  if (bb.exists('encumberingarmor')) entity.encumberingArmor.set(true);
  if (bb.exists('spacesuit'))       entity.spaceSuit.set(true);
  if (bb.exists('dest'))            entity.hasDEST.set(true);
  if (bb.exists('sneakcamo'))       entity.sneakCamo.set(true);
  if (bb.exists('sneakir'))         entity.sneakIR.set(true);
  if (bb.exists('sneakecm'))        entity.sneakECM.set(true);

  // ── Anti-mek ──
  if (bb.exists('antimek')) {
    entity.antimek.set(bb.getFirstInt('antimek') === 1 || bb.getFirstString('antimek').toLowerCase() === 'true');
  }

  // ── Specializations (bitmap) ──
  if (bb.exists('specialization')) {
    const bitmap = bb.getFirstInt('specialization');
    const specs = new Set<InfantrySpecialization>();
    for (const [bit, spec] of Object.entries(INFANTRY_SPECIALIZATION_FROM_BIT)) {
      if (bitmap & (1 << parseInt(bit, 10))) {
        specs.add(spec);
      }
    }
    entity.specializations.set(specs);
  }

  // ── Augmentations (Manei Domini) ──
  if (bb.exists('augmentation')) {
    const augs = bb.getDataAsString('augmentation').map(s => s.trim()).filter(s => s.length > 0);
    if (augs.length > 0) entity.augmentations.set(augs);
  }

  // ── Prosthetic Enhancements (Enhanced Limbs — IO p.84) ──
  if (bb.exists('prostheticEnhancement1')) {
    entity.prostheticEnhancement1.set(bb.getFirstString('prostheticEnhancement1'));
    if (bb.exists('prostheticEnhancement1Count')) {
      entity.prostheticEnhancement1Count.set(bb.getFirstInt('prostheticEnhancement1Count'));
    }
  } else if (bb.exists('prostheticEnhancement')) {
    // Legacy single-slot format
    entity.prostheticEnhancement1.set(bb.getFirstString('prostheticEnhancement'));
    if (bb.exists('prostheticEnhancementCount')) {
      entity.prostheticEnhancement1Count.set(bb.getFirstInt('prostheticEnhancementCount'));
    }
  }
  if (bb.exists('prostheticEnhancement2')) {
    entity.prostheticEnhancement2.set(bb.getFirstString('prostheticEnhancement2'));
    if (bb.exists('prostheticEnhancement2Count')) {
      entity.prostheticEnhancement2Count.set(bb.getFirstInt('prostheticEnhancement2Count'));
    }
  }
  if (bb.exists('extraneousPair1')) {
    entity.extraneousPair1.set(bb.getFirstString('extraneousPair1'));
  }
  if (bb.exists('extraneousPair2')) {
    entity.extraneousPair2.set(bb.getFirstString('extraneousPair2'));
  }

  return entity;
}
