// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';
import { BUILDING_SIDE_LABELS } from '../../models/entity/types/building';
import { buildingDoorPoints } from '../../utils/building-map-presentation';

@Component({
  selector: 'construction-hex-sides',
  templateUrl: './construction-hex-sides.component.html',
  styleUrl: './construction-hex-sides.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ConstructionHexSidesComponent {
  readonly label = input.required<string>();
  readonly hexLabel = input('');
  readonly caption = input('Door');
  readonly selectedMask = input(0);
  readonly blockedMask = input(0);
  readonly disabled = input(false);
  readonly marker = input<'door' | 'wall'>('door');
  readonly sideSelected = output<number>();
  readonly sides = BUILDING_SIDE_LABELS;
  readonly doorPoints = buildingDoorPoints([-32, -55.426], [32, -55.426])
    .map(([x, y]) => `${x},${y}`)
    .join(' ');

  selected(side: number): boolean {
    return !!(this.selectedMask() & (1 << side));
  }

  blocked(side: number): boolean {
    return this.disabled() || (!!(this.blockedMask() & (1 << side)) && !this.selected(side));
  }

  select(side: number): void {
    if (!this.blocked(side)) this.sideSelected.emit(side);
  }
}
