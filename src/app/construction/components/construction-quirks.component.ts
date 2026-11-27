// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
import { ChangeDetectionStrategy, Component, computed, inject, input, output, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import type { BaseEntity } from '../../models/entity/base-entity';
import type { EntityQuirk, EntityWeaponQuirk } from '../../models/entity/types/common';
import { QuirksCatalogService } from '../../services/catalogs/quirks-catalog.service';
import { QuirkBadgeComponent } from '../../components/quirk-badge/quirk-badge.component';
import { unitQuirkApplies } from '../../models/entity/utils/unit-quirks';
import {
  canAssignWeaponQuirks,
  canHaveWeaponQuirks,
  WEAPON_QUIRKS,
  weaponBayQuirkAddress,
  weaponQuirkAddress,
  weaponQuirkDefinition,
  weaponQuirkTarget,
  weaponQuirkTargetApplies,
  type WeaponQuirkTarget,
} from '../../models/entity/utils/weapon-quirks';

@Component({
  selector: 'construction-quirks',
  imports: [FormsModule, QuirkBadgeComponent],
  templateUrl: './construction-quirks.component.html',
  styleUrl: './construction-quirks.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ConstructionQuirksComponent {
  readonly entity = input.required<BaseEntity>();
  readonly editRequested = output<() => void>();
  private readonly catalog = inject(QuirksCatalogService);
  readonly query = signal('');
  readonly weaponQuery = signal('');
  readonly selectedTargetId = signal('');
  readonly targets = computed<{ id: string; label: string; target: WeaponQuirkTarget }[]>(() => [
    ...this.entity()
      .equipment()
      .filter(canHaveWeaponQuirks)
      .map((mount) => ({
        id: mount.mountId,
        label: `${mount.displayName()} · ${mount.location || 'Unallocated'}${mount.rearMounted ? ' (rear)' : ''}`,
        target: { kind: 'mount' as const, mount },
      })),
    ...this.entity()
      .equipmentBays()
      .filter((bay) => bay.kind === 'weapon-bay')
      .flatMap((bay) => {
        const address = weaponBayQuirkAddress(this.entity(), bay);
        return address
          ? [
              {
                id: `bay:${bay.weapons[0].mountId}`,
                label: `${address.weaponName} · ${address.location} ${address.slot + 1}`,
                target: { kind: 'bay' as const, bay },
              },
            ]
          : [];
      }),
  ]);
  readonly selectedTarget = computed<ReturnType<typeof this.targets>[number] | undefined>(
    () => this.targets().find((option) => option.id === this.selectedTargetId()) ?? this.targets()[0],
  );
  readonly available = computed(() => {
    const used = new Set(
      this.entity()
        .quirks()
        .map((entry) => entry.quirk.key),
    );
    const query = this.query().trim().toLocaleLowerCase();
    return [...this.catalog.getQuirksByKey().values()]
      .filter(
        (quirk) =>
          !used.has(quirk.key) &&
          quirk.name.toLocaleLowerCase().includes(query) &&
          unitQuirkApplies(this.entity(), quirk.key),
      )
      .sort((a, b) => a.name.localeCompare(b.name));
  });
  readonly selectedAssignments = computed(() => {
    const selected = this.selectedTarget()?.target;
    return this.entity()
      .weaponQuirks()
      .filter((entry) => {
        const target = weaponQuirkTarget(this.entity(), entry);
        return selected?.kind === 'bay'
          ? target?.kind === 'bay' && target.bay === selected.bay
          : selected?.kind === 'mount' && target?.kind === 'mount' && target.mount.mountId === selected.mount.mountId;
      });
  });
  readonly selectedWeaponQuirks = computed(() => {
    const active = new Set(this.entity().applicableWeaponQuirks());
    return this.selectedAssignments().filter((entry) => active.has(entry));
  });
  /** Stored but currently inapplicable assignments, shown greyed out after the active ones. */
  readonly suppressedQuirks = computed(() => {
    const active = new Set(
      this.entity()
        .applicableQuirks()
        .map((entry) => entry.quirk.key),
    );
    return this.entity()
      .quirks()
      .filter((entry) => !active.has(entry.quirk.key));
  });
  readonly suppressedWeaponQuirks = computed(() => {
    const active = new Set(this.entity().applicableWeaponQuirks());
    return this.selectedAssignments().filter((entry) => !active.has(entry));
  });
  readonly availableWeaponQuirks = computed(() => {
    const target = this.selectedTarget()?.target;
    if (!target) return [];
    const used = new Set(this.selectedAssignments().map((entry) => entry.name));
    const query = this.weaponQuery().trim().toLocaleLowerCase();
    return WEAPON_QUIRKS.filter(
      (quirk) =>
        !used.has(quirk.key) &&
        quirk.name.toLocaleLowerCase().includes(query) &&
        weaponQuirkTargetApplies(this.entity(), target, quirk.key),
    );
  });
  readonly canAssignWeapon = computed(() => {
    const target = this.selectedTarget()?.target;
    return target?.kind === 'bay'
      ? !!weaponBayQuirkAddress(this.entity(), target.bay)
      : !!target && canAssignWeaponQuirks(this.entity(), target.mount);
  });
  readonly definition = weaponQuirkDefinition;

  hasValue(entry: EntityQuirk): boolean {
    return (
      entry.value !== undefined ||
      ['obsolete', 'directional_torso_mount', 'directional_torso_mount_360'].includes(entry.quirk.key)
    );
  }
  addQuirk(key: string): void {
    const quirk = this.catalog.getQuirkByKey(key);
    if (!quirk || !unitQuirkApplies(this.entity(), key)) return;
    this.editRequested.emit(() =>
      this.entity().quirks.update((rows) => (rows.some((row) => row.quirk.key === key) ? rows : [...rows, { quirk }])),
    );
  }
  removeQuirk(entry: EntityQuirk): void {
    this.editRequested.emit(() =>
      this.entity().quirks.update((rows) => rows.filter((row) => row.quirk.key !== entry.quirk.key)),
    );
  }
  setQuirkValue(entry: EntityQuirk, value: string): void {
    this.editRequested.emit(() =>
      this.entity().quirks.update((rows) =>
        rows.map((row) => (row.quirk.key === entry.quirk.key ? { quirk: row.quirk, value: value || undefined } : row)),
      ),
    );
  }
  addWeaponQuirk(key: string): void {
    const target = this.selectedTarget()?.target;
    if (!target || !this.canAssignWeapon() || !this.availableWeaponQuirks().some((quirk) => quirk.key === key)) return;
    const address =
      target.kind === 'bay'
        ? weaponBayQuirkAddress(this.entity(), target.bay)
        : weaponQuirkAddress(this.entity(), target.mount);
    if (!address) return;
    this.editRequested.emit(() => this.entity().weaponQuirks.update((rows) => [...rows, { name: key, ...address }]));
  }
  removeWeaponQuirk(entry: EntityWeaponQuirk): void {
    this.editRequested.emit(() => this.entity().weaponQuirks.update((rows) => rows.filter((row) => row !== entry)));
  }
}
