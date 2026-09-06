// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import { UnitNameService } from '../../services/unit-name.service';
import { Component, ChangeDetectionStrategy, inject, input, signal, effect, computed, DestroyRef } from '@angular/core';

import { SpriteStorageService, type SpriteIconInfo } from '../../services/sprite-storage.service';
import type { UnitSummary } from '../../models/unit-summary.model';
import { BaseEntity } from '../../models/entity/base-entity';
import { MM_DATA_UNIT_PROVIDER_ID } from '../../services/unit-catalog/unit-catalog.types';
import { resolveUnitSpritePath } from '../../utils/unit-sprite-resolver';

interface SpriteData {
  url: string;
  info: SpriteIconInfo;
}

// Default sprite dimensions (used before sprite loads)
const DEFAULT_WIDTH = 84;
const DEFAULT_HEIGHT = 72;

@Component({
  selector: 'unit-icon',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="icon-container"
         [class]="styleClass()"
         [style.width.px]="containerWidth()"
         [style.height.px]="containerHeight()">
      @if (spriteData(); as sprite) {
        <div class="sprite"
             [style.width.px]="sprite.info.w"
             [style.height.px]="sprite.info.h"
             [style.background-image]="'url(' + sprite.url + ')'"
             [style.background-position]="'-' + sprite.info.x + 'px -' + sprite.info.y + 'px'"
             [style.transform]="'scale(' + scale() + ')'">
        </div>
      } @else if (!isLoading()) {
        <img [src]="FALLBACK" [alt]="displayAlt()" draggable="false">
      }
    </div>
  `,
  styles: [`
    .icon-container {
      display: flex;
      align-items: center;
      justify-content: center;
      overflow: hidden;
    }
    .sprite {
      flex-shrink: 0;
      background-repeat: no-repeat;
      transform-origin: center;
    }
    img { 
      max-height: 100%; 
      max-width: 100%; 
      object-fit: contain; 
    }
  `]
})
export class UnitIconComponent {
    readonly unitNames = inject(UnitNameService);
  private spriteService = inject(SpriteStorageService);
  private destroyed = false;
  
  isLoading = this.spriteService.loading;
  
  // Inputs
  unit = input<UnitSummary | BaseEntity | undefined | null>(null);
  alt = input<string | undefined>(undefined);
  styleClass = input<string>('');
  
  /** Square size shorthand (sets both width and height) */
  size = input<number | undefined>(undefined);
  /** Container width in pixels */
  width = input<number | undefined>(undefined);
  /** Container height in pixels */
  height = input<number | undefined>(undefined);

  protected readonly FALLBACK = '/images/unknown.png';
  
  spriteData = signal<SpriteData | null>(null);

  private unitLabel = computed(() => {
    const u = this.unit();
    if (!u) return '';
    return this.unitNames.name(u);
  });

  displayAlt = computed(() => this.alt() || this.unitLabel());

  /** Container width: explicit input or sprite's natural width */
  containerWidth = computed(() => {
    const w = this.width() ?? this.size();
    if (w !== undefined) return w;
    return this.spriteData()?.info.w ?? DEFAULT_WIDTH;
  });

  /** Container height: explicit input or sprite's natural height */
  containerHeight = computed(() => {
    const h = this.height() ?? this.size();
    if (h !== undefined) return h;
    return this.spriteData()?.info.h ?? DEFAULT_HEIGHT;
  });

  /** Scale factor to contain sprite within container */
  scale = computed(() => {
    const sprite = this.spriteData();
    if (!sprite) return 1;
    
    const cw = this.containerWidth();
    const ch = this.containerHeight();
    
    // Contain: scale to fit entirely within container
    return Math.min(cw / sprite.info.w, ch / sprite.info.h);
  });

  constructor() {
    inject(DestroyRef).onDestroy(() => {
      this.destroyed = true;
    });
    
    effect(() => {
      const unit = this.unit();
      const loading = this.isLoading();

      if (!unit || loading) {
        this.spriteData.set(null);
        return;
      }
      if (unit instanceof BaseEntity) {
        this.spriteService.getVerifiedAssignmentContext(MM_DATA_UNIT_PROVIDER_ID)
          .then(context => this.loadPath(
            resolveUnitSpritePath(unit, context?.assignments),
            unit,
          ))
          .catch(() => this.spriteData.set(null));
        return;
      }
      this.loadPath(unit.icon, unit);
    });
  }

  private loadPath(path: string, expectedUnit: UnitSummary | BaseEntity): void {
    if (!path || this.destroyed || this.unit() !== expectedUnit) {
      this.spriteData.set(null);
      return;
    }
    const cached = this.spriteService.getCachedSpriteInfo(path);
    if (cached) {
      this.spriteData.set(cached);
      return;
    }
    this.spriteService.getSpriteInfo(path).then(info => {
      if (this.destroyed || this.unit() !== expectedUnit) return;
      this.spriteData.set(info);
    }).catch(() => {
      if (this.unit() === expectedUnit) this.spriteData.set(null);
    });
  }
}
