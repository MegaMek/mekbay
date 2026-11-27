// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import { Overlay } from '@angular/cdk/overlay';
import { provideZonelessChangeDetection } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Subject } from 'rxjs';
import { TagSelectorComponent } from '../components/tag-selector/tag-selector.component';
import type { UnitSummary } from '../models/unit-summary.model';
import type { TagData } from './db.service';
import { DataService } from './data.service';
import { DialogsService } from './dialogs.service';
import { OverlayManagerService } from './overlay-manager.service';
import { PublicTagsService } from './public-tags.service';
import { TagsService } from './tags.service';
import { TaggingService } from './tagging.service';
import { UnitSearchFiltersService } from './unit-search-filters.service';
import { createEmptyUnit } from '../testing/unit-test-helpers';

function createUnit(name: string, chassis = 'Dasher'): UnitSummary {
    return createEmptyUnit({
        name,
        chassis,
        type: 'Mek',
        _nameTags: [{ tag: 'CLAN', quantity: 1 }],
        _chassisTags: [],
    });
}

describe('TaggingService', () => {
    let service: TaggingService;
    let tagSelector: TagSelectorComponent;
    let closed: Subject<void>;

    const dataServiceMock = {
        getUnits: jasmine.createSpy('getUnits'),
        getUnitByUuid: jasmine.createSpy('getUnitByUuid'),
    };
    const filtersServiceMock = {
        invalidateTagsCache: jasmine.createSpy('invalidateTagsCache'),
    };
    const tagsServiceMock = {
        getTagData: jasmine.createSpy('getTagData'),
        modifyTag: jasmine.createSpy('modifyTag'),
        setTagQuantity: jasmine.createSpy('setTagQuantity'),
        tagIdExists: jasmine.createSpy('tagIdExists'),
        renameTag: jasmine.createSpy('renameTag'),
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
        prompt: jasmine.createSpy('prompt'),
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
        dataServiceMock.getUnitByUuid.calls.reset();
        dataServiceMock.getUnitByUuid.and.returnValue(undefined);
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
        dialogsServiceMock.prompt.calls.reset();
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
                        [prime.uuid]: {},
                        [variantA.uuid]: {},
                        [variantB.uuid]: {},
                        [otherChassis.uuid]: {},
                    },
                    chassis: {},
                },
            },
            timestamp: 1,
            formatVersion: 5,
        };

        dataServiceMock.getUnits.and.returnValue(allUnits);
        tagsServiceMock.getTagData.and.resolveTo(tagData);

        await service.openTagSelector([prime]);
        tagSelector.tagSelected.emit({ tag: 'CLAN', tagType: 'chassis' });

        expect(tagsServiceMock.modifyTag).toHaveBeenCalledWith([prime, variantA, variantB], 'CLAN', 'chassis', 'add');
    });

    it('creates a mixed-case unit tag with the standard text prompt', async () => {
        const unit = createUnit('Dasher Prime');
        dataServiceMock.getUnits.and.returnValue([unit]);
        tagsServiceMock.getTagData.and.resolveTo({ tags: {}, timestamp: 1, formatVersion: 5 });
        dialogsServiceMock.prompt.and.resolveTo('RoS-GUARDS');

        await service.openTagSelector([unit]);
        tagSelector.onAddNewNameTag();
        await Promise.resolve();

        expect(dialogsServiceMock.prompt).toHaveBeenCalledWith('Enter the new tag name:', 'Add New Tag to Unit');
        expect(tagsServiceMock.modifyTag).toHaveBeenCalledWith([unit], 'RoS-GUARDS', 'name', 'add');
    });

    it('returns the new capitalization after a case-only rename', async () => {
        dialogsServiceMock.prompt.and.resolveTo('RoS-GUARDS');
        tagsServiceMock.tagIdExists.and.resolveTo('ros-guards');
        tagsServiceMock.renameTag.and.resolveTo('success');

        expect(await service.renameTag('ros-guards', 'name')).toBe('RoS-GUARDS');
    });

    it('tags the catalog entry and reads its live tags when given a details copy of the unit', async () => {
        const catalogUnit = createUnit('Dasher Prime');
        const detailsCopy = { ...catalogUnit, _nameTags: [] };
        dataServiceMock.getUnits.and.returnValue([catalogUnit]);
        dataServiceMock.getUnitByUuid.and.callFake((uuid: string) => uuid === catalogUnit.uuid ? catalogUnit : undefined);
        tagsServiceMock.getTagData.and.resolveTo({ tags: {}, timestamp: 1, formatVersion: 5 });

        await service.openTagSelector([detailsCopy]);

        expect(tagSelector.assignedNameTags()).toEqual(['CLAN']);
        tagSelector.tagSelected.emit({ tag: 'Lance', tagType: 'name' });
        expect(tagsServiceMock.modifyTag).toHaveBeenCalledWith([catalogUnit], 'Lance', 'name', 'add');
    });
});
