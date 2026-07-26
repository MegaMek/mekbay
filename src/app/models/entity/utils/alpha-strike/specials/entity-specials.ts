import { AeroEntity, ConvFighterEntity, DropShipEntity, FixedWingSupportEntity, JumpShipEntity, VtolEntity, type BaseEntity } from '../../../entities';
import type { ASUnitTypeCode } from '../../../../units.model';
import { LARGE_AEROSPACE_TYPES, hasAlphaStrikeVstolCapability } from '../foundation/unit-classification';

/** Converts special abilities intrinsic to a unit's chassis, class, and crew. */
export function alphaStrikeEntitySpecials(
  entity: BaseEntity,
  type: ASUnitTypeCode,
  size: number,
): string[] {
  const specials: string[] = [];
  if (entity instanceof VtolEntity) specials.push('ATMO');
  if (type === 'AF' || LARGE_AEROSPACE_TYPES.has(type)) specials.push('SPC');
  if (type === 'AF' || type === 'CF') specials.push(`BOMB${size}`);
  if (type === 'AF' && entity instanceof AeroEntity) {
    const fuel = Math.round(entity.fuel() * 0.05);
    if (fuel > 0) specials.push(`FUEL${fuel}`);
  }
  if (entity instanceof FixedWingSupportEntity) {
    const bombs = Math.ceil(entity.maxBombPoints() * 0.2);
    if (bombs > 0) specials.push(`BOMB${bombs}`);
  }
  if (type === 'SC' || type === 'DS' || type === 'DA') {
    specials.push(size === 1 ? 'LG' : size === 2 ? 'VLG' : 'SLG');
  }
  if (entity instanceof JumpShipEntity) {
    if (entity.driveCoreType() !== 'None') specials.push('KF');
    if (entity.lithiumFusion()) specials.push('LF');
    if (entity.crew() >= 60) specials.push(`CRW${Math.round(entity.crew() / 120)}`);
  }
  if (entity instanceof DropShipEntity && entity.crew() >= 30) {
    specials.push(`CRW${Math.round(entity.crew() / 60)}`);
  }
  if (type === 'SV' && size === 3) specials.push('LG');
  else if (type === 'SV' && size === 4) specials.push('VLG');
  else if (type === 'SV' && size === 5) specials.push('SLG');
  if (entity instanceof FixedWingSupportEntity || entity instanceof ConvFighterEntity) specials.push('ATMO');
  if (hasAlphaStrikeVstolCapability(entity, type)) specials.push('VSTOL');
  return specials;
}
