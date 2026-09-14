// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { OptionsService } from '../../services/options.service';
import { UnitDataBadgesComponent } from './unit-data-badges.component';

describe('unit issue badges and optional quirks', () => {
    it('updates the badge and tooltip without changing cached issues when quirks are toggled', () => {
        const options = signal({ CBTOptionalRules: { quirks: true } });
        TestBed.configureTestingModule({ providers: [{ provide: OptionsService, useValue: { options } }] });
        const fixture = TestBed.createComponent(UnitDataBadgesComponent);
        const issues = [
            { code: 'QUIRK_NOT_APPLICABLE', severity: 'error', field: 'general', message: 'Battle Fists needs a hand.' },
            { code: 'ENGINE_RATING_MISMATCH', severity: 'error', field: 'engine', message: 'Wrong engine rating.' },
        ] as const;
        fixture.componentRef.setInput('loadIssues', issues);
        fixture.detectChanges();
        expect(fixture.componentInstance.visibleLoadIssues().length).toBe(2);
        options.set({ CBTOptionalRules: { quirks: false } });
        fixture.detectChanges();
        expect(fixture.componentInstance.visibleLoadIssues()).toEqual([issues[1]]);
        expect(fixture.componentInstance.loadIssuesTooltip()).toEqual([{ value: 'Error: Wrong engine rating.' }]);
        expect(fixture.nativeElement.querySelector('.load-issue-badge')).not.toBeNull();
        fixture.componentRef.setInput('loadIssues', [issues[0]]);
        fixture.detectChanges();
        expect(fixture.nativeElement.querySelector('.load-issue-badge')).toBeNull();
        options.set({ CBTOptionalRules: { quirks: true } });
        fixture.detectChanges();
        expect(fixture.nativeElement.querySelector('.load-issue-badge')).not.toBeNull();
        expect(fixture.componentInstance.loadIssues()).toEqual([issues[0]]);
    });
});
