import { CommonModule } from '@angular/common';
import { CdkVirtualScrollViewport, ScrollingModule } from '@angular/cdk/scrolling';
import { Overlay } from '@angular/cdk/overlay';
import { Dialog } from '@angular/cdk/dialog';
import { computed, provideZonelessChangeDetection, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { NEVER, Subject, of } from 'rxjs';
import { GameSystem } from '../../models/common.model';
import { MEGAMEK_AVAILABILITY_UNKNOWN_SCORE } from '../../models/megamek/availability.model';
import type { Unit } from '../../models/units.model';
import { AsAbilityLookupService } from '../../services/as-ability-lookup.service';
import { DataService } from '../../services/data.service';
import { DialogsService } from '../../services/dialogs.service';
import { ForceBuilderService } from '../../services/force-builder.service';
import { GameService } from '../../services/game.service';
import { LayoutService } from '../../services/layout.service';
import { LongPressDirective } from '../../directives/long-press.directive';
import { OptionsService } from '../../services/options.service';
import { OverlayManagerService } from '../../services/overlay-manager.service';
import { SavedSearchesService } from '../../services/saved-searches.service';
import { TaggingService } from '../../services/tagging.service';
import { MEGAMEK_RARITY_PRODUCTION_SORT_KEY } from '../../services/unit-search-filters.model';
import { UnitSearchFiltersService } from '../../services/unit-search-filters.service';
import { createEmptyUnit, type TestUnitOverrides } from '../../testing/unit-test-helpers';
import { UnitCardExpandedComponent } from '../unit-card-expanded/unit-card-expanded.component';
import { calculateDataTableMinWidth } from '../data-table/data-table.component';
import { UnitSearchComponent } from './unit-search.component';

describe('UnitSearchComponent card virtualization', () => {
    const filteredUnitsSignal = signal<Unit[]>([]);
    const currentGameSystemSignal = signal(GameSystem.ALPHA_STRIKE);
    const closePanelsRequestSignal = signal({ requestId: 0, exitExpandedView: false });
    const isSearchSettledSignal = signal(true);
    const advOptionsSignal = signal<Record<string, any>>({});
    const budgetModeSignal = signal<'force-limit' | 'bv-normalization' | null>(null);
    let openDialogs: unknown[];
    const optionsSignal = signal({
        ASUseHex: false,
        colorScheme: 'default' as const,
        availabilitySource: 'mul' as 'mul' | 'megamek',
        unitSearchExpandedViewLayout: 'panel-list-filters',
        unitSearchViewMode: 'list' as 'list' | 'card' | 'chassis' | 'table',
    });

    const filtersServiceStub = {
        dropdownConfigs: computed(() => []),
        rangeConfigs: computed(() => []),
        expandedView: signal(false),
        advOpen: signal(false),
        searchText: signal(''),
        pilotGunnerySkill: signal(4),
        pilotPilotingSkill: signal(5),
        budgetMode: budgetModeSignal,
        activeBvNormalization: computed(() => budgetModeSignal() === 'bv-normalization'),
        classicBvNormalizationSettings: signal({
            targetBv: { min: 0, max: 999_999 },
            gunnery: { min: 0, max: 8 },
            piloting: { min: 0, max: 8 },
            maxDelta: 8,
        }),
        bvPvLimit: signal(0),
        forceTotalBvPv: signal(0),
        selectedSort: signal('name'),
        selectedSortDirection: signal<'asc' | 'desc'>('asc'),
        viewMode: signal<'list' | 'card' | 'chassis' | 'table'>('list'),
        closePanelsRequest: closePanelsRequestSignal,
        filteredUnits: () => filteredUnitsSignal(),
        isSearchSettled: () => isSearchSettledSignal(),
        isDataReady: () => true,
        searchTokens: () => [],
        isComplexQuery: () => false,
        filterState: () => ({}),
        advOptions: () => advOptionsSignal(),
        resetFilters: jasmine.createSpy('resetFilters'),
        setSearchText: jasmine.createSpy('setSearchText'),
        setSortDirection: jasmine.createSpy('setSortDirection'),
        setSortOrder: jasmine.createSpy('setSortOrder'),
        setViewMode: jasmine.createSpy('setViewMode').and.callFake((viewMode: 'list' | 'card' | 'chassis' | 'table') => {
            filtersServiceStub.viewMode.set(viewMode);
        }),
        setFilter: jasmine.createSpy('setFilter'),
        unsetFilter: jasmine.createSpy('unsetFilter'),
        setPilotSkills: jasmine.createSpy('setPilotSkills'),
        setBudgetMode: jasmine.createSpy('setBudgetMode').and.callFake((mode: 'force-limit' | 'bv-normalization' | null) => {
            filtersServiceStub.budgetMode.set(mode);
        }),
        setBvNormalizationSettings: jasmine.createSpy('setBvNormalizationSettings').and.callFake((settings: any) => {
            filtersServiceStub.classicBvNormalizationSettings.set(settings);
        }),
        requestClosePanels: jasmine.createSpy('requestClosePanels').and.callFake((options?: { exitExpandedView?: boolean }) => {
            const currentRequest = closePanelsRequestSignal();
            closePanelsRequestSignal.set({
                requestId: currentRequest.requestId + 1,
                exitExpandedView: !!options?.exitExpandedView,
            });
        }),
        getMegaMekAvailabilityBadges: jasmine.createSpy('getMegaMekAvailabilityBadges').and.returnValue([]),
        getMegaMekRaritySortScore: jasmine.createSpy('getMegaMekRaritySortScore').and.returnValue(0),
        getSearchResultPilotContext: jasmine.createSpy('getSearchResultPilotContext'),
    };

    const layoutServiceStub = {
        windowWidth: signal(1280),
        windowHeight: signal(900),
        isMobile: signal(false),
        getSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
    };

    const forceBuilderServiceStub = {
        smartCurrentForce: () => null,
        hasForces: () => false,
        addUnit: jasmine.createSpy('addUnit').and.resolveTo(true),
    };

    const gameServiceStub = {
        isAlphaStrike: computed(() => currentGameSystemSignal() === GameSystem.ALPHA_STRIKE),
        currentGameSystem: currentGameSystemSignal,
    };

    const optionsServiceStub = {
        options: () => optionsSignal(),
        setOption: jasmine.createSpy('setOption').and.resolveTo(undefined),
    };

    const savedSearchesServiceStub = {
        version: signal(0),
    };

    const overlayManagerServiceStub = {
        has: () => false,
        closeAllManagedOverlays: jasmine.createSpy('closeAllManagedOverlays'),
        closeManagedOverlay: jasmine.createSpy('closeManagedOverlay'),
        createManagedOverlay: jasmine.createSpy('createManagedOverlay'),
        blockCloseUntil: jasmine.createSpy('blockCloseUntil'),
        unblockClose: jasmine.createSpy('unblockClose'),
    };

    const dialogsServiceStub = {
        createDialog: jasmine.createSpy('createDialog'),
    };

    const overlayStub = {
        scrollStrategies: {
            reposition: () => ({}),
        },
    };

    const dataServiceStub = {
        getUnitByName: jasmine.createSpy('getUnitByName').and.returnValue(undefined),
    };

    const taggingServiceStub = {
        openTagSelector: jasmine.createSpy('openTagSelector').and.resolveTo(undefined),
    };

    const abilityLookupServiceStub = {
        parseAbility: jasmine.createSpy('parseAbility').and.returnValue(null),
    };

    function createUnit(name: string, overrides: TestUnitOverrides = {}): Unit {
        return createEmptyUnit({ name, ...overrides, as: { PV: 1, ...overrides.as } });
    }

    function dispatchWindowKey(key: string): KeyboardEvent {
        const event = new KeyboardEvent('keydown', {
            key,
            bubbles: true,
            cancelable: true,
        });
        window.dispatchEvent(event);
        return event;
    }

    beforeEach(async () => {
        openDialogs = [];
        filteredUnitsSignal.set([]);
        optionsSignal.set({
            ASUseHex: false,
            colorScheme: 'default',
            availabilitySource: 'mul',
            unitSearchExpandedViewLayout: 'panel-list-filters',
            unitSearchViewMode: 'list',
        });
        filtersServiceStub.expandedView.set(false);
        filtersServiceStub.advOpen.set(false);
        filtersServiceStub.searchText.set('');
        advOptionsSignal.set({});
        isSearchSettledSignal.set(true);
        filtersServiceStub.budgetMode.set(null);
        filtersServiceStub.classicBvNormalizationSettings.set({
            targetBv: { min: 0, max: 999_999 },
            gunnery: { min: 0, max: 8 },
            piloting: { min: 0, max: 8 },
            maxDelta: 8,
        });
        filtersServiceStub.bvPvLimit.set(0);
        filtersServiceStub.selectedSort.set('name');
        filtersServiceStub.selectedSortDirection.set('asc');
        filtersServiceStub.viewMode.set('list');
        closePanelsRequestSignal.set({ requestId: 0, exitExpandedView: false });
        filtersServiceStub.requestClosePanels.calls.reset();
        filtersServiceStub.setSearchText.calls.reset();
        filtersServiceStub.setSortDirection.calls.reset();
        filtersServiceStub.setSortOrder.calls.reset();
        filtersServiceStub.setViewMode.calls.reset();
        filtersServiceStub.setFilter.calls.reset();
        filtersServiceStub.unsetFilter.calls.reset();
        filtersServiceStub.setBudgetMode.calls.reset();
        filtersServiceStub.setBvNormalizationSettings.calls.reset();
        forceBuilderServiceStub.addUnit.calls.reset();
        forceBuilderServiceStub.addUnit.and.resolveTo(true);
        dataServiceStub.getUnitByName.calls.reset();
        dataServiceStub.getUnitByName.and.returnValue(undefined);
        filtersServiceStub.setSearchText.and.callFake((text: string) => {
            filtersServiceStub.searchText.set(text);
            return text;
        });
        filtersServiceStub.getMegaMekAvailabilityBadges.and.returnValue([]);
        filtersServiceStub.getMegaMekRaritySortScore.and.returnValue(0);
        filtersServiceStub.getSearchResultPilotContext.calls.reset();
        filtersServiceStub.getSearchResultPilotContext.and.callFake((unit: Unit) => ({
            adjustedBv: unit.bv,
            gunnery: filtersServiceStub.pilotGunnerySkill(),
            piloting: filtersServiceStub.pilotPilotingSkill(),
        }));
        dialogsServiceStub.createDialog.calls.reset();
        dialogsServiceStub.createDialog.and.returnValue(undefined);
        overlayManagerServiceStub.closeAllManagedOverlays.calls.reset();
        overlayManagerServiceStub.closeManagedOverlay.calls.reset();
        layoutServiceStub.windowWidth.set(1280);
        layoutServiceStub.windowHeight.set(900);
        savedSearchesServiceStub.version.set(0);
        currentGameSystemSignal.set(GameSystem.ALPHA_STRIKE);

        await TestBed.configureTestingModule({
            imports: [UnitSearchComponent],
            providers: [
                provideZonelessChangeDetection(),
                { provide: UnitSearchFiltersService, useValue: filtersServiceStub },
                { provide: LayoutService, useValue: layoutServiceStub },
                { provide: ForceBuilderService, useValue: forceBuilderServiceStub },
                { provide: GameService, useValue: gameServiceStub },
                { provide: OptionsService, useValue: optionsServiceStub },
                { provide: SavedSearchesService, useValue: savedSearchesServiceStub },
                { provide: OverlayManagerService, useValue: overlayManagerServiceStub },
                { provide: DialogsService, useValue: dialogsServiceStub },
                { provide: Dialog, useValue: { openDialogs } },
                { provide: Overlay, useValue: overlayStub },
                { provide: DataService, useValue: dataServiceStub },
                { provide: TaggingService, useValue: taggingServiceStub },
                { provide: AsAbilityLookupService, useValue: abilityLookupServiceStub },
            ],
        })
            .overrideComponent(UnitSearchComponent, {
                set: {
                    imports: [CommonModule, ScrollingModule, LongPressDirective, UnitCardExpandedComponent],
                    template: `
                        <div #resultsDropdown class="results-dropdown" style="width: 920px;" [hidden]="!resultsVisible()">
                            @if (viewMode() === 'card' && gameService.isAlphaStrike()) {
                            <cdk-virtual-scroll-viewport
                                class="results-dropdown-viewport card-view-viewport"
                                [itemSize]="itemSize()"
                                [style.--card-columns]="cardViewColumnCount()"
                                style="height: 640px;">
                                <div class="card-view-row"
                                    *cdkVirtualFor="let row of cardViewRows(); let rowIndex = index; trackBy: trackCardRow">
                                    @for (unit of row; let columnIndex = $index; track unit.name) {
                                    <div class="card-view-cell" [class.active]="activeIndex() === getCardUnitIndex(rowIndex, columnIndex)">
                                        {{ unit.name }}
                                    </div>
                                    }
                                </div>
                            </cdk-virtual-scroll-viewport>
                            }
                            @if (showInlinePanel()) {
                            <div class="inline-panel-unit">{{ inlinePanelUnit()?.name }}</div>
                            }
                            @if (expandedView()) {
                            @for (unit of displayedUnits(); track unit.name) {
                            <unit-card-expanded class="click-result"
                                longPress
                                [unit]="unit"
                                [expandedView]="true"
                                (shortPress)="onUnitCardClick(unit, $event)">
                            </unit-card-expanded>
                            }
                            }
                            <ng-template #tableIconCell let-unit>{{ unit.name }}</ng-template>
                            <ng-template #tableNameCell let-unit>{{ unit.name }}</ng-template>
                            <ng-template #tableYearCell let-unit>{{ unit.year }}</ng-template>
                            <ng-template #tableBvCell let-unit>{{ unit.bv }}</ng-template>
                            <ng-template #tableTonsCell let-unit>{{ unit.tons }}</ng-template>
                            <ng-template #tableClassicMovementCell let-unit>{{ unit.walk }}</ng-template>
                            <ng-template #tableTagsCell let-unit>{{ unit.name }}</ng-template>
                        </div>
                    `,
                },
            })
            .compileComponents();
    });

    it('groups card-mode results into width-derived virtual rows', () => {
        const fixture = TestBed.createComponent(UnitSearchComponent);
        const component = fixture.componentInstance;

        filteredUnitsSignal.set([
            createUnit('Unit 1'),
            createUnit('Unit 2'),
            createUnit('Unit 3'),
            createUnit('Unit 4'),
            createUnit('Unit 5'),
        ]);
        (component as any).resultsDropdownWidth.set(920);
        fixture.detectChanges();

        expect(component.cardViewColumnCount()).toBe(3);
        expect(component.cardViewRows().map(row => row.map(unit => unit.name))).toEqual([
            ['Unit 1', 'Unit 2', 'Unit 3'],
            ['Unit 4', 'Unit 5'],
        ]);
    });

    it('keeps the compact list estimate independent of expanded natural row heights', () => {
        const fixture = TestBed.createComponent(UnitSearchComponent);
        const component = fixture.componentInstance;
        fixture.detectChanges();

        expect(component.itemSize()).toBe(75);

        filtersServiceStub.expandedView.set(true);
        fixture.detectChanges();

        expect(component.itemSize()).toBe(75);
        expect(component.displayedUnitKeys()).toEqual([]);
    });

    it('shows normalized Gunnery/Piloting immediately after BV in the Classic table', () => {
        const fixture = TestBed.createComponent(UnitSearchComponent);
        const component = fixture.componentInstance;
        const unit = createUnit('Normalized Unit');
        currentGameSystemSignal.set(GameSystem.CLASSIC);
        filtersServiceStub.budgetMode.set('bv-normalization');
        filtersServiceStub.getSearchResultPilotContext.and.returnValue({ adjustedBv: 1234, gunnery: 3, piloting: 6 });
        fixture.detectChanges();

        const columns = component.unitSearchTableColumns();
        const bvIndex = columns.findIndex(column => column.id === 'bv');
        const bvColumn = columns[bvIndex];
        const skillsColumn = columns[bvIndex + 1];

        expect(bvColumn.cellTemplate).toBeDefined();
        expect(bvColumn.track).toBe(128);
        expect(skillsColumn.id).toBe('normalized-skills');
        expect(skillsColumn.header).toBe('G/P');
        expect(skillsColumn.value?.(unit, 0)).toBe('3/6');
        expect(skillsColumn.cellTone).toBe('focus');
        expect(calculateDataTableMinWidth(columns)).toBe(2294);
    });

    it('omits the Gunnery/Piloting column when BV normalization is inactive', () => {
        const fixture = TestBed.createComponent(UnitSearchComponent);
        const component = fixture.componentInstance;
        currentGameSystemSignal.set(GameSystem.CLASSIC);
        filtersServiceStub.budgetMode.set(null);
        fixture.detectChanges();

        const columns = component.unitSearchTableColumns();
        expect(columns.find(column => column.id === 'bv')?.track).toBe(78);
        expect(columns.some(column => column.id === 'normalized-skills')).toBeFalse();
        expect(calculateDataTableMinWidth(columns)).toBe(2180);
    });

    it('provides stable unit keys for variable-height measurements across result objects', () => {
        const fixture = TestBed.createComponent(UnitSearchComponent);
        const component = fixture.componentInstance;
        filteredUnitsSignal.set([createUnit('Short'), createUnit('Tall')]);
        fixture.detectChanges();

        expect(component.displayedUnitKeys()).toEqual(['Short', 'Tall']);

        filteredUnitsSignal.set([createUnit('Tall'), createUnit('Short')]);
        fixture.detectChanges();

        expect(component.displayedUnitKeys()).toEqual(['Tall', 'Short']);
    });

    it('removes selected units that are no longer displayed', () => {
        const fixture = TestBed.createComponent(UnitSearchComponent);
        const component = fixture.componentInstance;
        filteredUnitsSignal.set([createUnit('Visible'), createUnit('Removed')]);
        fixture.detectChanges();
        component.selectedUnits.set(new Set(['Visible', 'Removed']));

        filteredUnitsSignal.set([createUnit('Visible')]);
        fixture.detectChanges();

        expect([...component.selectedUnits()]).toEqual(['Visible']);
    });

    it('clears selection when no selected units remain displayed', () => {
        const fixture = TestBed.createComponent(UnitSearchComponent);
        const component = fixture.componentInstance;
        filteredUnitsSignal.set([createUnit('Removed')]);
        fixture.detectChanges();
        component.selectedUnits.set(new Set(['Removed']));

        filteredUnitsSignal.set([]);
        fixture.detectChanges();

        expect(component.selectedUnits().size).toBe(0);
    });

    it('adds every selected displayed unit with the active pilot skills', async () => {
        const fixture = TestBed.createComponent(UnitSearchComponent);
        const component = fixture.componentInstance;
        const first = createUnit('First');
        const second = createUnit('Second');
        filteredUnitsSignal.set([first, second]);
        dataServiceStub.getUnitByName.and.callFake((name: string) => name === first.name ? first : second);
        fixture.detectChanges();
        component.selectedUnits.set(new Set([first.name, second.name]));

        await component.addSelectedUnits();

        expect(forceBuilderServiceStub.addUnit.calls.allArgs()).toEqual([
            [first, 4, 5],
            [second, 4, 5],
        ]);
        expect(component.selectedUnits().size).toBe(0);
        expect(component.focused()).toBeFalse();
    });

    it('stops bulk adding after the force rejects a unit', async () => {
        const fixture = TestBed.createComponent(UnitSearchComponent);
        const component = fixture.componentInstance;
        const first = createUnit('First');
        const second = createUnit('Second');
        filteredUnitsSignal.set([first, second]);
        dataServiceStub.getUnitByName.and.callFake((name: string) => name === first.name ? first : second);
        forceBuilderServiceStub.addUnit.and.resolveTo(false);
        fixture.detectChanges();
        component.selectedUnits.set(new Set([first.name, second.name]));

        await component.addSelectedUnits();

        expect(forceBuilderServiceStub.addUnit).toHaveBeenCalledOnceWith(first, 4, 5);
        expect(dataServiceStub.getUnitByName).toHaveBeenCalledOnceWith(first.name);
        expect(component.selectedUnits().size).toBe(0);
    });

    it('skips a selected name when its unit data is unavailable', async () => {
        const fixture = TestBed.createComponent(UnitSearchComponent);
        const component = fixture.componentInstance;
        const missing = createUnit('Missing');
        filteredUnitsSignal.set([missing]);
        fixture.detectChanges();
        component.selectedUnits.set(new Set([missing.name]));

        await component.addSelectedUnits();

        expect(dataServiceStub.getUnitByName).toHaveBeenCalledOnceWith(missing.name);
        expect(forceBuilderServiceStub.addUnit).not.toHaveBeenCalled();
        expect(component.selectedUnits().size).toBe(0);
    });

    it('remeasures a hidden virtual viewport when results open at ultra-high resolution', async () => {
        filtersServiceStub.viewMode.set('card');
        const fixture = TestBed.createComponent(UnitSearchComponent);
        const component = fixture.componentInstance;

        filteredUnitsSignal.set(Array.from({ length: 600 }, (_, index) => createUnit(`Unit ${index + 1}`)));
        fixture.detectChanges();
        await fixture.whenStable();

        const viewport = fixture.nativeElement.querySelector('cdk-virtual-scroll-viewport') as HTMLElement;
        const cdkViewport = (component as any).viewport() as CdkVirtualScrollViewport;
        expect(component.resultsVisible()).toBeFalse();
        expect(cdkViewport.getViewportSize()).toBe(0);

        viewport.style.height = '4000px';
        filtersServiceStub.searchText.set('unit');
        component.focused.set(true);
        fixture.detectChanges();
        await fixture.whenStable();
        fixture.detectChanges();

        const minimumVisibleRows = Math.ceil(4000 / component.itemSize());
        const renderedRange = cdkViewport.getRenderedRange();
        expect(component.resultsVisible()).toBeTrue();
        expect(cdkViewport.getViewportSize()).toBe(4000);
        expect(renderedRange.end - renderedRange.start).toBeGreaterThanOrEqual(minimumVisibleRows);
    });

    for (const budgetMode of ['force-limit', 'bv-normalization'] as const) {
        it(`shows compact results when ${budgetMode} is the only active search control`, () => {
            const fixture = TestBed.createComponent(UnitSearchComponent);
            const component = fixture.componentInstance;
            component.focused.set(true);
            filtersServiceStub.budgetMode.set(budgetMode);

            expect(component.resultsVisible()).toBeTrue();
        });
    }

    it('preserves unrestricted skill ranges when enabling BV normalization', () => {
        const component = TestBed.createComponent(UnitSearchComponent).componentInstance;

        component.setSearchBudgetMode('bv-normalization');

        expect(filtersServiceStub.classicBvNormalizationSettings().gunnery).toEqual({ min: 0, max: 8 });
        expect(filtersServiceStub.classicBvNormalizationSettings().piloting).toEqual({ min: 0, max: 8 });
        expect(filtersServiceStub.classicBvNormalizationSettings().maxDelta).toBe(8);
        expect(filtersServiceStub.setBvNormalizationSettings).not.toHaveBeenCalled();
    });

    it('keeps compact results hidden without search input, filters, or a BV mode', () => {
        const fixture = TestBed.createComponent(UnitSearchComponent);
        const component = fixture.componentInstance;
        component.focused.set(true);

        expect(component.resultsVisible()).toBeFalse();
    });

    it('normalizes negative Force BV/PV Limit input to the empty zero state', () => {
        const component = TestBed.createComponent(UnitSearchComponent).componentInstance;
        const input = document.createElement('input');
        input.value = '-1000';

        component.onBvPvLimitInput({ target: input } as unknown as Event);

        expect(input.value).toBe('');
        expect(filtersServiceStub.bvPvLimit()).toBe(0);
    });

    it('normalizes positive Force BV/PV Limit input to a nonnegative integer', () => {
        const component = TestBed.createComponent(UnitSearchComponent).componentInstance;
        const input = document.createElement('input');
        input.value = '1000.9';

        component.onBvPvLimitInput({ target: input } as unknown as Event);

        expect(input.value).toBe('1000');
        expect(filtersServiceStub.bvPvLimit()).toBe(1000);
    });

    it('updates BV normalization max delta at inclusive boundaries', () => {
        const component = TestBed.createComponent(UnitSearchComponent).componentInstance;

        component.setNormalizationMaxDelta(0);
        expect(filtersServiceStub.classicBvNormalizationSettings().maxDelta).toBe(0);
        component.setNormalizationMaxDelta(8);
        expect(filtersServiceStub.classicBvNormalizationSettings().maxDelta).toBe(8);
    });

    it('rejects invalid BV normalization max delta values', () => {
        const component = TestBed.createComponent(UnitSearchComponent).componentInstance;

        for (const value of [-1, 9, 1.5, Number.NaN]) {
            component.setNormalizationMaxDelta(value);
        }

        expect(filtersServiceStub.setBvNormalizationSettings).not.toHaveBeenCalled();
        expect(filtersServiceStub.classicBvNormalizationSettings().maxDelta).toBe(8);
    });

    it('normalizes Target BV input bounds', () => {
        const component = TestBed.createComponent(UnitSearchComponent).componentInstance;

        component.setNormalizationTargetBvBound('min', 1200.8);
        expect(filtersServiceStub.classicBvNormalizationSettings().targetBv.min).toBe(1200);
        component.setNormalizationTargetBvBound('max', 1000);
        expect(filtersServiceStub.classicBvNormalizationSettings().targetBv).toEqual({ min: 1000, max: 1000 });
    });

    it('clamps Target BV values to 0–999999', () => {
        const component = TestBed.createComponent(UnitSearchComponent).componentInstance;

        component.setNormalizationTargetBvBound('min', -1);
        expect(filtersServiceStub.classicBvNormalizationSettings().targetBv.min).toBe(0);

        component.setNormalizationTargetBvBound('max', 1_000_000);
        expect(filtersServiceStub.classicBvNormalizationSettings().targetBv.max).toBe(999_999);
    });

    it('rewrites Target BV inputs to clamped values when focus leaves', () => {
        const component = TestBed.createComponent(UnitSearchComponent).componentInstance;
        const minimumInput = document.createElement('input');
        const maximumInput = document.createElement('input');
        minimumInput.value = '-1000';
        maximumInput.value = '1000000';

        component.onNormalizationTargetBvBoundChange('min', { target: minimumInput } as unknown as Event);
        component.onNormalizationTargetBvBoundChange('max', { target: maximumInput } as unknown as Event);

        expect(minimumInput.value).toBe('0');
        expect(maximumInput.value).toBe('999999');
        expect(filtersServiceStub.classicBvNormalizationSettings().targetBv).toEqual({ min: 0, max: 999_999 });
    });

    it('treats an empty Target BV input as zero when focus leaves', () => {
        const component = TestBed.createComponent(UnitSearchComponent).componentInstance;
        const input = document.createElement('input');
        input.value = '';

        component.onNormalizationTargetBvBoundChange('min', { target: input } as unknown as Event);

        expect(input.value).toBe('0');
        expect(filtersServiceStub.classicBvNormalizationSettings().targetBv.min).toBe(0);
    });

    it('updates Gunnery and Piloting from normalization range sliders', () => {
        const component = TestBed.createComponent(UnitSearchComponent).componentInstance;

        component.setNormalizationSkillRange('gunnery', [2, 4]);
        component.setNormalizationSkillRange('piloting', [3, 5]);

        expect(filtersServiceStub.classicBvNormalizationSettings().gunnery).toEqual({ min: 2, max: 4 });
        expect(filtersServiceStub.classicBvNormalizationSettings().piloting).toEqual({ min: 3, max: 5 });
    });

    it('rejects invalid normalization range slider values', () => {
        const component = TestBed.createComponent(UnitSearchComponent).componentInstance;
        filtersServiceStub.setBvNormalizationSettings.calls.reset();

        for (const value of [[-1, 4], [2, 9], [5, 4], [1.5, 4]] as [number, number][]) {
            component.setNormalizationSkillRange('gunnery', value);
        }

        expect(filtersServiceStub.setBvNormalizationSettings).not.toHaveBeenCalled();
        expect(filtersServiceStub.classicBvNormalizationSettings().gunnery).toEqual({ min: 0, max: 8 });
    });

    it('expands the search view when selecting table view from compact mode', () => {
        const fixture = TestBed.createComponent(UnitSearchComponent);
        const component = fixture.componentInstance;

        optionsServiceStub.setOption.calls.reset();
        filtersServiceStub.expandedView.set(false);
        fixture.detectChanges();

        component.selectViewMode('table');

        expect(filtersServiceStub.expandedView()).toBeTrue();
        expect(component.viewMode()).toBe('table');
        expect(filtersServiceStub.setViewMode).toHaveBeenCalledOnceWith('table');
        expect(optionsServiceStub.setOption).toHaveBeenCalledOnceWith('unitSearchViewMode', 'table');
    });

    it('uses list when collapsed and restores saved table mode on expansion', () => {
        optionsSignal.update(options => ({ ...options, unitSearchViewMode: 'table' }));
        filtersServiceStub.viewMode.set('table');
        filtersServiceStub.expandedView.set(true);
        const fixture = TestBed.createComponent(UnitSearchComponent);
        const component = fixture.componentInstance;

        fixture.detectChanges();
        component.toggleExpandedView();
        fixture.detectChanges();

        expect(component.viewMode()).toBe('list');
        expect(component.isTableMode()).toBeFalse();
        expect(filtersServiceStub.expandedView()).toBeFalse();
        expect(filtersServiceStub.setViewMode).toHaveBeenCalledWith('list');

        component.toggleExpandedView();
        fixture.detectChanges();

        expect(component.viewMode()).toBe('table');
        expect(component.isTableMode()).toBeTrue();
        expect(filtersServiceStub.expandedView()).toBeTrue();
        expect(filtersServiceStub.setViewMode).toHaveBeenCalledWith('table');
    });

    it('selects a result into the inline panel when the view starts expanded', () => {
        filtersServiceStub.viewMode.set('list');
        const fixture = TestBed.createComponent(UnitSearchComponent);
        const component = fixture.componentInstance;
        const unit = createUnit('Unit 1');

        filteredUnitsSignal.set([unit]);
        filtersServiceStub.expandedView.set(true);
        layoutServiceStub.windowWidth.set(2200);
        fixture.detectChanges();

        const result = fixture.nativeElement.querySelector('.click-result') as HTMLElement | null;
        expect(result).not.toBeNull();
        expect(component.showInlinePanel()).toBeTrue();

        result!.click();
        fixture.detectChanges();

        expect(component.inlinePanelUnit()).toBe(unit);
        expect(fixture.nativeElement.querySelector('.inline-panel-unit').textContent).toContain(unit.name);
    });

    it('disables Alpha Strike card view while in Classic mode', () => {
        currentGameSystemSignal.set(GameSystem.CLASSIC);
        filtersServiceStub.viewMode.set('list');
        const fixture = TestBed.createComponent(UnitSearchComponent);
        const component = fixture.componentInstance;

        fixture.detectChanges();
        const cardOption = component.viewModeOptions().find(option => option.mode === 'card');
        optionsServiceStub.setOption.calls.reset();

        component.selectViewMode('card');

        expect(cardOption?.disabled).toBeTrue();
        expect(component.viewMode()).toBe('list');
        expect(optionsServiceStub.setOption).not.toHaveBeenCalled();
    });

    it('groups chassis view results by chassis, Alpha Strike type, and omni status', () => {
        filtersServiceStub.viewMode.set('chassis');
        const fixture = TestBed.createComponent(UnitSearchComponent);
        const component = fixture.componentInstance;

        filteredUnitsSignal.set([
            createUnit('Atlas AS7-D', { chassis: 'Atlas', omni: 0, as: { TP: 'BM', PV: 42 }, bv: 1800 }),
            createUnit('Atlas AS7-K', { chassis: 'Atlas', omni: 0, as: { TP: 'BM', PV: 44 }, bv: 1900 }),
            createUnit('Atlas Omni', { chassis: 'Atlas', omni: 1, as: { TP: 'BM', PV: 46 }, bv: 2000 }),
            createUnit('Atlas Industrial', { chassis: 'Atlas', omni: 0, as: { TP: 'IM', PV: 28 }, bv: 1200 }),
        ]);
        fixture.detectChanges();

        expect(component.groupedUnits().map(group => ({
            key: group.key,
            chassis: group.chassis,
            asType: group.asType,
            omni: group.omni,
            variantCount: group.variantCount,
            minPV: group.minPV,
            maxPV: group.maxPV,
        }))).toEqual([
            { key: 'Atlas|BM', chassis: 'Atlas', asType: 'BM', omni: false, variantCount: 2, minPV: 42, maxPV: 44 },
            { key: 'Atlas|BM|O', chassis: 'Atlas', asType: 'BM', omni: true, variantCount: 1, minPV: 46, maxPV: 46 },
            { key: 'Atlas|IM', chassis: 'Atlas', asType: 'IM', omni: false, variantCount: 1, minPV: 28, maxPV: 28 },
        ]);
    });

    it('drills into a chassis group without changing the search text', () => {
        filtersServiceStub.viewMode.set('chassis');
        const fixture = TestBed.createComponent(UnitSearchComponent);
        const component = fixture.componentInstance;

        filteredUnitsSignal.set([
            createUnit('Nova Prime', { chassis: 'Nova', omni: 1, as: { TP: 'BM' } }),
            createUnit('Nova A', { chassis: 'Nova', omni: 1, as: { TP: 'BM' } }),
            createUnit('Nova Industrial', { chassis: 'Nova', omni: 1, as: { TP: 'IM' } }),
            createUnit('Locust LCT-1V', { chassis: 'Locust', omni: 0, as: { TP: 'BM' } }),
        ]);
        fixture.detectChanges();
        filtersServiceStub.setSearchText.calls.reset();

        const group = component.groupedUnits().find(item => item.key === 'Nova|BM|O');
        expect(group).toBeDefined();

        component.onCompactGroupClick(group!);

        expect(filtersServiceStub.setSearchText).not.toHaveBeenCalled();
        expect(component.viewMode()).toBe('list');
        expect(component.activeVariantGroupTitle()).toBe('Nova');
        expect(component.activeVariantGroupMeta()).toBe('BattleMek (omni) · 2 variants');
        expect(component.displayedUnits().map(unit => unit.name)).toEqual(['Nova Prime', 'Nova A']);
    });

    it('keeps variant group results filtered when toggling expanded view', () => {
        filtersServiceStub.viewMode.set('chassis');
        filtersServiceStub.expandedView.set(false);
        const fixture = TestBed.createComponent(UnitSearchComponent);
        const component = fixture.componentInstance;

        filteredUnitsSignal.set([
            createUnit('Atlas AS7-D', { chassis: 'Atlas', omni: 0, as: { TP: 'BM' } }),
            createUnit('Atlas AS7-K', { chassis: 'Atlas', omni: 0, as: { TP: 'BM' } }),
            createUnit('Atlas Industrial', { chassis: 'Atlas', omni: 0, as: { TP: 'IM' } }),
            createUnit('Locust LCT-1V', { chassis: 'Locust', omni: 0, as: { TP: 'BM' } }),
        ]);
        fixture.detectChanges();
        optionsServiceStub.setOption.calls.reset();

        const group = component.groupedUnits().find(item => item.key === 'Atlas|BM');
        expect(group).toBeDefined();

        component.onCompactGroupClick(group!);
        expect(component.viewMode()).toBe('list');
        expect(component.displayedUnits().map(unit => unit.name)).toEqual(['Atlas AS7-D', 'Atlas AS7-K']);

        component.toggleExpandedView();
        fixture.detectChanges();

        expect(filtersServiceStub.expandedView()).toBeTrue();
        expect(component.activeVariantGroupTitle()).toBe('Atlas');
        expect(component.viewMode()).toBe('list');
        expect(component.displayedUnits().map(unit => unit.name)).toEqual(['Atlas AS7-D', 'Atlas AS7-K']);

        component.toggleExpandedView();
        fixture.detectChanges();

        expect(filtersServiceStub.expandedView()).toBeFalse();
        expect(component.activeVariantGroupTitle()).toBe('Atlas');
        expect(component.viewMode()).toBe('list');
        expect(component.displayedUnits().map(unit => unit.name)).toEqual(['Atlas AS7-D', 'Atlas AS7-K']);
        expect(optionsServiceStub.setOption).not.toHaveBeenCalled();
    });

    it('clears the variant group filter back to chassis view and targets the old group row', () => {
        filtersServiceStub.viewMode.set('chassis');
        const fixture = TestBed.createComponent(UnitSearchComponent);
        const component = fixture.componentInstance;
        const scrollToVariantsGroup = spyOn<any>(component, 'scrollToVariantsGroup');

        filteredUnitsSignal.set([
            createUnit('Nova Prime', { chassis: 'Nova', omni: 1, as: { TP: 'BM' } }),
            createUnit('Nova A', { chassis: 'Nova', omni: 1, as: { TP: 'BM' } }),
        ]);
        fixture.detectChanges();

        component.onCompactGroupClick(component.groupedUnits()[0]);
        component.clearVariantGroupFilter();

        expect(component.activeVariantGroupFilter()).toBeNull();
        expect(component.viewMode()).toBe('chassis');
        expect(scrollToVariantsGroup).toHaveBeenCalledOnceWith('Nova|BM|O');
    });

    it('navigates search results with global up and down shortcuts', () => {
        const fixture = TestBed.createComponent(UnitSearchComponent);
        const component = fixture.componentInstance;
        const scrollToMakeVisible = spyOn<any>(component, 'scrollToMakeVisible');

        filteredUnitsSignal.set([
            createUnit('Unit 1'),
            createUnit('Unit 2'),
            createUnit('Unit 3'),
        ]);
        filtersServiceStub.expandedView.set(true);
        layoutServiceStub.windowWidth.set(2200);
        fixture.detectChanges();

        const downEvent = dispatchWindowKey('ArrowDown');
        expect(downEvent.defaultPrevented).toBeTrue();
        expect(component.activeIndex()).toBe(0);
        expect(component.inlinePanelUnit()?.name).toBe('Unit 1');
        expect(scrollToMakeVisible).toHaveBeenCalledWith(0, 'auto');

        dispatchWindowKey('ArrowDown');
        expect(component.activeIndex()).toBe(1);
        expect(component.inlinePanelUnit()?.name).toBe('Unit 2');
        expect(scrollToMakeVisible).toHaveBeenCalledWith(1, 'auto');

        dispatchWindowKey('ArrowUp');
        expect(component.activeIndex()).toBe(0);
        expect(component.inlinePanelUnit()?.name).toBe('Unit 1');
        expect(scrollToMakeVisible).toHaveBeenCalledWith(0, 'auto');
    });

    it('clamps repeated down shortcut navigation at the final result', () => {
        const fixture = TestBed.createComponent(UnitSearchComponent);
        const component = fixture.componentInstance;
        const scrollToMakeVisible = spyOn<any>(component, 'scrollToMakeVisible');

        filteredUnitsSignal.set([
            createUnit('Unit 1'),
            createUnit('Unit 2'),
            createUnit('Unit 3'),
        ]);
        filtersServiceStub.expandedView.set(true);
        layoutServiceStub.windowWidth.set(2200);
        fixture.detectChanges();

        for (let index = 0; index < 8; index++) {
            dispatchWindowKey('ArrowDown');
        }

        expect(component.activeIndex()).toBe(2);
        expect(component.inlinePanelUnit()?.name).toBe('Unit 3');
        expect(scrollToMakeVisible.calls.allArgs()).toEqual([
            [0, 'auto'],
            [1, 'auto'],
            [2, 'auto'],
        ]);
    });

    it('ignores result hover selection briefly after keyboard navigation', () => {
        const fixture = TestBed.createComponent(UnitSearchComponent);
        const component = fixture.componentInstance;
        spyOn<any>(component, 'scrollToMakeVisible');

        filteredUnitsSignal.set([
            createUnit('Unit 1'),
            createUnit('Unit 2'),
            createUnit('Unit 3'),
        ]);
        filtersServiceStub.expandedView.set(true);
        fixture.detectChanges();

        dispatchWindowKey('ArrowDown');
        component.onResultPointerHover(2, { clientX: 10, clientY: 10 });
        component.onResultPointerHover(2, { clientX: 10, clientY: 10 });

        expect(component.activeIndex()).toBe(0);

        component.onResultPointerHover(2, { clientX: 13, clientY: 10 });

        expect(component.activeIndex()).toBe(2);
    });

    it('uses instant scrolling for inline panel previous and next navigation', () => {
        const fixture = TestBed.createComponent(UnitSearchComponent);
        const component = fixture.componentInstance;
        const scrollToMakeVisible = spyOn<any>(component, 'scrollToMakeVisible');
        const units = [
            createUnit('Unit 1'),
            createUnit('Unit 2'),
            createUnit('Unit 3'),
        ];

        filteredUnitsSignal.set(units);
        component.inlinePanelUnit.set(units[1]);
        fixture.detectChanges();

        component.onInlinePanelNext();
        expect(component.activeIndex()).toBe(2);
        expect(component.inlinePanelUnit()?.name).toBe('Unit 3');
        expect(scrollToMakeVisible).toHaveBeenCalledWith(2, 'auto');

        component.onInlinePanelPrev();
        expect(component.activeIndex()).toBe(1);
        expect(component.inlinePanelUnit()?.name).toBe('Unit 2');
        expect(scrollToMakeVisible).toHaveBeenCalledWith(1, 'auto');
    });

    it('uses instant scrolling for unit details dialog navigation', () => {
        const fixture = TestBed.createComponent(UnitSearchComponent);
        const component = fixture.componentInstance;
        const scrollToMakeVisible = spyOn<any>(component, 'scrollToMakeVisible');
        const indexChange = new Subject<number>();
        const add = new Subject<void>();
        const units = [
            createUnit('Unit 1'),
            createUnit('Unit 2'),
            createUnit('Unit 3'),
        ];

        dialogsServiceStub.createDialog.and.returnValue({
            componentInstance: { indexChange, add },
            closed: NEVER,
        });
        filteredUnitsSignal.set(units);
        fixture.detectChanges();

        component.showUnitDetails(units[0]);
        indexChange.next(2);

        expect(component.activeIndex()).toBe(2);
        expect(component.inlinePanelUnit()?.name).toBe('Unit 3');
        expect(scrollToMakeVisible).toHaveBeenCalledWith(2, 'auto');
    });

    it('queues Enter until a debounced search commits before opening a result', () => {
        const fixture = TestBed.createComponent(UnitSearchComponent);
        const component = fixture.componentInstance;
        const previousUnit = createUnit('Atlas');
        const nextUnit = createUnit('Catapult');

        dialogsServiceStub.createDialog.and.returnValue({ closed: NEVER });
        filtersServiceStub.setSearchText.and.callFake((text: string) => {
            filtersServiceStub.searchText.set(text);
            isSearchSettledSignal.set(false);
            return text;
        });
        filtersServiceStub.searchText.set('atlas');
        filteredUnitsSignal.set([previousUnit]);
        fixture.detectChanges();

        component.setSearch('catapult');
        const event = new KeyboardEvent('keydown', { key: 'Enter', cancelable: true });
        component.onKeydown(event);

        expect(event.defaultPrevented).toBeTrue();
        expect(dialogsServiceStub.createDialog).not.toHaveBeenCalled();

        filteredUnitsSignal.set([nextUnit]);
        isSearchSettledSignal.set(true);
        fixture.detectChanges();

        expect(filtersServiceStub.setSearchText).toHaveBeenCalledWith('catapult');
        expect(dialogsServiceStub.createDialog).toHaveBeenCalledTimes(1);
        const dialogConfig = dialogsServiceStub.createDialog.calls.mostRecent().args[1] as any;
        expect(dialogConfig.data.unitList).toEqual([nextUnit]);
        expect(dialogConfig.data.unitIndex).toBe(0);
    });

    it('queues Enter until worker results settle before opening a result', () => {
        const fixture = TestBed.createComponent(UnitSearchComponent);
        const component = fixture.componentInstance;
        const previousUnit = createUnit('Atlas');
        const nextUnit = createUnit('Catapult');

        dialogsServiceStub.createDialog.and.returnValue({ closed: NEVER });
        filtersServiceStub.searchText.set('atlas');
        filteredUnitsSignal.set([previousUnit]);
        isSearchSettledSignal.set(false);
        fixture.detectChanges();

        const event = new KeyboardEvent('keydown', { key: 'Enter', cancelable: true });
        component.onKeydown(event);

        expect(event.defaultPrevented).toBeTrue();
        expect(dialogsServiceStub.createDialog).not.toHaveBeenCalled();

        filteredUnitsSignal.set([nextUnit]);
        isSearchSettledSignal.set(true);
        fixture.detectChanges();

        expect(dialogsServiceStub.createDialog).toHaveBeenCalledTimes(1);
        const dialogConfig = dialogsServiceStub.createDialog.calls.mostRecent().args[1] as any;
        expect(dialogConfig.data.unitList).toEqual([nextUnit]);
        expect(dialogConfig.data.unitIndex).toBe(0);
    });

    it('does not let a pending local debounce overwrite an external search update', () => {
        const fixture = TestBed.createComponent(UnitSearchComponent);
        const component = fixture.componentInstance;

        fixture.detectChanges();
        component.setSearch('stale local query');
        filtersServiceStub.setSearchText.calls.reset();

        filtersServiceStub.searchText.set('favorite query');
        fixture.detectChanges();
        (component as any).flushPendingSearch();

        expect(component.immediateSearchText()).toBe('favorite query');
        expect(filtersServiceStub.setSearchText).not.toHaveBeenCalled();
    });

    it('does not navigate or open results from descendant interactive controls', () => {
        const fixture = TestBed.createComponent(UnitSearchComponent);
        const component = fixture.componentInstance;
        filteredUnitsSignal.set([createUnit('Unit 1'), createUnit('Unit 2')]);
        filtersServiceStub.expandedView.set(true);
        fixture.detectChanges();

        const select = document.createElement('select');
        const button = document.createElement('button');
        fixture.nativeElement.append(select, button);

        const arrowEvent = new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true, cancelable: true });
        select.dispatchEvent(arrowEvent);
        const enterEvent = new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true });
        button.dispatchEvent(enterEvent);

        expect(arrowEvent.defaultPrevented).toBeFalse();
        expect(enterEvent.defaultPrevented).toBeFalse();
        expect(component.activeIndex()).toBeNull();
        expect(dialogsServiceStub.createDialog).not.toHaveBeenCalled();
    });

    it('normalizes keyboard-opened range dialog values against both boundaries', async () => {
        const fixture = TestBed.createComponent(UnitSearchComponent);
        const component = fixture.componentInstance;
        advOptionsSignal.set({
            testRange: {
                type: 'range',
                label: 'Test Range',
                value: [20, 80],
                totalRange: [0, 100],
            },
        });
        dialogsServiceStub.createDialog.and.returnValue({ closed: of({ from: -5, to: 200 }) });
        fixture.detectChanges();

        await component.openRangeValueDialog('testRange', [20, 80], [0, 100]);

        expect(filtersServiceStub.setFilter).toHaveBeenCalledOnceWith('testRange', [0, 100]);
    });

    it('clears active result state before changing sort order or direction', () => {
        const fixture = TestBed.createComponent(UnitSearchComponent);
        const component = fixture.componentInstance;
        const unit = createUnit('Unit 1');
        component.activeIndex.set(0);
        component.inlinePanelUnit.set(unit);

        component.onSortOrderChange('year');

        expect(component.activeIndex()).toBeNull();
        expect(component.inlinePanelUnit()).toBeNull();
        expect(filtersServiceStub.setSortOrder).toHaveBeenCalledOnceWith('year');

        component.activeIndex.set(0);
        component.inlinePanelUnit.set(unit);
        component.toggleSortDirection();

        expect(component.activeIndex()).toBeNull();
        expect(component.inlinePanelUnit()).toBeNull();
        expect(filtersServiceStub.setSortDirection).toHaveBeenCalledOnceWith('desc');
    });

    it('closes only its owned favorites overlay when destroyed', () => {
        const fixture = TestBed.createComponent(UnitSearchComponent);
        fixture.detectChanges();
        overlayManagerServiceStub.closeManagedOverlay.calls.reset();

        fixture.destroy();

        expect(overlayManagerServiceStub.closeManagedOverlay).toHaveBeenCalledOnceWith('favorites');
        expect(overlayManagerServiceStub.closeAllManagedOverlays).not.toHaveBeenCalled();
    });

    it('does not navigate search results while a dialog is on top', () => {
        const fixture = TestBed.createComponent(UnitSearchComponent);
        const component = fixture.componentInstance;
        const scrollToMakeVisible = spyOn<any>(component, 'scrollToMakeVisible');

        filteredUnitsSignal.set([
            createUnit('Unit 1'),
            createUnit('Unit 2'),
        ]);
        filtersServiceStub.expandedView.set(true);
        fixture.detectChanges();

        openDialogs.push({});
        const event = dispatchWindowKey('ArrowDown');

        expect(event.defaultPrevented).toBeFalse();
        expect(component.activeIndex()).toBeNull();
        expect(scrollToMakeVisible).not.toHaveBeenCalled();
    });

    it('toggles the visible advanced filter set locally without changing the global game mode', () => {
        const fixture = TestBed.createComponent(UnitSearchComponent);
        const component = fixture.componentInstance;

        fixture.detectChanges();

        expect(component.advPanelFilterGameSystem()).toBe(GameSystem.ALPHA_STRIKE);
        expect(component.dropdownFilters().some(filter => filter.key === 'as.TP')).toBeTrue();
        expect(component.dropdownFilters().some(filter => filter.key === 'type')).toBeFalse();

        component.setAdvPanelFilterGameSystem(GameSystem.CLASSIC);
        fixture.detectChanges();

        expect(component.advPanelFilterGameSystem()).toBe(GameSystem.CLASSIC);
        expect(component.dropdownFilters().some(filter => filter.key === 'type')).toBeTrue();
        expect(component.dropdownFilters().some(filter => filter.key === 'as.TP')).toBeFalse();
        expect(currentGameSystemSignal()).toBe(GameSystem.ALPHA_STRIKE);
    });

    it('resyncs the visible advanced filter set when the global game mode changes', () => {
        const fixture = TestBed.createComponent(UnitSearchComponent);
        const component = fixture.componentInstance;

        fixture.detectChanges();
        component.setAdvPanelFilterGameSystem(GameSystem.CLASSIC);
        fixture.detectChanges();

        expect(component.advPanelFilterGameSystem()).toBe(GameSystem.CLASSIC);

        currentGameSystemSignal.set(GameSystem.CLASSIC);
        fixture.detectChanges();
        expect(component.advPanelFilterGameSystem()).toBe(GameSystem.CLASSIC);

        component.setAdvPanelFilterGameSystem(GameSystem.ALPHA_STRIKE);
        fixture.detectChanges();
        expect(component.advPanelFilterGameSystem()).toBe(GameSystem.ALPHA_STRIKE);

        currentGameSystemSignal.set(GameSystem.ALPHA_STRIKE);
        fixture.detectChanges();
        expect(component.advPanelFilterGameSystem()).toBe(GameSystem.ALPHA_STRIKE);
        expect(component.dropdownFilters().some(filter => filter.key === 'as.TP')).toBeTrue();
        expect(component.dropdownFilters().some(filter => filter.key === 'type')).toBeFalse();
    });

    it('keeps MegaMek availability filters visible in both availability modes', () => {
        const fixture = TestBed.createComponent(UnitSearchComponent);
        const component = fixture.componentInstance;

        fixture.detectChanges();

        expect(component.dropdownFilters().some(filter => filter.key === 'availabilityRarity')).toBeTrue();
        expect(component.dropdownFilters().some(filter => filter.key === 'availabilityFrom')).toBeTrue();

        optionsSignal.set({
            ...optionsSignal(),
            availabilitySource: 'megamek',
        });
        fixture.detectChanges();

        expect(component.dropdownFilters().some(filter => filter.key === 'availabilityRarity')).toBeTrue();
        expect(component.dropdownFilters().some(filter => filter.key === 'availabilityFrom')).toBeTrue();
    });

    it('formats MegaMek rarity and availability badges for search result cards', () => {
        const fixture = TestBed.createComponent(UnitSearchComponent);
        const component = fixture.componentInstance;
        const unit = createUnit('Atlas');

        filtersServiceStub.getMegaMekAvailabilityBadges.and.returnValue([
            { source: 'Requisition', score: 30, rarity: 'Rare' },
        ]);
        filtersServiceStub.getMegaMekRaritySortScore.and.returnValue(30);
        expect(component.getSearchResultMegaMekRarity(unit)).toBe('Rare');
        expect(component.getSearchResultMegaMekAvailability(unit)).toEqual([
            { source: 'Requisition', score: 30, rarity: 'Rare' },
        ]);

        filtersServiceStub.selectedSort.set(MEGAMEK_RARITY_PRODUCTION_SORT_KEY);
        expect(component.getCardSortSlotOverride(unit)).toEqual({
            value: 'Rare',
            numeric: false,
        });

        filtersServiceStub.getMegaMekRaritySortScore.and.returnValue(MEGAMEK_AVAILABILITY_UNKNOWN_SCORE);
        expect(component.getSearchResultMegaMekRarity(unit)).toBe('—');
    });
});