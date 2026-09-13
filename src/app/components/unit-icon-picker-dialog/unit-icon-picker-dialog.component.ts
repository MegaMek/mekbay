// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import { ChangeDetectionStrategy, Component, PendingTasks, computed, inject, signal } from '@angular/core';
import { DIALOG_DATA, DialogRef } from '@angular/cdk/dialog';
import { SpriteStorageService, type SpriteManifest } from '../../services/sprite-storage.service';
import { UnitIconComponent } from '../unit-icon/unit-icon.component';
import { scrollToInitialPickerSelection } from '../image-picker-dialog';
import type { BaseEntity } from '../../models/entity/base-entity';
import { getUnitSpriteTypes } from '../../utils/unit-sprite-assignment-resolver';

export interface UnitIconPickerDialogData {
  readonly unit: BaseEntity;
}

@Component({
  selector: 'unit-icon-picker-dialog',
  imports: [UnitIconComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'fullscreen-dialog-host glass' },
  template: `
    <div class="wide-dialog">
      <h2 class="wide-dialog-title">Select Unit Icon</h2>
      <div class="picker-controls">
        <input
          class="bt-input"
          type="search"
          aria-label="Search unit icons"
          placeholder="Search icons…"
          [value]="search()"
          (input)="search.set($any($event.target).value)"
        />
      </div>
      <div class="wide-dialog-body">
        @if (loading()) {
          <p role="status">Loading icons…</p>
        } @else if (error()) {
          <p role="alert">Icons could not be loaded. Please try again.</p>
          <button class="bt-button" type="button" (click)="load(true)">RETRY</button>
        } @else {
          @for (category of categories(); track category.name) {
            <section class="category">
              <button
                class="category-title"
                type="button"
                [id]="'icon-category-' + $index"
                [attr.aria-expanded]="isOpen(category.name)"
                [attr.aria-controls]="'icon-choices-' + $index"
                (click)="toggleCategory(category.name)"
              >
                <span class="chevron" [class.collapsed]="!isOpen(category.name)" aria-hidden="true"></span>
                <span>{{ category.name }}</span
                ><span class="count">{{ category.paths.length }}</span>
              </button>
              @if (isOpen(category.name)) {
                <div
                  class="picker-grid"
                  [id]="'icon-choices-' + $index"
                  role="group"
                  [attr.aria-labelledby]="'icon-category-' + $index"
                >
                  @for (path of category.paths; track path) {
                    <button
                      class="icon-choice picker-choice"
                      type="button"
                      [class.selected]="iconPath === path"
                      [attr.aria-label]="path"
                      [attr.aria-pressed]="iconPath === path"
                      [title]="path"
                      (click)="dialogRef.close(path)"
                    >
                      <unit-icon [iconPath]="path" [width]="84" [height]="72" />
                    </button>
                  }
                </div>
              }
            </section>
          } @empty {
            <p role="status">No icons match your search.</p>
          }
        }
      </div>
      @if (!iconPath) {
        <p class="hint">The icon is selected automatically based on the unit name and type.</p>
      }
      <div class="wide-dialog-actions">
        <button class="bt-button automatic-choice" type="button" (click)="dialogRef.close(null)">AUTOMATIC PICK</button>
        <button class="bt-button" type="button" (click)="dialogRef.close()">DISMISS</button>
      </div>
    </div>
  `,
  styleUrl: '../image-picker-dialog.scss',
  styles: `
    :host {
      --choice-width: 92px;
    }
    .picker-controls {
      display: grid;
      padding: 0 20px 12px;
    }
    .hint {
      font-size: 0.85em;
      color: var(--bt-yellow);
      margin: 0 0 8px;
      text-align: center;
      flex-shrink: 0;
    }
  `,
})
export class UnitIconPickerDialogComponent {
  readonly data = inject<UnitIconPickerDialogData>(DIALOG_DATA);
  readonly iconPath = this.data.unit.iconPath();
  private readonly spriteTypes = getUnitSpriteTypes(this.data.unit.entityType);
  readonly dialogRef = inject(DialogRef<string | null>);
  private readonly sprites = inject(SpriteStorageService);
  private readonly manifest = signal<SpriteManifest | null>(null);
  readonly loading = signal(true);
  readonly error = signal(false);
  readonly search = signal('');
  readonly openCategories = signal<ReadonlySet<string>>(new Set());
  readonly categories = computed(() => {
    const query = this.search().trim().toLowerCase();
    const selected = this.iconPath || this.sprites.resolveIconPath(this.data.unit);
    const preferredCategory = selected.slice(0, selected.lastIndexOf('/'));
    const groups = new Map<string, string[]>();
    for (const [path, icon] of Object.entries(this.manifest()?.icons ?? {})) {
      if (!this.spriteTypes.includes(icon.type) || path.toLowerCase().startsWith('defaults/')) continue;
      if (query && !path.toLowerCase().includes(query)) continue;
      const category = path.slice(0, path.lastIndexOf('/')) || 'Other';
      const paths = groups.get(category) ?? [];
      paths.push(path);
      groups.set(category, paths);
    }
    return [...groups]
      .sort(
        ([a], [b]) =>
          Number(b === preferredCategory) - Number(a === preferredCategory) ||
          Number(b === this.spriteTypes[0]) - Number(a === this.spriteTypes[0]) ||
          a.localeCompare(b),
      )
      .map(([name, paths]) => ({
        name,
        paths: paths.sort((a, b) => a.localeCompare(b, undefined, { numeric: true })),
      }));
  });

  constructor() {
    if (this.iconPath) scrollToInitialPickerSelection(() => !this.loading() && !this.error());
    void inject(PendingTasks).run(() => this.load());
  }

  async load(retry = false): Promise<void> {
    this.loading.set(true);
    this.error.set(false);
    try {
      if (retry) await this.sprites.reinitialize();
      const manifest = await this.sprites.getManifest();
      if (!manifest) throw new Error('No sprite manifest');
      this.manifest.set(manifest);
      this.openCategories.set(
        new Set(
          this.categories()
            .slice(0, 1)
            .map((category) => category.name),
        ),
      );
    } catch {
      this.error.set(true);
    } finally {
      this.loading.set(false);
    }
  }

  isOpen(category: string): boolean {
    return !!this.search().trim() || this.openCategories().has(category);
  }

  toggleCategory(category: string): void {
    const open = new Set(this.openCategories());
    if (!open.delete(category)) open.add(category);
    this.openCategories.set(open);
  }
}
