// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import { provideZonelessChangeDetection } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { DialogRef, DIALOG_DATA } from '@angular/cdk/dialog';
import { DisplayNameService } from '../../services/display-name.service';
import { CreateLobbyDialogComponent } from './create-lobby-dialog.component';

describe('CreateLobbyDialogComponent', () => {
    let fixture: ComponentFixture<CreateLobbyDialogComponent>;
    const dialogRef = { close: jasmine.createSpy('close') };
    const displayNameService = { generate: jasmine.createSpy('generate') };

    beforeEach(async () => {
        dialogRef.close.calls.reset();
        displayNameService.generate.calls.reset();
        displayNameService.generate.and.resolveTo('Atlas');
        await TestBed.configureTestingModule({
            imports: [CreateLobbyDialogComponent],
            providers: [
                provideZonelessChangeDetection(),
                { provide: DialogRef, useValue: dialogRef },
                { provide: DIALOG_DATA, useValue: { displayName: 'Specter' } },
                { provide: DisplayNameService, useValue: displayNameService },
            ],
        }).compileComponents();
        fixture = TestBed.createComponent(CreateLobbyDialogComponent);
        fixture.detectChanges();
    });

    it('returns the normalized display name', () => {
        const element = fixture.nativeElement as HTMLElement;
        const input = element.querySelector<HTMLInputElement>('input')!;
        input.value = '  Barn   Owl  ';
        input.dispatchEvent(new Event('input'));
        fixture.detectChanges();

        element.querySelector<HTMLButtonElement>('.wide-dialog-actions button')!.click();

        expect(dialogRef.close).toHaveBeenCalledOnceWith('Barn Owl');
    });

    it('uses the usual random button to generate another callsign', async () => {
        const element = fixture.nativeElement as HTMLElement;
        element.querySelector<HTMLButtonElement>('.random-button')!.click();
        await fixture.whenStable();
        fixture.detectChanges();

        expect(displayNameService.generate).toHaveBeenCalledTimes(1);
        expect(element.querySelector<HTMLInputElement>('input')!.value).toBe('Atlas');
    });
});
