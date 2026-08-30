// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import { TestBed } from '@angular/core/testing';
import { DiceRollerComponent } from './dice-roller.component';

describe('DiceRollerComponent', () => {
    beforeEach(async () => {
        await TestBed.configureTestingModule({
            imports: [DiceRollerComponent],
        }).compileComponents();
        jasmine.clock().install();
    });

    afterEach(() => jasmine.clock().uninstall());

    it('initializes the configured number of dice', () => {
        const fixture = TestBed.createComponent(DiceRollerComponent);
        fixture.componentRef.setInput('diceCount', 3);
        fixture.detectChanges();

        expect(fixture.componentInstance.diceResults()).toEqual([null, null, null]);
        expect(fixture.nativeElement.querySelectorAll('.die')).toHaveSize(3);
    });

    it('displays restored faces as a completed roll without emitting it again', () => {
        const fixture = TestBed.createComponent(DiceRollerComponent);
        const finished = jasmine.createSpy('finished');
        fixture.componentInstance.finished.subscribe(finished);
        fixture.componentRef.setInput('initialResults', [5, 2]);
        fixture.detectChanges();

        expect(fixture.componentInstance.diceResults()).toEqual([5, 2]);
        expect(fixture.componentInstance.diceSum()).toBe(7);
        expect(fixture.componentInstance.rollFinished()).toBeTrue();
        expect(finished).not.toHaveBeenCalled();

        fixture.componentRef.setInput('initialResults', null);
        fixture.detectChanges();
        expect(fixture.componentInstance.diceResults()).toEqual([null, null]);
        expect(fixture.componentInstance.rollFinished()).toBeFalse();
        fixture.destroy();
    });

    it('rolls deterministic dice, applies the modifier, and emits once', () => {
        spyOn(Math, 'random').and.returnValue(0.5);
        const fixture = TestBed.createComponent(DiceRollerComponent);
        fixture.componentRef.setInput('modifier', 2);
        fixture.componentRef.setInput('rollDurationMs', 100);
        fixture.componentRef.setInput('animationIntervalMs', 25);
        fixture.detectChanges();
        const finished = jasmine.createSpy('finished');
        fixture.componentInstance.finished.subscribe(finished);

        fixture.componentInstance.roll();
        fixture.componentInstance.roll();
        jasmine.clock().tick(100);

        expect(fixture.componentInstance.diceResults()).toEqual([4, 4]);
        expect(fixture.componentInstance.diceSum()).toBe(10);
        expect(finished).toHaveBeenCalledOnceWith({ results: [4, 4], sum: 10 });
        fixture.destroy();
    });

    it('renders only a non-zero signed modifier without editing controls', () => {
        const fixture = TestBed.createComponent(DiceRollerComponent);
        fixture.componentRef.setInput('modifier', 0);
        fixture.detectChanges();
        expect(fixture.nativeElement.querySelector('.modifier-value')).toBeNull();
        expect(fixture.nativeElement.querySelector('button')).toBeNull();

        fixture.componentRef.setInput('modifier', 2);
        fixture.detectChanges();
        expect(fixture.nativeElement.querySelector('.modifier-value')?.textContent.trim()).toBe('+2');

        fixture.componentRef.setInput('modifier', -2);
        fixture.detectChanges();
        expect(fixture.nativeElement.querySelector('.modifier-value')?.textContent.trim()).toBe('−2');
        fixture.destroy();
    });

    it('recomputes a completed roll when its modifier changes', () => {
        const fixture = TestBed.createComponent(DiceRollerComponent);
        fixture.componentRef.setInput('rollDurationMs', 0);
        fixture.detectChanges();

        fixture.componentInstance.roll([3, 4]);
        jasmine.clock().tick(0);
        expect(fixture.componentInstance.diceSum()).toBe(7);

        fixture.componentRef.setInput('modifier', 2);
        fixture.detectChanges();
        expect(fixture.componentInstance.diceResults()).toEqual([3, 4]);
        expect(fixture.componentInstance.diceSum()).toBe(9);
        fixture.destroy();
    });

    it('finishes an overlay roll on tap, keeps the result open, and emits when it closes', () => {
        spyOn(Math, 'random').and.returnValue(0);
        const fixture = TestBed.createComponent(DiceRollerComponent);
        fixture.componentRef.setInput('showOverlay', true);
        fixture.componentRef.setInput('showInline', false);
        fixture.componentRef.setInput('reserveOverlayResultSpace', true);
        fixture.componentRef.setInput('overlayResult', 'RT');
        fixture.componentRef.setInput('compactOverlayResult', true);
        fixture.componentRef.setInput('overlayResultTone', 'success');
        fixture.componentRef.setInput('overlayCloseHint', 'Click to return to pilot checks');
        fixture.componentRef.setInput('rollDurationMs', 100);
        fixture.componentRef.setInput('animationIntervalMs', 25);
        fixture.detectChanges();
        const overlayClosed = jasmine.createSpy('overlayClosed');
        const finished = jasmine.createSpy('finished');
        fixture.componentInstance.overlayClosed.subscribe(overlayClosed);
        fixture.componentInstance.finished.subscribe(finished);

        fixture.componentInstance.roll();
        fixture.detectChanges();
        const pendingResult = fixture.nativeElement.querySelector('.overlay-result') as HTMLElement;
        const pendingHint = fixture.nativeElement.querySelector('.overlay-hint') as HTMLElement;
        expect(pendingResult).not.toBeNull();
        expect(pendingResult.classList).toContain('pending');
        expect(pendingResult.textContent?.trim()).toBe('');
        expect(pendingHint).not.toBeNull();
        expect(pendingHint.textContent?.trim()).toBe('Tap or click to reveal the result');
        const overlay = fixture.nativeElement.querySelector('.dice-overlay') as HTMLElement;
        expect(overlay.classList).toContain('can-finish');
        overlay.click();
        expect(fixture.componentInstance.isRolling()).toBeFalse();
        expect(fixture.componentInstance.diceResults()).toEqual([1, 1]);
        expect(fixture.componentInstance.overlayVisible()).toBeTrue();
        expect(overlayClosed).not.toHaveBeenCalled();
        expect(finished).toHaveBeenCalledOnceWith({ results: [1, 1], sum: 2 });

        jasmine.clock().tick(100);
        expect(finished).toHaveBeenCalledTimes(1);
        fixture.detectChanges();
        const result = fixture.nativeElement.querySelector('.overlay-result') as HTMLElement;
        expect(result.textContent?.trim()).toBe('RT');
        expect(result.classList).not.toContain('pending');
        expect(result.classList).toContain('compact');
        expect(result.classList).toContain('success');
        expect(result.classList).not.toContain('failed');
        expect((fixture.nativeElement.querySelector('.overlay-hint') as HTMLElement).textContent?.trim())
            .toBe('Click to return to pilot checks');
        expect(fixture.nativeElement.querySelector('.overlay-sum')).toBeNull();
        expect(fixture.nativeElement.querySelector('.dice-row')).toBeNull();

        fixture.componentInstance.onOverlayBackgroundClick();
        expect(fixture.componentInstance.overlayVisible()).toBeFalse();
        expect(overlayClosed).toHaveBeenCalledTimes(1);
        fixture.destroy();
    });

    it('honors the post-roll overlay freeze', () => {
        spyOn(Math, 'random').and.returnValue(0);
        const fixture = TestBed.createComponent(DiceRollerComponent);
        fixture.componentRef.setInput('showOverlay', true);
        fixture.componentRef.setInput('rollDurationMs', 50);
        fixture.componentRef.setInput('animationIntervalMs', 10);
        fixture.componentRef.setInput('freezeOnRollEnd', 100);
        fixture.detectChanges();

        fixture.componentInstance.roll();
        jasmine.clock().tick(50);
        fixture.detectChanges();
        expect(fixture.nativeElement.querySelector('.overlay-hint')).toBeNull();
        fixture.componentInstance.onOverlayBackgroundClick();
        expect(fixture.componentInstance.overlayVisible()).toBeTrue();

        jasmine.clock().tick(100);
        fixture.componentInstance.onOverlayBackgroundClick();
        expect(fixture.componentInstance.overlayVisible()).toBeFalse();
        fixture.destroy();
    });

    it('animates before settling on requested final faces', () => {
        spyOn(Math, 'random').and.returnValue(0);
        const fixture = TestBed.createComponent(DiceRollerComponent);
        fixture.componentRef.setInput('rollDurationMs', 100);
        fixture.componentRef.setInput('animationIntervalMs', 25);
        fixture.detectChanges();
        const finished = jasmine.createSpy('finished');
        fixture.componentInstance.finished.subscribe(finished);

        fixture.componentInstance.roll([5, 2]);
        jasmine.clock().tick(25);
        expect(fixture.componentInstance.diceResults()).toEqual([1, 1]);

        jasmine.clock().tick(75);
        expect(fixture.componentInstance.diceResults()).toEqual([5, 2]);
        expect(finished).toHaveBeenCalledOnceWith({ results: [5, 2], sum: 7 });
        fixture.destroy();
    });

    it('can present dice as separate values without sum notation', () => {
        const fixture = TestBed.createComponent(DiceRollerComponent);
        fixture.componentRef.setInput('showSum', false);
        fixture.componentRef.setInput('rollDurationMs', 0);
        fixture.detectChanges();

        fixture.componentInstance.roll([2, 6]);
        jasmine.clock().tick(0);
        fixture.detectChanges();

        expect(fixture.nativeElement.querySelectorAll('.die')).toHaveSize(2);
        expect(fixture.nativeElement.querySelector('.plus-sign')).toBeNull();
        expect(fixture.nativeElement.querySelector('.sum')).toBeNull();
        fixture.destroy();
    });

    it('supports one die with a different number of sides', () => {
        spyOn(Math, 'random').and.returnValue(0.999);
        const fixture = TestBed.createComponent(DiceRollerComponent);
        fixture.componentRef.setInput('diceCount', 1);
        fixture.componentRef.setInput('diceSides', 20);
        fixture.componentRef.setInput('rollDurationMs', 20);
        fixture.componentRef.setInput('animationIntervalMs', 10);
        fixture.detectChanges();

        fixture.componentInstance.roll();
        jasmine.clock().tick(20);

        expect(fixture.componentInstance.diceResults()).toEqual([20]);
        expect(fixture.componentInstance.diceSum()).toBe(20);
        fixture.destroy();
    });

    it('generates valid final faces when the roll ends before the first animation frame', () => {
        spyOn(Math, 'random').and.returnValue(0.5);
        const fixture = TestBed.createComponent(DiceRollerComponent);
        fixture.componentRef.setInput('rollDurationMs', 10);
        fixture.componentRef.setInput('animationIntervalMs', 100);
        fixture.detectChanges();
        const finished = jasmine.createSpy('finished');
        fixture.componentInstance.finished.subscribe(finished);

        fixture.componentInstance.roll();
        jasmine.clock().tick(10);

        expect(fixture.componentInstance.diceResults()).toEqual([4, 4]);
        expect(finished).toHaveBeenCalledOnceWith({ results: [4, 4], sum: 8 });
        fixture.destroy();
    });
});
