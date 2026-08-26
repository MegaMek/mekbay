// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import { ChangeDetectionStrategy, Component, inject, input, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { AmmoEquipment } from '../../models/equipment.model';
import type { EquipmentStatus } from '../../models/equipment-status.model';
import type { EquipmentPanelComponent } from '../../models/runtime/equipment-panel';
import { SetAmmoDialogComponent, type SetAmmoDialogData } from '../set-ammo-dialog/set-ammo.dialog.component';
import type { EquipmentDialogRuntimeController } from './equipment-dialog-runtime.controller';
import { EquipmentCatalogService } from '../../services/catalogs/equipment-catalog.service';
import { DialogsService } from '../../services/dialogs.service';

interface AmmoControlGroupLocation {
    readonly loc: string;
    quantity: number;
    readonly state: 'normal' | 'exposed' | 'disabled' | 'destroyed';
}

interface AmmoLoadoutEntryView {
    readonly id: string;
    readonly displayBinName: string;
    readonly locationLabel: string;
    readonly status: EquipmentStatus;
    readonly totalAmmo: number;
    readonly remaining: number;
    readonly exposed: boolean;
    readonly component: EquipmentPanelComponent;
}

interface AmmoLoadoutGroupView {
    readonly id: string;
    readonly displayName: string;
    readonly locations: readonly AmmoControlGroupLocation[];
    readonly totalAmmo: number;
    readonly remaining: number;
    readonly status: EquipmentStatus;
    readonly expandable: boolean;
    readonly entries: readonly AmmoLoadoutEntryView[];
}

const EQUIPMENT_STATUS_ORDER: Readonly<Record<EquipmentStatus, number>> = {
    available: 0,
    disabled: 1,
    destroyed: 2,
};

