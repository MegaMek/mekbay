// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import { TestBed } from '@angular/core/testing';
import { CBTAutomationToastService } from './cbt-automation-toast.service';
import { ToastService } from './toast.service';

describe('CBTAutomationToastService', () => {
    let service: CBTAutomationToastService;
    let showToast: jasmine.Spy;
    const unit = {
        id: 'unit:1',
        getNotificationDisplayName: () => 'Atlas AS7-D',
    };

    beforeEach(() => {
        showToast = jasmine.createSpy('showToast');
        TestBed.configureTestingModule({
            providers: [
                CBTAutomationToastService,
                { provide: ToastService, useValue: { showToast } },
            ],
        });
        service = TestBed.inject(CBTAutomationToastService);
    });

    it('omits the unit name when the unit is currently visible', () => {
        const owner = {};
        service.setVisibleUnitIds(owner, [unit.id]);

        service.show(unit, 'Piloting Skill Check: PASSED', 'success');

        expect(showToast).toHaveBeenCalledOnceWith('Piloting Skill Check: PASSED', 'success');
    });

    it('includes the unit name when the unit is not currently visible', () => {
        const owner = {};
        service.setVisibleUnitIds(owner, ['unit:2']);

        service.show(unit, 'Piloting Skill Check: FAILED', 'error');

        expect(showToast).toHaveBeenCalledOnceWith(
            'Atlas AS7-D — Piloting Skill Check: FAILED',
            'error',
        );
    });

    it('stops treating a unit as visible when its viewer is removed', () => {
        const owner = {};
        service.setVisibleUnitIds(owner, [unit.id]);
        service.clearVisibleUnitIds(owner);

        service.show(unit, 'Fall resolved', 'error');

        expect(showToast).toHaveBeenCalledOnceWith('Atlas AS7-D — Fall resolved', 'error');
    });
});
