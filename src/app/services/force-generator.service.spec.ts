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
import type { ForcePreviewEntry } from '../models/force-preview.model';
import { createEmptyForceNameWords } from '../models/force-name-words.model';
import { LanceTypeIdentifierUtil } from '../utils/lance-type-identifier.util';
import { DataService } from './data.service';
import type { ForceGenerationContext } from './force-generator.service';
import { ForceGeneratorService } from './force-generator.service';
import { OptionsService } from './options.service';
import { createEmptyUnit, type TestUnitOverrides } from '../testing/unit-test-helpers';
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
        megaMekAvailabilityVersion: signal(0),
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
        getForceNameWords: jasmine.createSpy('getForceNameWords').and.callFake(() => createEmptyForceNameWords()),
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

    function createFaction(id: number, name: string, group = 'Inner Sphere'): Faction {
        return {
            id,
            name,
            group,
            img: '',
            eras: {},
        } as Faction;
    }

    function createUnit(overrides: TestUnitOverrides = {}): Unit {
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
        const { as: asOverrides, ...unitOverrides } = overrides;

        return createEmptyUnit({
            id: 1,
            name: 'Test Unit',
            chassis: 'Test',
            model: 'TST-1',
            bv: 1000,
            role: 'skirmisher',
            ...unitOverrides,
            type,
            subtype,
            moveType,
            as: {
                TP: alphaStrikeType,
                PV: 5,
                ...asOverrides,
            },
        });
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
    function registerEraAndFaction(era: Era, faction: Faction): void {
        erasByName.set(era.name, era);
        erasById.set(era.id, era);
        factionsByName.set(faction.name, faction);
        factionsById.set(faction.id, faction);
    }

    function addMegaMekAvailability(unit: Unit, faction: Faction, era: Era, requisition = 5, salvage = 0): void {
        megaMekAvailabilityByUnitName.set(unit.name, {
            e: {
                [`${era.id}`]: {
                    [`${faction.id}`]: [requisition, salvage],
                },
            },
        });
    }

    function registerMegaMekRuleset(faction: Faction, ruleset: MegaMekRulesetRecord): void {
        megaMekRulesetsByMulFactionId.set(faction.id, [ruleset]);
        megaMekRulesetsByFactionKey.set(ruleset.factionKey, ruleset);
    }

    function createMekOnlyStarRuleset(factionKey: string): MegaMekRulesetRecord {
        return {
            factionKey,
            indexes: {
                forceIndexesByEchelon: {
                    STAR: [0],
                },
            },
            forceCount: 1,
            forces: [
                {
                    when: {
                        unitTypes: ['Mek'],
                        topLevel: true,
                    },
                    echelon: { code: 'STAR' },
                },
            ],
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
        dataServiceMock.megaMekAvailabilityVersion.set(0);
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

    it('uses the stored force generator skill defaults', () => {
        const defaults = service.resolveInitialSkillDefaults({
            forceGenLastGunnerySkillMin: 2,
            forceGenLastGunnerySkillMax: 4,
            forceGenLastPilotingSkillMin: 3,
            forceGenLastPilotingSkillMax: 6,
            forceGenLastMaxPilotSkillDelta: 2,
        });

        expect(defaults).toEqual({
            gunnery: { min: 2, max: 4 },
            piloting: { min: 3, max: 6 },
            maxDelta: 2,
        });
    });

    it('normalizes stored force generator skill defaults', () => {
        const defaults = service.resolveInitialSkillDefaults({
            forceGenLastGunnerySkillMin: 9,
            forceGenLastGunnerySkillMax: 1,
            forceGenLastPilotingSkillMin: -1,
            forceGenLastPilotingSkillMax: 10,
            forceGenLastMaxPilotSkillDelta: 99,
        });

        expect(defaults).toEqual({
            gunnery: { min: 1, max: 8 },
            piloting: { min: 0, max: 8 },
            maxDelta: 8,
        });
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

    it('picks a random available faction and uses only that faction scope when Random faction is requested', () => {
        const era = createEra(3150, 'ilClan');
        const federatedSuns = createFaction(10, 'Federated Suns');
        const lyranAlliance = createFaction(20, 'Lyran Alliance');
        const mercenary = createFaction(MULFACTION_MERCENARY, 'Mercenary');
        const unit = createUnit({ name: 'Random Faction Atlas' });

        registerEraAndFaction(era, federatedSuns);
        factionsByName.set(lyranAlliance.name, lyranAlliance);
        factionsByName.set(mercenary.name, mercenary);
        factionsById.set(lyranAlliance.id, lyranAlliance);
        factionsById.set(mercenary.id, mercenary);
        megaMekAvailabilityByUnitName.set(unit.name, {
            e: {
                '3150': {
                    '10': [3, 1],
                    '20': [2, 2],
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
        spyOn(Math, 'random').and.returnValue(0.75);

        const context = service.resolveGenerationContext([unit], { randomFaction: true });

        expect(context.forceFaction).toBe(lyranAlliance);
        expect(context.forceEra).toBe(era);
        expect(context.availabilityFactionIds).toEqual([20]);
        expect(context.useAvailabilityFactionScope).toBeFalse();
    });

    it('uses a single rolled selected faction scope when selected-faction merging is disabled', () => {
        const era = createEra(3150, 'ilClan');
        const federatedSuns = createFaction(10, 'Federated Suns');
        const lyranAlliance = createFaction(20, 'Lyran Alliance');
        const unit = createUnit({ name: 'No Merge Atlas' });

        registerEraAndFaction(era, federatedSuns);
        factionsByName.set(lyranAlliance.name, lyranAlliance);
        factionsById.set(lyranAlliance.id, lyranAlliance);
        megaMekAvailabilityByUnitName.set(unit.name, {
            e: {
                '3150': {
                    '10': [3, 1],
                    '20': [2, 2],
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
                    fs: { name: 'Federated Suns', state: 'or', count: 1 },
                    la: { name: 'Lyran Alliance', state: 'or', count: 1 },
                },
            },
        });
        spyOn(Math, 'random').and.returnValue(0.75);

        const context = service.resolveGenerationContext([unit], { mergeSelectedFactionAvailability: false });

        expect(context.forceFaction).toBe(lyranAlliance);
        expect(context.forceEra).toBe(era);
        expect(context.availabilityFactionIds).toEqual([20]);
        expect(context.useAvailabilityFactionScope).toBeFalse();
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

    it('prefers the higher MegaMek availability weight and falls back unknown units to the minimum requisition-only weight', () => {
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
        const rulesetGuidanceIndex = preview.explanationLines.findIndex((line) => line.includes('Ruleset guidance: none resolved, so picks used weighted search only.'));
        const sourceRollOddsIndex = preview.explanationLines.findIndex((line) => line.includes('Source roll odds: requisition'));
        expect(sourceRollOddsIndex).toBeGreaterThan(rulesetGuidanceIndex);
    });

    it('keys MegaMek availability weights by unit name when units share a missing MUL id', () => {
        const era = createEra(3150, 'ilClan');
        const faction = createFaction(10, 'Federated Suns');
        const availableUnit = createUnit({ id: -1, name: 'Name-Keyed Available Unit', as: { PV: 5 } as Unit['as'] });
        const unavailableUnit = createUnit({ id: -1, name: 'Name-Keyed Unavailable Unit', as: { PV: 6 } as Unit['as'] });

        addMegaMekAvailability(availableUnit, faction, era, 5, 0);
        addMegaMekAvailability(unavailableUnit, faction, era, 0, 0);
        spyOn(Math, 'random').and.returnValue(0);

        const preview = service.buildPreview({
            eligibleUnits: [availableUnit, unavailableUnit],
            context: createContext(faction, era),
            gameSystem: GameSystem.ALPHA_STRIKE,
            budgetRange: { min: 0, max: 20 },
            minUnitCount: 1,
            maxUnitCount: 1,
            gunnery: 4,
            piloting: 5,
        });

        expect(preview.error).toBeNull();
        expect(preview.units.map((unit) => unit.unit.name)).toEqual(['Name-Keyed Available Unit']);
    });

    it('does not reuse force generation candidate caches across different names that share a missing MUL id', () => {
        const era = createEra(3150, 'ilClan');
        const faction = createFaction(10, 'Federated Suns');
        const firstUnit = createUnit({ id: -1, name: 'Signature Name Unit A', as: { PV: 5 } as Unit['as'] });
        const secondUnit = createUnit({ id: -1, name: 'Signature Name Unit B', as: { PV: 6 } as Unit['as'] });

        addMegaMekAvailability(firstUnit, faction, era, 5, 0);
        addMegaMekAvailability(secondUnit, faction, era, 5, 0);
        spyOn(Math, 'random').and.returnValue(0);

        const baseRequest = {
            context: createContext(faction, era),
            gameSystem: GameSystem.ALPHA_STRIKE,
            budgetRange: { min: 0, max: 20 },
            minUnitCount: 1,
            maxUnitCount: 1,
            gunnery: 4,
            piloting: 5,
        };

        const firstPreview = service.buildPreview({
            ...baseRequest,
            eligibleUnits: [firstUnit],
        });
        const secondPreview = service.buildPreview({
            ...baseRequest,
            eligibleUnits: [secondUnit],
        });

        expect(firstPreview.error).toBeNull();
        expect(secondPreview.error).toBeNull();
        expect(firstPreview.units.map((unit) => unit.unit.name)).toEqual(['Signature Name Unit A']);
        expect(secondPreview.units.map((unit) => unit.unit.name)).toEqual(['Signature Name Unit B']);
    });

    it('builds target formation candidates incrementally around locked units', () => {
        const era = createEra(3150, 'ilClan');
        const faction = createFaction(10, 'Draconis Combine');
        registerEraAndFaction(era, faction);
        const lockedPantherA = createUnit({ id: 1, name: 'Panther A', chassis: 'Panther', as: { TP: 'BM', SZ: 2, PV: 10 } });
        const lockedPantherB = createUnit({ id: 2, name: 'Panther B', chassis: 'Panther', as: { TP: 'BM', SZ: 2, PV: 10 } });
        const matchingPanther = createUnit({ id: 3, name: 'Panther C', chassis: 'Panther', as: { TP: 'BM', SZ: 2, PV: 10 } });
        const wrongChassis = createUnit({ id: 4, name: 'Dragon A', chassis: 'Dragon', as: { TP: 'BM', SZ: 2, PV: 10 } });
        for (const unit of [lockedPantherA, lockedPantherB, matchingPanther, wrongChassis]) {
            units.push(unit);
            addMegaMekAvailability(unit, faction, era);
        }

        const preview = service.buildPreview({
            eligibleUnits: [lockedPantherA, lockedPantherB, matchingPanther, wrongChassis],
            context: createContext(faction, era),
            gameSystem: GameSystem.ALPHA_STRIKE,
            budgetRange: { min: 0, max: 0 },
            minUnitCount: 3,
            maxUnitCount: 4,
            gunnery: 4,
            piloting: 5,
            lockedUnits: [
                { unit: lockedPantherA, cost: 10, skill: 4, lockKey: 'locked:a' },
                { unit: lockedPantherB, cost: 10, skill: 4, lockKey: 'locked:b' },
            ],
            targetFormationId: 'order-lance',
        });

        expect(preview.error).toBeNull();
        expect(preview.units.map((unit) => unit.unit.name)).toEqual(['Panther A', 'Panther B', 'Panther C']);
        expect(preview.explanationLines.join('\n')).toContain('Target formation: Order.');
        const previewEntry = service.createForcePreviewEntry(preview);
        expect(previewEntry?.groups[0]?.formationId).toBe('order-lance');
    });

    it('resolves loose target formation names and completes matched pairs without tag quantities', () => {
        const era = createEra(3150, 'ilClan');
        const faction = createFaction(10, 'Capellan Confederation');
        registerEraAndFaction(era, faction);
        const vedette = createUnit({
            id: 1,
            name: 'Vedette',
            chassis: 'Vedette',
            type: 'Tank',
            subtype: 'Combat Vehicle',
            role: 'Sniper',
            as: { TP: 'CV', SZ: 2, PV: 5 },
        });
        const goblin = createUnit({
            id: 2,
            name: 'Goblin',
            chassis: 'Goblin',
            type: 'Tank',
            subtype: 'Combat Vehicle',
            role: 'Scout',
            as: { TP: 'CV', SZ: 2, PV: 5 },
        });
        for (const unit of [vedette, goblin]) {
            units.push(unit);
            addMegaMekAvailability(unit, faction, era);
        }
        spyOn(Math, 'random').and.returnValue(0);

        const preview = service.buildPreview({
            eligibleUnits: [vedette, goblin],
            context: createContext(faction, era),
            gameSystem: GameSystem.ALPHA_STRIKE,
            budgetRange: { min: 0, max: 20 },
            minUnitCount: 3,
            maxUnitCount: 3,
            gunnery: 4,
            piloting: 5,
            targetFormationId: 'vehicle-command',
        });

        expect(preview.error).toBeNull();
        expect(preview.targetFormationId).toBe('vehicle-command-lance');
        expect(preview.explanationLines.join('\n')).toContain('Target formation: Vehicle Command.');
        expect(preview.units.map((unit) => unit.unit.name)).toEqual(['Vedette', 'Vedette', 'Vedette']);
    });

    it('allows Vehicle Command matched-pair completion when duplicate chassis prevention is enabled', () => {
        const era = createEra(3150, 'ilClan');
        const faction = createFaction(10, 'Mercenary');
        registerEraAndFaction(era, faction);
        const commandVehicle = createUnit({
            id: 1,
            name: 'Command Vedette',
            chassis: 'Command Vedette',
            type: 'Tank',
            subtype: 'Combat Vehicle',
            role: 'Sniper',
            as: { TP: 'CV', SZ: 2, PV: 60 },
        });
        const supportVehicles = [2, 3, 4].map((id) => createUnit({
            id,
            name: `Support Vehicle ${id}`,
            chassis: `Support Vehicle ${id}`,
            type: 'Tank',
            subtype: 'Combat Vehicle',
            role: 'Scout',
            as: { TP: 'CV', SZ: 2, PV: 60 },
        }));
        for (const unit of [commandVehicle, ...supportVehicles]) {
            units.push(unit);
            addMegaMekAvailability(unit, faction, era);
        }
        spyOn(Math, 'random').and.returnValue(0);

        const preview = service.buildPreview({
            eligibleUnits: [commandVehicle, ...supportVehicles],
            context: createContext(faction, era),
            gameSystem: GameSystem.ALPHA_STRIKE,
            budgetRange: { min: 300, max: 300 },
            minUnitCount: 5,
            maxUnitCount: 8,
            gunnery: 4,
            piloting: 4,
            preventDuplicateChassis: true,
            targetFormationId: 'vehicle-command',
        });

        expect(preview.error).toBeNull();
        expect(preview.targetFormationId).toBe('vehicle-command-lance');
        expect(preview.totalCost).toBe(300);
        expect(preview.units.map((unit) => unit.unit.name)).toEqual([
            'Command Vedette',
            'Command Vedette',
            'Support Vehicle 2',
            'Support Vehicle 3',
            'Support Vehicle 4',
        ]);
        expect(preview.explanationLines).toContain('Prevent Duplicate Chassis: on.');
    });

    it('prioritizes Artillery Fire equipment deficits over generic unit count progress', () => {
        const era = createEra(3150, 'ilClan');
        const faction = createFaction(10, 'Capellan Confederation');
        registerEraAndFaction(era, faction);
        const lineA = createUnit({ id: 1, name: 'Line A', as: { TP: 'BM', PV: 10 } });
        const lineB = createUnit({ id: 2, name: 'Line B', as: { TP: 'BM', PV: 10 } });
        const lineC = createUnit({ id: 3, name: 'Line C', as: { TP: 'BM', PV: 10 } });
        const artilleryA = createUnit({ id: 4, name: 'Artillery A', as: { TP: 'BM', PV: 10, specials: ['ART-LT'] } });
        const artilleryB = createUnit({ id: 5, name: 'Artillery B', as: { TP: 'BM', PV: 10, specials: ['ART-AIS'] } });
        for (const unit of [lineA, lineB, lineC, artilleryA, artilleryB]) {
            units.push(unit);
            addMegaMekAvailability(unit, faction, era);
        }
        spyOn(Math, 'random').and.returnValue(0);

        const preview = service.buildPreview({
            eligibleUnits: [lineA, lineB, lineC, artilleryA, artilleryB],
            context: createContext(faction, era),
            gameSystem: GameSystem.ALPHA_STRIKE,
            budgetRange: { min: 0, max: 0 },
            minUnitCount: 4,
            maxUnitCount: 4,
            gunnery: 4,
            piloting: 5,
            targetFormationId: 'artillery-fire-lance',
        });

        expect(preview.error).toBeNull();
        expect(preview.units.length).toBe(4);
        expect(preview.units.filter(generatedUnit => generatedUnit.unit.as?.specials?.some(special => special.startsWith('ART'))).length).toBe(2);
        expect(preview.targetFormationId).toBe('artillery-fire-lance');
        expect(preview.explanationLines.join('\n')).not.toContain('Result note: Target formation achieved');
    });

    it('reprices target formation skill combinations after the required units are selected', () => {
        const era = createEra(3150, 'ilClan');
        const faction = createFaction(10, 'Capellan Confederation');
        registerEraAndFaction(era, faction);
        const lineA = createUnit({ id: 1, name: 'Line A', as: { TP: 'BM', PV: 45 } });
        const lineB = createUnit({ id: 2, name: 'Line B', as: { TP: 'BM', PV: 45 } });
        const artilleryA = createUnit({ id: 3, name: 'Artillery A', as: { TP: 'BM', PV: 45, specials: ['ART-LT'] } });
        const artilleryB = createUnit({ id: 4, name: 'Artillery B', as: { TP: 'BM', PV: 45, specials: ['ART-AIS'] } });
        for (const unit of [lineA, lineB, artilleryA, artilleryB]) {
            units.push(unit);
            addMegaMekAvailability(unit, faction, era);
        }
        spyOn(Math, 'random').and.returnValue(0);

        const preview = service.buildPreview({
            eligibleUnits: [lineA, lineB, artilleryA, artilleryB],
            context: createContext(faction, era),
            gameSystem: GameSystem.ALPHA_STRIKE,
            budgetRange: { min: 180, max: 185 },
            minUnitCount: 4,
            maxUnitCount: 4,
            gunnery: 3,
            piloting: 5,
            skillRanges: {
                gunnery: { min: 3, max: 4 },
            },
            targetFormationId: 'artillery-fire-lance',
        });

        expect(preview.error).toBeNull();
        expect(preview.units.length).toBe(4);
        expect(preview.totalCost).toBe(180);
        expect(preview.units.every(generatedUnit => generatedUnit.skill === 4)).toBeTrue();
        expect(preview.targetFormationId).toBe('artillery-fire-lance');
        expect(preview.explanationLines.join('\n')).not.toContain('Result note: Target formation achieved');
    });

    it('builds separate target formation groups when two requested formations fit the unit cap', () => {
        const era = createEra(3150, 'ilClan');
        const faction = createFaction(10, 'Federated Suns');
        registerEraAndFaction(era, faction);
        const commandUnits = [
            createUnit({ id: 1, name: 'Command Sniper', role: 'Sniper', as: { TP: 'BM', SZ: 2, PV: 10, Arm: 4, dmg: { _dmgM: 2 } } as Unit['as'] }),
            createUnit({ id: 2, name: 'Command Skirmisher', role: 'Skirmisher', as: { TP: 'BM', SZ: 2, PV: 10, Arm: 4, dmg: { _dmgM: 2 } } as Unit['as'] }),
            createUnit({ id: 3, name: 'Command Brawler', role: 'Brawler', as: { TP: 'BM', SZ: 2, PV: 10, Arm: 4, dmg: { _dmgM: 2 } } as Unit['as'] }),
            createUnit({ id: 4, name: 'Command Scout', role: 'Scout', as: { TP: 'BM', SZ: 2, PV: 10, Arm: 4, dmg: { _dmgM: 2 } } as Unit['as'] }),
        ];
        const assaultUnits = [
            createUnit({ id: 5, name: 'Assault Juggernaut', role: 'Juggernaut', as: { TP: 'BM', SZ: 3, PV: 10, Arm: 5, dmg: { _dmgM: 3 } } as Unit['as'] }),
            createUnit({ id: 6, name: 'Assault Sniper A', role: 'Sniper', as: { TP: 'BM', SZ: 3, PV: 10, Arm: 5, dmg: { _dmgM: 3 } } as Unit['as'] }),
            createUnit({ id: 7, name: 'Assault Sniper B', role: 'Sniper', as: { TP: 'BM', SZ: 3, PV: 10, Arm: 5, dmg: { _dmgM: 3 } } as Unit['as'] }),
            createUnit({ id: 8, name: 'Assault Brawler', role: 'Brawler', as: { TP: 'BM', SZ: 3, PV: 10, Arm: 5, dmg: { _dmgM: 3 } } as Unit['as'] }),
        ];
        for (const unit of [...commandUnits, ...assaultUnits]) {
            units.push(unit);
            addMegaMekAvailability(unit, faction, era);
        }
        spyOn(Math, 'random').and.returnValue(0);

        const preview = service.buildPreview({
            eligibleUnits: [...commandUnits, ...assaultUnits],
            context: createContext(faction, era),
            gameSystem: GameSystem.ALPHA_STRIKE,
            budgetRange: { min: 0, max: 0 },
            minUnitCount: 8,
            maxUnitCount: 8,
            gunnery: 4,
            piloting: 5,
            targetFormations: [
                { formationId: 'command-lance', count: 1 },
                { formationId: 'assault-lance', count: 1 },
            ],
        });

        expect(preview.error).toBeNull();
        expect(preview.units.length).toBe(8);
        expect(preview.targetFormationGroups?.map((group) => group.formationId)).toEqual(['command-lance', 'assault-lance']);
        expect(preview.targetFormationGroups?.every((group) => group.validatedGameSystem === GameSystem.ALPHA_STRIKE)).toBeTrue();
        expect(preview.explanationLines.join('\n')).not.toContain('Result note: Target formations achieved');
        const targetValidationSpy = spyOn(service as any, 'isGeneratedPreviewValidForFormation').and.callThrough();
        const previewEntry = service.createForcePreviewEntry(preview);
        expect(targetValidationSpy).not.toHaveBeenCalled();
        expect(previewEntry?.groups.map((group) => group.formationId)).toEqual(['command-lance', 'assault-lance']);
    });

    it('keeps the closest target formation result when only one requested formation fits', () => {
        const era = createEra(3150, 'ilClan');
        const faction = createFaction(10, 'Federated Suns');
        registerEraAndFaction(era, faction);
        const commandUnits = [
            createUnit({ id: 1, name: 'Compact Command Sniper', role: 'Sniper', as: { TP: 'BM', SZ: 2, PV: 10, Arm: 4, dmg: { _dmgM: 2 } } as Unit['as'] }),
            createUnit({ id: 2, name: 'Compact Command Skirmisher', role: 'Skirmisher', as: { TP: 'BM', SZ: 2, PV: 10, Arm: 4, dmg: { _dmgM: 2 } } as Unit['as'] }),
            createUnit({ id: 3, name: 'Compact Command Brawler', role: 'Brawler', as: { TP: 'BM', SZ: 2, PV: 10, Arm: 4, dmg: { _dmgM: 2 } } as Unit['as'] }),
            createUnit({ id: 4, name: 'Compact Command Scout', role: 'Scout', as: { TP: 'BM', SZ: 2, PV: 10, Arm: 4, dmg: { _dmgM: 2 } } as Unit['as'] }),
        ];
        for (const unit of commandUnits) {
            units.push(unit);
            addMegaMekAvailability(unit, faction, era);
        }
        spyOn(Math, 'random').and.returnValue(0);

        const preview = service.buildPreview({
            eligibleUnits: commandUnits,
            context: createContext(faction, era),
            gameSystem: GameSystem.ALPHA_STRIKE,
            budgetRange: { min: 0, max: 0 },
            minUnitCount: 4,
            maxUnitCount: 4,
            gunnery: 4,
            piloting: 5,
            targetFormations: [
                { formationId: 'command-lance', count: 1 },
                { formationId: 'assault-lance', count: 1 },
            ],
        });

        expect(preview.error).toContain('Target formations achieved: 1 of 2 requested');
        expect(preview.units.length).toBe(4);
        expect(preview.targetFormationGroups?.map((group) => group.formationId)).toEqual(['command-lance']);
        expect(preview.explanationLines.join('\n')).toContain('Target formations achieved: 1 of 2 requested (Command).');
    });

    it('honors target formation quantities and returns the nearest capped result', () => {
        const era = createEra(3150, 'ilClan');
        const faction = createFaction(10, 'Capellan Confederation');
        registerEraAndFaction(era, faction);
        const commandUnits = [
            createUnit({ id: 1, name: 'Quantity Command Sniper', role: 'Sniper', as: { TP: 'BM', SZ: 2, PV: 10, Arm: 4, dmg: { _dmgM: 2 } } as Unit['as'] }),
            createUnit({ id: 2, name: 'Quantity Command Skirmisher', role: 'Skirmisher', as: { TP: 'BM', SZ: 2, PV: 10, Arm: 4, dmg: { _dmgM: 2 } } as Unit['as'] }),
            createUnit({ id: 3, name: 'Quantity Command Brawler', role: 'Brawler', as: { TP: 'BM', SZ: 2, PV: 10, Arm: 4, dmg: { _dmgM: 2 } } as Unit['as'] }),
            createUnit({ id: 4, name: 'Quantity Command Scout', role: 'Scout', as: { TP: 'BM', SZ: 2, PV: 10, Arm: 4, dmg: { _dmgM: 2 } } as Unit['as'] }),
        ];
        const antiAirUnits = [
            createUnit({ id: 5, name: 'Quantity Anti-Air A', role: 'Missile Boat', as: { TP: 'BM', PV: 10, specials: ['AC'] } as Unit['as'] }),
            createUnit({ id: 6, name: 'Quantity Anti-Air B', role: 'Sniper', as: { TP: 'BM', PV: 10, specials: ['FLK'] } as Unit['as'] }),
            createUnit({ id: 7, name: 'Quantity Anti-Air C', role: 'Missile Boat', as: { TP: 'BM', PV: 10 } as Unit['as'] }),
            createUnit({ id: 8, name: 'Quantity Anti-Air D', role: 'Brawler', as: { TP: 'BM', PV: 10 } as Unit['as'] }),
        ];
        const assaultUnits = [
            createUnit({ id: 9, name: 'Quantity Assault Juggernaut', role: 'Juggernaut', as: { TP: 'BM', SZ: 3, PV: 10, Arm: 5, dmg: { _dmgM: 3 } } as Unit['as'] }),
            createUnit({ id: 10, name: 'Quantity Assault Sniper A', role: 'Sniper', as: { TP: 'BM', SZ: 3, PV: 10, Arm: 5, dmg: { _dmgM: 3 } } as Unit['as'] }),
            createUnit({ id: 11, name: 'Quantity Assault Sniper B', role: 'Sniper', as: { TP: 'BM', SZ: 3, PV: 10, Arm: 5, dmg: { _dmgM: 3 } } as Unit['as'] }),
            createUnit({ id: 12, name: 'Quantity Assault Brawler', role: 'Brawler', as: { TP: 'BM', SZ: 3, PV: 10, Arm: 5, dmg: { _dmgM: 3 } } as Unit['as'] }),
        ];
        for (const unit of [...commandUnits, ...antiAirUnits, ...assaultUnits]) {
            units.push(unit);
            addMegaMekAvailability(unit, faction, era);
        }
        spyOn(Math, 'random').and.returnValue(0);

        const preview = service.buildPreview({
            eligibleUnits: [...commandUnits, ...antiAirUnits, ...assaultUnits],
            context: createContext(faction, era),
            gameSystem: GameSystem.ALPHA_STRIKE,
            budgetRange: { min: 0, max: 0 },
            minUnitCount: 8,
            maxUnitCount: 8,
            gunnery: 4,
            piloting: 5,
            targetFormations: [
                { formationId: 'command-lance', count: 1 },
                { formationId: 'anti-air-lance', count: 2 },
                { formationId: 'assault-lance', count: 2 },
            ],
        });

        expect(preview.error).toContain('Target formations achieved: 2 of 5 requested');
        expect(preview.units.length).toBe(8);
        expect(preview.targetFormations).toEqual([
            { formationId: 'command-lance', count: 1 },
            { formationId: 'anti-air-lance', count: 2 },
            { formationId: 'assault-lance', count: 2 },
        ]);
        expect(preview.targetFormationGroups?.map((group) => group.formationId)).toEqual(['command-lance', 'anti-air-lance']);
        expect(preview.explanationLines.join('\n')).toContain('Target formations: Command, 2 Anti-Air, 2 Assault.');
        expect(preview.explanationLines.join('\n')).toContain('Target formations achieved: 2 of 5 requested (Command, Anti-Air).');
    });

    it('prefers regular Clan Star sized groups for multi-target formations when the cap fits them', () => {
        const era = createEra(3150, 'ilClan');
        const faction: Faction = { ...createFaction(10, 'Clan Jade Falcon'), group: 'IS Clan' };
        registerEraAndFaction(era, faction);
        const assaultUnits = Array.from({ length: 15 }, (_, index) => createUnit({
            id: index + 1,
            name: `Regular Assault ${index + 1}`,
            role: 'Juggernaut',
            as: { TP: 'BM', SZ: 3, PV: 40, Arm: 5, dmg: { _dmgM: 3 } } as Unit['as'],
        }));
        const commandUnits = [
            createUnit({ id: 101, name: 'Regular Command Sniper', role: 'Sniper', as: { TP: 'BM', SZ: 2, PV: 40, Arm: 4, dmg: { _dmgM: 2 } } as Unit['as'] }),
            createUnit({ id: 102, name: 'Regular Command Missile Boat', role: 'Missile Boat', as: { TP: 'BM', SZ: 2, PV: 40, Arm: 4, dmg: { _dmgM: 2 } } as Unit['as'] }),
            createUnit({ id: 103, name: 'Regular Command Skirmisher', role: 'Skirmisher', as: { TP: 'BM', SZ: 2, PV: 40, Arm: 4, dmg: { _dmgM: 2 } } as Unit['as'] }),
            createUnit({ id: 104, name: 'Regular Command Brawler', role: 'Brawler', as: { TP: 'BM', SZ: 2, PV: 40, Arm: 4, dmg: { _dmgM: 2 } } as Unit['as'] }),
            createUnit({ id: 105, name: 'Regular Command Scout', role: 'Scout', as: { TP: 'BM', SZ: 2, PV: 40, Arm: 4, dmg: { _dmgM: 2 } } as Unit['as'] }),
        ];
        for (const unit of [...assaultUnits, ...commandUnits]) {
            units.push(unit);
            addMegaMekAvailability(unit, faction, era);
        }
        spyOn(Math, 'random').and.returnValue(0);

        const preview = service.buildPreview({
            eligibleUnits: [...assaultUnits, ...commandUnits],
            context: createContext(faction, era),
            gameSystem: GameSystem.ALPHA_STRIKE,
            budgetRange: { min: 800, max: 800 },
            minUnitCount: 20,
            maxUnitCount: 20,
            gunnery: 4,
            piloting: 5,
            targetFormations: [
                { formationId: 'assault-lance', count: 3 },
                { formationId: 'command-lance', count: 1 },
            ],
        });

        expect(preview.error).toBeNull();
        expect(preview.units.length).toBe(20);
        expect(preview.totalCost).toBe(800);
        expect(preview.targetFormationGroups?.map((group) => group.formationId)).toEqual([
            'assault-lance',
            'assault-lance',
            'assault-lance',
            'command-lance',
        ]);
        expect(preview.targetFormationGroups?.every((group) => group.unitIndexes.length === 5)).toBeTrue();
        expect(preview.explanationLines.join('\n')).not.toContain('Result note: Target formations achieved');
        const previewEntry = service.createForcePreviewEntry(preview);
        expect(previewEntry?.groups.length).toBe(4);
        expect(previewEntry?.groups.every((group) => group.units.length === 5)).toBeTrue();

        const underBudgetPreview = service.buildPreview({
            eligibleUnits: [...assaultUnits, ...commandUnits],
            context: createContext(faction, era),
            gameSystem: GameSystem.ALPHA_STRIKE,
            budgetRange: { min: 810, max: 810 },
            minUnitCount: 20,
            maxUnitCount: 20,
            gunnery: 4,
            piloting: 5,
            targetFormations: [
                { formationId: 'assault-lance', count: 3 },
                { formationId: 'command-lance', count: 1 },
            ],
        });

        expect(underBudgetPreview.error).toContain('Budget mismatch');
        expect(underBudgetPreview.units.length).toBe(20);
        expect(underBudgetPreview.totalCost).toBe(800);
        expect(underBudgetPreview.explanationLines.join('\n')).toContain('Target formations achieved');
    });

    it('fills additional units after multi-target formations to reach the requested unit range', () => {
        const era = createEra(3150, 'ilClan');
        const faction: Faction = { ...createFaction(10, 'Clan Jade Falcon'), group: 'IS Clan' };
        registerEraAndFaction(era, faction);
        const createAssaultUnit = (id: number, name: string, pv: number, fast = false) => createUnit({
            id,
            name,
            role: 'Juggernaut',
            as: {
                TP: 'BM',
                SZ: 3,
                PV: pv,
                Arm: 5,
                dmg: { _dmgM: 3 },
                MVm: fast ? { w: 10 } : { w: 8 },
            } as unknown as Unit['as'],
        });
        const createCommandUnit = (id: number, name: string, role: string, pv: number) => createUnit({
            id,
            name,
            role,
            as: { TP: 'BM', SZ: 2, PV: pv, Arm: 4, dmg: { _dmgM: 2 } } as Unit['as'],
        });
        const fastAssaultCheapUnits = Array.from({ length: 5 }, (_, index) => createAssaultUnit(100 + index, `Cheap Fast Assault ${index + 1}`, 20, true));
        const commandCheapUnits = ['Sniper', 'Missile Boat', 'Skirmisher', 'Brawler', 'Scout']
            .map((role, index) => createCommandUnit(200 + index, `Cheap Command ${index + 1}`, role, 20));
        const assaultCheapUnits = Array.from({ length: 5 }, (_, index) => createAssaultUnit(300 + index, `Cheap Assault ${index + 1}`, 20));
        const fillerUnits = Array.from({ length: 10 }, (_, index) => createUnit({
            id: 400 + index,
            name: `Cheap Filler ${index + 1}`,
            role: 'Skirmisher',
            as: { TP: 'BM', SZ: 2, PV: 20, Arm: 4, dmg: { _dmgM: 2 } } as Unit['as'],
        }));
        const fastAssaultExpensiveUnits = Array.from({ length: 5 }, (_, index) => createAssaultUnit(500 + index, `Expensive Fast Assault ${index + 1}`, 80, true));
        const commandExpensiveUnits = ['Sniper', 'Missile Boat', 'Skirmisher', 'Brawler', 'Scout']
            .map((role, index) => createCommandUnit(600 + index, `Expensive Command ${index + 1}`, role, 80));
        const assaultExpensiveUnits = Array.from({ length: 5 }, (_, index) => createAssaultUnit(700 + index, `Expensive Assault ${index + 1}`, 80));
        const eligibleUnits = [
            ...fastAssaultCheapUnits,
            ...commandCheapUnits,
            ...assaultCheapUnits,
            ...fillerUnits,
            ...fastAssaultExpensiveUnits,
            ...commandExpensiveUnits,
            ...assaultExpensiveUnits,
        ];
        for (const unit of eligibleUnits) {
            units.push(unit);
            addMegaMekAvailability(unit, faction, era);
        }
        let randomCallCount = 0;
        spyOn(Math, 'random').and.callFake(() => randomCallCount++ === 0 ? 0 : 0.99);

        const preview = service.buildPreview({
            eligibleUnits,
            context: createContext(faction, era),
            gameSystem: GameSystem.ALPHA_STRIKE,
            budgetRange: { min: 800, max: 800 },
            minUnitCount: 23,
            maxUnitCount: 25,
            gunnery: 4,
            piloting: 5,
            targetFormations: [
                { formationId: 'fast-assault-lance', count: 1 },
                { formationId: 'command-lance', count: 1 },
                { formationId: 'assault-lance', count: 1 },
            ],
        });

        expect(preview.error).toBeNull();
        expect(preview.units.length).toBeGreaterThanOrEqual(23);
        expect(preview.units.length).toBeLessThanOrEqual(25);
        expect(preview.totalCost).toBe(800);
        expect(preview.targetFormationGroups?.map((group) => group.formationId)).toEqual([
            'fast-assault-lance',
            'command-lance',
            'assault-lance',
        ]);
        expect(preview.targetFormationGroups?.every((group) => group.unitIndexes.length === 5)).toBeTrue();
        expect(preview.explanationLines.join('\n')).not.toContain('Target formations achieved');
    });

    it('keeps capped multi-target formation budget reachability checks bounded for large candidate pools', () => {
        const era = createEra(3028, 'Late Succession War - Renaissance');
        const faction = createFaction(MULFACTION_MERCENARY, 'Mercenary');
        registerEraAndFaction(era, faction);
        const commandUnits = [
            createUnit({ id: 1, name: 'Capped Command Sniper', role: 'Sniper', as: { TP: 'BM', SZ: 2, PV: 10, Arm: 4, dmg: { _dmgL: 1, _dmgM: 2 } } as Unit['as'] }),
            createUnit({ id: 2, name: 'Capped Command Missile', role: 'Missile Boat', as: { TP: 'BM', SZ: 2, PV: 10, Arm: 4, dmg: { _dmgL: 1, _dmgM: 2 } } as Unit['as'] }),
            createUnit({ id: 3, name: 'Capped Command Brawler', role: 'Brawler', as: { TP: 'BM', SZ: 2, PV: 10, Arm: 4, dmg: { _dmgL: 1, _dmgM: 2 } } as Unit['as'] }),
            createUnit({ id: 4, name: 'Capped Command Scout', role: 'Scout', as: { TP: 'BM', SZ: 2, PV: 10, Arm: 4, dmg: { _dmgL: 1, _dmgM: 2 } } as Unit['as'] }),
        ];
        const directFireUnits = [
            createUnit({ id: 10, name: 'Capped Direct Fire A', role: 'Sniper', as: { TP: 'BM', SZ: 3, PV: 10, Arm: 5, dmg: { _dmgL: 2, _dmgM: 3 } } as Unit['as'] }),
            createUnit({ id: 11, name: 'Capped Direct Fire B', role: 'Sniper', as: { TP: 'BM', SZ: 3, PV: 10, Arm: 5, dmg: { _dmgL: 2, _dmgM: 3 } } as Unit['as'] }),
            createUnit({ id: 12, name: 'Capped Direct Fire C', role: 'Brawler', as: { TP: 'BM', SZ: 3, PV: 10, Arm: 5, dmg: { _dmgL: 2, _dmgM: 3 } } as Unit['as'] }),
            createUnit({ id: 13, name: 'Capped Direct Fire D', role: 'Skirmisher', as: { TP: 'BM', SZ: 3, PV: 10, Arm: 5, dmg: { _dmgL: 2, _dmgM: 3 } } as Unit['as'] }),
        ];
        const fillerUnits = Array.from({ length: 320 }, (_, index) => createUnit({
            id: 1000 + index,
            name: `Capped Filler ${index + 1}`,
            role: 'Transport',
            as: { TP: 'BM', SZ: 1, PV: 10, Arm: 1, dmg: { _dmgL: 0, _dmgM: 1 } } as Unit['as'],
        }));
        const eligibleUnits = [...commandUnits, ...directFireUnits, ...fillerUnits];
        for (const unit of eligibleUnits) {
            units.push(unit);
            addMegaMekAvailability(unit, faction, era);
        }

        const reachabilityContextSpy = spyOn(service as any, 'createTargetFormationBudgetReachabilityContext').and.callThrough();
        spyOn(Math, 'random').and.returnValue(0);

        const preview = service.buildPreview({
            eligibleUnits,
            context: createContext(faction, era),
            gameSystem: GameSystem.ALPHA_STRIKE,
            budgetRange: { min: 120, max: 120 },
            minUnitCount: 12,
            maxUnitCount: 12,
            gunnery: 4,
            piloting: 5,
            targetFormations: [
                { formationId: 'command-lance', count: 1 },
                { formationId: 'direct-fire-lance', count: 1 },
            ],
        });

        expect(preview.error).toBeNull();
        expect(preview.units.length).toBe(12);
        expect(preview.totalCost).toBe(120);
        expect(preview.targetFormationGroups?.map((group) => group.formationId)).toEqual(['command-lance', 'direct-fire-lance']);
        expect(reachabilityContextSpy.calls.count()).toBeLessThan(30);
    });

    it('ignores faction-exclusive target formations outside the generation faction', () => {
        const era = createEra(3150, 'ilClan');
        const faction = createFaction(10, 'Clan Jade Falcon');
        registerEraAndFaction(era, faction);
        const commandUnits = [
            createUnit({ id: 1, name: 'Faction Command Sniper', role: 'Sniper', as: { TP: 'BM', SZ: 2, PV: 10, Arm: 4, dmg: { _dmgM: 2 } } as Unit['as'] }),
            createUnit({ id: 2, name: 'Faction Command Skirmisher', role: 'Skirmisher', as: { TP: 'BM', SZ: 2, PV: 10, Arm: 4, dmg: { _dmgM: 2 } } as Unit['as'] }),
            createUnit({ id: 3, name: 'Faction Command Brawler', role: 'Brawler', as: { TP: 'BM', SZ: 2, PV: 10, Arm: 4, dmg: { _dmgM: 2 } } as Unit['as'] }),
            createUnit({ id: 4, name: 'Faction Command Scout', role: 'Scout', as: { TP: 'BM', SZ: 2, PV: 10, Arm: 4, dmg: { _dmgM: 2 } } as Unit['as'] }),
            createUnit({ id: 5, name: 'Faction Command Sniper B', role: 'Sniper', as: { TP: 'BM', SZ: 2, PV: 10, Arm: 4, dmg: { _dmgM: 2 } } as Unit['as'] }),
        ];
        for (const unit of commandUnits) {
            units.push(unit);
            addMegaMekAvailability(unit, faction, era);
        }
        spyOn(Math, 'random').and.returnValue(0);

        const preview = service.buildPreview({
            eligibleUnits: commandUnits,
            context: createContext(faction, era),
            gameSystem: GameSystem.ALPHA_STRIKE,
            budgetRange: { min: 0, max: 0 },
            minUnitCount: 5,
            maxUnitCount: 5,
            gunnery: 4,
            piloting: 5,
            targetFormations: [
                { formationId: 'anvil-lance', count: 1 },
                { formationId: 'command-lance', count: 1 },
            ],
        });

        expect(preview.error).toBeNull();
        expect(preview.units.length).toBe(5);
        expect(preview.targetFormationId).toBe('command-lance');
        expect(preview.targetFormations).toEqual([{ formationId: 'command-lance', count: 1 }]);
        expect(preview.explanationLines.join('\n')).not.toContain('Anvil');
        expect(preview.explanationLines.join('\n')).not.toContain('Result note: Target formation achieved');
    });

    it('uses the first exclusive target formation to infer the generation faction when no faction is selected', () => {
        const era = createEra(3150, 'ilClan');
        const freeWorldsLeague = createFaction(10, 'Free Worlds League');
        const mercenary = createFaction(MULFACTION_MERCENARY, 'Mercenary');
        registerEraAndFaction(era, freeWorldsLeague);
        factionsByName.set(mercenary.name, mercenary);
        factionsById.set(mercenary.id, mercenary);
        const anvilUnits = [
            createUnit({ id: 1, name: 'Anvil AC A', role: 'Juggernaut', as: { TP: 'BM', SZ: 2, PV: 10, Arm: 4, specials: ['AC'] } as Unit['as'] }),
            createUnit({ id: 2, name: 'Anvil AC B', role: 'Juggernaut', as: { TP: 'BM', SZ: 2, PV: 10, Arm: 4, specials: ['LRM'] } as Unit['as'] }),
            createUnit({ id: 3, name: 'Anvil Line A', role: 'Juggernaut', as: { TP: 'BM', SZ: 2, PV: 10, Arm: 4 } as Unit['as'] }),
        ];
        for (const unit of anvilUnits) {
            units.push(unit);
            addMegaMekAvailability(unit, freeWorldsLeague, era);
        }
        spyOn(Math, 'random').and.returnValue(0);

        const context = service.resolveGenerationContext(anvilUnits, {
            gameSystem: GameSystem.ALPHA_STRIKE,
            targetFormations: [
                { formationId: 'anvil-lance', count: 1 },
                { formationId: 'battle-lance', count: 1 },
            ],
        });
        const preview = service.buildPreview({
            eligibleUnits: anvilUnits,
            context,
            gameSystem: GameSystem.ALPHA_STRIKE,
            budgetRange: { min: 0, max: 0 },
            minUnitCount: 3,
            maxUnitCount: 3,
            gunnery: 4,
            piloting: 5,
            targetFormationId: 'anvil-lance',
        });

        expect(context.forceFaction).toBe(freeWorldsLeague);
        expect(context.targetFormationFactionInferred).toBeTrue();
        expect(context.availabilityFactionIds).toEqual([freeWorldsLeague.id]);
        expect(context.useAvailabilityFactionScope).toBeFalse();
        expect(preview.error).toBeNull();
        expect(preview.faction).toBe(freeWorldsLeague);
        expect(preview.targetFormationId).toBe('anvil-lance');
        expect(preview.explanationLines.join('\n')).toContain('Generation context: Free Worlds League - ilClan.');
    });

    it('infers a Clan faction for Clan-only target formations when no faction is selected', () => {
        const era = createEra(3150, 'ilClan');
        const clanWolf = createFaction(24, 'Clan Wolf', 'IS Clan');
        const mercenary = createFaction(MULFACTION_MERCENARY, 'Mercenary');
        registerEraAndFaction(era, clanWolf);
        factionsByName.set(mercenary.name, mercenary);
        factionsById.set(mercenary.id, mercenary);

        const phalanxUnits = [
            createUnit({ id: 1, name: 'Phalanx Mek A', as: { TP: 'BM', SZ: 3, PV: 10 } as Unit['as'] }),
            createUnit({ id: 2, name: 'Phalanx Mek B', as: { TP: 'BM', SZ: 3, PV: 10 } as Unit['as'] }),
            createUnit({ id: 3, name: 'Phalanx BA A', type: 'Infantry', subtype: 'Battle Armor', as: { TP: 'BA', SZ: 1, PV: 10 } as Unit['as'] }),
        ];
        const strategicUnits = [
            createUnit({ id: 4, name: 'Strategic Aero A', type: 'Aero', as: { TP: 'AF', SZ: 2, PV: 10 } as Unit['as'] }),
            createUnit({ id: 5, name: 'Strategic Aero B', type: 'Aero', as: { TP: 'AF', SZ: 2, PV: 10 } as Unit['as'] }),
            createUnit({ id: 6, name: 'Strategic BA A', type: 'Infantry', subtype: 'Battle Armor', as: { TP: 'BA', SZ: 1, PV: 10 } as Unit['as'] }),
        ];
        for (const unit of [...phalanxUnits, ...strategicUnits]) {
            units.push(unit);
            addMegaMekAvailability(unit, clanWolf, era);
        }
        spyOn(Math, 'random').and.returnValue(0);

        const expectClanTargetPreview = (
            formationId: string,
            eligibleUnits: readonly Unit[],
            skills: { gunnery: number; piloting: number },
        ) => {
            const context = service.resolveGenerationContext(eligibleUnits, {
                gameSystem: GameSystem.ALPHA_STRIKE,
                targetFormationId: formationId,
            });
            const preview = service.buildPreview({
                eligibleUnits,
                context,
                gameSystem: GameSystem.ALPHA_STRIKE,
                budgetRange: { min: 0, max: 0 },
                minUnitCount: eligibleUnits.length,
                maxUnitCount: eligibleUnits.length,
                gunnery: skills.gunnery,
                piloting: skills.piloting,
                targetFormationId: formationId,
            });

            expect(context.forceFaction).toBe(clanWolf);
            expect(context.targetFormationFactionInferred).toBeTrue();
            expect(context.availabilityFactionIds).toEqual([clanWolf.id]);
            expect(preview.error).toBeNull();
            expect(preview.faction).toBe(clanWolf);
            expect(preview.targetFormationId).toBe(formationId);
        };

        expectClanTargetPreview('phalanx-star', phalanxUnits, { gunnery: 4, piloting: 5 });
        expectClanTargetPreview('strategic-command-star', strategicUnits, { gunnery: 3, piloting: 3 });
    });

    it('randomly chooses between selected compatible exclusive target formation factions', () => {
        const era = createEra(3150, 'ilClan');
        const clanJadeFalcon = createFaction(18, 'Clan Jade Falcon', 'IS Clan');
        const clanWolf = createFaction(24, 'Clan Wolf', 'IS Clan');
        const strategicUnit = createUnit({ id: 1, name: 'Strategic Shared Candidate', as: { TP: 'BM', SZ: 3, PV: 10 } as Unit['as'] });
        registerEraAndFaction(era, clanJadeFalcon);
        registerEraAndFaction(era, clanWolf);
        units.push(strategicUnit);
        megaMekAvailabilityByUnitName.set(strategicUnit.name, {
            e: {
                [`${era.id}`]: {
                    [`${clanJadeFalcon.id}`]: [5, 0],
                    [`${clanWolf.id}`]: [5, 0],
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
                    cjf: { name: 'Clan Jade Falcon', state: 'or', count: 1 },
                    cw: { name: 'Clan Wolf', state: 'or', count: 1 },
                },
            },
        });
        spyOn(Math, 'random').and.returnValue(0.75);

        const context = service.resolveGenerationContext([strategicUnit], {
            gameSystem: GameSystem.ALPHA_STRIKE,
            targetFormationId: 'strategic-command-star',
        });

        expect(context.forceFaction).toBe(clanWolf);
        expect(context.targetFormationFactionInferred).toBeTrue();
        expect(context.availabilityFactionIds).toEqual([clanWolf.id]);
        expect(context.forceEra).toBe(era);
    });

    it('randomly chooses between available compatible exclusive target formation factions when no faction is selected', () => {
        const ilClan = createEra(3150, 'ilClan');
        const successionWars = createEra(3025, 'Late Succession Wars');
        const clanGhostBear = createFaction(17, 'Clan Ghost Bear', 'IS Clan');
        const clanJadeFalcon = createFaction(18, 'Clan Jade Falcon', 'IS Clan');
        const clanWolf = createFaction(24, 'Clan Wolf', 'IS Clan');
        const strategicUnit = createUnit({ id: 1, name: 'Strategic Era Candidate', as: { TP: 'BM', SZ: 3, PV: 10 } as Unit['as'] });
        registerEraAndFaction(successionWars, clanGhostBear);
        registerEraAndFaction(ilClan, clanJadeFalcon);
        registerEraAndFaction(ilClan, clanWolf);
        units.push(strategicUnit);
        megaMekAvailabilityByUnitName.set(strategicUnit.name, {
            e: {
                [`${successionWars.id}`]: {
                    [`${clanGhostBear.id}`]: [5, 0],
                },
                [`${ilClan.id}`]: {
                    [`${clanJadeFalcon.id}`]: [5, 0],
                    [`${clanWolf.id}`]: [5, 0],
                },
            },
        });
        filtersServiceMock.effectiveFilterState.and.returnValue({
            era: {
                interactedWith: true,
                value: ['ilClan'],
            },
        });
        spyOn(Math, 'random').and.returnValue(0.75);

        const context = service.resolveGenerationContext([strategicUnit], {
            gameSystem: GameSystem.ALPHA_STRIKE,
            targetFormationId: 'strategic-command-star',
        });

        expect(context.forceFaction).toBe(clanWolf);
        expect(context.targetFormationFactionInferred).toBeTrue();
        expect(context.availabilityFactionIds).toEqual([clanWolf.id]);
        expect(context.forceEra).toBe(ilClan);
    });

    it('filters invalid Strategic Command target candidates before selection', () => {
        const era = createEra(3150, 'ilClan');
        const clanWolf = createFaction(24, 'Clan Wolf', 'IS Clan');
        registerEraAndFaction(era, clanWolf);
        const strategicWarShip = createUnit({ id: 1, name: 'Strategic WarShip', type: 'Aero', subtype: 'WarShip', as: { TP: 'WS', SZ: 5, PV: 30 } as Unit['as'] });
        const strategicAeroA = createUnit({ id: 2, name: 'Strategic Aero A', type: 'Aero', subtype: 'Aerospace Fighter', as: { TP: 'AF', SZ: 2, PV: 30 } as Unit['as'] });
        const strategicAeroB = createUnit({ id: 3, name: 'Strategic Aero B', type: 'Aero', subtype: 'Aerospace Fighter', as: { TP: 'AF', SZ: 2, PV: 30 } as Unit['as'] });
        const strategicBA = createUnit({ id: 4, name: 'Strategic BA', type: 'Infantry', subtype: 'Battle Armor', as: { TP: 'BA', SZ: 1, PV: 30 } as Unit['as'] });
        const eligibleUnits = [strategicWarShip, strategicAeroA, strategicAeroB, strategicBA];
        for (const unit of eligibleUnits) {
            units.push(unit);
            addMegaMekAvailability(unit, clanWolf, era);
        }
        spyOn(Math, 'random').and.returnValue(0);

        const preview = service.buildPreview({
            eligibleUnits,
            context: createContext(clanWolf, era),
            gameSystem: GameSystem.ALPHA_STRIKE,
            budgetRange: { min: 0, max: 0 },
            minUnitCount: 3,
            maxUnitCount: 3,
            gunnery: 3,
            piloting: 3,
            targetFormationId: 'strategic-command-star',
        });

        expect(preview.error).toBeNull();
        expect(preview.targetFormationId).toBe('strategic-command-star');
        expect(preview.units.map((unit) => unit.unit.name)).not.toContain(strategicWarShip.name);
        expect(preview.units).toHaveSize(3);
        expect(preview.units.some((unit) => unit.unit.name === strategicBA.name)).toBeTrue();
    });

    it('does not let Mek-only ruleset guidance starve Strategic Command target formation candidates', () => {
        const era = createEra(3150, 'ilClan');
        const clanJadeFalcon = createFaction(18, 'Clan Jade Falcon', 'IS Clan');
        registerEraAndFaction(era, clanJadeFalcon);
        registerMegaMekRuleset(clanJadeFalcon, createMekOnlyStarRuleset('CJF'));
        const eligibleUnits = [
            createUnit({ id: 1, name: 'Strategic Ruleset Mek A', chassis: 'Strategic Ruleset Mek A', weightClass: 'Heavy', as: { TP: 'BM', SZ: 3, PV: 50 } as Unit['as'] }),
            createUnit({ id: 2, name: 'Strategic Ruleset Mek B', chassis: 'Strategic Ruleset Mek B', weightClass: 'Assault', as: { TP: 'BM', SZ: 4, PV: 55 } as Unit['as'] }),
            createUnit({ id: 3, name: 'Strategic Ruleset Aero A', chassis: 'Strategic Ruleset Aero A', type: 'Aero', subtype: 'Aerospace Fighter', as: { TP: 'AF', SZ: 2, PV: 40 } as Unit['as'] }),
            createUnit({ id: 4, name: 'Strategic Ruleset Aero B', chassis: 'Strategic Ruleset Aero B', type: 'Aero', subtype: 'Aerospace Fighter', as: { TP: 'AF', SZ: 2, PV: 45 } as Unit['as'] }),
            createUnit({ id: 5, name: 'Strategic Ruleset BA', chassis: 'Strategic Ruleset BA', type: 'Infantry', subtype: 'Battle Armor', as: { TP: 'BA', SZ: 1, PV: 20 } as Unit['as'] }),
        ];
        for (const unit of eligibleUnits) {
            units.push(unit);
            addMegaMekAvailability(unit, clanJadeFalcon, era);
        }
        spyOn(Math, 'random').and.returnValue(0);

        const preview = service.buildPreview({
            eligibleUnits,
            context: createContext(clanJadeFalcon, era),
            gameSystem: GameSystem.ALPHA_STRIKE,
            budgetRange: { min: 100, max: 300 },
            minUnitCount: 5,
            maxUnitCount: 8,
            gunnery: 3,
            piloting: 3,
            preventDuplicateChassis: true,
            targetFormationId: 'strategic-command-star',
        });

        const selectedNames = preview.units.map((unit) => unit.unit.name);
        expect(preview.error).toBeNull();
        expect(preview.targetFormationId).toBe('strategic-command-star');
        expect(selectedNames).toContain('Strategic Ruleset Aero A');
        expect(selectedNames).toContain('Strategic Ruleset Aero B');
        expect(preview.units).toHaveSize(5);
        expect(preview.explanationLines.some((line) => line.includes('Ruleset guidance: Clan Jade Falcon, echelon STAR.'))).toBeTrue();
    });

    it('can build Strategic Command with a BM core when BA candidates are also available', () => {
        const era = createEra(3150, 'ilClan');
        const clanWolf = createFaction(24, 'Clan Wolf', 'IS Clan');
        registerEraAndFaction(era, clanWolf);
        const eligibleUnits = [
            createUnit({ id: 1, name: 'Strategic BM A', chassis: 'Strategic BM A', weightClass: 'Heavy', as: { TP: 'BM', SZ: 3, PV: 50 } as Unit['as'] }),
            createUnit({ id: 2, name: 'Strategic BM B', chassis: 'Strategic BM B', weightClass: 'Assault', as: { TP: 'BM', SZ: 4, PV: 55 } as Unit['as'] }),
            createUnit({ id: 3, name: 'Strategic Aero A', chassis: 'Strategic Aero A', type: 'Aero', subtype: 'Aerospace Fighter', as: { TP: 'AF', SZ: 2, PV: 40 } as Unit['as'] }),
            createUnit({ id: 4, name: 'Strategic Aero B', chassis: 'Strategic Aero B', type: 'Aero', subtype: 'Aerospace Fighter', as: { TP: 'AF', SZ: 2, PV: 45 } as Unit['as'] }),
            createUnit({ id: 5, name: 'Strategic BA', chassis: 'Strategic BA', type: 'Infantry', subtype: 'Battle Armor', as: { TP: 'BA', SZ: 1, PV: 20 } as Unit['as'] }),
        ];
        for (const unit of eligibleUnits) {
            units.push(unit);
            addMegaMekAvailability(unit, clanWolf, era);
        }
        spyOn(Math, 'random').and.returnValue(0);

        const preview = service.buildPreview({
            eligibleUnits,
            context: createContext(clanWolf, era),
            gameSystem: GameSystem.ALPHA_STRIKE,
            budgetRange: { min: 0, max: 0 },
            minUnitCount: 4,
            maxUnitCount: 4,
            gunnery: 3,
            piloting: 3,
            preventDuplicateChassis: true,
            targetFormationId: 'strategic-command-star',
        });

        expect(preview.error).toBeNull();
        expect(preview.targetFormationId).toBe('strategic-command-star');
        expect(preview.units.map((unit) => unit.unit.name)).toEqual([
            'Strategic BM A',
            'Strategic BM B',
            'Strategic Aero A',
            'Strategic Aero B',
        ]);
    });

    it('forces Strategic Command target skills to the closest valid value when the requested range misses', () => {
        const era = createEra(3150, 'ilClan');
        const clanWolf = createFaction(24, 'Clan Wolf', 'IS Clan');
        registerEraAndFaction(era, clanWolf);
        const eligibleUnits = [
            createUnit({ id: 1, name: 'Skill Forced Aero A', chassis: 'Skill Forced Aero A', type: 'Aero', subtype: 'Aerospace Fighter', as: { TP: 'AF', SZ: 2, PV: 30 } as Unit['as'] }),
            createUnit({ id: 2, name: 'Skill Forced Aero B', chassis: 'Skill Forced Aero B', type: 'Aero', subtype: 'Aerospace Fighter', as: { TP: 'AF', SZ: 2, PV: 30 } as Unit['as'] }),
            createUnit({ id: 3, name: 'Skill Forced BA', chassis: 'Skill Forced BA', type: 'Infantry', subtype: 'Battle Armor', as: { TP: 'BA', SZ: 1, PV: 20 } as Unit['as'] }),
        ];
        for (const unit of eligibleUnits) {
            units.push(unit);
            addMegaMekAvailability(unit, clanWolf, era);
        }
        spyOn(Math, 'random').and.returnValue(0.99);

        const preview = service.buildPreview({
            eligibleUnits,
            context: createContext(clanWolf, era),
            gameSystem: GameSystem.ALPHA_STRIKE,
            budgetRange: { min: 0, max: 0 },
            minUnitCount: 3,
            maxUnitCount: 3,
            gunnery: 5,
            piloting: 5,
            skillRanges: {
                gunnery: { min: 5, max: 8 },
            },
            targetFormationId: 'strategic-command-star',
        });

        expect(preview.error).toBeNull();
        expect(preview.targetFormationId).toBe('strategic-command-star');
        expect(preview.units.map((unit) => unit.skill)).toEqual([3, 3, 3]);
    });

    it('clips Strategic Command target skills to the valid overlap of the requested range', () => {
        const era = createEra(3150, 'ilClan');
        const clanWolf = createFaction(24, 'Clan Wolf', 'IS Clan');
        registerEraAndFaction(era, clanWolf);
        const eligibleUnits = [
            createUnit({ id: 1, name: 'Skill Clipped Aero A', chassis: 'Skill Clipped Aero A', type: 'Aero', subtype: 'Aerospace Fighter', as: { TP: 'AF', SZ: 2, PV: 30 } as Unit['as'] }),
            createUnit({ id: 2, name: 'Skill Clipped Aero B', chassis: 'Skill Clipped Aero B', type: 'Aero', subtype: 'Aerospace Fighter', as: { TP: 'AF', SZ: 2, PV: 30 } as Unit['as'] }),
            createUnit({ id: 3, name: 'Skill Clipped BA', chassis: 'Skill Clipped BA', type: 'Infantry', subtype: 'Battle Armor', as: { TP: 'BA', SZ: 1, PV: 20 } as Unit['as'] }),
        ];
        for (const unit of eligibleUnits) {
            units.push(unit);
            addMegaMekAvailability(unit, clanWolf, era);
        }
        spyOn(Math, 'random').and.returnValue(0.99);

        const preview = service.buildPreview({
            eligibleUnits,
            context: createContext(clanWolf, era),
            gameSystem: GameSystem.ALPHA_STRIKE,
            budgetRange: { min: 0, max: 0 },
            minUnitCount: 3,
            maxUnitCount: 3,
            gunnery: 0,
            piloting: 5,
            skillRanges: {
                gunnery: { min: 0, max: 8 },
            },
            targetFormationId: 'strategic-command-star',
        });

        expect(preview.error).toBeNull();
        expect(preview.targetFormationId).toBe('strategic-command-star');
        expect(preview.units.every((unit) => (unit.skill ?? 99) <= 3)).toBeTrue();
        expect(preview.units.some((unit) => unit.skill === 3)).toBeTrue();
    });

    it('keeps target formation skills unconstrained when the formation has no skill requirement', () => {
        const era = createEra(3150, 'ilClan');
        const clanWolf = createFaction(24, 'Clan Wolf', 'IS Clan');
        registerEraAndFaction(era, clanWolf);
        const eligibleUnits = [1, 2, 3].map((id) => createUnit({
            id,
            name: `Support Skill Unit ${id}`,
            chassis: `Support Skill Unit ${id}`,
            as: { TP: 'BM', SZ: 2, PV: 20 } as Unit['as'],
        }));
        for (const unit of eligibleUnits) {
            units.push(unit);
            addMegaMekAvailability(unit, clanWolf, era);
        }
        spyOn(Math, 'random').and.returnValue(0.99);

        const preview = service.buildPreview({
            eligibleUnits,
            context: createContext(clanWolf, era),
            gameSystem: GameSystem.ALPHA_STRIKE,
            budgetRange: { min: 0, max: 0 },
            minUnitCount: 3,
            maxUnitCount: 3,
            gunnery: 0,
            piloting: 5,
            skillRanges: {
                gunnery: { min: 0, max: 8 },
            },
            targetFormationId: 'support-lance',
        });

        expect(preview.error).toBeNull();
        expect(preview.targetFormationId).toBe('support-lance');
        expect(preview.units.every((unit) => unit.skill === 8)).toBeTrue();
    });

    it('does not let Mek-only ruleset guidance starve Phalanx target formation support units', () => {
        const era = createEra(3150, 'ilClan');
        const clanHellsHorses = createFaction(19, "Clan Hell's Horses", 'IS Clan');
        registerEraAndFaction(era, clanHellsHorses);
        registerMegaMekRuleset(clanHellsHorses, createMekOnlyStarRuleset('CHH'));
        const eligibleUnits = [
            createUnit({ id: 1, name: 'Phalanx Ruleset Mek A', chassis: 'Phalanx Ruleset Mek A', as: { TP: 'BM', SZ: 3, PV: 55 } as Unit['as'] }),
            createUnit({ id: 2, name: 'Phalanx Ruleset Mek B', chassis: 'Phalanx Ruleset Mek B', as: { TP: 'BM', SZ: 3, PV: 45 } as Unit['as'] }),
            createUnit({ id: 3, name: 'Phalanx Ruleset Mek C', chassis: 'Phalanx Ruleset Mek C', as: { TP: 'BM', SZ: 2, PV: 35 } as Unit['as'] }),
            createUnit({ id: 4, name: 'Phalanx Ruleset BA', chassis: 'Phalanx Ruleset BA', type: 'Infantry', subtype: 'Battle Armor', as: { TP: 'BA', SZ: 1, PV: 25 } as Unit['as'] }),
            createUnit({ id: 5, name: 'Phalanx Ruleset CV', chassis: 'Phalanx Ruleset CV', type: 'Tank', subtype: 'Combat Vehicle', as: { TP: 'CV', SZ: 2, PV: 40 } as Unit['as'] }),
        ];
        for (const unit of eligibleUnits) {
            units.push(unit);
            addMegaMekAvailability(unit, clanHellsHorses, era);
        }
        spyOn(Math, 'random').and.returnValue(0);

        const preview = service.buildPreview({
            eligibleUnits,
            context: createContext(clanHellsHorses, era),
            gameSystem: GameSystem.ALPHA_STRIKE,
            budgetRange: { min: 100, max: 300 },
            minUnitCount: 5,
            maxUnitCount: 8,
            gunnery: 3,
            piloting: 4,
            preventDuplicateChassis: true,
            targetFormationId: 'phalanx-star',
        });

        const selectedNames = preview.units.map((unit) => unit.unit.name);
        expect(preview.error).toBeNull();
        expect(preview.targetFormationId).toBe('phalanx-star');
        expect(selectedNames.some((name) => name === 'Phalanx Ruleset BA' || name === 'Phalanx Ruleset CV')).toBeTrue();
        expect(preview.units).toHaveSize(5);
        expect(preview.explanationLines.some((line) => line.includes("Ruleset guidance: Clan Hell's Horses, echelon STAR."))).toBeTrue();
    });

    it('skips later exclusive target formations that conflict with the inferred target faction', () => {
        const era = createEra(3150, 'ilClan');
        const freeWorldsLeague = createFaction(10, 'Free Worlds League');
        const federatedSuns = createFaction(20, 'Federated Suns');
        const mercenary = createFaction(MULFACTION_MERCENARY, 'Mercenary');
        registerEraAndFaction(era, freeWorldsLeague);
        factionsByName.set(federatedSuns.name, federatedSuns);
        factionsById.set(federatedSuns.id, federatedSuns);
        factionsByName.set(mercenary.name, mercenary);
        factionsById.set(mercenary.id, mercenary);
        const anvilUnits = [
            createUnit({ id: 1, name: 'Mixed Exclusive AC A', role: 'Juggernaut', as: { TP: 'BM', SZ: 2, PV: 10, Arm: 4, specials: ['AC'], MVm: { w: 8 } } as unknown as Unit['as'] }),
            createUnit({ id: 2, name: 'Mixed Exclusive AC B', role: 'Juggernaut', as: { TP: 'BM', SZ: 2, PV: 10, Arm: 4, specials: ['FLK'], MVm: { w: 8 } } as unknown as Unit['as'] }),
            createUnit({ id: 3, name: 'Mixed Exclusive Line A', role: 'Juggernaut', as: { TP: 'BM', SZ: 2, PV: 10, Arm: 4, MVm: { w: 8 } } as unknown as Unit['as'] }),
        ];
        for (const unit of anvilUnits) {
            units.push(unit);
            megaMekAvailabilityByUnitName.set(unit.name, {
                e: {
                    [`${era.id}`]: {
                        [`${freeWorldsLeague.id}`]: [5, 0],
                        [`${federatedSuns.id}`]: [5, 0],
                    },
                },
            });
        }
        spyOn(Math, 'random').and.returnValue(0);

        const context = service.resolveGenerationContext(anvilUnits, {
            gameSystem: GameSystem.ALPHA_STRIKE,
            targetFormations: [
                { formationId: 'anvil-lance', count: 1 },
                { formationId: 'rifle-lance', count: 1 },
            ],
        });
        const preview = service.buildPreview({
            eligibleUnits: anvilUnits,
            context,
            gameSystem: GameSystem.ALPHA_STRIKE,
            budgetRange: { min: 0, max: 0 },
            minUnitCount: 3,
            maxUnitCount: 3,
            gunnery: 4,
            piloting: 5,
            targetFormations: [
                { formationId: 'anvil-lance', count: 1 },
                { formationId: 'rifle-lance', count: 1 },
            ],
        });

        expect(context.forceFaction).toBe(freeWorldsLeague);
        expect(preview.error).toBeNull();
        expect(preview.targetFormationId).toBe('anvil-lance');
        expect(preview.targetFormations).toEqual([{ formationId: 'anvil-lance', count: 1 }]);
        expect(preview.explanationLines.join('\n')).toContain('Target formation: Anvil.');
        expect(preview.explanationLines.join('\n')).not.toContain('Rifle');
    });

    it('rotates partial target formation priority and uses target minimum size under a tight cap', () => {
        const era = createEra(3150, 'ilClan');
        const faction = createFaction(10, 'Clan Jade Falcon');
        registerEraAndFaction(era, faction);
        const assaultUnits = [
            createUnit({ id: 1, name: 'Rotated Assault Juggernaut', role: 'Juggernaut', as: { TP: 'BM', SZ: 3, PV: 10, Arm: 5, dmg: { _dmgM: 3 } } as Unit['as'] }),
            createUnit({ id: 2, name: 'Rotated Assault Sniper', role: 'Sniper', as: { TP: 'BM', SZ: 3, PV: 10, Arm: 5, dmg: { _dmgM: 3 } } as Unit['as'] }),
            createUnit({ id: 3, name: 'Rotated Assault Brawler', role: 'Brawler', as: { TP: 'BM', SZ: 3, PV: 10, Arm: 5, dmg: { _dmgM: 3 } } as Unit['as'] }),
        ];
        const fillerUnits = [
            createUnit({ id: 4, name: 'Rotated Filler Scout', role: 'Scout', as: { TP: 'BM', SZ: 2, PV: 10, Arm: 4, dmg: { _dmgM: 2 } } as Unit['as'] }),
            createUnit({ id: 5, name: 'Rotated Filler Skirmisher', role: 'Skirmisher', as: { TP: 'BM', SZ: 2, PV: 10, Arm: 4, dmg: { _dmgM: 2 } } as Unit['as'] }),
        ];
        for (const unit of [...assaultUnits, ...fillerUnits]) {
            units.push(unit);
            addMegaMekAvailability(unit, faction, era);
        }
        let randomCallCount = 0;
        spyOn(Math, 'random').and.callFake(() => randomCallCount++ === 0 ? 0.34 : 0);

        const preview = service.buildPreview({
            eligibleUnits: [...assaultUnits, ...fillerUnits],
            context: createContext(faction, era),
            gameSystem: GameSystem.ALPHA_STRIKE,
            budgetRange: { min: 0, max: 0 },
            minUnitCount: 5,
            maxUnitCount: 5,
            gunnery: 4,
            piloting: 5,
            targetFormations: [
                { formationId: 'command-lance', count: 1 },
                { formationId: 'assault-lance', count: 2 },
            ],
        });

        expect(preview.error).toContain('Target formations achieved: 1 of 3 requested');
        expect(preview.units.length).toBe(5);
        expect(preview.targetFormationGroups?.map((group) => group.formationId)).toEqual(['assault-lance']);
        expect(preview.targetFormationGroups?.[0]?.unitIndexes.length).toBe(3);
        expect(preview.explanationLines.join('\n')).toContain('Target formations achieved: 1 of 3 requested (Assault).');
    });

    it('rolls Alpha Strike pilot skill within the requested range', () => {
        const era = createEra(3150, 'ilClan');
        const faction = createFaction(10, 'Federated Suns');
        const unit = createUnit({ id: 1, name: 'Skill Range AS Unit', as: { PV: 20 } as Unit['as'] });

        spyOn(Math, 'random').and.returnValues(0.99, 0, 0, 0);

        const preview = service.buildPreview({
            eligibleUnits: [unit],
            context: createContext(faction, era),
            gameSystem: GameSystem.ALPHA_STRIKE,
            budgetRange: { min: 0, max: 0 },
            minUnitCount: 1,
            maxUnitCount: 1,
            gunnery: 3,
            piloting: 5,
            skillRanges: {
                gunnery: { min: 3, max: 5 },
            },
        });

        expect(preview.error).toBeNull();
        expect(preview.units.length).toBe(1);
        expect(preview.units[0].skill).toBe(5);
        expect(preview.explanationLines.some((line) => line.includes('Skill target: Pilot Skill 3-5.'))).toBeTrue();
        expect(preview.explanationLines.some((line) => line.includes('Skill 5'))).toBeTrue();
    });

    it('rolls Classic gunnery and piloting within range while respecting max delta', () => {
        const era = createEra(3150, 'ilClan');
        const faction = createFaction(10, 'Federated Suns');
        const unit = createUnit({ id: 1, name: 'Skill Range CBT Unit', bv: 1000 });

        spyOn(Math, 'random').and.returnValues(0.99, 0, 0, 0);

        const preview = service.buildPreview({
            eligibleUnits: [unit],
            context: createContext(faction, era),
            gameSystem: GameSystem.CLASSIC,
            budgetRange: { min: 0, max: 0 },
            minUnitCount: 1,
            maxUnitCount: 1,
            gunnery: 4,
            piloting: 5,
            skillRanges: {
                gunnery: { min: 0, max: 8 },
                piloting: { min: 0, max: 8 },
                maxDelta: 1,
            },
        });

        expect(preview.error).toBeNull();
        expect(preview.units.length).toBe(1);
        const generatedUnit = preview.units[0];
        expect(generatedUnit.gunnery).toBeDefined();
        expect(generatedUnit.piloting).toBeDefined();
        expect(generatedUnit.gunnery ?? -1).toBeGreaterThanOrEqual(0);
        expect(generatedUnit.gunnery ?? 99).toBeLessThanOrEqual(8);
        expect(generatedUnit.piloting ?? -1).toBeGreaterThanOrEqual(0);
        expect(generatedUnit.piloting ?? 99).toBeLessThanOrEqual(8);
        expect(Math.abs((generatedUnit.gunnery ?? 0) - (generatedUnit.piloting ?? 0))).toBeLessThanOrEqual(1);
        expect(preview.explanationLines.some((line) => line.includes('Skill target: Gunnery 0-8, Piloting 0-8, max delta 1.'))).toBeTrue();
        expect(preview.explanationLines.some((line) => line.includes('G/P'))).toBeTrue();
    });

    it('preserves rolled Classic skills when the selected force is already within budget', () => {
        const era = createEra(3150, 'ilClan');
        const faction = createFaction(10, 'Federated Suns');
        const unit = createUnit({ id: 1, name: 'Budget Valid Skill Range Unit', bv: 1000 });

        spyOn(Math, 'random').and.returnValues(0.99, 0, 0, 0);

        const preview = service.buildPreview({
            eligibleUnits: [unit],
            context: createContext(faction, era),
            gameSystem: GameSystem.CLASSIC,
            budgetRange: { min: 0, max: 20000 },
            minUnitCount: 1,
            maxUnitCount: 1,
            gunnery: 3,
            piloting: 3,
            skillRanges: {
                gunnery: { min: 3, max: 5 },
                piloting: { min: 3, max: 5 },
                maxDelta: 8,
            },
        });

        expect(preview.error).toBeNull();
        expect(preview.units.length).toBe(1);
        expect(preview.units[0].gunnery).toBe(5);
        expect(preview.units[0].piloting).toBe(5);
    });

    it('rejects Classic skill ranges with no valid max-delta pair', () => {
        const era = createEra(3150, 'ilClan');
        const faction = createFaction(10, 'Federated Suns');
        const unit = createUnit({ id: 1, name: 'Invalid Skill Range Unit', bv: 1000 });

        const preview = service.buildPreview({
            eligibleUnits: [unit],
            context: createContext(faction, era),
            gameSystem: GameSystem.CLASSIC,
            budgetRange: { min: 0, max: 0 },
            minUnitCount: 1,
            maxUnitCount: 1,
            gunnery: 0,
            piloting: 8,
            skillRanges: {
                gunnery: { min: 0, max: 0 },
                piloting: { min: 8, max: 8 },
                maxDelta: 1,
            },
        });

        expect(preview.units).toEqual([]);
        expect(preview.error).toBe('No valid Gunnery/Piloting skill pairs match the selected ranges with max delta 1.');
    });

    it('applies Classic max delta to effective piloting values', () => {
        const era = createEra(3150, 'ilClan');
        const faction = createFaction(10, 'Federated Suns');
        const unit = createUnit({
            id: 1,
            name: 'Infantry Skill Delta Unit',
            type: 'Infantry',
            subtype: 'Conventional Infantry',
            bv: 100,
        });

        const preview = service.buildPreview({
            eligibleUnits: [unit],
            context: createContext(faction, era),
            gameSystem: GameSystem.CLASSIC,
            budgetRange: { min: 0, max: 0 },
            minUnitCount: 1,
            maxUnitCount: 1,
            gunnery: 0,
            piloting: 0,
            skillRanges: {
                gunnery: { min: 0, max: 0 },
                piloting: { min: 0, max: 0 },
                maxDelta: 1,
            },
        });

        expect(preview.units).toEqual([]);
        expect(preview.error).toBe('Only 0 availability-positive units can satisfy the selected skill ranges with max delta 1.');
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
        expect(preview.explanationLines.some((line) => line.includes('Generation context: Capellan Confederation - Jihad. Availability weights: max R/S across 2 eras x 2 factions.'))).toBeTrue();
        expect(preview.explanationLines.some((line) => line.includes('requisition pick, R 20 / S 0'))).toBeTrue();
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
        expect(preview.explanationLines.some((line) => line.includes('Generation context: Capellan Confederation - Jihad. Availability weights: max R/S across 3 eras.'))).toBeTrue();
        expect(preview.explanationLines.some((line) => line.includes('R 2 / S 9'))).toBeTrue();
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
        expect(preview.explanationLines.some((line) => line.includes('Generation context: Capellan Confederation - Jihad. Availability weights: max R/S across 3 factions.'))).toBeTrue();
        expect(preview.explanationLines.some((line) => line.includes('R 7 / S 6'))).toBeTrue();
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
        expect(preview.explanationLines.some((line) => line.includes('R 1 / S 0'))).toBeTrue();
    });

    it('keeps MUL fallback unknown weights requisition-only when another scoped pair already contributed exact MegaMek weights', () => {
        const era = createEra(2570, 'Age of War', 2570, 2780);
        const primaryFaction = createFaction(10, 'Draconis Combine');
        const secondaryFaction = createFaction(20, 'Free Worlds League');
        const mixedScopeUnit = createUnit({ id: 1, name: 'Mixed Scope Unknown', as: { PV: 5 } as Unit['as'] });

        era.units = new Set<number>([mixedScopeUnit.id]);
        primaryFaction.eras = {
            [era.id]: new Set<number>([mixedScopeUnit.id]),
        };
        secondaryFaction.eras = {
            [era.id]: new Set<number>([mixedScopeUnit.id]),
        };

        megaMekAvailabilityByUnitName.set(mixedScopeUnit.name, {
            e: {
                [String(era.id)]: {
                    [String(primaryFaction.id)]: [1, 0],
                },
            },
        });

        erasByName.set(era.name, era);
        erasById.set(era.id, era);
        factionsByName.set(primaryFaction.name, primaryFaction);
        factionsByName.set(secondaryFaction.name, secondaryFaction);
        factionsById.set(primaryFaction.id, primaryFaction);
        factionsById.set(secondaryFaction.id, secondaryFaction);
        units.push(mixedScopeUnit);
        optionsServiceMock.options.set({ availabilitySource: 'mul' });

        spyOn(Math, 'random').and.returnValue(0);

        const preview = service.buildPreview({
            eligibleUnits: [mixedScopeUnit],
            context: {
                forceFaction: primaryFaction,
                forceEra: era,
                availabilityFactionIds: [primaryFaction.id, secondaryFaction.id],
                availabilityEraIds: [era.id],
                useAvailabilityFactionScope: true,
                useAvailabilityEraScope: false,
                availablePairCount: 2,
                ruleset: null,
            },
            gameSystem: GameSystem.ALPHA_STRIKE,
            budgetRange: { min: 0, max: 10 },
            minUnitCount: 1,
            maxUnitCount: 1,
            gunnery: 4,
            piloting: 5,
        });

        expect(preview.error).toBeNull();
        expect(preview.units.map((generatedUnit) => generatedUnit.unit.name)).toEqual(['Mixed Scope Unknown']);
        expect(preview.explanationLines.some((line) => {
            return line.includes('Generation context: Draconis Combine - Age of War. Availability weights: max R/S across 2 factions.');
        })).toBeTrue();
        expect(preview.explanationLines.some((line) => line.includes('requisition pick, R 1 / S 0'))).toBeTrue();
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

    it('rolls requisition and salvage separately before picking the unit', () => {
        const era = createEra(3150, 'ilClan');
        const faction = createFaction(10, 'Federated Suns');
        const requisitionUnit = createUnit({ id: 1, name: 'Requisition Unit', chassis: 'Phoenix Hawk', model: 'PXH-1', as: { PV: 5 } as Unit['as'] });
        const salvageUnit = createUnit({ id: 2, name: 'Salvage Unit', chassis: 'Shadow Hawk', model: 'SHD-2H', as: { PV: 5 } as Unit['as'] });

        megaMekAvailabilityByUnitName.set(requisitionUnit.name, {
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
            eligibleUnits: [requisitionUnit, salvageUnit],
            context: createContext(faction, era),
            gameSystem: GameSystem.ALPHA_STRIKE,
            budgetRange: { min: 0, max: 20 },
            minUnitCount: 1,
            maxUnitCount: 1,
            gunnery: 4,
            piloting: 5,
        });

        expect(preview.error).toBeNull();
        expect(preview.units[0].unit).toBe(requisitionUnit);

        randomSpy.calls.reset();
        randomSpy.and.returnValues(0.9, 0);
        preview = service.buildPreview({
            eligibleUnits: [requisitionUnit, salvageUnit],
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

    it('does not weight equally available candidate rolls by cost', () => {
        const cheapUnit = createUnit({ id: 1, name: 'Cheap Equal Availability', as: { PV: 10 } as Unit['as'] });
        const expensiveUnit = createUnit({ id: 2, name: 'Expensive Equal Availability', as: { PV: 90 } as Unit['as'] });
        const cheapCandidate = {
            unit: cheapUnit,
            requisitionWeight: 10,
            salvageWeight: 0,
            cost: 10,
            locked: false,
            megaMekUnitType: 'Mek',
        };
        const expensiveCandidate = {
            unit: expensiveUnit,
            requisitionWeight: 10,
            salvageWeight: 0,
            cost: 90,
            locked: false,
            megaMekUnitType: 'Mek',
        };
        spyOn(Math, 'random').and.returnValues(0.99, 0.45);

        const pick = (service as any).pickNextCandidate([cheapCandidate, expensiveCandidate], null);

        expect(pick.candidate).toBe(cheapCandidate);
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
        expect(preview.explanationLines.some((line) => line.includes('Warhammer WHM-6R: requisition pick'))).toBeTrue();
        expect(preview.explanationLines.some((line) => line.includes('Explained Unit: requisition pick'))).toBeFalse();
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

    it('completes an underfilled unreachable-budget fallback with a remaining legal candidate', () => {
        const era = createEra(3150, 'ilClan');
        const faction = createFaction(10, 'Federated Suns');
        const candidateUnits = Array.from({ length: 15 }, (_, index) => createUnit({
            id: index + 1,
            name: index === 14 ? 'Pouncer Candidate' : `Fallback Unit ${index + 1}`,
            chassis: index === 14 ? 'Pouncer' : `Fallback ${index + 1}`,
            as: { PV: index === 14 ? 37 : 40 } as Unit['as'],
        }));
        const makeCandidate = (unit: Unit) => ({
            unit,
            requisitionWeight: 1,
            salvageWeight: 0,
            cost: unit.as.PV,
            locked: false,
            megaMekUnitType: 'Mek',
        });
        const shortAttempt = {
            selectedCandidates: candidateUnits.slice(0, 14).map((unit) => makeCandidate(unit)),
            selectionSteps: [],
            rulesetProfile: null,
            candidatePoolStarved: true,
        };
        const buildSelectionSpy = spyOn<any>(service, 'buildCandidateSelection').and.returnValue(shortAttempt);

        const preview = service.buildPreview({
            eligibleUnits: candidateUnits,
            context: createContext(faction, era),
            gameSystem: GameSystem.ALPHA_STRIKE,
            budgetRange: { min: 730, max: 0 },
            minUnitCount: 15,
            maxUnitCount: 15,
            gunnery: 4,
            piloting: 5,
            preventDuplicateChassis: true,
        });

        expect(buildSelectionSpy).toHaveBeenCalled();
        expect(preview.error).toBeNull();
        expect(preview.units).toHaveSize(15);
        expect(preview.units[14].unit.name).toBe('Pouncer Candidate');
        expect(preview.totalCost).toBe(597);
        expect(preview.explanationLines.some((line) => line.includes('No force matched the full budget and unit-count constraints'))).toBeTrue();
    });

    it('can fill an unreachable-budget fallback with a salvage-only candidate', () => {
        const era = createEra(3150, 'ilClan');
        const faction = createFaction(10, 'Federated Suns');
        const requisitionUnit = createUnit({
            id: 1,
            name: 'Requisition Unit',
            chassis: 'Requisition',
            as: { PV: 50 } as Unit['as'],
        });
        const salvageUnit = createUnit({
            id: 2,
            name: 'Salvage Unit',
            chassis: 'Salvage',
            as: { PV: 20 } as Unit['as'],
        });
        registerEraAndFaction(era, faction);
        addMegaMekAvailability(requisitionUnit, faction, era, 5, 0);
        addMegaMekAvailability(salvageUnit, faction, era, 0, 5);

        spyOn(Math, 'random').and.returnValue(0);

        const preview = service.buildPreview({
            eligibleUnits: [requisitionUnit, salvageUnit],
            context: createContext(faction, era),
            gameSystem: GameSystem.ALPHA_STRIKE,
            budgetRange: { min: 100, max: 0 },
            minUnitCount: 2,
            maxUnitCount: 2,
            gunnery: 4,
            piloting: 5,
            preventDuplicateChassis: true,
        });

        expect(preview.error).toBeNull();
        expect(preview.units.map((unit) => unit.unit.name)).toEqual(['Requisition Unit', 'Salvage Unit']);
        expect(preview.totalCost).toBe(70);
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
        expect(preview.units.map((unit) => unit.unit.name)).toEqual(['Unit 1', 'Unit 1', 'Unit 1', 'Unit 1']);
        expect(preview.totalCost).toBe(16);
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
                requisitionWeight: 1,
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
                requisitionWeight: 1,
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
            searchSettings: ['Search settings: query "atlas"; filters Era ilClan | Type Mek.'],
            preventDuplicateChassis: true,
        });

        expect(duplicatePreview.units.map((unit) => unit.unit.name)).toEqual(['Atlas Prime', 'Atlas Prime']);
        expect(uniquePreview.units.map((unit) => unit.unit.name)).toEqual(['Atlas Prime', 'Locust']);
        expect(uniquePreview.explanationLines).toContain('Search settings: query "atlas"; filters Era ilClan | Type Mek.');
        expect(uniquePreview.explanationLines).toContain('Prevent Duplicate Chassis: on.');
    });

    it('returns a best-effort force when duplicate chassis prevention exhausts the finite pool below the target', () => {
        const era = createEra(3150, 'ilClan');
        const faction = createFaction(10, 'Federated Suns');
        const atlas = createUnit({ id: 1, name: 'Atlas AS7-D', chassis: 'Atlas', model: 'AS7-D', as: { PV: 6 } as Unit['as'] });
        const locust = createUnit({ id: 2, name: 'Locust LCT-1V', chassis: 'Locust', model: 'LCT-1V', as: { PV: 4 } as Unit['as'] });

        spyOn(Math, 'random').and.returnValue(0);
        const buildSelectionSpy = spyOn<any>(service, 'buildCandidateSelection').and.callThrough();

        const preview = service.buildPreview({
            eligibleUnits: [atlas, locust],
            context: createContext(faction, era),
            gameSystem: GameSystem.ALPHA_STRIKE,
            budgetRange: { min: 0, max: 20 },
            minUnitCount: 3,
            maxUnitCount: 3,
            gunnery: 4,
            piloting: 5,
            preventDuplicateChassis: true,
        });

        expect(preview.error).toBeNull();
        expect(preview.units.map((unit) => unit.unit.name)).toEqual(['Atlas AS7-D', 'Locust LCT-1V']);
        expect(preview.explanationLines).toContain('Prevent Duplicate Chassis: on.');
        expect(preview.explanationLines.some((line) => line.includes('No force matched the full budget and unit-count constraints'))).toBeTrue();
        expect(buildSelectionSpy.calls.count()).toBe(1);
    });

    it('reuses the same availability-positive unit when duplicate and tag caps are inactive', () => {
        const era = createEra(3150, 'Late Republic');
        const faction = createFaction(10, 'Mercenary');
        registerEraAndFaction(era, faction);
        const crab27b = createUnit({
            id: 1,
            name: 'Crab CRB-27b',
            chassis: 'Crab',
            model: 'CRB-27b',
            as: { PV: 50 } as Unit['as'],
        });
        const crab27 = createUnit({
            id: 2,
            name: 'Crab CRB-27',
            chassis: 'Crab',
            model: 'CRB-27',
            as: { PV: 50 } as Unit['as'],
        });
        const crab27sl = createUnit({
            id: 3,
            name: 'Crab CRB-27sl',
            chassis: 'Crab',
            model: 'CRB-27sl',
            as: { PV: 50 } as Unit['as'],
        });
        for (const unit of [crab27b, crab27, crab27sl]) {
            units.push(unit);
            addMegaMekAvailability(unit, faction, era);
        }
        spyOn(Math, 'random').and.returnValue(0);

        const preview = service.buildPreview({
            eligibleUnits: [crab27b, crab27, crab27sl],
            context: createContext(faction, era),
            gameSystem: GameSystem.ALPHA_STRIKE,
            budgetRange: { min: 200, max: 0 },
            minUnitCount: 4,
            maxUnitCount: 4,
            gunnery: 4,
            piloting: 5,
            preventDuplicateChassis: false,
            useTaggedQuantities: false,
        });

        expect(preview.error).toBeNull();
        expect(preview.units.map((unit) => unit.unit.name)).toEqual([
            'Crab CRB-27b',
            'Crab CRB-27b',
            'Crab CRB-27b',
            'Crab CRB-27b',
        ]);
        expect(preview.explanationLines[0]).toContain('Eligible units: 3 units. Availability-positive candidates: 3 units. Target: 4-4 units');
    });

    it('uses variant group keys for duplicate chassis prevention', () => {
        const era = createEra(3150, 'ilClan');
        const faction = createFaction(10, 'Federated Suns');
        const hatamotoChi = createUnit({
            id: 1,
            name: 'Hatamoto-Chi HTM-27T',
            chassis: 'Hatamoto-Chi',
            model: 'HTM-27T',
            type: 'Mek',
            subtype: 'BattleMek',
            as: { TP: 'BM', PV: 4 } as Unit['as'],
        });
        const hatamotoKaze = createUnit({
            id: 2,
            name: 'Hatamoto-Kaze HTM-27V',
            chassis: 'Hatamoto-Kaze',
            model: 'HTM-27V',
            type: 'Mek',
            subtype: 'BattleMek',
            as: { TP: 'BM', PV: 4 } as Unit['as'],
        });
        const battleMek = createUnit({
            id: 3,
            name: 'Peacekeeper BattleMek',
            chassis: 'Peacekeeper',
            model: 'PK-M',
            type: 'Mek',
            subtype: 'BattleMek',
            as: { TP: 'BM', PV: 4 } as Unit['as'],
        });
        const industrialMek = createUnit({
            id: 4,
            name: 'Peacekeeper IndustrialMek',
            chassis: 'Peacekeeper',
            model: 'PK-I',
            type: 'Mek',
            subtype: 'Industrial Mek',
            as: { TP: 'IM', PV: 4 } as Unit['as'],
        });
        const omniMek = createUnit({
            id: 5,
            name: 'Peacekeeper Omni',
            chassis: 'Peacekeeper',
            model: 'PK-O',
            type: 'Mek',
            subtype: 'BattleMek',
            omni: 1,
            as: { TP: 'BM', PV: 4 } as Unit['as'],
        });

        spyOn(Math, 'random').and.returnValue(0);

        const preview = service.buildPreview({
            eligibleUnits: [hatamotoChi, hatamotoKaze, battleMek, industrialMek, omniMek],
            context: createContext(faction, era),
            gameSystem: GameSystem.ALPHA_STRIKE,
            budgetRange: { min: 0, max: 20 },
            minUnitCount: 4,
            maxUnitCount: 4,
            gunnery: 4,
            piloting: 5,
            preventDuplicateChassis: true,
        });

        expect(preview.error).toBeNull();
        expect(preview.units.map((unit) => unit.unit.name)).toEqual([
            'Hatamoto-Chi HTM-27T',
            'Peacekeeper BattleMek',
            'Peacekeeper IndustrialMek',
            'Peacekeeper Omni',
        ]);
    });

    it('uses selected positive tag quantities as exact-unit duplicate caps', () => {
        const era = createEra(3150, 'ilClan');
        const faction = createFaction(10, 'Federated Suns');
        const unitA = createUnit({
            id: 1,
            name: 'Unit A',
            chassis: 'Unit A',
            model: 'Prime',
            as: { PV: 4 } as Unit['as'],
            _nameTags: [
                { tag: 'owned', quantity: 2 },
                { tag: 'painted', quantity: 1 },
                { tag: 'test', quantity: 5 },
            ],
        });
        const unitB = createUnit({
            id: 2,
            name: 'Unit B',
            chassis: 'Unit B',
            model: 'Prime',
            as: { PV: 4 } as Unit['as'],
            _nameTags: [
                { tag: 'owned', quantity: 1 },
                { tag: 'painted', quantity: 1 },
            ],
        });

        filtersServiceMock.effectiveFilterState.and.returnValue({
            _tags: {
                interactedWith: true,
                value: {
                    owned: { name: 'owned', state: 'and', count: 1 },
                    test: { name: 'test', state: 'not', count: 1 },
                },
            },
        });
        spyOn(Math, 'random').and.returnValue(0);

        const preview = service.buildPreview({
            eligibleUnits: [unitA, unitB],
            context: createContext(faction, era),
            gameSystem: GameSystem.ALPHA_STRIKE,
            budgetRange: { min: 0, max: 20 },
            minUnitCount: 3,
            maxUnitCount: 3,
            gunnery: 4,
            piloting: 5,
            preventDuplicateChassis: false,
            useTaggedQuantities: true,
        });

        expect(preview.error).toBeNull();
        expect(preview.units.map((unit) => unit.unit.name)).toEqual(['Unit A', 'Unit A', 'Unit B']);
    });

    it('uses chassis tag quantities as duplicate-chassis-key caps across variants', () => {
        const era = createEra(3150, 'ilClan');
        const faction = createFaction(10, 'Federated Suns');
        const locustOne = createUnit({
            id: 1,
            name: 'Locust LCT-1V',
            chassis: 'Locust',
            model: 'LCT-1V',
            type: 'Mek',
            as: { PV: 4 } as Unit['as'],
            _chassisTags: [{ tag: 'collection', quantity: 1 }],
        });
        const locustTwo = createUnit({
            id: 2,
            name: 'Locust LCT-3D',
            chassis: 'Locust',
            model: 'LCT-3D',
            type: 'Mek',
            as: { PV: 4 } as Unit['as'],
            _chassisTags: [{ tag: 'collection', quantity: 1 }],
        });
        const wasp = createUnit({
            id: 3,
            name: 'Wasp WSP-1A',
            chassis: 'Wasp',
            model: 'WSP-1A',
            type: 'Mek',
            as: { PV: 4 } as Unit['as'],
            _chassisTags: [{ tag: 'collection', quantity: 1 }],
        });

        filtersServiceMock.effectiveFilterState.and.returnValue({
            _tags: {
                interactedWith: true,
                value: {
                    collection: { name: 'collection', state: 'or', count: 1 },
                },
            },
        });
        spyOn(Math, 'random').and.returnValue(0);

        const preview = service.buildPreview({
            eligibleUnits: [locustOne, locustTwo, wasp],
            context: createContext(faction, era),
            gameSystem: GameSystem.ALPHA_STRIKE,
            budgetRange: { min: 0, max: 20 },
            minUnitCount: 2,
            maxUnitCount: 2,
            gunnery: 4,
            piloting: 5,
            preventDuplicateChassis: false,
            useTaggedQuantities: true,
        });

        expect(preview.error).toBeNull();
        expect(preview.units.filter((unit) => unit.unit.chassis === 'Locust')).toHaveSize(1);
        expect(preview.units.map((unit) => unit.unit.name)).toEqual(['Locust LCT-1V', 'Wasp WSP-1A']);
    });

    it('keeps name-tag quantities independent while sharing chassis-tag quantities for the same selected tag', () => {
        const era = createEra(3150, 'ilClan');
        const faction = createFaction(10, 'Federated Suns');
        const locustA = createUnit({
            id: 1,
            name: 'Locust LCT-A',
            chassis: 'Locust',
            model: 'LCT-A',
            type: 'Mek',
            as: { PV: 1 } as Unit['as'],
            _nameTags: [{ tag: 'owned', quantity: 2 }],
        });
        const locustB = createUnit({
            id: 2,
            name: 'Locust LCT-B',
            chassis: 'Locust',
            model: 'LCT-B',
            type: 'Mek',
            as: { PV: 1 } as Unit['as'],
            _nameTags: [{ tag: 'owned', quantity: 1 }],
        });
        const crabVariants = ['A', 'B', 'C', 'D', 'E'].map((model, index) => createUnit({
            id: 10 + index,
            name: `Crab CRB-${model}`,
            chassis: 'Crab',
            model: `CRB-${model}`,
            type: 'Mek',
            as: { PV: 1 } as Unit['as'],
            _chassisTags: [{ tag: 'owned', quantity: 4 }],
        }));

        filtersServiceMock.effectiveFilterState.and.returnValue({
            _tags: {
                interactedWith: true,
                value: {
                    owned: { name: 'owned', state: 'or', count: 1 },
                },
            },
        });
        spyOn(Math, 'random').and.returnValue(0);

        const preview = service.buildPreview({
            eligibleUnits: [locustA, locustB, ...crabVariants],
            context: createContext(faction, era),
            gameSystem: GameSystem.ALPHA_STRIKE,
            budgetRange: { min: 0, max: 100 },
            minUnitCount: 7,
            maxUnitCount: 7,
            gunnery: 4,
            piloting: 5,
            preventDuplicateChassis: false,
            useTaggedQuantities: true,
        });

        expect(preview.error).toBeNull();
        expect(preview.units.filter((unit) => unit.unit.name === locustA.name)).toHaveSize(2);
        expect(preview.units.filter((unit) => unit.unit.name === locustB.name)).toHaveSize(1);
        expect(preview.units.filter((unit) => unit.unit.chassis === 'Crab')).toHaveSize(4);
    });

    it('can share selected unit-tag quantities across variants by chassis key', () => {
        const era = createEra(3150, 'ilClan');
        const faction = createFaction(10, 'Federated Suns');
        const locust20 = createUnit({
            id: 1,
            name: 'Locust LCT-20',
            chassis: 'Locust',
            model: 'LCT-20',
            type: 'Mek',
            as: { PV: 1 } as Unit['as'],
            _nameTags: [{ tag: 'owned', quantity: 1 }],
        });
        const locust21 = createUnit({
            id: 2,
            name: 'Locust LCT-21',
            chassis: 'Locust',
            model: 'LCT-21',
            type: 'Mek',
            as: { PV: 1 } as Unit['as'],
            _nameTags: [{ tag: 'owned', quantity: 2 }],
        });
        const locust22 = createUnit({
            id: 3,
            name: 'Locust LCT-22',
            chassis: 'Locust',
            model: 'LCT-22',
            type: 'Mek',
            as: { PV: 1 } as Unit['as'],
            _nameTags: [{ tag: 'owned', quantity: 1 }],
        });
        const wasp = createUnit({
            id: 4,
            name: 'Wasp WSP-1A',
            chassis: 'Wasp',
            model: 'WSP-1A',
            type: 'Mek',
            as: { PV: 1 } as Unit['as'],
            _nameTags: [{ tag: 'owned', quantity: 2 }],
        });

        filtersServiceMock.effectiveFilterState.and.returnValue({
            _tags: {
                interactedWith: true,
                value: {
                    owned: { name: 'owned', state: 'or', count: 1 },
                },
            },
        });
        spyOn(Math, 'random').and.returnValue(0);

        const preview = service.buildPreview({
            eligibleUnits: [locust20, locust21, locust22, wasp],
            context: createContext(faction, era),
            gameSystem: GameSystem.ALPHA_STRIKE,
            budgetRange: { min: 0, max: 100 },
            minUnitCount: 4,
            maxUnitCount: 4,
            gunnery: 4,
            piloting: 5,
            preventDuplicateChassis: false,
            useTaggedQuantities: true,
            useUnitTagsAsChassisTags: true,
        });

        expect(preview.error).toBeNull();
        expect(preview.units.filter((unit) => unit.unit.chassis === 'Locust')).toHaveSize(2);
        expect(preview.units.filter((unit) => unit.unit.chassis === 'Wasp')).toHaveSize(2);
    });

    it('returns a best-effort force when unit-name tags shared by chassis exhaust below the target', () => {
        const era = createEra(3150, 'ilClan');
        const faction = createFaction(10, 'Federated Suns');
        const locustA = createUnit({
            id: 1,
            name: 'Locust LCT-A',
            chassis: 'Locust',
            model: 'LCT-A',
            type: 'Mek',
            as: { PV: 1 } as Unit['as'],
            _nameTags: [{ tag: 'owned', quantity: 2 }],
        });
        const locustB = createUnit({
            id: 2,
            name: 'Locust LCT-B',
            chassis: 'Locust',
            model: 'LCT-B',
            type: 'Mek',
            as: { PV: 1 } as Unit['as'],
            _nameTags: [{ tag: 'owned', quantity: 2 }],
        });
        const wasp = createUnit({
            id: 3,
            name: 'Wasp WSP-1A',
            chassis: 'Wasp',
            model: 'WSP-1A',
            type: 'Mek',
            as: { PV: 1 } as Unit['as'],
            _nameTags: [{ tag: 'owned', quantity: 1 }],
        });

        filtersServiceMock.effectiveFilterState.and.returnValue({
            _tags: {
                interactedWith: true,
                value: {
                    owned: { name: 'owned', state: 'or', count: 1 },
                },
            },
        });
        spyOn(Math, 'random').and.returnValue(0);
        const buildSelectionSpy = spyOn<any>(service, 'buildCandidateSelection').and.callThrough();

        const preview = service.buildPreview({
            eligibleUnits: [locustA, locustB, wasp],
            context: createContext(faction, era),
            gameSystem: GameSystem.ALPHA_STRIKE,
            budgetRange: { min: 0, max: 100 },
            minUnitCount: 4,
            maxUnitCount: 4,
            gunnery: 4,
            piloting: 5,
            preventDuplicateChassis: false,
            useTaggedQuantities: true,
            useUnitTagsAsChassisTags: true,
        });

        expect(preview.error).toBeNull();
        expect(preview.units).toHaveSize(3);
        expect(preview.units.filter((unit) => unit.unit.chassis === 'Locust')).toHaveSize(2);
        expect(preview.units.filter((unit) => unit.unit.chassis === 'Wasp')).toHaveSize(1);
        expect(preview.explanationLines).toContain('Limit to tagged quantities: on; Use Unit-variant tags as Chassis tags: on.');
        expect(buildSelectionSpy.calls.count()).toBe(1);
    });

    it('uses the highest shared cap when selected unit and chassis tags mix', () => {
        const era = createEra(3150, 'ilClan');
        const faction = createFaction(10, 'Federated Suns');
        const locustA = createUnit({
            id: 1,
            name: 'Locust LCT-A',
            chassis: 'Locust',
            model: 'LCT-A',
            type: 'Mek',
            as: { PV: 1 } as Unit['as'],
            _nameTags: [{ tag: 'owned', quantity: 2 }],
            _chassisTags: [{ tag: 'owned', quantity: 1 }],
        });
        const locustB = createUnit({
            id: 2,
            name: 'Locust LCT-B',
            chassis: 'Locust',
            model: 'LCT-B',
            type: 'Mek',
            as: { PV: 1 } as Unit['as'],
            _nameTags: [{ tag: 'owned', quantity: 1 }],
            _chassisTags: [{ tag: 'owned', quantity: 1 }],
        });
        const wasp = createUnit({
            id: 3,
            name: 'Wasp WSP-1A',
            chassis: 'Wasp',
            model: 'WSP-1A',
            type: 'Mek',
            as: { PV: 1 } as Unit['as'],
            _nameTags: [{ tag: 'owned', quantity: 1 }],
        });

        filtersServiceMock.effectiveFilterState.and.returnValue({
            _tags: {
                interactedWith: true,
                value: {
                    owned: { name: 'owned', state: 'or', count: 1 },
                },
            },
        });
        spyOn(Math, 'random').and.returnValue(0);

        const preview = service.buildPreview({
            eligibleUnits: [locustA, locustB, wasp],
            context: createContext(faction, era),
            gameSystem: GameSystem.ALPHA_STRIKE,
            budgetRange: { min: 0, max: 100 },
            minUnitCount: 3,
            maxUnitCount: 3,
            gunnery: 4,
            piloting: 5,
            preventDuplicateChassis: false,
            useTaggedQuantities: true,
            useUnitTagsAsChassisTags: true,
        });

        expect(preview.error).toBeNull();
        expect(preview.units.filter((unit) => unit.unit.chassis === 'Locust')).toHaveSize(2);
        expect(preview.units.filter((unit) => unit.unit.chassis === 'Wasp')).toHaveSize(1);
    });

    it('subtracts locked matching units from shared tagged quantity caps even when they are not in eligible units', () => {
        const era = createEra(3150, 'ilClan');
        const faction = createFaction(10, 'Federated Suns');
        const lockedLocust = createUnit({
            id: 99,
            name: 'Locust Locked LCT-L',
            chassis: 'Locust',
            model: 'LCT-L',
            type: 'Mek',
            as: { PV: 1 } as Unit['as'],
            _nameTags: [{ tag: 'owned', quantity: 1 }],
        });
        const locustA = createUnit({
            id: 1,
            name: 'Locust LCT-A',
            chassis: 'Locust',
            model: 'LCT-A',
            type: 'Mek',
            as: { PV: 1 } as Unit['as'],
            _nameTags: [{ tag: 'owned', quantity: 2 }],
        });
        const locustB = createUnit({
            id: 2,
            name: 'Locust LCT-B',
            chassis: 'Locust',
            model: 'LCT-B',
            type: 'Mek',
            as: { PV: 1 } as Unit['as'],
            _nameTags: [{ tag: 'owned', quantity: 1 }],
        });
        const wasp = createUnit({
            id: 3,
            name: 'Wasp WSP-1A',
            chassis: 'Wasp',
            model: 'WSP-1A',
            type: 'Mek',
            as: { PV: 1 } as Unit['as'],
            _nameTags: [{ tag: 'owned', quantity: 2 }],
        });

        filtersServiceMock.effectiveFilterState.and.returnValue({
            _tags: {
                interactedWith: true,
                value: {
                    owned: { name: 'owned', state: 'or', count: 1 },
                },
            },
        });
        spyOn(Math, 'random').and.returnValue(0);

        const preview = service.buildPreview({
            eligibleUnits: [locustA, locustB, wasp],
            context: createContext(faction, era),
            gameSystem: GameSystem.ALPHA_STRIKE,
            budgetRange: { min: 0, max: 100 },
            minUnitCount: 3,
            maxUnitCount: 3,
            gunnery: 4,
            piloting: 5,
            preventDuplicateChassis: false,
            useTaggedQuantities: true,
            useUnitTagsAsChassisTags: true,
            lockedUnits: [{
                unit: lockedLocust,
                cost: 1,
                skill: 4,
                lockKey: 'locked-locust',
            }],
        });

        expect(preview.error).toBeNull();
        expect(preview.units).toHaveSize(3);
        expect(preview.units.filter((unit) => unit.unit.chassis === 'Locust')).toHaveSize(2);
        expect(preview.units.filter((unit) => unit.unit.chassis === 'Wasp')).toHaveSize(1);
    });

    it('stops at selected positive tag quantity caps when the requested count is higher', () => {
        const era = createEra(3150, 'ilClan');
        const faction = createFaction(10, 'Federated Suns');
        const unitA = createUnit({
            id: 1,
            name: 'Unit A',
            chassis: 'Unit A',
            model: 'Prime',
            as: { PV: 4 } as Unit['as'],
            _nameTags: [
                { tag: 'owned', quantity: 1 },
                { tag: 'test', quantity: 5 },
            ],
        });

        filtersServiceMock.effectiveFilterState.and.returnValue({
            _tags: {
                interactedWith: true,
                value: {
                    owned: { name: 'owned', state: 'or', count: 1 },
                    test: { name: 'test', state: 'not', count: 1 },
                },
            },
        });
        const buildSelectionSpy = spyOn<any>(service, 'buildCandidateSelection').and.callThrough();

        const preview = service.buildPreview({
            eligibleUnits: [unitA],
            context: createContext(faction, era),
            gameSystem: GameSystem.ALPHA_STRIKE,
            budgetRange: { min: 0, max: 20 },
            minUnitCount: 2,
            maxUnitCount: 2,
            gunnery: 4,
            piloting: 5,
            preventDuplicateChassis: false,
            useTaggedQuantities: true,
        });

        expect(preview.error).toBeNull();
        expect(preview.units.map((unit) => unit.unit.name)).toEqual(['Unit A']);
        expect(preview.explanationLines).toContain('Limit to tagged quantities: on.');
        expect(buildSelectionSpy.calls.count()).toBe(1);
    });

    it('ignores tagged quantity mode when only negative tags are selected', () => {
        const era = createEra(3150, 'ilClan');
        const faction = createFaction(10, 'Federated Suns');
        const unitA = createUnit({
            id: 1,
            name: 'Unit A',
            chassis: 'Unit A',
            model: 'Prime',
            as: { PV: 4 } as Unit['as'],
            _nameTags: [
                { tag: 'test', quantity: 5 },
            ],
        });

        filtersServiceMock.effectiveFilterState.and.returnValue({
            _tags: {
                interactedWith: true,
                value: {
                    test: { name: 'test', state: 'not', count: 1 },
                },
            },
        });

        const preview = service.buildPreview({
            eligibleUnits: [unitA],
            context: createContext(faction, era),
            gameSystem: GameSystem.ALPHA_STRIKE,
            budgetRange: { min: 0, max: 20 },
            minUnitCount: 2,
            maxUnitCount: 2,
            gunnery: 4,
            piloting: 5,
            preventDuplicateChassis: false,
            useTaggedQuantities: true,
        });

        expect(preview.error).toBeNull();
        expect(preview.units.map((unit) => unit.unit.name)).toEqual(['Unit A', 'Unit A']);
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

    it('creates a load entry from an already-rendered preview entry without rebuilding groups', () => {
        const faction = createFaction(10, 'Federated Suns');
        const era = createEra(3150, 'ilClan');
        const unit = createUnit({ id: 1, name: 'Light Fire Unit', as: { PV: 6 } as Unit['as'] });
        const previewEntry = {
            instanceId: 'preview-entry',
            timestamp: '2026-05-11T00:00:00.000Z',
            type: GameSystem.ALPHA_STRIKE,
            owned: true,
            cloud: false,
            local: false,
            missing: false,
            name: 'Rendered Force',
            faction,
            era,
            pv: 6,
            groups: [{
                name: 'Light Fire',
                formationId: 'light-fire-lance',
                units: [{ unit, destroyed: false, skill: 4 }],
            }],
        } as ForcePreviewEntry;

        const entry = service.createForceEntryFromPreviewEntry(previewEntry);

        expect(entry).not.toBeNull();
        expect(entry!.name).toBe('Rendered Force');
        expect(entry!.faction).toBe(faction);
        expect(entry!.era).toBe(era);
        expect(entry!.groups[0]).toEqual(jasmine.objectContaining({
            name: 'Light Fire',
            formationId: 'light-fire-lance',
            force: entry,
        }));
        expect(entry!.groups[0]).not.toBe(previewEntry.groups[0]);
        expect(entry!.groups[0].units[0].unit).toBe(unit);
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

    it('returns a fallback when no exact budget match exists', () => {
        const era = createEra(3150, 'ilClan');
        const faction = createFaction(10, 'Federated Suns');
        const lightUnit = createUnit({ id: 1, name: 'Light Unit', as: { PV: 4 } as Unit['as'] });
        const mediumUnit = createUnit({ id: 2, name: 'Medium Unit', as: { PV: 5 } as Unit['as'] });

        spyOn(Math, 'random').and.returnValue(0);
        const buildSelectionSpy = spyOn<any>(service, 'buildCandidateSelection').and.callThrough();

        let nowValue = 0;
        spyOn(performance, 'now').and.callFake(() => {
            nowValue += 0.1;
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
        expect(preview.units.length).toBe(2);
        expect(service.createForceEntry(preview)).not.toBeNull();
        expect(buildSelectionSpy.calls.count()).toBeGreaterThan(0);
        expect(buildSelectionSpy.calls.count()).toBeLessThan(16);
    });

    it('prefers a unit-count-complete failed attempt before budget closeness', () => {
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
                requisitionWeight: 1,
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
                requisitionWeight: 1,
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
        expect(preview.units.map((unit) => unit.unit.name)).toEqual([
            'Count Match A',
            'Count Match B',
            'Count Match C',
            'Count Match D',
        ]);
        expect(preview.totalCost).toBe(16);
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
                requisitionWeight: 1,
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
                requisitionWeight: 1,
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
        const seedUnit = createUnit({ id: 1, name: 'Seed', chassis: 'Seed', role: 'skirmisher', weightClass: 'Medium', as: { PV: 4 } as Unit['as'] });
        const commandUnit = createUnit({ id: 2, name: 'Command', chassis: 'Command', role: 'command', weightClass: 'Heavy', as: { PV: 4 } as Unit['as'] });
        const scoutUnit = createUnit({ id: 3, name: 'Scout', chassis: 'Scout', role: 'scout', weightClass: 'Light', as: { PV: 4 } as Unit['as'] });
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
            preventDuplicateChassis: true,
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
                    selectedCandidates: companyUnits.map((unit) => ({ unit, requisitionWeight: 1, salvageWeight: 1, cost: unit.bv, megaMekUnitType: 'Mek' })),
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
                    selectedCandidates: lanceUnits.map((unit) => ({ unit, requisitionWeight: 1, salvageWeight: 1, cost: unit.bv, megaMekUnitType: 'Mek' })),
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
                    selectedCandidates: companyUnits.map((unit) => ({ unit, requisitionWeight: 1, salvageWeight: 1, cost: unit.bv, megaMekUnitType: 'Mek' })),
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
                    selectedCandidates: squadronUnits.map((unit) => ({ unit, requisitionWeight: 1, salvageWeight: 1, cost: unit.bv, megaMekUnitType: 'AeroSpaceFighter' })),
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