import type { BaseEntity } from '../../base-entity';
import type { InfantryEntity } from '../../entities/infantry/infantry-entity';
import type { BattleArmorEntity } from '../../entities/infantry/battle-armor-entity';
import type { MekEntity } from '../../entities/mek/mek-entity';
import type { ProtoMekEntity } from '../../entities/protomek/protomek-entity';
import type { VehicleEntity } from '../../entities/vehicle/vehicle-entity';
import type { AeroEntity } from '../../entities/aero/aero-entity';
import { getInfantryTonnage } from '../infantry-tonnage';
import { calculateMekEffectiveTonnage } from './mek-weight';
import { calculateBattleArmorEffectiveTonnage } from './battle-armor-weight';
import { calculateProtoMekEffectiveTonnage } from './protomek-weight';
import { calculateVehicleEffectiveTonnage } from './vehicle-weight';
import { calculateSupportVehicleEffectiveTonnage } from './support-vehicle-weight';
import { calculateFighterEffectiveTonnage } from './fighter-weight';

/**
 * Calculate installed construction mass independently of declared chassis
 * capacity (`BaseEntity.tonnage`).
 *
 * Families are enabled only after their MegaMek verifier calculation has
 * been ported and checked against the generated weight reports. Returning
 * declared tonnage as a fallback would hide underweight and overweight units.
 */
export function calculateEntityEffectiveTonnage(entity: BaseEntity): number {
  switch (entity.entityType) {
    case 'Aero':
    case 'ConvFighter':
      return calculateFighterEffectiveTonnage(entity as AeroEntity);
    case 'SupportTank':
    case 'LargeSupportTank':
    case 'SupportNaval':
    case 'SupportVTOL':
      return calculateSupportVehicleEffectiveTonnage(entity as VehicleEntity & import('../../entities/support-vehicle').SupportVehicle);
    case 'Tank':
    case 'Naval':
    case 'VTOL':
      return calculateVehicleEffectiveTonnage(entity as VehicleEntity);
    case 'ProtoMek':
      return calculateProtoMekEffectiveTonnage(entity as ProtoMekEntity);
    case 'BattleArmor':
      return calculateBattleArmorEffectiveTonnage(entity as BattleArmorEntity);
    case 'Mek':
      return calculateMekEffectiveTonnage(entity as MekEntity);
    case 'Infantry':
      return getInfantryTonnage(entity as InfantryEntity);
    default:
      throw new Error(`Effective tonnage is not implemented for ${entity.entityType}`);
  }
}