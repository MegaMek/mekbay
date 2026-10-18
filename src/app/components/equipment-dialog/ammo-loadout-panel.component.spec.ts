// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import { TestBed } from '@angular/core/testing';
import { of } from 'rxjs';

import { CORE_2026_RULESET } from '../../models/cbt-ruleset.model';
import { asComponentId } from '../../models/entity/entity-identifiers';
import { createTestEquipmentRegistry } from '../../models/entity/testing/test-equipment-registry';
import { AmmoEquipment } from '../../models/equipment.model';
import type { Era } from '../../models/eras.model';
import type { EquipmentPanelBombs, EquipmentPanelComponent } from '../../models/runtime/equipment-panel';
import { DialogsService } from '../../services/dialogs.service';
import { EquipmentCatalogService } from '../../services/catalogs/equipment-catalog.service';
import { AmmoValidityUtil } from '../../utils/ammo-validity.util';
import { SetAmmoDialogComponent, type SetAmmoDialogData } from '../set-ammo-dialog/set-ammo.dialog.component';
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
        readonly hotLoaded?: boolean;
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
            hotLoaded: options.hotLoaded,
            loadouts: [{ munitionKey, displayName, capacity, profile: {} }],
        },
    } as unknown as EquipmentPanelComponent;
}

function createComponent(
    rows: readonly EquipmentPanelComponent[] | (() => readonly EquipmentPanelComponent[]),
    readOnly = false,
    bombs: EquipmentPanelBombs | null = null,
    era: Era | null = null,
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
    const setBombsSpent = jasmine.createSpy('setBombsSpent').and.resolveTo();
    const runtime = {
        ammo: currentRows,
        bombs: () => bombs,
        snapshot: () => ({ unitType: 'Mek', ruleset: CORE_2026_RULESET }),
        member: { force: { readOnly: () => readOnly, era: () => era } },
        changeAmmo,
        configureAmmo,
        setBombsSpent,
    } as unknown as EquipmentDialogRuntimeController;
    TestBed.configureTestingModule({
        imports: [AmmoLoadoutPanelComponent],
        providers: [
            { provide: DialogsService, useValue: jasmine.createSpyObj('DialogsService', ['createDialog']) },
            { provide: EquipmentCatalogService, useValue: { getEquipmentRegistry: () => ({ equipment: {} }) } },
        ],
    });
    const fixture = TestBed.createComponent(AmmoLoadoutPanelComponent);
    fixture.componentRef.setInput('runtime', runtime);
    fixture.detectChanges();
    return { fixture, component: fixture.componentInstance, runtime, changeAmmo, configureAmmo, setBombsSpent };
}

