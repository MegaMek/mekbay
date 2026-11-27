// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import type { StaticEmplacementEntity } from '../../entities/misc/static-emplacement-entity';
import { calculateBuildingWeightBreakdown } from '../weight/building-weight';
import { amount, buildCostReport, multiplier, type EntityCostEntry } from './cost-report';
import { buildingHexKey } from '../../types/building';
import { MOBILE_POWER_SYSTEMS } from '../../entities/misc/mobile-structure-rules';

/** TO:AR p. 208. The CF multiplier applies to the whole installed design. */
export function calculateBuildingCostReport(entity: StaticEmplacementEntity, equipment: readonly EntityCostEntry[]) {
  const rates: Readonly<Record<number, number>> = { 0: 10000, 1: 8000, 2: 20000, 3: 20000,
    4: 1000000, 5: 1000, 6: 5000, 7: 800, 8: 12000 };
  const rate = entity.buildingType() === 5 ? 5000 : rates[entity.buildingClass() ?? 0] ?? 10000;
  const cf = entity.constructionFactor() ?? 0;
  const weights = calculateBuildingWeightBreakdown(entity);
  const options = entity.buildingOptions();
  const structureMultiplier = (entity.hasEnvironmentalSealing() ? 1.5 : 1) * (options.heavyMetal ? 1.25 : 1)
    * (options.ceiling === 'STANDARD' ? 1 : 1.1) * (options.openSpace ? 2.5 : 1)
    * (options.site === 'SURFACE' ? 1 : 5) * (options.tunnel ? 1.875 : 1);
  const segments = entity.coordinates().reduce((sum, hex) => sum + entity.segmentsInHex(hex), 0);
  const mobile = entity.mobileSystems();
  const motiveRate = entity.motiveType() === 'Tracked' ? 10000 : entity.motiveType() === 'VTOL' ? 40000
    : entity.motiveType() === 'Naval' ? 20000 : 35000;
  return buildCostReport([
    amount('Structure', rate * cf * (entity.height() ?? 1) * segments * structureMultiplier),
    amount('Armor', weights.armor * (entity.techBase() === 'Clan' ? 15000 : 10000)),
    ...(entity.isMobile() ? [amount('Power system', mobile.power * MOBILE_POWER_SYSTEMS[entity.mobilePowerSystem()].cost),
      amount('Motive system', motiveRate * cf * entity.originalWalkMP() * entity.coordinates().length),
      amount('Fuel storage', mobile.fuel * 100)] : []),
    amount('Power Amplifiers', weights.powerAmplifiers * 20000),
    amount('Turret Mechanisms', weights.turret * 5000 + weights.pintle * 1000),
    amount('Doors', entity.doors().reduce((sum, door) => sum + door.height * 10000, 0)),
    amount('Elevators', weights.elevators * 15000),
    amount('Weapon automation', entity.equipment().filter(mount => entity.equipmentDesign().get(mount.mountId)?.automated)
      .reduce((sum, mount) => sum + (mount.getTonnage(entity) ?? 0) * 1000, 0)),
    amount('Unspecified equipment space', new Set(entity.equipment().filter(mount => mount.equipmentId === 'Unspecified Building Equipment')
      .flatMap(mount => entity.equipmentPositions(mount).map(position => buildingHexKey(position.hex)))).size * cf * 5000),
    ...equipment,
    multiplier('CF multiplier', 1 + cf * entity.cfScale() / 100),
  ]);
}
