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
                    useValue: { locationLabel: 'Left Torso', canBlowOff: false, industrialMek: false },
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

    it('offers direct tabletop results and replaces them with the rolled result', () => {
        const roller = fixture.componentInstance.roller()!;
        const dialogRef = TestBed.inject(DialogRef) as unknown as { close: jasmine.Spy };
        const manualActions = fixture.nativeElement.querySelectorAll(
            '.critical-chance-options:not(.rolled-result-action) .bt-button',
        ) as NodeListOf<HTMLButtonElement>;

        expect(fixture.nativeElement.querySelector('.critical-manual-results-label')?.textContent.trim())
            .toBe('Criticals');
        expect(Array.from(manualActions, button => button.textContent?.trim()))
            .toEqual(['NO CRITICAL', '1', '2', '3']);
        expect(manualActions[0].classList).toContain('success');
        expect(manualActions[0].classList).not.toContain('primary');
        expect(Array.from(manualActions).slice(1).every(button => button.classList.contains('primary')))
            .toBeTrue();
        expect(fixture.nativeElement.querySelector('.critical-result-action')).toBeNull();

        manualActions[2].click();
        expect(dialogRef.close).toHaveBeenCalledOnceWith({ kind: 'critical-hits', count: 2 });

        roller.roll([4, 4]);
        jasmine.clock().tick(500);
        fixture.detectChanges();

        const rolledAction = fixture.nativeElement.querySelector('.critical-result-action') as HTMLButtonElement;
        expect(rolledAction.textContent).toContain('APPLY 1 CRITICAL');
        expect(fixture.nativeElement.querySelector(
            '.critical-chance-options:not(.rolled-result-action)',
        )).toBeNull();
    });

    it('keeps the critical table visible while the action changes to the rolled effect', () => {
        const roller = fixture.componentInstance.roller()!;
        const slot = fixture.nativeElement.querySelector('.critical-result-slot') as HTMLElement;
        const hint = slot.querySelector('.critical-table-hint') as HTMLElement;
        const initialHeight = slot.getBoundingClientRect().height;

        expect(getComputedStyle(hint).visibility).toBe('visible');

        roller.roll([4, 4]);
        jasmine.clock().tick(500);
        fixture.detectChanges();

        expect(getComputedStyle(hint).visibility).toBe('visible');
        expect(fixture.nativeElement.querySelector('.critical-result-action')?.textContent)
            .toContain('APPLY 1 CRITICAL');
        expect(slot.getBoundingClientRect().height).toBe(initialHeight);
    });

    it('keeps the previous rolled action visible and disabled while rerolling', () => {
        const roller = fixture.componentInstance.roller()!;
        const dialogRef = TestBed.inject(DialogRef) as unknown as { close: jasmine.Spy };

        roller.roll([4, 4]);
        jasmine.clock().tick(500);
        fixture.detectChanges();
        expect(fixture.nativeElement.querySelector('.critical-result-action')?.textContent)
            .toContain('APPLY 1 CRITICAL');

        fixture.componentInstance.roll();
        fixture.detectChanges();

        const previousAction = fixture.nativeElement.querySelector(
            '.critical-result-action',
        ) as HTMLButtonElement;
        expect(previousAction.textContent).toContain('APPLY 1 CRITICAL');
        expect(previousAction.disabled).toBeTrue();
        expect((fixture.nativeElement.querySelector('.random-button') as HTMLButtonElement).disabled)
            .toBeTrue();
        const randomRow = fixture.nativeElement.querySelector('.critical-random-row') as HTMLElement;
        expect(randomRow.classList).toContain('roll-disabled');
        expect(getComputedStyle(randomRow).cursor).toBe('not-allowed');
        expect(fixture.nativeElement.querySelector(
            '.critical-chance-options:not(.rolled-result-action)',
        )).toBeNull();
        previousAction.click();
        expect(dialogRef.close).not.toHaveBeenCalled();

        jasmine.clock().tick(500);
    });

    it('cannot close while rolling and preserves the completed virtual result on close', () => {
        const dialogRef = TestBed.inject(DialogRef) as unknown as { close: jasmine.Spy };
        const roller = fixture.componentInstance.roller()!;

        roller.roll([4, 4]);
        fixture.componentInstance.close();
        expect(dialogRef.close).not.toHaveBeenCalled();

        jasmine.clock().tick(500);
        fixture.detectChanges();
        expect(fixture.nativeElement.querySelector('.critical-dismiss-actions > .bt-button:last-child')
            ?.textContent.trim()).toBe('CLOSE');
        fixture.componentInstance.close();
        expect(dialogRef.close).toHaveBeenCalledOnceWith(undefined);
    });

    it('restores exact dice when a pending chance is reopened', () => {
        const data = fixture.componentInstance.data as {
            initialRoll?: readonly [number, number];
            initialResult?: { readonly kind: 'critical-hits'; readonly count: number };
            onRollChange?: (roll: readonly [number, number]) => void;
        };
        const onRollChange = jasmine.createSpy('onRollChange');
        fixture.destroy();
        data.initialRoll = [5, 3];
        data.initialResult = { kind: 'critical-hits', count: 1 };
        data.onRollChange = onRollChange;
        fixture = TestBed.createComponent(MekCriticalChanceDialogComponent);
        fixture.detectChanges();

        const roller = fixture.componentInstance.roller()!;
        expect(roller.diceResults()).toEqual([5, 3]);
        expect(roller.rollFinished()).toBeTrue();
        expect(fixture.componentInstance.result()).toEqual({ kind: 'critical-hits', count: 1 });
        expect(onRollChange).not.toHaveBeenCalled();

        roller.roll([6, 4]);
        jasmine.clock().tick(500);
        expect(onRollChange).toHaveBeenCalledOnceWith([6, 4]);
    });

    it('offers NO CRITICAL inline while CLOSE only dismisses the dialog', () => {
        const dialogRef = TestBed.inject(DialogRef) as unknown as { close: jasmine.Spy };
        const manualActions = fixture.nativeElement.querySelectorAll(
            '.critical-chance-options:not(.rolled-result-action) .bt-button',
        ) as NodeListOf<HTMLButtonElement>;

        manualActions[0].click();
        expect(dialogRef.close).toHaveBeenCalledOnceWith({ kind: 'none' });
        dialogRef.close.calls.reset();
        fixture.componentInstance.close();

        expect(dialogRef.close).toHaveBeenCalledOnceWith(undefined);
    });

    it('labels dismissal as CANCEL for a transient manual chance', () => {
        const dialogRef = TestBed.inject(DialogRef) as unknown as { close: jasmine.Spy };
        const data = fixture.componentInstance.data as { manual?: boolean };
        fixture.destroy();
        data.manual = true;
        fixture = TestBed.createComponent(MekCriticalChanceDialogComponent);
        fixture.detectChanges();

        const cancel = fixture.nativeElement.querySelector(
            '.critical-dismiss-actions > .bt-button:last-child',
        ) as HTMLButtonElement;
        expect(cancel.textContent.trim()).toBe('CANCEL');

        cancel.click();
        expect(dialogRef.close).toHaveBeenCalledOnceWith(undefined);
    });

    it('keeps the manual 3 choice as three critical hits for a torso', () => {
        const dialogRef = TestBed.inject(DialogRef) as unknown as { close: jasmine.Spy };
        const manualActions = fixture.nativeElement.querySelectorAll(
            '.critical-chance-options:not(.rolled-result-action) .bt-button',
        ) as NodeListOf<HTMLButtonElement>;

        manualActions[3].click();

        expect(dialogRef.close).toHaveBeenCalledOnceWith({ kind: 'critical-hits', count: 3 });
    });

    it('starts the same roll from the random control or the dice', () => {
        const roller = fixture.componentInstance.roller()!;
        const roll = spyOn(roller, 'roll');
        const element = fixture.nativeElement as HTMLElement;

        element.querySelector<HTMLButtonElement>('.random-button')!.click();
        element.querySelector<HTMLElement>('.critical-dice-trigger')!.click();

        expect(roll).toHaveBeenCalledTimes(2);
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
                        industrialMek: false,
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

    it('maps the manual 3 choice to blown-off for locations that can blow off', () => {
        const dialogRef = TestBed.inject(DialogRef) as unknown as { close: jasmine.Spy };
        const manualActions = fixture.nativeElement.querySelectorAll(
            '.critical-chance-options:not(.rolled-result-action) .bt-button',
        ) as NodeListOf<HTMLButtonElement>;

        expect(Array.from(manualActions, button => button.textContent?.trim()))
            .toEqual(['NO CRITICAL', '1', '2', 'BLOWN OFF']);

        manualActions[3].click();

        expect(dialogRef.close).toHaveBeenCalledOnceWith({ kind: 'blown-off' });
    });
});

