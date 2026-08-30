// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import { TestBed } from '@angular/core/testing';
import type { AutomationReviewEvent } from '../models/automation-review.model';
import type { AutomationMode } from '../models/options.model';
import { AutomationReviewService } from './automation-review.service';
import { CBTAutomationService } from './cbt-automation.service';
import { OptionsService } from './options.service';

describe('CBTAutomationService', () => {
    const events: AutomationReviewEvent[] = [
        { id: 'one', subject: 'Archer', event: 'Test', description: 'First' },
        { id: 'two', subject: 'Atlas', event: 'Test', description: 'Second' },
    ];
    let mode: AutomationMode;
    let review: jasmine.Spy;
    let service: CBTAutomationService;

    beforeEach(() => {
        mode = 'yes';
        review = jasmine.createSpy('review');
        TestBed.configureTestingModule({ providers: [
            CBTAutomationService,
            { provide: OptionsService, useValue: { cbtAutomationMode: () => mode } },
            { provide: AutomationReviewService, useValue: { review } },
        ] });
        service = TestBed.inject(CBTAutomationService);
    });

    it('maps yes, no, and ask to accept, skip, and shared review', async () => {
        expect([...(await service.resolve('breachAndFloodCheck', events))!]).toEqual(['one', 'two']);
        mode = 'no';
        expect([...(await service.resolve('breachAndFloodCheck', events))!]).toEqual([]);
        mode = 'ask';
        review.and.resolveTo(new Set(['two']));
        expect([...(await service.resolve('breachAndFloodCheck', events))!]).toEqual(['two']);
        review.and.resolveTo(null);
        expect(await service.resolve('breachAndFloodCheck', events)).toBeNull();
    });
});
