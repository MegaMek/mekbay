import { Overlay } from '@angular/cdk/overlay';
import { provideZonelessChangeDetection } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Subject } from 'rxjs';
import { TagSelectorComponent } from '../components/tag-selector/tag-selector.component';
import type { Unit } from '../models/units.model';
import type { TagData } from './db.service';
import { DataService } from './data.service';
import { DialogsService } from './dialogs.service';
import { OverlayManagerService } from './overlay-manager.service';
import { PublicTagsService } from './public-tags.service';
import { TagsService } from './tags.service';
import { TaggingService } from './tagging.service';
import { UnitSearchFiltersService } from './unit-search-filters.service';

function createUnit(name: string, chassis = 'Dasher'): Unit {
    return {
        name,
        chassis,
        type: 'Mek',
        _nameTags: [{ tag: 'CLAN', quantity: 1 }],
        _chassisTags: [],
    } as unknown as Unit;
}

describe('TaggingService', () => {
    let service: TaggingService;
    let tagSelector: TagSelectorComponent;
    let closed: Subject<void>;

    const dataServiceMock = {
        getUnits: jasmine.createSpy('getUnits'),
    };
    const filtersServiceMock = {
        invalidateTagsCache: jasmine.createSpy('invalidateTagsCache'),
    };
    const tagsServiceMock = {
        getTagData: jasmine.createSpy('getTagData'),
        modifyTag: jasmine.createSpy('modifyTag'),
        setTagQuantity: jasmine.createSpy('setTagQuantity'),
    };
    const publicTagsServiceMock = {
        getPublicTagsForUnit: jasmine.createSpy('getPublicTagsForUnit'),
    };
    const overlayManagerMock = {
        has: jasmine.createSpy('has'),
        closeManagedOverlay: jasmine.createSpy('closeManagedOverlay'),
        createManagedOverlay: jasmine.createSpy('createManagedOverlay'),
        blockCloseUntil: jasmine.createSpy('blockCloseUntil'),
        unblockClose: jasmine.createSpy('unblockClose'),
    };
    const dialogsServiceMock = {
        createDialog: jasmine.createSpy('createDialog'),
        showError: jasmine.createSpy('showError'),
    };
    const overlayMock = {
        scrollStrategies: {
            close: jasmine.createSpy('close'),
        },
    };

    beforeEach(async () => {
        TestBed.resetTestingModule();

        await TestBed.configureTestingModule({
            imports: [TagSelectorComponent],
            providers: [
                provideZonelessChangeDetection(),
                TaggingService,
                { provide: DataService, useValue: dataServiceMock },
                { provide: UnitSearchFiltersService, useValue: filtersServiceMock },
                { provide: TagsService, useValue: tagsServiceMock },
                { provide: PublicTagsService, useValue: publicTagsServiceMock },
                { provide: OverlayManagerService, useValue: overlayManagerMock },
                { provide: DialogsService, useValue: dialogsServiceMock },
                { provide: Overlay, useValue: overlayMock },
            ],
        }).compileComponents();

        const fixture = TestBed.createComponent(TagSelectorComponent);
        tagSelector = fixture.componentInstance;
        closed = new Subject<void>();

        dataServiceMock.getUnits.calls.reset();
        filtersServiceMock.invalidateTagsCache.calls.reset();
        tagsServiceMock.getTagData.calls.reset();
        tagsServiceMock.modifyTag.calls.reset();
        tagsServiceMock.modifyTag.and.resolveTo(undefined);
        tagsServiceMock.setTagQuantity.calls.reset();
        tagsServiceMock.setTagQuantity.and.resolveTo(undefined);
        publicTagsServiceMock.getPublicTagsForUnit.calls.reset();
        publicTagsServiceMock.getPublicTagsForUnit.and.returnValue([]);
        overlayManagerMock.has.calls.reset();
        overlayManagerMock.has.and.returnValue(false);
        overlayManagerMock.closeManagedOverlay.calls.reset();
        overlayManagerMock.createManagedOverlay.calls.reset();
        overlayManagerMock.createManagedOverlay.and.returnValue({
            componentRef: { instance: tagSelector },
            closed,
        });
        overlayManagerMock.blockCloseUntil.calls.reset();
        overlayManagerMock.unblockClose.calls.reset();
        dialogsServiceMock.createDialog.calls.reset();
        dialogsServiceMock.showError.calls.reset();
        overlayMock.scrollStrategies.close.calls.reset();
        overlayMock.scrollStrategies.close.and.returnValue({});

        service = TestBed.inject(TaggingService);
    });

    it('uses all same-chassis variants when converting a selected unit tag to a chassis tag', async () => {
        const prime = createUnit('Dasher Prime');
        const variantA = createUnit('Dasher A');
        const variantB = createUnit('Dasher B');
        const otherChassis = createUnit('Adder Prime', 'Adder');
        const allUnits = [prime, variantA, variantB, otherChassis];
        const tagData: TagData = {
            tags: {
                clan: {
                    label: 'CLAN',
                    units: {
                        'Dasher Prime': {},
                        'Dasher A': {},
                        'Dasher B': {},
                        'Adder Prime': {},
                    },
                    chassis: {},
                },
            },
            timestamp: 1,
            formatVersion: 3,
        };

        dataServiceMock.getUnits.and.returnValue(allUnits);
        tagsServiceMock.getTagData.and.resolveTo(tagData);

        await service.openTagSelector([prime]);
        tagSelector.tagSelected.emit({ tag: 'CLAN', tagType: 'chassis' });

        expect(tagsServiceMock.modifyTag).toHaveBeenCalledWith([prime, variantA, variantB], 'CLAN', 'chassis', 'add');
    });
});
