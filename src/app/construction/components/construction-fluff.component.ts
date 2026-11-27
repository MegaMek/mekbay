// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
import { ChangeDetectionStrategy, Component, computed, DestroyRef, inject, input, output, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { normalizeUnitImage } from '../../utils/unit-artwork.util';
import type { BaseEntity } from '../../models/entity/base-entity';
import type { EntityFluff } from '../../models/entity/types/common';
import { AeroEntity, InfantryEntity, SmallCraftEntity, JumpShipEntity } from '../../models/entity/entities';

type FluffTextField = Exclude<keyof EntityFluff, 'systemManufacturers' | 'systemModels'>;

@Component({
  selector: 'construction-fluff',
  imports: [FormsModule],
  templateUrl: './construction-fluff.component.html',
  styleUrl: './construction-fluff.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ConstructionFluffComponent {
  readonly entity = input.required<BaseEntity>();
  private readonly destroyRef = inject(DestroyRef);
  readonly editRequested = output<() => void>();
  readonly textEditable = input(true);
  readonly disabled = input(false);
  readonly imageUrl = input<string | null>(null);
  readonly hasCustomImage = input(false);
  readonly imageChange = output<Blob | null>();
  readonly imageError = signal('');
  readonly loadingImage = signal(false);

  async chooseImage(event: Event): Promise<void> {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (!file || this.disabled() || this.loadingImage()) return;
    this.loadingImage.set(true);
    this.imageError.set('');
    const entity = this.entity();
    try {
      const image = await normalizeUnitImage(file);
      if (!this.destroyRef.destroyed && entity === this.entity()) this.imageChange.emit(image);
    } catch (error) {
      this.imageError.set(error instanceof Error ? error.message : String(error));
    } finally {
      this.loadingImage.set(false);
    }
  }

  readonly hasSystems = computed(() => !(this.entity() instanceof InfantryEntity));
  readonly spacecraft = computed(
    () => this.entity() instanceof SmallCraftEntity || this.entity() instanceof JumpShipEntity,
  );
  readonly narratives: readonly { key: FluffTextField; label: string }[] = [
    { key: 'overview', label: 'Overview' },
    { key: 'capabilities', label: 'Capabilities' },
    { key: 'deployment', label: 'Deployment' },
    { key: 'history', label: 'History' },
    { key: 'notes', label: 'Notes' },
  ];
  readonly dimensions: readonly { key: FluffTextField; label: string }[] = [
    { key: 'use', label: 'Use' },
    { key: 'length', label: 'Length' },
    { key: 'width', label: 'Width' },
    { key: 'height', label: 'Height' },
  ];
  readonly systems = computed(() =>
    [
      { key: 'CHASSIS', label: 'Chassis' },
      { key: 'ENGINE', label: 'Engine' },
      { key: 'ARMOR', label: 'Armor' },
      { key: 'JUMP_JET', label: 'Jump jets' },
      { key: 'COMMUNICATIONS', label: 'Communications' },
      { key: 'TARGETING', label: 'Targeting' },
    ].filter((system) => system.key !== 'JUMP_JET' || !(this.entity() instanceof AeroEntity)),
  );

  setText(key: FluffTextField, value: string): void {
    // Native MTF prose is one HTML-capable line per field. Keep paragraphs within that line.
    const text = value.replace(/\r\n|\r|\n/g, '<br/>');
    this.editRequested.emit(() => this.entity().fluff.update((fluff) => ({ ...fluff, [key]: text })));
  }

  textValue(key: FluffTextField): string {
    return (this.entity().fluff()[key] ?? '').replace(/<br\s*\/?\s*>/gi, '\n');
  }

  setSystem(field: 'systemManufacturers' | 'systemModels', key: string, value: string): void {
    this.editRequested.emit(() =>
      this.entity().fluff.update((fluff) => ({ ...fluff, [field]: { ...fluff[field], [key]: value } })),
    );
  }
}