describe('AmmoLoadoutPanelComponent', () => {
    for (const scope of ['group', 'bin'] as const) {
        for (const period of ['future', 'extinct', 'unrestricted'] as const) {
            it(`preserves the force era for ${period} ammunition in the ${scope} dialog`, async () => {
                const ammo = new AmmoEquipment({
                    id: 'Test Era Ammo', name: 'Test Era Ammo', type: 'ammo',
                    tech: { base: 'IS', advancement: { is: { production: '2700', extinct: '2850', reintroduced: '3050' } } },
                    ammo: { type: 'AC', rackSize: 20, shots: 5 },
                });
                const era: Era | null = period === 'unrestricted' ? null : {
                    id: 1, name: 'Test Era', factions: [], units: [],
                    years: period === 'future' ? { from: 2500, to: 2600 } : { from: 2900, to: 3000 },
                };
                const rows = ['LT', 'RT'].map(location => ammoRow(`ammo:${location}`, location, 5, 'available', {
                    displayName: ammo.name, munitionKey: ammo.internalName,
                }));
                const { component } = createComponent(rows, false, null, era);
                spyOn(TestBed.inject(EquipmentCatalogService), 'getEquipmentRegistry').and.returnValue(
                    createTestEquipmentRegistry({ [ammo.id]: ammo }),
                );
                const dialogs = TestBed.inject(DialogsService) as jasmine.SpyObj<DialogsService>;
                dialogs.createDialog.and.returnValue({ closed: of(null) } as never);
                const group = component.groups()[0];

                if (scope === 'group') await component.setAmmo(group);
                else await component.setAmmoBin(group.entries[0]);

                const data = dialogs.createDialog.calls.mostRecent().args[1]?.data as SetAmmoDialogData;
                expect(data.era).toBe(era);
                expect(AmmoValidityUtil.getAmmoSelectionIssues(ammo, data).map(issue => issue.reason)).toEqual(
                    period === 'unrestricted' ? [] : [period === 'future' ? 'not-yet-existing-in-era' : 'extinct-in-era'],
                );
            });
        }
    }

    for (const scope of ['group', 'bin'] as const) {
        it(`preserves Artemis compatibility when opening the ${scope} ammo dialog`, async () => {
            const guidedAmmo = new AmmoEquipment({
                id: 'IS LRM 15 Artemis Ammo', name: 'LRM 15 Artemis-capable Ammo', type: 'ammo',
                ammo: { type: 'LRM', rackSize: 15, shots: 8, munitionType: ['M_ARTEMIS_CAPABLE'] },
            });
            const compatibilityFacts = { artemisIV: [guidedAmmo.internalName], artemisV: [] };
            const rows = ['LT', 'RT'].map(location => {
                const row = ammoRow(`ammo:${location}`, location, 24, 'available', {
                    capacity: 24, displayName: guidedAmmo.name, munitionKey: guidedAmmo.internalName,
                });
                return { ...row, ammo: { ...row.ammo!, compatibilityFacts } };
            });
            const { component } = createComponent(rows);
            spyOn(TestBed.inject(EquipmentCatalogService), 'getEquipmentRegistry').and.returnValue(
                createTestEquipmentRegistry({ [guidedAmmo.id]: guidedAmmo }),
            );
            const dialogs = TestBed.inject(DialogsService) as jasmine.SpyObj<DialogsService>;
            dialogs.createDialog.and.returnValue({ closed: of(null) } as never);
            const group = component.groups()[0];

            if (scope === 'group') await component.setAmmo(group);
            else await component.setAmmoBin(group.entries[0]);

            expect(dialogs.createDialog).toHaveBeenCalledTimes(1);
            const [dialog, options] = dialogs.createDialog.calls.mostRecent().args;
            expect(dialog).toBe(SetAmmoDialogComponent);
            const data = options?.data as SetAmmoDialogData;
            expect(data.quantity).toBe(scope === 'group' ? 48 : 24);
            expect(data.compatibilityFacts).toEqual(compatibilityFacts);
            expect(AmmoValidityUtil.getAmmoSelectionIssues(guidedAmmo, data)).toEqual([]);
        });
    }

    it('lists carried bombs with hardpoint use and spends or restores them without ammo bins', () => {
        const load = { section: 'external', bombId: 'HEBomb', count: 3, spent: 1 } as const;
        const { fixture, setBombsSpent } = createComponent([], false, {
            capacity: { external: 10, internal: 0 }, loads: [load],
        });
        const element = fixture.nativeElement as HTMLElement;
        expect(element.querySelector('.ammo-empty-state')).toBeNull();
        expect(element.querySelector('.bomb-loadout')!.textContent).toContain('EXT 3/10');
        const row = element.querySelectorAll('.bomb-loadout .ammo-control-row')[1]!;
        expect(row.querySelector('.ammo-count')!.textContent!.replace(/s/g, '')).toBe('2/3');
        const [spend, restore] = [...row.querySelectorAll<HTMLButtonElement>('button')];
        spend!.click();
        restore!.click();
        expect(setBombsSpent.calls.allArgs()).toEqual([[load, 2], [load, 0]]);
    });

    it('keeps ordinary and hot-loaded bins separate and labels the hot-loaded group', () => {
        const { fixture, component } = createComponent([
            ammoRow('ammo:normal', 'LT', 5),
            ammoRow('ammo:hot', 'RT', 5, 'available', { hotLoaded: true }),
        ]);
        expect(component.groups().map(group => group.hotLoaded)).toEqual(jasmine.arrayWithExactContents([false, true]));
        const badges = fixture.nativeElement.querySelectorAll('.hot-loaded-badge');
        expect(badges.length).toBe(1);
        expect(badges[0].textContent.trim()).toBe('HOT-LOADED');
    });

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
