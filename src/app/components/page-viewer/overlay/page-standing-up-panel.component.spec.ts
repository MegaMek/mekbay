// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { DiceRollerComponent } from '../../dice-roller/dice-roller.component';
import { DialogsService } from '../../../services/dialogs.service';
import { OverlayManagerService } from '../../../services/overlay-manager.service';
import { PageInteractionOverlayComponent } from './page-interaction-overlay.component';
import { PageStandingUpPanelComponent } from './page-standing-up-panel.component';

describe('PageStandingUpPanelComponent', () => {
    it('applies careful standing, resolves rolls, and resets the attempt count', async () => {
        const attempts = signal<number | undefined>(undefined);
        const resolveStandAttempt = jasmine.createSpy('resolveStandAttempt').and.callFake(() => {
            attempts.update(current => (current ?? 0) + 1);
            return true;
        });
        const resetStandAttempts = jasmine.createSpy('resetStandAttempts').and.callFake(() => attempts.set(0));
        const turnState = {
            standAttempts: attempts,
            resolveStandAttempt,
            resetStandAttempts,
        };
        const unit = {
            id: 'unit-1',
            turnState: () => turnState,
            PSRTargetRoll: () => 8,
            PSRModifiers: () => ({ modifiers: [{ pilotCheck: 1, reason: 'Gyro damaged' }] }),
        };

        TestBed.configureTestingModule({
            imports: [PageStandingUpPanelComponent],
            providers: [
                { provide: DialogsService, useValue: { requestConfirmation: jasmine.createSpy('requestConfirmation').and.resolveTo(true) } },
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
        expect(component.targetRoll()).toBe(8);
        expect(component.attempts()).toBe(0);

        component.carefulStand.set(true);
        expect(component.targetRoll()).toBe(6);
        expect(component.modifiersList()).toEqual([
            jasmine.objectContaining({ pilotCheck: 1, reason: 'Gyro damaged' }),
            jasmine.objectContaining({ pilotCheck: -2, reason: 'Careful stand' }),
        ]);

        component.roll();
        component.onRollFinished({ results: [3, 3], sum: 6 });

        expect(roller.roll).toHaveBeenCalledTimes(1);
        expect(resolveStandAttempt).toHaveBeenCalledOnceWith('success');
        expect(component.lastOutcome()).toBe('success');
        expect(component.rolledResult()).toBe('SUCCESS');
        expect(component.attempts()).toBe(1);

        await component.resetAttempts();

        expect(resetStandAttempts).toHaveBeenCalledTimes(1);
        expect(component.attempts()).toBe(0);
        expect(component.lastOutcome()).toBe('success');
    });
});
