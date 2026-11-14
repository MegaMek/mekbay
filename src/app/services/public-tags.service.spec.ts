// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import { provideZonelessChangeDetection } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { DbService } from './db.service';
import { DialogsService } from './dialogs.service';
import { LoggerService } from './logger.service';
import { PublicTagsService } from './public-tags.service';
import { TagsService } from './tags.service';
import { UserStateService } from './userState.service';
import { WsService } from './ws.service';
import { createEmptyUnit } from '../testing/unit-test-helpers';

describe('PublicTagsService', () => {
    const wsServiceMock = {
        sendAndWaitForResponse: jasmine.createSpy('sendAndWaitForResponse'),
        registerMessageHandler: jasmine.createSpy('registerMessageHandler'),
    };

    const byName = createEmptyUnit({ name: 'Locust LCT-1V', chassis: 'Locust' });
    const tagsServiceMock = {
        getUnitKeyForV3Name: (name: string) => name === byName.name ? byName.uuid : undefined,
    };

    beforeEach(() => {
        TestBed.resetTestingModule();
        wsServiceMock.sendAndWaitForResponse.calls.reset();
        TestBed.configureTestingModule({
            providers: [
                provideZonelessChangeDetection(),
                PublicTagsService,
                { provide: WsService, useValue: wsServiceMock },
                { provide: UserStateService, useValue: {} },
                { provide: DbService, useValue: {} },
                { provide: LoggerService, useValue: { error: jasmine.createSpy('error') } },
                { provide: DialogsService, useValue: {} },
                { provide: TagsService, useValue: tagsServiceMock },
            ],
        });
    });

    it('matches units by UUID, and a V3 name only on the unit its tags migrate to', async () => {
        const byUuid = createEmptyUnit({ name: 'Atlas AS7-D', chassis: 'Atlas' });
        const sameNameTwin = createEmptyUnit({ name: 'Locust LCT-1V', chassis: 'Locust', isCustom: true });
        const untagged = createEmptyUnit({ name: 'Locust LCT-1E', chassis: 'Locust' });
        wsServiceMock.sendAndWaitForResponse.and.resolveTo({
            found: true,
            tagNames: ['Lance'],
            tags: { lance: { label: 'Lance', units: { [byUuid.uuid]: {}, 'Locust LCT-1V': {} }, chassis: {} } },
            timestamp: 5,
        });
        const service = TestBed.inject(PublicTagsService);

        await service.importTemporary('owner', ['Lance']);

        const expected = [{ tag: 'Lance', publicId: 'owner', subscribed: false }];
        expect(service.getPublicTagsForUnit(byUuid)).toEqual(expected);
        expect(service.getPublicTagsForUnit(byName)).toEqual(expected);
        expect(service.getPublicTagsForUnit(sameNameTwin)).toEqual([]);
        expect(service.getPublicTagsForUnit(untagged)).toEqual([]);
    });
});
