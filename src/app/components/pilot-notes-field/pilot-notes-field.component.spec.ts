// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import { provideZonelessChangeDetection } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { PilotNotesFieldComponent } from './pilot-notes-field.component';

describe('pilot notes field', () => {
    beforeEach(() => TestBed.configureTestingModule({ providers: [provideZonelessChangeDetection()] }));

    it('shows the primer-style counter only at 90 percent of the 512-character limit', () => {
        const fixture = TestBed.createComponent(PilotNotesFieldComponent);
        fixture.componentRef.setInput('value', 'x'.repeat(460));
        fixture.detectChanges();
        expect(fixture.nativeElement.querySelector('.field-meta')).toBeNull();
        fixture.componentRef.setInput('value', 'x'.repeat(461));
        fixture.detectChanges();
        expect(fixture.nativeElement.querySelector('.field-meta').textContent).toContain('461/512');
        expect(fixture.nativeElement.querySelector('textarea').getAttribute('maxlength')).toBe('512');
    });

    it('clamps pasted text and permits clearing existing notes', () => {
        const fixture = TestBed.createComponent(PilotNotesFieldComponent);
        fixture.detectChanges();
        const input = fixture.nativeElement.querySelector('textarea') as HTMLTextAreaElement;
        input.value = 'x'.repeat(600);
        input.dispatchEvent(new Event('input'));
        expect(fixture.componentInstance.value()).toBe('x'.repeat(512));
        expect(input.value.length).toBe(512);
        input.value = '';
        input.dispatchEvent(new Event('input'));
        expect(fixture.componentInstance.value()).toBe('');
    });
});
