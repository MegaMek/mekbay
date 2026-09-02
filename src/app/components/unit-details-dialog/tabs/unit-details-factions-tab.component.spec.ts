// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import { provideZonelessChangeDetection } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';

import type { Era } from '../../../models/eras.model';
import type { Faction } from '../../../models/factions.model';
import type { MegaMekWeightedAvailabilityRecord } from '../../../models/megamek/availability.model';
import { MULFACTION_EXTINCT } from '../../../models/mulfactions.model';
import type { UnitSummary } from '../../../models/unit-summary.model';
import { DataService } from '../../../services/data.service';
import { createEmptyUnit } from '../../../testing/unit-test-helpers';
import { UnitAvailabilitySourceService } from '../../../services/unit-availability-source.service';
import { UnitDetailsFactionsTabGridComponent } from './unit-details-factions-tab-grid.component';
import { UnitDetailsFactionsTabListComponent } from './unit-details-factions-tab-list.component';
import { UnitDetailsFactionTabComponent } from './unit-details-factions-tab.component';

const TEST_ICON_SRC = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==';

describe('UnitDetailsFactionTabComponent', () => {
    const eras: Era[] = [
        {
            id: 3050,
            name: 'Clan Invasion',
            img: '',
            years: { from: 3050, to: 3061 },
            units: new Set([1]),
            factions: [],
        } as Era,
        {
            id: 3151,
            name: 'ilClan',
            img: '',
            years: { from: 3151, to: 9999 },
            units: new Set<number>(),
            factions: [],
        } as Era,
    ];
    const factions: Faction[] = [
        {
            id: 7,
            name: 'Draconis Combine',
            group: 'Inner Sphere',
            img: '/images/factions/draconis-combine-100.png',
            eras: {
                3050: new Set([1]),
            },
        } as Faction,
        {
            id: 8,
            name: 'Mercenaries',
            group: 'Mercenary',
            img: '',
            eras: {
                3050: new Set([2]),
            },
        } as Faction,
        {
            id: MULFACTION_EXTINCT,
            name: 'Extinct',
            group: 'Other',
            img: '',
            eras: {
                3050: new Set([1]),
            },
        } as Faction,
    ];
    const unit = createEmptyUnit({
        id: 1,
        name: 'Atlas',
        chassis: 'Atlas',
        model: 'AS7-D',
        type: 'Mek',
    });

    let megaMekAvailabilityRecord: MegaMekWeightedAvailabilityRecord | undefined;
    let useMegaMekAvailability = false;

    const dataServiceMock = {
        getEras: jasmine.createSpy('getEras').and.callFake(() => eras),
        getFactions: jasmine.createSpy('getFactions').and.callFake(() => factions),
        getMegaMekAvailabilityRecordForUnit: jasmine.createSpy('getMegaMekAvailabilityRecordForUnit').and.callFake(() => megaMekAvailabilityRecord),
    };
    const unitAvailabilitySourceMock = {
        useMegaMekAvailability: jasmine.createSpy('useMegaMekAvailability').and.callFake(() => useMegaMekAvailability),
        getUnitAvailabilityKey: jasmine.createSpy('getUnitAvailabilityKey'),
        getFactionEraUnitIds: jasmine.createSpy('getFactionEraUnitIds'),
    };

    beforeEach(() => {
        megaMekAvailabilityRecord = {
            n: unit.name,
            e: {
                '3050': {
                    '7': [70, 30],
                },
            },
        };
        useMegaMekAvailability = false;

        dataServiceMock.getEras.calls.reset();
        dataServiceMock.getFactions.calls.reset();
        dataServiceMock.getMegaMekAvailabilityRecordForUnit.calls.reset();
        unitAvailabilitySourceMock.useMegaMekAvailability.calls.reset();
        unitAvailabilitySourceMock.getUnitAvailabilityKey.calls.reset();
        unitAvailabilitySourceMock.getFactionEraUnitIds.calls.reset();

        TestBed.configureTestingModule({
            imports: [UnitDetailsFactionTabComponent],
            providers: [
                provideZonelessChangeDetection(),
                { provide: DataService, useValue: dataServiceMock },
                { provide: UnitAvailabilitySourceService, useValue: unitAvailabilitySourceMock },
            ],
        });
    });

    it('omits Extinct from the grid while preserving it in shared MUL availability', () => {
        const fixture = TestBed.createComponent(UnitDetailsFactionTabComponent);
        fixture.componentRef.setInput('unit', unit);
        fixture.detectChanges();

        const element = fixture.nativeElement as HTMLElement;
        const disclaimer = element.querySelector('.availability-source-disclaimer');
        const factionRows = Array.from(element.querySelectorAll('.faction-row'));
        const availabilityBadges = Array.from(element.querySelectorAll('.faction-megamek-availability-badge'));
        const badgeLabels = availabilityBadges.map((badge) => badge.getAttribute('aria-label'));
        const draconisCombineRow = factionRows.find((row) => row.textContent?.includes('Draconis Combine'));
        const mercenariesRow = factionRows.find((row) => row.textContent?.includes('Mercenaries'));
        const extinctRow = factionRows.find((row) => row.textContent?.includes('Extinct'));

        expect(disclaimer).toBeNull();
        expect(factionRows.length).toBe(1);
        expect(draconisCombineRow).toBeTruthy();
        expect(mercenariesRow).toBeUndefined();
        expect(extinctRow).toBeUndefined();
        expect(draconisCombineRow?.querySelectorAll('.faction-megamek-availability-badge').length).toBe(2);
        expect(draconisCombineRow?.querySelector('.faction-row-heading .faction-logo')).toBeTruthy();
        expect(draconisCombineRow?.querySelector('.availability-cell .cell-faction-logo')).toBeTruthy();
        expect(badgeLabels).toEqual(['Requisition: Common', 'Salvage: Rare']);
        expect(dataServiceMock.getMegaMekAvailabilityRecordForUnit).toHaveBeenCalledWith(unit);
        expect(unitAvailabilitySourceMock.useMegaMekAvailability).toHaveBeenCalled();
        expect(unitAvailabilitySourceMock.getFactionEraUnitIds).not.toHaveBeenCalled();
        expect(unitAvailabilitySourceMock.getUnitAvailabilityKey).not.toHaveBeenCalled();

        const viewModel = fixture.componentInstance.factionAvailability();
        expect(viewModel[0].factions.find((faction) => faction.name === 'Draconis Combine')?.megaMekTooltip).toEqual([
            {
                value: 'Draconis Combine',
                iconSrc: '/images/factions/draconis-combine-100.png',
                iconAlt: 'Draconis Combine',
                isHeader: true,
            },
            {
                label: 'Requisition',
                value: 'Common',
            },
            {
                label: 'Salvage',
                value: 'Rare',
            },
        ]);
        expect(viewModel[0].factions.find((faction) => faction.name === 'Extinct')?.megaMekTooltip).toBeNull();

        const listButton = Array.from(element.querySelectorAll<HTMLButtonElement>('.mode-switch-label-button'))
            .find((button) => button.textContent?.trim() === 'List');
        listButton?.click();
        fixture.detectChanges();

        expect(element.querySelector('.faction-availability-list')?.textContent).toContain('Extinct');
    });

    it('renders eras as columns and sorts logo-backed faction rows alphabetically', () => {
        const originalFactionCount = factions.length;
        const originalEraImage = eras[0].img;
        eras[0].img = TEST_ICON_SRC;
        factions.push({
            id: 77,
            name: 'Clan Sea Fox',
            group: 'Clan',
            img: TEST_ICON_SRC,
            eras: {
                3050: new Set([1]),
            },
        } as unknown as Faction);
        megaMekAvailabilityRecord = {
            n: unit.name,
            e: {
                '3050': {
                    '7': [7, 3],
                    '77': [6, 0],
                },
            },
        };

        try {
            const fixture = TestBed.createComponent(UnitDetailsFactionTabComponent);
            fixture.componentRef.setInput('unit', unit);
            fixture.detectChanges();

            const element = fixture.nativeElement as HTMLElement;
            const eraHeaders = Array.from(element.querySelectorAll('.era-column-heading'));
            const factionHeadings = Array.from(element.querySelectorAll('.faction-row-heading'));
            const grid = fixture.debugElement.query(By.directive(UnitDetailsFactionsTabGridComponent))
                .componentInstance as UnitDetailsFactionsTabGridComponent;
            const matrix = grid.availabilityMatrix();
            const clanSeaFoxRow = matrix.rows.find((row) => row.name === 'Clan Sea Fox');

            expect(eraHeaders.length).toBe(2);
            expect(eraHeaders[0].textContent).toContain('Clan Invasion');
            expect(eraHeaders[0].querySelector('.era-icon')).toBeTruthy();
            expect(eraHeaders[1].textContent).toContain('ilClan');
            expect(getComputedStyle(eraHeaders[0]).width).toBe('60px');
            expect(matrix.eras.map((era) => era.eraName)).toEqual(['Clan Invasion', 'ilClan']);
            expect(matrix.rows.map((row) => row.name)).toEqual([
                'Clan Sea Fox',
                'Draconis Combine',
            ]);
            expect(factionHeadings.map((heading) => heading.querySelector('.faction-name')?.textContent?.trim())).toEqual([
                'Clan Sea Fox',
                'Draconis Combine',
            ]);
            expect(clanSeaFoxRow?.cells[0]).not.toBeNull();
            expect(clanSeaFoxRow?.cells[1]).toBeNull();
            expect(factionHeadings[0].querySelector('.faction-logo')).toBeTruthy();
        } finally {
            factions.length = originalFactionCount;
            eras[0].img = originalEraImage;
        }
    });

    it('uses an era short name only for the visible grid column heading', () => {
        const originalShortName = eras[0].shortName;
        eras[0].shortName = 'Clan Inv.';

        try {
            const fixture = TestBed.createComponent(UnitDetailsFactionTabComponent);
            fixture.componentRef.setInput('unit', unit);
            fixture.detectChanges();

            const firstHeader = fixture.nativeElement.querySelector('.era-column-heading') as HTMLElement;

            expect(firstHeader.querySelector('.era-name')?.textContent?.trim()).toBe('Clan Inv.');
            expect(firstHeader.title).toBe('Clan Invasion');
            expect(fixture.componentInstance.factionAvailability()[0].eraShortName).toBe('Clan Inv.');
        } finally {
            eras[0].shortName = originalShortName;
        }
    });

    it('keeps every era column when the unit has no faction rows', () => {
        const fixture = TestBed.createComponent(UnitDetailsFactionTabComponent);
        fixture.componentRef.setInput('unit', createEmptyUnit({
            id: 999,
            name: 'No Factions',
            chassis: 'No Factions',
            model: '',
            type: 'Mek',
        }));
        fixture.detectChanges();

        const element = fixture.nativeElement as HTMLElement;
        const eraHeaders = Array.from(element.querySelectorAll('.era-column-heading'));
        const noFactionsCell = element.querySelector<HTMLTableCellElement>('.no-factions-cell');

        expect(eraHeaders.map((header) => header.textContent?.trim())).toEqual([
            jasmine.stringContaining('Clan Invasion'),
            jasmine.stringContaining('ilClan'),
        ]);
        expect(element.querySelector('.faction-availability-matrix')).toBeTruthy();
        expect(element.querySelectorAll('.faction-row').length).toBe(0);
        expect(noFactionsCell?.colSpan).toBe(3);
        expect(noFactionsCell?.textContent).toContain('No faction availability information for this unit.');
    });

    it('only groups factions under a catchall that directly contains the unit in factions.json', () => {
        const originalFactions = [...factions];
        factions.splice(
            0,
            factions.length,
            {
                id: 70,
                name: 'Faction X',
                group: 'Inner Sphere',
                img: '',
                eras: {
                    3050: new Set([unit.id]),
                    3151: new Set([unit.id]),
                },
            } as Faction,
            {
                id: 71,
                name: 'Faction Y',
                group: 'Inner Sphere',
                img: '',
                eras: {
                    3050: new Set([unit.id]),
                    3151: new Set([unit.id]),
                },
            } as Faction,
            {
                id: 99,
                name: 'Inner Sphere General',
                group: 'Inner Sphere',
                img: '',
                eras: {
                    3050: new Set([unit.id]),
                    3151: new Set<number>(),
                },
            } as Faction,
        );
        useMegaMekAvailability = true;
        megaMekAvailabilityRecord = {
            n: unit.name,
            e: {
                '3050': {
                    '70': [5, 0],
                    '71': [5, 0],
                    '99': [5, 0],
                },
                '3151': {
                    '70': [5, 0],
                    '71': [5, 0],
                    '99': [5, 0],
                },
            },
        };

        try {
            const fixture = TestBed.createComponent(UnitDetailsFactionTabComponent);
            fixture.componentRef.setInput('unit', unit);
            fixture.detectChanges();

            const viewModel = fixture.componentInstance.factionAvailability();
            const clanInvasion = viewModel.find((era) => era.eraName === 'Clan Invasion');
            const ilClan = viewModel.find((era) => era.eraName === 'ilClan');

            expect(clanInvasion?.factions.map((faction) => faction.name)).toEqual(['Inner Sphere General']);
            expect(clanInvasion?.factions[0].collapsedFactions?.map((faction) => faction.name)).toEqual([
                'Faction X',
                'Faction Y',
            ]);
            expect(ilClan?.factions.map((faction) => faction.name)).toEqual(['Faction X', 'Faction Y']);
            expect(ilClan?.factions.some((faction) => faction.isCatchAll)).toBeFalse();

            const grid = fixture.debugElement.query(By.directive(UnitDetailsFactionsTabGridComponent))
                .componentInstance as UnitDetailsFactionsTabGridComponent;
            const matrix = grid.availabilityMatrix();
            expect(matrix.rows.map((row) => row.name)).toEqual(['Inner Sphere General']);
            expect(matrix.rows[0].subrows.map((row) => row.name)).toEqual(['Faction X', 'Faction Y']);
            expect(matrix.rows[0].cells[0]).not.toBeNull();
            expect(matrix.rows[0].cells[1]).toBeNull();
            expect(matrix.rows[0].subrows[0].cells.every((cell) => cell !== null)).toBeTrue();
            expect(matrix.rows[0].subrowAvailabilityCounts).toEqual([2, 2]);

            const element = fixture.nativeElement as HTMLElement;
            const toggle = element.querySelector<HTMLButtonElement>('.catch-all-toggle');
            const groupSummary = element.querySelector<HTMLButtonElement>('.group-cell-summary');
            expect(toggle?.getAttribute('aria-expanded')).toBe('false');
            expect(groupSummary?.querySelector('.group-cell-count')?.textContent?.trim()).toBe('2');
            expect(groupSummary?.getAttribute('aria-label')).toContain('2 grouped factions available in ilClan');
            expect(element.querySelectorAll('.faction-row').length).toBe(1);

            groupSummary?.click();
            fixture.detectChanges();

            expect(toggle?.getAttribute('aria-expanded')).toBe('true');
            expect(element.querySelectorAll('.faction-row').length).toBe(3);
            expect(Array.from(element.querySelectorAll('.faction-row.subrow .faction-name'))
                .map((name) => name.textContent?.trim())).toEqual(['Faction X', 'Faction Y']);

            const listButton = Array.from(element.querySelectorAll<HTMLButtonElement>('.mode-switch-label-button'))
                .find((button) => button.textContent?.trim() === 'List');
            listButton?.click();
            fixture.detectChanges();

            const listCatchAll = element.querySelector<HTMLElement>('.catch-all-faction .parent-faction');
            expect(element.querySelectorAll('.collapsed-faction-item').length).toBe(0);

            listCatchAll?.click();
            fixture.detectChanges();

            const collapsedItems = Array.from(element.querySelectorAll('.collapsed-faction-item'));
            expect(collapsedItems.length).toBe(2);
            expect(collapsedItems[0].textContent).toContain('Faction X');
            expect(collapsedItems[1].textContent).toContain('Faction Y');
        } finally {
            factions.splice(0, factions.length, ...originalFactions);
        }
    });

    it('renders MegaMek factions directly from the unit record and adds extinct eras', () => {
        useMegaMekAvailability = true;

        const fixture = TestBed.createComponent(UnitDetailsFactionTabComponent);
        fixture.componentRef.setInput('unit', unit);
        fixture.detectChanges();

        const element = fixture.nativeElement as HTMLElement;
        const disclaimer = element.querySelector('.availability-source-disclaimer');
        const viewModel = fixture.componentInstance.factionAvailability();

        expect(disclaimer?.textContent?.trim()).toBe("Availability source: MegaMek's RAT.");
        expect(viewModel.map((era) => era.eraName)).toEqual(['Clan Invasion', 'ilClan']);
        expect(viewModel[0].factions.map((faction) => faction.name)).toEqual(['Draconis Combine']);
        expect(viewModel[1].factions.map((faction) => faction.name)).toEqual(['Extinct']);
        expect(viewModel[0].factions[0].megaMekTooltip).toEqual([
            {
                value: 'Draconis Combine',
                iconSrc: '/images/factions/draconis-combine-100.png',
                iconAlt: 'Draconis Combine',
                isHeader: true,
            },
            {
                label: 'Requisition',
                value: 'Common',
            },
            {
                label: 'Salvage',
                value: 'Rare',
            },
        ]);
        expect(viewModel[1].factions[0].megaMekTooltip).toBeNull();
        expect(unitAvailabilitySourceMock.getFactionEraUnitIds).not.toHaveBeenCalled();
        expect(unitAvailabilitySourceMock.getUnitAvailabilityKey).not.toHaveBeenCalled();
    });

    it('switches between the grid and restored list layouts', () => {
        const fixture = TestBed.createComponent(UnitDetailsFactionTabComponent);
        fixture.componentRef.setInput('unit', unit);
        fixture.detectChanges();

        const element = fixture.nativeElement as HTMLElement;
        const listButton = Array.from(element.querySelectorAll<HTMLButtonElement>('.mode-switch-label-button'))
            .find((button) => button.textContent?.trim() === 'List');
        const gridButton = Array.from(element.querySelectorAll<HTMLButtonElement>('.mode-switch-label-button'))
            .find((button) => button.textContent?.trim() === 'Grid');
        const switchToolbar = element.querySelector<HTMLElement>('.view-switch-toolbar');

        expect(element.querySelector('.mode-switch-control')).toBeTruthy();
        expect(getComputedStyle(switchToolbar!).justifyContent).toBe('center');
        expect(gridButton?.getAttribute('aria-pressed')).toBe('true');
        expect(listButton?.getAttribute('aria-pressed')).toBe('false');
        expect(fixture.debugElement.query(By.directive(UnitDetailsFactionsTabGridComponent))).toBeTruthy();
        expect(fixture.debugElement.query(By.directive(UnitDetailsFactionsTabListComponent))).toBeNull();

        listButton?.click();
        fixture.detectChanges();

        expect(listButton?.getAttribute('aria-pressed')).toBe('true');
        expect(gridButton?.getAttribute('aria-pressed')).toBe('false');
        expect(fixture.debugElement.query(By.directive(UnitDetailsFactionsTabGridComponent))).toBeNull();
        expect(fixture.debugElement.query(By.directive(UnitDetailsFactionsTabListComponent))).toBeTruthy();
        expect(element.querySelector('.faction-availability-list')).toBeTruthy();
        expect(element.querySelectorAll('.era-name').length).toBe(1);
        expect(element.querySelector('.era-name')?.textContent).toContain('Clan Invasion');
        expect(element.querySelector('.faction-list')?.textContent).toContain('Draconis Combine');

        gridButton?.click();
        fixture.detectChanges();

        expect(fixture.debugElement.query(By.directive(UnitDetailsFactionsTabGridComponent))).toBeTruthy();
        expect(element.querySelector('.faction-availability-matrix')).toBeTruthy();
    });
});
