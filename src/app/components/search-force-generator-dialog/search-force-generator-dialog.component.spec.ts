import { DialogRef } from '@angular/cdk/dialog';
import { TestBed } from '@angular/core/testing';
import { signal, type WritableSignal } from '@angular/core';

import { GameSystem } from '../../models/common.model';
import type { ForcePreviewEntry } from '../../models/force-preview.model';
import type { LoadForceEntry } from '../../models/load-force-entry.model';
import type { Unit } from '../../models/units.model';
import { SearchForceGeneratorDialogComponent } from './search-force-generator-dialog.component';
import { DataService } from '../../services/data.service';
import { ForceBuilderService } from '../../services/force-builder.service';
import { ForceGeneratorService, type ForceGenerationPreview } from '../../services/force-generator.service';
import { GameService } from '../../services/game.service';
import { OptionsService } from '../../services/options.service';
import { DialogsService } from '../../services/dialogs.service';
import { UnitSearchFiltersService } from '../../services/unit-search-filters.service';
import { WsService } from '../../services/ws.service';
import { createEmptyUnit } from '../../testing/unit-test-helpers';
import { getUnitVariantGroupKey } from '../../utils/unit-variant.util';

describe('SearchForceGeneratorDialogComponent', () => {
    let component: SearchForceGeneratorDialogComponent;
    let dialogCloseSpy: jasmine.Spy;
    let requestClosePanelsSpy: jasmine.Spy;
    let setOptionSpy: jasmine.Spy;
    let setFilterSpy: jasmine.Spy;
    let getDropdownOptionsForFormationTargetSpy: jasmine.Spy;
    let setPilotSkillsSpy: jasmine.Spy;
    let buildPreviewSpy: jasmine.Spy;
    let createForceEntrySpy: jasmine.Spy;
    let createForceEntryFromPreviewEntrySpy: jasmine.Spy;
    let createForcePreviewEntrySpy: jasmine.Spy;
    let resolveGenerationContextSpy: jasmine.Spy;
    let resolveInitialBudgetDefaultsSpy: jasmine.Spy;
    let sendWsMessageSpy: jasmine.Spy;
    let optionsSignal: WritableSignal<any>;
    let advOptionsSignal: WritableSignal<any>;
    let effectiveFilterStateSignal: WritableSignal<any>;
    let filteredUnitsSignal: WritableSignal<Unit[]>;
    let forceGeneratorEligibleUnitsSignal: WritableSignal<Unit[]>;
    let gameSystemSignal: WritableSignal<GameSystem>;
    let searchTextSignal: WritableSignal<string>;

    beforeEach(() => {
        optionsSignal = signal({
            availabilitySource: 'mul',
            forceGenLastBVMin: 7900,
            forceGenLastBVMax: 8000,
            forceGenLastPVMin: 290,
            forceGenLastPVMax: 300,
            forceGenLastMinUnitCount: 4,
            forceGenLastMaxUnitCount: 8,
            forceGenLastGunnerySkillMin: 4,
            forceGenLastGunnerySkillMax: 4,
            forceGenLastPilotingSkillMin: 5,
            forceGenLastPilotingSkillMax: 5,
            forceGenLastMaxPilotSkillDelta: 1,
            forceGenPreventDuplicateChassis: false,
            forceGenUseTaggedQuantities: false,
            forceGenUseUnitTagsAsChassisTags: false,
        });

        setOptionSpy = jasmine.createSpy('setOption').and.callFake((key: string, value: unknown) => {
            optionsSignal.update((options) => ({ ...options, [key]: value }));
            return Promise.resolve();
        });

        dialogCloseSpy = jasmine.createSpy('close');
        requestClosePanelsSpy = jasmine.createSpy('requestClosePanels');
        setFilterSpy = jasmine.createSpy('setFilter');
        getDropdownOptionsForFormationTargetSpy = jasmine.createSpy('getDropdownOptionsForFormationTarget').and.returnValue(null);
        const pilotGunnerySkillSignal = signal(4);
        const pilotPilotingSkillSignal = signal(5);
        searchTextSignal = signal('');
        setPilotSkillsSpy = jasmine.createSpy('setPilotSkills').and.callFake((gunnery: number, piloting: number) => {
            pilotGunnerySkillSignal.set(gunnery);
            pilotPilotingSkillSignal.set(piloting);
        });
        sendWsMessageSpy = jasmine.createSpy('send');
        advOptionsSignal = signal({
            era: {
                type: 'dropdown' as const,
                label: 'Era',
                options: [
                    { name: 'Jihad' },
                    { name: 'Succession Wars' },
                    { name: 'Dark Age' },
                ],
                value: {
                    Jihad: {
                        name: 'Jihad',
                        state: 'and' as const,
                        count: 1,
                    },
                },
                interacted: true,
            },
            faction: {
                type: 'dropdown' as const,
                label: 'Faction',
                options: [],
                value: {},
                interacted: false,
            },
            type: {
                type: 'dropdown' as const,
                label: 'Type',
                options: [],
                value: ['Mek'],
                interacted: true,
            },
            subtype: {
                type: 'dropdown' as const,
                label: 'Subtype',
                options: [],
                value: ['BattleMek'],
                interacted: true,
            },
            'as.TP': {
                type: 'dropdown' as const,
                label: 'Type',
                options: [],
                value: ['BM'],
                interacted: true,
            },
            techBase: {
                type: 'dropdown' as const,
                label: 'Tech',
                options: [],
                value: [],
                interacted: false,
            },
            bv: {
                type: 'range' as const,
                label: 'BV',
                totalRange: [0, 10000] as [number, number],
                options: [0, 10000] as [number, number],
                value: [0, 10000] as [number, number],
                interacted: false,
            },
        });
        effectiveFilterStateSignal = signal({});

        const currentForceSignal = signal<any>(null);
        filteredUnitsSignal = signal<Unit[]>([]);
        forceGeneratorEligibleUnitsSignal = signal<Unit[]>([]);
        const unitsByName = new Map<string, Unit>();
        const factionsByName = new Map<string, any>();
        const dataServiceMock = {
            isDataReady: signal(true),
            getUnitByName: jasmine.createSpy('getUnitByName').and.callFake((name: string) => unitsByName.get(name)),
            getFactionByName: jasmine.createSpy('getFactionByName').and.callFake((name: string) => factionsByName.get(name)),
            getFactionById: jasmine.createSpy('getFactionById').and.returnValue(null),
            getEraById: jasmine.createSpy('getEraById').and.returnValue(null),
        };
        let previewResult: any = {
            gameSystem: GameSystem.CLASSIC,
            units: [],
            totalCost: 0,
            error: null,
            faction: null,
            era: null,
            explanationLines: [],
        };
        buildPreviewSpy = jasmine.createSpy('buildPreview').and.callFake(() => previewResult);
        resolveGenerationContextSpy = jasmine.createSpy('resolveGenerationContext').and.returnValue({
            forceFaction: null,
            forceEra: null,
            availabilityFactionIds: [],
            availabilityEraIds: [],
            availablePairCount: 0,
            ruleset: null,
        });
        resolveInitialBudgetDefaultsSpy = jasmine.createSpy('resolveInitialBudgetDefaults').and.returnValue({
            classic: { min: 7900, max: 8000 },
            alphaStrike: { min: 290, max: 300 },
        });
        createForcePreviewEntrySpy = jasmine.createSpy('createForcePreviewEntry').and.callFake((preview: any) => {
            if (preview.units.length === 0) {
                return null;
            }

            const previewEntry = {
                instanceId: '',
                timestamp: '',
                type: preview.gameSystem,
                owned: true,
                cloud: false,
                local: false,
                missing: false,
                name: preview.name ?? 'Generated Preview',
                faction: preview.faction,
                era: preview.era,
                bv: preview.gameSystem === GameSystem.CLASSIC ? preview.totalCost : undefined,
                pv: preview.gameSystem === GameSystem.ALPHA_STRIKE ? preview.totalCost : undefined,
                groups: [{
                    units: preview.units.map((unit: any) => ({
                        unit: unit.unit,
                        alias: unit.alias,
                        destroyed: false,
                        skill: unit.skill,
                        gunnery: unit.gunnery,
                        piloting: unit.piloting,
                        commander: unit.commander,
                        lockKey: unit.lockKey,
                    })),
                }],
            } as ForcePreviewEntry;

            for (const group of previewEntry.groups) {
                group.force = previewEntry;
            }

            return previewEntry;
        });
        createForceEntrySpy = jasmine.createSpy('createForceEntry').and.callFake((preview: any) => {
            if (preview.units.length === 0) {
                return null;
            }

            return {
                groups: [{
                    units: preview.units.map((unit: any) => ({
                        unit: unit.unit,
                        destroyed: false,
                        lockKey: unit.lockKey,
                    })),
                }],
            } as LoadForceEntry;
        });
        createForceEntryFromPreviewEntrySpy = jasmine.createSpy('createForceEntryFromPreviewEntry').and.callFake((previewEntry: ForcePreviewEntry) => {
            if (previewEntry.groups.length === 0) {
                return null;
            }

            return {
                ...previewEntry,
                groups: previewEntry.groups.map((group) => ({
                    name: group.name,
                    formationId: group.formationId,
                    units: group.units.map((unit) => ({ ...unit })),
                })),
            } as LoadForceEntry;
        });

        const forceGeneratorServiceMock = {
            resolveInitialBudgetDefaults: resolveInitialBudgetDefaultsSpy,
            resolveInitialUnitCountDefaults: () => ({ min: 4, max: 8 }),
            resolveInitialSkillDefaults: (options: any) => ({
                gunnery: {
                    min: Math.min(options.forceGenLastGunnerySkillMin, options.forceGenLastGunnerySkillMax),
                    max: Math.max(options.forceGenLastGunnerySkillMin, options.forceGenLastGunnerySkillMax),
                },
                piloting: {
                    min: Math.min(options.forceGenLastPilotingSkillMin, options.forceGenLastPilotingSkillMax),
                    max: Math.max(options.forceGenLastPilotingSkillMin, options.forceGenLastPilotingSkillMax),
                },
                maxDelta: options.forceGenLastMaxPilotSkillDelta,
            }),
            resolveBudgetRangeForEditedMin: (range: { min: number; max: number }, editedMin: number) => {
                const nextMin = Math.max(0, Math.floor(editedMin));
                const nextMax = range.max > 0
                    ? Math.max(nextMin, Math.floor(range.max))
                    : Math.max(0, Math.floor(range.max));
                return { min: nextMin, max: nextMax };
            },
            resolveBudgetRangeForEditedMax: (range: { min: number; max: number }, editedMax: number) => {
                const nextMax = Math.max(0, Math.floor(editedMax));
                if (nextMax === 0) {
                    return {
                        min: Math.max(0, Math.floor(range.min)),
                        max: 0,
                    };
                }

                return {
                    min: Math.min(Math.max(0, Math.floor(range.min)), nextMax),
                    max: nextMax,
                };
            },
            resolveUnitCountRangeForEditedMin: (range: { min: number; max: number }, editedMin: number) => {
                const nextMin = Math.min(100, Math.max(1, Math.floor(editedMin)));
                return { min: nextMin, max: Math.max(nextMin, range.max) };
            },
            resolveUnitCountRangeForEditedMax: (range: { min: number; max: number }, editedMax: number) => {
                const nextMax = Math.min(100, Math.max(1, Math.floor(editedMax)));
                return { min: Math.min(range.min, nextMax), max: nextMax };
            },
            getStoredUnitCountOptionKeys: () => ({
                min: 'forceGenLastMinUnitCount',
                max: 'forceGenLastMaxUnitCount',
            }),
            getStoredBudgetOptionKeys: () => ({
                min: 'forceGenLastBVMin',
                max: 'forceGenLastBVMax',
            }),
            getStoredSkillOptionKeys: () => ({
                gunneryMin: 'forceGenLastGunnerySkillMin',
                gunneryMax: 'forceGenLastGunnerySkillMax',
                pilotingMin: 'forceGenLastPilotingSkillMin',
                pilotingMax: 'forceGenLastPilotingSkillMax',
                maxDelta: 'forceGenLastMaxPilotSkillDelta',
            }),
            resolveGenerationContext: resolveGenerationContextSpy,
            buildPreview: buildPreviewSpy,
            createForcePreviewEntry: createForcePreviewEntrySpy,
            createForceEntry: createForceEntrySpy,
            createForceEntryFromPreviewEntry: createForceEntryFromPreviewEntrySpy,
            getBudgetMetric: (unit: Unit, gameSystem: GameSystem) => {
                return gameSystem === GameSystem.ALPHA_STRIKE ? unit.as?.PV ?? 0 : unit.bv ?? 0;
            },
        };

        gameSystemSignal = signal(GameSystem.CLASSIC);

        TestBed.configureTestingModule({
            providers: [
                {
                    provide: DialogRef,
                    useValue: { close: dialogCloseSpy },
                },
                {
                    provide: DataService,
                    useValue: dataServiceMock,
                },
                {
                    provide: ForceGeneratorService,
                    useValue: forceGeneratorServiceMock,
                },
                {
                    provide: ForceBuilderService,
                    useValue: {
                        smartCurrentForce: currentForceSignal,
                    },
                },
                {
                    provide: GameService,
                    useValue: {
                        currentGameSystem: gameSystemSignal,
                    },
                },
                {
                    provide: OptionsService,
                    useValue: {
                        options: optionsSignal,
                        setOption: setOptionSpy,
                    },
                },
                {
                    provide: DialogsService,
                    useValue: {
                        createDialog: jasmine.createSpy('createDialog'),
                    },
                },
                {
                    provide: UnitSearchFiltersService,
                    useValue: {
                        advOptions: advOptionsSignal,
                        bvPvLimit: signal(5000),
                        closePanelsRequest: signal({ requestId: 0, exitExpandedView: false }),
                        effectiveFilterState: effectiveFilterStateSignal,
                        filteredUnits: filteredUnitsSignal,
                        forceGeneratorEligibleUnits: forceGeneratorEligibleUnitsSignal,
                        isComplexQuery: signal(false),
                        pilotGunnerySkill: pilotGunnerySkillSignal,
                        pilotPilotingSkill: pilotPilotingSkillSignal,
                        getDropdownOptionsForFormationTarget: getDropdownOptionsForFormationTargetSpy,
                        requestClosePanels: requestClosePanelsSpy,
                        searchText: searchTextSignal,
                        setFilter: setFilterSpy,
                        setPilotSkills: setPilotSkillsSpy,
                        unsetFilter: jasmine.createSpy('unsetFilter'),
                    },
                },
                {
                    provide: WsService,
                    useValue: {
                        send: sendWsMessageSpy,
                        wsConnected: signal(true),
                    },
                },
            ],
        });

        TestBed.overrideComponent(SearchForceGeneratorDialogComponent, {
            set: {
                providers: [{
                    provide: ForceGeneratorService,
                    useValue: forceGeneratorServiceMock,
                }],
            },
        });

        component = TestBed.runInInjectionContext(() => new SearchForceGeneratorDialogComponent());

        Object.assign(component, {
            __test: {
                currentForceSignal,
                unitsByName,
                factionsByName,
                setPreviewResult(nextPreviewResult: typeof previewResult) {
                    previewResult = nextPreviewResult;
                },
            },
        });

        buildPreviewSpy.calls.reset();
        sendWsMessageSpy.calls.reset();
    });

    it('does not build an initial preview when the dialog opens', () => {
        TestBed.runInInjectionContext(() => new SearchForceGeneratorDialogComponent());

        expect(buildPreviewSpy).not.toHaveBeenCalled();
        expect(component.previewEntry()).toBeNull();
        expect(component.previewError()).toBe('Press REROLL to generate a force preview for the current settings.');
    });

    it('uses the stored force generator skill defaults', async () => {
        optionsSignal.update((options) => ({
            ...options,
            forceGenLastGunnerySkillMin: 2,
            forceGenLastGunnerySkillMax: 4,
            forceGenLastPilotingSkillMin: 3,
            forceGenLastPilotingSkillMax: 6,
            forceGenLastMaxPilotSkillDelta: 2,
        }));

        const fixture = TestBed.createComponent(SearchForceGeneratorDialogComponent);
        await fixture.whenStable();
        fixture.detectChanges();

        const dialog = fixture.componentInstance;
        expect(dialog.gunnerySkillRange()).toEqual([2, 4]);
        expect(dialog.pilotingSkillRange()).toEqual([3, 6]);
        expect(dialog.maxPilotSkillDelta()).toBe(2);
    });

    it('uses the stored force generator checkbox defaults', async () => {
        optionsSignal.update((options) => ({
            ...options,
            forceGenPreventDuplicateChassis: true,
            forceGenUseTaggedQuantities: true,
            forceGenUseUnitTagsAsChassisTags: true,
        }));

        const fixture = TestBed.createComponent(SearchForceGeneratorDialogComponent);
        await fixture.whenStable();
        fixture.detectChanges();

        const dialog = fixture.componentInstance;
        expect(dialog.preventDuplicateChassis()).toBeTrue();
        expect(dialog.useTaggedQuantities()).toBeFalse();
        expect(dialog.useUnitTagsAsChassisTags()).toBeTrue();
    });

    it('uses uncapped force-generator eligible units for preview requests', () => {
        const limitedUnit = createEmptyUnit({
            id: 1,
            name: 'Limited Unit',
            chassis: 'Limited',
            model: 'Prime',
            as: { PV: 25 },
        });
        const extraEligibleUnit = createEmptyUnit({
            id: 2,
            name: 'Extra Eligible Unit',
            chassis: 'Extra',
            model: 'Prime',
            as: { PV: 40 },
        });

        filteredUnitsSignal.set([limitedUnit]);
        forceGeneratorEligibleUnitsSignal.set([limitedUnit, extraEligibleUnit]);

        component.reroll();
        component.previewEntry();

        expect(component.eligibleUnits()).toEqual([limitedUnit, extraEligibleUnit]);
        expect(buildPreviewSpy.calls.mostRecent().args[0].eligibleUnits).toEqual([limitedUnit, extraEligibleUnit]);
        expect(createForcePreviewEntrySpy).toHaveBeenCalled();
        expect(createForceEntrySpy).not.toHaveBeenCalled();
        expect(createForceEntryFromPreviewEntrySpy).not.toHaveBeenCalled();
    });

    it('does not lower the min units while typing a larger max until blur', async () => {
        const fixture = TestBed.createComponent(SearchForceGeneratorDialogComponent);
        await fixture.whenStable();
        fixture.detectChanges();

        const dialog = fixture.componentInstance;
        const inputs = Array.from(
            fixture.nativeElement.querySelectorAll('input.bt-input.field-input[type="number"]'),
        ) as HTMLInputElement[];
        const maxUnitsInput = inputs[1];

        maxUnitsInput.value = '1';
        maxUnitsInput.dispatchEvent(new Event('input'));
        fixture.detectChanges();

        expect(dialog.minUnitCount()).toBe(4);
        expect(dialog.maxUnitCount()).toBe(8);
        expect(setOptionSpy).not.toHaveBeenCalled();

        maxUnitsInput.value = '10';
        maxUnitsInput.dispatchEvent(new Event('input'));
        fixture.detectChanges();

        expect(dialog.minUnitCount()).toBe(4);
        expect(dialog.maxUnitCount()).toBe(8);

        maxUnitsInput.dispatchEvent(new Event('blur'));
        fixture.detectChanges();

        expect(dialog.minUnitCount()).toBe(4);
        expect(dialog.maxUnitCount()).toBe(10);
        expect(setOptionSpy).toHaveBeenCalledOnceWith('forceGenLastMaxUnitCount', 10);
        expect(maxUnitsInput.value).toBe('10');
    });

    it('snaps the max units input back to the clamped maximum on blur', () => {
        const input = document.createElement('input');
        input.value = '1003';
        const event = { target: input } as unknown as Event;

        component.onMaxUnitCountBlur(event);

        expect(component.maxUnitCount()).toBe(100);
        expect(setOptionSpy).toHaveBeenCalledOnceWith('forceGenLastMaxUnitCount', 100);
        expect(input.value).toBe('100');
    });

    it('snaps an empty max units blur to the current minimum', () => {
        component.minUnitCount.set(6);
        component.maxUnitCount.set(10);

        const input = document.createElement('input');
        input.value = '';
        const event = { target: input } as unknown as Event;

        component.onMaxUnitCountBlur(event);

        expect(component.minUnitCount()).toBe(6);
        expect(component.maxUnitCount()).toBe(6);
        expect(setOptionSpy).toHaveBeenCalledOnceWith('forceGenLastMaxUnitCount', 6);
        expect(input.value).toBe('6');
    });

    it('does not replace the displayed preview when max units are committed on blur', () => {
        const atlas = createEmptyUnit({
            id: 1,
            name: 'Atlas AS7-D',
            chassis: 'Atlas',
            model: 'AS7-D',
            bv: 7950,
            as: { PV: 54 },
        });

        (component as any).__test.setPreviewResult({
            gameSystem: GameSystem.CLASSIC,
            units: [{
                unit: atlas,
                cost: 7950,
                gunnery: 4,
                piloting: 5,
                lockKey: 'generated:0:Atlas AS7-D',
            }],
            totalCost: 7950,
            error: null,
            faction: null,
            era: null,
            explanationLines: [],
        });

        component.reroll();
        buildPreviewSpy.calls.reset();

        const previewEntry = component.previewEntry();

        component.onMaxUnitCountBlur({
            target: { value: '10' },
        } as unknown as Event);

        expect(buildPreviewSpy).not.toHaveBeenCalled();
        expect(component.previewEntry()).toBe(previewEntry);
    });

    it('does not lower the minimum budget while typing a larger maximum until blur', async () => {
        const fixture = TestBed.createComponent(SearchForceGeneratorDialogComponent);
        await fixture.whenStable();
        fixture.detectChanges();

        const dialog = fixture.componentInstance;
        const maxBudgetInput = fixture.nativeElement.querySelectorAll('thousands-integer-input input')[1] as HTMLInputElement;

        maxBudgetInput.value = '1';
        maxBudgetInput.dispatchEvent(new Event('input'));
        fixture.detectChanges();

        expect(dialog.budgetRange()).toEqual({ min: 7900, max: 8000 });
        expect(setOptionSpy).not.toHaveBeenCalled();

        maxBudgetInput.value = '10000';
        maxBudgetInput.dispatchEvent(new Event('input'));
        fixture.detectChanges();

        expect(dialog.budgetRange()).toEqual({ min: 7900, max: 8000 });

        maxBudgetInput.dispatchEvent(new Event('blur'));
        fixture.detectChanges();

        expect(dialog.budgetRange()).toEqual({ min: 7900, max: 10000 });
        expect(setOptionSpy).toHaveBeenCalledOnceWith('forceGenLastBVMax', 10000);
        expect(maxBudgetInput.value).toBe('10,000');
    });

    it('does not replace the displayed preview when max budget is committed on blur', () => {
        const atlas = createEmptyUnit({
            id: 1,
            name: 'Atlas AS7-D',
            chassis: 'Atlas',
            model: 'AS7-D',
            bv: 7950,
            as: { PV: 54 },
        });

        (component as any).__test.setPreviewResult({
            gameSystem: GameSystem.CLASSIC,
            units: [{
                unit: atlas,
                cost: 7950,
                gunnery: 4,
                piloting: 5,
                lockKey: 'generated:0:Atlas AS7-D',
            }],
            totalCost: 7950,
            error: null,
            faction: null,
            era: null,
            explanationLines: [],
        });

        component.reroll();
        buildPreviewSpy.calls.reset();

        const previewEntry = component.previewEntry();

        component.onBudgetMaxBlur({
            target: { value: '10000' },
        } as unknown as Event);

        expect(buildPreviewSpy).not.toHaveBeenCalled();
        expect(component.previewEntry()).toBe(previewEntry);
    });

    it('treats an empty max budget blur as unbounded zero', () => {
        component.classicBudgetMin.set(9000);
        component.classicBudgetMax.set(10000);

        const event = {
            target: { value: '' },
        } as unknown as Event;

        component.onBudgetMaxBlur(event);

        expect(component.classicBudgetMin()).toBe(9000);
        expect(component.classicBudgetMax()).toBe(0);
        expect((event.target as HTMLInputElement).value).toBe('');
    });

    it('preserves multistate era selections when updating filters', () => {
        expect(component.selectedEraValues()).toEqual({
            Jihad: {
                name: 'Jihad',
                state: 'and',
                count: 1,
            },
        });

        const selection = {
            'Succession Wars': {
                name: 'Succession Wars',
                state: 'or' as const,
                count: 1,
            },
        };

        component.onEraSelectionChange(selection);

        expect(setFilterSpy).toHaveBeenCalledWith('era', selection);
    });

    it('updates classic unit type and subtype filters from the dialog dropdowns', () => {
        expect(component.selectedUnitTypeValues()).toEqual(['Mek']);
        expect(component.selectedSubtypeValues()).toEqual(['BattleMek']);

        component.onUnitTypeSelectionChange(['Tank']);
        component.onSubtypeSelectionChange(['Combat Vehicle']);

        expect(setFilterSpy).toHaveBeenCalledWith('type', ['Tank']);
        expect(setFilterSpy).toHaveBeenCalledWith('subtype', ['Combat Vehicle']);
    });

    it('uses the local generator mode for unit type and subtype filters', () => {
        expect(component.additionalFiltersExcludedKeys()).toContain('type');
        expect(component.additionalFiltersExcludedKeys()).toContain('subtype');
        expect(component.additionalFiltersExcludedKeys()).not.toContain('as.TP');

        component.setGameSystem(GameSystem.ALPHA_STRIKE);

        expect(component.gameSystem()).toBe(GameSystem.ALPHA_STRIKE);
        expect(gameSystemSignal()).toBe(GameSystem.CLASSIC);
        expect(component.selectedUnitTypeValues()).toEqual(['BM']);
        expect(component.selectedSubtypeValues()).toEqual([]);
        expect(component.additionalFiltersExcludedKeys()).toContain('as.TP');
        expect(component.additionalFiltersExcludedKeys()).not.toContain('type');
        expect(component.additionalFiltersExcludedKeys()).not.toContain('subtype');

        component.onUnitTypeSelectionChange(['CV']);

        expect(setFilterSpy).toHaveBeenCalledWith('as.TP', ['CV']);
    });

    it('highlights the advanced system toggle only for active filters hidden behind it', () => {
        component.advPanelFilterGameSystem.set(GameSystem.ALPHA_STRIKE);
        effectiveFilterStateSignal.set({
            type: { interactedWith: true },
            subtype: { interactedWith: true },
        });

        expect(component.otherAdvPanelFilterGameSystem()).toBe(GameSystem.CLASSIC);
        expect(component.otherAdvPanelFilterGameSystemHasActiveFilters()).toBeFalse();

        component.advPanelFilterGameSystem.set(GameSystem.CLASSIC);
        effectiveFilterStateSignal.set({
            'as.TP': { interactedWith: true },
        });

        expect(component.otherAdvPanelFilterGameSystem()).toBe(GameSystem.ALPHA_STRIKE);
        expect(component.otherAdvPanelFilterGameSystemHasActiveFilters()).toBeTrue();

        component.setGameSystem(GameSystem.ALPHA_STRIKE);

        expect(component.otherAdvPanelFilterGameSystemHasActiveFilters()).toBeFalse();

        component.advPanelFilterGameSystem.set(GameSystem.ALPHA_STRIKE);
        effectiveFilterStateSignal.set({
            type: { interactedWith: true },
            subtype: { interactedWith: true },
        });

        expect(component.otherAdvPanelFilterGameSystem()).toBe(GameSystem.CLASSIC);
        expect(component.otherAdvPanelFilterGameSystemHasActiveFilters()).toBeTrue();
    });

    it('uses the local generator mode for preview requests without changing the global game system', () => {
        component.setGameSystem(GameSystem.ALPHA_STRIKE);

        component.reroll();

        expect(buildPreviewSpy.calls.mostRecent().args[0].gameSystem).toBe(GameSystem.ALPHA_STRIKE);
        expect(gameSystemSignal()).toBe(GameSystem.CLASSIC);
    });

    it('records successful force generations over websocket when reroll produces a preview', () => {
        const atlas = createEmptyUnit({
            id: 11,
            name: 'Atlas AS7-D',
            chassis: 'Atlas',
            model: 'AS7-D',
            bv: 1897,
        });

        (component as any).__test.setPreviewResult({
            gameSystem: GameSystem.CLASSIC,
            units: [{
                unit: atlas,
                cost: 1897,
                gunnery: 4,
                piloting: 5,
                lockKey: 'generated:0:Atlas AS7-D',
            }],
            totalCost: 1897,
            error: null,
            faction: null,
            era: null,
            explanationLines: [],
        });

        component.reroll();

        expect(sendWsMessageSpy).toHaveBeenCalledOnceWith({ action: 'recordForceGeneration' });
    });

    it('does not record force generations when reroll fails to produce a preview', () => {
        (component as any).__test.setPreviewResult({
            gameSystem: GameSystem.CLASSIC,
            units: [],
            totalCost: 0,
            error: 'No matching units found.',
            faction: null,
            era: null,
            explanationLines: [],
        });

        component.reroll();

        expect(sendWsMessageSpy).not.toHaveBeenCalled();
    });

    it('imports the current force into the locked preview without rerolling', () => {
        const atlas = createEmptyUnit({
            id: 1,
            name: 'Atlas AS7-D',
            chassis: 'Atlas',
            model: 'AS7-D',
            as: { PV: 6 },
        });
        const locust = createEmptyUnit({
            id: 2,
            name: 'Locust LCT-1V',
            chassis: 'Locust',
            model: 'LCT-1V',
            as: { PV: 4 },
        });
        const testState = (component as any).__test;
        const serializeSpy = jasmine.createSpy('serialize');
        const liveUnit1 = {
            id: 'u-1',
            destroyed: false,
            getUnit: () => atlas,
            alias: () => undefined,
            commander: () => false,
            getPilotSkill: () => 3,
            getPilotStats: () => 3,
        };
        const liveUnit2 = {
            id: 'u-2',
            destroyed: false,
            getUnit: () => locust,
            alias: () => undefined,
            commander: () => false,
            getPilotSkill: () => 4,
            getPilotStats: () => 4,
        };
        testState.currentForceSignal.set({
            units: () => [liveUnit1, liveUnit2],
            owned: () => true,
            instanceId: () => 'force-1',
            name: 'Current Force',
            gameSystem: GameSystem.ALPHA_STRIKE,
            faction: () => null,
            era: () => null,
            totalBv: () => 10,
            timestamp: '2026-04-11T00:00:00.000Z',
            groups: () => [{
                name: () => undefined,
                activeFormation: () => null,
                units: () => [liveUnit1, liveUnit2],
            }],
            serialize: serializeSpy,
        });

        component.importCurrentForce();
        const preview = component.preview();

        expect(serializeSpy).not.toHaveBeenCalled();
        expect(component.canImportCurrentForce()).toBeTrue();
        expect(component.lockedUnitKeys().size).toBe(2);
        const previewLockKeys = preview.units.map((unit) => unit.lockKey);
        expect(previewLockKeys.every((lockKey) => !!lockKey)).toBeTrue();
        expect(previewLockKeys).toHaveSize(2);
        expect(new Set(previewLockKeys).size).toBe(2);
        expect(previewLockKeys.every((lockKey) => /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(lockKey!))).toBeTrue();
        expect(previewLockKeys.every((lockKey) => component.lockedUnitKeys().has(lockKey!))).toBeTrue();
        expect(preview.units.map((unit) => unit.unit.name)).toEqual([atlas.name, locust.name]);
        expect(preview.explanationLines).toContain('Imported current force into preview. Press REROLL to generate a new result for the current settings.');
        expect(buildPreviewSpy).not.toHaveBeenCalled();
        expect(sendWsMessageSpy).not.toHaveBeenCalled();
    });

    it('rejects preview units and excludes them from later generation requests', async () => {
        const atlas = createEmptyUnit({
            id: 1,
            name: 'Atlas AS7-D',
            chassis: 'Atlas',
            model: 'AS7-D',
            bv: 1897,
        });
        const locust = createEmptyUnit({
            id: 2,
            name: 'Locust LCT-1V',
            chassis: 'Locust',
            model: 'LCT-1V',
            bv: 432,
        });

        forceGeneratorEligibleUnitsSignal.set([atlas, locust]);
        (component as any).__test.setPreviewResult({
            gameSystem: GameSystem.CLASSIC,
            units: [{ unit: atlas, cost: 1897, gunnery: 4, piloting: 5, lockKey: 'atlas-slot' }],
            totalCost: 1897,
            error: null,
            faction: null,
            era: null,
            explanationLines: [],
        });

        component.reroll();
        const unitEntry = component.previewEntry()!.groups[0].units[0];
        await component.onPreviewUnitMenuAction({ action: 'reject', unitEntry });

        expect(component.rejectedUnitPills()).toEqual([{ name: atlas.name, label: 'Atlas AS7-D' }]);
        expect(component.generationEligibleUnits()).toEqual([locust]);

        component.reroll();

        expect(buildPreviewSpy.calls.mostRecent().args[0].eligibleUnits).toEqual([locust]);
    });

    it('marks chassis-only locked preview units as variant-group locked generation slots', async () => {
        const atlas = createEmptyUnit({
            id: 1,
            name: 'Atlas AS7-D',
            chassis: 'Atlas',
            model: 'AS7-D',
            bv: 1897,
            as: { TP: 'BM', PV: 42 },
        });

        forceGeneratorEligibleUnitsSignal.set([atlas]);
        (component as any).__test.setPreviewResult({
            gameSystem: GameSystem.CLASSIC,
            units: [{ unit: atlas, cost: 1897, gunnery: 4, piloting: 5, lockKey: 'atlas-slot' }],
            totalCost: 1897,
            error: null,
            faction: null,
            era: null,
            explanationLines: [],
        });

        component.reroll();
        const unitEntry = component.previewEntry()!.groups[0].units[0];
        await component.onPreviewUnitMenuAction({ action: 'toggle-chassis-lock', unitEntry });

        expect(component.lockedUnitKeys().has('atlas-slot')).toBeTrue();
        expect(component.chassisOnlyLockedUnitKeys().has('atlas-slot')).toBeTrue();

        component.reroll();

        expect(buildPreviewSpy.calls.mostRecent().args[0].lockedUnits).toEqual([
            jasmine.objectContaining({
                unit: atlas,
                lockKey: 'atlas-slot',
                variantGroupKey: getUnitVariantGroupKey(atlas),
            }),
        ]);
    });

    it('submits the rendered preview entry without rebuilding its groups', () => {
        const atlas = createEmptyUnit({
            id: 4,
            name: 'Atlas AS7-D',
            chassis: 'Atlas',
            model: 'AS7-D',
            bv: 1897,
        });

        (component as any).__test.setPreviewResult({
            gameSystem: GameSystem.CLASSIC,
            units: [{
                unit: atlas,
                cost: 1897,
                gunnery: 4,
                piloting: 5,
                lockKey: 'generated:0:Atlas AS7-D',
            }],
            totalCost: 1897,
            error: null,
            faction: null,
            era: null,
            explanationLines: [],
        });

        component.reroll();
        const renderedEntry = component.previewEntry();

        expect(createForcePreviewEntrySpy).toHaveBeenCalledTimes(1);
        expect(createForceEntrySpy).not.toHaveBeenCalled();
        expect(createForceEntryFromPreviewEntrySpy).not.toHaveBeenCalled();

        component.minUnitCount.set(1);
        component.maxUnitCount.set(1);
        component.classicBudgetMin.set(0);
        component.classicBudgetMax.set(0);
        component.submit();

        expect(createForceEntrySpy).not.toHaveBeenCalled();
        expect(createForceEntryFromPreviewEntrySpy).toHaveBeenCalledOnceWith(renderedEntry);
        expect(dialogCloseSpy).toHaveBeenCalledTimes(1);
    });

    it('clears the hovered radar overlay when rerolling a new preview', () => {
        const atlas = createEmptyUnit({
            id: 3,
            name: 'Atlas AS7-D',
            chassis: 'Atlas',
            model: 'AS7-D',
        });

        component.onPreviewUnitHover({
            unit: atlas,
            destroyed: false,
        });

        expect(component.hoveredRadarUnit()).toBe(atlas);

        component.reroll();

        expect(component.hoveredRadarUnit()).toBeNull();
    });

    it('requests the unit search to close when CREATE submits a generated force', () => {
        const atlas = createEmptyUnit({
            id: 4,
            name: 'Atlas AS7-D',
            chassis: 'Atlas',
            model: 'AS7-D',
            bv: 1897,
        });

        (component as any).__test.setPreviewResult({
            gameSystem: GameSystem.CLASSIC,
            units: [{
                unit: atlas,
                cost: 1897,
                gunnery: 4,
                piloting: 5,
                lockKey: 'generated:0:Atlas AS7-D',
            }],
            totalCost: 1897,
            error: null,
            faction: null,
            era: null,
            explanationLines: [],
        });

        component.reroll();
    component.minUnitCount.set(1);
    component.maxUnitCount.set(1);
    component.classicBudgetMin.set(0);
    component.classicBudgetMax.set(0);
        component.submit();

        expect(requestClosePanelsSpy).toHaveBeenCalledTimes(1);
        expect(requestClosePanelsSpy).toHaveBeenCalledWith({ exitExpandedView: true });
        expect(dialogCloseSpy).toHaveBeenCalledTimes(1);
    });

    it('forwards the duplicate-chassis checkbox state into the preview request', () => {
        component.onPreventDuplicateChassisChange({
            target: { checked: true },
        } as unknown as Event);

        expect(buildPreviewSpy).not.toHaveBeenCalled();
        expect(setOptionSpy).toHaveBeenCalledOnceWith('forceGenPreventDuplicateChassis', true);

        component.reroll();

        expect(buildPreviewSpy.calls.mostRecent().args[0].preventDuplicateChassis).toBeTrue();
    });

    it('unchecks tagged quantities when duplicate-chassis prevention is checked', () => {
        component.onUseTaggedQuantitiesChange({
            target: { checked: true },
        } as unknown as Event);
        setOptionSpy.calls.reset();

        component.onPreventDuplicateChassisChange({
            target: { checked: true },
        } as unknown as Event);

        expect(component.preventDuplicateChassis()).toBeTrue();
        expect(component.useTaggedQuantities()).toBeFalse();
        expect(setOptionSpy.calls.allArgs()).toEqual([
            ['forceGenPreventDuplicateChassis', true],
            ['forceGenUseTaggedQuantities', false],
        ]);
    });

    it('stores and forwards the tagged-quantities checkbox state', () => {
        component.onUseTaggedQuantitiesChange({
            target: { checked: true },
        } as unknown as Event);

        expect(buildPreviewSpy).not.toHaveBeenCalled();
        expect(setOptionSpy).toHaveBeenCalledOnceWith('forceGenUseTaggedQuantities', true);

        component.reroll();

        expect(buildPreviewSpy.calls.mostRecent().args[0].useTaggedQuantities).toBeTrue();
    });

    it('forwards the current search settings into the preview request', () => {
        searchTextSignal.set('atlas !primitive');

        component.reroll();

        expect(buildPreviewSpy.calls.mostRecent().args[0].searchSettings).toEqual([
            'Search settings: query "atlas !primitive"; filters Era Jihad | Type Mek | Subtype BattleMek | Type BM.',
        ]);
    });

    it('expands AND tag selections in the forwarded search settings', () => {
        advOptionsSignal.update((options) => ({
            ...options,
            _tags: {
                type: 'dropdown' as const,
                label: 'Tags',
                options: [
                    { name: 'Official' },
                    { name: 'Want' },
                    { name: 'CGB' },
                ],
                value: {
                    Official: { name: 'Official', state: 'or' as const, count: 1 },
                    Want: { name: 'Want', state: 'or' as const, count: 1 },
                    CGB: { name: 'CGB', state: 'and' as const, count: 1 },
                },
                interacted: true,
            },
        }));

        component.reroll();

        expect(buildPreviewSpy.calls.mostRecent().args[0].searchSettings).toEqual([
            'Search settings: filters Era Jihad | Type Mek | Subtype BattleMek | Type BM | Tags Official, Want, CGB.',
        ]);
    });

    it('omits query from search settings when the search query is empty', () => {
        component.reroll();

        expect(buildPreviewSpy.calls.mostRecent().args[0].searchSettings).toEqual([
            'Search settings: filters Era Jihad | Type Mek | Subtype BattleMek | Type BM.',
        ]);
    });

    it('renders the unit-tags-as-chassis checkbox only when tagged quantities are active', async () => {
        const fixture = TestBed.createComponent(SearchForceGeneratorDialogComponent);
        await fixture.whenStable();
        fixture.detectChanges();

        expect(fixture.nativeElement.querySelector('.unit-tags-as-chassis-option')).toBeNull();

        fixture.componentInstance.onUseTaggedQuantitiesChange({
            target: { checked: true },
        } as unknown as Event);
        fixture.detectChanges();

        expect(fixture.nativeElement.querySelector('.unit-tags-as-chassis-option')).not.toBeNull();
    });

    it('stores and forwards the unit-tags-as-chassis checkbox state', () => {
        component.onUseTaggedQuantitiesChange({
            target: { checked: true },
        } as unknown as Event);
        setOptionSpy.calls.reset();

        component.onUseUnitTagsAsChassisTagsChange({
            target: { checked: true },
        } as unknown as Event);

        expect(buildPreviewSpy).not.toHaveBeenCalled();
        expect(setOptionSpy).toHaveBeenCalledOnceWith('forceGenUseUnitTagsAsChassisTags', true);

        component.reroll();

        expect(buildPreviewSpy.calls.mostRecent().args[0].useTaggedQuantities).toBeTrue();
        expect(buildPreviewSpy.calls.mostRecent().args[0].useUnitTagsAsChassisTags).toBeTrue();
    });

    it('unchecks duplicate-chassis prevention when tagged quantities is checked', () => {
        component.onPreventDuplicateChassisChange({
            target: { checked: true },
        } as unknown as Event);
        setOptionSpy.calls.reset();

        component.onUseTaggedQuantitiesChange({
            target: { checked: true },
        } as unknown as Event);

        expect(component.useTaggedQuantities()).toBeTrue();
        expect(component.preventDuplicateChassis()).toBeFalse();
        expect(setOptionSpy.calls.allArgs()).toEqual([
            ['forceGenUseTaggedQuantities', true],
            ['forceGenPreventDuplicateChassis', false],
        ]);
    });

    it('renders the Multi-Era checkbox disabled for a single positive era selection', async () => {
        const fixture = TestBed.createComponent(SearchForceGeneratorDialogComponent);
        await fixture.whenStable();
        fixture.detectChanges();

        const checkbox = fixture.nativeElement.querySelector(
            '.dropdown-option-row .generator-option-inline input.bt-checkbox',
        ) as HTMLInputElement | null;

        expect(checkbox).not.toBeNull();
        expect(checkbox?.disabled).toBeTrue();
        expect(fixture.nativeElement.textContent).toContain('Multi-Era');
    });

    it('enables the Multi-Era checkbox when there are no positive era selections', async () => {
        advOptionsSignal.update((options) => ({
            ...options,
            era: {
                ...options.era,
                value: {},
            },
        }));

        const fixture = TestBed.createComponent(SearchForceGeneratorDialogComponent);
        await fixture.whenStable();
        fixture.detectChanges();

        const checkbox = fixture.nativeElement.querySelector(
            '.dropdown-option-row .generator-option-inline input.bt-checkbox',
        ) as HTMLInputElement | null;

        expect(checkbox).not.toBeNull();
        expect(checkbox?.disabled).toBeFalse();
    });

    it('clears the Multi-Era checkbox when era selection returns to a single positive value', async () => {
        advOptionsSignal.update((options) => ({
            ...options,
            era: {
                ...options.era,
                value: {
                    Jihad: {
                        name: 'Jihad',
                        state: 'and' as const,
                        count: 1,
                    },
                    'Succession Wars': {
                        name: 'Succession Wars',
                        state: 'or' as const,
                        count: 1,
                    },
                },
            },
        }));

        const fixture = TestBed.createComponent(SearchForceGeneratorDialogComponent);
        await fixture.whenStable();
        fixture.detectChanges();

        const checkbox = fixture.nativeElement.querySelector(
            '.dropdown-option-row .generator-option-inline input.bt-checkbox',
        ) as HTMLInputElement | null;

        if (!checkbox) {
            fail('Expected Multi-Era checkbox to be rendered.');
            return;
        }

        checkbox.click();
        fixture.detectChanges();
        expect(fixture.componentInstance.crossEraAvailabilityInMultiEraSelection()).toBeTrue();

        advOptionsSignal.update((options) => ({
            ...options,
            era: {
                ...options.era,
                value: {
                    Jihad: {
                        name: 'Jihad',
                        state: 'and' as const,
                        count: 1,
                    },
                },
            },
        }));
        fixture.detectChanges();

        expect(fixture.componentInstance.crossEraAvailabilityInMultiEraSelection()).toBeFalse();
        expect(checkbox.disabled).toBeTrue();
        expect(checkbox.checked).toBeFalse();
    });

    it('forwards the Multi-Era checkbox state into generation context resolution', () => {
        advOptionsSignal.update((options) => ({
            ...options,
            era: {
                ...options.era,
                value: {},
            },
        }));

        component.onCrossEraAvailabilityInMultiEraSelectionChange({
            target: { checked: true },
        } as unknown as Event);

        component.reroll();

        expect(resolveGenerationContextSpy).toHaveBeenCalledWith(
            [],
            jasmine.objectContaining({
                crossEraAvailabilityInMultiEraSelection: true,
                gameSystem: component.gameSystem(),
                targetFormationId: undefined,
                targetFormations: [],
            }),
        );
    });

    it('adds a generator-local Random option to the faction dropdown', () => {
        advOptionsSignal.update((options) => ({
            ...options,
            faction: {
                ...options.faction,
                options: [
                    { name: 'Federated Suns' },
                    { name: 'Lyran Alliance' },
                ],
            },
        }));

        const randomOption = component.targetFormationFactionOptions()[0];

        expect(randomOption).toEqual(jasmine.objectContaining({
            displayName: 'Random',
            img: '/images/random.svg',
            alwaysVisible: true,
            exclusive: true,
            stateCycle: ['or'],
        }));
    });

    it('keeps Random faction selection out of the real faction filter and forwards it to context resolution', () => {
        const randomOptionName = component.targetFormationFactionOptions()[0].name;

        component.onFactionSelectionChange({
            [randomOptionName]: {
                name: randomOptionName,
                state: 'or',
                count: 1,
            },
            'Federated Suns': {
                name: 'Federated Suns',
                state: 'or',
                count: 1,
            },
        });

        expect(component.randomFactionSelected()).toBeTrue();
        expect(component.selectedFactionValues()).toEqual({
            [randomOptionName]: {
                name: randomOptionName,
                state: 'or',
                count: 1,
            },
        });
        expect(setFilterSpy).toHaveBeenCalledOnceWith('faction', {});

        component.reroll();

        expect(resolveGenerationContextSpy).toHaveBeenCalledWith(
            [],
            jasmine.objectContaining({
                randomFaction: true,
                mergeSelectedFactionAvailability: true,
            }),
        );
    });

    it('does not filter faction-specific target formations while Random faction is selected', () => {
        advOptionsSignal.update((options) => ({
            ...options,
            faction: {
                ...options.faction,
                options: [
                    { name: 'Free Worlds League' },
                    { name: 'Federated Suns' },
                ],
            },
        }));
        const randomOptionName = component.targetFormationFactionOptions()[0].name;

        component.onFactionSelectionChange({
            [randomOptionName]: {
                name: randomOptionName,
                state: 'or',
                count: 1,
            },
        });

        const formationIds = new Set(component.targetFormationOptions().map((option) => option.name));

        expect(formationIds.has('anvil-lance')).toBeTrue();
        expect(formationIds.has('rifle-lance')).toBeTrue();
    });

    it('forwards disabled selected-faction availability merging to context resolution', () => {
        advOptionsSignal.update((options) => ({
            ...options,
            faction: {
                ...options.faction,
                options: [
                    { name: 'Federated Suns' },
                    { name: 'Lyran Alliance' },
                ],
                value: {
                    fs: { name: 'Federated Suns', state: 'or' as const, count: 1 },
                    la: { name: 'Lyran Alliance', state: 'or' as const, count: 1 },
                },
                interacted: true,
            },
        }));

        expect(component.selectedFactionAvailabilityMergeToggleVisible()).toBeTrue();

        component.onMergeSelectedFactionAvailabilityChange({
            target: { checked: false },
        } as unknown as Event);
        component.reroll();

        expect(resolveGenerationContextSpy).toHaveBeenCalledWith(
            [],
            jasmine.objectContaining({
                randomFaction: false,
                mergeSelectedFactionAvailability: false,
            }),
        );
    });


    it('disambiguates duplicate target formation names in the generator dropdown', () => {
        gameSystemSignal.set(GameSystem.ALPHA_STRIKE);

        const displayNameById = new Map(component.targetFormationOptions().map((option) => [
            option.name,
            option.displayName ?? option.name,
        ]));

        expect(displayNameById.get('fire-support-lance')).toBe('Fire Support');
        expect(displayNameById.get('fire-support-squadron')).toBe('Fire Support [Aero]');
        expect(displayNameById.get('interceptor-squadron')).toBe('Interceptor [Aero]');
    });

    it('limits faction dropdown availability by selected target formations in the generator dialog', () => {
        advOptionsSignal.update((options) => ({
            ...options,
            faction: {
                ...options.faction,
                options: [
                    { name: 'Free Worlds League' },
                    { name: 'Federated Suns' },
                    { name: 'Draconis Combine', available: false },
                ],
            },
        }));

        component.onTargetFormationSelectionChange({
            'anvil-lance': {
                name: 'anvil-lance',
                state: 'or',
                count: 1,
            },
        });

        const optionsByName = new Map(component.targetFormationFactionOptions().map((option) => [option.name, option]));

        expect(optionsByName.get('Free Worlds League')?.available).toBeTrue();
        expect(optionsByName.get('Federated Suns')?.available).toBeFalse();
        expect(optionsByName.get('Draconis Combine')?.available).toBeFalse();
        expect(getDropdownOptionsForFormationTargetSpy).toHaveBeenCalledWith(
            'faction',
            jasmine.objectContaining({ id: 'anvil-lance' }),
        );
    });

    it('uses formation-projected era dropdown availability in the generator dialog', () => {
        getDropdownOptionsForFormationTargetSpy.and.callFake((filterKey: string) => (
            filterKey === 'era'
                ? [
                    { name: 'Jihad', available: true },
                    { name: 'Succession Wars', available: false },
                    { name: 'Dark Age', available: false },
                ]
                : null
        ));

        component.onTargetFormationSelectionChange({
            'anvil-lance': {
                name: 'anvil-lance',
                state: 'or',
                count: 1,
            },
        });

        const optionsByName = new Map(component.targetFormationEraOptions().map((option) => [option.name, option]));

        expect(optionsByName.get('Jihad')?.available).toBeTrue();
        expect(optionsByName.get('Succession Wars')?.available).toBeFalse();
        expect(optionsByName.get('Dark Age')?.available).toBeFalse();
        expect(getDropdownOptionsForFormationTargetSpy).toHaveBeenCalledWith(
            'era',
            jasmine.objectContaining({ id: 'anvil-lance' }),
        );
    });

    it('keeps using the last committed budget range until the max field blurs', async () => {
        const fixture = TestBed.createComponent(SearchForceGeneratorDialogComponent);
        await fixture.whenStable();
        fixture.detectChanges();

        const dialog = fixture.componentInstance;
        const maxBudgetInput = fixture.nativeElement.querySelectorAll('thousands-integer-input input')[1] as HTMLInputElement;

        buildPreviewSpy.calls.reset();

        dialog.onBudgetMinChange({
            target: { value: '9000' },
        } as unknown as Event);
        fixture.detectChanges();

        maxBudgetInput.value = '9100';
        maxBudgetInput.dispatchEvent(new Event('input'));
        fixture.detectChanges();

        expect(buildPreviewSpy).not.toHaveBeenCalled();

        dialog.reroll();

        expect(buildPreviewSpy.calls.mostRecent().args[0].budgetRange).toEqual({ min: 9000, max: 9000 });

        maxBudgetInput.dispatchEvent(new Event('blur'));
        fixture.detectChanges();
        dialog.reroll();

        expect(buildPreviewSpy.calls.mostRecent().args[0].budgetRange).toEqual({ min: 9000, max: 9100 });
    });

    it('renders the duplicate-chassis checkbox in the dialog controls', async () => {
        const fixture = TestBed.createComponent(SearchForceGeneratorDialogComponent);
        await fixture.whenStable();
        fixture.detectChanges();

        const checkbox = fixture.nativeElement.querySelector('.generator-option input.bt-checkbox') as HTMLInputElement | null;

        expect(checkbox).not.toBeNull();
        expect(fixture.nativeElement.textContent).toContain('Prevent Duplicate Chassis');
        expect(fixture.nativeElement.textContent).toContain('Limit to tagged quantities');
    });

    it('includes the Multi-Era checkbox state in the submitted config', () => {
        const atlas = createEmptyUnit({
            id: 4,
            name: 'Atlas AS7-D',
            chassis: 'Atlas',
            model: 'AS7-D',
            bv: 1897,
        });

        advOptionsSignal.update((options) => ({
            ...options,
            era: {
                ...options.era,
                value: {},
            },
        }));
        component.onCrossEraAvailabilityInMultiEraSelectionChange({
            target: { checked: true },
        } as unknown as Event);

        (component as any).__test.setPreviewResult({
            gameSystem: GameSystem.CLASSIC,
            units: [{
                unit: atlas,
                cost: 1897,
                gunnery: 4,
                piloting: 5,
                lockKey: 'generated:0:Atlas AS7-D',
            }],
            totalCost: 1897,
            error: null,
            faction: null,
            era: null,
            explanationLines: [],
        });

        component.minUnitCount.set(1);
        component.maxUnitCount.set(1);
        component.classicBudgetMin.set(0);
        component.classicBudgetMax.set(0);
        component.reroll();
        component.submit();

        expect(dialogCloseSpy).toHaveBeenCalledTimes(1);
        expect(dialogCloseSpy.calls.mostRecent().args[0].config.crossEraAvailabilityInMultiEraSelection).toBeTrue();
    });

    it('includes tagged-quantity checkbox states in the submitted config', () => {
        const atlas = createEmptyUnit({
            id: 4,
            name: 'Atlas AS7-D',
            chassis: 'Atlas',
            model: 'AS7-D',
            bv: 1897,
        });

        component.onUseTaggedQuantitiesChange({
            target: { checked: true },
        } as unknown as Event);
        component.onUseUnitTagsAsChassisTagsChange({
            target: { checked: true },
        } as unknown as Event);

        (component as any).__test.setPreviewResult({
            gameSystem: GameSystem.CLASSIC,
            units: [{
                unit: atlas,
                cost: 1897,
                gunnery: 4,
                piloting: 5,
                lockKey: 'generated:0:Atlas AS7-D',
            }],
            totalCost: 1897,
            error: null,
            faction: null,
            era: null,
            explanationLines: [],
        });

        component.minUnitCount.set(1);
        component.maxUnitCount.set(1);
        component.classicBudgetMin.set(0);
        component.classicBudgetMax.set(0);
        component.reroll();
        component.submit();

        expect(dialogCloseSpy).toHaveBeenCalledTimes(1);
        expect(dialogCloseSpy.calls.mostRecent().args[0].config.useTaggedQuantities).toBeTrue();
        expect(dialogCloseSpy.calls.mostRecent().args[0].config.useUnitTagsAsChassisTags).toBeTrue();
    });

    it('renders pilot skill range controls and sends them to preview generation', async () => {
        const fixture = TestBed.createComponent(SearchForceGeneratorDialogComponent);
        await fixture.whenStable();
        fixture.detectChanges();

        const skillToggle = fixture.nativeElement.querySelector('.skill-settings-toggle') as HTMLButtonElement | null;
        expect(skillToggle).not.toBeNull();
        expect(fixture.nativeElement.querySelector('#force-generator-gunnery-skill')).toBeNull();

        skillToggle?.click();
        fixture.detectChanges();

        const classicText = fixture.nativeElement.textContent as string;
        const gunneryControl = fixture.nativeElement.querySelector('#force-generator-gunnery-skill') as HTMLElement | null;
        const pilotingControl = fixture.nativeElement.querySelector('#force-generator-piloting-skill') as HTMLElement | null;
        const deltaInput = fixture.nativeElement.querySelector('#force-generator-skill-delta') as HTMLInputElement | null;
        const deltaDescription = fixture.nativeElement.querySelector('.skill-delta-description') as HTMLElement | null;

        expect(classicText).toContain('Gunnery');
        expect(classicText).toContain('Piloting');
        expect(classicText).toContain('Max Delta');
        expect(gunneryControl).not.toBeNull();
        expect(pilotingControl).not.toBeNull();
        expect(deltaInput).not.toBeNull();
        expect(gunneryControl?.closest('.filter-row')).not.toBeNull();
        expect(pilotingControl?.closest('.filter-row')).not.toBeNull();
        expect(gunneryControl?.closest('.range')?.querySelector('.range-values')?.textContent).toContain('4~4');
        expect(pilotingControl?.closest('.range')?.querySelector('.range-values')?.textContent).toContain('5~5');
        expect(deltaDescription?.textContent?.trim()).toBe('Maximum allowed difference between generated Gunnery and Piloting.');
        expect(gunneryControl?.closest('.additional-filters-shell')).toBeNull();
        expect(pilotingControl?.closest('.additional-filters-shell')).toBeNull();
        expect(deltaInput?.closest('.additional-filters-shell')).toBeNull();

        if (!deltaInput) {
            fail('Expected max delta input to be rendered.');
            return;
        }

        fixture.componentInstance.onGunnerySkillRangeChange([3, 5]);
        fixture.componentInstance.onPilotingSkillRangeChange([4, 6]);
        deltaInput.value = '2';
        deltaInput.dispatchEvent(new Event('input'));
        fixture.detectChanges();

        expect(fixture.componentInstance.gunnerySkillRange()).toEqual([3, 5]);
        expect(fixture.componentInstance.pilotingSkillRange()).toEqual([4, 6]);
        expect(fixture.componentInstance.maxPilotSkillDelta()).toBe(2);
        expect(setOptionSpy).toHaveBeenCalledWith('forceGenLastGunnerySkillMin', 3);
        expect(setOptionSpy).toHaveBeenCalledWith('forceGenLastGunnerySkillMax', 5);
        expect(setOptionSpy).toHaveBeenCalledWith('forceGenLastPilotingSkillMin', 4);
        expect(setOptionSpy).toHaveBeenCalledWith('forceGenLastPilotingSkillMax', 6);
        expect(setOptionSpy).toHaveBeenCalledWith('forceGenLastMaxPilotSkillDelta', 2);

        fixture.componentInstance.reroll();

        expect(buildPreviewSpy.calls.mostRecent().args[0].skillRanges).toEqual({
            gunnery: { min: 3, max: 5 },
            piloting: { min: 4, max: 6 },
            maxDelta: 2,
        });

        fixture.componentInstance.setGameSystem(GameSystem.ALPHA_STRIKE);
        fixture.detectChanges();

        const alphaStrikeText = fixture.nativeElement.textContent as string;
        expect(alphaStrikeText).toContain('Pilot Skill');
        expect(fixture.nativeElement.querySelector('#force-generator-piloting-skill')).toBeNull();
        expect(fixture.nativeElement.querySelector('#force-generator-skill-delta')).toBeNull();
        expect(fixture.nativeElement.querySelector('.skill-delta-description')).toBeNull();
    });

    it('shows additional search filters behind an accordion without the force limit block', async () => {
        const fixture = TestBed.createComponent(SearchForceGeneratorDialogComponent);
        await fixture.whenStable();
        fixture.detectChanges();

        const toggle = fixture.nativeElement.querySelector('.additional-filters-toggle') as HTMLButtonElement | null;

        expect(toggle).not.toBeNull();
        expect(fixture.nativeElement.textContent).not.toContain('Force BV Limit');
        expect(fixture.nativeElement.querySelector('.additional-filters-panel')).toBeNull();

        toggle?.click();
        fixture.detectChanges();

        const panel = fixture.nativeElement.querySelector('.additional-filters-panel') as HTMLElement | null;
        const systemToggleDescription = fixture.nativeElement.querySelector('.adv-filter-system-toggle-description') as HTMLElement | null;

        expect(fixture.nativeElement.textContent).toContain('Additional Filters');
        expect(panel).not.toBeNull();
        expect(panel?.textContent).toContain('Tech');
        expect(systemToggleDescription?.textContent?.trim()).toBe(fixture.componentInstance.advPanelFilterGameSystemToggleTitle());
    });

    it('highlights skill values separately from advanced filters title', async () => {
        const fixture = TestBed.createComponent(SearchForceGeneratorDialogComponent);
        await fixture.whenStable();
        fixture.detectChanges();

        const title = fixture.nativeElement.querySelector('.additional-filters-title') as HTMLElement | null;
        const skillsTitle = fixture.nativeElement.querySelector('.skill-settings-title') as HTMLElement | null;

        expect(title?.classList.contains('active')).toBeFalse();
        expect(skillsTitle?.classList.contains('active')).toBeFalse();

        fixture.componentInstance.setPilotSkill('gunnery', 3);
        fixture.detectChanges();

        expect(title?.classList.contains('active')).toBeFalse();
        expect(skillsTitle?.classList.contains('active')).toBeTrue();

        fixture.componentInstance.setPilotSkill('gunnery', 4);
        effectiveFilterStateSignal.set({
            bv: {
                interactedWith: true,
            },
        });
        fixture.detectChanges();

        expect(title?.classList.contains('active')).toBeTrue();
        expect(skillsTitle?.classList.contains('active')).toBeFalse();
    });

    it('toggles preview units in and out of the locked set', () => {
        const atlas = createEmptyUnit({
            id: 1,
            name: 'Atlas AS7-D',
            chassis: 'Atlas',
            model: 'AS7-D',
            as: { PV: 6 },
        });
        (component as any).__test.setPreviewResult({
            gameSystem: GameSystem.ALPHA_STRIKE,
            units: [{
                unit: atlas,
                cost: 6,
                skill: 3,
                lockKey: 'generated:0:Atlas AS7-D',
            }],
            totalCost: 6,
            error: null,
            faction: null,
            era: null,
            explanationLines: [],
        });

        component.reroll();

        component.previewLockToggle({
            unit: atlas,
            destroyed: false,
            lockKey: 'generated:0:Atlas AS7-D',
        });
        expect(component.lockedUnitKeys().has('generated:0:Atlas AS7-D')).toBeTrue();

        component.previewLockToggle({
            unit: atlas,
            destroyed: false,
            lockKey: 'generated:0:Atlas AS7-D',
        });
        expect(component.lockedUnitKeys().has('generated:0:Atlas AS7-D')).toBeFalse();
    });

    it('changes a generated preview unit to a selected variant without rerolling', () => {
        const atlas = createEmptyUnit({
            id: 1,
            name: 'Atlas AS7-D',
            chassis: 'Atlas',
            model: 'AS7-D',
            bv: 1897,
            as: { PV: 54 },
        });
        const atlasVariant = createEmptyUnit({
            id: 2,
            name: 'Atlas AS7-K',
            chassis: 'Atlas',
            model: 'AS7-K',
            bv: 2200,
            as: { PV: 60 },
        });

        (component as any).__test.setPreviewResult({
            gameSystem: GameSystem.CLASSIC,
            units: [{
                unit: atlas,
                cost: 1897,
                gunnery: 3,
                piloting: 4,
                lockKey: 'generated:0:Atlas AS7-D',
            }],
            totalCost: 1897,
            error: null,
            faction: null,
            era: null,
            explanationLines: [],
        });

        component.reroll();
        buildPreviewSpy.calls.reset();
        component.previewVariantChange({
            unit: atlas,
            destroyed: false,
            gunnery: 3,
            piloting: 4,
            lockKey: 'generated:0:Atlas AS7-D',
        }, atlasVariant);

        const preview = component.preview();
        expect(buildPreviewSpy).not.toHaveBeenCalled();
        expect(preview.totalCost).toBe(2200);
        expect(preview.units).toEqual([
            jasmine.objectContaining({
                unit: atlasVariant,
                cost: 2200,
                gunnery: 3,
                piloting: 4,
                lockKey: 'generated:0:Atlas AS7-D',
            }),
        ]);
    });

    it('recomputes locked unit values when switching from Alpha Strike to Classic', () => {
        const atlas = createEmptyUnit({
            id: 1,
            name: 'Atlas AS7-D',
            chassis: 'Atlas',
            model: 'AS7-D',
            bv: 1897,
            as: { PV: 54 },
        });

        component.setGameSystem(GameSystem.ALPHA_STRIKE);
        (component as any).__test.setPreviewResult({
            gameSystem: GameSystem.ALPHA_STRIKE,
            units: [{
                unit: atlas,
                cost: 54,
                skill: 3,
                lockKey: 'generated:0:Atlas AS7-D',
            }],
            totalCost: 54,
            error: null,
            faction: null,
            era: null,
            explanationLines: [],
        });

        component.reroll();
        component.previewLockToggle({
            unit: atlas,
            destroyed: false,
            lockKey: 'generated:0:Atlas AS7-D',
        });

        buildPreviewSpy.calls.reset();
        component.setGameSystem(GameSystem.CLASSIC);
        const preview = component.preview();

        expect(buildPreviewSpy).not.toHaveBeenCalled();
        expect(preview.gameSystem).toBe(GameSystem.CLASSIC);
        expect(preview.units).toEqual([
            jasmine.objectContaining({
                lockKey: 'generated:0:Atlas AS7-D',
                cost: 1897,
                gunnery: 3,
                piloting: 5,
            }),
        ]);
    });

    it('recomputes locked unit values when switching from Classic to Alpha Strike', () => {
        const atlas = createEmptyUnit({
            id: 1,
            name: 'Atlas AS7-D',
            chassis: 'Atlas',
            model: 'AS7-D',
            bv: 1897,
            as: { PV: 54 },
        });

        (component as any).__test.setPreviewResult({
            gameSystem: GameSystem.CLASSIC,
            units: [{
                unit: atlas,
                cost: 1897,
                gunnery: 2,
                piloting: 3,
                lockKey: 'generated:0:Atlas AS7-D',
            }],
            totalCost: 1897,
            error: null,
            faction: null,
            era: null,
            explanationLines: [],
        });

        component.reroll();
        component.previewLockToggle({
            unit: atlas,
            destroyed: false,
            lockKey: 'generated:0:Atlas AS7-D',
        });

        buildPreviewSpy.calls.reset();
        component.setGameSystem(GameSystem.ALPHA_STRIKE);
        const preview = component.preview();

        expect(buildPreviewSpy).not.toHaveBeenCalled();
        expect(preview.gameSystem).toBe(GameSystem.ALPHA_STRIKE);
        expect(preview.units).toEqual([
            jasmine.objectContaining({
                lockKey: 'generated:0:Atlas AS7-D',
                cost: 54,
                skill: 2,
            }),
        ]);
    });

    it('does not regenerate the preview when a unit lock is toggled', () => {
        const atlas = createEmptyUnit({
            id: 1,
            name: 'Atlas AS7-D',
            chassis: 'Atlas',
            model: 'AS7-D',
            as: { PV: 6 },
        });

        (component as any).__test.setPreviewResult({
            gameSystem: GameSystem.ALPHA_STRIKE,
            units: [{
                unit: atlas,
                cost: 6,
                skill: 3,
                lockKey: 'generated:0:Atlas AS7-D',
            }],
            totalCost: 6,
            error: null,
            faction: null,
            era: null,
            explanationLines: [],
        });

        component.reroll();
        buildPreviewSpy.calls.reset();

        component.previewLockToggle({
            unit: atlas,
            destroyed: false,
            lockKey: 'generated:0:Atlas AS7-D',
        });
        component.preview();

        expect(component.lockedUnitKeys().has('generated:0:Atlas AS7-D')).toBeTrue();
        expect(buildPreviewSpy).not.toHaveBeenCalled();
    });
});
