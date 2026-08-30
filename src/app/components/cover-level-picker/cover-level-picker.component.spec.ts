// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import { OverlayContainer } from '@angular/cdk/overlay';
import { ComponentPortal } from '@angular/cdk/portal';
import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { OverlayManagerService } from '../../services/overlay-manager.service';
import { CoverLevelPickerComponent } from './cover-level-picker.component';

@Component({
    standalone: true,
    imports: [CoverLevelPickerComponent],
    template: `
        <cover-level-picker
            kind="building"
            [value]="value()"
            (valueChange)="value.set($event)"
        />
    `,
})
export class CoverLevelPickerHostComponent {
    readonly value = signal('');
}

describe('CoverLevelPickerComponent', () => {
    let overlayContainer: HTMLElement;

    beforeEach(async () => {
        await TestBed.configureTestingModule({ imports: [CoverLevelPickerComponent] }).compileComponents();
        overlayContainer = TestBed.inject(OverlayContainer).getContainerElement();
        overlayContainer.innerHTML = '';
    });

    it('owns the water depth choices and emits a selection', () => {
        const fixture = TestBed.createComponent(CoverLevelPickerComponent);
        fixture.componentRef.setInput('kind', 'water');
        fixture.componentRef.setInput('value', '');
        let selected = '';
        fixture.componentInstance.valueChange.subscribe(value => selected = value);
        fixture.detectChanges();

        const trigger = fixture.nativeElement.querySelector('.cover-trigger') as HTMLButtonElement;
        expect(trigger.classList).not.toContain('selected');
        trigger.click();
        fixture.detectChanges();

        const options = overlayContainer.querySelectorAll('.cover-option') as NodeListOf<HTMLButtonElement>;
        expect(options.length).toBe(3);
        expect(options[0].textContent?.trim()).toBe('1');
        expect(options[0].classList).toContain('keyboard-active');
        options[1].click();
        fixture.detectChanges();

        expect(selected).toBe('underwater-depth-2');
        expect(fixture.componentInstance.open()).toBeFalse();
    });

    it('renders the selected building level', () => {
        const fixture = TestBed.createComponent(CoverLevelPickerComponent);
        fixture.componentRef.setInput('kind', 'building');
        fixture.componentRef.setInput('value', 'building-3');
        fixture.detectChanges();

        const trigger = fixture.nativeElement.querySelector('.cover-trigger') as HTMLButtonElement;
        expect(trigger.classList).toContain('selected');
        expect(trigger.textContent?.trim()).toBe('3');
    });

    it('keeps option clicks alive inside a managed parent overlay', () => {
        const overlayManager = TestBed.inject(OverlayManagerService);
        const origin = document.createElement('button');
        document.body.appendChild(origin);
        const parentKey = 'cover-level-picker-parent-test';

        try {
            const parent = overlayManager.createManagedOverlay(
                parentKey,
                origin,
                new ComponentPortal(CoverLevelPickerHostComponent),
                { closeOnOutsideClick: true, disableCloseForMs: 0 },
            );
            parent.componentRef.changeDetectorRef.detectChanges();

            const trigger = overlayContainer.querySelector('.cover-trigger') as HTMLButtonElement;
            trigger.click();
            parent.componentRef.changeDetectorRef.detectChanges();

            const options = overlayContainer.querySelectorAll('.cover-option') as NodeListOf<HTMLButtonElement>;
            options[2].click();
            parent.componentRef.changeDetectorRef.detectChanges();

            expect(parent.componentRef.instance.value()).toBe('building-3');
        } finally {
            overlayManager.closeManagedOverlay(parentKey);
            origin.remove();
        }
    });
});
