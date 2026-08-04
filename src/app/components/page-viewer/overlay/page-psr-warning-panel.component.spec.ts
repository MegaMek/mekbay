import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { DiceRollerComponent } from '../../dice-roller/dice-roller.component';
import { OverlayManagerService } from '../../../services/overlay-manager.service';
import { PageInteractionOverlayComponent } from './page-interaction-overlay.component';
import { PagePsrWarningPanelComponent, psrRollOutcome } from './page-psr-warning-panel.component';

describe('psrRollOutcome', () => {
    it('succeeds on or above the target and fails below it', () => {
        expect(psrRollOutcome(8, 8)).toBe('success');
        expect(psrRollOutcome(9, 8)).toBe('success');
        expect(psrRollOutcome(7, 8)).toBe('failed');
    });
});

describe('PagePsrWarningPanelComponent', () => {
    it('rolls 2d6 from the action column and resolves against the target roll', () => {
        const check = { id: 'fall-check', fallCheck: 0, reason: 'Hip hit', failureOutcome: 'Fall' };
        const resolvePSRCheck = jasmine.createSpy('resolvePSRCheck');
        const turnState = {
            getPSRChecks: () => [check],
            getPSROutcome: () => undefined,
            resolvePSRCheck,
            autoFall: () => false,
        };
        const unit = {
            id: 'unit-1',
            rules: { controlRollFullLabel: 'Piloting Skill Rolls' },
            turnState: () => turnState,
            PSRTargetRoll: () => 8,
            PSRModifiers: () => ({ modifiers: [] }),
            resolveRuleCheck: jasmine.createSpy('resolveRuleCheck'),
        };

        TestBed.configureTestingModule({
            imports: [PagePsrWarningPanelComponent],
            providers: [
                { provide: PageInteractionOverlayComponent, useValue: { unit: signal(unit) } },
                { provide: OverlayManagerService, useValue: { closeManagedOverlay: jasmine.createSpy('closeManagedOverlay') } },
            ],
        });
        const fixture = TestBed.createComponent(PagePsrWarningPanelComponent);
        fixture.detectChanges();
        const roller = fixture.debugElement
            .query(node => node.componentInstance instanceof DiceRollerComponent)
            .componentInstance as DiceRollerComponent;
        spyOn(roller, 'roll');

        const panel = fixture.nativeElement.querySelector('.panel') as HTMLElement;
        const body = panel.querySelector('.body') as HTMLElement;
        expect(Array.from(panel.children).map(child => child.className)).toEqual([
            'header', 'psr-target', 'body', 'actions'
        ]);
        expect(getComputedStyle(panel).overflowY).toBe('hidden');
        expect(getComputedStyle(body).overflowY).toBe('auto');

        const actions = fixture.nativeElement.querySelector('.psr-resolution-actions') as HTMLElement;
        const rollButton = actions.firstElementChild as HTMLButtonElement;
        rollButton.click();
        fixture.componentInstance.onRollFinished({ results: [4, 4], sum: 8 });

        expect(rollButton.classList).toContain('random-button');
        expect(roller.diceCount()).toBe(2);
        expect(roller.diceSides()).toBe(6);
        expect(roller.roll).toHaveBeenCalledTimes(1);
        expect(resolvePSRCheck).toHaveBeenCalledOnceWith('fall-check', 'success');
        expect(fixture.componentInstance.rolledResult()).toBe('SUCCESS');
    });
});