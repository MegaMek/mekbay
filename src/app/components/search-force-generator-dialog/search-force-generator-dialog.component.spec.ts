import { DialogRef } from '@angular/cdk/dialog';
import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';

import { GameSystem } from '../../models/common.model';
import type { LoadForceEntry } from '../../models/load-force-entry.model';
import type { Unit } from '../../models/units.model';
import { SearchForceGeneratorDialogComponent } from './search-force-generator-dialog.component';
import { DataService } from '../../services/data.service';
import { ForceBuilderService } from '../../services/force-builder.service';
import { ForceGeneratorService } from '../../services/force-generator.service';
import { GameService } from '../../services/game.service';
import { OptionsService } from '../../services/options.service';
import { UnitSearchFiltersService } from '../../services/unit-search-filters.service';

describe('SearchForceGeneratorDialogComponent', () => {
    let component: SearchForceGeneratorDialogComponent;
    let setOptionSpy: jasmine.Spy;
    let setFilterSpy: jasmine.Spy;
    let buildPreviewSpy: jasmine.Spy;

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
        });

        const currentForceSignal = signal<any>(null);
        const unitsByName = new Map<string, Unit>();
        const dataServiceMock = {
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
                        resolveInitialBudgetDefaults: () => ({
                            classic: { min: 7900, max: 8000 },
                            alphaStrike: { min: 290, max: 300 },
                        }),
                        resolveInitialUnitCountDefaults: () => ({ min: 4, max: 8 }),
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
                        currentGameSystem: signal(GameSystem.CLASSIC),
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
                    provide: UnitSearchFiltersService,
                    useValue: {
                        advOptions: advOptionsSignal,
                        bvPvLimit: signal(0),
                        filteredUnits: signal([]),
                        pilotGunnerySkill: signal(4),
                        pilotPilotingSkill: signal(5),
                        searchText: signal(''),
                        setFilter: setFilterSpy,
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

    it('imports the current force without regenerating immediately and uses those locks on reroll', () => {
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

        component.preview();
        buildPreviewSpy.calls.reset();

        component.importCurrentForce();

        expect(component.canImportCurrentForce()).toBeTrue();
        expect(component.lockedUnitKeys().size).toBe(2);
        expect(component.lockedUnitKeys().has('u-1')).toBeTrue();
        expect(component.lockedUnitKeys().has('u-2')).toBeTrue();
        expect(buildPreviewSpy).not.toHaveBeenCalled();

        component.reroll();
        component.preview();

        const request = buildPreviewSpy.calls.mostRecent().args[0];
        expect(request.lockedUnits.map((unit: { lockKey: string }) => unit.lockKey)).toEqual(['u-1', 'u-2']);
    });

    it('forwards the duplicate-chassis checkbox state into the preview request', () => {
        buildPreviewSpy.calls.reset();

        component.onPreventDuplicateChassisChange({
            target: { checked: true },
        } as unknown as Event);
        component.preview();

        expect(buildPreviewSpy.calls.mostRecent().args[0].preventDuplicateChassis).toBeTrue();
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

        component.preview();
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