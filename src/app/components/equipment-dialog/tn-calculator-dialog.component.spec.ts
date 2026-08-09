// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import { signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { DIALOG_DATA, DialogRef } from '@angular/cdk/dialog';
import { CORE_2026_GAME_RULES, TW_GAME_RULES } from '../../models/rules/game-rules';
import { TnCalculatorDialogComponent, type TnCalculatorDialogData, type TnCalculatorDialogResult } from './tn-calculator-dialog.component';

const DATA: TnCalculatorDialogData = {
    target: {
        id: 'A',
        letter: 'A',
        name: 'Target A',
        color: '#1565C0',
        distance: 15,
        c3Distance: 12,
        useC3: true,
        tnModifier: 0
    },
    gameRules: CORE_2026_GAME_RULES,
    showC3Distance: true,
    c3Degraded: true
};

describe('TnCalculatorDialogComponent C3 degradation', () => {
    let fixture: ComponentFixture<TnCalculatorDialogComponent>;
    let component: TnCalculatorDialogComponent;
    let close: jasmine.Spy<(result: TnCalculatorDialogResult | null) => void>;

    beforeEach(async () => {
        close = jasmine.createSpy('close');
        await TestBed.configureTestingModule({
            imports: [TnCalculatorDialogComponent],
            providers: [
                { provide: DIALOG_DATA, useValue: DATA },
                { provide: DialogRef, useValue: { close } }
            ]
        }).compileComponents();
        fixture = TestBed.createComponent(TnCalculatorDialogComponent);
        component = fixture.componentInstance;
        fixture.detectChanges();
    });

    it('shows an overlay without blocking interaction while degraded', () => {
        expect(fixture.nativeElement.querySelector('.c3-distance-control').classList).toContain('c3-degraded');
        expect(fixture.nativeElement.querySelector('.c3-distance-title .c3-status-label')).not.toBeNull();
        expect(fixture.nativeElement.querySelector('.c3-distance-title').textContent.trim()).toBe('C³ Distance (DEGRADED)');
        expect(fixture.nativeElement.querySelector('.use-c3-toggle input').disabled).toBeFalse();
        expect(component.c3Enabled()).toBeTrue();
    });

    it('shows JAMMED under Total Warfare rules', () => {
        component.gameRules.set(TW_GAME_RULES);
        fixture.detectChanges();

        expect(fixture.nativeElement.querySelector('.c3-distance-title').textContent.trim()).toBe('C³ Distance (JAMMED)');
    });

    it('preserves the stored C3 choice when applying while jammed', () => {
        component.apply();

        expect(close).toHaveBeenCalledWith(jasmine.objectContaining({
            targetId: 'A',
            patch: jasmine.objectContaining({ c3Distance: 12, useC3: true })
        }));
    });

    it('allows the C3 distance to change while degraded', () => {
        component.setC3DistanceValue(5);

        expect(component.c3Distance()).toBe(5);
    });

    it('removes the overlay when degradation clears', () => {
        component.setC3Degraded(false);
        fixture.detectChanges();

        expect(fixture.nativeElement.querySelector('.c3-distance-control').classList).not.toContain('c3-degraded');
    });
});

