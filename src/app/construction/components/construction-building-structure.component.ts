// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import { ChangeDetectionStrategy, Component, computed, input, output } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { StaticEmplacementEntity } from '../../models/entity/entities/misc/static-emplacement-entity';
import { setConstructionBuildingTopology } from '../domain/construction-building-topology';
import { setConstructionArmor } from '../domain/construction-rules';

@Component({
  selector: 'construction-building-structure',
  imports: [FormsModule],
  templateUrl: './construction-building-structure.component.html',
  styleUrl: './construction-building-structure.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ConstructionBuildingStructureComponent {
  readonly entity = input.required<StaticEmplacementEntity>();
  readonly disabled = input(false);
  readonly editRequested = output<() => void>();
  readonly unlimitedLength = computed(() => this.entity().limits()?.hexes === Infinity);

  setHeight(value: number | null): void {
    if (value === null) return;
    this.editRequested.emit(() => setConstructionBuildingTopology(this.entity(), this.entity().coordinates(), value));
  }

  setBaseLevel(value: number | null): void {
    if (value === null || !Number.isInteger(value) || value < -2147483648 || value > 2147483647) return;
    this.editRequested.emit(() =>
      this.entity().buildingOptions.update((options) => ({ ...options, baseLevel: value })),
    );
  }

  setAutomaticBaseLevel(automatic: boolean): void {
    this.editRequested.emit(() =>
      this.entity().buildingOptions.update((options) => ({
        ...options,
        baseLevel: automatic ? null : this.entity().baseLevel(),
      })),
    );
  }

  setArmor(value: number | null): void {
    if (value !== null)
      this.editRequested.emit(() => setConstructionArmor(this.entity(), this.entity().armorLocations[0], value));
  }
}
