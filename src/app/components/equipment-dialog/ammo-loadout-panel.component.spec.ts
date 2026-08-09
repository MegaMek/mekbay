// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import { TestBed } from '@angular/core/testing';
import { AmmoEquipment } from '../../models/equipment.model';
import { EquipmentRegistry } from '../../models/equipment-lookup';
import type { CBTForceUnit } from '../../models/cbt-force-unit.model';
import { MountedEquipment } from '../../models/mounted-equipment.model';
import type { CriticalSlot } from '../../models/force-serialization';
import {
    createHandlerCommandContext,
    type HandlerCommandContext,
    type HandlerDialogsService,
    type HandlerToastService,
} from '../../services/equipment-interaction-registry.service';
import { AmmoLoadoutPanelComponent, type AmmoLoadoutPanelData } from './ammo-loadout-panel.component';
import type { AmmoControlEntry } from '../../utils/ammo-interaction.util';
import type { EquipmentStatus } from '../../models/equipment-status.model';

function createAmmo(id: string): AmmoEquipment {
    return new AmmoEquipment({
        id,
        name: id,
        type: 'ammo',
        ammo: { type: 'AC_ULTRA', rackSize: 20, shots: 5 }
    });
}

function createCritEntry(params: {
    loc: string;
    slot: number;
    ammo: AmmoEquipment;
    consumed?: number;
    destroyed?: boolean;
    status?: EquipmentStatus;
    owner: Pick<CBTForceUnit, 'id' | 'readOnly' | 'getUnit'>;
}): AmmoControlEntry {
    const owner = params.owner as CBTForceUnit;
    owner.getEquipmentStatus ??= source => source instanceof MountedEquipment && source.committedDestroyed()
        || !(source instanceof MountedEquipment) && !!source.destroyed
        ? 'destroyed'
        : 'available';
    owner.isEquipmentOperational ??= source => owner.getEquipmentStatus(source) === 'available';
    const source = {
        id: `${params.ammo.internalName}@${params.loc}#${params.slot}`,
        name: params.ammo.internalName,
        loc: params.loc,
        slot: params.slot,
        eq: params.ammo,
        totalAmmo: 5,
        consumed: params.consumed ?? 0,
        destroyed: params.destroyed ? Date.now() : undefined,
    } as CriticalSlot;

    return {
        id: `crit:${params.loc}:${params.slot}:${params.ammo.internalName}`,
        owner,
        source,
        sourceType: 'crit',
        locationLabel: params.loc,
        displayName: params.ammo.name,
        displayBinName: `Bin #1 [${params.loc}]`,
        currentAmmo: params.ammo,
        originalAmmo: params.ammo,
        originalTotalAmmo: 5,
        totalAmmo: 5,
        consumed: params.consumed ?? 0,
        status: params.status ?? (params.destroyed ? 'destroyed' : 'available'),
    };
}

function createToastServiceMock() {
    const toasts: Array<{ id: string; message: string; type: 'info' | 'success' | 'error'; data?: Record<string, unknown> }> = [];
    return {
        showToast: jasmine.createSpy('showToast').and.callFake((message: string, type: 'info' | 'success' | 'error', id?: string, data?: Record<string, unknown>) => {
            const toastId = id ?? `toast-${toasts.length + 1}`;
            const existingIndex = toasts.findIndex(toast => toast.id === toastId);
            if (existingIndex === -1) {
                toasts.push({ id: toastId, message, type, data });
            } else {
                toasts[existingIndex] = { id: toastId, message, type, data };
            }
            return toastId;
        }),
        toasts: () => toasts,
    };
}

function createCommandContext(
    equipmentCatalog = new EquipmentRegistry({}),
    toastService: HandlerToastService = createToastServiceMock(),
): HandlerCommandContext {
    const dialogsService = jasmine.createSpyObj<HandlerDialogsService>(
        'HandlerDialogsService',
        ['createDialog', 'showError', 'showNoticeHtml'],
    );
    return createHandlerCommandContext(equipmentCatalog, toastService, dialogsService);
}

