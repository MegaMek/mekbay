import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';

import { GameSystem } from '../models/common.model';
import type { Era } from '../models/eras.model';
import type { Faction } from '../models/factions.model';
import type { MegaMekFactionRecord } from '../models/megamek/factions.model';
import type { MegaMekRulesetRecord } from '../models/megamek/rulesets.model';
import { MULFACTION_MERCENARY } from '../models/mulfactions.model';
import type { Unit } from '../models/units.model';
import { DataService } from './data.service';
import type { ForceGenerationContext } from './force-generator.service';
import { ForceGeneratorService } from './force-generator.service';
import { UnitSearchFiltersService } from './unit-search-filters.service';

describe('ForceGeneratorService', () => {
    let service: ForceGeneratorService;

    const erasByName = new Map<string, Era>();
    const erasById = new Map<number, Era>();
    const factionsByName = new Map<string, Faction>();
    const factionsById = new Map<number, Faction>();
    const megaMekAvailabilityByUnitName = new Map<string, { e: Record<string, Record<string, [number, number]>> }>();
    const megaMekRulesetsByMulFactionId = new Map<number, MegaMekRulesetRecord[]>();
    const megaMekRulesetsByFactionKey = new Map<string, MegaMekRulesetRecord>();
    const megaMekFactionsByKey = new Map<string, MegaMekFactionRecord>();

    const filtersServiceMock = {
        filteredUnits: signal<Unit[]>([]),
        effectiveFilterState: jasmine.createSpy('effectiveFilterState').and.returnValue({}),
    };

    const dataServiceMock = {
        getEras: jasmine.createSpy('getEras').and.callFake(() => [...erasById.values()]),
        getEraById: jasmine.createSpy('getEraById').and.callFake((id: number) => erasById.get(id)),
        getEraByName: jasmine.createSpy('getEraByName').and.callFake((name: string) => erasByName.get(name)),
        getFactions: jasmine.createSpy('getFactions').and.callFake(() => [...factionsById.values()]),
        getFactionById: jasmine.createSpy('getFactionById').and.callFake((id: number) => factionsById.get(id)),
        getFactionByName: jasmine.createSpy('getFactionByName').and.callFake((name: string) => factionsByName.get(name)),
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
        return {
            id: overrides.id ?? 1,
            name: overrides.name ?? 'Test Unit',
            chassis: overrides.chassis ?? 'Test',
            model: overrides.model ?? 'TST-1',
            year: overrides.year ?? 3151,
            weightClass: overrides.weightClass ?? 'Medium',
            bv: overrides.bv ?? 1000,
            role: overrides.role ?? 'skirmisher',
            type: overrides.type ?? 'Mek',
            subtype: overrides.subtype ?? 'BattleMek',
            moveType: overrides.moveType ?? 'Biped',
            as: overrides.as ?? ({ PV: 5 } as Unit['as']),
        } as Unit;
    }

    function createContext(forceFaction: Faction, forceEra: Era): ForceGenerationContext {
        return {
            forceFaction,
            forceEra,
            averagingFactionIds: [forceFaction.id],
            averagingEraIds: [forceEra.id],
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
        megaMekRulesetsByMulFactionId.clear();
        megaMekRulesetsByFactionKey.clear();
        megaMekFactionsByKey.clear();

        filtersServiceMock.filteredUnits.set([]);
        filtersServiceMock.effectiveFilterState.calls.reset();
        filtersServiceMock.effectiveFilterState.and.returnValue({});

        for (const spy of Object.values(dataServiceMock)) {
            if ('calls' in spy) {
                spy.calls.reset();
            }
        }

        TestBed.configureTestingModule({
            providers: [
                ForceGeneratorService,
                { provide: DataService, useValue: dataServiceMock },
                { provide: UnitSearchFiltersService, useValue: filtersServiceMock },
            ],
        });

        service = TestBed.inject(ForceGeneratorService);
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
                    fs: { name: 'Federated Suns', state: 'or', count: 0 },
                    la: { name: 'Lyran Alliance', state: 'or', count: 0 },
                },
            },
        });

        spyOn(Math, 'random').and.returnValue(0.75);

        const context = service.resolveGenerationContext([unit]);

        expect(context.averagingEraIds).toEqual([3150]);
        expect(context.averagingFactionIds).toEqual([10, 20]);
        expect(context.forceFaction).toBe(lyranAlliance);
        expect(context.forceEra).toBe(era);
        expect(context.availablePairCount).toBe(2);
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

    it('filters out units with no availability in the rolled faction and era even if they are positive elsewhere in the selected scope', () => {
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
                averagingFactionIds: [10, 20],
                averagingEraIds: [3150, 3075],
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
        expect(preview.units.map((unit) => unit.unit.name)).toEqual(['Available Unit']);
        expect(preview.explanationLines[0]).toContain('Eligible pool: 1 units.');
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
        expect(preview.explanationLines[0]).toContain('Eligible pool: 1 units.');
        expect(preview.explanationLines.some((line) => line.includes('Resolved generation context: Federated Suns - ilClan.'))).toBeTrue();
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

    it('returns an error when the minimum budget cannot be reached within the unit count range', () => {
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

        expect(preview.error).toContain('minimum is too high');
    });

    it('keeps retrying until the 300ms no-match search window expires', () => {
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

        expect(preview.error).toContain('Unable to build a force');
        expect(buildSelectionSpy.calls.count()).toBeGreaterThan(10);
        expect(buildSelectionSpy.calls.count()).toBeLessThan(20);
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
        expect(preview.explanationLines.some((line) => line.includes('Selected echelon: LANCE.'))).toBeTrue();
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
        expect(preview.explanationLines.some((line) => line.includes('Resolved org shape: Lance.'))).toBeTrue();
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