@Component({
    selector: 'ammo-loadout-panel',
    standalone: true,
    changeDetection: ChangeDetectionStrategy.OnPush,
    template: `
    @if (groups().length === 0) {
        <div class="ammo-empty-state">
            <strong>No ammo loadout</strong>
            <span>This unit does not have any ammunition bins.</span>
        </div>
    } @else {
    <div class="ammo-control-list" [class.read-only]="readOnly()">
        @for (group of groups(); track group.id) {
            @let remainingAmmoGroup = groupRemaining(group);
            <div class="ammo-control-row" [class.destroyed-entry]="group.status === 'destroyed'" [class.disabled-entry]="group.status === 'disabled'" [class.empty]="remainingAmmoGroup <= 0">
                <div class="ammo-control-label" [class.expandable]="group.expandable">
                    @if (group.expandable) {
                        <button class="ammo-expand-button" type="button" (click)="toggleGroup(group)">
                            <svg width="13px" height="13px" fill="currentColor" viewBox="0 0 10 10" xmlns="http://www.w3.org/2000/svg" class="chevron" [class.collapsed]="!isExpanded(group)"><path d="M0 2l5 6 5-6z"></path></svg>
                            <span class="ammo-name-wrapper">
                                <span class="ammo-name">{{ group.displayName }}</span>
                                @if (!isExpanded(group)) {
                                    <span class="ammo-location-badges">
                                    @for (location of group.locations; track location.loc + ':' + location.state) {
                                        <span class="ammo-location-badge" [class.exposed]="isLocationBadgeExposed(location)" [class.disabled]="isLocationBadgeDisabled(location)" [class.destroyed]="isLocationBadgeDestroyed(location)">
                                            @if (location.quantity > 1) {
                                                <span class="quantity">{{ location.quantity + '×' }}</span>
                                            }
                                            {{ location.loc }}
                                        </span>
                                    }
                                    </span>
                                }
                            </span>
                        </button>
                    } @else {
                        <div class="ammo-single-entry">
                            @if (hasExpandableGroups()) {
                                <div class="no-chevron">—</div>
                            }
                            <span class="ammo-name-wrapper">
                                <span class="ammo-name">{{ group.displayName }}</span>
                                <span class="ammo-location-badges">
                                    @for (location of group.locations; track location.loc + ':' + location.state) {
                                        <span class="ammo-location-badge" [class.exposed]="isLocationBadgeExposed(location)" [class.disabled]="isLocationBadgeDisabled(location)" [class.destroyed]="isLocationBadgeDestroyed(location)">
                                            @if (location.quantity > 1) {
                                                <span class="quantity">{{ location.quantity + '×' }}</span>
                                            }
                                            {{ location.loc }}
                                        </span>
                                    }
                                </span>
                            </span>
                        </div>
                    }
                    <span class="ammo-count"><span class="count">{{ remainingAmmoGroup }}</span>/{{ group.totalAmmo }}</span>
                    @if (isExpanded(group)) {
                        <div class="ammo-bin-list">
                            @for (entry of group.entries; track entry.id) {
                                @let remainingAmmoBin = remaining(entry);
                                <div class="ammo-bin" [class.destroyed]="entry.status === 'destroyed'" [class.disabled]="entry.status === 'disabled'" [class.empty]="remainingAmmoBin <= 0">
                                    <button class="ammo-bin-name-wrapper" type="button" (click)="setAmmoBin(entry)" [disabled]="!entryUsable(entry) || readOnly()">
                                        <span class="ammo-bin-name">{{ entry.displayBinName }}</span>
                                        <span class="ammo-location-badges">
                                            <span class="ammo-location-badge" [class.exposed]="isEntryLocationBadgeExposed(group, entry)" [class.disabled]="isEntryLocationBadgeDisabled(entry)" [class.destroyed]="isEntryLocationBadgeDestroyed(entry)">
                                                {{ entry.locationLabel }}
                                            </span>
                                        </span>
                                    </button>
                                    @if (entryUsable(entry) && !readOnly()) {
                                        <div class="ammo-bin-adjustments">
                                            <button class="ammo-bin-adjust bt-button square-small" type="button" (click)="decrementBin(entry)" [disabled]="remaining(entry) <= 0">-1</button>
                                            <button class="ammo-bin-adjust bt-button square-small" type="button" (click)="incrementBin(entry)" [disabled]="remaining(entry) >= entry.totalAmmo">+1</button>
                                        </div>
                                    } @else {
                                        <span class="ammo-bin-adjustments" aria-hidden="true"></span>
                                    }
                                    <span class="ammo-count"><span class="count">{{ remainingAmmoBin }}</span>/{{ entry.totalAmmo }}</span>
                                </div>
                            }
                        </div>
                    }
                </div>
                @if (!readOnly() && group.status === 'available') {
                    <div class="ammo-control-actions">
                        <button class="bt-button square-small" type="button" (click)="decrement(group)" [disabled]="groupRemaining(group) <= 0">-1</button>
                        <button class="bt-button square-small" type="button" (click)="increment(group)" [disabled]="groupRemaining(group) >= group.totalAmmo">+1</button>
                        <button class="bt-button" type="button" (click)="setAmmo(group)">SET AMMO</button>
                    </div>
                }
            </div>
        }
    </div>
    }
    `,
    styles: [`
        .ammo-empty-state {
            display: grid;
            place-items: center;
            align-content: center;
            gap: 6px;
            min-height: 180px;
            padding: 24px;
            box-sizing: border-box;
            color: var(--text-color-secondary);
            text-align: center;
        }

        .ammo-empty-state strong {
            color: var(--text-color);
            font-size: 1.1rem;
        }

        .ammo-control-list {
            display: grid;
        }

        .ammo-control-row {
            display: grid;
            grid-template-columns: minmax(0, 1fr) auto;
            gap: 4px 12px;
            align-items: start;
            padding: 4px 8px;
            border-bottom: 1px solid var(--border-color);
        }

        .ammo-control-list.read-only .ammo-control-row {
            grid-template-columns: minmax(0, 1fr);
        }

        .ammo-control-row:last-child {
            border-bottom: 0;
        }

        .ammo-control-row.destroyed-entry .ammo-name,
        .ammo-bin.destroyed {
            color: var(--damage-color);
        }

        .ammo-control-row.destroyed-entry {
            color: var(--damage-color);
        }

        .ammo-control-row.disabled-entry .ammo-name,
        .ammo-bin.disabled,
        .ammo-control-row.disabled-entry {
            color: var(--disabled-color);
        }

        .ammo-control-label {
            display: grid;
            grid-template-columns: minmax(0, 1fr) auto;
            gap: 0px 8px;
            align-items: baseline;
            min-width: 0;
        }

        .ammo-single-entry,
        .ammo-expand-button {
            display: inline-flex;
            align-items: flex-start;
            justify-content: flex-start;
            gap: 4px;
            min-width: 0;
            min-height: 32px;
            padding: calc((32px - 1.3em) / 2) 0 0 0;
            box-sizing: border-box;
            border: 0;
            background: transparent;
            font: inherit;
            color: var(--text-color-secondary);
            text-align: left;
        }

        .ammo-expand-button {
            cursor: pointer;
        }

        .chevron {
            color: var(--text-color-secondary);
            transition: transform 0.15s ease;
            flex-shrink: 0;
            width: 13px;
            height: 13px;
            margin-top: calc((1.3em - 13px) / 2);
        }

        .no-chevron {
            color: var(--text-color-secondary);
        }

        .destroyed-entry .chevron,
        .destroyed-entry .no-chevron {
            color: var(--damage-color);
        }

        .disabled-entry .chevron,
        .disabled-entry .no-chevron {
            color: var(--disabled-color);
        }

        .chevron.collapsed {
            transform: rotate(-90deg);
        }

        .ammo-name {
            color: var(--text-color);
            text-align: left;
            line-height: 1.3;
            margin-right: 6px;
            font-weight: 500;
        }

        .ammo-location-badges {
            display: inline-flex;
            flex-wrap: wrap;
            gap: 3px;
            align-items: center;
            min-width: 0;
            position: relative;
            top: -2px;
        }

        .ammo-location-badge {
            display: inline-flex;
            align-items: baseline;
            justify-content: center;
            min-width: 12px;
            padding: 1px 4px;
            background: var(--background-highlight-bright);
            color: black;
            font-size: 0.7em;
            line-height: 1.3;
            white-space: nowrap;
            font-weight: bold;

            .quantity {
                font-size: 0.9em;
                margin-right: 2px;
            }
        }

        .ammo-location-badge.exposed {
            background: var(--background-warning);
        }

        .ammo-location-badge.destroyed {
            background: var(--damage-color);
        }

        .ammo-location-badge.disabled {
            background: var(--disabled-color);
        }

        .ammo-control-label > .ammo-name-wrapper {
            display: flex;
            align-items: center;
            min-height: 32px;
        }

        .ammo-count {
            color: var(--text-color-secondary);
            text-align: right;
            min-width: 48px;

            .count {
                font-weight: bold;
                color: var(--text-color);
            }
        }

        .ammo-control-label > .ammo-count {
            grid-column: 2;
            display: flex;
            align-items: flex-start;
            justify-content: flex-end;
            min-height: 32px;
            line-height: 1.3;
            padding-top: calc((32px - 1.3em) / 2);
            box-sizing: border-box;
        }

        .ammo-control-row.empty > .ammo-control-label > .ammo-count > .count,
        .ammo-control-row.destroyed-entry > .ammo-control-label > .ammo-count,
        .ammo-control-row.destroyed-entry > .ammo-control-label > .ammo-count > .count,
        .ammo-bin.empty > .ammo-count > .count,
        .ammo-bin.destroyed > .ammo-count,
        .ammo-bin.destroyed > .ammo-count > .count {
            color: var(--damage-color);
        }

        .ammo-control-row.disabled-entry > .ammo-control-label > .ammo-count,
        .ammo-control-row.disabled-entry > .ammo-control-label > .ammo-count > .count,
        .ammo-bin.disabled > .ammo-count,
        .ammo-bin.disabled > .ammo-count > .count {
            color: var(--disabled-color);
        }

        .ammo-control-actions {
            display: flex;
            gap: 6px;
            align-items: stretch;
            align-self: start;
        }

        .ammo-bin-list {
            grid-column: 1 / -1;
            display: grid;
            gap: 0px 8px;
            font-size: 0.86em;
            margin-top: -4px;
            padding-bottom: 4px;
        }

        .ammo-bin {
            display: grid;
            grid-template-columns: fit-content(200px) auto minmax(48px, auto);
            gap: 8px;
            align-items: baseline;
            padding: 0;
            border: 0;
            background: transparent;
            color: inherit;
            text-align: left;
            border-left: 1px solid var(--border-color);
            margin-left: 6px;
            padding-top: 4px;
            box-sizing: border-box;
        }

        .ammo-bin-name-wrapper {
            justify-self: start;
            box-sizing: border-box;
            padding-left: 10px;
            border: 0;
            background: transparent;
            color: inherit;
            font: inherit;
            text-align: left;
            cursor: pointer;
            display: inline-flex;
            align-items: center;
            gap: 6px;

            .ammo-location-badges {
                top: 0px;
            }
        }
        .ammo-bin-name {
            text-decoration: underline dotted var(--text-color-secondary);
        }

        .ammo-bin-adjustments {
            display: inline-flex;
            gap: 4px;
            align-items: center;
        }

        .ammo-bin-adjust {
            display: inline-grid;
            place-items: center;
            width: 24px;
            height: 24px;
            min-height: 0;
            max-height: 24px;
            min-width: 0;
            max-width: 24px;
            padding: 0;
            cursor: pointer;
        }

        .ammo-bin-adjust:disabled {
            opacity: 0.45;
            cursor: default;
        }

        .ammo-control-list.read-only .ammo-bin {
            cursor: default;
        }

        .ammo-control-list.read-only .ammo-bin-name {
            text-decoration: none;
        }

        .ammo-bin.destroyed .ammo-bin-name {
            text-decoration-color: var(--damage-color);
        }

        .ammo-bin.disabled .ammo-bin-name {
            color: var(--disabled-color);
        }

        @container (max-width: 520px) {
            .ammo-control-row {
                grid-template-columns: 1fr;
            }

            .ammo-control-actions {
                justify-content: flex-end;
            }
        }
    `]
})
export class AmmoLoadoutPanelComponent {
    readonly runtime = input.required<EquipmentDialogRuntimeController>();
    private readonly dialogs = inject(DialogsService);
    private readonly equipmentCatalog = inject(EquipmentCatalogService);
    private readonly expandedGroups = signal<Set<string>>(new Set());
    private readonly expandedEntries = signal<Set<string>>(new Set());

