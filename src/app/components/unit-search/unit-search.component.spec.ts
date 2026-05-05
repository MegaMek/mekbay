import { CommonModule } from '@angular/common';
import { CdkVirtualScrollViewport, ScrollingModule } from '@angular/cdk/scrolling';
import { Overlay } from '@angular/cdk/overlay';
import { Dialog } from '@angular/cdk/dialog';
import { computed, provideZonelessChangeDetection, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { NEVER, Subject } from 'rxjs';
import { GameSystem } from '../../models/common.model';
import { MEGAMEK_AVAILABILITY_UNKNOWN_SCORE } from '../../models/megamek/availability.model';
import type { Unit } from '../../models/units.model';
import { AsAbilityLookupService } from '../../services/as-ability-lookup.service';
import { DataService } from '../../services/data.service';
import { DialogsService } from '../../services/dialogs.service';
import { ForceBuilderService } from '../../services/force-builder.service';
import { GameService } from '../../services/game.service';
import { LayoutService } from '../../services/layout.service';
import { OptionsService } from '../../services/options.service';
import { OverlayManagerService } from '../../services/overlay-manager.service';
import { SavedSearchesService } from '../../services/saved-searches.service';
import { TaggingService } from '../../services/tagging.service';
import { MEGAMEK_RARITY_PRODUCTION_SORT_KEY } from '../../services/unit-search-filters.model';
import { UnitSearchFiltersService } from '../../services/unit-search-filters.service';
import { createEmptyUnit } from '../../testing/unit-test-helpers';
import { UnitSearchComponent } from './unit-search.component';

describe('UnitSearchComponent card virtualization', () => {
    const filteredUnitsSignal = signal<Unit[]>([]);
    const currentGameSystemSignal = signal(GameSystem.ALPHA_STRIKE);
    const closePanelsRequestSignal = signal({ requestId: 0, exitExpandedView: false });
    let openDialogs: unknown[];
    const optionsSignal = signal({
        ASUseHex: false,
        ASCardStyle: 'monochrome',
        availabilitySource: 'mul' as 'mul' | 'megamek',
        unitSearchExpandedViewLayout: 'panel-list-filters',
        unitSearchViewMode: 'card' as 'list' | 'card' | 'chassis' | 'table',
    });

    const filtersServiceStub = {
        dropdownConfigs: computed(() => []),
        rangeConfigs: computed(() => []),
        expandedView: signal(false),
        advOpen: signal(false),
        searchText: signal(''),
        pilotGunnerySkill: signal(4),
        pilotPilotingSkill: signal(5),
        bvPvLimit: signal(0),
        forceTotalBvPv: signal(0),
        selectedSort: signal('name'),
        selectedSortDirection: signal<'asc' | 'desc'>('asc'),
        closePanelsRequest: closePanelsRequestSignal,
        filteredUnits: () => filteredUnitsSignal(),
        isDataReady: () => true,
        searchTokens: () => [],
        isComplexQuery: () => false,
        filterState: () => ({}),
        advOptions: () => ({}),
        resetFilters: jasmine.createSpy('resetFilters'),
        setSortDirection: jasmine.createSpy('setSortDirection'),
        setSortOrder: jasmine.createSpy('setSortOrder'),
        setFilter: jasmine.createSpy('setFilter'),
        unsetFilter: jasmine.createSpy('unsetFilter'),
        setPilotSkills: jasmine.createSpy('setPilotSkills'),
        requestClosePanels: jasmine.createSpy('requestClosePanels').and.callFake((options?: { exitExpandedView?: boolean }) => {
            const currentRequest = closePanelsRequestSignal();
            closePanelsRequestSignal.set({
                requestId: currentRequest.requestId + 1,
                exitExpandedView: !!options?.exitExpandedView,
            });
        }),
        getMegaMekAvailabilityBadges: jasmine.createSpy('getMegaMekAvailabilityBadges').and.returnValue([]),
        getMegaMekRaritySortScore: jasmine.createSpy('getMegaMekRaritySortScore').and.returnValue(0),
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

    function createUnit(name: string): Unit {
        return createEmptyUnit({ name });
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
            ASCardStyle: 'monochrome',
            availabilitySource: 'mul',
            unitSearchExpandedViewLayout: 'panel-list-filters',
            unitSearchViewMode: 'card',
        });
        filtersServiceStub.expandedView.set(false);
        filtersServiceStub.advOpen.set(false);
        filtersServiceStub.searchText.set('');
        filtersServiceStub.bvPvLimit.set(0);
        filtersServiceStub.selectedSort.set('name');
        filtersServiceStub.selectedSortDirection.set('asc');
        closePanelsRequestSignal.set({ requestId: 0, exitExpandedView: false });
        filtersServiceStub.requestClosePanels.calls.reset();
        filtersServiceStub.getMegaMekAvailabilityBadges.and.returnValue([]);
        filtersServiceStub.getMegaMekRaritySortScore.and.returnValue(0);
        dialogsServiceStub.createDialog.calls.reset();
        dialogsServiceStub.createDialog.and.returnValue(undefined);
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
                    imports: [CommonModule, ScrollingModule],
                    template: `
                        <div #resultsDropdown class="results-dropdown" style="width: 920px;">
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

    it('maps card item navigation to the containing virtual row index', () => {
        const fixture = TestBed.createComponent(UnitSearchComponent);
        const component = fixture.componentInstance;
        const scrollToIndex = jasmine.createSpy('scrollToIndex');

        filteredUnitsSignal.set(Array.from({ length: 9 }, (_, index) => createUnit(`Unit ${index + 1}`)));
        (component as any).resultsDropdownWidth.set(920);
        fixture.detectChanges();

        spyOn<any>(component, 'currentViewport').and.returnValue({
            scrollToIndex,
        } as Partial<CdkVirtualScrollViewport>);

        (component as any).scrollToIndex(4);

        expect(scrollToIndex).toHaveBeenCalledOnceWith(1, 'smooth');
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
        expect(optionsServiceStub.setOption).toHaveBeenCalledOnceWith('unitSearchViewMode', 'table');
    });

    it('disables Alpha Strike card view while in Classic mode', () => {
        currentGameSystemSignal.set(GameSystem.CLASSIC);
        optionsSignal.set({
            ...optionsSignal(),
            unitSearchViewMode: 'list',
        });
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
        component.onResultPointerEnter(2);

        expect(component.activeIndex()).toBe(0);

        (component as any).resultPointerHoverSuppressedUntil = 0;
        component.onResultPointerEnter(2);

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