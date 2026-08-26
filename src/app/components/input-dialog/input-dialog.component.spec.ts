// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import { DialogRef, DIALOG_DATA } from '@angular/cdk/dialog';
import { provideZonelessChangeDetection } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { InputDialogComponent, type InputDialogData } from './input-dialog.component';

describe('InputDialogComponent', () => {
    it('centers and validates a compact code input', () => {
        const data: InputDialogData = {
            title: 'Join Operation Lobby',
            message: 'Join as a spectator.',
            centerInput: true,
            minimumLength: 4,
            maximumLength: 4,
            pattern: '^[a-zA-Z0-9]{4}$',
        };

        TestBed.configureTestingModule({
            imports: [InputDialogComponent],
            providers: [
                provideZonelessChangeDetection(),
                { provide: DIALOG_DATA, useValue: data },
                { provide: DialogRef, useValue: { close: jasmine.createSpy('close') } },
            ],
        });
        const fixture = TestBed.createComponent(InputDialogComponent);
        fixture.detectChanges();
        const input = fixture.nativeElement.querySelector('input') as HTMLInputElement;
        const confirm = fixture.nativeElement.querySelector('.wide-dialog-actions button') as HTMLButtonElement;

        expect(input.closest('.center-input')).not.toBeNull();
        expect(input.maxLength).toBe(4);
        expect(getComputedStyle(input).textAlign).toBe('center');

        input.value = 'abc';
        input.dispatchEvent(new Event('input'));
        fixture.detectChanges();
        expect(confirm.disabled).toBeTrue();

        input.value = 'A1B2';
        input.dispatchEvent(new Event('input'));
        fixture.detectChanges();
        expect(confirm.disabled).toBeFalse();

        fixture.destroy();
    });
});
