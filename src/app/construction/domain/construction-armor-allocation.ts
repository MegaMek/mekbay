// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import type { BaseEntity } from '../../models/entity/base-entity';
import { AeroEntity, BattleArmorEntity, JumpShipEntity, MekEntity, ProtoMekEntity, SmallCraftEntity, VehicleEntity } from '../../models/entity/entities';
import type { LocationArmor } from '../../models/entity/types';
import { getConstructionMass, getConstructionMassCapacity } from './construction-factory';

/** Add armor to the existing allocation without exceeding installed construction mass. */
export function fillConstructionArmor(entity: BaseEntity): void {
  const original = entity.armorValues();
  const mass = getConstructionMass(entity);
  const capacity = getConstructionMassCapacity(entity);
  if (mass === null || !Number.isFinite(mass)) throw new Error('Resolve construction mass before filling armor.');
  if (mass > capacity) throw new Error('Remove excess weight before filling armor.');
  try {
    maximizeConstructionArmor(entity);
    const maximum = entity.armorValues();
    const target = new Map([...maximum].map(([location, armor]) => {
      const current = original.get(location) ?? { front: 0, rear: 0 };
      const room = Math.max(0, armor.front + armor.rear - current.front - current.rear);
      const front = Math.min(room, Math.max(0, armor.front - current.front));
      return [location, { front: current.front + front, rear: current.rear + Math.min(room - front, Math.max(0, armor.rear - current.rear)) }] as const;
    }));
    const candidate = (ratio: number) => new Map([...target].map(([location, armor]) => {
      const current = original.get(location) ?? { front: 0, rear: 0 };
      return [location, { front: current.front + Math.floor((armor.front - current.front) * ratio),
        rear: current.rear + Math.floor((armor.rear - current.rear) * ratio) }] as const;
    }));
    const fits = (allocation: Map<string, LocationArmor>) => {
      entity.armorValues.set(allocation);
      const value = getConstructionMass(entity);
      return value !== null && Number.isFinite(value) && value <= capacity + 1e-8
        && entity.totalArmorPoints() <= entity.maximumArmorPoints();
    };
    let best = new Map(original);
    let low = 0, high = 1;
    if (fits(candidate(1))) best = candidate(1);
    else for (let i = 0; i < 32; i++) {
      const ratio = (low + high) / 2;
      const next = candidate(ratio);
      if (fits(next)) { best = next; low = ratio; } else high = ratio;
    }
    // Use remaining capacity even when a heavier patchwork facing can no longer grow.
    for (const [location, maximum] of target) for (const face of ['front', 'rear'] as const) {
      const current = best.get(location) ?? { front: 0, rear: 0 };
      let low = 0, high = Math.floor(maximum[face] - current[face]);
      while (low < high) {
        const amount = Math.ceil((low + high) / 2);
        const next = new Map(best).set(location, { ...current, [face]: current[face] + amount });
        if (fits(next)) low = amount; else high = amount - 1;
      }
      best.set(location, { ...current, [face]: current[face] + low });
    }
    entity.armorValues.set(best);
  } catch (error) { entity.armorValues.set(original); throw error; }
}

/** Maximizes the native armor budget and allocates it using MegaMekLab's family proportions. */
export function maximizeConstructionArmor(entity: BaseEntity): void {
  const maximum = Math.max(0, Math.floor(entity.maximumArmorPoints()));
  if (entity instanceof BattleArmorEntity) {
    entity.armorValues.set(new Map([['Squad', { front: maximum / Math.max(1, entity.trooperCount()), rear: 0 }]]));
    return;
  }
  const result = new Map<string, LocationArmor>(entity.armorLocations.map(location => [location, { front: 0, rear: 0 }]));
  const assign = (location: string, front: number, rear = 0) => {
    if (result.has(location)) result.set(location, { front, rear });
  };
  if (entity instanceof MekEntity || entity instanceof ProtoMekEntity) {
    for (const location of entity.armorLocations) {
      const total = entity.maxArmorValues().get(location) ?? 0;
      const rear = entity.hasRearArmor(location) ? Math.floor(total * .25) : 0;
      assign(location, total - rear, rear);
    }
  } else if (entity instanceof VehicleEntity) {
    const rotor = result.has('Rotor') ? Math.min(2, maximum) : 0;
    assign('Rotor', rotor);
    const locations = entity.armorLocations.filter(location => location !== 'Rotor');
    const points = maximum - rotor;
    const share = 1 / Math.max(1, locations.length);
    let remaining = points;
    for (const location of locations) {
      const amount = Math.floor(points * share * (location === 'Front' ? 1.2 : location === 'Rear' ? .8 : 1));
      assign(location, amount);
      remaining -= amount;
    }
    assign('Front', (result.get('Front')?.front ?? 0) + remaining);
  } else if (entity instanceof JumpShipEntity) {
    let bonus = Math.round(entity.structuralIntegrity() / 10) * 6;
    if (entity.driveCoreType() === 'Primitive') bonus = Math.floor(bonus * .66);
    const perFace = Math.floor(bonus / 6);
    const points = Math.max(0, maximum - perFace * 6);
    let nose = Math.floor(points * .22);
    let fore = Math.floor(points * .18);
    const aftSide = Math.floor(points * .16);
    const aft = Math.floor(points * .10);
    const remainder = points - nose - fore * 2 - aftSide * 2 - aft;
    if (remainder >= 2) fore++;
    nose += remainder === 1 ? 1 : remainder >= 3 ? remainder - 2 : 0;
    assign('Nose', nose + perFace); assign('FLS', fore + perFace); assign('FRS', fore + perFace);
    assign('ALS', aftSide + perFace); assign('ARS', aftSide + perFace); assign('Aft', aft + perFace);
  } else if (entity instanceof AeroEntity) {
    let bonus = entity instanceof SmallCraftEntity ? entity.structuralIntegrity() * 4 : 0;
    if (entity.uniformArmor()?.type === 'PRIMITIVE_AERO') bonus = Math.floor(bonus * .66);
    const perFace = Math.floor(bonus / 4);
    const points = Math.max(0, maximum - perFace * 4);
    let nose = Math.floor(points * .3);
    let wing = Math.floor(points * .25);
    const aft = Math.floor(points * .2);
    const remainder = points - nose - wing * 2 - aft;
    if (remainder % 2) nose++;
    if (remainder >= 2) wing++;
    const left = entity instanceof SmallCraftEntity ? 'Left Side' : 'Left Wing';
    const right = entity instanceof SmallCraftEntity ? 'Right Side' : 'Right Wing';
    assign('Nose', nose + perFace); assign(left, wing + perFace);
    assign(right, wing + perFace); assign('Aft', aft + perFace);
  } else {
    // Families without an armor construction budget (infantry and static weapons) stay unarmored.
    for (const location of entity.armorLocations) assign(location, entity.maxArmorValues().get(location) ?? 0);
  }
  entity.armorValues.set(result);
}
