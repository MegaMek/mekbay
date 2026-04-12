import { DialogRef } from '@angular/cdk/dialog';
import { TestBed } from '@angular/core/testing';
import { signal, type WritableSignal } from '@angular/core';

import { GameSystem } from '../../models/common.model';
import type { LoadForceEntry } from '../../models/load-force-entry.model';
import type { Unit } from '../../models/units.model';
import { SearchForceGeneratorDialogComponent } from './search-force-generator-dialog.component';
import { DataService } from '../../services/data.service';
import { ForceBuilderService } from '../../services/force-builder.service';
import { ForceGeneratorService } from '../../services/force-generator.service';
import { GameService } from '../../services/game.service';
import { OptionsService } from '../../services/options.service';
import { DialogsService } from '../../services/dialogs.service';
import { UnitSearchFiltersService } from '../../services/unit-search-filters.service';

describe('SearchForceGeneratorDialogComponent', () => {
    let component: SearchForceGeneratorDialogComponent;
    let setOptionSpy: jasmine.Spy;
    let setFilterSpy: jasmine.Spy;
    let buildPreviewSpy: jasmine.Spy;
    let resolveInitialBudgetDefaultsSpy: jasmine.Spy;
    let filteredUnitsSignal: WritableSignal<Unit[]>;
    let forceGeneratorEligibleUnitsSignal: WritableSignal<Unit[]>;
    let gameSystemSignal: WritableSignal<GameSystem>;

    beforeEach(() => {
        const optionsSignal = signal({
            availabilitySource: 'mul',
            forceGenLastBVMin: 7900,
            forceGenLastBVMax: 8000,
            forceGenLastPVMin: 290,
            forceGenLastPVMax: 300,
            forceGenLastMinUnitCount: 4,
            forceGenLastMaxUnitCount: 8,
        });

        setOptionSpy = jasmine.createSpy('setOption').and.callFake((key: string, value: number) => {
            optionsSignal.update((options) => ({ ...options, [key]: value }));
            return Promise.resolve();
        });

        setFilterSpy = jasmine.createSpy('setFilter');
        const advOptionsSignal = signal({
            era: {
                type: 'dropdown' as const,
                label: 'Era',
                options: [],
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

        const currentForceSignal = signal<any>(null);
        filteredUnitsSignal = signal<Unit[]>([]);
        forceGeneratorEligibleUnitsSignal = signal<Unit[]>([]);
        const unitsByName = new Map<string, Unit>();
        const dataServiceMock = {
            isDataReady: signal(true),
            getUnitByName: jasmine.createSpy('getUnitByName').and.callFake((name: string) => unitsByName.get(name)),
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
        resolveInitialBudgetDefaultsSpy = jasmine.createSpy('resolveInitialBudgetDefaults').and.returnValue({
            classic: { min: 7900, max: 8000 },
            alphaStrike: { min: 290, max: 300 },
        });

        gameSystemSignal = signal(GameSystem.CLASSIC);

        TestBed.configureTestingModule({
            providers: [
                {
                    provide: DialogRef,
                    useValue: { close: jasmine.createSpy('close') },
                },
                {
                    provide: DataService,
                    useValue: dataServiceMock,
                },
                {
                    provide: ForceGeneratorService,
                    useValue: {
                        resolveInitialBudgetDefaults: resolveInitialBudgetDefaultsSpy,
                        resolveInitialUnitCountDefaults: () => ({ min: 4, max: 8 }),
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
                        resolveGenerationContext: () => ({
                            forceFaction: null,
                            forceEra: null,
                            averagingFactionIds: [],
                            averagingEraIds: [],
                            availablePairCount: 0,
                            ruleset: null,
                        }),
                        buildPreview: buildPreviewSpy,
                        createForceEntry: jasmine.createSpy('createForceEntry').and.callFake((preview: any) => {
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
                        }),
                        getBudgetMetric: (unit: Unit, gameSystem: GameSystem) => {
                            return gameSystem === GameSystem.ALPHA_STRIKE ? unit.as?.PV ?? 0 : unit.bv ?? 0;
                        },
                    },
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
                        effectiveFilterState: signal({}),
                        filteredUnits: filteredUnitsSignal,
                        forceGeneratorEligibleUnits: forceGeneratorEligibleUnitsSignal,
                        isComplexQuery: signal(false),
                        pilotGunnerySkill: signal(4),
                        pilotPilotingSkill: signal(5),
                        searchText: signal(''),
                        setFilter: setFilterSpy,
                        unsetFilter: jasmine.createSpy('unsetFilter'),
                    },
                },
            ],
        });

        component = TestBed.runInInjectionContext(() => new SearchForceGeneratorDialogComponent());

        Object.assign(component, {
            __test: {
                currentForceSignal,
                unitsByName,
                setPreviewResult(nextPreviewResult: typeof previewResult) {
                    previewResult = nextPreviewResult;
                },
            },
        });

        buildPreviewSpy.calls.reset();
    });

    it('builds an initial preview when the dialog opens', () => {
        TestBed.runInInjectionContext(() => new SearchForceGeneratorDialogComponent());

        expect(buildPreviewSpy).toHaveBeenCalled();
    });

    it('ignores the unit-search budget limit when initializing generator defaults', () => {
        expect(resolveInitialBudgetDefaultsSpy.calls.mostRecent().args[1]).toBe(0);
        expect(resolveInitialBudgetDefaultsSpy.calls.mostRecent().args[2]).toBe(GameSystem.CLASSIC);
    });

    it('uses uncapped force-generator eligible units for preview requests', () => {
        const limitedUnit = {
            id: 1,
            name: 'Limited Unit',
            chassis: 'Limited',
            model: 'Prime',
            as: { PV: 25 },
        } as Unit;
        const extraEligibleUnit = {
            id: 2,
            name: 'Extra Eligible Unit',
            chassis: 'Extra',
            model: 'Prime',
            as: { PV: 40 },
        } as Unit;

        filteredUnitsSignal.set([limitedUnit]);
        forceGeneratorEligibleUnitsSignal.set([limitedUnit, extraEligibleUnit]);

        component.reroll();

        expect(component.eligibleUnits()).toEqual([limitedUnit, extraEligibleUnit]);
        expect(buildPreviewSpy.calls.mostRecent().args[0].eligibleUnits).toEqual([limitedUnit, extraEligibleUnit]);
    });

    it('snaps the max units input back to the clamped maximum on blur', () => {
        const input = document.createElement('input');
        input.value = '1003';
        const event = { target: input } as unknown as Event;

        component.onMaxUnitCountChange(event);

        expect(component.maxUnitCount()).toBe(100);
        expect(setOptionSpy).toHaveBeenCalledWith('forceGenLastMaxUnitCount', 100);
        expect(input.value).toBe('1003');

        component.onMaxUnitCountBlur(event);

        expect(input.value).toBe('100');
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

    it('keeps shared filter mappings stable when the generator mode changes locally', () => {
        component.setGameSystem(GameSystem.ALPHA_STRIKE);

        expect(component.gameSystem()).toBe(GameSystem.ALPHA_STRIKE);
        expect(gameSystemSignal()).toBe(GameSystem.CLASSIC);
        expect(component.selectedUnitTypeValues()).toEqual(['Mek']);
        expect(component.selectedSubtypeValues()).toEqual(['BattleMek']);

        component.onUnitTypeSelectionChange(['Tank']);

        expect(setFilterSpy).toHaveBeenCalledWith('type', ['Tank']);
    });

    it('uses the local generator mode for preview requests without changing the global game system', () => {
        component.setGameSystem(GameSystem.ALPHA_STRIKE);

        component.reroll();

        expect(buildPreviewSpy.calls.mostRecent().args[0].gameSystem).toBe(GameSystem.ALPHA_STRIKE);
        expect(gameSystemSignal()).toBe(GameSystem.CLASSIC);
    });

    it('imports the current force into the locked preview without rerolling', () => {
        const atlas = {
            id: 1,
            name: 'Atlas AS7-D',
            chassis: 'Atlas',
            model: 'AS7-D',
            as: { PV: 6 },
        } as Unit;
        const locust = {
            id: 2,
            name: 'Locust LCT-1V',
            chassis: 'Locust',
            model: 'LCT-1V',
            as: { PV: 4 },
        } as Unit;
        const testState = (component as any).__test;
        testState.unitsByName.set(atlas.name, atlas);
        testState.unitsByName.set(locust.name, locust);
        testState.currentForceSignal.set({
            units: () => [{}, {}],
            serialize: () => ({
                version: 1,
                timestamp: '2026-04-11T00:00:00.000Z',
                instanceId: 'force-1',
                type: GameSystem.ALPHA_STRIKE,
                name: 'Current Force',
                groups: [{
                    id: 'group-1',
                    units: [
                        {
                            id: 'u-1',
                            unit: atlas.name,
                            state: { modified: false, destroyed: false, shutdown: false },
                            skill: 3,
                            abilities: [],
                        },
                        {
                            id: 'u-2',
                            unit: locust.name,
                            state: { modified: false, destroyed: false, shutdown: false },
                            skill: 4,
                            abilities: [],
                        },
                    ],
                }],
            }),
        });

        component.importCurrentForce();
        const preview = component.preview();

        expect(component.canImportCurrentForce()).toBeTrue();
        expect(component.lockedUnitKeys().size).toBe(2);
        expect(component.lockedUnitKeys().has('u-1')).toBeTrue();
        expect(component.lockedUnitKeys().has('u-2')).toBeTrue();
        expect(preview.units.map((unit) => unit.unit.name)).toEqual([atlas.name, locust.name]);
        expect(preview.units.map((unit) => unit.lockKey)).toEqual(['u-1', 'u-2']);
        expect(preview.explanationLines).toContain('Imported current force into preview. Press REROLL to generate a new result for the current settings.');
        expect(buildPreviewSpy).not.toHaveBeenCalled();
    });

    it('clears the hovered radar overlay when rerolling a new preview', () => {
        const atlas = {
            id: 3,
            name: 'Atlas AS7-D',
            chassis: 'Atlas',
            model: 'AS7-D',
        } as Unit;

        component.onPreviewUnitHover({
            unit: atlas,
            destroyed: false,
        });

        expect(component.hoveredRadarUnit()).toBe(atlas);

        component.reroll();

        expect(component.hoveredRadarUnit()).toBeNull();
    });

    it('forwards the duplicate-chassis checkbox state into the preview request', () => {
        component.onPreventDuplicateChassisChange({
            target: { checked: true },
        } as unknown as Event);

        expect(buildPreviewSpy).not.toHaveBeenCalled();

        component.reroll();

        expect(buildPreviewSpy.calls.mostRecent().args[0].preventDuplicateChassis).toBeTrue();
    });

    it('does not regenerate while budget inputs are edited', () => {
        component.onBudgetMinChange({
            target: { value: '9000' },
        } as unknown as Event);
        component.onBudgetMaxChange({
            target: { value: '9100' },
        } as unknown as Event);

        expect(buildPreviewSpy).not.toHaveBeenCalled();

        component.reroll();

        expect(buildPreviewSpy.calls.mostRecent().args[0].budgetRange).toEqual({ min: 9000, max: 9100 });
    });

    it('renders the duplicate-chassis checkbox in the dialog controls', async () => {
        const fixture = TestBed.createComponent(SearchForceGeneratorDialogComponent);
        await fixture.whenStable();
        fixture.detectChanges();

        const checkbox = fixture.nativeElement.querySelector('.generator-option input.bt-checkbox') as HTMLInputElement | null;

        expect(checkbox).not.toBeNull();
        expect(fixture.nativeElement.textContent).toContain('Prevent Duplicate Chassis');
    });

    it('shows additional search filters behind an accordion without the force limit block', async () => {
        const fixture = TestBed.createComponent(SearchForceGeneratorDialogComponent);
        await fixture.whenStable();
        fixture.detectChanges();

        const toggle = fixture.nativeElement.querySelector('.additional-filters-toggle') as HTMLButtonElement | null;

        expect(toggle).not.toBeNull();
        expect(fixture.nativeElement.textContent).not.toContain('Force BV Limit');

        toggle?.click();
        fixture.detectChanges();

        expect(fixture.nativeElement.textContent).toContain('Additional Search Filters');
        expect(fixture.nativeElement.textContent).toContain('Tech');
    });

    it('toggles preview units in and out of the locked set', () => {
        const atlas = {
            id: 1,
            name: 'Atlas AS7-D',
            chassis: 'Atlas',
            model: 'AS7-D',
            as: { PV: 6 },
        } as Unit;
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

    it('recomputes locked unit values when switching from Alpha Strike to Classic', () => {
        const atlas = {
            id: 1,
            name: 'Atlas AS7-D',
            chassis: 'Atlas',
            model: 'AS7-D',
            bv: 1897,
            as: { PV: 54 },
        } as Unit;

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
        const atlas = {
            id: 1,
            name: 'Atlas AS7-D',
            chassis: 'Atlas',
            model: 'AS7-D',
            bv: 1897,
            as: { PV: 54 },
        } as Unit;

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
        const atlas = {
            id: 1,
            name: 'Atlas AS7-D',
            chassis: 'Atlas',
            model: 'AS7-D',
            as: { PV: 6 },
        } as Unit;

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