describe('AmmoLoadoutPanelComponent', () => {
    function configurePanel(data: AmmoLoadoutPanelData): AmmoLoadoutPanelComponent {
        TestBed.configureTestingModule({
            imports: [AmmoLoadoutPanelComponent],
        });

        const fixture = TestBed.createComponent(AmmoLoadoutPanelComponent);
        fixture.componentRef.setInput('data', data);
        fixture.detectChanges();
        return fixture.componentInstance;
    }

    it('recomputes visible groups from live entries while open', () => {
        const standardAmmo = createAmmo('Clan Ultra AC/20 Ammo');
        const precisionAmmo = createAmmo('Clan Ultra AC/20 Precision Ammo');
        const owner = {
            id: 'unit-1',
            readOnly: () => false,
            getUnit: () => ({ techBase: 'Clan' }),
        } as unknown as Pick<CBTForceUnit, 'id' | 'readOnly' | 'getUnit'>;
        let liveEntries = [
            createCritEntry({ loc: 'LT', slot: 0, ammo: standardAmmo, owner }),
            createCritEntry({ loc: 'LT', slot: 1, ammo: standardAmmo, owner }),
        ];
        const data: AmmoLoadoutPanelData = {
            entries: liveEntries,
            getEntries: () => liveEntries,
            context: createCommandContext(),
        };
        const component = configurePanel(data);

        let groups = component.groups();
        expect(groups.length).toBe(1);
        expect(groups[0].entries.length).toBe(2);
        expect(component.groupRemaining(groups[0])).toBe(10);

        liveEntries = [
            createCritEntry({ loc: 'LT', slot: 0, ammo: precisionAmmo, owner }),
            createCritEntry({ loc: 'LT', slot: 1, ammo: standardAmmo, destroyed: true, owner }),
        ];

        groups = component.groups();
        expect(groups.length).toBe(2);
        expect(groups.map(group => group.displayName)).toEqual(['Clan Ultra AC/20 Precision Ammo', 'Clan Ultra AC/20 Ammo']);
        expect(groups.map(group => group.status)).toEqual(['available', 'destroyed']);
        expect(component.groupRemaining(groups[0])).toBe(5);
        expect(component.groupRemaining(groups[1])).toBe(0);
    });

    it('allows a single-bin ammo group to expand', () => {
        const standardAmmo = createAmmo('Clan Ultra AC/20 Ammo');
        const owner = {
            id: 'unit-1',
            readOnly: () => false,
            getUnit: () => ({ techBase: 'Clan' }),
        } as unknown as Pick<CBTForceUnit, 'id' | 'readOnly' | 'getUnit'>;
        const data: AmmoLoadoutPanelData = {
            entries: [createCritEntry({ loc: 'LT', slot: 0, ammo: standardAmmo, owner })],
            context: createCommandContext(),
        };

        TestBed.configureTestingModule({
            imports: [AmmoLoadoutPanelComponent],
        });
        const fixture = TestBed.createComponent(AmmoLoadoutPanelComponent);
        fixture.componentRef.setInput('data', data);
        fixture.detectChanges();

        const expandButton: HTMLButtonElement | null = fixture.nativeElement.querySelector('.ammo-expand-button');
        expect(expandButton).toBeNull();
        expect(fixture.nativeElement.querySelector('.ammo-bin-list')).toBeNull();
    });

    it('styles a disabled ammo source separately from a destroyed source', () => {
        const standardAmmo = createAmmo('Clan Ultra AC/20 Ammo');
        const owner = {
            id: 'unit-1',
            readOnly: () => false,
            getUnit: () => ({ techBase: 'Clan' }),
        } as unknown as Pick<CBTForceUnit, 'id' | 'readOnly' | 'getUnit'>;
        const data: AmmoLoadoutPanelData = {
            entries: [createCritEntry({ loc: 'LT', slot: 0, ammo: standardAmmo, owner, status: 'disabled' })],
            context: createCommandContext(),
        };

        TestBed.configureTestingModule({ imports: [AmmoLoadoutPanelComponent] });
        const fixture = TestBed.createComponent(AmmoLoadoutPanelComponent);
        fixture.componentRef.setInput('data', data);
        fixture.detectChanges();

        const row = fixture.nativeElement.querySelector('.ammo-control-row') as HTMLElement;
        const badge = fixture.nativeElement.querySelector('.ammo-location-badge') as HTMLElement;
        expect(row.classList.contains('disabled-entry')).toBeTrue();
        expect(row.classList.contains('destroyed-entry')).toBeFalse();
        expect(badge.classList.contains('disabled')).toBeTrue();
        expect(badge.classList.contains('destroyed')).toBeFalse();
        expect(fixture.nativeElement.querySelector('.ammo-control-actions')).toBeNull();
    });

    it('shows location badges beside the group name', () => {
        const standardAmmo = createAmmo('Clan Ultra AC/20 Ammo');
        const owner = {
            id: 'unit-1',
            readOnly: () => false,
            getUnit: () => ({ techBase: 'Clan' }),
            getLocations: () => ({
                LT: { armor: 0 },
                RT: { armor: 6 },
            }),
            locations: {
                armor: new Map([
                    ['LT', { loc: 'LT', rear: false, points: 10 }],
                    ['RT', { loc: 'RT', rear: false, points: 6 }],
                    ['CT', { loc: 'CT', rear: false, points: 12 }],
                ]),
            },
        } as unknown as Pick<CBTForceUnit, 'id' | 'readOnly' | 'getUnit'>;
        const data: AmmoLoadoutPanelData = {
            entries: [
                createCritEntry({ loc: 'LT', slot: 0, ammo: standardAmmo, owner }),
                createCritEntry({ loc: 'LT', slot: 1, ammo: standardAmmo, owner }),
                createCritEntry({ loc: 'RT', slot: 2, ammo: standardAmmo, owner }),
                createCritEntry({ loc: 'CT', slot: 3, ammo: standardAmmo, destroyed: true, owner }),
            ],
            context: createCommandContext(),
        };

        TestBed.configureTestingModule({
            imports: [AmmoLoadoutPanelComponent],
        });
        const fixture = TestBed.createComponent(AmmoLoadoutPanelComponent);
        fixture.componentRef.setInput('data', data);
        fixture.detectChanges();

        const badges = Array.from(fixture.nativeElement.querySelectorAll('.ammo-location-badge')) as HTMLElement[];

        expect(badges.map(badge => badge.textContent?.trim())).toEqual(['2× LT', 'RT', 'CT']);
        expect(badges[0].classList.contains('exposed')).toBeFalse();
        expect(badges[0].classList.contains('destroyed')).toBeFalse();
        expect(badges[1].classList.contains('exposed')).toBeTrue();
        expect(badges[2].classList.contains('destroyed')).toBeTrue();

        fixture.nativeElement.querySelector('.ammo-expand-button')?.click();
        fixture.detectChanges();
        const binBadges = Array.from(fixture.nativeElement.querySelectorAll('.ammo-bin .ammo-location-badge')) as HTMLElement[];

        expect(binBadges.map(badge => badge.textContent?.trim())).toEqual(['LT', 'LT', 'RT', 'CT']);
        expect(binBadges[0].classList.contains('exposed')).toBeFalse();
        expect(binBadges[1].classList.contains('exposed')).toBeFalse();
        expect(binBadges[2].classList.contains('exposed')).toBeTrue();
        expect(binBadges[3].classList.contains('destroyed')).toBeTrue();
    });

    it('groups location badges by location and state until expanded', () => {
        const standardAmmo = createAmmo('Clan Ultra AC/20 Ammo');
        const owner = {
            id: 'unit-1',
            readOnly: () => false,
            getUnit: () => ({ techBase: 'Clan' }),
        } as unknown as Pick<CBTForceUnit, 'id' | 'readOnly' | 'getUnit'>;
        const data: AmmoLoadoutPanelData = {
            entries: [
                createCritEntry({ loc: 'RT', slot: 0, ammo: standardAmmo, owner }),
                createCritEntry({ loc: 'RT', slot: 1, ammo: standardAmmo, owner }),
                createCritEntry({ loc: 'RT', slot: 2, ammo: standardAmmo, destroyed: true, owner }),
            ],
            context: createCommandContext(),
        };

        TestBed.configureTestingModule({
            imports: [AmmoLoadoutPanelComponent],
        });
        const fixture = TestBed.createComponent(AmmoLoadoutPanelComponent);
        fixture.componentRef.setInput('data', data);
        fixture.detectChanges();

        const groupBadges = Array.from(fixture.nativeElement.querySelectorAll('.ammo-expand-button .ammo-location-badge')) as HTMLElement[];

        expect(groupBadges.map(badge => badge.textContent?.trim())).toEqual(['2× RT', 'RT']);
        expect(groupBadges[0].classList.contains('destroyed')).toBeFalse();
        expect(groupBadges[1].classList.contains('destroyed')).toBeTrue();

        fixture.nativeElement.querySelector('.ammo-expand-button')?.click();
        fixture.detectChanges();

        expect(fixture.nativeElement.querySelectorAll('.ammo-expand-button .ammo-location-badge').length).toBe(0);
        expect(fixture.nativeElement.querySelectorAll('.ammo-bin .ammo-location-badge').length).toBe(3);
    });

    it('shows per-bin quantity controls only for active bins', () => {
        const standardAmmo = createAmmo('Clan Ultra AC/20 Ammo');
        const owner = {
            id: 'unit-1',
            readOnly: () => false,
            setCritSlot: jasmine.createSpy('setCritSlot'),
            getUnit: () => ({ techBase: 'Clan' }),
            svg: () => null,
        } as unknown as Pick<CBTForceUnit, 'id' | 'readOnly' | 'setCritSlot' | 'getUnit' | 'svg'>;
        const activeEntry = createCritEntry({ loc: 'LT', slot: 0, ammo: standardAmmo, owner, consumed: 1 });
        const destroyedEntry = createCritEntry({ loc: 'LT', slot: 1, ammo: standardAmmo, owner, destroyed: true });
        const data: AmmoLoadoutPanelData = {
            entries: [activeEntry, destroyedEntry],
            context: createCommandContext(
                new EquipmentRegistry({ [standardAmmo.internalName]: standardAmmo }),
                createToastServiceMock(),
            ),
        };

        TestBed.configureTestingModule({
            imports: [AmmoLoadoutPanelComponent],
        });
        const fixture = TestBed.createComponent(AmmoLoadoutPanelComponent);
        fixture.componentRef.setInput('data', data);
        fixture.detectChanges();
        fixture.nativeElement.querySelector('.ammo-expand-button')?.click();
        fixture.detectChanges();

        const binRows = Array.from(fixture.nativeElement.querySelectorAll('.ammo-bin')) as HTMLElement[];
        expect(binRows[0].querySelectorAll('.ammo-bin-adjust').length).toBe(2);
        expect(binRows[1].querySelectorAll('.ammo-bin-adjust').length).toBe(0);

        (binRows[0].querySelector('.ammo-bin-adjust') as HTMLButtonElement).click();
        fixture.detectChanges();

        expect(activeEntry.consumed).toBe(2);
        expect(owner.setCritSlot).toHaveBeenCalledWith(activeEntry.source as CriticalSlot);
        expect(binRows[0].querySelector('.ammo-count')?.textContent?.trim()).toBe('3/5');
    });

    it('keeps rebuilt groups open after a bin changes ammo type', () => {
        const standardAmmo = createAmmo('Clan Ultra AC/20 Ammo');
        const precisionAmmo = createAmmo('Clan Ultra AC/20 Precision Ammo');
        const owner = {
            id: 'unit-1',
            readOnly: () => false,
            getUnit: () => ({ techBase: 'Clan' }),
        } as unknown as Pick<CBTForceUnit, 'id' | 'readOnly' | 'getUnit'>;
        const changedEntry = createCritEntry({ loc: 'LT', slot: 0, ammo: standardAmmo, owner });
        const remainingEntry = createCritEntry({ loc: 'LT', slot: 1, ammo: standardAmmo, owner });
        const data: AmmoLoadoutPanelData = {
            entries: [changedEntry, remainingEntry],
            getEntries: () => [changedEntry, remainingEntry],
            context: createCommandContext(),
        };
        const component = configurePanel(data);
        const group = component.groups()[0];

        component.toggleGroup(group);
        expect(component.isExpanded(group)).toBeTrue();

        changedEntry.currentAmmo = precisionAmmo;
        changedEntry.displayName = precisionAmmo.name;

        const rebuiltGroups = component.groups();

        expect(rebuiltGroups.length).toBe(2);
        expect(rebuiltGroups.every(rebuiltGroup => component.isExpanded(rebuiltGroup))).toBeTrue();
    });
});
