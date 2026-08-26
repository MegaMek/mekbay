// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import { TestBed } from '@angular/core/testing';

import { asComponentId } from '../../models/entity/entity-identifiers';
import type { EquipmentPanelComponent } from '../../models/runtime/equipment-panel';
import { DialogsService } from '../../services/dialogs.service';
import { EquipmentCatalogService } from '../../services/catalogs/equipment-catalog.service';
import { AmmoLoadoutPanelComponent } from './ammo-loadout-panel.component';
import type { EquipmentDialogRuntimeController } from './equipment-dialog-runtime.controller';

function ammoRow(
    id: string,
    location: string,
    remaining: number,
    status: 'available' | 'disabled' | 'destroyed' = 'available',
    options: {
        readonly displayName?: string;
        readonly exposed?: boolean;
        readonly capacity?: number;
        readonly munitionKey?: string;
    } = {},
): EquipmentPanelComponent {
    const displayName = options.displayName ?? 'AC/20 Ammo';
    const capacity = options.capacity ?? 5;
    const munitionKey = options.munitionKey ?? `ammo:${displayName.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`;
    return {
        componentId: asComponentId(id),
        label: displayName,
        locations: [{
            locationId: `location:${location.toLowerCase()}`,
            code: location,
            status,
            exposed: options.exposed ?? false,
        }],
        status,
        previewStatus: status,
        modes: [],
        jammed: false,
        ammo: {
            defaultMunitionKey: munitionKey,
            munitionKey,
            displayName,
            remaining,
            capacity,
            loadouts: [{ munitionKey, displayName, capacity, profile: {} }],
        },
    } as unknown as EquipmentPanelComponent;
}

function createComponent(
    rows: readonly EquipmentPanelComponent[] | (() => readonly EquipmentPanelComponent[]),
    readOnly = false,
) {
    const currentRows = () => typeof rows === 'function' ? rows() : rows;
    const changeAmmo = jasmine.createSpy('changeAmmo').and.callFake(
        (row: EquipmentPanelComponent, delta: number) => {
            if (row.ammo) {
                (row.ammo as { remaining: number }).remaining = Math.max(
                    0,
                    Math.min(row.ammo.capacity, row.ammo.remaining + delta),
                );
            }
            return Promise.resolve();
        },
    );
    const configureAmmo = jasmine.createSpy('configureAmmo').and.resolveTo();
    const runtime = {
        ammo: currentRows,
        member: { force: { readOnly: () => readOnly } },
        changeAmmo,
        configureAmmo,
    } as unknown as EquipmentDialogRuntimeController;
    TestBed.configureTestingModule({
        imports: [AmmoLoadoutPanelComponent],
        providers: [
            { provide: DialogsService, useValue: jasmine.createSpyObj('DialogsService', ['createDialog']) },
            { provide: EquipmentCatalogService, useValue: { getEquipmentRegistry: () => ({}) } },
        ],
    });
    const fixture = TestBed.createComponent(AmmoLoadoutPanelComponent);
    fixture.componentRef.setInput('runtime', runtime);
    fixture.detectChanges();
    return { fixture, component: fixture.componentInstance, runtime, changeAmmo, configureAmmo };
}

