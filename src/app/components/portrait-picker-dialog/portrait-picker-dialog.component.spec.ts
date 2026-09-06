// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { DIALOG_DATA, DialogRef } from '@angular/cdk/dialog';
import { of } from 'rxjs';
import type { PortraitManifest } from '../../models/portrait.model';
import { PortraitService } from '../../services/portrait.service';
import { DialogsService } from '../../services/dialogs.service';
import { PilotPortraitFieldComponent } from '../pilot-portrait-field/pilot-portrait-field.component';
import { CrewPortraitComponent } from '../crew-portrait/crew-portrait.component';
import { PortraitPickerDialogComponent } from './portrait-picker-dialog.component';

describe('portrait selection', () => {
    const manifest: PortraitManifest = { width: 128, height: 160, sheets: {
        'male-1': { url: 'male.webp', hash: 'male', width: 260, height: 324 },
        'female-1': { url: 'female.webp', hash: 'female', width: 130, height: 162 },
    }, portraits: {
        Administrator_M_1: { sheet: 'male-1', set: 'Male', category: 'Administrator', x: 1, y: 1 },
        Doctor_M_8: { sheet: 'male-1', set: 'Male', category: 'Doctor', x: 131, y: 1 },
        Doctor_M_2: { sheet: 'male-1', set: 'Male', category: 'Doctor', x: 1, y: 163 },
        Doctor_F_1: { sheet: 'female-1', set: 'Female', category: 'Doctor', x: 1, y: 1 },
    } };
    let service: { manifest: ReturnType<typeof signal<PortraitManifest>>; initialize: jasmine.Spy; loadSheet: jasmine.Spy;
        loadPortrait: jasmine.Spy; sheetUrl: jasmine.Spy };
    let close: jasmine.Spy;
    let dialogs: jasmine.SpyObj<DialogsService>;
    beforeEach(() => {
        service = { manifest: signal(manifest), initialize: jasmine.createSpy().and.resolveTo(),
            loadSheet: jasmine.createSpy().and.resolveTo('blob:test'), loadPortrait: jasmine.createSpy().and.resolveTo(),
            sheetUrl: jasmine.createSpy().and.returnValue(undefined) };
        close = jasmine.createSpy('close');
        dialogs = jasmine.createSpyObj('DialogsService', ['createDialog']);
        TestBed.configureTestingModule({ providers: [
            { provide: PortraitService, useValue: service }, { provide: DIALOG_DATA, useValue: {} },
            { provide: DialogRef, useValue: { close } }, { provide: DialogsService, useValue: dialogs },
        ] });
    });

    it('shows folder accordions within each tab, selects a key, and distinguishes removal from cancellation', async () => {
        const fixture = TestBed.createComponent(PortraitPickerDialogComponent);
        await fixture.whenStable();
        expect(fixture.componentInstance.categories().map(category => category.name)).toEqual(['Administrator', 'Doctor']);
        expect(service.loadSheet).toHaveBeenCalledOnceWith('male-1');
        const category = [...fixture.nativeElement.querySelectorAll('.category-title')]
            .find((button: any) => button.textContent.includes('Doctor')) as HTMLButtonElement;
        category.click();
        await fixture.whenStable();
        expect(category.getAttribute('aria-expanded')).toBe('true');
        expect([...fixture.nativeElement.querySelectorAll('.portrait-choice')].map((button: any) => button.title))
            .toEqual(['Administrator_M_1', 'Doctor_M_2', 'Doctor_M_8']);
        fixture.nativeElement.querySelector('[title="Doctor_M_8"]').click();
        expect(close).toHaveBeenCalledWith('Doctor_M_8');
        fixture.nativeElement.querySelector('#portrait-tab-Female').click();
        await fixture.whenStable();
        expect(service.loadSheet).toHaveBeenCalledWith('female-1');
        expect(fixture.nativeElement.querySelector('[title="Doctor_F_1"]')).not.toBeNull();
        const actions = fixture.nativeElement.querySelectorAll('.wide-dialog-actions button');
        actions[0].click();
        expect(close.calls.mostRecent().args).toEqual([null]);
        actions[1].click();
        expect(close.calls.mostRecent().args).toEqual([]);
    });

    it('opens the selected portrait category and tab and retries failed sheet downloads', async () => {
        TestBed.overrideProvider(DIALOG_DATA, { useValue: { portrait: 'Doctor_F_1' } });
        service.loadSheet.and.rejectWith(new Error('offline'));
        const fixture = TestBed.createComponent(PortraitPickerDialogComponent);
        await fixture.whenStable();
        expect(fixture.componentInstance.activeSet()).toBe('Female');
        expect(fixture.nativeElement.querySelector('[role="alert"]').textContent).toContain('sheet could not be loaded');
        service.loadSheet.and.resolveTo('blob:test');
        fixture.componentInstance.retrySheets();
        await fixture.whenStable();
        expect(fixture.nativeElement.querySelector('[title="Doctor_F_1"]').getAttribute('aria-pressed')).toBe('true');
    });

    it('updates the editor field only when choosing or removing a portrait', async () => {
        const fixture = TestBed.createComponent(PilotPortraitFieldComponent);
        fixture.componentRef.setInput('value', 'Doctor_M_8');
        await fixture.whenStable();
        const event = { currentTarget: fixture.nativeElement.querySelector('button') } as unknown as Event;
        dialogs.createDialog.and.returnValue({ closed: of(undefined) } as never);
        await fixture.componentInstance.select(event);
        expect(fixture.componentInstance.value()).toBe('Doctor_M_8');
        dialogs.createDialog.and.returnValue({ closed: of('Doctor_F_1') } as never);
        await fixture.componentInstance.select(event);
        expect(fixture.componentInstance.value()).toBe('Doctor_F_1');
        dialogs.createDialog.and.returnValue({ closed: of(null) } as never);
        await fixture.componentInstance.select(event);
        expect(fixture.componentInstance.value()).toBeUndefined();
    });

    it('keeps the helmet without fetching for an empty portrait and crops a selected portrait at the requested size', async () => {
        const fixture = TestBed.createComponent(CrewPortraitComponent);
        await fixture.whenStable();
        expect(service.loadPortrait).not.toHaveBeenCalled();
        expect(fixture.nativeElement.querySelector('.placeholder')).not.toBeNull();
        const imageUrl = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';
        service.sheetUrl.and.returnValue(imageUrl);
        fixture.componentRef.setInput('width', 64);
        fixture.componentRef.setInput('name', 'Doctor_M_8');
        await fixture.whenStable();
        expect(fixture.componentInstance.sprite()).toEqual({ url: imageUrl, width: 130, height: 162, left: -65.5, top: -0.5 });
        fixture.nativeElement.querySelector('.sheet').dispatchEvent(new Event('load'));
        await fixture.whenStable();
        expect(fixture.nativeElement.querySelector('.placeholder')).toBeNull();
        fixture.componentRef.setInput('name', 'Missing_M_1');
        await fixture.whenStable();
        expect(fixture.nativeElement.querySelector('.placeholder')).not.toBeNull();
    });
});
