import { provideZonelessChangeDetection } from '@angular/core';
import { TestBed } from '@angular/core/testing';

import type { Era } from '../../../models/eras.model';
import type { Faction } from '../../../models/factions.model';
import type { MegaMekWeightedAvailabilityRecord } from '../../../models/megamek/availability.model';
import { MULFACTION_EXTINCT } from '../../../models/mulfactions.model';
import type { Unit } from '../../../models/units.model';
import { DataService } from '../../../services/data.service';
import { UnitAvailabilitySourceService } from '../../../services/unit-availability-source.service';
import { UnitDetailsFactionTabComponent } from './unit-details-factions-tab.component';

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
            img: '/assets/draconis-combine.png',
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
    const unit = {
        id: 1,
        name: 'Atlas',
        chassis: 'Atlas',
        model: 'AS7-D',
        type: 'Mek',
    } as Unit;

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
                    '7': [7, 3],
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

    it('renders MUL factions from direct membership and keeps Extinct without MegaMek badges', () => {
        const fixture = TestBed.createComponent(UnitDetailsFactionTabComponent);
        fixture.componentRef.setInput('unit', unit);
        fixture.detectChanges();

        const element = fixture.nativeElement as HTMLElement;
        const factionItems = Array.from(element.querySelectorAll('.faction-item'));
        const availabilityBadges = Array.from(element.querySelectorAll('.faction-megamek-availability-badge'));
        const badgeLabels = availabilityBadges.map((badge) => badge.getAttribute('aria-label'));
        const draconisCombineItem = factionItems.find((item) => item.textContent?.includes('Draconis Combine'));
        const mercenariesItem = factionItems.find((item) => item.textContent?.includes('Mercenaries'));
        const extinctItem = factionItems.find((item) => item.textContent?.includes('Extinct'));

        expect(factionItems.length).toBe(2);
        expect(draconisCombineItem).toBeTruthy();
        expect(mercenariesItem).toBeUndefined();
        expect(extinctItem).toBeTruthy();
        expect(draconisCombineItem?.querySelectorAll('.faction-megamek-availability-badge').length).toBe(2);
        expect(extinctItem?.querySelectorAll('.faction-megamek-availability-badge').length).toBe(0);
        expect(badgeLabels).toEqual(['Production: Common', 'Salvage: Rare']);
        expect(dataServiceMock.getMegaMekAvailabilityRecordForUnit).toHaveBeenCalledWith(unit);
        expect(unitAvailabilitySourceMock.useMegaMekAvailability).toHaveBeenCalled();
        expect(unitAvailabilitySourceMock.getFactionEraUnitIds).not.toHaveBeenCalled();
        expect(unitAvailabilitySourceMock.getUnitAvailabilityKey).not.toHaveBeenCalled();

        const viewModel = fixture.componentInstance.factionAvailability();
        expect(viewModel[0].factions.find((faction) => faction.name === 'Draconis Combine')?.megaMekTooltip).toEqual([
            {
                value: 'Draconis Combine',
                iconSrc: '/assets/draconis-combine.png',
                iconAlt: 'Draconis Combine',
                isHeader: true,
            },
            {
                label: 'Production',
                value: 'Common',
            },
            {
                label: 'Salvage',
                value: 'Rare',
            },
        ]);
        expect(viewModel[0].factions.find((faction) => faction.name === 'Extinct')?.megaMekTooltip).toBeNull();
    });

    it('renders MegaMek factions directly from the unit record and adds extinct eras', () => {
        useMegaMekAvailability = true;

        const fixture = TestBed.createComponent(UnitDetailsFactionTabComponent);
        fixture.componentRef.setInput('unit', unit);
        fixture.detectChanges();

        const viewModel = fixture.componentInstance.factionAvailability();

        expect(viewModel.map((era) => era.eraName)).toEqual(['Clan Invasion', 'ilClan']);
        expect(viewModel[0].factions.map((faction) => faction.name)).toEqual(['Draconis Combine']);
        expect(viewModel[1].factions.map((faction) => faction.name)).toEqual(['Extinct']);
        expect(viewModel[0].factions[0].megaMekTooltip).toEqual([
            {
                value: 'Draconis Combine',
                iconSrc: '/assets/draconis-combine.png',
                iconAlt: 'Draconis Combine',
                isHeader: true,
            },
            {
                label: 'Production',
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
});