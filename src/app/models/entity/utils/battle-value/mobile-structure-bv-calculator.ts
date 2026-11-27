// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import type { StaticEmplacementEntity } from '../../entities/misc/static-emplacement-entity';
import { buildingLocationName } from '../../types/building';
import { BVCalculator } from './bv-calculator';
import { offensiveSpeedFactor } from './rules';

/** TO:AUE p. 191. Protection is counted once per hex; weapons have no facing discount. */
export class MobileStructureBVCalculator extends BVCalculator {
  declare readonly entity: StaticEmplacementEntity;

  protected override processDefensiveValue(): void {
    this.processArmor();
    this.processStructure();
    this.processDefensiveEquipment();
    const before = this.defensiveValue;
    this.defensiveValue *= .5;
    this.addValueLine('Mobile Structure modifier', `${this.format(before)} x 0.5`, before);
  }

  protected override processArmor(): void {
    const before = this.defensiveValue;
    const armor = this.entity.coordinates().reduce((total, hex) => {
      const location = buildingLocationName(hex, 0);
      return total + (this.state?.armorRemaining(location, 'front') ?? this.entity.getArmorValue(location));
    }, 0);
    this.defensiveValue += armor * 2.5;
    this.addValueLine('Armor', `${armor} x 2.5`, before);
  }

  protected override processStructure(): void {
    const before = this.defensiveValue;
    const cf = this.entity.coordinates().reduce((total, hex) => total
      + (this.state?.structureRemaining(buildingLocationName(hex, 0)) ?? this.entity.constructionFactor() ?? 0), 0);
    this.defensiveValue += cf * 1.5;
    this.addValueLine('Construction Factor', `${cf} x 1.5`, before);
  }

  protected override processWeight(): void {
    const before = this.offensiveValue;
    this.offensiveValue += this.entity.coordinates().length * 50;
    this.addValueLine('Mobile Structure hexes', `+ ${this.entity.coordinates().length} x 50`, before);
  }

  protected override processSpeedFactor(): void {
    const before = this.offensiveValue;
    const factor = offensiveSpeedFactor(this.entity.originalWalkMP());
    this.offensiveValue *= factor;
    this.addValueLine('Maximum MP speed factor', `${this.format(before)} x ${factor}`, before);
  }
}
