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
