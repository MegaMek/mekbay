// SPDX-License-Identifier: GPL-3.0-or-later

import { TestBed } from '@angular/core/testing';

import { CBTAutomationToastService } from './cbt-automation-toast.service';
import { ToastService } from './toast.service';

describe('CBTAutomationToastService', () => {
    let service: CBTAutomationToastService;
    let showToast: jasmine.Spy;

    beforeEach(() => {
        showToast = jasmine.createSpy('showToast');
        TestBed.configureTestingModule({ providers: [
            CBTAutomationToastService,
            { provide: ToastService, useValue: { showToast } },
        ] });
        service = TestBed.inject(CBTAutomationToastService);
    });

    it('omits the subject only while its runtime is visible', () => {
        const owner = {};
        service.setVisibleUnitIds(owner, ['unit:1']);
        service.show('unit:1', 'Atlas AS7-D', 'Check passed', 'success');
        service.show('unit:2', 'Archer ARC-2R', 'Check failed', 'error');

        expect(showToast.calls.allArgs()).toEqual([
            ['Check passed', 'success'],
            ['Archer ARC-2R — Check failed', 'error'],
        ]);

        service.clearVisibleUnitIds(owner);
        service.show('unit:1', 'Atlas AS7-D', 'Fall resolved', 'error');
        expect(showToast.calls.mostRecent().args)
            .toEqual(['Atlas AS7-D — Fall resolved', 'error']);
    });
});
