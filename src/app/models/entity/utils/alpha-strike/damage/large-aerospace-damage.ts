import type { AlphaStrikeArcStats } from '../../../../units.model';
import { WeaponEquipment } from '../../../../equipment.model';
import type { BaseEntity } from '../../../entities';
import type { EntityMountedWeapon } from '../../../types/equipment';
import { blocksExplosiveNullification } from '../specials/explosive-components';
import { alphaStrikeRoundUp, dualRoundedNormalDamage, dualRoundedUpDamage, roundUpToTenth, toStandardDamage } from './damage-rounding';
import { alphaStrikeWeaponHeatForConversion } from './heat-adjustment';
import { alphaStrikeHeatCapacityForEntity } from './heat-capacity';
import { LARGE_AEROSPACE_ARCS, largeAerospaceArcMultiplier } from './large-aerospace-location-mapper';
import { ZERO_DAMAGE, type AlphaStrikeArcName, type AlphaStrikeDamage, type RawDamageVector } from './damage-types';
import {
  alphaStrikeWeaponConversionMetadata,
  battleForceDamageForMount,
  type AlphaStrikePrimaryDamageClass,
  type AlphaStrikeRangeIndex,
} from './weapon-damage-profile';

const PRIMARY_CLASSES: readonly AlphaStrikePrimaryDamageClass[] = ['STD', 'CAP', 'SCAP', 'MSL'];

export interface LargeAerospaceDamageResult {
  readonly standard: AlphaStrikeDamage;
  readonly overheat: 0;
  readonly arcs: Record<AlphaStrikeArcName, AlphaStrikeArcStats>;
  readonly heatAdjustmentFactor: number;
}

/** Converts mutually exclusive large-aerospace damage classes and arc weapon abilities. */
export function calculateLargeAerospaceDamage(entity: BaseEntity): LargeAerospaceDamageResult {
  const weapons = entity.mountedWeapons();
  const heatAdjustmentFactor = largeAerospaceHeatAdjustmentFactor(entity, weapons);
  const targetingComputer = entity.equipment().some(mount =>
    mount.equipment?.hasFlag('F_TARGETING_COMPUTER'));
  const arcs = Object.fromEntries(LARGE_AEROSPACE_ARCS.map(arc => [arc,
    calculateArc(entity, arc, weapons, heatAdjustmentFactor, targetingComputer),
  ])) as Record<AlphaStrikeArcName, AlphaStrikeArcStats>;
  return { standard: { ...ZERO_DAMAGE }, overheat: 0, arcs, heatAdjustmentFactor };
}

export function largeAerospaceHeatAdjustmentFactor(
  entity: BaseEntity,
  weapons: readonly EntityMountedWeapon[] = entity.mountedWeapons(),
): number {
  const equipment = entity.equipment();
  const capacity = alphaStrikeHeatCapacityForEntity(entity, entity.heatCapacity(false));
  const signatureHeat = equipment.some(mount => mount.equipment?.hasFlag('F_STEALTH')) ? 10 : 0;
  const weaponHeat = weapons.reduce((sum, mount) => {
    const weapon = mount.equipment;
    // ASArcedDamageConverter counts one-shot weapon heat.
    return sum + alphaStrikeWeaponHeatForConversion(weapon, true);
  }, 0);
  const totalHeat = signatureHeat + weaponHeat;
  return totalHeat - 4 > capacity ? capacity / (totalHeat - 4) : 1;
}

function calculateArc(
  entity: BaseEntity,
  arc: AlphaStrikeArcName,
  weapons: readonly EntityMountedWeapon[],
  heatFactor: number,
  targetingComputer: boolean,
): AlphaStrikeArcStats {
  const vectors = new Map<AlphaStrikePrimaryDamageClass | 'FLK' | 'PNT', RawDamageVector>([
    ...PRIMARY_CLASSES.map(kind => [kind, [0, 0, 0, 0] as RawDamageVector] as const),
    ['FLK', [0, 0, 0, 0]],
    ['PNT', [0, 0, 0, 0]],
  ]);
  const artilleryCounts = new Map<string, number>();
  const weaponArcSUAs = new Set<string>();
  for (const mount of weapons) {
    const locationMultiplier = largeAerospaceArcMultiplier(entity, arc, mount);
    if (locationMultiplier === 0) continue;
    const weapon = mount.equipment;
    const metadata = alphaStrikeWeaponConversionMetadata(weapon);
    if (metadata.artillerySUA) {
      artilleryCounts.set(metadata.artillerySUA, (artilleryCounts.get(metadata.artillerySUA) ?? 0) + 1);
    }
    if (metadata.arcSUA) weaponArcSUAs.add(metadata.arcSUA);
    let damageMultiplier = locationMultiplier;
    if ((weapon.oneShotCount ?? 0) > 0 && weapon.id !== 'CLFussilade') damageMultiplier *= 0.1;
    if (targetingComputer && weapon.hasFlag('F_DIRECT_FIRE')) damageMultiplier *= 1.1;
    const damage = damageForMount(entity, mount, damageMultiplier * heatFactor);
    if (metadata.primaryClass) addDamage(vectors.get(metadata.primaryClass)!, damage);
    if (metadata.flak) addDamage(vectors.get('FLK')!, damage);
    if (metadata.pointDefense) {
      addDamage(vectors.get('PNT')!, weapon.hasFlag('F_AMS')
        ? [0.3 * damageMultiplier * heatFactor, 0, 0, 0]
        : damage);
    }
  }

  const specials: string[] = [];
  for (const [sua, count] of artilleryCounts) specials.push(`${sua}-${count}`);
  specials.push(...weaponArcSUAs);
  const flak = vectors.get('FLK')!;
  if (hasDamage(flak)) specials.push(`FLK${normalDamageVector(flak)}`);
  const pointDefense = vectors.get('PNT')![0];
  if (pointDefense > 0) specials.push(`PNT${alphaStrikeRoundUp(roundUpToTenth(pointDefense))}`);
  if (!hasExplosiveArcComponent(entity, arc)) specials.push('ENE');
  return {
    STD: toStandardDamage(vectors.get('STD')!),
    CAP: toStandardDamage(vectors.get('CAP')!),
    SCAP: toStandardDamage(vectors.get('SCAP')!),
    MSL: toStandardDamage(vectors.get('MSL')!),
    specials: specials.sort(),
  };
}

function hasExplosiveArcComponent(entity: BaseEntity, arc: AlphaStrikeArcName): boolean {
  return entity.equipment().some(mount => blocksExplosiveNullification(mount)
    && largeAerospaceArcMultiplier(entity, arc, mount as EntityMountedWeapon) > 0);
}

function damageForMount(
  entity: BaseEntity,
  mount: EntityMountedWeapon,
  multiplier: number,
): RawDamageVector {
  return [0, 1, 2, 3].map(index =>
    battleForceDamageForMount(entity, mount, index as AlphaStrikeRangeIndex) * multiplier,
  ) as RawDamageVector;
}

function addDamage(target: RawDamageVector, source: RawDamageVector): void {
  for (let index = 0; index < target.length; index++) target[index] += source[index];
}

function hasDamage(vector: RawDamageVector): boolean {
  return vector.some(value => value > 0);
}

function normalDamageVector(vector: RawDamageVector): string {
  return vector.map(value => value === 0 ? '-' : dualRoundedNormalDamage(value)).join('/');
}
