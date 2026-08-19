// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { DiceRollerComponent } from '../../dice-roller/dice-roller.component';
import { OverlayManagerService } from '../../../services/overlay-manager.service';
import { PageInteractionOverlayComponent } from './page-interaction-overlay.component';
import { PageStandingUpPanelComponent, STANDING_UP_REVIEW_ONLY } from './page-standing-up-panel.component';

describe('PageStandingUpPanelComponent', () => {
    it('applies careful standing, resolves rolls, and adjusts the attempt count', () => {
        const attempts = signal<number | undefined>(undefined);
        const carefulStand = signal(false);
        const canStandUp = signal(true);
        const canCarefulStand = signal(true);
        const resolveStandAttempt = jasmine.createSpy('resolveStandAttempt').and.callFake((
            _outcome: string,
            options: { carefulStand?: boolean },
        ) => {
            attempts.update(current => (current ?? 0) + 1);
            if (options.carefulStand) {
                carefulStand.set(true);
                canStandUp.set(false);
            }
            return true;
        });
        const adjustStandAttempts = jasmine.createSpy('adjustStandAttempts').and.callFake((delta: number) => {
            attempts.update(current => Math.max(0, (current ?? 0) + delta));
            if (delta < 0) {
                carefulStand.set(false);
                canStandUp.set(true);
            }
        });
        const turnState = {
            standAttempts: attempts,
            carefulStand,
            canStandUp,
            canStandWithoutPSR: signal(false),
            resolveStandAttempt,
            adjustStandAttempts,
        };
        const unit = {
            id: 'unit-1',
            rules: {
                standingUpPSRModifier: -1,
                getStandAttemptLimit: () => 1,
                supportsCarefulStand: true,
                canCarefulStand: () => canCarefulStand() && !carefulStand(),
            },
            turnState: () => turnState,
            PSRTargetRoll: () => 8,
            PSRModifiers: () => ({ modifiers: [{ pilotCheck: 1, reason: 'Gyro damaged' }] }),
        };

        TestBed.configureTestingModule({
            imports: [PageStandingUpPanelComponent],
            providers: [
                { provide: PageInteractionOverlayComponent, useValue: { unit: signal(unit) } },
                { provide: OverlayManagerService, useValue: { closeManagedOverlay: jasmine.createSpy('closeManagedOverlay') } },
            ],
        });
        const fixture = TestBed.createComponent(PageStandingUpPanelComponent);
        fixture.detectChanges();
        const component = fixture.componentInstance;
        const roller = fixture.debugElement
            .query(node => node.componentInstance instanceof DiceRollerComponent)
            .componentInstance as DiceRollerComponent;
        spyOn(roller, 'roll');

        expect((fixture.nativeElement.querySelector('.careful-stand .modifier-badge') as HTMLElement).textContent?.trim()).toBe('-2');
        expect((fixture.nativeElement.querySelector('.careful-stand') as HTMLElement).textContent).not.toContain('(-2 PSR)');
        expect((fixture.nativeElement.querySelector('.stand-attempt-limit') as HTMLElement).textContent?.trim())
            .toBe('(1 attempt per turn)');
        const carefulStandCheckbox = fixture.nativeElement.querySelector('.careful-stand input') as HTMLInputElement;
        expect(carefulStandCheckbox.disabled).toBeFalse();
        canCarefulStand.set(false);
        fixture.detectChanges();
        expect(carefulStandCheckbox.disabled).toBeTrue();
        canCarefulStand.set(true);
        fixture.detectChanges();
        expect(component.targetRoll()).toBe(7);
        expect(component.attempts()).toBe(0);

        component.carefulStand.set(true);
        expect(component.targetRoll()).toBe(5);
        expect(component.modifiersList()).toEqual([
            jasmine.objectContaining({ pilotCheck: 1, reason: 'Gyro damaged' }),
            jasmine.objectContaining({ pilotCheck: -1, reason: 'Standing up' }),
            jasmine.objectContaining({ pilotCheck: -2, reason: 'Careful stand' }),
        ]);

        component.roll();
        component.onRollFinished({ results: [3, 3], sum: 6 });

        expect(roller.roll).toHaveBeenCalledTimes(1);
        expect(resolveStandAttempt).toHaveBeenCalledOnceWith('success', { carefulStand: true });
        expect(component.lastOutcome()).toBe('success');
        expect(component.rolledResult()).toBe('SUCCESS');
        expect(component.attempts()).toBe(1);

        fixture.detectChanges();
        const adjustmentButtons = Array.from(fixture.nativeElement.querySelectorAll('.attempts-stepper button')) as HTMLButtonElement[];
        expect(adjustmentButtons.map(button => button.textContent?.trim())).toEqual(['-', '+']);

        adjustmentButtons[0].click();
        fixture.detectChanges();

        expect(adjustStandAttempts).toHaveBeenCalledOnceWith(-1);
        expect(component.attempts()).toBe(0);
        expect(component.lastOutcome()).toBe('success');
        expect(adjustmentButtons[0].disabled).toBeTrue();

        adjustmentButtons[1].click();

        expect(adjustStandAttempts).toHaveBeenCalledWith(1);
        expect(component.attempts()).toBe(1);
    });

    it('does not apply the Core standing modifier under TW rules', () => {
        const unit = {
            id: 'unit-1',
            rules: {
                standingUpPSRModifier: 0,
                getStandAttemptLimit: () => null,
                supportsCarefulStand: true,
                canCarefulStand: () => false,
            },
            turnState: () => ({
                standAttempts: signal<number | undefined>(undefined),
                carefulStand: signal(false),
                canStandUp: signal(true),
                canStandWithoutPSR: signal(false),
            }),
            PSRTargetRoll: () => 8,
            PSRModifiers: () => ({ modifiers: [] }),
        };

        TestBed.configureTestingModule({
            imports: [PageStandingUpPanelComponent],
            providers: [
                { provide: PageInteractionOverlayComponent, useValue: { unit: signal(unit) } },
                { provide: OverlayManagerService, useValue: { closeManagedOverlay: jasmine.createSpy('closeManagedOverlay') } },
            ],
        });
        const component = TestBed.createComponent(PageStandingUpPanelComponent).componentInstance;

        expect(component.targetRoll()).toBe(8);
        expect(component.modifiersList()).toEqual([]);
    });

    it('does not offer careful stand under Core rules', () => {
        const unit = {
            id: 'unit-1',
            rules: {
                standingUpPSRModifier: -1,
                getStandAttemptLimit: () => null,
                supportsCarefulStand: false,
                canCarefulStand: () => false,
            },
            turnState: () => ({
                standAttempts: signal<number | undefined>(undefined),
                carefulStand: signal(false),
                canStandUp: signal(true),
                canStandWithoutPSR: signal(false),
            }),
            PSRTargetRoll: () => 8,
            PSRModifiers: () => ({ modifiers: [] }),
        };

        TestBed.configureTestingModule({
            imports: [PageStandingUpPanelComponent],
            providers: [
                { provide: PageInteractionOverlayComponent, useValue: { unit: signal(unit) } },
                { provide: OverlayManagerService, useValue: { closeManagedOverlay: jasmine.createSpy('closeManagedOverlay') } },
            ],
        });
        const fixture = TestBed.createComponent(PageStandingUpPanelComponent);
        fixture.detectChanges();

        expect(fixture.nativeElement.querySelector('.careful-stand')).toBeNull();
        expect(fixture.componentInstance.carefulStand()).toBeFalse();
    });

    it('renders a standing-attempt review without mutable attempt controls (except attempts stepper)', () => {
        const attempts = signal<number | undefined>(2);
        const carefulStand = signal(false);
        const resolveStandAttempt = jasmine.createSpy('resolveStandAttempt');
        const adjustStandAttempts = jasmine.createSpy('adjustStandAttempts');
        const unit = {
            id: 'unit-1',
            rules: {
                standingUpPSRModifier: -1,
                getStandAttemptLimit: () => 1,
                supportsCarefulStand: true,
                canCarefulStand: () => false,
            },
            turnState: () => ({
                standAttempts: attempts,
                carefulStand,
                canStandUp: signal(true),
                canStandWithoutPSR: signal(false),
                resolveStandAttempt,
                adjustStandAttempts,
            }),
            PSRTargetRoll: () => 8,
            PSRModifiers: () => ({ modifiers: [{ pilotCheck: 1, reason: 'Gyro damaged' }] }),
        };

        TestBed.configureTestingModule({
            imports: [PageStandingUpPanelComponent],
            providers: [
                { provide: PageInteractionOverlayComponent, useValue: { unit: signal(unit) } },
                { provide: OverlayManagerService, useValue: { closeManagedOverlay: jasmine.createSpy('closeManagedOverlay') } },
                { provide: STANDING_UP_REVIEW_ONLY, useValue: true },
            ],
        });
        const fixture = TestBed.createComponent(PageStandingUpPanelComponent);
        fixture.detectChanges();
        const component = fixture.componentInstance;

        expect(component.reviewOnly).toBeTrue();
        expect((fixture.nativeElement.querySelector('.header') as HTMLElement).textContent?.trim())
            .toBe('Standing Up Review');
        expect((fixture.nativeElement.querySelector('.attempts strong') as HTMLElement).textContent?.trim()).toBe('2');
        expect(fixture.nativeElement.querySelector('.psr-resolution-actions')).toBeNull();
        expect(fixture.nativeElement.querySelector('.careful-stand')).toBeNull();
        expect(fixture.nativeElement.querySelector('dice-roller')).toBeNull();

        component.adjustAttempts(1);
        component.resolve('success');
        component.onRollFinished({ results: [6, 6], sum: 12 });
        component.setCarefulStand({ target: { checked: true } } as unknown as Event);

        expect(adjustStandAttempts).toHaveBeenCalledOnceWith(1);
        expect(resolveStandAttempt).not.toHaveBeenCalled();
        expect(component.carefulStand()).toBeFalse();
    });

    it('shows only stand attempts when reviewing a unit that can stand without a PSR', () => {
        const unit = {
            id: 'quad-1',
            rules: {
                standingUpPSRModifier: -1,
                getStandAttemptLimit: () => null,
                supportsCarefulStand: true,
                canCarefulStand: () => true,
            },
            turnState: () => ({
                standAttempts: signal<number | undefined>(1),
                carefulStand: signal(false),
                canStandUp: signal(true),
                canStandWithoutPSR: signal(true),
                adjustStandAttempts: jasmine.createSpy('adjustStandAttempts'),
            }),
            PSRTargetRoll: () => 8,
            PSRModifiers: () => ({ modifiers: [{ pilotCheck: 1, reason: 'Gyro damaged' }] }),
        };

        TestBed.configureTestingModule({
            imports: [PageStandingUpPanelComponent],
            providers: [
                { provide: PageInteractionOverlayComponent, useValue: { unit: signal(unit) } },
                { provide: OverlayManagerService, useValue: { closeManagedOverlay: jasmine.createSpy('closeManagedOverlay') } },
                { provide: STANDING_UP_REVIEW_ONLY, useValue: true },
            ],
        });
        const fixture = TestBed.createComponent(PageStandingUpPanelComponent);
        fixture.detectChanges();

        expect((fixture.nativeElement.querySelector('.attempts strong') as HTMLElement).textContent?.trim()).toBe('1');
        expect(fixture.nativeElement.querySelector('.psr-target')).toBeNull();
        expect(fixture.nativeElement.querySelector('.psr-list')).toBeNull();
        expect(fixture.nativeElement.querySelector('.careful-stand')).toBeNull();
        expect(fixture.nativeElement.querySelector('.roll-details')).toBeNull();
        expect(fixture.nativeElement.querySelector('dice-roller')).toBeNull();
    });
});
