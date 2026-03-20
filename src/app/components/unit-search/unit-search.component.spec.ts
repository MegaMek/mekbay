import { CommonModule } from '@angular/common';
import { CdkVirtualScrollViewport, ScrollingModule } from '@angular/cdk/scrolling';
import { Overlay } from '@angular/cdk/overlay';
import { computed, provideZonelessChangeDetection, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { GameSystem } from '../../models/common.model';
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
import { UnitSearchFiltersService } from '../../services/unit-search-filters.service';
import { UnitSearchComponent } from './unit-search.component';

describe('UnitSearchComponent card virtualization', () => {
    const filteredUnitsSignal = signal<Unit[]>([]);
    const optionsSignal = signal({
        ASUseHex: false,
        ASCardStyle: 'monochrome',
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
        isAlphaStrike: () => true,
        currentGameSystem: () => GameSystem.ALPHA_STRIKE,
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
        return { name } as Unit;
    }

    async function flushRender() {
        await Promise.resolve();
        await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
    }

    beforeEach(async () => {
        filteredUnitsSignal.set([]);
        optionsSignal.set({
            ASUseHex: false,
            ASCardStyle: 'monochrome',
            unitSearchExpandedViewLayout: 'panel-list-filters',
            unitSearchViewMode: 'card',
        });
        filtersServiceStub.expandedView.set(false);
        filtersServiceStub.advOpen.set(false);
        filtersServiceStub.searchText.set('');
        filtersServiceStub.bvPvLimit.set(0);
        filtersServiceStub.selectedSort.set('name');
        filtersServiceStub.selectedSortDirection.set('asc');
        savedSearchesServiceStub.version.set(0);

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

    it('renders the card-mode virtual viewport with row containers', async () => {
        const fixture = TestBed.createComponent(UnitSearchComponent);
        const component = fixture.componentInstance;

        filteredUnitsSignal.set(Array.from({ length: 7 }, (_, index) => createUnit(`Unit ${index + 1}`)));
        (component as any).resultsDropdownWidth.set(920);
        fixture.detectChanges();
        await flushRender();
        fixture.detectChanges();

        const viewport = fixture.nativeElement.querySelector('cdk-virtual-scroll-viewport') as HTMLElement | null;
        const rows = Array.from(fixture.nativeElement.querySelectorAll('.card-view-row')) as HTMLElement[];
        const cells = Array.from(fixture.nativeElement.querySelectorAll('.card-view-cell')) as HTMLElement[];

        expect(viewport).not.toBeNull();
        expect(rows.length).toBeGreaterThan(0);
        expect(cells.length).toBe(7);
        expect(rows.length).toBe(3);
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
});