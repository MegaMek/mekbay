import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';

import { GameSystem } from '../models/common.model';
import type { Era } from '../models/eras.model';
import type { Faction } from '../models/factions.model';
import type { MegaMekFactionRecord } from '../models/megamek/factions.model';
import type { MegaMekRulesetRecord } from '../models/megamek/rulesets.model';
import { MULFACTION_EXTINCT, MULFACTION_MERCENARY } from '../models/mulfactions.model';
import type { AvailabilitySource } from '../models/options.model';
import type { Unit } from '../models/units.model';
import { LanceTypeIdentifierUtil } from '../utils/lance-type-identifier.util';
import { DataService } from './data.service';
import type { ForceGenerationContext } from './force-generator.service';
import { ForceGeneratorService } from './force-generator.service';
import { OptionsService } from './options.service';
import { UnitAvailabilitySourceService } from './unit-availability-source.service';
import { UnitSearchFiltersService } from './unit-search-filters.service';

describe('ForceGeneratorService', () => {
    let service: ForceGeneratorService;
    let unitAvailabilitySourceService: UnitAvailabilitySourceService;
    let consoleLogSpy: jasmine.Spy;

    const erasByName = new Map<string, Era>();
    const erasById = new Map<number, Era>();
    const factionsByName = new Map<string, Faction>();
    const factionsById = new Map<number, Faction>();
    const megaMekAvailabilityByUnitName = new Map<string, { e: Record<string, Record<string, [number, number]>> }>();
    const megaMekAvailabilityRecords: Array<{ e: Record<string, Record<string, [number, number]>> }> = [];
    const megaMekRulesetsByMulFactionId = new Map<number, MegaMekRulesetRecord[]>();
    const megaMekRulesetsByFactionKey = new Map<string, MegaMekRulesetRecord>();
    const megaMekFactionsByKey = new Map<string, MegaMekFactionRecord>();
    const units: Unit[] = [];
    const optionsServiceMock = {
        options: signal<{ availabilitySource: AvailabilitySource }>({ availabilitySource: 'megamek' }),
    };

    const filtersServiceMock = {
        filteredUnits: signal<Unit[]>([]),
        effectiveFilterState: jasmine.createSpy('effectiveFilterState').and.returnValue({}),
    };

    const dataServiceMock = {
        searchCorpusVersion: signal(1),
        getUnits: jasmine.createSpy('getUnits').and.callFake(() => units),
        getEras: jasmine.createSpy('getEras').and.callFake(() => [...erasById.values()]),
        getEraById: jasmine.createSpy('getEraById').and.callFake((id: number) => erasById.get(id)),
        getEraByName: jasmine.createSpy('getEraByName').and.callFake((name: string) => erasByName.get(name)),
        getFactions: jasmine.createSpy('getFactions').and.callFake(() => [...factionsById.values()]),
        getFactionById: jasmine.createSpy('getFactionById').and.callFake((id: number) => factionsById.get(id)),
        getFactionByName: jasmine.createSpy('getFactionByName').and.callFake((name: string) => factionsByName.get(name)),
        getMegaMekAvailabilityRecords: jasmine.createSpy('getMegaMekAvailabilityRecords').and.callFake(() => megaMekAvailabilityRecords),
        getMegaMekAvailabilityRecordForUnit: jasmine.createSpy('getMegaMekAvailabilityRecordForUnit').and.callFake((unit: Pick<Unit, 'name'>) => {
            return megaMekAvailabilityByUnitName.get(unit.name);
        }),
        getMegaMekRulesetsByMulFactionId: jasmine.createSpy('getMegaMekRulesetsByMulFactionId').and.callFake((mulFactionId: number) => {
            return megaMekRulesetsByMulFactionId.get(mulFactionId) ?? [];
        }),
        getMegaMekRulesetByFactionKey: jasmine.createSpy('getMegaMekRulesetByFactionKey').and.callFake((factionKey: string) => {
            return megaMekRulesetsByFactionKey.get(factionKey);
        }),
        getMegaMekFactionByKey: jasmine.createSpy('getMegaMekFactionByKey').and.callFake((factionKey: string) => {
            return megaMekFactionsByKey.get(factionKey);
        }),
    };

    function createEra(id: number, name: string, fromYear = 3151, toYear = 3152): Era {
        return {
            id,
            name,
            years: { from: fromYear, to: toYear },
            factions: [],
            units: [],
        } as Era;
    }

    function createFaction(id: number, name: string): Faction {
        return {
            id,
            name,
            group: 'Inner Sphere',
            img: '',
            eras: {},
        } as Faction;
    }

    function createUnit(overrides: Partial<Unit> = {}): Unit {
        const type = overrides.type ?? 'Mek';
        const subtype = overrides.subtype ?? 'BattleMek';
        const moveType = overrides.moveType ?? 'Tracked';
        const alphaStrikeType = overrides.as?.TP ?? (() => {
            if (type === 'Mek') return 'BM';
            if (type === 'ProtoMek') return 'PM';
            if (type === 'Infantry') return subtype === 'Battle Armor' ? 'BA' : 'CI';
            if (type === 'VTOL') return 'CV';
            if (type === 'Aero') return subtype === 'Conventional Fighter' ? 'CF' : 'AF';
            return 'CV';
        })();

        return {
            id: overrides.id ?? 1,
            name: overrides.name ?? 'Test Unit',
            chassis: overrides.chassis ?? 'Test',
            model: overrides.model ?? 'TST-1',
            year: overrides.year ?? 3151,
            weightClass: overrides.weightClass ?? 'Medium',
            tons: overrides.tons ?? 50,
            offSpeedFactor: overrides.offSpeedFactor ?? 0,
            bv: overrides.bv ?? 1000,
            pv: overrides.pv ?? 0,
            cost: overrides.cost ?? 0,
            level: overrides.level ?? 0,
            techBase: overrides.techBase ?? 'Inner Sphere',
            techRating: overrides.techRating ?? 'D',
            role: overrides.role ?? 'skirmisher',
            type,
            subtype,
            omni: overrides.omni ?? 0,
            engine: overrides.engine ?? 'Fusion',
            engineRating: overrides.engineRating ?? 0,
            engineHS: overrides.engineHS ?? 0,
            engineHSType: overrides.engineHSType ?? 'Heat Sink',
            source: overrides.source ?? [],
            armorType: overrides.armorType ?? '',
            structureType: overrides.structureType ?? '',
            armor: overrides.armor ?? 0,
            armorPer: overrides.armorPer ?? 0,
            internal: overrides.internal ?? 1,
            heat: overrides.heat ?? 0,
            dissipation: overrides.dissipation ?? 0,
            moveType,
            walk: overrides.walk ?? 0,
            walk2: overrides.walk2 ?? 0,
            run: overrides.run ?? 0,
            run2: overrides.run2 ?? 0,
            jump: overrides.jump ?? 0,
            jump2: overrides.jump2 ?? 0,
            umu: overrides.umu ?? 0,
            c3: overrides.c3 ?? '',
            dpt: overrides.dpt ?? 0,
            comp: overrides.comp ?? [],
            su: overrides.su ?? 0,
            crewSize: overrides.crewSize ?? 1,
            quirks: overrides.quirks ?? [],
            features: overrides.features ?? [],
            icon: overrides.icon ?? '',
            sheets: overrides.sheets ?? [],
            as: {
                TP: alphaStrikeType,
                PV: overrides.as?.PV ?? 5,
                SZ: overrides.as?.SZ ?? 0,
                TMM: overrides.as?.TMM ?? 0,
                usesOV: overrides.as?.usesOV ?? false,
                OV: overrides.as?.OV ?? 0,
                MV: overrides.as?.MV ?? '0',
                MVm: overrides.as?.MVm ?? {},
                usesTh: overrides.as?.usesTh ?? false,
                Th: overrides.as?.Th ?? 0,
                Arm: overrides.as?.Arm ?? 0,
                Str: overrides.as?.Str ?? 0,
                specials: overrides.as?.specials ?? [],
                dmg: {
                    dmgS: overrides.as?.dmg?.dmgS ?? '0',
                    dmgM: overrides.as?.dmg?.dmgM ?? '0',
                    dmgL: overrides.as?.dmg?.dmgL ?? '0',
                    dmgE: overrides.as?.dmg?.dmgE ?? '0',
                    _dmgS: overrides.as?.dmg?._dmgS,
                    _dmgM: overrides.as?.dmg?._dmgM,
                    _dmgL: overrides.as?.dmg?._dmgL,
                    _dmgE: overrides.as?.dmg?._dmgE,
                },
                usesE: overrides.as?.usesE ?? false,
                usesArcs: overrides.as?.usesArcs ?? false,
                ...overrides.as,
            },
            _searchKey: overrides._searchKey ?? '',
            _displayType: overrides._displayType ?? '',
            _maxRange: overrides._maxRange ?? 0,
            _dissipationEfficiency: overrides._dissipationEfficiency ?? 0,
            _mdSumNoPhysical: overrides._mdSumNoPhysical ?? 0,
            _mdSumNoPhysicalNoOneshots: overrides._mdSumNoPhysicalNoOneshots ?? 0,
            _nameTags: overrides._nameTags ?? [],
            _chassisTags: overrides._chassisTags ?? [],
        } as Unit;
    }

    function createContext(forceFaction: Faction, forceEra: Era): ForceGenerationContext {
        return {
            forceFaction,
            forceEra,
            availabilityFactionIds: [forceFaction.id],
            availabilityEraIds: [forceEra.id],
            useAvailabilityFactionScope: false,
            useAvailabilityEraScope: false,
            availablePairCount: 1,
            ruleset: null,
        };
    }

    beforeEach(() => {
        erasByName.clear();
        erasById.clear();
        factionsByName.clear();
        factionsById.clear();
        megaMekAvailabilityByUnitName.clear();
        megaMekAvailabilityRecords.length = 0;
        megaMekRulesetsByMulFactionId.clear();
        megaMekRulesetsByFactionKey.clear();
        megaMekFactionsByKey.clear();
        units.length = 0;
        dataServiceMock.searchCorpusVersion.set(1);
        optionsServiceMock.options.set({ availabilitySource: 'megamek' });

        filtersServiceMock.filteredUnits.set([]);
        filtersServiceMock.effectiveFilterState.calls.reset();
        filtersServiceMock.effectiveFilterState.and.returnValue({});

        for (const spy of Object.values(dataServiceMock)) {
            if ('calls' in spy) {
                spy.calls.reset();
            }
        }

        consoleLogSpy = spyOn(console, 'log');

        TestBed.configureTestingModule({
            providers: [
                ForceGeneratorService,
                { provide: DataService, useValue: dataServiceMock },
                { provide: OptionsService, useValue: optionsServiceMock },
                UnitAvailabilitySourceService,
                { provide: UnitSearchFiltersService, useValue: filtersServiceMock },
            ],
        });

        service = TestBed.inject(ForceGeneratorService);
        unitAvailabilitySourceService = TestBed.inject(UnitAvailabilitySourceService);
    });

    it('uses the stored force generator defaults when no unit-search limit is active', () => {
        const defaults = service.resolveInitialBudgetDefaults({
            forceGenLastBVMin: 7900,
            forceGenLastBVMax: 8000,
            forceGenLastPVMin: 290,
            forceGenLastPVMax: 300,
        }, 0, GameSystem.CLASSIC);

        expect(defaults).toEqual({
            classic: { min: 7900, max: 8000 },
            alphaStrike: { min: 290, max: 300 },
        });
    });

    it('clamps the initial range to the active unit-search limit', () => {
        const defaults = service.resolveInitialBudgetDefaults({
            forceGenLastBVMin: 7900,
            forceGenLastBVMax: 8000,
            forceGenLastPVMin: 290,
            forceGenLastPVMax: 300,
        }, 6500, GameSystem.CLASSIC);

        expect(defaults.classic).toEqual({ min: 6500, max: 6500 });
        expect(defaults.alphaStrike).toEqual({ min: 290, max: 300 });
    });

    it('uses the stored force generator unit count defaults', () => {
        const defaults = service.resolveInitialUnitCountDefaults({
            forceGenLastMinUnitCount: 4,
            forceGenLastMaxUnitCount: 8,
        });

        expect(defaults).toEqual({ min: 4, max: 8 });
    });

    it('normalizes stored unit count defaults to a valid linked range', () => {
        const invalidDefaults = service.resolveInitialUnitCountDefaults({
            forceGenLastMinUnitCount: 6,
            forceGenLastMaxUnitCount: 2,
        });
        const emptyDefaults = service.resolveInitialUnitCountDefaults({
            forceGenLastMinUnitCount: 0,
            forceGenLastMaxUnitCount: 0,
        });

        expect(invalidDefaults).toEqual({ min: 6, max: 6 });
        expect(emptyDefaults).toEqual({ min: 1, max: 1 });
    });

    it('caps stored unit count defaults at MAX_UNITS', () => {
        const defaults = service.resolveInitialUnitCountDefaults({
            forceGenLastMinUnitCount: 120,
            forceGenLastMaxUnitCount: 150,
        });

        expect(defaults).toEqual({ min: 100, max: 100 });
    });

    it('raises the budget max to follow an edited minimum unless the max is unbounded', () => {
        expect(service.resolveBudgetRangeForEditedMin({ min: 5800, max: 5900 }, 6000)).toEqual({ min: 6000, max: 6000 });
        expect(service.resolveBudgetRangeForEditedMin({ min: 5800, max: 0 }, 6000)).toEqual({ min: 6000, max: 0 });
    });

    it('drops the budget min to follow an edited maximum and preserves zero as no maximum', () => {
        expect(service.resolveBudgetRangeForEditedMax({ min: 5800, max: 5900 }, 1)).toEqual({ min: 1, max: 1 });
        expect(service.resolveBudgetRangeForEditedMax({ min: 5800, max: 5900 }, 0)).toEqual({ min: 5800, max: 0 });
    });

    it('keeps unit counts linked to the edited minimum and maximum', () => {
        expect(service.resolveUnitCountRangeForEditedMin({ min: 4, max: 8 }, 10)).toEqual({ min: 10, max: 10 });
        expect(service.resolveUnitCountRangeForEditedMax({ min: 4, max: 8 }, 2)).toEqual({ min: 2, max: 2 });
    });

    it('never allows unit counts below one when editing either bound', () => {
        expect(service.resolveUnitCountRangeForEditedMin({ min: 4, max: 8 }, 0)).toEqual({ min: 1, max: 8 });
        expect(service.resolveUnitCountRangeForEditedMax({ min: 4, max: 8 }, 0)).toEqual({ min: 1, max: 1 });
    });

    it('never allows unit counts above MAX_UNITS when editing either bound', () => {
        expect(service.resolveUnitCountRangeForEditedMin({ min: 4, max: 8 }, 150)).toEqual({ min: 100, max: 100 });
        expect(service.resolveUnitCountRangeForEditedMax({ min: 4, max: 8 }, 150)).toEqual({ min: 4, max: 100 });
    });

    it('resolves explicit era and faction scope and picks a force faction from the selected factions', () => {
        const era = createEra(3150, 'ilClan');
        const federatedSuns = createFaction(10, 'Federated Suns');
        const lyranAlliance = createFaction(20, 'Lyran Alliance');
        const mercenary = createFaction(MULFACTION_MERCENARY, 'Mercenary');
        const unit = createUnit({ name: 'Atlas' });

        erasByName.set(era.name, era);
        erasById.set(era.id, era);
        factionsByName.set(federatedSuns.name, federatedSuns);
        factionsByName.set(lyranAlliance.name, lyranAlliance);
        factionsByName.set(mercenary.name, mercenary);
        factionsById.set(federatedSuns.id, federatedSuns);
        factionsById.set(lyranAlliance.id, lyranAlliance);
        factionsById.set(mercenary.id, mercenary);
        const availabilityRecord: { e: Record<string, Record<string, [number, number]>> } = {
            e: {
                '3150': {
                    '10': [3, 1],
                    '20': [2, 2],
                },
            },
        };
        megaMekAvailabilityByUnitName.set(unit.name, availabilityRecord);
        megaMekAvailabilityRecords.push(availabilityRecord);
        units.push(unit);

        filtersServiceMock.effectiveFilterState.and.returnValue({
            era: {
                interactedWith: true,
                value: ['ilClan'],
            },
            faction: {
                interactedWith: true,
                value: {
                    fs: { name: 'Federated Suns', state: 'or', count: 0 },
                    la: { name: 'Lyran Alliance', state: 'or', count: 0 },
                },
            },
        });

        spyOn(Math, 'random').and.returnValue(0.75);

        const context = service.resolveGenerationContext([unit]);

        expect(context.availabilityEraIds).toEqual([3150]);
        expect(context.availabilityFactionIds).toEqual([10, 20]);
        expect(context.useAvailabilityFactionScope).toBeTrue();
        expect(context.useAvailabilityEraScope).toBeFalse();
        expect(context.forceFaction).toBe(lyranAlliance);
        expect(context.forceEra).toBe(era);
        expect(context.availablePairCount).toBe(2);
    });

    it('uses Mercenary as the generated force faction and the remaining factions as scope when no positive faction is selected', () => {
        const era = createEra(3150, 'ilClan');
        const extinct = createFaction(MULFACTION_EXTINCT, 'Extinct');
        const federatedSuns = createFaction(10, 'Federated Suns');
        const lyranAlliance = createFaction(20, 'Lyran Alliance');
        const mercenary = createFaction(MULFACTION_MERCENARY, 'Mercenary');
        const unit = createUnit({ name: 'Atlas' });

        erasByName.set(era.name, era);
        erasById.set(era.id, era);
        factionsByName.set(extinct.name, extinct);
        factionsByName.set(federatedSuns.name, federatedSuns);
        factionsByName.set(lyranAlliance.name, lyranAlliance);
        factionsByName.set(mercenary.name, mercenary);
        factionsById.set(extinct.id, extinct);
        factionsById.set(federatedSuns.id, federatedSuns);
        factionsById.set(lyranAlliance.id, lyranAlliance);
        factionsById.set(mercenary.id, mercenary);
        megaMekAvailabilityByUnitName.set(unit.name, {
            e: {
                '3150': {
                    '20': [3, 1],
                },
            },
        });

        filtersServiceMock.effectiveFilterState.and.returnValue({
            era: {
                interactedWith: true,
                value: ['ilClan'],
            },
            faction: {
                interactedWith: true,
                value: {
                    fs: { name: 'Federated Suns', state: 'not', count: 1 },
                    merc: { name: 'Mercenary', state: 'not', count: 1 },
                },
            },
        });

        const context = service.resolveGenerationContext([unit]);

        expect(context.forceFaction).toBe(mercenary);
        expect(context.forceEra).toBe(era);
        expect(context.availabilityFactionIds).toEqual([20]);
        expect(context.useAvailabilityFactionScope).toBeTrue();
    });

    it('limits implicit faction scope to factions with positive availability in the selected era', () => {
        const ilClan = createEra(3150, 'ilClan');
        const jihad = createEra(3067, 'Jihad');
        const capellanConfederation = createFaction(10, 'Capellan Confederation');
        const federatedSuns = createFaction(20, 'Federated Suns');
        const lyranAlliance = createFaction(30, 'Lyran Alliance');
        const draconisCombine = createFaction(40, 'Draconis Combine');
        const mercenary = createFaction(MULFACTION_MERCENARY, 'Mercenary');
        const unit = createUnit({ id: 8, name: 'Era Scoped Unit' });

        erasByName.set(ilClan.name, ilClan);
        erasById.set(ilClan.id, ilClan);
        erasByName.set(jihad.name, jihad);
        erasById.set(jihad.id, jihad);
        factionsByName.set(capellanConfederation.name, capellanConfederation);
        factionsByName.set(federatedSuns.name, federatedSuns);
        factionsByName.set(lyranAlliance.name, lyranAlliance);
        factionsByName.set(draconisCombine.name, draconisCombine);
        factionsByName.set(mercenary.name, mercenary);
        factionsById.set(capellanConfederation.id, capellanConfederation);
        factionsById.set(federatedSuns.id, federatedSuns);
        factionsById.set(lyranAlliance.id, lyranAlliance);
        factionsById.set(draconisCombine.id, draconisCombine);
        factionsById.set(mercenary.id, mercenary);
        megaMekAvailabilityByUnitName.set(unit.name, {
            e: {
                '3150': {
                    '20': [2, 0],
                    '30': [1, 1],
                },
                '3067': {
                    '40': [3, 0],
                },
            },
        });

        filtersServiceMock.effectiveFilterState.and.returnValue({
            era: {
                interactedWith: true,
                value: ['ilClan'],
            },
            faction: {
                interactedWith: false,
                value: {},
            },
        });

        const context = service.resolveGenerationContext([unit]);

        expect(context.forceFaction).toBe(mercenary);
        expect(context.forceEra).toBe(ilClan);
        expect(context.availabilityFactionIds).toEqual([20, 30]);
        expect(context.availablePairCount).toBe(2);
    });

    it('limits implicit faction scope to the rolled era when no era or faction is selected', () => {
        const ilClan = createEra(3150, 'ilClan');
        const jihad = createEra(3067, 'Jihad');
        const federatedSuns = createFaction(20, 'Federated Suns');
        const lyranAlliance = createFaction(30, 'Lyran Alliance');
        const draconisCombine = createFaction(40, 'Draconis Combine');
        const mercenary = createFaction(MULFACTION_MERCENARY, 'Mercenary');
        const unit = createUnit({ id: 9, name: 'Rolled Era Scoped Unit' });

        erasByName.set(ilClan.name, ilClan);
        erasById.set(ilClan.id, ilClan);
        erasByName.set(jihad.name, jihad);
        erasById.set(jihad.id, jihad);
        factionsByName.set(federatedSuns.name, federatedSuns);
        factionsByName.set(lyranAlliance.name, lyranAlliance);
        factionsByName.set(draconisCombine.name, draconisCombine);
        factionsByName.set(mercenary.name, mercenary);
        factionsById.set(federatedSuns.id, federatedSuns);
        factionsById.set(lyranAlliance.id, lyranAlliance);
        factionsById.set(draconisCombine.id, draconisCombine);
        factionsById.set(mercenary.id, mercenary);
        megaMekAvailabilityByUnitName.set(unit.name, {
            e: {
                '3150': {
                    '20': [2, 0],
                    '30': [1, 1],
                },
                '3067': {
                    '40': [3, 0],
                },
            },
        });

        filtersServiceMock.effectiveFilterState.and.returnValue({
            era: {
                interactedWith: false,
                value: {},
            },
            faction: {
                interactedWith: false,
                value: {},
            },
        });
        spyOn(Math, 'random').and.returnValue(0.9);

        const context = service.resolveGenerationContext([unit]);

        expect(context.forceFaction).toBe(mercenary);
        expect(context.forceEra).toBe(ilClan);
        expect(context.availabilityFactionIds).toEqual([20, 30]);
        expect(context.availablePairCount).toBe(3);
    });

    it('includes Extinct in the faction scope only when it is explicitly selected positively', () => {
        const era = createEra(3150, 'ilClan');
        const extinct = createFaction(MULFACTION_EXTINCT, 'Extinct');
        const unit = createUnit({ id: 7, name: 'Doomed Atlas' });

        erasByName.set(era.name, era);
        erasById.set(era.id, era);
        factionsByName.set(extinct.name, extinct);
        factionsById.set(extinct.id, extinct);
        megaMekAvailabilityByUnitName.set(unit.name, {
            e: {
                '3150': {
                    [String(MULFACTION_EXTINCT)]: [2, 1],
                },
            },
        });

        filtersServiceMock.effectiveFilterState.and.returnValue({
            era: {
                interactedWith: true,
                value: ['ilClan'],
            },
            faction: {
                interactedWith: true,
                value: {
                    extinct: { name: 'Extinct', state: 'or', count: 1 },
                },
            },
        });

        const context = service.resolveGenerationContext([unit]);

        expect(context.forceFaction).toBe(extinct);
        expect(context.forceEra).toBe(era);
        expect(context.availabilityFactionIds).toEqual([MULFACTION_EXTINCT]);
        expect(context.availablePairCount).toBe(1);
    });

    it('derives MegaMek positive availability pairs directly from eligible unit records', () => {
        const era = createEra(3150, 'Jihad');
        const capellanConfederation = createFaction(10, 'Capellan Confederation');
        const federatedSuns = createFaction(20, 'Federated Suns');
        const mercenary = createFaction(MULFACTION_MERCENARY, 'Mercenary');
        const unit = createUnit({ id: 1, name: 'Direct Pair Unit' });

        erasByName.set(era.name, era);
        erasById.set(era.id, era);
        factionsByName.set(capellanConfederation.name, capellanConfederation);
        factionsByName.set(federatedSuns.name, federatedSuns);
        factionsByName.set(mercenary.name, mercenary);
        factionsById.set(capellanConfederation.id, capellanConfederation);
        factionsById.set(federatedSuns.id, federatedSuns);
        factionsById.set(mercenary.id, mercenary);

        megaMekAvailabilityByUnitName.set(unit.name, {
            e: {
                '3150': {
                    '10': [2, 0],
                    '20': [0, 3],
                },
            },
        });

        filtersServiceMock.effectiveFilterState.and.returnValue({
            era: {
                interactedWith: true,
                value: ['Jihad'],
            },
            faction: {
                interactedWith: false,
                value: {},
            },
        });

        const getFactionEraUnitIdsSpy = spyOn(unitAvailabilitySourceService, 'getFactionEraUnitIds').and.callThrough();

        const context = service.resolveGenerationContext([unit]);

        expect(getFactionEraUnitIdsSpy).not.toHaveBeenCalled();
        expect(context.availablePairCount).toBe(2);
        expect(context.forceFaction).toBe(mercenary);
        expect(context.forceEra).toBe(era);
    });

    it('uses the highest remaining era and expands availability scope when cross-era availability is enabled without positive era selections', () => {
        const ageOfWar = createEra(2570, 'Age of War');
        const civilWar = createEra(3067, 'Civil War');
        const ilClan = createEra(3150, 'ilClan');
        const faction = createFaction(10, 'Capellan Confederation');
        const unit = createUnit({ id: 1, name: 'Vindicator' });

        erasByName.set(ageOfWar.name, ageOfWar);
        erasById.set(ageOfWar.id, ageOfWar);
        erasByName.set(civilWar.name, civilWar);
        erasById.set(civilWar.id, civilWar);
        erasByName.set(ilClan.name, ilClan);
        erasById.set(ilClan.id, ilClan);
        factionsByName.set(faction.name, faction);
        factionsById.set(faction.id, faction);
        megaMekAvailabilityByUnitName.set(unit.name, {
            e: {
                '3067': {
                    '10': [2, 0],
                },
                '3150': {
                    '10': [4, 0],
                },
            },
        });

        filtersServiceMock.effectiveFilterState.and.returnValue({
            era: {
                interactedWith: true,
                value: {
                    age: { name: 'Age of War', state: 'not', count: 1 },
                },
            },
            faction: {
                interactedWith: true,
                value: {
                    cc: { name: 'Capellan Confederation', state: 'or', count: 1 },
                },
            },
        });
        spyOn(service as any, 'shouldUseCrossEraAvailabilityForSelection').and.returnValue(true);

        const context = service.resolveGenerationContext([unit]);

        expect(context.forceEra).toBe(ilClan);
        expect(context.availabilityEraIds).toEqual([3067, 3150]);
        expect(context.useAvailabilityEraScope).toBeTrue();
    });

    it('resolves positive multistate era selections from the active filter', () => {
        const ilClan = createEra(3150, 'ilClan');
        const clanInvasion = createEra(3052, 'Clan Invasion');
        const jihad = createEra(3067, 'Jihad');

        erasByName.set(ilClan.name, ilClan);
        erasById.set(ilClan.id, ilClan);
        erasByName.set(clanInvasion.name, clanInvasion);
        erasById.set(clanInvasion.id, clanInvasion);
        erasByName.set(jihad.name, jihad);
        erasById.set(jihad.id, jihad);

        filtersServiceMock.effectiveFilterState.and.returnValue({
            era: {
                interactedWith: true,
                value: {
                    ilClan: {
                        name: 'ilClan',
                        state: 'or',
                        count: 1,
                    },
                    'Clan Invasion': {
                        name: 'Clan Invasion',
                        state: 'and',
                        count: 1,
                    },
                    Jihad: {
                        name: 'Jihad',
                        state: 'not',
                        count: 1,
                    },
                },
            },
        });

        expect(((service as any).resolveSelectedEras() as Era[]).map((era) => era.name)).toEqual([
            'ilClan',
            'Clan Invasion',
        ]);
    });

    it('uses the active MUL availability source when rolling the force era', () => {
        const ageOfWar = createEra(2570, 'Age of War', 2570, 2780);
        const civilWar = createEra(3067, 'Civil War', 3062, 3067);
        const capellanConfederation = createFaction(10, 'Capellan Confederation');
        const unit = createUnit({ id: 1, name: 'Vindicator' });
        const availabilityRecord: { e: Record<string, Record<string, [number, number]>> } = {
            e: {
                '2570': {
                    '10': [3, 0],
                },
                '3067': {
                    '10': [3, 0],
                },
            },
        };

        ageOfWar.units = new Set<number>();
        civilWar.units = new Set<number>([unit.id]);
        capellanConfederation.eras = {
            [civilWar.id]: new Set<number>([unit.id]),
        };

        erasByName.set(ageOfWar.name, ageOfWar);
        erasById.set(ageOfWar.id, ageOfWar);
        erasByName.set(civilWar.name, civilWar);
        erasById.set(civilWar.id, civilWar);
        factionsByName.set(capellanConfederation.name, capellanConfederation);
        factionsById.set(capellanConfederation.id, capellanConfederation);
        megaMekAvailabilityByUnitName.set(unit.name, availabilityRecord);
        megaMekAvailabilityRecords.push(availabilityRecord);
        units.push(unit);
        optionsServiceMock.options.set({ availabilitySource: 'mul' });

        filtersServiceMock.effectiveFilterState.and.returnValue({
            faction: {
                interactedWith: true,
                value: {
                    cc: {
                        name: 'Capellan Confederation',
                        state: 'or',
                        count: 1,
                    },
                },
            },
        });

        const context = service.resolveGenerationContext([unit]);

        expect(context.forceFaction).toBe(capellanConfederation);
        expect(context.forceEra).toBe(civilWar);
        expect(context.availabilityEraIds).toEqual([civilWar.id]);
        expect(context.availablePairCount).toBe(1);
    });

    it('prefers the higher MegaMek availability weight and falls back unknown units to weight 2', () => {
        const era = createEra(3150, 'ilClan');
        const faction = createFaction(10, 'Federated Suns');
        const knownUnit = createUnit({ id: 1, name: 'Known Unit', as: { PV: 5 } as Unit['as'] });
        const unknownUnit = createUnit({ id: 2, name: 'Unknown Unit', as: { PV: 5 } as Unit['as'] });

        megaMekAvailabilityByUnitName.set(knownUnit.name, {
            e: {
                '3150': {
                    '10': [3, 1],
                },
            },
        });

        spyOn(Math, 'random').and.returnValue(0);

        const preview = service.buildPreview({
            eligibleUnits: [knownUnit, unknownUnit],
            context: createContext(faction, era),
            gameSystem: GameSystem.ALPHA_STRIKE,
            budgetRange: { min: 0, max: 20 },
            minUnitCount: 1,
            maxUnitCount: 1,
            gunnery: 4,
            piloting: 5,
        });

        expect(preview.error).toBeNull();
        expect(preview.units.length).toBe(1);
        expect(preview.units[0].unit).toBe(knownUnit);
        expect(preview.totalCost).toBe(5);
    });

    it('uses max weights across selected eras and factions when multiselect expansion is enabled', () => {
        const rolledEra = createEra(3150, 'Jihad');
        const rolledFaction = createFaction(10, 'Capellan Confederation');
        const extinctUnit = createUnit({ id: 1, name: 'Extinct Unit', as: { PV: 5 } as Unit['as'] });
        const availableUnit = createUnit({ id: 2, name: 'Available Unit', as: { PV: 5 } as Unit['as'] });

        megaMekAvailabilityByUnitName.set(extinctUnit.name, {
            e: {
                '3150': {
                    '10': [0, 0],
                    '20': [20, 0],
                },
                '3075': {
                    '10': [20, 0],
                },
            },
        });
        megaMekAvailabilityByUnitName.set(availableUnit.name, {
            e: {
                '3150': {
                    '10': [1, 0],
                },
            },
        });

        spyOn(Math, 'random').and.returnValue(0.4);

        const preview = service.buildPreview({
            eligibleUnits: [extinctUnit, availableUnit],
            context: {
                forceFaction: rolledFaction,
                forceEra: rolledEra,
                availabilityFactionIds: [10, 20],
                availabilityEraIds: [3150, 3075],
                useAvailabilityFactionScope: true,
                useAvailabilityEraScope: true,
                availablePairCount: 3,
                ruleset: null,
            },
            gameSystem: GameSystem.ALPHA_STRIKE,
            budgetRange: { min: 0, max: 20 },
            minUnitCount: 1,
            maxUnitCount: 1,
            gunnery: 4,
            piloting: 5,
        });

        expect(preview.error).toBeNull();
        expect(preview.units.map((unit) => unit.unit.name)).toEqual(['Extinct Unit']);
        expect(preview.explanationLines[0]).toContain('Eligible units: 2 units. Availability-positive candidates: 2 units.');
        expect(preview.explanationLines.some((line) => line.includes('Generation context: Capellan Confederation - Jihad. Availability weights: max P/S across 2 eras x 2 factions.'))).toBeTrue();
        expect(preview.explanationLines.some((line) => line.includes('production pick, P 20 / S 0'))).toBeTrue();
    });

    it('uses max weights across selected eras for a single rolled faction when multiselect expansion is enabled', () => {
        const rolledEra = createEra(3150, 'Jihad');
        const rolledFaction = createFaction(10, 'Capellan Confederation');
        const scopedUnit = createUnit({ id: 1, name: 'Scoped Era Unit', as: { PV: 5 } as Unit['as'] });

        megaMekAvailabilityByUnitName.set(scopedUnit.name, {
            e: {
                '3150': {
                    '10': [0, 0],
                },
                '3075': {
                    '10': [1, 9],
                },
                '3067': {
                    '10': [2, 4],
                },
            },
        });

        spyOn(Math, 'random').and.returnValue(0);

        const preview = service.buildPreview({
            eligibleUnits: [scopedUnit],
            context: {
                forceFaction: rolledFaction,
                forceEra: rolledEra,
                availabilityFactionIds: [10],
                availabilityEraIds: [3150, 3075, 3067],
                useAvailabilityFactionScope: false,
                useAvailabilityEraScope: true,
                availablePairCount: 3,
                ruleset: null,
            },
            gameSystem: GameSystem.ALPHA_STRIKE,
            budgetRange: { min: 0, max: 20 },
            minUnitCount: 1,
            maxUnitCount: 1,
            gunnery: 4,
            piloting: 5,
        });

        expect(preview.error).toBeNull();
        expect(preview.units.map((unit) => unit.unit.name)).toEqual(['Scoped Era Unit']);
        expect(preview.explanationLines.some((line) => line.includes('Generation context: Capellan Confederation - Jihad. Availability weights: max P/S across 3 eras.'))).toBeTrue();
        expect(preview.explanationLines.some((line) => line.includes('P 2 / S 9'))).toBeTrue();
    });

    it('uses max weights across selected factions for a single rolled era when multiselect expansion is enabled', () => {
        const rolledEra = createEra(3150, 'Jihad');
        const rolledFaction = createFaction(10, 'Capellan Confederation');
        const scopedUnit = createUnit({ id: 1, name: 'Scoped Faction Unit', as: { PV: 5 } as Unit['as'] });

        megaMekAvailabilityByUnitName.set(scopedUnit.name, {
            e: {
                '3150': {
                    '10': [0, 0],
                    '20': [7, 1],
                    '30': [3, 6],
                },
            },
        });

        spyOn(Math, 'random').and.returnValue(0);

        const preview = service.buildPreview({
            eligibleUnits: [scopedUnit],
            context: {
                forceFaction: rolledFaction,
                forceEra: rolledEra,
                availabilityFactionIds: [10, 20, 30],
                availabilityEraIds: [3150],
                useAvailabilityFactionScope: true,
                useAvailabilityEraScope: false,
                availablePairCount: 3,
                ruleset: null,
            },
            gameSystem: GameSystem.ALPHA_STRIKE,
            budgetRange: { min: 0, max: 20 },
            minUnitCount: 1,
            maxUnitCount: 1,
            gunnery: 4,
            piloting: 5,
        });

        expect(preview.error).toBeNull();
        expect(preview.units.map((unit) => unit.unit.name)).toEqual(['Scoped Faction Unit']);
        expect(preview.explanationLines.some((line) => line.includes('Generation context: Capellan Confederation - Jihad. Availability weights: max P/S across 3 factions.'))).toBeTrue();
        expect(preview.explanationLines.some((line) => line.includes('P 7 / S 6'))).toBeTrue();
    });

    it('reuses cached availability weights across identical preview requests and rebuilds them when the scope changes', () => {
        const era = createEra(3150, 'Jihad');
        const capellanConfederation = createFaction(10, 'Capellan Confederation');
        const federatedSuns = createFaction(20, 'Federated Suns');
        const draconisCombine = createFaction(30, 'Draconis Combine');
        const unitA = createUnit({ id: 1, name: 'Cache Test A', as: { PV: 5 } as Unit['as'] });
        const unitB = createUnit({ id: 2, name: 'Cache Test B', as: { PV: 6 } as Unit['as'] });

        erasByName.set(era.name, era);
        erasById.set(era.id, era);
        factionsByName.set(capellanConfederation.name, capellanConfederation);
        factionsByName.set(federatedSuns.name, federatedSuns);
        factionsByName.set(draconisCombine.name, draconisCombine);
        factionsById.set(capellanConfederation.id, capellanConfederation);
        factionsById.set(federatedSuns.id, federatedSuns);
        factionsById.set(draconisCombine.id, draconisCombine);
        units.push(unitA, unitB);

        megaMekAvailabilityByUnitName.set(unitA.name, {
            e: {
                '3150': {
                    '10': [2, 1],
                    '20': [4, 0],
                    '30': [3, 2],
                },
            },
        });
        megaMekAvailabilityByUnitName.set(unitB.name, {
            e: {
                '3150': {
                    '10': [1, 3],
                    '20': [2, 2],
                    '30': [5, 1],
                },
            },
        });

        const buildAvailabilityWeightCacheSpy = spyOn(service as any, 'buildAvailabilityWeightCache').and.callThrough();
        const baseRequest = {
            eligibleUnits: [unitA, unitB],
            context: {
                forceFaction: capellanConfederation,
                forceEra: era,
                availabilityFactionIds: [10, 20],
                availabilityEraIds: [3150],
                useAvailabilityFactionScope: true,
                useAvailabilityEraScope: false,
                availablePairCount: 2,
                ruleset: null,
            } as ForceGenerationContext,
            gameSystem: GameSystem.ALPHA_STRIKE,
            budgetRange: { min: 0, max: 20 },
            minUnitCount: 1,
            maxUnitCount: 1,
            gunnery: 4,
            piloting: 5,
        };

        service.buildPreview(baseRequest);
        expect(buildAvailabilityWeightCacheSpy).toHaveBeenCalledTimes(1);

        service.buildPreview(baseRequest);
        expect(buildAvailabilityWeightCacheSpy).toHaveBeenCalledTimes(1);

        service.buildPreview({
            ...baseRequest,
            context: {
                ...baseRequest.context,
                availabilityFactionIds: [10, 20, 30],
                availablePairCount: 3,
            },
        });
        expect(buildAvailabilityWeightCacheSpy).toHaveBeenCalledTimes(2);
    });

    it('reuses cached availability weights when the rolled faction changes inside the same multi-faction scope', () => {
        const era = createEra(3150, 'Jihad');
        const capellanConfederation = createFaction(10, 'Capellan Confederation');
        const federatedSuns = createFaction(20, 'Federated Suns');
        const unitA = createUnit({ id: 1, name: 'Scoped Cache A', as: { PV: 5 } as Unit['as'] });
        const unitB = createUnit({ id: 2, name: 'Scoped Cache B', as: { PV: 6 } as Unit['as'] });

        erasByName.set(era.name, era);
        erasById.set(era.id, era);
        factionsByName.set(capellanConfederation.name, capellanConfederation);
        factionsByName.set(federatedSuns.name, federatedSuns);
        factionsById.set(capellanConfederation.id, capellanConfederation);
        factionsById.set(federatedSuns.id, federatedSuns);
        units.push(unitA, unitB);

        megaMekAvailabilityByUnitName.set(unitA.name, {
            e: {
                '3150': {
                    '10': [2, 1],
                    '20': [4, 0],
                },
            },
        });
        megaMekAvailabilityByUnitName.set(unitB.name, {
            e: {
                '3150': {
                    '10': [1, 3],
                    '20': [2, 2],
                },
            },
        });

        const buildAvailabilityWeightCacheSpy = spyOn(service as any, 'buildAvailabilityWeightCache').and.callThrough();
        const baseContext: ForceGenerationContext = {
            forceFaction: capellanConfederation,
            forceEra: era,
            availabilityFactionIds: [10, 20],
            availabilityEraIds: [3150],
            useAvailabilityFactionScope: true,
            useAvailabilityEraScope: false,
            availablePairCount: 2,
            ruleset: null,
        };

        service.buildPreview({
            eligibleUnits: [unitA, unitB],
            context: baseContext,
            gameSystem: GameSystem.ALPHA_STRIKE,
            budgetRange: { min: 0, max: 20 },
            minUnitCount: 1,
            maxUnitCount: 1,
            gunnery: 4,
            piloting: 5,
        });
        expect(buildAvailabilityWeightCacheSpy).toHaveBeenCalledTimes(1);

        service.buildPreview({
            eligibleUnits: [unitA, unitB],
            context: {
                ...baseContext,
                forceFaction: federatedSuns,
            },
            gameSystem: GameSystem.ALPHA_STRIKE,
            budgetRange: { min: 0, max: 20 },
            minUnitCount: 1,
            maxUnitCount: 1,
            gunnery: 4,
            piloting: 5,
        });
        expect(buildAvailabilityWeightCacheSpy).toHaveBeenCalledTimes(1);
    });

    it('rebuilds cached availability weights when revisiting a previously built era scope after another scope replaced the single cache', () => {
        const firstEra = createEra(3075, 'Jihad');
        const secondEra = createEra(3150, 'ilClan');
        const faction = createFaction(10, 'Capellan Confederation');
        const unitA = createUnit({ id: 1, name: 'Era Cache A', as: { PV: 5 } as Unit['as'] });
        const unitB = createUnit({ id: 2, name: 'Era Cache B', as: { PV: 6 } as Unit['as'] });

        erasByName.set(firstEra.name, firstEra);
        erasById.set(firstEra.id, firstEra);
        erasByName.set(secondEra.name, secondEra);
        erasById.set(secondEra.id, secondEra);
        factionsByName.set(faction.name, faction);
        factionsById.set(faction.id, faction);
        units.push(unitA, unitB);

        megaMekAvailabilityByUnitName.set(unitA.name, {
            e: {
                '3075': {
                    '10': [2, 1],
                },
                '3150': {
                    '10': [5, 0],
                },
            },
        });
        megaMekAvailabilityByUnitName.set(unitB.name, {
            e: {
                '3075': {
                    '10': [1, 3],
                },
                '3150': {
                    '10': [4, 2],
                },
            },
        });

        const buildAvailabilityWeightCacheSpy = spyOn(service as any, 'buildAvailabilityWeightCache').and.callThrough();
        const baseRequest = {
            eligibleUnits: [unitA, unitB],
            gameSystem: GameSystem.ALPHA_STRIKE,
            budgetRange: { min: 0, max: 20 },
            minUnitCount: 1,
            maxUnitCount: 1,
            gunnery: 4,
            piloting: 5,
        };

        service.buildPreview({
            ...baseRequest,
            context: createContext(faction, firstEra),
        });
        expect(buildAvailabilityWeightCacheSpy).toHaveBeenCalledTimes(1);

        service.buildPreview({
            ...baseRequest,
            context: createContext(faction, secondEra),
        });
        expect(buildAvailabilityWeightCacheSpy).toHaveBeenCalledTimes(2);

        service.buildPreview({
            ...baseRequest,
            context: createContext(faction, firstEra),
        });
        expect(buildAvailabilityWeightCacheSpy).toHaveBeenCalledTimes(3);
    });

    it('reuses the prepared candidate list across identical rerolls', () => {
        const era = createEra(3150, 'Jihad');
        const faction = createFaction(10, 'Capellan Confederation');
        const unitA = createUnit({ id: 1, name: 'Prepared Cache A', as: { PV: 5 } as Unit['as'] });
        const unitB = createUnit({ id: 2, name: 'Prepared Cache B', as: { PV: 6 } as Unit['as'] });

        erasByName.set(era.name, era);
        erasById.set(era.id, era);
        factionsByName.set(faction.name, faction);
        factionsById.set(faction.id, faction);
        units.push(unitA, unitB);

        megaMekAvailabilityByUnitName.set(unitA.name, {
            e: {
                '3150': {
                    '10': [3, 0],
                },
            },
        });
        megaMekAvailabilityByUnitName.set(unitB.name, {
            e: {
                '3150': {
                    '10': [2, 1],
                },
            },
        });

        const buildPreparedCandidateCacheSpy = spyOn(service as any, 'buildPreparedCandidateCache').and.callThrough();
        spyOn(Math, 'random').and.returnValue(0);

        const request = {
            eligibleUnits: [unitA, unitB],
            context: createContext(faction, era),
            gameSystem: GameSystem.ALPHA_STRIKE,
            budgetRange: { min: 0, max: 20 },
            minUnitCount: 1,
            maxUnitCount: 1,
            gunnery: 4,
            piloting: 5,
        };

        const firstPreview = service.buildPreview(request);
        const secondPreview = service.buildPreview(request);

        expect(firstPreview.error).toBeNull();
        expect(secondPreview.error).toBeNull();
        expect(buildPreparedCandidateCacheSpy).toHaveBeenCalledTimes(1);
    });

    it('reuses no-lock selection preparation across identical rerolls', () => {
        const era = createEra(3150, 'Jihad');
        const faction = createFaction(10, 'Capellan Confederation');
        const unitA = createUnit({ id: 1, name: 'Selection Cache A', as: { PV: 5 } as Unit['as'] });
        const unitB = createUnit({ id: 2, name: 'Selection Cache B', as: { PV: 6 } as Unit['as'] });

        erasByName.set(era.name, era);
        erasById.set(era.id, era);
        factionsByName.set(faction.name, faction);
        factionsById.set(faction.id, faction);
        units.push(unitA, unitB);

        megaMekAvailabilityByUnitName.set(unitA.name, {
            e: {
                '3150': {
                    '10': [3, 0],
                },
            },
        });
        megaMekAvailabilityByUnitName.set(unitB.name, {
            e: {
                '3150': {
                    '10': [2, 1],
                },
            },
        });

        const prepareSelectionPreparationSpy = spyOn(service as any, 'prepareSelectionPreparation').and.callThrough();
        spyOn(Math, 'random').and.returnValue(0);

        const request = {
            eligibleUnits: [unitA, unitB],
            context: createContext(faction, era),
            gameSystem: GameSystem.ALPHA_STRIKE,
            budgetRange: { min: 0, max: 20 },
            minUnitCount: 1,
            maxUnitCount: 1,
            gunnery: 4,
            piloting: 5,
        };

        const firstPreview = service.buildPreview(request);
        const secondPreview = service.buildPreview(request);

        expect(firstPreview.error).toBeNull();
        expect(secondPreview.error).toBeNull();
        expect(prepareSelectionPreparationSpy).toHaveBeenCalledTimes(1);
    });

    it('fingerprints single-era weights with the rolled context era and involved factions when multi-era scope is off', () => {
        const rolledEra = createEra(3075, 'Jihad');
        const latestEra = createEra(3150, 'ilClan');
        const rolledFaction = createFaction(10, 'Capellan Confederation');

        const signature = (service as any).buildAvailabilityWeightCacheSignature({
            forceFaction: rolledFaction,
            forceEra: rolledEra,
            availabilityFactionIds: [10, 20],
            availabilityEraIds: [3075, 3150],
            useAvailabilityFactionScope: true,
            useAvailabilityEraScope: false,
            availablePairCount: 4,
            ruleset: null,
        } as ForceGenerationContext, true);

        expect(signature).toContain('weightFactions:10,20');
        expect(signature).toContain('weightEras:3075');
        expect(signature).not.toContain(`weightEras:${rolledEra.id},${latestEra.id}`);
    });

    it('fingerprints cross-era weights with all involved eras and factions when multi-era scope is on', () => {
        const rolledEra = createEra(3150, 'ilClan');
        const signature = (service as any).buildAvailabilityWeightCacheSignature({
            forceFaction: createFaction(10, 'Capellan Confederation'),
            forceEra: rolledEra,
            availabilityFactionIds: [10, 20],
            availabilityEraIds: [3075, 3150],
            useAvailabilityFactionScope: true,
            useAvailabilityEraScope: true,
            availablePairCount: 4,
            ruleset: null,
        } as ForceGenerationContext, true);

        expect(signature).toContain('weightFactions:10,20');
        expect(signature).toContain('weightEras:3075,3150');
    });

    it('prepares ruleset guidance once per preview instead of rebuilding it on every attempt', () => {
        const era = createEra(3150, 'Jihad');
        const faction = createFaction(10, 'Capellan Confederation');
        const unitA = createUnit({ id: 1, name: 'Attempt Cache A', bv: 100, as: { PV: 5 } as Unit['as'] });
        const unitB = createUnit({ id: 2, name: 'Attempt Cache B', bv: 100, as: { PV: 5 } as Unit['as'] });

        erasByName.set(era.name, era);
        erasById.set(era.id, era);
        factionsByName.set(faction.name, faction);
        factionsById.set(faction.id, faction);
        units.push(unitA, unitB);

        megaMekAvailabilityByUnitName.set(unitA.name, {
            e: {
                '3150': {
                    '10': [2, 0],
                },
            },
        });
        megaMekAvailabilityByUnitName.set(unitB.name, {
            e: {
                '3150': {
                    '10': [2, 0],
                },
            },
        });

        const buildRulesetProfileSpy = spyOn(service as any, 'buildRulesetProfile').and.callThrough();
        spyOn(service as any, 'createAttemptBudget').and.returnValue({
            minAttempts: 3,
            maxAttempts: 3,
            targetDurationMs: 0,
        });

        const preview = service.buildPreview({
            eligibleUnits: [unitA, unitB],
            context: createContext(faction, era),
            gameSystem: GameSystem.CLASSIC,
            budgetRange: { min: 1000, max: 1001 },
            minUnitCount: 1,
            maxUnitCount: 1,
            gunnery: 4,
            piloting: 5,
        });

        expect(preview.units.length).toBe(1);
        expect(buildRulesetProfileSpy).toHaveBeenCalledTimes(1);
    });

    it('uses exact MegaMek weights for MUL-visible units when MegaMek has an exact-context record', () => {
        const era = createEra(3150, 'Jihad');
        const faction = createFaction(10, 'Draconis Combine');
        const mulVisibleUnit = createUnit({ id: 1, name: 'MUL Visible Unit', as: { PV: 5 } as Unit['as'] });

        era.units = new Set<number>([mulVisibleUnit.id]);
        faction.eras = {
            [era.id]: new Set<number>([mulVisibleUnit.id]),
        };

        erasByName.set(era.name, era);
        erasById.set(era.id, era);
        factionsByName.set(faction.name, faction);
        factionsById.set(faction.id, faction);
        units.push(mulVisibleUnit);
        optionsServiceMock.options.set({ availabilitySource: 'mul' });

        megaMekAvailabilityByUnitName.set(mulVisibleUnit.name, {
            e: {
                '3150': {
                    '10': [0, 0],
                },
            },
        });

        spyOn(Math, 'random').and.returnValue(0);

        const preview = service.buildPreview({
            eligibleUnits: [mulVisibleUnit],
            context: createContext(faction, era),
            gameSystem: GameSystem.ALPHA_STRIKE,
            budgetRange: { min: 0, max: 10 },
            minUnitCount: 1,
            maxUnitCount: 1,
            gunnery: 4,
            piloting: 5,
        });

        expect(preview.error).toBe('Only 0 units have positive MegaMek availability in the rolled faction and era.');
        expect(preview.units.length).toBe(0);
    });

    it('keeps excluding zero-weight MegaMek units in MUL mode when the exact rolled MUL faction-era does not contain them', () => {
        const era = createEra(3150, 'Jihad');
        const faction = createFaction(10, 'Draconis Combine');
        const mulInvisibleUnit = createUnit({ id: 1, name: 'MUL Invisible Unit', as: { PV: 5 } as Unit['as'] });

        erasByName.set(era.name, era);
        erasById.set(era.id, era);
        factionsByName.set(faction.name, faction);
        factionsById.set(faction.id, faction);
        units.push(mulInvisibleUnit);
        optionsServiceMock.options.set({ availabilitySource: 'mul' });

        megaMekAvailabilityByUnitName.set(mulInvisibleUnit.name, {
            e: {
                '3150': {
                    '10': [0, 0],
                },
            },
        });

        const preview = service.buildPreview({
            eligibleUnits: [mulInvisibleUnit],
            context: createContext(faction, era),
            gameSystem: GameSystem.ALPHA_STRIKE,
            budgetRange: { min: 0, max: 10 },
            minUnitCount: 1,
            maxUnitCount: 1,
            gunnery: 4,
            piloting: 5,
        });

        expect(preview.error).toBe('Only 0 units have positive MegaMek availability in the rolled faction and era.');
        expect(preview.units.length).toBe(0);
    });

    it('falls back to minimum unknown weights for MUL-visible units that are missing MegaMek availability records', () => {
        const era = createEra(2570, 'Age of War', 2570, 2780);
        const faction = createFaction(10, 'Draconis Combine');
        const mulVisibleUnit = createUnit({ id: 1, name: 'MUL Visible Unknown', as: { PV: 5 } as Unit['as'] });

        era.units = new Set<number>([mulVisibleUnit.id]);
        faction.eras = {
            [era.id]: new Set<number>([mulVisibleUnit.id]),
        };

        erasByName.set(era.name, era);
        erasById.set(era.id, era);
        factionsByName.set(faction.name, faction);
        factionsById.set(faction.id, faction);
        units.push(mulVisibleUnit);
        optionsServiceMock.options.set({ availabilitySource: 'mul' });

        spyOn(Math, 'random').and.returnValue(0);

        const preview = service.buildPreview({
            eligibleUnits: [mulVisibleUnit],
            context: createContext(faction, era),
            gameSystem: GameSystem.ALPHA_STRIKE,
            budgetRange: { min: 0, max: 10 },
            minUnitCount: 1,
            maxUnitCount: 1,
            gunnery: 4,
            piloting: 5,
        });

        expect(preview.error).toBeNull();
        expect(preview.units.map((generatedUnit) => generatedUnit.unit.name)).toEqual(['MUL Visible Unknown']);
        expect(preview.explanationLines[0]).toContain('Eligible units: 1 units. Availability-positive candidates: 1 units.');
        expect(preview.explanationLines.some((line) => line.includes('P 1 / S 1'))).toBeTrue();
    });

    it('keeps excluding MUL-invisible units that are missing MegaMek availability records', () => {
        const era = createEra(2570, 'Age of War', 2570, 2780);
        const faction = createFaction(10, 'Draconis Combine');
        const mulInvisibleUnknown = createUnit({ id: 1, name: 'MUL Invisible Unknown', as: { PV: 5 } as Unit['as'] });

        erasByName.set(era.name, era);
        erasById.set(era.id, era);
        factionsByName.set(faction.name, faction);
        factionsById.set(faction.id, faction);
        units.push(mulInvisibleUnknown);
        optionsServiceMock.options.set({ availabilitySource: 'mul' });

        const preview = service.buildPreview({
            eligibleUnits: [mulInvisibleUnknown],
            context: createContext(faction, era),
            gameSystem: GameSystem.ALPHA_STRIKE,
            budgetRange: { min: 0, max: 10 },
            minUnitCount: 1,
            maxUnitCount: 1,
            gunnery: 4,
            piloting: 5,
        });

        expect(preview.error).toBe('Only 0 units have positive MegaMek availability in the rolled faction and era.');
        expect(preview.units.length).toBe(0);
    });

    it('rolls production and salvage separately before picking the unit', () => {
        const era = createEra(3150, 'ilClan');
        const faction = createFaction(10, 'Federated Suns');
        const productionUnit = createUnit({ id: 1, name: 'Production Unit', chassis: 'Phoenix Hawk', model: 'PXH-1', as: { PV: 5 } as Unit['as'] });
        const salvageUnit = createUnit({ id: 2, name: 'Salvage Unit', chassis: 'Shadow Hawk', model: 'SHD-2H', as: { PV: 5 } as Unit['as'] });

        megaMekAvailabilityByUnitName.set(productionUnit.name, {
            e: {
                '3150': {
                    '10': [10, 0],
                },
            },
        });
        megaMekAvailabilityByUnitName.set(salvageUnit.name, {
            e: {
                '3150': {
                    '10': [0, 10],
                },
            },
        });

        const randomSpy = spyOn(Math, 'random');

        randomSpy.and.returnValues(0.25, 0);
        let preview = service.buildPreview({
            eligibleUnits: [productionUnit, salvageUnit],
            context: createContext(faction, era),
            gameSystem: GameSystem.ALPHA_STRIKE,
            budgetRange: { min: 0, max: 20 },
            minUnitCount: 1,
            maxUnitCount: 1,
            gunnery: 4,
            piloting: 5,
        });

        expect(preview.error).toBeNull();
        expect(preview.units[0].unit).toBe(productionUnit);

        randomSpy.calls.reset();
        randomSpy.and.returnValues(0.75, 0);
        preview = service.buildPreview({
            eligibleUnits: [productionUnit, salvageUnit],
            context: createContext(faction, era),
            gameSystem: GameSystem.ALPHA_STRIKE,
            budgetRange: { min: 0, max: 20 },
            minUnitCount: 1,
            maxUnitCount: 1,
            gunnery: 4,
            piloting: 5,
        });

        expect(preview.error).toBeNull();
        expect(preview.units[0].unit).toBe(salvageUnit);
        expect(preview.explanationLines.some((line) => line.includes('Shadow Hawk SHD-2H: salvage pick'))).toBeTrue();
    });

    it('includes a readable explanation for the generated picks', () => {
        const era = createEra(3150, 'ilClan');
        const faction = createFaction(10, 'Federated Suns');
        const unit = createUnit({ id: 1, name: 'Explained Unit', chassis: 'Warhammer', model: 'WHM-6R', as: { PV: 5 } as Unit['as'] });

        megaMekAvailabilityByUnitName.set(unit.name, {
            e: {
                '3150': {
                    '10': [3, 1],
                },
            },
        });

        spyOn(Math, 'random').and.returnValue(0);

        const preview = service.buildPreview({
            eligibleUnits: [unit],
            context: createContext(faction, era),
            gameSystem: GameSystem.ALPHA_STRIKE,
            budgetRange: { min: 0, max: 10 },
            minUnitCount: 1,
            maxUnitCount: 1,
            gunnery: 4,
            piloting: 5,
        });

        expect(preview.error).toBeNull();
        expect(preview.explanationLines[0]).toContain('Eligible units: 1 units. Availability-positive candidates: 1 units.');
        expect(preview.explanationLines.some((line) => line.includes('Generation context: Federated Suns - ilClan.'))).toBeTrue();
        expect(preview.explanationLines.some((line) => line.includes('Warhammer WHM-6R: production pick'))).toBeTrue();
        expect(preview.explanationLines.some((line) => line.includes('Explained Unit: production pick'))).toBeFalse();
    });

    it('stays inside an exact budget range without adjusting skill', () => {
        const era = createEra(3150, 'ilClan');
        const faction = createFaction(10, 'Federated Suns');
        const lightUnit = createUnit({ id: 1, name: 'Light Unit', as: { PV: 4 } as Unit['as'] });
        const mediumUnit = createUnit({ id: 2, name: 'Medium Unit', as: { PV: 5 } as Unit['as'] });

        spyOn(Math, 'random').and.returnValue(0);

        const preview = service.buildPreview({
            eligibleUnits: [lightUnit, mediumUnit],
            context: createContext(faction, era),
            gameSystem: GameSystem.ALPHA_STRIKE,
            budgetRange: { min: 9, max: 9 },
            minUnitCount: 1,
            maxUnitCount: 2,
            gunnery: 4,
            piloting: 5,
        });

        expect(preview.error).toBeNull();
        expect(preview.totalCost).toBe(9);
        expect(preview.units.map((unit) => unit.unit.name)).toEqual(['Light Unit', 'Medium Unit']);
        expect(preview.units[0].skill).toBe(4);
        expect(preview.units[1].skill).toBe(4);
    });

    it('returns the highest under-target result when the minimum budget cannot be reached within the unit count range', () => {
        const era = createEra(3150, 'ilClan');
        const faction = createFaction(10, 'Federated Suns');
        const unit = createUnit({ id: 1, name: 'Too Cheap', as: { PV: 5 } as Unit['as'] });

        spyOn(Math, 'random').and.returnValue(0);

        const preview = service.buildPreview({
            eligibleUnits: [unit],
            context: createContext(faction, era),
            gameSystem: GameSystem.ALPHA_STRIKE,
            budgetRange: { min: 6, max: 10 },
            minUnitCount: 1,
            maxUnitCount: 1,
            gunnery: 4,
            piloting: 5,
        });

        expect(preview.error).toBeNull();
        expect(preview.totalCost).toBe(5);
        expect(preview.units.map((generatedUnit) => generatedUnit.unit.name)).toEqual(['Too Cheap']);
        expect(preview.explanationLines.some((line) => line.includes('No force matched the full budget and unit-count constraints'))).toBeTrue();
    });

    it('returns the lowest-total compatible force in the requested unit-count range when nothing can stay at or below the maximum budget', () => {
        const era = createEra(3025, 'Succession Wars');
        const faction = createFaction(10, 'Capellan Confederation');
        const expensiveMek = createUnit({ id: 1, name: 'Expensive Mek', as: { PV: 6 } as Unit['as'] });
        const moreExpensiveMek = createUnit({ id: 2, name: 'More Expensive Mek', as: { PV: 8 } as Unit['as'] });
        const cheaperAero = createUnit({
            id: 3,
            name: 'Cheaper Aero',
            type: 'Aero',
            subtype: 'Aerospace Fighter',
            moveType: 'Aerodyne',
            as: { PV: 4, TP: 'AF', MVm: { a: 8 } } as unknown as Unit['as'],
        });
        const ruleset: MegaMekRulesetRecord = {
            factionKey: 'CC',
            indexes: { forceIndexesByEchelon: {} },
            forceCount: 1,
            forces: [
                {
                    when: {
                        unitTypes: ['Mek'],
                        topLevel: true,
                    },
                },
            ],
        };

        megaMekRulesetsByMulFactionId.set(faction.id, [ruleset]);
        megaMekRulesetsByFactionKey.set(ruleset.factionKey, ruleset);

        spyOn(Math, 'random').and.returnValue(0);

        const preview = service.buildPreview({
            eligibleUnits: [expensiveMek, moreExpensiveMek, cheaperAero],
            context: createContext(faction, era),
            gameSystem: GameSystem.ALPHA_STRIKE,
            budgetRange: { min: 0, max: 1 },
            minUnitCount: 1,
            maxUnitCount: 1,
            gunnery: 4,
            piloting: 5,
        });

        expect(preview.error).toBeNull();
        expect(preview.units.map((unit) => unit.unit.name)).toEqual(['Expensive Mek']);
        expect(preview.totalCost).toBe(6);
        expect(preview.explanationLines.some((line) => line.includes('lowest-total force in the requested unit-count range was returned'))).toBeTrue();
        expect(service.createForceEntry(preview)).not.toBeNull();
    });

    it('keeps the requested unit-count range when every possible force is above the maximum budget', () => {
        const era = createEra(3025, 'Succession Wars');
        const faction = createFaction(10, 'Capellan Confederation');
        const units = [
            createUnit({ id: 1, name: 'Unit 1', as: { PV: 4 } as Unit['as'] }),
            createUnit({ id: 2, name: 'Unit 2', as: { PV: 5 } as Unit['as'] }),
            createUnit({ id: 3, name: 'Unit 3', as: { PV: 6 } as Unit['as'] }),
            createUnit({ id: 4, name: 'Unit 4', as: { PV: 7 } as Unit['as'] }),
            createUnit({ id: 5, name: 'Unit 5', as: { PV: 8 } as Unit['as'] }),
        ];

        spyOn(Math, 'random').and.returnValue(0);

        const preview = service.buildPreview({
            eligibleUnits: units,
            context: createContext(faction, era),
            gameSystem: GameSystem.ALPHA_STRIKE,
            budgetRange: { min: 1, max: 1 },
            minUnitCount: 4,
            maxUnitCount: 8,
            gunnery: 4,
            piloting: 5,
        });

        expect(preview.error).toBeNull();
        expect(preview.units.length).toBe(4);
        expect(preview.units.map((unit) => unit.unit.name)).toEqual(['Unit 1', 'Unit 2', 'Unit 3', 'Unit 4']);
        expect(preview.totalCost).toBe(22);
        expect(preview.explanationLines.some((line) => line.includes('lowest-total force in the requested unit-count range was returned'))).toBeTrue();
        expect(service.createForceEntry(preview)).not.toBeNull();
    });

    it('treats a 0/0 budget request as the first compatible result', () => {
        const era = createEra(3150, 'ilClan');
        const faction = createFaction(10, 'Federated Suns');
        const firstUnit = createUnit({ id: 1, name: 'First Unit', as: { PV: 6 } as Unit['as'] });
        const secondUnit = createUnit({ id: 2, name: 'Second Unit', as: { PV: 8 } as Unit['as'] });
        const firstAttempt = {
            selectedCandidates: [firstUnit].map((unit) => ({
                unit,
                productionWeight: 1,
                salvageWeight: 1,
                cost: unit.as.PV,
                megaMekUnitType: 'Mek',
            })),
            selectionSteps: [],
            rulesetProfile: null,
        };
        const secondAttempt = {
            selectedCandidates: [secondUnit].map((unit) => ({
                unit,
                productionWeight: 1,
                salvageWeight: 1,
                cost: unit.as.PV,
                megaMekUnitType: 'Mek',
            })),
            selectionSteps: [],
            rulesetProfile: null,
        };

        const buildSelectionSpy = spyOn<any>(service, 'buildCandidateSelection').and.returnValues(
            firstAttempt as any,
            secondAttempt as any,
        );

        const preview = service.buildPreview({
            eligibleUnits: [firstUnit, secondUnit],
            context: createContext(faction, era),
            gameSystem: GameSystem.ALPHA_STRIKE,
            budgetRange: { min: 0, max: 0 },
            minUnitCount: 1,
            maxUnitCount: 2,
            gunnery: 4,
            piloting: 5,
        });

        expect(preview.error).toBeNull();
        expect(preview.units.map((unit) => unit.unit.name)).toEqual(['First Unit']);
        expect(preview.totalCost).toBe(6);
        expect(preview.explanationLines.some((line) => line.includes('Budget 0/0 requested'))).toBeTrue();
        expect(buildSelectionSpy.calls.count()).toBe(1);
        expect(service.createForceEntry(preview)).not.toBeNull();
    });

    it('preserves locked units and their preview metadata while filling the remaining slots', () => {
        const era = createEra(3150, 'ilClan');
        const faction = createFaction(10, 'Federated Suns');
        const lockedAtlas = createUnit({ id: 1, name: 'Atlas AS7-D', chassis: 'Atlas', model: 'AS7-D', as: { PV: 6 } as Unit['as'] });
        const locust = createUnit({ id: 2, name: 'Locust LCT-1V', chassis: 'Locust', model: 'LCT-1V', as: { PV: 4 } as Unit['as'] });

        spyOn(Math, 'random').and.returnValue(0);

        const preview = service.buildPreview({
            eligibleUnits: [lockedAtlas, locust],
            context: createContext(faction, era),
            gameSystem: GameSystem.ALPHA_STRIKE,
            budgetRange: { min: 0, max: 20 },
            minUnitCount: 2,
            maxUnitCount: 2,
            gunnery: 4,
            piloting: 5,
            lockedUnits: [{
                unit: lockedAtlas,
                cost: 6,
                skill: 3,
                alias: 'Ace Atlas',
                commander: true,
                lockKey: 'locked-atlas',
            }],
        });

        expect(preview.error).toBeNull();
        expect(preview.units.map((unit) => unit.unit.name)).toEqual(['Atlas AS7-D', 'Locust LCT-1V']);
        expect(preview.units[0].alias).toBe('Ace Atlas');
        expect(preview.units[0].commander).toBeTrue();
        expect(preview.units[0].lockKey).toBe('locked-atlas');
        expect(preview.explanationLines.some((line) => line.includes('locked'))).toBeTrue();

        const entry = service.createForceEntry(preview);
        expect(entry).not.toBeNull();
        expect(entry!.groups[0].units[0].alias).toBe('Ace Atlas');
        expect(entry!.groups[0].units[0].commander).toBeTrue();
        expect(entry!.groups[0].units[0].lockKey).toBe('locked-atlas');
    });

    it('prevents duplicate chassis when requested', () => {
        const era = createEra(3150, 'ilClan');
        const faction = createFaction(10, 'Federated Suns');
        const atlasPrime = createUnit({ id: 1, name: 'Atlas Prime', chassis: 'Atlas', model: 'Prime', as: { PV: 4 } as Unit['as'] });
        const atlasAlt = createUnit({ id: 2, name: 'Atlas Alt', chassis: 'Atlas', model: 'Alt', as: { PV: 4 } as Unit['as'] });
        const locust = createUnit({ id: 3, name: 'Locust', chassis: 'Locust', model: 'LCT-1V', as: { PV: 4 } as Unit['as'] });

        spyOn(Math, 'random').and.returnValue(0);

        const duplicatePreview = service.buildPreview({
            eligibleUnits: [atlasPrime, atlasAlt, locust],
            context: createContext(faction, era),
            gameSystem: GameSystem.ALPHA_STRIKE,
            budgetRange: { min: 0, max: 20 },
            minUnitCount: 2,
            maxUnitCount: 2,
            gunnery: 4,
            piloting: 5,
            preventDuplicateChassis: false,
        });
        const uniquePreview = service.buildPreview({
            eligibleUnits: [atlasPrime, atlasAlt, locust],
            context: createContext(faction, era),
            gameSystem: GameSystem.ALPHA_STRIKE,
            budgetRange: { min: 0, max: 20 },
            minUnitCount: 2,
            maxUnitCount: 2,
            gunnery: 4,
            piloting: 5,
            preventDuplicateChassis: true,
        });

        expect(duplicatePreview.units.map((unit) => unit.unit.name)).toEqual(['Atlas Prime', 'Atlas Alt']);
        expect(uniquePreview.units.map((unit) => unit.unit.name)).toEqual(['Atlas Prime', 'Locust']);
        expect(uniquePreview.explanationLines).toContain('Duplicate chassis prevention: enabled.');
    });

    it('creates a preview force entry even when the preview contains an error but still has units', () => {
        const preview = {
            gameSystem: GameSystem.ALPHA_STRIKE,
            units: [{
                unit: createUnit({ id: 1, name: 'Locked Atlas', chassis: 'Atlas', as: { PV: 6 } as Unit['as'] }),
                cost: 6,
                skill: 3,
                lockKey: 'locked-atlas',
            }],
            totalCost: 6,
            error: 'Need at least 2 units.',
            faction: null,
            era: null,
            explanationLines: ['Need at least 2 units.'],
        };

        expect(service.createForceEntry(preview)).not.toBeNull();
    });

    it('splits a generated company into lance groups and picks the best formation layout', () => {
        const era = createEra(3150, 'ilClan');
        const faction = createFaction(10, 'Federated Suns');
        const previewUnits = [
            createUnit({ id: 1, name: 'A-1', chassis: 'Alpha', model: '1', role: 'brawler' }),
            createUnit({ id: 2, name: 'B-1', chassis: 'Beta', model: '1', role: 'sniper' }),
            createUnit({ id: 3, name: 'C-1', chassis: 'Gamma', model: '1', role: 'scout' }),
            createUnit({ id: 4, name: 'A-2', chassis: 'Alpha', model: '2', role: 'brawler' }),
            createUnit({ id: 5, name: 'B-2', chassis: 'Beta', model: '2', role: 'sniper' }),
            createUnit({ id: 6, name: 'C-2', chassis: 'Gamma', model: '2', role: 'scout' }),
            createUnit({ id: 7, name: 'A-3', chassis: 'Alpha', model: '3', role: 'brawler' }),
            createUnit({ id: 8, name: 'B-3', chassis: 'Beta', model: '3', role: 'sniper' }),
            createUnit({ id: 9, name: 'C-3', chassis: 'Gamma', model: '3', role: 'scout' }),
            createUnit({ id: 10, name: 'A-4', chassis: 'Alpha', model: '4', role: 'brawler' }),
            createUnit({ id: 11, name: 'B-4', chassis: 'Beta', model: '4', role: 'sniper' }),
            createUnit({ id: 12, name: 'C-4', chassis: 'Gamma', model: '4', role: 'scout' }),
        ];
        const eliteFormation = {
            id: 'elite-lance',
            name: 'Elite',
            description: 'Parent-weighted test formation.',
            minUnits: 4,
            parent: 'battle-lance',
        } as any;
        const reconFormation = {
            id: 'recon-lance',
            name: 'Recon',
            description: 'Standard weighted test formation.',
            minUnits: 4,
        } as any;
        const battleFormation = {
            id: 'battle-lance',
            name: 'Battle',
            description: 'Baseline battle formation.',
            minUnits: 4,
        } as any;
        const supportFormation = {
            id: 'support-lance',
            name: 'Support',
            description: 'Low-priority fallback formation.',
            minUnits: 4,
        } as any;

        spyOn(LanceTypeIdentifierUtil, 'identifyFormations').and.callFake((forceUnits) => {
            const unitNames = forceUnits.map((unit) => unit.getUnit().name);
            if (unitNames.length !== 4) {
                return [];
            }

            if (unitNames.every((name) => name.startsWith('A-'))) {
                return [{ definition: eliteFormation, requirementsFiltered: false }];
            }
            if (unitNames.every((name) => name.startsWith('B-'))) {
                return [{ definition: reconFormation, requirementsFiltered: false }];
            }
            if (unitNames.every((name) => name.startsWith('C-'))) {
                return [{ definition: battleFormation, requirementsFiltered: false }];
            }

            return [{ definition: supportFormation, requirementsFiltered: false }];
        });

        const entry = service.createForceEntry({
            gameSystem: GameSystem.ALPHA_STRIKE,
            units: previewUnits.map((unit, index) => ({
                unit,
                cost: 25 + index,
                skill: 4,
            })),
            totalCost: 400,
            error: null,
            faction,
            era,
            explanationLines: [],
        });

        expect(entry).not.toBeNull();
        expect(entry!.groups.length).toBe(3);
        expect(entry!.groups.map((group) => group.units.map((unit) => unit.unit?.name))).toEqual([
            ['A-1', 'A-2', 'A-3', 'A-4'],
            ['B-1', 'B-2', 'B-3', 'B-4'],
            ['C-1', 'C-2', 'C-3', 'C-4'],
        ]);
        expect(entry!.groups.map((group) => group.formationId)).toEqual([
            'elite-lance',
            'recon-lance',
            'battle-lance',
        ]);
    });

    it('splits a generated binary into star groups before assigning formations', () => {
        const era = createEra(3150, 'ilClan');
        const faction = {
            ...createFaction(10, 'Clan Test'),
            group: 'HW Clan',
        } as Faction;
        const previewUnits = [
            createUnit({ id: 1, name: 'X-1', chassis: 'X', model: '1', techBase: 'Clan', as: { TP: 'BM', PV: 5 } as Unit['as'] }),
            createUnit({ id: 2, name: 'Y-1', chassis: 'Y', model: '1', techBase: 'Clan', as: { TP: 'BM', PV: 5 } as Unit['as'] }),
            createUnit({ id: 3, name: 'X-2', chassis: 'X', model: '2', techBase: 'Clan', as: { TP: 'BM', PV: 5 } as Unit['as'] }),
            createUnit({ id: 4, name: 'Y-2', chassis: 'Y', model: '2', techBase: 'Clan', as: { TP: 'BM', PV: 5 } as Unit['as'] }),
            createUnit({ id: 5, name: 'X-3', chassis: 'X', model: '3', techBase: 'Clan', as: { TP: 'BM', PV: 5 } as Unit['as'] }),
            createUnit({ id: 6, name: 'Y-3', chassis: 'Y', model: '3', techBase: 'Clan', as: { TP: 'BM', PV: 5 } as Unit['as'] }),
            createUnit({ id: 7, name: 'X-4', chassis: 'X', model: '4', techBase: 'Clan', as: { TP: 'BM', PV: 5 } as Unit['as'] }),
            createUnit({ id: 8, name: 'Y-4', chassis: 'Y', model: '4', techBase: 'Clan', as: { TP: 'BM', PV: 5 } as Unit['as'] }),
            createUnit({ id: 9, name: 'X-5', chassis: 'X', model: '5', techBase: 'Clan', as: { TP: 'BM', PV: 5 } as Unit['as'] }),
            createUnit({ id: 10, name: 'Y-5', chassis: 'Y', model: '5', techBase: 'Clan', as: { TP: 'BM', PV: 5 } as Unit['as'] }),
        ];
        const clanFormation = {
            id: 'clan-star',
            name: 'Clan Star',
            description: 'Parent-weighted Clan test formation.',
            minUnits: 5,
            parent: 'battle-lance',
        } as any;
        const hunterFormation = {
            id: 'hunter-star',
            name: 'Hunter Star',
            description: 'Standard weighted Clan test formation.',
            minUnits: 5,
        } as any;
        const supportFormation = {
            id: 'support-lance',
            name: 'Support',
            description: 'Low-priority fallback formation.',
            minUnits: 5,
        } as any;

        spyOn(LanceTypeIdentifierUtil, 'identifyFormations').and.callFake((forceUnits) => {
            const unitNames = forceUnits.map((unit) => unit.getUnit().name);
            if (unitNames.length !== 5) {
                return [];
            }

            if (unitNames.every((name) => name.startsWith('X-'))) {
                return [{ definition: clanFormation, requirementsFiltered: false }];
            }
            if (unitNames.every((name) => name.startsWith('Y-'))) {
                return [{ definition: hunterFormation, requirementsFiltered: false }];
            }

            return [{ definition: supportFormation, requirementsFiltered: false }];
        });

        const entry = service.createForceEntry({
            gameSystem: GameSystem.ALPHA_STRIKE,
            units: previewUnits.map((unit, index) => ({
                unit,
                cost: 30 + index,
                skill: 4,
            })),
            totalCost: 345,
            error: null,
            faction,
            era,
            explanationLines: [],
        });

        expect(entry).not.toBeNull();
        expect(entry!.groups.length).toBe(2);
        expect(entry!.groups.map((group) => group.units.map((unit) => unit.unit?.name))).toEqual([
            ['X-1', 'X-2', 'X-3', 'X-4', 'X-5'],
            ['Y-1', 'Y-2', 'Y-3', 'Y-4', 'Y-5'],
        ]);
        expect(entry!.groups.map((group) => group.formationId)).toEqual([
            'clan-star',
            'hunter-star',
        ]);
    });

    it('keeps retrying until the no-match search window expires', () => {
        const era = createEra(3150, 'ilClan');
        const faction = createFaction(10, 'Federated Suns');
        const lightUnit = createUnit({ id: 1, name: 'Light Unit', as: { PV: 4 } as Unit['as'] });
        const mediumUnit = createUnit({ id: 2, name: 'Medium Unit', as: { PV: 5 } as Unit['as'] });

        spyOn(Math, 'random').and.returnValue(0);
        const buildSelectionSpy = spyOn<any>(service, 'buildCandidateSelection').and.callThrough();

        let nowValue = 0;
        spyOn(performance, 'now').and.callFake(() => {
            nowValue += 8;
            return nowValue;
        });

        const preview = service.buildPreview({
            eligibleUnits: [lightUnit, mediumUnit],
            context: createContext(faction, era),
            gameSystem: GameSystem.ALPHA_STRIKE,
            budgetRange: { min: 8, max: 8 },
            minUnitCount: 1,
            maxUnitCount: 2,
            gunnery: 4,
            piloting: 5,
        });

        expect(preview.error).toBeNull();
        expect(preview.units.length).toBe(1);
        expect(service.createForceEntry(preview)).not.toBeNull();
        expect(buildSelectionSpy.calls.count()).toBeGreaterThan(8);
        expect(buildSelectionSpy.calls.count()).toBeLessThan(12);
    });

    it('returns the highest failed attempt that does not exceed the target even if another attempt is closer on unit count', () => {
        const era = createEra(3150, 'ilClan');
        const faction = createFaction(10, 'Federated Suns');
        const nearBudgetA = createUnit({ id: 1, name: 'Near Budget A', as: { PV: 10 } as Unit['as'] });
        const nearBudgetB = createUnit({ id: 2, name: 'Near Budget B', as: { PV: 9 } as Unit['as'] });
        const countMatchA = createUnit({ id: 3, name: 'Count Match A', as: { PV: 4 } as Unit['as'] });
        const countMatchB = createUnit({ id: 4, name: 'Count Match B', as: { PV: 4 } as Unit['as'] });
        const countMatchC = createUnit({ id: 5, name: 'Count Match C', as: { PV: 4 } as Unit['as'] });
        const countMatchD = createUnit({ id: 6, name: 'Count Match D', as: { PV: 4 } as Unit['as'] });

        const budgetCloserAttempt = {
            selectedCandidates: [nearBudgetA, nearBudgetB].map((unit) => ({
                unit,
                productionWeight: 1,
                salvageWeight: 1,
                cost: unit.as.PV,
                megaMekUnitType: 'Mek',
            })),
            selectionSteps: [],
            rulesetProfile: null,
        };
        const countCloserAttempt = {
            selectedCandidates: [countMatchA, countMatchB, countMatchC, countMatchD].map((unit) => ({
                unit,
                productionWeight: 1,
                salvageWeight: 1,
                cost: unit.as.PV,
                megaMekUnitType: 'Mek',
            })),
            selectionSteps: [],
            rulesetProfile: null,
        };

        let callCount = 0;
        spyOn(Math, 'random').and.returnValue(0);
        spyOn<any>(service, 'buildCandidateSelection').and.callFake(() => {
            callCount += 1;
            return callCount === 1 ? countCloserAttempt as any : budgetCloserAttempt as any;
        });

        let nowValue = 0;
        spyOn(performance, 'now').and.callFake(() => {
            nowValue += 100;
            return nowValue;
        });

        const preview = service.buildPreview({
            eligibleUnits: [nearBudgetA, nearBudgetB, countMatchA, countMatchB, countMatchC, countMatchD],
            context: createContext(faction, era),
            gameSystem: GameSystem.ALPHA_STRIKE,
            budgetRange: { min: 20, max: 20 },
            minUnitCount: 4,
            maxUnitCount: 8,
            gunnery: 4,
            piloting: 5,
        });

        expect(preview.error).toBeNull();
        expect(preview.units.map((unit) => unit.unit.name)).toEqual(['Near Budget A', 'Near Budget B']);
        expect(preview.totalCost).toBe(19);
        expect(service.createForceEntry(preview)).not.toBeNull();
    });

    it('prefers the highest total below the target over a closer total that exceeds it', () => {
        const era = createEra(3150, 'ilClan');
        const faction = createFaction(10, 'Federated Suns');
        const underTargetUnit = createUnit({ id: 1, name: 'Under Target', as: { PV: 5890 } as Unit['as'] });
        const overTargetUnit = createUnit({ id: 2, name: 'Over Target', as: { PV: 5910 } as Unit['as'] });

        const underTargetAttempt = {
            selectedCandidates: [underTargetUnit].map((unit) => ({
                unit,
                productionWeight: 1,
                salvageWeight: 1,
                cost: unit.as.PV,
                megaMekUnitType: 'Mek',
            })),
            selectionSteps: [],
            rulesetProfile: null,
        };
        const overTargetAttempt = {
            selectedCandidates: [overTargetUnit].map((unit) => ({
                unit,
                productionWeight: 1,
                salvageWeight: 1,
                cost: unit.as.PV,
                megaMekUnitType: 'Mek',
            })),
            selectionSteps: [],
            rulesetProfile: null,
        };

        let callCount = 0;
        spyOn(Math, 'random').and.returnValue(0);
        spyOn<any>(service, 'buildCandidateSelection').and.callFake(() => {
            callCount += 1;
            return callCount === 1 ? overTargetAttempt as any : underTargetAttempt as any;
        });

        let nowValue = 0;
        spyOn(performance, 'now').and.callFake(() => {
            nowValue += 100;
            return nowValue;
        });

        const preview = service.buildPreview({
            eligibleUnits: [underTargetUnit, overTargetUnit],
            context: createContext(faction, era),
            gameSystem: GameSystem.ALPHA_STRIKE,
            budgetRange: { min: 5900, max: 5900 },
            minUnitCount: 1,
            maxUnitCount: 1,
            gunnery: 4,
            piloting: 5,
        });

        expect(preview.error).toBeNull();
        expect(preview.units.map((unit) => unit.unit.name)).toEqual(['Under Target']);
        expect(preview.totalCost).toBe(5890);
        expect(service.createForceEntry(preview)).not.toBeNull();
    });

    it('uses ruleset preferences to bias additional unit selection', () => {
        const era = createEra(3150, 'ilClan');
        const faction = createFaction(10, 'Federated Suns');
        const seedUnit = createUnit({ id: 1, name: 'Seed', role: 'skirmisher', weightClass: 'Medium', as: { PV: 4 } as Unit['as'] });
        const commandUnit = createUnit({ id: 2, name: 'Command', role: 'command', weightClass: 'Heavy', as: { PV: 4 } as Unit['as'] });
        const scoutUnit = createUnit({ id: 3, name: 'Scout', role: 'scout', weightClass: 'Light', as: { PV: 4 } as Unit['as'] });
        const ruleset: MegaMekRulesetRecord = {
            factionKey: 'FS',
            indexes: {
                forceIndexesByEchelon: {
                    LANCE: [0],
                },
            },
            forceCount: 1,
            forces: [
                {
                    when: {
                        unitTypes: ['Mek'],
                    },
                    assign: {
                        roles: ['command'],
                        weightClasses: ['H'],
                    },
                    echelon: {
                        code: 'LANCE',
                    },
                },
            ],
        };

        const baseRequest = {
            eligibleUnits: [seedUnit, commandUnit, scoutUnit],
            context: createContext(faction, era),
            gameSystem: GameSystem.ALPHA_STRIKE,
            budgetRange: { min: 0, max: 20 },
            minUnitCount: 1,
            maxUnitCount: 2,
            gunnery: 4,
            piloting: 5,
        } as const;

        const randomSpy = spyOn(Math, 'random');

        randomSpy.and.returnValues(0, 0, 0, 0.6);
        let preview = service.buildPreview(baseRequest);
        expect(preview.units.map((unit) => unit.unit.name)).toEqual(['Seed', 'Scout']);

        megaMekRulesetsByMulFactionId.set(faction.id, [ruleset]);
        megaMekRulesetsByFactionKey.set(ruleset.factionKey, ruleset);

        randomSpy.calls.reset();
        randomSpy.and.returnValues(0, 0, 0, 0.6);
        preview = service.buildPreview(baseRequest);
        expect(preview.units.map((unit) => unit.unit.name)).toEqual(['Seed', 'Command']);
        expect(preview.explanationLines.some((line) => line.includes('Ruleset guidance: Federated Suns, echelon LANCE.'))).toBeTrue();
    });

    it('applies ruleset bias before the first pick instead of deriving it from a random seed unit', () => {
        const era = createEra(3025, 'Star League', 3025, 3025);
        const faction = createFaction(10, 'Capellan Confederation');
        const jumpShip = createUnit({
            id: 1,
            name: 'JumpShip Seed',
            type: 'Aero',
            subtype: 'JumpShip',
            moveType: 'Aerodyne',
            as: { PV: 5 } as Unit['as'],
        });
        const mek = createUnit({
            id: 2,
            name: 'BattleMek Pick',
            type: 'Mek',
            subtype: 'BattleMek',
            as: { PV: 5 } as Unit['as'],
        });
        const ruleset: MegaMekRulesetRecord = {
            factionKey: 'CC',
            indexes: { forceIndexesByEchelon: {} },
            forceCount: 1,
            forces: [
                {
                    when: {
                        unitTypes: ['Mek'],
                        topLevel: true,
                    },
                    unitType: {
                        options: [{ unitTypes: ['Mek'] }],
                    },
                },
            ],
        };

        megaMekAvailabilityByUnitName.set(jumpShip.name, {
            e: {
                '3025': {
                    '10': [1, 1],
                },
            },
        });
        megaMekAvailabilityByUnitName.set(mek.name, {
            e: {
                '3025': {
                    '10': [1, 1],
                },
            },
        });
        megaMekRulesetsByMulFactionId.set(faction.id, [ruleset]);
        megaMekRulesetsByFactionKey.set(ruleset.factionKey, ruleset);

        spyOn(Math, 'random').and.returnValue(0.4);

        const preview = service.buildPreview({
            eligibleUnits: [jumpShip, mek],
            context: { ...createContext(faction, era), ruleset },
            gameSystem: GameSystem.ALPHA_STRIKE,
            budgetRange: { min: 0, max: 5 },
            minUnitCount: 1,
            maxUnitCount: 1,
            gunnery: 4,
            piloting: 5,
        });

        expect(preview.error).toBeNull();
        expect(preview.units.map((unit) => unit.unit.name)).toEqual(['BattleMek Pick']);
        expect(preview.explanationLines.some((line) => line.includes('no matching force node'))).toBeFalse();
    });

    it('does not resolve an aero echelon from a mixed pool when only mek candidates can satisfy the requested size', () => {
        const era = createEra(3052, 'Clan Invasion');
        const faction = createFaction(10, 'Capellan Confederation');
        const mekUnits = [
            createUnit({ id: 1, name: 'Mek 1', as: { PV: 5 } as Unit['as'] }),
            createUnit({ id: 2, name: 'Mek 2', as: { PV: 5 } as Unit['as'] }),
            createUnit({ id: 3, name: 'Mek 3', as: { PV: 5 } as Unit['as'] }),
            createUnit({ id: 4, name: 'Mek 4', as: { PV: 5 } as Unit['as'] }),
        ];
        const aeroUnit = createUnit({
            id: 5,
            name: 'Fighter 1',
            type: 'Aero',
            subtype: 'Aerospace Fighter',
            moveType: 'Aerodyne',
            as: { PV: 5, TP: 'AF', MVm: { a: 8 } } as unknown as Unit['as'],
        });
        const ruleset: MegaMekRulesetRecord = {
            factionKey: 'CC',
            indexes: {
                forceIndexesByEchelon: {
                    LANCE: [0],
                    WING: [1],
                },
            },
            forceCount: 2,
            toc: {
                echelon: {
                    options: [
                        {
                            echelons: [{ code: 'LANCE' }],
                            when: { unitTypes: ['Mek'] },
                        },
                        {
                            echelons: [{ code: 'WING' }],
                            when: { unitTypes: ['AeroSpaceFighter'] },
                        },
                    ],
                },
            },
            forces: [
                {
                    when: {
                        unitTypes: ['Mek'],
                        topLevel: true,
                    },
                    echelon: { code: 'LANCE' },
                },
                {
                    when: {
                        unitTypes: ['AeroSpaceFighter'],
                        topLevel: true,
                    },
                    echelon: { code: 'WING' },
                },
            ],
        };

        megaMekRulesetsByMulFactionId.set(faction.id, [ruleset]);
        megaMekRulesetsByFactionKey.set(ruleset.factionKey, ruleset);

        spyOn(Math, 'random').and.returnValue(0);

        const preview = service.buildPreview({
            eligibleUnits: [...mekUnits, aeroUnit],
            context: createContext(faction, era),
            gameSystem: GameSystem.ALPHA_STRIKE,
            budgetRange: { min: 20, max: 20 },
            minUnitCount: 4,
            maxUnitCount: 8,
            gunnery: 4,
            piloting: 5,
        });

        expect(preview.error).toBeNull();
        expect(preview.explanationLines.some((line) => line.includes('echelon WING'))).toBeFalse();
        expect(preview.explanationLines.some((line) => line.includes('Ruleset guidance: Capellan Confederation, echelon LANCE.'))).toBeTrue();
        expect(preview.units.every((unit) => unit.unit.type === 'Mek')).toBeTrue();
    });

    it('samples different valid top-level echelons from the weighted unit-type pool instead of fixing the midpoint choice', () => {
        const era = createEra(3052, 'Clan Invasion');
        const faction = createFaction(10, 'Capellan Confederation');
        const mekUnits = [
            createUnit({ id: 1, name: 'Mek 1', as: { PV: 5 } as Unit['as'] }),
            createUnit({ id: 2, name: 'Mek 2', as: { PV: 5 } as Unit['as'] }),
            createUnit({ id: 3, name: 'Mek 3', as: { PV: 5 } as Unit['as'] }),
            createUnit({ id: 4, name: 'Mek 4', as: { PV: 5 } as Unit['as'] }),
        ];
        const aeroUnits = [
            createUnit({
                id: 5,
                name: 'Fighter 1',
                type: 'Aero',
                subtype: 'Aerospace Fighter',
                moveType: 'Aerodyne',
                as: { PV: 5, TP: 'AF', MVm: { a: 8 } } as unknown as Unit['as'],
            }),
            createUnit({
                id: 6,
                name: 'Fighter 2',
                type: 'Aero',
                subtype: 'Aerospace Fighter',
                moveType: 'Aerodyne',
                as: { PV: 5, TP: 'AF', MVm: { a: 8 } } as unknown as Unit['as'],
            }),
            createUnit({
                id: 7,
                name: 'Fighter 3',
                type: 'Aero',
                subtype: 'Aerospace Fighter',
                moveType: 'Aerodyne',
                as: { PV: 5, TP: 'AF', MVm: { a: 8 } } as unknown as Unit['as'],
            }),
            createUnit({
                id: 8,
                name: 'Fighter 4',
                type: 'Aero',
                subtype: 'Aerospace Fighter',
                moveType: 'Aerodyne',
                as: { PV: 5, TP: 'AF', MVm: { a: 8 } } as unknown as Unit['as'],
            }),
            createUnit({
                id: 9,
                name: 'Fighter 5',
                type: 'Aero',
                subtype: 'Aerospace Fighter',
                moveType: 'Aerodyne',
                as: { PV: 5, TP: 'AF', MVm: { a: 8 } } as unknown as Unit['as'],
            }),
            createUnit({
                id: 10,
                name: 'Fighter 6',
                type: 'Aero',
                subtype: 'Aerospace Fighter',
                moveType: 'Aerodyne',
                as: { PV: 5, TP: 'AF', MVm: { a: 8 } } as unknown as Unit['as'],
            }),
        ];
        const ruleset: MegaMekRulesetRecord = {
            factionKey: 'CC',
            indexes: {
                forceIndexesByEchelon: {
                    LANCE: [0],
                    SQUADRON: [1],
                },
            },
            forceCount: 2,
            toc: {
                echelon: {
                    options: [
                        {
                            echelons: [{ code: 'LANCE' }],
                            when: { unitTypes: ['Mek'] },
                        },
                        {
                            echelons: [{ code: 'SQUADRON' }],
                            when: { unitTypes: ['AeroSpaceFighter'] },
                        },
                    ],
                },
            },
            forces: [
                {
                    when: {
                        unitTypes: ['Mek'],
                        topLevel: true,
                    },
                    echelon: { code: 'LANCE' },
                },
                {
                    when: {
                        unitTypes: ['AeroSpaceFighter'],
                        topLevel: true,
                    },
                    echelon: { code: 'SQUADRON' },
                },
            ],
        };

        for (const unit of mekUnits) {
            megaMekAvailabilityByUnitName.set(unit.name, {
                e: {
                    '3052': {
                        '10': [10, 0],
                    },
                },
            });
        }
        for (const unit of aeroUnits) {
            megaMekAvailabilityByUnitName.set(unit.name, {
                e: {
                    '3052': {
                        '10': [5, 0],
                    },
                },
            });
        }
        megaMekRulesetsByMulFactionId.set(faction.id, [ruleset]);
        megaMekRulesetsByFactionKey.set(ruleset.factionKey, ruleset);

        const randomSpy = spyOn(Math, 'random');

        randomSpy.and.returnValue(0);
        let preview = service.buildPreview({
            eligibleUnits: [...mekUnits, ...aeroUnits],
            context: createContext(faction, era),
            gameSystem: GameSystem.ALPHA_STRIKE,
            budgetRange: { min: 20, max: 30 },
            minUnitCount: 4,
            maxUnitCount: 12,
            gunnery: 4,
            piloting: 5,
        });

        expect(preview.error).toBeNull();
        expect(preview.explanationLines.some((line) => line.includes('Ruleset guidance: Capellan Confederation, echelon LANCE.'))).toBeTrue();
        expect(preview.units.length).toBe(4);
        expect(preview.units.every((unit) => unit.unit.type === 'Mek')).toBeTrue();

        randomSpy.calls.reset();
        randomSpy.and.returnValue(0.9);
        preview = service.buildPreview({
            eligibleUnits: [...mekUnits, ...aeroUnits],
            context: createContext(faction, era),
            gameSystem: GameSystem.ALPHA_STRIKE,
            budgetRange: { min: 20, max: 30 },
            minUnitCount: 4,
            maxUnitCount: 12,
            gunnery: 4,
            piloting: 5,
        });

        expect(preview.error).toBeNull();
        expect(preview.explanationLines.some((line) => line.includes('Ruleset guidance: Capellan Confederation, echelon SQUADRON.'))).toBeTrue();
        expect(preview.units.length).toBe(6);
        expect(preview.units.every((unit) => unit.unit.type === 'Aero')).toBeTrue();
    });

    it('switches child ruleset context with asFactionKey when building templates', () => {
        const era = createEra(3150, 'ilClan');
        const faction = createFaction(10, 'Federated Suns');
        const seedUnit = createUnit({ id: 1, name: 'Seed', role: 'skirmisher', weightClass: 'Medium', as: { PV: 4 } as Unit['as'] });
        const switchedMatch = createUnit({ id: 2, name: 'Clan Command', role: 'command', weightClass: 'Heavy', as: { PV: 4 } as Unit['as'] });
        const offMatch = createUnit({ id: 3, name: 'Scout', role: 'scout', weightClass: 'Light', as: { PV: 4 } as Unit['as'] });
        const parentRuleset: MegaMekRulesetRecord = {
            factionKey: 'FS',
            indexes: {
                forceIndexesByEchelon: {
                    LANCE: [0],
                },
            },
            forceCount: 1,
            forces: [
                {
                    when: {
                        unitTypes: ['Mek'],
                    },
                    echelon: {
                        code: 'LANCE',
                    },
                    subforces: [
                        {
                            subforces: [
                                {
                                    count: 1,
                                    asFactionKey: 'CLAN',
                                },
                            ],
                        },
                    ],
                },
            ],
        };
        const childRuleset: MegaMekRulesetRecord = {
            factionKey: 'CLAN',
            indexes: {
                forceIndexesByEchelon: {
                    LANCE: [0],
                },
            },
            forceCount: 1,
            forces: [
                {
                    when: {
                        unitTypes: ['Mek'],
                    },
                    assign: {
                        roles: ['command'],
                        weightClasses: ['H'],
                    },
                    echelon: {
                        code: 'LANCE',
                    },
                },
            ],
        };

        megaMekRulesetsByMulFactionId.set(faction.id, [parentRuleset]);
        megaMekRulesetsByFactionKey.set(parentRuleset.factionKey, parentRuleset);
        megaMekRulesetsByFactionKey.set(childRuleset.factionKey, childRuleset);

        const randomSpy = spyOn(Math, 'random');
        randomSpy.and.returnValues(0, 0, 0, 0.6);

        const preview = service.buildPreview({
            eligibleUnits: [seedUnit, switchedMatch, offMatch],
            context: createContext(faction, era),
            gameSystem: GameSystem.ALPHA_STRIKE,
            budgetRange: { min: 0, max: 20 },
            minUnitCount: 1,
            maxUnitCount: 2,
            gunnery: 4,
            piloting: 5,
        });

        expect(preview.units.map((unit) => unit.unit.name)).toEqual(['Seed', 'Clan Command']);
        expect(preview.explanationLines.some((line) => line.includes('Nested subforce rules switched to CLAN.'))).toBeTrue();
    });

    it('switches child ruleset context with useParentFaction based on MegaMek fallback order', () => {
        const era = createEra(3150, 'ilClan');
        const faction = createFaction(10, 'Clan Wolf');
        const seedUnit = createUnit({ id: 1, name: 'Seed', role: 'skirmisher', weightClass: 'Medium', as: { PV: 4 } as Unit['as'] });
        const parentMatch = createUnit({ id: 2, name: 'Parent Command', role: 'command', weightClass: 'Heavy', as: { PV: 4 } as Unit['as'] });
        const offMatch = createUnit({ id: 3, name: 'Scout', role: 'scout', weightClass: 'Light', as: { PV: 4 } as Unit['as'] });
        const primaryRuleset: MegaMekRulesetRecord = {
            factionKey: 'WOLF',
            parentFactionKey: 'CLAN',
            indexes: {
                forceIndexesByEchelon: {
                    LANCE: [0],
                },
            },
            forceCount: 1,
            forces: [
                {
                    when: {
                        unitTypes: ['Mek'],
                    },
                    echelon: {
                        code: 'LANCE',
                    },
                    subforces: [
                        {
                            subforces: [
                                {
                                    count: 1,
                                    useParentFaction: true,
                                },
                            ],
                        },
                    ],
                },
            ],
        };
        const parentRuleset: MegaMekRulesetRecord = {
            factionKey: 'CLAN',
            indexes: {
                forceIndexesByEchelon: {
                    LANCE: [0],
                },
            },
            forceCount: 1,
            forces: [
                {
                    when: {
                        unitTypes: ['Mek'],
                    },
                    assign: {
                        roles: ['command'],
                        weightClasses: ['H'],
                    },
                    echelon: {
                        code: 'LANCE',
                    },
                },
            ],
        };

        megaMekRulesetsByMulFactionId.set(faction.id, [primaryRuleset]);
        megaMekRulesetsByFactionKey.set(primaryRuleset.factionKey, primaryRuleset);
        megaMekRulesetsByFactionKey.set(parentRuleset.factionKey, parentRuleset);
        megaMekFactionsByKey.set('WOLF', {
            id: 'WOLF',
            name: 'Clan Wolf',
            mulId: [],
            yearsActive: [],
            fallBackFactions: ['CLAN'],
            ancestry: [],
            nameChanges: [],
        });

        const randomSpy = spyOn(Math, 'random');
        randomSpy.and.returnValues(0, 0, 0, 0.6);

        const preview = service.buildPreview({
            eligibleUnits: [seedUnit, parentMatch, offMatch],
            context: createContext(faction, era),
            gameSystem: GameSystem.ALPHA_STRIKE,
            budgetRange: { min: 0, max: 20 },
            minUnitCount: 1,
            maxUnitCount: 2,
            gunnery: 4,
            piloting: 5,
        });

        expect(preview.units.map((unit) => unit.unit.name)).toEqual(['Seed', 'Parent Command']);
        expect(preview.explanationLines.some((line) => line.includes('Nested subforce rules switched to CLAN.'))).toBeTrue();
    });

    it('uses the common unit count for Trinary instead of recursively expanding it through org child groups', () => {
        const era = createEra(3028, 'Late Succession War - LosTech', 3028, 3028);
        const faction = { ...createFaction(10, 'Clan Coyote'), group: 'Clan' } as unknown as Faction;
        const ruleset: MegaMekRulesetRecord = {
            factionKey: 'CCO',
            indexes: { forceIndexesByEchelon: { TRINARY: [0] } },
            forceCount: 1,
            toc: {
                echelon: {
                    options: [{ echelon: { code: 'TRINARY' } }],
                },
            },
            forces: [{ echelon: { code: 'TRINARY' } }],
        };

        megaMekRulesetsByMulFactionId.set(faction.id, [ruleset]);
        megaMekRulesetsByFactionKey.set(ruleset.factionKey, ruleset);

        const profile = (service as any).buildRulesetProfile(
            [],
            { ...createContext(faction, era), ruleset },
            10,
            20,
        );

        expect(profile).not.toBeNull();
        expect(profile.preferredOrgType).toBe('Trinary');
        expect(profile.preferredUnitCount).toBe(15);
        expect(profile.explanationNotes).toContain('Org target: Trinary (regular size 15).');
    });

    it('prefers a lance-shaped valid force over a company-shaped valid force when the ruleset selects LANCE', () => {
        const era = createEra(2570, 'Age of War');
        const faction = createFaction(10, 'Capellan Confederation');
        const lanceUnits = [
            createUnit({ id: 1, name: 'Lance 1', bv: 1450 }),
            createUnit({ id: 2, name: 'Lance 2', bv: 1450 }),
            createUnit({ id: 3, name: 'Lance 3', bv: 1450 }),
            createUnit({ id: 4, name: 'Lance 4', bv: 1450 }),
        ];
        const companyUnits = [
            createUnit({ id: 11, name: 'Company 1', bv: 840 }),
            createUnit({ id: 12, name: 'Company 2', bv: 840 }),
            createUnit({ id: 13, name: 'Company 3', bv: 840 }),
            createUnit({ id: 14, name: 'Company 4', bv: 840 }),
            createUnit({ id: 15, name: 'Company 5', bv: 840 }),
            createUnit({ id: 16, name: 'Company 6', bv: 840 }),
            createUnit({ id: 17, name: 'Company 7', bv: 840 }),
        ];
        const ruleset: MegaMekRulesetRecord = {
            factionKey: 'CC',
            indexes: { forceIndexesByEchelon: { LANCE: [0] } },
            forceCount: 1,
            forces: [{ echelon: { code: 'LANCE' } }],
        };

        megaMekRulesetsByMulFactionId.set(faction.id, [ruleset]);
        megaMekRulesetsByFactionKey.set(ruleset.factionKey, ruleset);

        let callCount = 0;
        spyOn<any>(service, 'buildCandidateSelection').and.callFake(() => {
            callCount += 1;
            return (callCount === 1
                ? {
                    selectedCandidates: companyUnits.map((unit) => ({ unit, productionWeight: 1, salvageWeight: 1, cost: unit.bv, megaMekUnitType: 'Mek' })),
                    selectionSteps: [],
                    rulesetProfile: {
                        selectedEchelon: 'LANCE',
                        preferredOrgType: 'Lance',
                        preferredUnitCount: 4,
                        preferredUnitTypes: new Set<string>(),
                        preferredWeightClasses: new Set<string>(),
                        preferredRoles: new Set<string>(),
                        preferredMotives: new Set<string>(),
                        templates: [],
                        explanationNotes: [],
                    },
                }
                : {
                    selectedCandidates: lanceUnits.map((unit) => ({ unit, productionWeight: 1, salvageWeight: 1, cost: unit.bv, megaMekUnitType: 'Mek' })),
                    selectionSteps: [],
                    rulesetProfile: {
                        selectedEchelon: 'LANCE',
                        preferredOrgType: 'Lance',
                        preferredUnitCount: 4,
                        preferredUnitTypes: new Set<string>(),
                        preferredWeightClasses: new Set<string>(),
                        preferredRoles: new Set<string>(),
                        preferredMotives: new Set<string>(),
                        templates: [],
                        explanationNotes: [],
                    },
                }) as any;
        });

        const preview = service.buildPreview({
            eligibleUnits: [...lanceUnits, ...companyUnits],
            context: createContext(faction, era),
            gameSystem: GameSystem.CLASSIC,
            budgetRange: { min: 5800, max: 5900 },
            minUnitCount: 4,
            maxUnitCount: 8,
            gunnery: 4,
            piloting: 5,
        });

        expect(preview.error).toBeNull();
        expect(preview.units.map((unit) => unit.unit.name)).toEqual(['Lance 1', 'Lance 2', 'Lance 3', 'Lance 4']);
        expect(preview.totalCost).toBe(5800);
        expect(preview.explanationLines.some((line) => line.includes('Resolved org shape: Lance.'))).toBeTrue();
        expect(callCount).toBe(2);
    });

    it('prefers a squadron-shaped valid force over a company-shaped valid force when the ruleset selects SQUADRON', () => {
        const era = createEra(3055, 'Clan Invasion');
        const faction = createFaction(10, 'Capellan Confederation');
        const fighterStats = { PV: 5, TP: 'AF', MVm: { a: 8 } } as unknown as Unit['as'];
        const squadronUnits = [
            createUnit({ id: 21, name: 'Fighter 1', type: 'Aero', subtype: 'Aerospace Fighter', moveType: 'Aerodyne', bv: 980, as: fighterStats }),
            createUnit({ id: 22, name: 'Fighter 2', type: 'Aero', subtype: 'Aerospace Fighter', moveType: 'Aerodyne', bv: 980, as: fighterStats }),
            createUnit({ id: 23, name: 'Fighter 3', type: 'Aero', subtype: 'Aerospace Fighter', moveType: 'Aerodyne', bv: 980, as: fighterStats }),
            createUnit({ id: 24, name: 'Fighter 4', type: 'Aero', subtype: 'Aerospace Fighter', moveType: 'Aerodyne', bv: 980, as: fighterStats }),
            createUnit({ id: 25, name: 'Fighter 5', type: 'Aero', subtype: 'Aerospace Fighter', moveType: 'Aerodyne', bv: 980, as: fighterStats }),
            createUnit({ id: 26, name: 'Fighter 6', type: 'Aero', subtype: 'Aerospace Fighter', moveType: 'Aerodyne', bv: 980, as: fighterStats }),
        ];
        const companyUnits = [
            createUnit({ id: 31, name: 'Mixed 1', bv: 840 }),
            createUnit({ id: 32, name: 'Mixed 2', bv: 840 }),
            createUnit({ id: 33, name: 'Mixed 3', bv: 840 }),
            createUnit({ id: 34, name: 'Mixed 4', bv: 840 }),
            createUnit({ id: 35, name: 'Mixed 5', bv: 840 }),
            createUnit({ id: 36, name: 'Mixed 6', bv: 840 }),
            createUnit({ id: 37, name: 'Mixed 7', bv: 840 }),
        ];

        let callCount = 0;
        spyOn<any>(service, 'buildCandidateSelection').and.callFake(() => {
            callCount += 1;
            return (callCount === 1
                ? {
                    selectedCandidates: companyUnits.map((unit) => ({ unit, productionWeight: 1, salvageWeight: 1, cost: unit.bv, megaMekUnitType: 'Mek' })),
                    selectionSteps: [],
                    rulesetProfile: {
                        selectedEchelon: 'SQUADRON',
                        preferredOrgType: 'Squadron',
                        preferredUnitCount: 6,
                        preferredUnitTypes: new Set<string>(),
                        preferredWeightClasses: new Set<string>(),
                        preferredRoles: new Set<string>(),
                        preferredMotives: new Set<string>(),
                        templates: [],
                        explanationNotes: [],
                    },
                }
                : {
                    selectedCandidates: squadronUnits.map((unit) => ({ unit, productionWeight: 1, salvageWeight: 1, cost: unit.bv, megaMekUnitType: 'AeroSpaceFighter' })),
                    selectionSteps: [],
                    rulesetProfile: {
                        selectedEchelon: 'SQUADRON',
                        preferredOrgType: 'Squadron',
                        preferredUnitCount: 6,
                        preferredUnitTypes: new Set<string>(),
                        preferredWeightClasses: new Set<string>(),
                        preferredRoles: new Set<string>(),
                        preferredMotives: new Set<string>(),
                        templates: [],
                        explanationNotes: [],
                    },
                }) as any;
        });

        const preview = service.buildPreview({
            eligibleUnits: [...squadronUnits, ...companyUnits],
            context: createContext(faction, era),
            gameSystem: GameSystem.CLASSIC,
            budgetRange: { min: 5800, max: 5900 },
            minUnitCount: 4,
            maxUnitCount: 8,
            gunnery: 4,
            piloting: 5,
        });

        expect(preview.error).toBeNull();
        expect(preview.units.map((unit) => unit.unit.name)).toEqual(['Fighter 1', 'Fighter 2', 'Fighter 3', 'Fighter 4', 'Fighter 5', 'Fighter 6']);
        expect(preview.explanationLines.some((line) => line.includes('Resolved org shape: Squadron.'))).toBeTrue();
    });
});