import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { DiceRollerComponent } from '../../dice-roller/dice-roller.component';
import { OverlayManagerService } from '../../../services/overlay-manager.service';
import { PageInteractionOverlayComponent } from './page-interaction-overlay.component';
import { PagePsrWarningPanelComponent, psrRollOutcome } from './page-psr-warning-panel.component';
import { composeTurnSummaryHeatRows, countActionablePsrChecks, displayPsrModifiers } from './page-turn-summary.util';

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

describe('countActionablePsrChecks', () => {
    const fallCheck = { failureOutcome: 'Fall' };
    const crippleCheck = { failureOutcome: 'Crippled' };

    it('shows all checks when the unit is not automatically falling', () => {
        expect(countActionablePsrChecks([fallCheck, crippleCheck], false)).toBe(2);
    });

    it('hides the warning when autofall already represents every check', () => {
        expect(countActionablePsrChecks([fallCheck, fallCheck], true)).toBe(0);
    });

    it('keeps non-fall checks actionable during autofall', () => {
        expect(countActionablePsrChecks([fallCheck, crippleCheck], true)).toBe(1);
    });
});

describe('displayPsrModifiers', () => {
    it('filters and consistently orders displayed modifiers', () => {
        expect(displayPsrModifiers([
            { reason: 'Leg Destroyed', pilotCheck: 4 },
            { reason: 'Ignored', pilotCheck: 0 },
            { reason: 'Gyro damaged', pilotCheck: 2 },
        ]).map(modifier => modifier.reason)).toEqual(['Gyro damaged', 'Leg Destroyed']);
    });
});

describe('composeTurnSummaryHeatRows', () => {
    it('keeps committed Weapons when no weapon is selected', () => {
        expect(composeTurnSummaryHeatRows(
            [{ id: 'weapons', label: 'Weapons', value: 20 }],
            { hasSelection: false, value: 0, entryIds: new Set() }
        )).toEqual([{ id: 'weapons', label: 'Weapons', value: 20 }]);
    });

    it('shows Selected Weapons when there is no committed Weapons heat', () => {
        expect(composeTurnSummaryHeatRows(
            [{ id: 'engine', label: 'Engine', value: 5 }],
            { hasSelection: true, value: 15, entryIds: new Set(['laser']) }
        )).toEqual([
            { id: 'selected-weapons', label: 'Selected Weapons', value: 15, selectedOnly: true },
            { id: 'engine', label: 'Engine', value: 5 },
        ]);
    });

    it('combines committed and selected Weapons as alternative values', () => {
        expect(composeTurnSummaryHeatRows(
            [
                { id: 'weapons', label: 'Weapons', value: 20 },
                { id: 'engine', label: 'Engine', value: 5 },
            ],
            { hasSelection: true, value: 15, entryIds: new Set(['laser']) }
        )).toEqual([
            { id: 'weapons', label: 'Weapons', value: 20, selectedValue: 15 },
            { id: 'engine', label: 'Engine', value: 5 },
        ]);
    });
});