describe('AmmoLoadoutPanelComponent', () => {
    it('recomputes visible groups from live entries while open', () => {
        let liveRows: readonly EquipmentPanelComponent[] = [
            ammoRow('ammo:left', 'LT', 5, 'available', { displayName: 'Ultra AC/20 Ammo' }),
            ammoRow('ammo:right', 'RT', 5, 'available', { displayName: 'Ultra AC/20 Ammo' }),
        ];
        const { component } = createComponent(() => liveRows);

        let groups = component.groups();
        expect(groups.length).toBe(1);
        expect(groups[0].entries.length).toBe(2);
        expect(component.groupRemaining(groups[0])).toBe(10);

        liveRows = [
            ammoRow('ammo:left', 'LT', 5, 'available', { displayName: 'Ultra AC/20 Precision Ammo' }),
            ammoRow('ammo:right', 'RT', 5, 'destroyed', { displayName: 'Ultra AC/20 Ammo' }),
        ];

        groups = component.groups();
        expect(groups.map(group => group.displayName)).toEqual([
            'Ultra AC/20 Precision',
            'Ultra AC/20',
        ]);
        expect(groups.map(group => group.status)).toEqual(['available', 'destroyed']);
        expect(groups.map(group => component.groupRemaining(group))).toEqual([5, 0]);
    });

    it('allows a single-bin ammo group to expand', () => {
        const { fixture } = createComponent([ammoRow('ammo:left', 'LT', 5)]);

        expect(fixture.nativeElement.querySelector('.ammo-expand-button')).toBeNull();
        expect(fixture.nativeElement.querySelector('.ammo-bin-list')).toBeNull();
    });

    it('styles a disabled ammo source separately from a destroyed source', () => {
        const { fixture } = createComponent([ammoRow('ammo:left', 'LT', 5, 'disabled')]);

        const row = fixture.nativeElement.querySelector('.ammo-control-row') as HTMLElement;
        const badge = fixture.nativeElement.querySelector('.ammo-location-badge') as HTMLElement;
        expect(row.classList.contains('disabled-entry')).toBeTrue();
        expect(row.classList.contains('destroyed-entry')).toBeFalse();
        expect(badge.classList.contains('disabled')).toBeTrue();
        expect(badge.classList.contains('destroyed')).toBeFalse();
        expect(row.querySelector('.ammo-count')?.textContent?.trim()).toBe('0/5');
        expect(fixture.nativeElement.querySelector('.ammo-control-actions')).toBeNull();
    });

    it('shows location badges beside the group name', () => {
        const { fixture } = createComponent([
            ammoRow('ammo:lt-1', 'LT', 5),
            ammoRow('ammo:lt-2', 'LT', 5),
            ammoRow('ammo:rt', 'RT', 5, 'available', { exposed: true }),
            ammoRow('ammo:ct', 'CT', 5, 'destroyed'),
        ]);

        const badges = Array.from(
            fixture.nativeElement.querySelectorAll('.ammo-location-badge'),
        ) as HTMLElement[];
        expect(badges.map(badge => badge.textContent?.trim())).toEqual(['2× LT', 'RT', 'CT']);
        expect(badges[0].classList.contains('exposed')).toBeFalse();
        expect(badges[0].classList.contains('destroyed')).toBeFalse();
        expect(badges[1].classList.contains('exposed')).toBeTrue();
        expect(badges[2].classList.contains('destroyed')).toBeTrue();

        (fixture.nativeElement.querySelector('.ammo-expand-button') as HTMLButtonElement).click();
        fixture.detectChanges();
        const binBadges = Array.from(
            fixture.nativeElement.querySelectorAll('.ammo-bin .ammo-location-badge'),
        ) as HTMLElement[];
        expect(binBadges.map(badge => badge.textContent?.trim())).toEqual(['LT', 'LT', 'RT', 'CT']);
        expect(binBadges[0].classList.contains('exposed')).toBeFalse();
        expect(binBadges[1].classList.contains('exposed')).toBeFalse();
        expect(binBadges[2].classList.contains('exposed')).toBeTrue();
        expect(binBadges[3].classList.contains('destroyed')).toBeTrue();
    });

    it('groups location badges by location and state until expanded', () => {
        const { fixture } = createComponent([
            ammoRow('ammo:rt-1', 'RT', 5),
            ammoRow('ammo:rt-2', 'RT', 5),
            ammoRow('ammo:rt-3', 'RT', 5, 'destroyed'),
        ]);

        const groupBadges = Array.from(
            fixture.nativeElement.querySelectorAll('.ammo-expand-button .ammo-location-badge'),
        ) as HTMLElement[];
        expect(groupBadges.map(badge => badge.textContent?.trim())).toEqual(['2× RT', 'RT']);
        expect(groupBadges[0].classList.contains('destroyed')).toBeFalse();
        expect(groupBadges[1].classList.contains('destroyed')).toBeTrue();

        (fixture.nativeElement.querySelector('.ammo-expand-button') as HTMLButtonElement).click();
        fixture.detectChanges();
        expect(fixture.nativeElement.querySelectorAll(
            '.ammo-expand-button .ammo-location-badge',
        ).length).toBe(0);
        expect(fixture.nativeElement.querySelectorAll('.ammo-bin .ammo-location-badge').length).toBe(3);
    });

    it('shows per-bin quantity controls only for active bins', () => {
        const active = ammoRow('ammo:active', 'LT', 4);
        const destroyed = ammoRow('ammo:destroyed', 'LT', 5, 'destroyed');
        const { fixture, changeAmmo } = createComponent([active, destroyed]);
        (fixture.nativeElement.querySelector('.ammo-expand-button') as HTMLButtonElement).click();
        fixture.detectChanges();

        const binRows = Array.from(fixture.nativeElement.querySelectorAll('.ammo-bin')) as HTMLElement[];
        expect(binRows[0].querySelectorAll('.ammo-bin-adjust').length).toBe(2);
        expect(binRows[1].querySelectorAll('.ammo-bin-adjust').length).toBe(0);

        (binRows[0].querySelector('.ammo-bin-adjust') as HTMLButtonElement).click();
        fixture.detectChanges();
        expect(changeAmmo).toHaveBeenCalledOnceWith(active, -1);
        expect(binRows[0].querySelector('.ammo-count')?.textContent?.trim()).toBe('3/5');
    });

    it('keeps rebuilt groups open after a bin changes ammo type', () => {
        const unchanged = ammoRow('ammo:right', 'RT', 5, 'available', {
            displayName: 'Ultra AC/20 Ammo',
        });
        let liveRows: readonly EquipmentPanelComponent[] = [
            ammoRow('ammo:left', 'LT', 5, 'available', { displayName: 'Ultra AC/20 Ammo' }),
            unchanged,
        ];
        const { component } = createComponent(() => liveRows);
        const group = component.groups()[0];

        component.toggleGroup(group);
        expect(component.isExpanded(group)).toBeTrue();

        liveRows = [
            ammoRow('ammo:left', 'LT', 5, 'available', {
                displayName: 'Ultra AC/20 Precision Ammo',
            }),
            unchanged,
        ];

        const rebuiltGroups = component.groups();
        expect(rebuiltGroups.length).toBe(2);
        expect(rebuiltGroups.every(rebuiltGroup => component.isExpanded(rebuiltGroup))).toBeTrue();
    });

    it('has no legacy panel-data input', () => {
        expect(Object.hasOwn(AmmoLoadoutPanelComponent.prototype, 'panelData')).toBeFalse();
    });
});
