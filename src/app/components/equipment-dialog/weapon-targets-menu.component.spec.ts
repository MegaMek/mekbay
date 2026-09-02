// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import { ComponentFixture, TestBed } from '@angular/core/testing';
import { asEncounterTargetId } from '../../models/runtime/encounter-runtime';
import type { TargetingTarget } from '../../models/runtime/targeting-target';
import { TW_GAME_RULES } from '../../models/rules/game-rules';
import { getUnitConditionDefinition, NARC_CONDITION_COLOR } from '../../models/unit-status-presentation';
import { WeaponTargetsMenuComponent } from './weapon-targets-menu.component';

const TARGET: TargetingTarget = {
    id: asEncounterTargetId('A'),
    letter: 'A',
    name: 'Target A',
    color: '#1565C0',
    distance: 15,
    c3Distance: 12,
    useC3: true,
    tnModifier: 0
};
const OPFOR_TARGET_ID = asEncounterTargetId('opfor:enemy');

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

    it('does not let manually overridden indirect-fire state block C3 controls', () => {
        const target = {
            ...TARGET,
            manualTnModifier: 4,
            tnCalculator: { indirectFire: true }
        };
        fixture.componentRef.setInput('targets', [target]);
        fixture.detectChanges();

        expect(fixture.nativeElement.querySelector('.use-c3-toggle input').disabled).toBeFalse();
        expect(component.c3Enabled(target)).toBeTrue();
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

    it('labels a manual TN as a complete override', () => {
        const manualTarget = { ...TARGET, tnModifier: 3, manualTnModifier: 3 };
        fixture.componentRef.setInput('targets', [manualTarget]);
        fixture.detectChanges();

        const label = fixture.nativeElement.querySelector('.tn-modifier-label') as HTMLElement;
        const input = fixture.nativeElement.querySelector('.tn-modifier-value') as HTMLInputElement;
        expect(label.textContent).toContain('TN Override');
        expect(component.tnModifierTooltipFor(manualTarget)).toContain('Complete target-side override');
        expect(input.getAttribute('aria-label')).toBe('TN Modifier (complete manual override)');
        expect(input.title).toContain('weapon-specific target effects are disabled');
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
            { label: 'LoS', modifier: '+1' },
            { label: 'Heavy Wood', modifier: '+2' },
            { label: 'Secondary', modifier: '+1' },
            { label: 'Indirect', modifier: '+1' },
            { label: 'Spotter', modifier: '+3' },
        ]);
        expect(pillContainer.querySelectorAll('.target-modifier-pill .modifier-badge').length).toBe(pills.length);
        expect(fixture.nativeElement.querySelector('.target-number-field').textContent).toContain('Distance');
        expect(pillContainer.textContent).not.toContain('Distance');
        expect(pillContainer.textContent).not.toContain('C3');
    });

    it('uses typed target-hex cover metadata for wood pill labels', () => {
        expect(component.targetModifierPills({
            ...TARGET,
            tnCalculator: { targetHexCover: 'light' },
        })).toEqual([{ label: 'Light Wood', modifier: 1 }]);
        expect(component.targetModifierPills({
            ...TARGET,
            tnCalculator: { targetHexCover: 'heavy' },
        })).toEqual([{ label: 'Heavy Wood', modifier: 2 }]);
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

    it('renders Tagged without a modifier badge when semi-guided missiles are available', () => {
        const target = {
            ...TARGET,
            tnCalculator: { tagged: true },
        };
        fixture.componentRef.setInput('hasSemiGuidedMissiles', true);
        fixture.componentRef.setInput('targets', [target]);
        fixture.detectChanges();

        const taggedColor = getUnitConditionDefinition('tagged').color;
        expect(component.targetModifierPills(target)).toEqual([{
            label: 'Tagged',
            accentColor: taggedColor,
        }]);
        const pill = fixture.nativeElement.querySelector(
            '.target-modifier-pills:not(.target-modifier-pills-fallback) .target-modifier-pill',
        ) as HTMLElement;
        expect(pill.querySelector('.modifier-label')?.textContent?.trim()).toBe('Tagged');
        expect(pill.querySelector('.modifier-badge')).toBeNull();
        expect(pill.classList).toContain('guidance-pill');
        expect(pill.style.getPropertyValue('--target-pill-accent')).toBe(taggedColor);
        expect(getComputedStyle(pill).borderTopColor).toBe('rgb(51, 133, 215)');

        fixture.componentRef.setInput('hasSemiGuidedMissiles', false);
        fixture.detectChanges();
        expect(component.targetModifierPills(target)).toEqual([]);
    });

    it('renders active stealth as a target badge without baking in one weapon bracket', () => {
        const target = {
            ...TARGET,
            tnCalculator: {
                stealth: { short: 0, medium: 1, long: 2, secondaryTargetRestricted: true },
            },
        };
        fixture.componentRef.setInput('targets', [target]);
        fixture.detectChanges();

        expect(component.targetModifierPills(target)).toEqual([{ label: 'Stealth' }]);
        const pill = fixture.nativeElement.querySelector(
            '.target-modifier-pills:not(.target-modifier-pills-fallback) .target-modifier-pill',
        ) as HTMLElement;
        expect(pill.querySelector('.modifier-label')?.textContent?.trim()).toBe('Stealth');
        expect(pill.querySelector('.modifier-badge')).toBeNull();
    });

    it('does not render stale TAG guidance for a TW infantry target', () => {
        fixture.componentRef.setInput('gameRules', TW_GAME_RULES);
        fixture.componentRef.setInput('hasSemiGuidedMissiles', true);
        fixture.detectChanges();

        expect(component.targetModifierPills({
            ...TARGET,
            unitType: 'infantry',
            tnCalculator: { tagged: true },
        })).toEqual([]);
    });

    it('renders a removable yellow Custom pill and clears only its calculator value', () => {
        const target = {
            ...TARGET,
            tnModifier: -2,
            tnCalculator: { customModifier: -2 },
        };
        fixture.componentRef.setInput('targets', [target]);
        const emitted = jasmine.createSpy('updateRequest');
        component.updateRequest.subscribe(emitted);
        fixture.detectChanges();

        expect(component.targetModifierPills(target)).toEqual([{
            label: 'Custom',
            modifier: -2,
            custom: true,
        }]);
        const pill = fixture.nativeElement.querySelector(
            '.target-modifier-pills:not(.target-modifier-pills-fallback) .custom-pill',
        ) as HTMLElement;
        const remove = pill.querySelector('.custom-pill-remove') as HTMLButtonElement;
        expect(pill).not.toBeNull();
        expect(getComputedStyle(pill).borderTopColor).toBe('rgb(234, 174, 63)');
        expect(remove.textContent?.trim()).toBe('×');

        remove.click();

        expect(emitted).toHaveBeenCalledWith({
            targetId: 'A',
            patch: { tnCalculator: { customModifier: undefined } },
        });
    });

    it('renders NARC normally when a capable weapon and pod share a water layer', () => {
        fixture.componentRef.setInput('narcCapableWeaponLayers', { aboveWater: true, underwater: false });
        fixture.detectChanges();

        const activeTarget = {
            ...TARGET,
            tnCalculator: { narcAboveWater: true },
        };
        fixture.componentRef.setInput('targets', [activeTarget]);
        fixture.detectChanges();

        expect(component.targetModifierPills(activeTarget)).toEqual([{
            label: 'NARC',
            accentColor: NARC_CONDITION_COLOR,
        }]);
        const activePill = fixture.nativeElement.querySelector(
            '.target-modifier-pills:not(.target-modifier-pills-fallback) .target-modifier-pill',
        ) as HTMLElement;
        expect(activePill.classList).toContain('guidance-pill');
        expect(activePill.style.getPropertyValue('--target-pill-accent')).toBe(NARC_CONDITION_COLOR);
        expect(getComputedStyle(activePill).borderTopColor).toBe('rgb(255, 0, 0)');

        expect(component.targetModifierPills({
            ...TARGET,
            tnCalculator: { narcUnderwater: true },
        })).toEqual([{
            label: 'NARC',
            accentColor: NARC_CONDITION_COLOR,
            invalid: true,
            invalidReason: 'NARC guidance is unavailable across this water layer',
        }]);
    });

    it('renders an invalid NARC pill with a red strike-through for a water-layer mismatch', () => {
        const target = {
            ...TARGET,
            tnCalculator: { narcUnderwater: true },
        };
        fixture.componentRef.setInput('narcCapableWeaponLayers', { aboveWater: true, underwater: false });
        fixture.componentRef.setInput('targets', [target]);
        fixture.detectChanges();

        const pill = fixture.nativeElement.querySelector(
            '.target-modifier-pills:not(.target-modifier-pills-fallback) .target-modifier-pill',
        ) as HTMLElement;
        const label = pill.querySelector('.modifier-label') as HTMLElement;
        expect(pill.classList).toContain('invalid-guidance');
        expect(pill.getAttribute('aria-label')).toBe('NARC guidance unavailable');
        expect(pill.title).toBe('NARC guidance is unavailable across this water layer');
        expect(getComputedStyle(label).textDecorationLine).toContain('line-through');
        expect(getComputedStyle(label).textDecorationColor).toBe('rgb(255, 0, 0)');
    });

    it('renders NARC as unavailable when ECM shields the attached pod', () => {
        const target = {
            ...TARGET,
            tnCalculator: { narcAboveWater: true, ecmShielded: true },
        };
        fixture.componentRef.setInput('narcCapableWeaponLayers', { aboveWater: true, underwater: false });
        fixture.componentRef.setInput('targets', [target]);
        fixture.detectChanges();

        expect(component.targetModifierPills(target)).toEqual([{
            label: 'NARC',
            accentColor: NARC_CONDITION_COLOR,
            invalid: true,
            invalidReason: 'NARC guidance is suppressed by ECM',
        }]);
        const pill = fixture.nativeElement.querySelector(
            '.target-modifier-pills:not(.target-modifier-pills-fallback) .target-modifier-pill',
        ) as HTMLElement;
        expect(pill.classList).toContain('invalid-guidance');
        expect(pill.title).toBe('NARC guidance is suppressed by ECM');
    });

    it('shows water partial cover at adjacent range', () => {
        expect(component.targetModifierPills({
            ...TARGET,
            unitType: 'mek-biped',
            distance: 1,
            tnCalculator: { waterDepth: 'underwater-depth-1' },
        })).toEqual([{ label: 'Depth 1', modifier: 1 }]);
    });

    it('shows spotter-LOS partial cover for TW indirect fire', () => {
        fixture.componentRef.setInput('gameRules', TW_GAME_RULES);
        fixture.detectChanges();

        expect(component.targetModifierPills({
            ...TARGET,
            unitType: 'mek-biped',
            distance: 1,
            tnCalculator: { indirectFire: true, partialCover: true },
        })).toEqual([
            { label: 'Partial Cover', modifier: 1 },
            { label: 'Indirect', modifier: 1 },
        ]);
    });

    it('shows effective building levels and filters levels with no effect', () => {
        expect(component.targetModifierPills({
            ...TARGET,
            unitType: 'mek-biped',
            distance: 1,
            tnCalculator: { buildingCover: 'building-1', indirectFire: true },
        })).toContain(jasmine.objectContaining({ label: 'Building lv1', modifier: 1 }));
        expect(component.targetModifierPills({
            ...TARGET,
            unitType: 'vehicle',
            tnCalculator: { buildingCover: 'building-2' },
        })).toEqual([{ label: 'Building lv2', modifier: 2 }]);
        expect(component.targetModifierPills({
            ...TARGET,
            unitType: 'mek-biped',
            tnCalculator: { buildingCover: 'building-2' },
        })).toEqual([{ label: 'Building lv2', modifier: 2 }]);

        const superheavyPills = component.targetModifierPills({
            ...TARGET,
            unitType: 'mek-biped',
            tnCalculator: { buildingCover: 'building-1', largeTarget: true },
        });
        expect(superheavyPills.some(pill => pill.label === 'Building lv1')).toBeFalse();
        expect(component.targetModifierPills({
            ...TARGET,
            unitType: 'mek-biped',
            tnCalculator: { buildingCover: 'building-2', largeTarget: true },
        })).toContain(jasmine.objectContaining({ label: 'Building lv2', modifier: 1 }));
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

    it('always includes the base indirect-fire modifier', () => {
        const target = {
            ...TARGET,
            tnCalculator: {
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
            { label: 'Indirect', modifier: '+1' },
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
        expect(component.targetModifierPills(terrainTarget)).toEqual([
            { label: 'Immobile', modifier: -4 },
        ]);
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
        fixture.componentRef.setInput('targets', [{ ...TARGET, id: OPFOR_TARGET_ID, source: 'opfor', readOnly: true }]);
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
        component.updateName(OPFOR_TARGET_ID, 'Changed');
        component.updateColor(OPFOR_TARGET_ID, '#fff');
        expect(updates).toHaveBeenCalledOnceWith({ targetId: 'opfor:enemy', patch: { color: '#fff' } });
    });

    it('offers deletion only for manual targets in mixed lists', () => {
        fixture.componentRef.setInput('targets', [
            TARGET,
            { ...TARGET, id: OPFOR_TARGET_ID, letter: 'B', source: 'opfor', readOnly: true }
        ]);
        fixture.detectChanges();

        const rows = [...fixture.nativeElement.querySelectorAll('.weapon-target-row')] as HTMLElement[];
        const manualDeleteColumn = rows[0].querySelector('.target-delete-row') as HTMLElement;
        const linkedDeleteColumn = rows[1].querySelector('.target-delete-row') as HTMLElement;

        expect(manualDeleteColumn).not.toBeNull();
        expect(linkedDeleteColumn).not.toBeNull();
        expect(manualDeleteColumn.querySelector('.target-delete')).not.toBeNull();
        expect(linkedDeleteColumn.querySelector('.target-delete')).toBeNull();
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
