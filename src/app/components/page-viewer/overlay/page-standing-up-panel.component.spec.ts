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

        expect(component.canCarefulStand()).toBeTrue();
        canCarefulStand.set(false);
        expect(component.canCarefulStand()).toBeFalse();
        canCarefulStand.set(true);
        expect(component.targetRoll()).toBe(7);
        expect(component.attempts()).toBe(0);

        component.setCarefulStand({ target: { checked: true } } as unknown as Event);
        expect(component.targetRoll()).toBe(5);
        expect(component.modifiersList()).toEqual([
            jasmine.objectContaining({ pilotCheck: 1, reason: 'Gyro damaged' }),
            jasmine.objectContaining({ pilotCheck: -1, reason: 'Standing up' }),
            jasmine.objectContaining({ pilotCheck: -2, reason: 'Careful stand' }),
        ]);

        component.roll();
        component.onRollFinished({ results: [3, 3], sum: 6 });

        expect(roller.roll).toHaveBeenCalledTimes(1);
        expect(resolveStandAttempt).not.toHaveBeenCalled();
        expect(component.lastOutcome()).toBeNull();
        expect(component.rolledResult()).toBe('SUCCESS');

        component.onRollOverlayClosed();

        expect(resolveStandAttempt).toHaveBeenCalledOnceWith('success', { carefulStand: true });
        expect(component.lastOutcome()).toBe('success');
        expect(component.rolledResult()).toBeNull();
        expect(component.attempts()).toBe(1);

        component.adjustAttempts(-1);

        expect(adjustStandAttempts).toHaveBeenCalledOnceWith(-1);
        expect(component.attempts()).toBe(0);
        expect(component.lastOutcome()).toBe('success');

        component.adjustAttempts(1);

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

    it('keeps a failed dice result visible until the roller closes, then closes before fall resolution', () => {
        const resolveStandAttempt = jasmine.createSpy('resolveStandAttempt').and.returnValue(true);
        const closeManagedOverlay = jasmine.createSpy('closeManagedOverlay');
        const unit = {
            id: 'unit-1',
            rules: {
                standingUpPSRModifier: 0,
                getStandAttemptLimit: () => null,
                supportsCarefulStand: false,
                canCarefulStand: () => false,
            },
            turnState: () => ({
                standAttempts: signal<number | undefined>(0),
                carefulStand: signal(false),
                canStandUp: signal(true),
                canStandWithoutPSR: signal(false),
                resolveStandAttempt,
                adjustStandAttempts: jasmine.createSpy('adjustStandAttempts'),
            }),
            PSRTargetRoll: () => 8,
            PSRModifiers: () => ({ modifiers: [] }),
        };

        TestBed.configureTestingModule({
            imports: [PageStandingUpPanelComponent],
            providers: [
                { provide: PageInteractionOverlayComponent, useValue: { unit: signal(unit) } },
                { provide: OverlayManagerService, useValue: { closeManagedOverlay } },
            ],
        });
        const component = TestBed.createComponent(PageStandingUpPanelComponent).componentInstance;

        component.onRollFinished({ results: [2, 3], sum: 5 });

        expect(component.rolledResult()).toBe('FAILED');
        expect(component.rollOverlayCloseHint()).toContain('resolve the fall');
        expect(resolveStandAttempt).not.toHaveBeenCalled();
        expect(closeManagedOverlay).not.toHaveBeenCalled();

        component.onRollOverlayClosed();

        expect(resolveStandAttempt).toHaveBeenCalledOnceWith('failed', { carefulStand: false });
        expect(closeManagedOverlay).toHaveBeenCalledOnceWith('standingUp-unit-1');
    });

    it('does not allow careful stand under Core rules', () => {
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
        const component = TestBed.createComponent(PageStandingUpPanelComponent).componentInstance;

        component.setCarefulStand({ target: { checked: true } } as unknown as Event);

        expect(component.supportsCarefulStand()).toBeFalse();
        expect(component.carefulStand()).toBeFalse();
    });

    it('allows only attempt adjustment while reviewing a completed standing attempt', () => {
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
        component.adjustAttempts(1);
        component.resolve('success');
        component.onRollFinished({ results: [6, 6], sum: 12 });
        component.setCarefulStand({ target: { checked: true } } as unknown as Event);

        expect(adjustStandAttempts).toHaveBeenCalledOnceWith(1);
        expect(resolveStandAttempt).not.toHaveBeenCalled();
        expect(component.carefulStand()).toBeFalse();
    });
});
