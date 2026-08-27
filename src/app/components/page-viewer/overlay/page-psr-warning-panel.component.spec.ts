// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import { Injector, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Overlay } from '@angular/cdk/overlay';
import { Subject } from 'rxjs';
import { DiceRollerComponent } from '../../dice-roller/dice-roller.component';
import { OverlayManagerService } from '../../../services/overlay-manager.service';
import {
    FALL_PSR_FAILURE,
    PSR_CHECK_KIND,
    PSR_FAILURE_KIND,
    type PSRCheck,
} from '../../../models/rules/unit-type-rules';
import { PageInteractionOverlayComponent } from './page-interaction-overlay.component';
import { PagePsrWarningPanelComponent, PSR_WARNING_UNIT, psrRollOutcome, togglePsrWarningOverlay } from './page-psr-warning-panel.component';

describe('togglePsrWarningOverlay', () => {
    it('keeps Turn Summary open until PSR Warning closes', () => {
        const closed = new Subject<void>();
        const overlayManager = {
            has: jasmine.createSpy('has').and.returnValue(false),
            closeManagedOverlay: jasmine.createSpy('closeManagedOverlay'),
            createManagedOverlay: jasmine.createSpy('createManagedOverlay').and.returnValue({ closed }),
            blockCloseUntil: jasmine.createSpy('blockCloseUntil'),
            unblockClose: jasmine.createSpy('unblockClose'),
        } as unknown as OverlayManagerService;
        const parent = { unit: signal({ id: 'unit-1' }) } as unknown as PageInteractionOverlayComponent;
        const overlay = { scrollStrategies: { block: () => ({}) } } as unknown as Overlay;

        togglePsrWarningOverlay(
            parent,
            overlayManager,
            Injector.create({ providers: [] }),
            overlay,
        );

        expect(overlayManager.blockCloseUntil).toHaveBeenCalledOnceWith('turnSummary-unit-1');
        expect(overlayManager.closeManagedOverlay).not.toHaveBeenCalledWith('turnSummary-unit-1');

        closed.next();

        expect(overlayManager.unblockClose).toHaveBeenCalledOnceWith('turnSummary-unit-1');
        expect(overlayManager.closeManagedOverlay).not.toHaveBeenCalledWith('turnSummary-unit-1');
    });
});

describe('psrRollOutcome', () => {
    it('succeeds on or above the target and fails below it', () => {
        expect(psrRollOutcome(8, 8)).toBe('success');
        expect(psrRollOutcome(9, 8)).toBe('success');
        expect(psrRollOutcome(7, 8)).toBe('failed');
    });
});

