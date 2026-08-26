// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

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
                { provide: DIALOG_DATA, useValue: { locationLabel: 'Left Torso', canBlowOff: false } },
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

    it('reserves the full-row action and reveals it only for an applicable result', () => {
        const roller = fixture.componentInstance.roller()!;
        const action = fixture.nativeElement.querySelector('.critical-action') as HTMLButtonElement;

        expect(action.parentElement?.classList).toContain('critical-chance-actions');
        expect(action.disabled).toBeTrue();
        expect(getComputedStyle(action).visibility).toBe('hidden');

        roller.roll([1, 1]);
        jasmine.clock().tick(500);
        fixture.detectChanges();
        expect(action.disabled).toBeTrue();
        expect(getComputedStyle(action).visibility).toBe('hidden');

        roller.roll([4, 4]);
        jasmine.clock().tick(500);
        fixture.detectChanges();
        expect(action.disabled).toBeFalse();
        expect(getComputedStyle(action).visibility).toBe('visible');
    });

    it('keeps the result area height stable when replacing the table hint', () => {
        const roller = fixture.componentInstance.roller()!;
        const slot = fixture.nativeElement.querySelector('.critical-result-slot') as HTMLElement;
        const result = slot.querySelector('.critical-result') as HTMLElement;
        const hint = slot.querySelector('.critical-table-hint') as HTMLElement;
        const initialHeight = slot.getBoundingClientRect().height;

        expect(getComputedStyle(result).visibility).toBe('hidden');
        expect(getComputedStyle(hint).visibility).toBe('visible');
        roller.roll([4, 4]);
        jasmine.clock().tick(500);
        fixture.detectChanges();

        expect(getComputedStyle(result).visibility).toBe('visible');
        expect(getComputedStyle(hint).visibility).toBe('hidden');
        expect(slot.getBoundingClientRect().height).toBe(initialHeight);
    });

    it('recomputes a completed roll when situational modifiers change', () => {
        const roller = fixture.componentInstance.roller()!;
        const checkbox = fixture.nativeElement.querySelector(
            '.other-modifier input[type="checkbox"]',
        ) as HTMLInputElement;

        roller.roll([4, 5]);
        jasmine.clock().tick(500);
        fixture.detectChanges();
        expect(fixture.componentInstance.result()).toEqual({ kind: 'critical-hits', count: 1 });

        checkbox.click();
        fixture.detectChanges();
        const increase = fixture.nativeElement.querySelectorAll(
            '.critical-modifier-step',
        )[1] as HTMLButtonElement;
        increase.click();
        fixture.detectChanges();

        expect(roller.diceResults()).toEqual([4, 5]);
        expect(roller.diceSum()).toBe(10);
        expect(fixture.componentInstance.result()).toEqual({ kind: 'critical-hits', count: 2 });
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

    it('keeps the optional checkbox and applied modifier synchronized', () => {
        const roller = fixture.componentInstance.roller()!;
        const hardened = fixture.nativeElement.querySelector(
            '.critical-modifier.optional input[type="checkbox"]',
        ) as HTMLInputElement;

        expect(hardened.checked).toBeTrue();
        expect(fixture.componentInstance.modifierTotal()).toBe(-2);
        roller.roll([4, 5]);
        jasmine.clock().tick(500);
        fixture.detectChanges();
        expect(fixture.componentInstance.result()).toEqual({ kind: 'none' });

        hardened.click();
        fixture.detectChanges();
        expect(hardened.checked).toBeFalse();
        expect(fixture.componentInstance.modifierTotal()).toBe(0);
        expect(roller.diceSum()).toBe(9);
        expect(fixture.componentInstance.result()).toEqual({ kind: 'critical-hits', count: 1 });
    });
});