    groups(): readonly AmmoLoadoutGroupView[] {
        return this.buildGroups(this.runtime().ammo());
    }

    readOnly(): boolean {
        return this.runtime().member.force.readOnly();
    }

    hasExpandableGroups(): boolean {
        return this.groups().some(group => group.expandable);
    }

    isExpanded(group: AmmoLoadoutGroupView): boolean {
        const expandedEntries = this.expandedEntries();
        return this.expandedGroups().has(group.id) || group.entries.some(entry => expandedEntries.has(entry.id));
    }

    toggleGroup(group: AmmoLoadoutGroupView): void {
        if (!group.expandable) return;
        const isExpanded = this.isExpanded(group);
        this.expandedGroups.update(groups => {
            const next = new Set(groups);
            if (isExpanded) {
                next.delete(group.id);
            } else {
                next.add(group.id);
            }
            return next;
        });
        this.expandedEntries.update(entries => {
            const next = new Set(entries);
            for (const entry of group.entries) {
                if (isExpanded) {
                    next.delete(entry.id);
                } else {
                    next.add(entry.id);
                }
            }
            return next;
        });
    }

    remaining(entry: AmmoLoadoutEntryView): number {
        return entry.remaining;
    }

    groupRemaining(group: AmmoLoadoutGroupView): number {
        return group.remaining;
    }