describe('TnCalculatorDialogComponent read-only target identity', () => {
    let fixture: ComponentFixture<TnCalculatorDialogComponent>;
    let component: TnCalculatorDialogComponent;

    beforeEach(async () => {
        const data: TnCalculatorDialogData = {
            target: {
                id: 'opfor:enemy-1',
                letter: 'A',
                name: 'Achileus Light Battle Armor',
                color: '#1565C0',
                unitType: 'battle-armor',
                distance: 1,
                tnModifier: 1
            },
            gameRules: CORE_2026_GAME_RULES,
            targetStateReadOnly: true
        };
        await TestBed.configureTestingModule({
            imports: [TnCalculatorDialogComponent],
            providers: [
                { provide: DIALOG_DATA, useValue: data },
                { provide: DialogRef, useValue: { close: jasmine.createSpy('close') } }
            ]
        }).compileComponents();
        fixture = TestBed.createComponent(TnCalculatorDialogComponent);
        component = fixture.componentInstance;
        fixture.detectChanges();
    });

    it('uses the styled disabled dropdown and retains the unit modifier', () => {
        const targetType = fixture.nativeElement.querySelector('multiline-dropdown.identity-choice');
        const trigger = targetType.querySelector('.multiline-dropdown-trigger') as HTMLButtonElement;

        expect(targetType).not.toBeNull();
        expect(targetType.classList).toContain('selected');
        expect(targetType.classList).toContain('derived-target-control');
        expect(getComputedStyle(targetType).opacity).toBe('0.7');
        expect(trigger.disabled).toBeTrue();
        expect(trigger.querySelector('.multiline-dropdown-label')?.textContent?.trim()).toBe('Battle Armor');
        expect(trigger.querySelector('.modifier-badge')?.textContent?.trim()).toBe('+1');
        expect(fixture.nativeElement.querySelector('.derived-target-value')).toBeNull();
    });

    it('marks synchronized movement controls as disabled while preserving their state', () => {
        component.isAirborne.set(true);
        fixture.detectChanges();
        const movementSection = fixture.nativeElement.querySelector('.target-movement-section');
        const movementButtons = [...movementSection.querySelectorAll('.move-button')] as HTMLButtonElement[];

        expect(movementSection.classList).toContain('derived-target-state');
        expect(movementButtons.every(button => button.disabled)).toBeTrue();
        expect(movementButtons[0].classList).toContain('selected');
        expect(movementButtons[0].getAttribute('aria-pressed')).toBe('true');
    });

    it('allows shared defender cover and local woods to be edited for linked targets', () => {
        const coverGroup = fixture.nativeElement.querySelector('[aria-label="Target hex cover"]');
        const coverRow = coverGroup.closest('.choice-line');
        const coverButtons = [...coverGroup.querySelectorAll('button')] as HTMLButtonElement[];
        const woodsButtons = [...fixture.nativeElement.querySelectorAll('[aria-label="Intervening woods"] button')] as HTMLButtonElement[];

        expect(coverRow.classList).not.toContain('derived-target-state');
        expect(coverButtons.every(button => !button.disabled)).toBeTrue();
        expect(woodsButtons.every(button => !button.disabled)).toBeTrue();

        coverButtons[1].click();
        fixture.detectChanges();

        expect(component.targetHexCover()).toBe('light');
        expect(coverButtons[1].getAttribute('aria-pressed')).toBe('true');
    });

    it('rejects programmatic target-type changes while read-only', () => {
        component.selectUnitType('mek-biped');

        expect(component.unitType()).toBe('battle-armor');
    });
});

describe('TnCalculatorDialogComponent movement and stance', () => {
    it('retains independent movement, jump, and prone state', async () => {
        const close = jasmine.createSpy('close');
        const data: TnCalculatorDialogData = {
            target: {
                id: 'A',
                letter: 'A',
                name: 'Target A',
                color: '#1565C0',
                distance: 8,
                tnModifier: 0,
                tnCalculator: {
                    stance: 'prone',
                    targetMovementBracket: '7-9',
                    isAirborne: true,
                    skidding: true
                }
            },
            gameRules: TW_GAME_RULES
        };
        await TestBed.configureTestingModule({
            imports: [TnCalculatorDialogComponent],
            providers: [
                { provide: DIALOG_DATA, useValue: data },
                { provide: DialogRef, useValue: { close } }
            ]
        }).compileComponents();
        const fixture = TestBed.createComponent(TnCalculatorDialogComponent);
        const component = fixture.componentInstance;
        fixture.detectChanges();

        expect(component.stance()).toBe('prone');
        expect(component.targetMovementBracket().id).toBe('7-9');
        expect(component.isAirborne()).toBeTrue();
        expect(component.skidding()).toBeTrue();
        expect(component.totalModifier()).toBe(7);

        component.apply();

        expect(close).toHaveBeenCalledWith(jasmine.objectContaining({
            patch: jasmine.objectContaining({
                tnModifier: 7,
                tnCalculator: jasmine.objectContaining({
                    stance: 'prone',
                    targetMovementBracket: '7-9'
                })
            })
        }));
    });
});
