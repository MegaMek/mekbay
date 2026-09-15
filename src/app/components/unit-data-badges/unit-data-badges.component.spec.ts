// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
import { TestBed } from '@angular/core/testing';
import { UnitDataBadgesComponent } from './unit-data-badges.component';

describe('unit issue badges', () => {
    it('shows reported issues and clears the badge when they are resolved', () => {
        const fixture = TestBed.createComponent(UnitDataBadgesComponent);
        fixture.componentRef.setInput('loadIssues', [
            { code: 'ENGINE_RATING_MISMATCH', severity: 'error', field: 'engine', message: 'Wrong engine rating.' },
        ]);
        fixture.detectChanges();
        expect(fixture.componentInstance.loadIssuesTooltip()).toEqual([{ value: 'Error: Wrong engine rating.' }]);
        expect(fixture.nativeElement.querySelector('.load-issue-badge')).not.toBeNull();
        fixture.componentRef.setInput('loadIssues', []);
        fixture.detectChanges();
        expect(fixture.nativeElement.querySelector('.load-issue-badge')).toBeNull();
    });
});
