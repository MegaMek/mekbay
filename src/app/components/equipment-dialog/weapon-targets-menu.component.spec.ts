// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import { ComponentFixture, TestBed } from '@angular/core/testing';
import type { InventoryControlRuntimeTarget } from '../../models/inventory-control-runtime-state.model';
import { WeaponTargetsMenuComponent } from './weapon-targets-menu.component';

const TARGET: InventoryControlRuntimeTarget = {
    id: 'A',
    letter: 'A',
    name: 'Target A',
    color: '#1565C0',
    distance: 15,
    c3Distance: 12,
    useC3: true,
    tnModifier: 0
};

describe('WeaponTargetsMenuComponent C3 degradation', () => {
    let fixture: ComponentFixture<WeaponTargetsMenuComponent>;
    let component: WeaponTargetsMenuComponent;

    beforeEach(async () => {
        await TestBed.configureTestingModule({ imports: [WeaponTargetsMenuComponent] }).compileComponents();
        fixture = TestBed.createComponent(WeaponTargetsMenuComponent);
        component = fixture.componentInstance;
        fixture.componentRef.setInput('targets', [TARGET]);
        fixture.componentRef.setInput('showC3Distance', true);
    });

    it('shows the JAMMED overlay without disabling C3 controls', () => {
        fixture.componentRef.setInput('c3Degraded', true);
        fixture.detectChanges();

        expect(fixture.nativeElement.querySelector('.target-c3-controls').classList).toContain('c3-degraded');
        expect(fixture.nativeElement.querySelector('.c3-distance-caption').textContent.trim()).toBe('C³ Distance (DEGRADED)');
        expect(fixture.nativeElement.querySelector('.c3-distance-caption .c3-status-label')).not.toBeNull();
        expect(fixture.nativeElement.querySelector('.use-c3-toggle input').disabled).toBeFalse();
        expect(component.c3Enabled(TARGET)).toBeTrue();
        expect(component.c3DistanceInputValue(TARGET)).toBe(12);
    });

    it('shows JAMMED when Total Warfare fully blocks C3', () => {
        fixture.componentRef.setInput('c3Degraded', true);
        fixture.componentRef.setInput('c3DegradationLabel', 'JAMMED');
        fixture.detectChanges();

        expect(fixture.nativeElement.querySelector('.c3-distance-caption').textContent.trim()).toBe('C³ Distance (JAMMED)');
    });

    it('spans the C3 caption across the distance and preference columns', () => {
        fixture.detectChanges();

        const controls = fixture.nativeElement.querySelector('.target-c3-controls') as HTMLElement;
        const caption = fixture.nativeElement.querySelector('.c3-distance-caption') as HTMLElement;
        const fields = fixture.nativeElement.querySelector('.c3-fields') as HTMLElement;

        expect(fields.parentElement).toBe(controls);
        expect(caption.parentElement).toBe(fields);
        expect(getComputedStyle(controls).display).toBe('flex');
        expect(getComputedStyle(fields).display).toBe('grid');
        expect(getComputedStyle(caption).gridColumnStart).toBe('1');
        expect(getComputedStyle(caption).gridColumnEnd).toBe('3');
    });

    it('allows the stored C3 preference to be changed while degraded', () => {
        fixture.componentRef.setInput('c3Degraded', true);
        const emitted = jasmine.createSpy('updateRequest');
        component.updateRequest.subscribe(emitted);

        component.updateUseC3(TARGET, { target: { checked: false } } as unknown as Event);

        expect(emitted).toHaveBeenCalledWith({ targetId: 'A', patch: { useC3: false } });
    });

    it('blocks C3 controls for a persisted indirect-fire target', () => {
        const indirectTarget = { ...TARGET, tnCalculator: { indirectFire: true } };
        fixture.componentRef.setInput('targets', [indirectTarget]);
        const emitted = jasmine.createSpy('updateRequest');
        component.updateRequest.subscribe(emitted);
        fixture.detectChanges();

        expect(fixture.nativeElement.querySelector('.use-c3-toggle input').disabled).toBeTrue();
        expect(component.c3Enabled(indirectTarget)).toBeFalse();

        component.updateUseC3(indirectTarget, { target: { checked: true } } as unknown as Event);

        expect(emitted).not.toHaveBeenCalled();
    });

    it('marks direct TN edits as manual overrides', () => {
        const emitted = jasmine.createSpy('updateRequest');
        component.updateRequest.subscribe(emitted);

        component.updateTnModifier(TARGET.id, '3');
        component.stepTnModifier(TARGET, 1);

        expect(emitted.calls.allArgs()).toEqual([
            [{ targetId: 'A', patch: { tnModifier: 3 }, manualTnOverride: true }],
            [{ targetId: 'A', patch: { tnModifier: 1 }, manualTnOverride: true }]
        ]);
    });

    it('renders calculator modifier pills (no distance or C3 values)', () => {
        const target = {
            ...TARGET,
            unitType: 'battle-armor' as const,
            tnCalculator: {
                isAirborne: true,
                targetMovementBracket: '7-9' as const,
                skidding: true,
                interveningWoods: 'light1' as const,
                targetHexCover: 'heavy' as const,
                partialCover: true,
                secondaryTarget: true,
                indirectFire: true,
                spotterMoveMode: 'run' as const,
                spotterDeclaredAttacks: true,
            },
        };
        fixture.componentRef.setInput('targets', [target]);
        fixture.detectChanges();

        const pillContainer = fixture.nativeElement.querySelector('.target-modifier-pills:not(.target-modifier-pills-fallback)') as HTMLElement;
        const pills = [...pillContainer.querySelectorAll('.target-modifier-pill')].map(pill => ({
            label: pill.querySelector('.modifier-label')?.textContent?.trim(),
            modifier: pill.querySelector('.modifier-badge')?.textContent?.trim(),
        }));

        expect(pills).toEqual([
            { label: 'Battle Armor', modifier: '+1' },
            { label: 'Airborne', modifier: '+1' },
            { label: 'Moved 7-9', modifier: '+3' },
            { label: 'Skidding', modifier: '+2' },
            { label: 'LoS', modifier: '+1' },
            { label: 'Heavy Wood', modifier: '+2' },
            { label: 'Partial Cover', modifier: '+1' },
            { label: 'Secondary', modifier: '+1' },
            { label: 'Indirect', modifier: '+1' },
            { label: 'Spotter', modifier: '+3' },
        ]);
        expect(pillContainer.querySelectorAll('.target-modifier-pill .modifier-badge').length).toBe(pills.length);
        expect(fixture.nativeElement.querySelector('.target-number-field').textContent).toContain('Distance');
        expect(pillContainer.textContent).not.toContain('Distance');
        expect(pillContainer.textContent).not.toContain('C3');
    });

    it('hides calculator modifier pills for manual TN overrides', () => {
        expect(component.targetModifierPills({
            ...TARGET,
            manualTnModifier: 3,
            tnCalculator: {
                prone: true,
                partialCover: true,
            },
        })).toEqual([]);
    });

    it('shows water partial cover at adjacent range', () => {
        expect(component.targetModifierPills({
            ...TARGET,
            unitType: 'mek-biped',
            distance: 1,
            tnCalculator: { waterPartialCover: true },
        })).toEqual([{ label: 'Partial Cover (water)', modifier: 1 }]);
    });

    it('renders separate prone and immobile pills', () => {
        const target = {
            ...TARGET,
            tnCalculator: {
                prone: true,
                immobile: true,
            },
        };
        fixture.componentRef.setInput('targets', [target]);
        fixture.componentRef.setInput('showC3Distance', false);
        fixture.detectChanges();

        expect([...fixture.nativeElement.querySelectorAll('.target-modifier-pill')].map(pill => pill.textContent?.trim())).toEqual([
            'Prone+1',
            'Immobile-4',
        ]);
    });

    it('uses the effective spotting modifier for indirect-fire pills', () => {
        const target = {
            ...TARGET,
            tnCalculator: {
                indirectFire: true,
                spotterMoveMode: 'run' as const,
                spotterDeclaredAttacks: true,
            },
        };
        fixture.componentRef.setInput('targets', [target]);
        fixture.componentRef.setInput('indirectFireBaseModifier', 0);
        fixture.detectChanges();

        const pillContainer = fixture.nativeElement.querySelector('.target-modifier-pills:not(.target-modifier-pills-fallback)') as HTMLElement;
        const pills = [...pillContainer.querySelectorAll('.target-modifier-pill')].map(pill => ({
            label: pill.querySelector('.modifier-label')?.textContent?.trim(),
            modifier: pill.querySelector('.modifier-badge')?.textContent?.trim(),
        }));

        expect(pills).toEqual([
            { label: 'Spotter', modifier: '+3' },
        ]);
    });

    it('mirrors the calculator stance rules for static targets', () => {
        const buildingTarget = {
            ...TARGET,
            unitType: 'building' as const,
            tnCalculator: { indirectFire: true },
        };
        const terrainTarget = {
            ...TARGET,
            unitType: 'terrain' as const,
            tnCalculator: { prone: true },
        };

        expect(component.targetModifierPills(buildingTarget)).toEqual([
            { label: 'Immobile', modifier: -4 },
            { label: 'Indirect', modifier: 1 },
        ]);
        expect(component.targetModifierPills(terrainTarget)).toEqual([]);
    });

    it('does not emit mutations while read-only', () => {
        fixture.componentRef.setInput('readOnly', true);
        fixture.detectChanges();
        const updates = jasmine.createSpy('updateRequest');
        const additions = jasmine.createSpy('addRequest');
        const opforToggles = jasmine.createSpy('opforToggleRequest');
        const resets = jasmine.createSpy('resetRequest');
        const deletions = jasmine.createSpy('deleteRequest');
        const calculators = jasmine.createSpy('calculatorRequest');
        component.updateRequest.subscribe(updates);
        component.addRequest.subscribe(additions);
        component.opforToggleRequest.subscribe(opforToggles);
        component.resetRequest.subscribe(resets);
        component.deleteRequest.subscribe(deletions);
        component.calculatorRequest.subscribe(calculators);

        component.addTarget();
        component.toggleOpfor();
        component.resetTargets();
        component.deleteTarget(TARGET.id);
        component.updateName(TARGET.id, 'Changed');
        component.updateColor(TARGET.id, '#fff');
        component.updateDistance(TARGET.id, '10');
        component.updateUseC3(TARGET, { target: { checked: false } } as unknown as Event);
        component.updateTnModifier(TARGET.id, '2');
        component.stepDistance(TARGET, 1);
        component.stepC3Distance(TARGET, 1);
        component.stepTnModifier(TARGET, 1);
        component.openTnCalculator(TARGET.id, { currentTarget: document.createElement('button') } as unknown as MouseEvent);

        expect(updates).not.toHaveBeenCalled();
        expect(additions).not.toHaveBeenCalled();
        expect(opforToggles).not.toHaveBeenCalled();
        expect(resets).not.toHaveBeenCalled();
        expect(deletions).not.toHaveBeenCalled();
        expect(calculators).not.toHaveBeenCalled();
        const buttons = fixture.nativeElement.querySelectorAll('button') as NodeListOf<HTMLButtonElement>;
        expect(Array.from(buttons).every(button => button.disabled)).toBeTrue();
    });

    it('renders one ADD action and an available OPFOR toggle', () => {
        const additions = jasmine.createSpy('addRequest');
        const opforToggles = jasmine.createSpy('opforToggleRequest');
        component.addRequest.subscribe(additions);
        component.opforToggleRequest.subscribe(opforToggles);
        fixture.componentRef.setInput('opforAvailable', true);
        fixture.detectChanges();

        const buttons = Array.from(fixture.nativeElement.querySelectorAll('.weapon-targets-header-group button')) as HTMLButtonElement[];
        const addButton = buttons.find(button => button.textContent?.trim() === 'ADD')!;
        const opforButton = buttons.find(button => button.textContent?.trim() === 'OPFOR')!;
        const opforIcon = opforButton.querySelector('.opfor-link-icon') as SVGElement;

        addButton.click();
        opforButton.click();

        expect(opforIcon).not.toBeNull();
        expect(opforIcon.getAttribute('viewBox')).toBe('0 0 24 24');
        expect(opforIcon.getAttribute('stroke')).toBe('currentColor');
        expect(opforIcon.getAttribute('aria-hidden')).toBe('true');
        expect(opforIcon.querySelectorAll('path').length).toBe(3);
        expect(opforIcon.querySelector('style')).toBeNull();
        expect(opforButton.getAttribute('aria-label')).toBe('Toggle opposing units as targets');
        expect(opforButton.title).toBe('Add or remove all opposing units as targets');
        expect(additions).toHaveBeenCalledTimes(1);
        expect(opforToggles).toHaveBeenCalledOnceWith(true);
    });

    it('hides the OPFOR toggle when no enemy force is available', () => {
        fixture.detectChanges();

        expect(fixture.nativeElement.querySelector('.opfor-toggle')).toBeNull();
    });

    it('keeps derived OPFOR identity immutable while allowing presentation color changes', () => {
        fixture.componentRef.setInput('targets', [{ ...TARGET, id: 'opfor:enemy', source: 'opfor', readOnly: true }]);
        const updates = jasmine.createSpy('updateRequest');
        component.updateRequest.subscribe(updates);
        fixture.detectChanges();

        expect((fixture.nativeElement.querySelector('.target-name') as HTMLInputElement).readOnly).toBeTrue();
        expect(fixture.nativeElement.querySelector('color-picker-button button').disabled).toBeFalse();
        expect(fixture.nativeElement.querySelector('.target-delete')).toBeNull();
        expect(fixture.nativeElement.querySelector('.target-delete-row')).toBeNull();
        const linkedNameStyle = getComputedStyle(fixture.nativeElement.querySelector('.linked-target-name'));
        expect(linkedNameStyle.backgroundImage).toBe('none');
        expect(linkedNameStyle.backgroundColor).toBe('rgba(0, 0, 0, 0)');
        expect(linkedNameStyle.borderColor).toBe('rgba(0, 0, 0, 0)');
        component.updateName('opfor:enemy', 'Changed');
        component.updateColor('opfor:enemy', '#fff');
        expect(updates).toHaveBeenCalledOnceWith({ targetId: 'opfor:enemy', patch: { color: '#fff' } });
    });

    it('keeps equal delete-column widths for manual and linked targets in mixed lists', () => {
        fixture.componentRef.setInput('targets', [
            TARGET,
            { ...TARGET, id: 'opfor:enemy', letter: 'B', source: 'opfor', readOnly: true }
        ]);
        fixture.detectChanges();

        const rows = [...fixture.nativeElement.querySelectorAll('.weapon-target-row')] as HTMLElement[];
        const manualDeleteColumn = rows[0].querySelector('.target-delete-row') as HTMLElement;
        const linkedDeleteColumn = rows[1].querySelector('.target-delete-row') as HTMLElement;

        expect(manualDeleteColumn).not.toBeNull();
        expect(linkedDeleteColumn).not.toBeNull();
        expect(manualDeleteColumn.querySelector('.target-delete')).not.toBeNull();
        expect(linkedDeleteColumn.querySelector('.target-delete')).toBeNull();
        expect(getComputedStyle(manualDeleteColumn).width).toBe(getComputedStyle(linkedDeleteColumn).width);
    });

    it('removes the overlay when degradation clears', () => {
        fixture.componentRef.setInput('c3Degraded', false);
        fixture.detectChanges();

        expect(fixture.nativeElement.querySelector('.target-c3-controls').classList).not.toContain('c3-degraded');
        expect(fixture.nativeElement.querySelector('.use-c3-toggle input').disabled).toBeFalse();
        expect(component.c3Enabled(TARGET)).toBeTrue();
        expect(component.c3DistanceInputValue(TARGET)).toBe(12);
    });
});
