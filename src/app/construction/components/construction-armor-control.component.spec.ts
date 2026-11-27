// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
import { TestBed } from '@angular/core/testing';
import { ConstructionArmorControlComponent } from './construction-armor-control.component';

describe('construction armor allocation', () => {
    function create() {
        const fixture = TestBed.createComponent(ConstructionArmorControlComponent);
        fixture.componentRef.setInput('label', 'FRONT');
        fixture.componentRef.setInput('locationName', 'Right Torso');
        fixture.componentRef.setInput('value', 16);
        fixture.componentRef.setInput('capacity', 24);
        fixture.componentRef.setInput('reserved', 4);
        fixture.detectChanges();
        return fixture;
    }

    it('reserves opposite-facing armor in the shared location capacity', () => {
        const fixture = create();
        expect(fixture.componentInstance.maximum()).toBe(20);
        expect(fixture.nativeElement.querySelector('input[type=range]').max).toBe('20');
        expect(fixture.componentInstance.percent(12)).toBe(50);
    });

    it('previews a drag without creating an undo entry for every pointer movement', () => {
        const fixture = create();
        const changes = jasmine.createSpy('changes');
        fixture.componentInstance.valueChange.subscribe(changes);
        const range = fixture.nativeElement.querySelector('input[type=range]') as HTMLInputElement;
        range.value = '18'; range.dispatchEvent(new Event('input'));
        range.value = '19'; range.dispatchEvent(new Event('input'));
        expect(fixture.componentInstance.displayValue()).toBe(19);
        expect(changes).not.toHaveBeenCalled();
        range.dispatchEvent(new Event('change'));
        expect(changes).toHaveBeenCalledOnceWith(19);
    });

    it('caps button allocation while leaving over-limit typed drafts visible for validation', () => {
        const fixture = create();
        const changes = jasmine.createSpy('changes');
        fixture.componentInstance.valueChange.subscribe(changes);
        fixture.componentRef.setInput('value', 20);
        fixture.componentInstance.adjust(1);
        expect(changes).not.toHaveBeenCalled();
        fixture.componentRef.setInput('value', 23);
        fixture.detectChanges();
        expect(fixture.nativeElement.querySelector('.over-limit')).not.toBeNull();
        fixture.componentInstance.adjust(-1);
        expect(changes).toHaveBeenCalledOnceWith(20);
    });

    it('shows only repaired points in green, separately from remaining damage and reserved armor', () => {
        const fixture = create();
        fixture.componentRef.setInput('damage', 3);
        fixture.componentRef.setInput('pendingRepair', 5);
        fixture.detectChanges();
        const repair = fixture.nativeElement.querySelector('.armor-repair') as HTMLElement;
        expect(parseFloat(repair.style.left)).toBeCloseTo(8 / 24 * 100);
        expect(parseFloat(repair.style.width)).toBeCloseTo(5 / 24 * 100);
        expect(fixture.nativeElement.querySelector('.repair-gain').textContent).toBe('+5');
        fixture.componentRef.setInput('pendingRepair', 100);
        fixture.detectChanges();
        expect(fixture.componentInstance.repaired()).toBe(13);
    });

    it('blocks allocation changes on a fixed design while still displaying repairs', () => {
        const fixture = create();
        fixture.componentRef.setInput('disabled', true);
        fixture.componentRef.setInput('pendingRepair', 3);
        fixture.detectChanges();
        const changes = jasmine.createSpy('changes');
        fixture.componentInstance.valueChange.subscribe(changes);
        fixture.componentInstance.adjust(1);
        expect(changes).not.toHaveBeenCalled();
        expect(fixture.nativeElement.querySelector('input[type=range]').disabled).toBeTrue();
        expect(fixture.nativeElement.querySelector('button')).toBeNull();
        expect(fixture.nativeElement.querySelector('.repair-gain').textContent).toBe('+3');
    });

    it('allows a facing repair independently of locked design allocation and blocks read-only repairs', () => {
        const fixture = create();
        fixture.componentRef.setInput('disabled', true);
        fixture.componentRef.setInput('repairable', true);
        fixture.componentRef.setInput('damage', 4);
        fixture.detectChanges();
        const repairs = jasmine.createSpy('repairs');
        fixture.componentInstance.repairRequested.subscribe(repairs);
        const button = fixture.nativeElement.querySelector('button') as HTMLButtonElement;
        expect(button.getAttribute('aria-label')).toBe('Repair Right Torso front armor');
        expect(fixture.nativeElement.querySelectorAll('button').length).toBe(1);
        button.click();
        expect(repairs).toHaveBeenCalledTimes(1);
        fixture.componentRef.setInput('repairDisabled', true);
        fixture.detectChanges();
        expect(button.disabled).toBeTrue();
        fixture.componentInstance.repair();
        expect(repairs).toHaveBeenCalledTimes(1);
        fixture.componentRef.setInput('damage', 0);
        fixture.detectChanges();
        expect(fixture.nativeElement.querySelector('button')).toBeNull();
    });
});