    isLocationBadgeExposed(location: AmmoControlGroupLocation): boolean {
        return location.state === 'exposed';
    }

    isLocationBadgeDestroyed(location: AmmoControlGroupLocation): boolean {
        return location.state === 'destroyed';
    }

    isLocationBadgeDisabled(location: AmmoControlGroupLocation): boolean {
        return location.state === 'disabled';
    }

    isEntryLocationBadgeExposed(_group: AmmoLoadoutGroupView, entry: AmmoLoadoutEntryView): boolean {
        return this.entryUsable(entry) && entry.exposed;
    }

    isEntryLocationBadgeDestroyed(entry: AmmoLoadoutEntryView): boolean {
        return entry.status === 'destroyed';
    }

    isEntryLocationBadgeDisabled(entry: AmmoLoadoutEntryView): boolean {
        return entry.status === 'disabled';
    }

    entryUsable(entry: AmmoLoadoutEntryView): boolean {
        return entry.status === 'available';
    }

    decrement(group: AmmoLoadoutGroupView): void {
        if (this.readOnly()) return;
        const entry = group.entries.find(candidate =>
            this.entryUsable(candidate) && candidate.remaining > 0);
        if (entry) void this.runtime().changeAmmo(entry.component, -1);
    }

    increment(group: AmmoLoadoutGroupView): void {
        if (this.readOnly()) return;
        const entry = group.entries.find(candidate =>
            this.entryUsable(candidate) && candidate.remaining < candidate.totalAmmo);
        if (entry) void this.runtime().changeAmmo(entry.component, 1);
    }

