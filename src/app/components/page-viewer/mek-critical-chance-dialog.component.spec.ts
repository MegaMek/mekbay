// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import { DIALOG_DATA, DialogRef } from '@angular/cdk/dialog';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { MekCriticalChanceDialogComponent } from './mek-critical-chance-dialog.component';

describe('MekCriticalChanceDialogComponent', () => {
    let fixture: ComponentFixture<MekCriticalChanceDialogComponent>;

    beforeEach(async () => {
        await TestBed.configureTestingModule({
            imports: [MekCriticalChanceDialogComponent],
            providers: [
                { provide: DialogRef, useValue: { close: jasmine.createSpy('close') } },
                {
                    provide: DIALOG_DATA,
                    useValue: { locationLabel: 'Left Torso', canBlowOff: false },
                },
            ],
        }).compileComponents();
        jasmine.clock().install();
        fixture = TestBed.createComponent(MekCriticalChanceDialogComponent);
        fixture.detectChanges();
    });

    afterEach(() => {
        fixture.destroy();
        jasmine.clock().uninstall();
    });

    it('opts into Other modifiers above the dice and recomputes without rerolling', () => {
        const roller = fixture.componentInstance.roller()!;
        const modifiers = fixture.nativeElement.querySelector('.critical-roll-details') as HTMLElement;
        const otherModifier = modifiers.querySelector('.other-modifier') as HTMLElement;
        const checkbox = fixture.nativeElement.querySelector(
            '.other-modifier input[type="checkbox"]',
        ) as HTMLInputElement;

        expect(modifiers.querySelector('.roll-details-label')?.textContent.trim()).toBe('Modifiers');
        expect(otherModifier.querySelector('.modifier-location input')).toBe(checkbox);
        expect(otherModifier.querySelector('.modifier-reason')?.textContent.trim()).toBe('Other modifiers');
        expect(otherModifier.classList).toContain('inactive');
        expect(checkbox.checked).toBeFalse();
        expect(fixture.nativeElement.querySelector('.critical-modifier-controls')).toBeNull();
        expect(fixture.nativeElement.querySelector('dice-roller .modifier-value')).toBeNull();

        roller.roll([4, 5]);
        jasmine.clock().tick(500);
        fixture.detectChanges();

        expect(roller.diceResults()).toEqual([4, 5]);
        expect(fixture.componentInstance.result()).toEqual({ kind: 'critical-hits', count: 1 });
        expect(fixture.nativeElement.querySelector('input[type="number"]')).toBeNull();

        checkbox.click();
        fixture.detectChanges();
        expect(otherModifier.classList).not.toContain('inactive');
        expect(fixture.nativeElement.querySelector('.situational-modifier-value')?.textContent.trim()).toBe('+0');
        expect(fixture.nativeElement.querySelector('dice-roller .modifier-value')).toBeNull();

        const buttons = fixture.nativeElement.querySelectorAll(
            '.critical-modifier-step',
        ) as NodeListOf<HTMLButtonElement>;
        expect(buttons).toHaveSize(2);
        buttons[1].click();
        fixture.detectChanges();

        expect(roller.diceResults()).toEqual([4, 5]);
        expect(roller.diceSum()).toBe(10);
        expect(fixture.componentInstance.result()).toEqual({ kind: 'critical-hits', count: 2 });
        expect(fixture.nativeElement.querySelector('.situational-modifier-value')?.textContent.trim()).toBe('+1');
        expect(fixture.nativeElement.querySelector('dice-roller .modifier-value')?.textContent.trim()).toBe('+1');

        checkbox.click();
        fixture.detectChanges();
        expect(roller.diceResults()).toEqual([4, 5]);
        expect(roller.diceSum()).toBe(9);
        expect(fixture.componentInstance.result()).toEqual({ kind: 'critical-hits', count: 1 });
        expect(otherModifier.classList).toContain('inactive');
        expect(fixture.nativeElement.querySelector('.critical-modifier-controls')).toBeNull();
        expect(fixture.nativeElement.querySelector('dice-roller .modifier-value')).toBeNull();
    });
});

describe('MekCriticalChanceDialogComponent optional modifiers', () => {
    let fixture: ComponentFixture<MekCriticalChanceDialogComponent>;

    beforeEach(async () => {
        await TestBed.configureTestingModule({
            imports: [MekCriticalChanceDialogComponent],
            providers: [
                { provide: DialogRef, useValue: { close: jasmine.createSpy('close') } },
                {
                    provide: DIALOG_DATA,
                    useValue: {
                        locationLabel: 'Left Arm',
                        canBlowOff: true,
                        modifiers: [{
                            label: 'Hardened armor in damaged facing',
                            value: -2,
                            optional: true,
                            enabled: true,
                        }],
                    },
                },
            ],
        }).compileComponents();
        jasmine.clock().install();
        fixture = TestBed.createComponent(MekCriticalChanceDialogComponent);
        fixture.detectChanges();
    });

    afterEach(() => {
        fixture.destroy();
        jasmine.clock().uninstall();
    });

    it('keeps the optional checkbox and applied modifier synchronized after a roll', () => {
        const roller = fixture.componentInstance.roller()!;
        const hardened = fixture.nativeElement.querySelector(
            '.critical-modifier.optional input[type="checkbox"]',
        ) as HTMLInputElement;
        const hardenedRow = hardened.closest('.modifier-item') as HTMLElement;

        expect(hardenedRow.querySelector('.modifier-location input')).toBe(hardened);
        expect(hardenedRow.querySelector('.modifier-reason')?.textContent.trim())
            .toBe('Hardened armor in damaged facing');
        expect(hardenedRow.querySelector('.modifier-value')?.textContent.trim()).toBe('-2');
        expect(hardenedRow.querySelector('.modifier-value')?.classList).toContain('bonus');
        expect(hardenedRow.classList).not.toContain('inactive');
        expect(hardened.checked).toBeTrue();
        expect(fixture.componentInstance.modifierTotal()).toBe(-2);

        roller.roll([4, 5]);
        jasmine.clock().tick(500);
        fixture.detectChanges();
        expect(fixture.nativeElement.querySelector('dice-roller .modifier-value')?.textContent.trim()).toBe('−2');
        expect(fixture.componentInstance.result()).toEqual({ kind: 'none' });

        hardened.click();
        fixture.detectChanges();
        expect(hardened.checked).toBeFalse();
        expect(hardenedRow.classList).toContain('inactive');
        expect(fixture.componentInstance.modifierTotal()).toBe(0);
        expect(roller.diceSum()).toBe(9);
        expect(fixture.nativeElement.querySelector('dice-roller .modifier-value')).toBeNull();
        expect(fixture.componentInstance.result()).toEqual({ kind: 'critical-hits', count: 1 });
    });
});