describe('MekCriticalChanceDialogComponent IndustrialMech table', () => {
    let fixture: ComponentFixture<MekCriticalChanceDialogComponent>;

    beforeEach(async () => {
        await TestBed.configureTestingModule({
            imports: [MekCriticalChanceDialogComponent],
            providers: [
                { provide: DialogRef, useValue: { close: jasmine.createSpy('close') } },
                {
                    provide: DIALOG_DATA,
                    useValue: {
                        locationLabel: 'Left Torso',
                        canBlowOff: false,
                        industrialMek: true,
                        modifiers: [{ label: 'IndustrialMech', value: 2 }],
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

    it('keeps the four explicit manual choices and resolves a modified 14 without clamping to 12', () => {
        const manualActions = fixture.nativeElement.querySelectorAll(
            '.critical-chance-options:not(.rolled-result-action) .bt-button',
        ) as NodeListOf<HTMLButtonElement>;
        expect(Array.from(manualActions, button => button.textContent?.trim()))
            .toEqual(['NO CRITICAL', '1', '2', '3']);

        fixture.componentInstance.roller()!.roll([6, 6]);
        jasmine.clock().tick(500);
        fixture.detectChanges();

        expect(fixture.componentInstance.result()).toEqual({ kind: 'critical-hits', count: 4 });
        expect(fixture.nativeElement.querySelector('.critical-result-action')?.textContent)
            .toContain('APPLY 4 CRITICALS');
    });
});