describe('PagePsrWarningPanelComponent', () => {
    it('stages virtual and physical-dice outcomes until the results are accepted', () => {
        const check: PSRCheck = {
            id: 'fall-check',
            kind: PSR_CHECK_KIND.HIP_HIT,
            failure: FALL_PSR_FAILURE,
            fallCheck: 0,
            loc: 'RL',
            reason: 'Hip hit',
        };
        const damageCheck: PSRCheck = {
            id: 'damage-check',
            kind: PSR_CHECK_KIND.DAMAGE_THRESHOLD,
            failure: FALL_PSR_FAILURE,
            fallCheck: 1,
            reason: 'Received 20 damage',
        };
        const outcomes = new Map<string, 'success' | 'failed'>();
        const resolvePSRCheck = jasmine.createSpy('resolvePSRCheck').and.callFake(
            (checkId: string, outcome: 'success' | 'failed') => {
                outcomes.set(checkId, outcome);
                return true;
            },
        );
        const closeManagedOverlay = jasmine.createSpy('closeManagedOverlay');
        const turnState = {
            getPSRChecks: () => [check, damageCheck],
            getPSROutcome: (checkId: string) => outcomes.get(checkId),
            resolvePSRCheck,
            autoFall: () => false,
            isPSRCheckAutomaticFailure: () => false,
            dmgReceived: () => 0,
        };
        const unit = {
            id: 'unit-1',
            getUnit: () => ({ type: 'Mek' }),
            getCondition: () => false,
            automationMode: () => 'ask',
            rules: { controlRollFullLabel: 'Piloting Skill Rolls' },
            turnState: () => turnState,
            PSRTargetRoll: () => 8,
            PSRModifiers: () => ({ modifiers: [
                { pilotCheck: 2, reason: 'Gyro hit' },
                { pilotCheck: 1, loc: 'RL', reason: 'Hip hit' },
                {
                    pilotCheck: 3,
                    loc: 'LL',
                    reason: 'Hip hit, Leg Actuator hit',
                    modifierReason: 'Hip hit, Leg Actuators hit (2)',
                },
            ] }),
            resolveRuleCheck: jasmine.createSpy('resolveRuleCheck'),
        };

        TestBed.configureTestingModule({
            imports: [PagePsrWarningPanelComponent],
            providers: [
                {
                    provide: PSR_WARNING_UNIT,
                    useValue: signal({
                        ...unit,
                        psrOutcomeSelections: signal<Readonly<Record<string, 'success' | 'failed'>>>({}),
                        psrDiceSelections: signal<Readonly<Record<string, readonly [number, number]>>>({}),
                    }),
                },
                { provide: OverlayManagerService, useValue: { closeManagedOverlay } },
            ],
        });
        const fixture = TestBed.createComponent(PagePsrWarningPanelComponent);
        fixture.detectChanges();
        const roller = fixture.debugElement
            .query(node => node.componentInstance instanceof DiceRollerComponent)
            .componentInstance as DiceRollerComponent;
        spyOn(roller, 'roll');

        fixture.componentInstance.roll(check);
        fixture.componentInstance.onRollFinished({ results: [4, 4], sum: 8 });

        expect(roller.roll).toHaveBeenCalledTimes(1);
        expect(resolvePSRCheck).not.toHaveBeenCalled();
        expect(fixture.componentInstance.outcome(check)).toBe('success');
        expect(fixture.componentInstance.rolledResult()).toBe('SUCCESS');
        expect(fixture.componentInstance.diceFor(check)).toEqual([4, 4]);
        expect(fixture.componentInstance.canAccept()).toBeFalse();

        fixture.componentInstance.selectOutcome(damageCheck, 'success');
        expect(fixture.componentInstance.canAccept()).toBeTrue();
        expect(resolvePSRCheck).not.toHaveBeenCalled();

        fixture.componentInstance.accept();

        expect(resolvePSRCheck.calls.allArgs()).toEqual([
            ['fall-check', 'success'],
            ['damage-check', 'success'],
        ]);
        expect(closeManagedOverlay).toHaveBeenCalledOnceWith('psrWarning-unit-1');
    });

    it('keeps a rule-check choice provisional until it is accepted', () => {
        const check: PSRCheck = {
            id: 'torso-check',
            kind: PSR_CHECK_KIND.TORSO_DESTROYED,
            failure: { kind: PSR_FAILURE_KIND.RULE_RESOLUTION, label: 'Shutdown' },
            fallCheck: 0,
            reason: 'RISC emergency shutdown',
            resolution: { key: 'risc-shutdown', token: 'token-1' },
        };
        let checks: PSRCheck[] = [check];
        let status: 'pending' | 'success' | 'failed' = 'pending';
        const closeManagedOverlay = jasmine.createSpy('closeManagedOverlay');
        const resolveRuleCheck = jasmine.createSpy('resolveRuleCheck').and.callFake(
            (_key: string, _token: string, result: 'success' | 'failed') => {
                status = result;
                checks = [];
                return true;
            },
        );
        const turnState = {
            getPSRChecks: () => checks,
            getPSROutcome: () => undefined,
            resolvePSRCheck: jasmine.createSpy('resolvePSRCheck'),
            autoFall: () => false,
            isPSRCheckAutomaticFailure: () => false,
            dmgReceived: () => 0,
        };
        const unit = {
            id: 'unit-1',
            getUnit: () => ({ type: 'Mek' }),
            getCondition: () => false,
            automationMode: () => 'ask',
            rules: { controlRollFullLabel: 'Piloting Skill Rolls' },
            turnState: () => turnState,
            PSRTargetRoll: () => 8,
            PSRModifiers: () => ({ modifiers: [] }),
            resolveRuleCheck,
            getRuleCheck: () => ({ token: 'token-1', status }),
        };

        TestBed.configureTestingModule({
            imports: [PagePsrWarningPanelComponent],
            providers: [
                {
                    provide: PSR_WARNING_UNIT,
                    useValue: signal({
                        ...unit,
                        psrOutcomeSelections: signal<Readonly<Record<string, 'success' | 'failed'>>>({}),
                    }),
                },
                { provide: OverlayManagerService, useValue: { closeManagedOverlay } },
            ],
        });
        const fixture = TestBed.createComponent(PagePsrWarningPanelComponent);

        fixture.componentInstance.selectOutcome(check, 'success');

        expect(resolveRuleCheck).not.toHaveBeenCalled();
        expect(fixture.componentInstance.psrChecks()).toEqual([check]);
        expect(fixture.componentInstance.outcome(check)).toBe('success');

        fixture.componentInstance.accept();

        expect(resolveRuleCheck).toHaveBeenCalledOnceWith('risc-shutdown', 'token-1', 'success');
        expect(closeManagedOverlay).toHaveBeenCalledOnceWith('psrWarning-unit-1');
    });

    it('keeps provisional choices when closed and restores them when reopened', () => {
        const check: PSRCheck = {
            id: 'fall-check',
            kind: PSR_CHECK_KIND.DAMAGE_THRESHOLD,
            failure: FALL_PSR_FAILURE,
            fallCheck: 0,
            reason: 'Received 20 damage',
        };
        const resolvePSRCheck = jasmine.createSpy('resolvePSRCheck');
        const closeManagedOverlay = jasmine.createSpy('closeManagedOverlay');
        const turnState = {
            getPSRChecks: () => [check],
            getPSROutcome: () => undefined,
            resolvePSRCheck,
            autoFall: () => false,
            isPSRCheckAutomaticFailure: () => false,
            dmgReceived: () => 0,
        };
        const unit = {
            id: 'unit-1',
            getUnit: () => ({ type: 'Mek' }),
            getCondition: () => false,
            automationMode: () => 'ask',
            rules: { controlRollFullLabel: 'Piloting Skill Rolls' },
            turnState: () => turnState,
            PSRTargetRoll: () => 8,
            PSRModifiers: () => ({ modifiers: [] }),
            resolveRuleCheck: jasmine.createSpy('resolveRuleCheck'),
        };

        const psrOutcomeSelections = signal<Readonly<Record<string, 'success' | 'failed'>>>({});
        const psrDiceSelections = signal<Readonly<Record<string, readonly [number, number]>>>({});
        const parent = { unit: signal({ ...unit, psrOutcomeSelections, psrDiceSelections }) };
        TestBed.configureTestingModule({
            imports: [PagePsrWarningPanelComponent],
            providers: [
                { provide: PSR_WARNING_UNIT, useValue: parent.unit },
                { provide: OverlayManagerService, useValue: { closeManagedOverlay } },
            ],
        });
        const fixture = TestBed.createComponent(PagePsrWarningPanelComponent);

        fixture.componentInstance.selectOutcome(check, 'failed', [5, 2]);
        fixture.componentInstance.close();

        expect(resolvePSRCheck).not.toHaveBeenCalled();
        expect(unit.resolveRuleCheck).not.toHaveBeenCalled();
        expect(closeManagedOverlay).toHaveBeenCalledOnceWith('psrWarning-unit-1');
        expect(psrOutcomeSelections()).toEqual({ 'fall-check': 'failed' });
        expect(psrDiceSelections()).toEqual({ 'fall-check': [5, 2] });

        fixture.destroy();
        closeManagedOverlay.calls.reset();
        const reopenedFixture = TestBed.createComponent(PagePsrWarningPanelComponent);
        reopenedFixture.detectChanges();

        expect(reopenedFixture.componentInstance.outcome(check)).toBe('failed');
        expect(reopenedFixture.componentInstance.canAccept()).toBeTrue();
        expect(reopenedFixture.componentInstance.diceFor(check)).toEqual([5, 2]);

        reopenedFixture.componentInstance.accept();

        expect(resolvePSRCheck).toHaveBeenCalledOnceWith('fall-check', 'failed');
        expect(psrOutcomeSelections()).toEqual({});
        expect(psrDiceSelections()).toEqual({});
        expect(closeManagedOverlay).toHaveBeenCalledOnceWith('psrWarning-unit-1');
    });

    it('locks later Fall checks as failed while preserving independent checks', () => {
        const checks: PSRCheck[] = [
            {
                id: 'first-fall', kind: PSR_CHECK_KIND.GYRO_HIT,
                failure: FALL_PSR_FAILURE, fallCheck: 0, reason: 'First fall check',
            },
            {
                id: 'second-fall', kind: PSR_CHECK_KIND.DAMAGE_THRESHOLD,
                failure: FALL_PSR_FAILURE, fallCheck: 1, reason: 'Second fall check',
            },
            {
                id: 'control', kind: PSR_CHECK_KIND.TORSO_DESTROYED,
                failure: { kind: PSR_FAILURE_KIND.RULE_RESOLUTION, label: 'Immobilized' },
                fallCheck: 2, reason: 'Control check',
                resolution: { key: 'control-check', token: 'control-1' },
            },
            {
                id: 'third-fall', kind: PSR_CHECK_KIND.LEG_DESTROYED,
                failure: FALL_PSR_FAILURE, fallCheck: 3, reason: 'Third fall check',
            },
        ];
        const resolvePSRCheck = jasmine.createSpy('resolvePSRCheck').and.returnValue(true);
        const resolveRuleCheck = jasmine.createSpy('resolveRuleCheck');
        const closeManagedOverlay = jasmine.createSpy('closeManagedOverlay');
        const turnState = {
            getPSRChecks: () => checks,
            getPSROutcome: () => undefined,
            resolvePSRCheck,
            autoFall: () => false,
            isPSRCheckAutomaticFailure: () => false,
            dmgReceived: () => 0,
        };
        const unit = {
            id: 'unit-1',
            getUnit: () => ({ type: 'Mek' }),
            getCondition: () => false,
            automationMode: () => 'ask',
            rules: { controlRollFullLabel: 'Piloting Skill Rolls' },
            turnState: () => turnState,
            PSRTargetRoll: () => 8,
            PSRModifiers: () => ({ modifiers: [] }),
            getRuleCheck: () => undefined,
            resolveRuleCheck,
        };

        TestBed.configureTestingModule({
            imports: [PagePsrWarningPanelComponent],
            providers: [
                {
                    provide: PSR_WARNING_UNIT,
                    useValue: signal({
                        ...unit,
                        psrOutcomeSelections: signal<Readonly<Record<string, 'success' | 'failed'>>>({}),
                    }),
                },
                { provide: OverlayManagerService, useValue: { closeManagedOverlay } },
            ],
        });
        const fixture = TestBed.createComponent(PagePsrWarningPanelComponent);
        fixture.detectChanges();
        const component = fixture.componentInstance;

        component.selectOutcome(checks[0], 'success');
        component.selectOutcome(checks[1], 'failed');
        fixture.detectChanges();

        expect(component.outcome(checks[0])).toBe('success');
        expect(component.outcome(checks[1])).toBe('failed');
        expect(component.outcome(checks[2])).toBeUndefined();
        expect(component.outcome(checks[3])).toBe('failed');
        expect(component.isCascadedFailure(checks[3])).toBeTrue();
        expect(resolvePSRCheck).not.toHaveBeenCalled();

        expect(component.canAccept()).toBeFalse();

        component.selectOutcome(checks[2], 'success');
        fixture.detectChanges();
        expect(component.canAccept()).toBeTrue();

        component.accept();

        expect(resolvePSRCheck.calls.allArgs()).toEqual([
            ['first-fall', 'success'],
            ['second-fall', 'failed'],
            ['third-fall', 'failed'],
        ]);
        expect(resolveRuleCheck).toHaveBeenCalledOnceWith('control-check', 'control-1', 'success');
        expect(closeManagedOverlay).toHaveBeenCalledOnceWith('psrWarning-unit-1');
    });

    it('presents an unconscious pilot\'s pending PSR as an automatic failure', () => {
        const check: PSRCheck = {
            id: 'gyro-destroyed',
            kind: PSR_CHECK_KIND.GYRO_DESTROYED,
            failure: FALL_PSR_FAILURE,
            fallCheck: 6,
            reason: 'Gyro destroyed',
        };
        const turnState = {
            getPSRChecks: () => [check],
            getPSROutcome: () => undefined,
            resolvePSRCheck: jasmine.createSpy('resolvePSRCheck'),
            autoFall: () => false,
            isPSRCheckAutomaticFailure: () => true,
            dmgReceived: () => 0,
        };
        const unit = {
            id: 'unit-1',
            rules: { controlRollFullLabel: 'Piloting Skill Rolls' },
            turnState: () => turnState,
            PSRTargetRoll: () => 11,
            PSRModifiers: () => ({ modifiers: [] }),
            psrOutcomeSelections: signal<Readonly<Record<string, 'success' | 'failed'>>>({}),
            psrDiceSelections: signal<Readonly<Record<string, readonly [number, number]>>>({}),
            resolveRuleCheck: jasmine.createSpy('resolveRuleCheck'),
        };

        TestBed.configureTestingModule({
            imports: [PagePsrWarningPanelComponent],
            providers: [
                { provide: PSR_WARNING_UNIT, useValue: signal(unit) },
                { provide: OverlayManagerService, useValue: { closeManagedOverlay: jasmine.createSpy('closeManagedOverlay') } },
            ],
        });
        const fixture = TestBed.createComponent(PagePsrWarningPanelComponent);
        fixture.detectChanges();

        expect(fixture.componentInstance.isAutomaticFailure(check)).toBeTrue();
        expect(fixture.componentInstance.outcome(check)).toBe('failed');
        expect(fixture.componentInstance.allChecksAutomaticFailure()).toBeTrue();
        expect(fixture.componentInstance.showRollDetails()).toBeFalse();
        expect(fixture.nativeElement.querySelector('.psr-automatic-failure')?.textContent.trim())
            .toBe('AUTOMATIC FAILURE');
    });

});
