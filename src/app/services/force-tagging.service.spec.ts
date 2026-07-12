import { Overlay } from '@angular/cdk/overlay';
import { provideZonelessChangeDetection } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Subject } from 'rxjs';
import { ForceTagSelectorComponent } from '../components/force-tag-selector/force-tag-selector.component';
import { ForceBuilderService } from './force-builder.service';
import { DataService } from './data.service';
import { DialogsService } from './dialogs.service';
import { ForceTaggingService } from './force-tagging.service';
import { OverlayManagerService } from './overlay-manager.service';

describe('ForceTaggingService', () => {
    const manyTags = [
        '11', '12', '123', '13', '133', '14', '15', '16', '17', '18', '19', '233',
        '24', '25', '26', '27', '28', '29', '30', '31', '32', '33', '34', '35',
        '36', '37', '38', '39', '40', '41', '443', 'a', 'aa', 'b', 'bbbb', 'c',
        'cccc', 'd', 'e', 'er', 'f', 'g', 'zz',
    ];

    let service: ForceTaggingService;
    let forceTagSelector: ForceTagSelectorComponent;
    let closed: Subject<void>;

    const dataServiceMock = {
        getCachedForceTagLabels: jasmine.createSpy('getCachedForceTagLabels'),
        updateForceTags: jasmine.createSpy('updateForceTags'),
    };
    const forceBuilderServiceMock = {
        loadedForces: jasmine.createSpy('loadedForces'),
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
            imports: [ForceTagSelectorComponent],
            providers: [
                provideZonelessChangeDetection(),
                ForceTaggingService,
                { provide: DataService, useValue: dataServiceMock },
                { provide: ForceBuilderService, useValue: forceBuilderServiceMock },
                { provide: OverlayManagerService, useValue: overlayManagerMock },
                { provide: DialogsService, useValue: dialogsServiceMock },
                { provide: Overlay, useValue: overlayMock },
            ],
        }).compileComponents();

        const fixture = TestBed.createComponent(ForceTagSelectorComponent);
        forceTagSelector = fixture.componentInstance;
        closed = new Subject<void>();

        dataServiceMock.getCachedForceTagLabels.calls.reset();
        dataServiceMock.getCachedForceTagLabels.and.returnValue([]);
        dataServiceMock.updateForceTags.calls.reset();
        dataServiceMock.updateForceTags.and.resolveTo([]);
        forceBuilderServiceMock.loadedForces.calls.reset();
        forceBuilderServiceMock.loadedForces.and.returnValue([]);
        overlayManagerMock.has.calls.reset();
        overlayManagerMock.has.and.returnValue(false);
        overlayManagerMock.closeManagedOverlay.calls.reset();
        overlayManagerMock.createManagedOverlay.calls.reset();
        overlayManagerMock.createManagedOverlay.and.returnValue({
            componentRef: { instance: forceTagSelector },
            closed,
        });
        overlayManagerMock.blockCloseUntil.calls.reset();
        overlayManagerMock.unblockClose.calls.reset();
        dialogsServiceMock.createDialog.calls.reset();
        dialogsServiceMock.showError.calls.reset();
        overlayMock.scrollStrategies.close.calls.reset();
        overlayMock.scrollStrategies.close.and.returnValue({});

        service = TestBed.inject(ForceTaggingService);
    });

    it('passes every available force tag label to the selector when there are more than 32 labels', async () => {
        await service.openForceTagSelector(
            [{ instanceId: 'force-1', owned: true, tags: ['39'] }],
            null,
            { availableTags: manyTags, updateCloud: false },
        );

        const tags = forceTagSelector.tags();
        expect(tags.length).toBe(manyTags.length);
        expect(tags).toContain('aa');
        expect(tags).toContain('zz');
    });
});