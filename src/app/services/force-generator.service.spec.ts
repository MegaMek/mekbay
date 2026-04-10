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

    it('rolls production and salvage separately before picking the unit', () => {
        const era = createEra(3150, 'ilClan');
        const faction = createFaction(10, 'Federated Suns');
        const productionUnit = createUnit({ id: 1, name: 'Production Unit', chassis: 'Production', model: 'PRD-1', as: { PV: 5 } as Unit['as'] });
        const salvageUnit = createUnit({ id: 2, name: 'Salvage Unit', chassis: 'Salvage', model: 'SLV-1', as: { PV: 5 } as Unit['as'] });

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

        spyOn<any>(service, 'getSuccessPoolTarget').and.returnValue(1);
        spyOn<any>(service, 'getRandomAttemptCount').and.returnValue(1);
        const randomSpy = spyOn(Math, 'random');

        randomSpy.and.returnValues(0.25, 0, 0);
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
        randomSpy.and.returnValues(0.75, 0, 0);
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
        expect(preview.explanationLines.some((line) => line.includes('Salvage SLV-1: salvage pick'))).toBeTrue();
        expect(preview.explanationLines.some((line) => line.includes('roll 50%') && line.includes('pick 100%'))).toBeTrue();
    });

    it('includes a readable explanation for the generated picks', () => {
        const era = createEra(3150, 'ilClan');
        const faction = createFaction(10, 'Federated Suns');
        const unit = createUnit({ id: 1, name: 'Explained Unit', chassis: 'Explained', model: 'EXP-1', as: { PV: 5 } as Unit['as'] });

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
        expect(preview.explanationLines.some((line) => line.includes('Explained EXP-1: production pick (roll 75%, pick 100%)'))).toBeTrue();
    });

    it('picks one of the collected in-range successes for non-exact budget ranges', () => {
        const era = createEra(3150, 'ilClan');
        const faction = createFaction(10, 'Federated Suns');
        const unitA = createUnit({ id: 1, name: 'Unit A', chassis: 'Alpha', model: 'A-1', as: { PV: 5 } as Unit['as'] });
        const unitB = createUnit({ id: 2, name: 'Unit B', chassis: 'Bravo', model: 'B-1', as: { PV: 5 } as Unit['as'] });
        const unitC = createUnit({ id: 3, name: 'Unit C', chassis: 'Charlie', model: 'C-1', as: { PV: 5 } as Unit['as'] });
        const unitD = createUnit({ id: 4, name: 'Unit D', chassis: 'Delta', model: 'D-1', as: { PV: 5 } as Unit['as'] });

        const candidateA = { unit: unitA, productionWeight: 1, salvageWeight: 1, cost: 5, megaMekUnitType: 'Mek' };
        const candidateB = { unit: unitB, productionWeight: 1, salvageWeight: 1, cost: 5, megaMekUnitType: 'Mek' };
        const candidateC = { unit: unitC, productionWeight: 1, salvageWeight: 1, cost: 5, megaMekUnitType: 'Mek' };
        const candidateD = { unit: unitD, productionWeight: 1, salvageWeight: 1, cost: 5, megaMekUnitType: 'Mek' };

        const createAttempt = (selectedCandidates: Array<typeof candidateA>) => ({
            selectedCandidates,
            selectionSteps: selectedCandidates.map((candidate) => ({
                unit: candidate.unit,
                rolledSource: 'production' as const,
                source: 'production' as const,
                usedFallbackSource: false,
                sourceRollProbability: 0.5,
                candidatePickProbability: 0.5,
                productionWeight: candidate.productionWeight,
                salvageWeight: candidate.salvageWeight,
                cost: candidate.cost,
                rulesetReasons: [],
            })),
            rulesetProfile: null,
        });

        spyOn<any>(service, 'buildCandidateSelection').and.returnValues(
            createAttempt([candidateA, candidateC]),
            createAttempt([candidateB, candidateD]),
        );
        spyOn<any>(service, 'getRandomAttemptCount').and.returnValue(2);
        spyOn(Math, 'random').and.returnValue(0.99);

        const preview = service.buildPreview({
            eligibleUnits: [unitA, unitB, unitC, unitD],
            context: createContext(faction, era),
            gameSystem: GameSystem.ALPHA_STRIKE,
            budgetRange: { min: 10, max: 12 },
            minUnitCount: 2,
            maxUnitCount: 2,
            gunnery: 4,
            piloting: 5,
        });

        expect(preview.error).toBeNull();
        expect(preview.units.map((unit) => unit.unit.name)).toEqual(['Unit B', 'Unit D']);
    });

    it('stays inside an exact budget range without adjusting skill', () => {
        const era = createEra(3150, 'ilClan');
        const faction = createFaction(10, 'Federated Suns');
        const lightUnit = createUnit({ id: 1, name: 'Light Unit', as: { PV: 4 } as Unit['as'] });
        const mediumUnit = createUnit({ id: 2, name: 'Medium Unit', as: { PV: 5 } as Unit['as'] });

        const randomSpy = spyOn(Math, 'random').and.returnValue(0);

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
        expect(preview.units.map((unit) => unit.unit.name)).toEqual(jasmine.arrayWithExactContents(['Light Unit', 'Medium Unit']));
        expect(preview.units[0].skill).toBe(4);
        expect(preview.units[1].skill).toBe(4);
        expect(randomSpy.calls.count()).toBeLessThan(6);
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
            minUnitCount: 2,
            maxUnitCount: 2,
            gunnery: 4,
            piloting: 5,
        } as const;

        spyOn<any>(service, 'getSuccessPoolTarget').and.returnValue(1);
        spyOn<any>(service, 'getRandomAttemptCount').and.returnValue(1);
        const randomSpy = spyOn(Math, 'random');

        randomSpy.and.returnValues(0, 0, 0, 0.6, 0);
        let preview = service.buildPreview(baseRequest);
        expect(preview.units.map((unit) => unit.unit.name)).toEqual(['Seed', 'Scout']);

        megaMekRulesetsByMulFactionId.set(faction.id, [ruleset]);
        megaMekRulesetsByFactionKey.set(ruleset.factionKey, ruleset);

        randomSpy.calls.reset();
        randomSpy.and.returnValues(0, 0, 0, 0.6, 0);
        preview = service.buildPreview(baseRequest);
        expect(preview.units.map((unit) => unit.unit.name)).toEqual(['Seed', 'Command']);
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

        spyOn<any>(service, 'getSuccessPoolTarget').and.returnValue(1);
        spyOn<any>(service, 'getRandomAttemptCount').and.returnValue(1);
        const randomSpy = spyOn(Math, 'random');
        randomSpy.and.returnValues(0, 0, 0, 0.6, 0);

        const preview = service.buildPreview({
            eligibleUnits: [seedUnit, switchedMatch, offMatch],
            context: createContext(faction, era),
            gameSystem: GameSystem.ALPHA_STRIKE,
            budgetRange: { min: 0, max: 20 },
            minUnitCount: 2,
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

        spyOn<any>(service, 'getSuccessPoolTarget').and.returnValue(1);
        spyOn<any>(service, 'getRandomAttemptCount').and.returnValue(1);
        const randomSpy = spyOn(Math, 'random');
        randomSpy.and.returnValues(0, 0, 0, 0.6, 0);

        const preview = service.buildPreview({
            eligibleUnits: [seedUnit, parentMatch, offMatch],
            context: createContext(faction, era),
            gameSystem: GameSystem.ALPHA_STRIKE,
            budgetRange: { min: 0, max: 20 },
            minUnitCount: 2,
            maxUnitCount: 2,
            gunnery: 4,
            piloting: 5,
        });

        expect(preview.units.map((unit) => unit.unit.name)).toEqual(['Seed', 'Parent Command']);
        expect(preview.explanationLines.some((line) => line.includes('Nested subforce rules switched to CLAN.'))).toBeTrue();
    });
});