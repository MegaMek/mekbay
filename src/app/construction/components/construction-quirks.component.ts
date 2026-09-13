// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
import { ChangeDetectionStrategy, Component, computed, inject, input, output, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import type { BaseEntity } from '../../models/entity/base-entity';
import type { EntityQuirk, EntityWeaponQuirk } from '../../models/entity/types/common';
import type { EntityMountedEquipment } from '../../models/entity/types/equipment';
import { QuirksCatalogService } from '../../services/catalogs/quirks-catalog.service';
import { QuirkBadgeComponent } from '../../components/quirk-badge/quirk-badge.component';
import { constructionQuirkApplies } from '../domain/construction-quirk-rules';
import { canAssignWeaponQuirks, canHaveWeaponQuirks, constructionWeaponQuirkApplies } from '../domain/construction-weapon-quirks';
import { WEAPON_QUIRKS, weaponQuirkAddress, weaponQuirkDefinition, weaponQuirkMount } from '../../models/entity/utils/weapon-quirks';

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
    readonly selectedMountId = signal('');
    readonly weapons = computed(() => this.entity().equipment().filter(canHaveWeaponQuirks));
    readonly selectedWeapon = computed<EntityMountedEquipment | undefined>(() => this.weapons().find(mount => mount.mountId === this.selectedMountId()) ?? this.weapons()[0]);
    readonly available = computed(() => {
        const used = new Set(this.entity().quirks().map(entry => entry.quirk.key));
        const query = this.query().trim().toLocaleLowerCase();
        return [...this.catalog.getQuirksByKey().values()]
            .filter(quirk => !used.has(quirk.key) && quirk.name.toLocaleLowerCase().includes(query) && constructionQuirkApplies(this.entity(), quirk.key))
            .sort((a, b) => a.name.localeCompare(b.name));
    });
    readonly selectedWeaponQuirks = computed(() => this.entity().weaponQuirks().filter(entry =>
        weaponQuirkMount(this.entity(), entry)?.mountId === this.selectedWeapon()?.mountId));
    readonly unmatchedWeaponQuirks = computed(() => this.entity().weaponQuirks().filter(entry => !weaponQuirkMount(this.entity(), entry)));
    readonly availableWeaponQuirks = computed(() => {
        const mount = this.selectedWeapon();
        if (!mount) return [];
        const used = new Set(this.selectedWeaponQuirks().map(entry => entry.name));
        const query = this.weaponQuery().trim().toLocaleLowerCase();
        return WEAPON_QUIRKS.filter(quirk => !used.has(quirk.key) && quirk.name.toLocaleLowerCase().includes(query)
            && constructionWeaponQuirkApplies(this.entity(), mount, quirk.key));
    });
    readonly canAssignWeapon = computed(() => {
        const mount = this.selectedWeapon();
        return !!mount && canAssignWeaponQuirks(this.entity(), mount);
    });
    readonly definition = weaponQuirkDefinition;

    hasValue(entry: EntityQuirk): boolean {
        return entry.value !== undefined || ['obsolete', 'directional_torso_mount', 'directional_torso_mount_360'].includes(entry.quirk.key);
    }
    addQuirk(key: string): void {
        const quirk = this.catalog.getQuirkByKey(key);
        if (!quirk || !constructionQuirkApplies(this.entity(), key)) return;
        this.editRequested.emit(() => this.entity().quirks.update(rows => rows.some(row => row.quirk.key === key) ? rows : [...rows, { quirk }]));
    }
    removeQuirk(entry: EntityQuirk): void {
        this.editRequested.emit(() => this.entity().quirks.update(rows => rows.filter(row => row.quirk.key !== entry.quirk.key)));
    }
    setQuirkValue(entry: EntityQuirk, value: string): void {
        this.editRequested.emit(() => this.entity().quirks.update(rows => rows.map(row => row.quirk.key === entry.quirk.key ? { quirk: row.quirk, value: value || undefined } : row)));
    }
    addWeaponQuirk(key: string): void {
        const mount = this.selectedWeapon();
        if (!mount || !this.canAssignWeapon() || !this.availableWeaponQuirks().some(quirk => quirk.key === key)) return;
        this.editRequested.emit(() => this.entity().weaponQuirks.update(rows => [...rows, { name: key, ...weaponQuirkAddress(this.entity(), mount) }]));
    }
    removeWeaponQuirk(entry: EntityWeaponQuirk): void {
        this.editRequested.emit(() => this.entity().weaponQuirks.update(rows => rows.filter(row => row !== entry)));
    }
}