    decrementBin(entry: AmmoLoadoutEntryView): void {
        if (this.readOnly() || !this.entryUsable(entry)) return;
        void this.runtime().changeAmmo(entry.component, -1);
    }

    incrementBin(entry: AmmoLoadoutEntryView): void {
        if (this.readOnly() || !this.entryUsable(entry)) return;
        void this.runtime().changeAmmo(entry.component, 1);
    }

    async setAmmo(group: AmmoLoadoutGroupView): Promise<void> {
        if (this.readOnly()) return;
        await this.setAmmoEntries(group.entries);
    }

    async setAmmoBin(entry: AmmoLoadoutEntryView): Promise<void> {
        if (this.readOnly()) return;
        await this.setAmmoEntries([entry]);
    }

    private buildGroups(rows: readonly EquipmentPanelComponent[]): readonly AmmoLoadoutGroupView[] {
        const grouped = new Map<string, EquipmentPanelComponent[]>();
        for (const row of rows) {
            if (!row.ammo) continue;
            const key = `${row.ammo.munitionKey}\u0000${row.ammo.displayName}`;
            const group = grouped.get(key);
            if (group) group.push(row);
            else grouped.set(key, [row]);
        }
        return Object.freeze([...grouped.values()].map(rowsForGroup => {
            const entries = rowsForGroup.map((row, index) => Object.freeze({
                id: row.componentId,
                displayBinName: `#${index + 1} Bin`,
                locationLabel: row.locations.map(location => location.code).join('/') || 'Ammo',
                status: row.status,
                totalAmmo: row.ammo!.capacity,
                remaining: row.status === 'available' ? row.ammo!.remaining : 0,
                exposed: row.locations.some(location => location.exposed),
                component: row,
            } satisfies AmmoLoadoutEntryView));
            const locations = new Map<string, AmmoControlGroupLocation>();
            for (const entry of entries) {
                const state: AmmoControlGroupLocation['state'] = entry.status === 'destroyed'
                    ? 'destroyed'
                    : entry.status === 'disabled' ? 'disabled' : entry.exposed ? 'exposed' : 'normal';
                const key = `${entry.locationLabel}:${state}`;
                const existing = locations.get(key);
                if (existing) existing.quantity += 1;
                else locations.set(key, { loc: entry.locationLabel, quantity: 1, state });
            }
            const first = rowsForGroup[0]!;
            return Object.freeze({
                id: entries.map(entry => entry.id).join('|'),
                displayName: (first.ammo?.displayName ?? first.label).replace(/ Ammo$/i, ''),
                locations: Object.freeze([...locations.values()].map(location => Object.freeze({ ...location }))),
                totalAmmo: entries.reduce((sum, entry) => sum + entry.totalAmmo, 0),
                remaining: entries.reduce((sum, entry) => sum + entry.remaining, 0),
                status: entries.some(entry => entry.status === 'available')
                    ? 'available'
                    : entries.some(entry => entry.status === 'disabled') ? 'disabled' : 'destroyed',
                expandable: entries.length > 1,
                entries: Object.freeze(entries),
            } satisfies AmmoLoadoutGroupView);
        }).sort((left, right) => EQUIPMENT_STATUS_ORDER[left.status] - EQUIPMENT_STATUS_ORDER[right.status]
            || left.displayName.localeCompare(right.displayName)
            || left.id.localeCompare(right.id)));
    }

