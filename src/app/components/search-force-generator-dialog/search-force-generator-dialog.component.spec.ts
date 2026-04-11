import { DialogRef } from '@angular/cdk/dialog';
import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';

import { GameSystem } from '../../models/common.model';
import { SearchForceGeneratorDialogComponent } from './search-force-generator-dialog.component';
import { DataService } from '../../services/data.service';
import { ForceGeneratorService } from '../../services/force-generator.service';
import { GameService } from '../../services/game.service';
import { OptionsService } from '../../services/options.service';
import { UnitSearchFiltersService } from '../../services/unit-search-filters.service';

describe('SearchForceGeneratorDialogComponent', () => {
    let component: SearchForceGeneratorDialogComponent;
    let setOptionSpy: jasmine.Spy;
    let setFilterSpy: jasmine.Spy;

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

        TestBed.configureTestingModule({
            providers: [
                {
                    provide: DialogRef,
                    useValue: { close: jasmine.createSpy('close') },
                },
                {
                    provide: DataService,
                    useValue: {},
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
});