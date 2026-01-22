import { Component, ChangeDetectionStrategy, inject, input, signal, effect, computed } from '@angular/core';

import { SpriteStorageService, SpriteIconInfo } from '../../services/sprite-storage.service';
import { Unit } from '../../models/units.model';

interface SpriteData {
  url: string;
  info: SpriteIconInfo;
}

// Default sprite dimensions (used before sprite loads)
const DEFAULT_WIDTH = 84;
const DEFAULT_HEIGHT = 72;

@Component({
  selector: 'unit-icon',
  standalone: true,
  imports: [],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="icon-container"
         [class]="styleClass()"
         [style.width.px]="containerWidth()"
         [style.height.px]="containerHeight()"
         [title]="displayTitle()">
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
  private spriteService = inject(SpriteStorageService);
  
  isLoading = this.spriteService.loading;
  
  // Inputs
  unit = input<Unit | undefined | null>(null);
  alt = input<string | undefined>(undefined);
  title = input<string | undefined>(undefined);
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
    return u ? `${u.chassis || ''} ${u.model || ''}`.trim() : '';
  });

  displayAlt = computed(() => this.alt() || this.unitLabel());
  displayTitle = computed(() => this.title() || this.unitLabel());

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
    effect(() => {
      const path = this.unit()?.icon;
      const loading = this.isLoading();

      if (!path || loading) {
        this.spriteData.set(null);
        return;
      }

      // Try synchronous cache first (hot path)
      const cached = this.spriteService.getCachedSpriteInfo(path);
      if (cached) {
        this.spriteData.set(cached);
        return;
      }

      // Fallback to async load
      this.spriteService.getSpriteInfo(path).then(info => {
        this.spriteData.set(info);
      }).catch(() => {
        this.spriteData.set(null);
      });
    });
  }
}