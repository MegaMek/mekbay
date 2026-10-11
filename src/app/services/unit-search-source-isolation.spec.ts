// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import { provideZonelessChangeDetection, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { GameSystem } from '../models/common.model';
import type { Era } from '../models/eras.model';
import type { Faction } from '../models/factions.model';
import type { AvailabilitySource } from '../models/options.model';
import { createEmptyUnit } from '../testing/unit-test-helpers';
import { MulAvailabilityIndex } from '../utils/mul-availability-index';
import { SEARCH_WORKER_FACTORY } from '../utils/unit-search-worker-factory.util';
import { DataService } from './data.service';
import { GameService } from './game.service';
import { LoggerService } from './logger.service';
import { OptionsService } from './options.service';
import { PublicTagsService } from './public-tags.service';
import { TagsService } from './tags.service';
import { UnitSearchFiltersService } from './unit-search-filters.service';
import { UrlService } from './url.service';
import { UserStateService } from './userState.service';

describe('UnitSearchFiltersService availability source isolation', () => {
    const unit = createEmptyUnit({ name: 'Different MUL and RAT membership', mul1id: 42 });
    const era: Era = { id: 100, name: 'Early', years: {}, factions: [10], units: new Set([42]) };
    const mulFaction: Faction = { id: 10, name: 'MUL faction', group: 'Other', img: '', eras: { 100: new Set([42]) } };
    const ratFaction: Faction = { id: 20, name: 'RAT faction', group: 'Other', img: '', eras: {} };
    const factions = [mulFaction, ratFaction];
    const options = signal({ availabilitySource: 'mul' as AvailabilitySource, megaMekAvailabilityFiltersUseAllScopedOptions: false });
    let service: UnitSearchFiltersService;
    let getMulIndex: jasmine.Spy;

    beforeEach(() => {
        options.set({ availabilitySource: 'mul', megaMekAvailabilityFiltersUseAllScopedOptions: false });
        getMulIndex = jasmine.createSpy('getMulAvailabilityIndex')
            .and.returnValue(new MulAvailabilityIndex([unit], [era], factions));
        TestBed.configureTestingModule({ providers: [
            provideZonelessChangeDetection(),
            { provide: DataService, useValue: {
                isDataReady: () => false,
                searchCorpusVersion: signal(1), megaMekAvailabilityVersion: signal(1), tagsVersion: signal(0),
                getUnits: () => [unit], getEras: () => [era], getFactions: () => factions,
                getEraByName: (name: string) => name === era.name ? era : undefined,
                getFactionByName: (name: string) => factions.find(faction => faction.name === name),
                getFactionById: (id: number) => factions.find(faction => faction.id === id),
                getMulAvailabilityIndex: getMulIndex,
                getMegaMekAvailabilityRecordForUnit: () => ({ n: unit.name, e: { 100: { 20: [10, 0] } } }),
            } },
            { provide: OptionsService, useValue: { options, initialized: signal(true) } },
            { provide: GameService, useValue: { currentGameSystem: signal(GameSystem.CLASSIC) } },
            { provide: LoggerService, useValue: { info: () => undefined } },
            { provide: SEARCH_WORKER_FACTORY, useValue: null },
            { provide: UrlService, useValue: { initialParams: new URLSearchParams(), getInitialParam: () => null } },
            { provide: UserStateService, useValue: {} },
            { provide: PublicTagsService, useValue: {} },
            { provide: TagsService, useValue: {} },
        ] });
        service = TestBed.inject(UnitSearchFiltersService);
    });

    it('uses only RAT after switching sources, even when a search scope retains its MUL setting', () => {
        const scope = { eraNames: [era.name], factionNames: [ratFaction.name], bridgeThroughMulMembership: true };
        expect(service.getMegaMekAvailabilityBadges(unit, scope)).toEqual([]);

        options.update(value => ({ ...value, availabilitySource: 'megamek' }));
        getMulIndex.calls.reset();
        getMulIndex.and.throwError('RAT search must not consult MUL');

        expect(service.unitBelongsToEra(unit, era.name)).toBeTrue();
        expect(service.unitBelongsToFaction(unit, ratFaction.name)).toBeTrue();
        expect(service.unitBelongsToEra(unit, era.name, scope)).toBeTrue();
        expect(service.unitBelongsToFaction(unit, mulFaction.name, [era.name])).toBeFalse();
        expect(service.getMegaMekAvailabilityBadges(unit, scope))
            .toEqual([{ source: 'Requisition', score: 10, rarity: 'Very Rare' }]);
        expect(getMulIndex).not.toHaveBeenCalled();
    });

    it('uses MUL membership and RAT rarity in MUL mode', () => {
        const scope = { eraNames: [era.name], factionNames: [mulFaction.name] };
        const data = TestBed.inject(DataService);
        spyOn(data, 'getMegaMekAvailabilityRecordForUnit').and.returnValue({
            n: unit.name, e: { 100: { 10: [70, 0], 20: [10, 0] } },
        });

        expect(service.unitBelongsToFaction(unit, mulFaction.name, [era.name])).toBeTrue();
        expect(service.unitBelongsToFaction(unit, ratFaction.name, [era.name])).toBeFalse();
        expect(service.getMegaMekAvailabilityBadges(unit, scope))
            .toEqual([{ source: 'Requisition', score: 70, rarity: 'Common' }]);
    });
});
