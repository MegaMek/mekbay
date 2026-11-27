// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import { provideZonelessChangeDetection } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { DialogRef, DIALOG_DATA } from '@angular/cdk/dialog';
import { DisplayNameService } from '../../services/display-name.service';
import { JoinLobbyDialogComponent } from './join-lobby-dialog.component';

describe('JoinLobbyDialogComponent', () => {
    let fixture: ComponentFixture<JoinLobbyDialogComponent>;
    const dialogRef = { close: jasmine.createSpy('close') };
    const displayNameService = { generate: jasmine.createSpy('generate') };
    const attemptJoin = jasmine.createSpy('attemptJoin');

    beforeEach(async () => {
        dialogRef.close.calls.reset();
        displayNameService.generate.calls.reset();
        displayNameService.generate.and.resolveTo('Atlas');
        attemptJoin.calls.reset();
        attemptJoin.and.callFake(async () => undefined);
        await TestBed.configureTestingModule({
            imports: [JoinLobbyDialogComponent],
            providers: [
                provideZonelessChangeDetection(),
                { provide: DialogRef, useValue: dialogRef },
                { provide: DIALOG_DATA, useValue: { displayName: 'Specter', attemptJoin } },
                { provide: DisplayNameService, useValue: displayNameService },
            ],
        }).compileComponents();
        fixture = TestBed.createComponent(JoinLobbyDialogComponent);
        fixture.detectChanges();
    });

    it('shows the saved display name and spectator explanation', () => {
        const element = fixture.nativeElement as HTMLElement;
        const inputs = element.querySelectorAll<HTMLInputElement>('input');

        expect(element.textContent).toContain('spectator');
        expect(inputs[1].value).toBe('Specter');
        expect(inputs[1].maxLength).toBe(16);
    });

    it('normalizes the lobby code and closes after joining', async () => {
        const element = fixture.nativeElement as HTMLElement;
        const codeInput = element.querySelector<HTMLInputElement>('.code-field input')!;
        codeInput.value = 'A1-B2';
        codeInput.dispatchEvent(new Event('input'));
        fixture.detectChanges();

        expect(codeInput.value).toBe('a1b2');
        element.querySelector<HTMLButtonElement>('.wide-dialog-actions button')!.click();
        await fixture.whenStable();

        expect(attemptJoin).toHaveBeenCalledOnceWith('a1b2', 'Specter');
        expect(dialogRef.close).toHaveBeenCalledOnceWith(true);
    });

    it('stays open with the entered code when the lobby cannot be joined', async () => {
        attemptJoin.and.callFake(async () => {
            throw new Error('Lobby not found.');
        });
        const element = fixture.nativeElement as HTMLElement;
        const codeInput = element.querySelector<HTMLInputElement>('.code-field input')!;
        codeInput.value = 'a1b2';
        codeInput.dispatchEvent(new Event('input'));
        fixture.detectChanges();

        element.querySelector<HTMLButtonElement>('.wide-dialog-actions button')!.click();
        await fixture.whenStable();
        fixture.detectChanges();

        expect(dialogRef.close).not.toHaveBeenCalled();
        expect(element.querySelector('.join-error')?.textContent).toContain('Lobby not found.');
        expect(codeInput.value).toBe('a1b2');
        expect(codeInput.disabled).toBeFalse();

        attemptJoin.and.callFake(async () => undefined);
        element.querySelector<HTMLButtonElement>('.wide-dialog-actions button')!.click();
        await fixture.whenStable();

        expect(attemptJoin).toHaveBeenCalledTimes(2);
        expect(dialogRef.close).toHaveBeenCalledOnceWith(true);
    });

    it('uses the usual random button to generate another callsign', async () => {
        const element = fixture.nativeElement as HTMLElement;
        const randomButton = element.querySelector<HTMLButtonElement>('.random-button')!;

        randomButton.click();
        await fixture.whenStable();
        fixture.detectChanges();

        expect(displayNameService.generate).toHaveBeenCalledTimes(1);
        expect(element.querySelectorAll<HTMLInputElement>('input')[1].value).toBe('Atlas');
    });

});

