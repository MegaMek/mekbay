// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import { TestBed } from '@angular/core/testing';
import { of } from 'rxjs';
import { AutomationReviewService } from './automation-review.service';
import { DialogsService } from './dialogs.service';

describe('AutomationReviewService', () => {
    let createDialog: jasmine.Spy;
    let service: AutomationReviewService;
    const events = [
        { id: 'known', subject: 'Atlas', event: 'Heat', description: 'Heat 4 → 8' },
    ];

    beforeEach(() => {
        createDialog = jasmine.createSpy('createDialog');
        TestBed.configureTestingModule({
            providers: [
                AutomationReviewService,
                { provide: DialogsService, useValue: { createDialog } },
            ],
        });
        service = TestBed.inject(AutomationReviewService);
    });

    afterEach(() => TestBed.resetTestingModule());

    it('returns an empty decision set without opening a dialog when there are no events', async () => {
        expect(Array.from((await service.review([])) ?? [])).toEqual([]);
        expect(createDialog).not.toHaveBeenCalled();
    });

    it('returns null when the review dialog is cancelled', async () => {
        createDialog.and.returnValue({ closed: of(undefined) });

        expect(await service.review(events)).toBeNull();
    });

    it('returns only accepted IDs that belong to the request', async () => {
        createDialog.and.returnValue({
            closed: of({ acceptedEventIds: ['known', 'not-in-request'] }),
        });

        const accepted = await service.review(events);

        expect(Array.from(accepted ?? [])).toEqual(['known']);
    });

    it('only exposes cancellation when explicitly allowed', async () => {
        createDialog.and.returnValue({ closed: of({ acceptedEventIds: [] }) });

        await service.review(events);
        expect(createDialog.calls.mostRecent().args[1].data.allowCancel).toBeFalse();

        await service.review(events, { allowCancel: true });
        expect(createDialog.calls.mostRecent().args[1].data.allowCancel).toBeTrue();
    });
});
