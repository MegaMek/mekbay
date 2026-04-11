import { provideZonelessChangeDetection } from '@angular/core';
import { TestBed } from '@angular/core/testing';

import type { Era } from '../../../models/eras.model';
import type { Faction } from '../../../models/factions.model';
import { MULFACTION_EXTINCT } from '../../../models/mulfactions.model';
import type { Unit } from '../../../models/units.model';
import { DataService } from '../../../services/data.service';
import type { MegaMekUnitAvailabilityDetail } from '../../../services/unit-availability-source.service';
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
                3050: new Set([1]),
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

    const dataServiceMock = {
        getEras: jasmine.createSpy('getEras').and.callFake(() => eras),
        getFactions: jasmine.createSpy('getFactions').and.callFake(() => factions),
    };
    const unitAvailabilitySourceMock = {
        getUnitAvailabilityKey: jasmine.createSpy('getUnitAvailabilityKey').and.callFake((inputUnit: Unit) => inputUnit.name),
        getFactionEraUnitIds: jasmine.createSpy('getFactionEraUnitIds').and.callFake((faction: Faction, era: Era) => {
            if (era.id !== 3050) {
                return new Set<string>();
            }

            if (faction.id === 7 || faction.id === MULFACTION_EXTINCT) {
                return new Set<string>([unit.name]);
            }

            return new Set<string>();
        }),
        getMegaMekAvailabilityDetails: jasmine.createSpy('getMegaMekAvailabilityDetails').and.callFake((_: Unit, faction: Faction, era: Era): MegaMekUnitAvailabilityDetail[] => {
            if (era.id !== 3050) {
                return [];
            }

            if (faction.id === 7) {
                return [
                    { source: 'Production', score: 7, rarity: 'Common' },
                    { source: 'Salvage', score: 3, rarity: 'Rare' },
                ];
            }

            if (faction.id === 8) {
                return [
                    { source: 'Salvage', score: 5, rarity: 'Uncommon' },
                ];
            }

            return [];
        }),
    };

    beforeEach(() => {
        dataServiceMock.getEras.calls.reset();
        dataServiceMock.getFactions.calls.reset();
        unitAvailabilitySourceMock.getUnitAvailabilityKey.calls.reset();
        unitAvailabilitySourceMock.getFactionEraUnitIds.calls.reset();
        unitAvailabilitySourceMock.getMegaMekAvailabilityDetails.calls.reset();

        TestBed.configureTestingModule({
            imports: [UnitDetailsFactionTabComponent],
            providers: [
                provideZonelessChangeDetection(),
                { provide: DataService, useValue: dataServiceMock },
                { provide: UnitAvailabilitySourceService, useValue: unitAvailabilitySourceMock },
            ],
        });
    });

    it('renders factions from the active availability source and keeps Extinct without MegaMek badges', () => {
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
        expect(unitAvailabilitySourceMock.getFactionEraUnitIds).toHaveBeenCalled();

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
});