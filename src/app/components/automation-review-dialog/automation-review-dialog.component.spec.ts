// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import { DIALOG_DATA, DialogRef } from '@angular/cdk/dialog';
import { provideZonelessChangeDetection } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import type { AutomationReviewDialogData } from '../../models/automation-review.model';
import { AutomationReviewDialogComponent } from './automation-review-dialog.component';

describe('AutomationReviewDialogComponent', () => {
    let close: jasmine.Spy;
    let component: AutomationReviewDialogComponent;
    const data: AutomationReviewDialogData = {
        title: 'Review',
        message: 'Choose',
        allowCancel: true,
        events: [
            { id: 'one', subject: 'Atlas', event: 'Heat', description: 'Heat 1 → 19' },
            { id: 'two', subject: 'Marauder', event: 'Heat', description: 'Heat 3 → 1' },
        ],
    };

    beforeEach(async () => {
        close = jasmine.createSpy('close');
        await TestBed.configureTestingModule({
            imports: [AutomationReviewDialogComponent],
            providers: [
                provideZonelessChangeDetection(),
                { provide: DIALOG_DATA, useValue: data },
                { provide: DialogRef, useValue: { close } },
            ],
        }).compileComponents();
        component = TestBed.createComponent(AutomationReviewDialogComponent).componentInstance;
    });

    it('accepts every event when no rejection has been selected', () => {
        component.choose('one', true);

        expect(component.reviewAction().kind).toBe('accept-all');
        component.performReviewAction();

        expect(close).toHaveBeenCalledOnceWith({ acceptedEventIds: ['one', 'two'] });
    });

    it('waits for every mixed decision before applying only accepted events', () => {
        component.choose('one', false);

        expect(component.reviewAction()).toEqual(jasmine.objectContaining({
            kind: 'apply-choices',
            disabled: true,
        }));
        component.performReviewAction();
        expect(close).not.toHaveBeenCalled();

        component.choose('two', true);
        component.performReviewAction();

        expect(close).toHaveBeenCalledOnceWith({ acceptedEventIds: ['two'] });
    });

    it('skips every event when all decisions are rejected', () => {
        component.choose('one', false);
        component.choose('two', false);

        expect(component.reviewAction().kind).toBe('skip-all');
        component.performReviewAction();

        expect(close).toHaveBeenCalledOnceWith({ acceptedEventIds: [] });
    });

    it('cancels without a decision when cancellation is allowed', () => {
        component.cancel();

        expect(close).toHaveBeenCalledOnceWith(undefined);
    });
});

describe('AutomationReviewDialogComponent with one event', () => {
    it('resolves the single event directly in either direction', async () => {
        const close = jasmine.createSpy('close');
        const data: AutomationReviewDialogData = {
            title: 'Review',
            message: 'Choose',
            allowCancel: false,
            events: [{ id: 'one', subject: 'Atlas', event: 'Heat', description: 'Heat 1 → 19' }],
        };
        await TestBed.configureTestingModule({
            imports: [AutomationReviewDialogComponent],
            providers: [
                provideZonelessChangeDetection(),
                { provide: DIALOG_DATA, useValue: data },
                { provide: DialogRef, useValue: { close } },
            ],
        }).compileComponents();
        const fixture = TestBed.createComponent(AutomationReviewDialogComponent);
        fixture.detectChanges();
        const component = fixture.componentInstance;
        const actionButtons = fixture.nativeElement.querySelectorAll(
            '.automation-review-actions button',
        ) as NodeListOf<HTMLButtonElement>;

        expect(Array.from(actionButtons, button => button.textContent?.trim())).toEqual([
            'ACCEPT',
            'SKIP',
        ]);

        component.resolveSingle(true);
        component.resolveSingle(false);

        expect(close.calls.allArgs()).toEqual([
            [{ acceptedEventIds: ['one'] }],
            [{ acceptedEventIds: [] }],
        ]);
    });
});