    private async setAmmoEntries(entries: readonly AmmoLoadoutEntryView[]): Promise<void> {
        const runtime = this.runtime();
        const rows = entries.map(entry => entry.component);
        const first = rows[0];
        if (!first?.ammo) return;
        const commonLoadouts = first.ammo.loadouts.filter(loadout => rows.every(row =>
            row.ammo?.loadouts.some(candidate => candidate.munitionKey === loadout.munitionKey)));
        if (commonLoadouts.length === 0) return;
        const registry = this.equipmentCatalog.getEquipmentRegistry();
        const ammoOptions = commonLoadouts
            .map(loadout => registry.findEquipment(loadout.munitionKey))
            .filter((equipment): equipment is AmmoEquipment => equipment instanceof AmmoEquipment);
        const currentAmmo = registry.findEquipment(first.ammo.munitionKey);
        const originalAmmo = registry.findEquipment(first.ammo.defaultMunitionKey);
        if (!(currentAmmo instanceof AmmoEquipment)
            || !(originalAmmo instanceof AmmoEquipment)
            || ammoOptions.length !== commonLoadouts.length) return;
        const maxQuantity = rows.reduce((sum, row) => sum + (row.ammo?.capacity ?? 0), 0);
        const ref = this.dialogs.createDialog<{ name: string; quantity: number; totalAmmo: number } | null>(
            SetAmmoDialogComponent,
            {
                data: {
                    currentAmmo,
                    originalAmmo,
                    originalTotalAmmo: rows.reduce((sum, row) => sum + (
                        row.ammo?.loadouts.find(loadout =>
                            loadout.munitionKey === row.ammo?.defaultMunitionKey)?.capacity ?? 0
                    ), 0),
                    ammoOptions,
                    quantity: rows.reduce((sum, row) => sum + (row.ammo?.remaining ?? 0), 0),
                    maxQuantity,
                    unitType: runtime.snapshot().unitType,
                    equipmentRegistry: registry,
                } satisfies SetAmmoDialogData,
            },
        );
        const selection = await firstValueFrom(ref.closed);
        if (!selection) return;
        let remaining = Math.max(0, selection.quantity);
        for (const row of rows) {
            const capacity = row.ammo?.loadouts.find(loadout => loadout.munitionKey === selection.name)?.capacity;
            if (capacity === undefined) return;
            const allocated = Math.min(capacity, remaining);
            await runtime.configureAmmo(row, selection.name, allocated);
            remaining -= allocated;
        }
    }

}
