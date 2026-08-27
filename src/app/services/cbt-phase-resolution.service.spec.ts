// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import { TestBed } from '@angular/core/testing';
import type { CBTForceUnit } from '../models/cbt-force-unit.model';
import {
    FALL_PSR_FAILURE,
    isFallPSRCheck,
    PSR_CHECK_KIND,
    type PSRCheck,
} from '../models/rules/unit-type-rules';
import type { AutomationMode } from '../models/options.model';
import { CBTPhaseResolutionService } from './cbt-phase-resolution.service';
import { FallingResolutionService } from './falling-resolution.service';
import { MekCriticalResolutionService } from './mek-critical-resolution.service';
import { ToastService } from './toast.service';
import { UnitCheckResolutionService } from './unit-check-resolution.service';

interface PhaseHarness {
    readonly unit: CBTForceUnit;
    readonly completePilotDamageTurn: jasmine.Spy;
    readonly endPhase: jasmine.Spy;
    readonly resetPSRChecks: jasmine.Spy;
    readonly outcomes: Map<string, 'success' | 'failed'>;
    mode: AutomationMode;
    prone: boolean;
    autoFall: boolean;
    pendingFallId?: string;
    pendingUnitChecks: number;
    critical?: { type: 'mek-critical-chance' | 'mek-critical-hit'; id: string };
    checks: PSRCheck[];
}

describe('CBTPhaseResolutionService', () => {
    let service: CBTPhaseResolutionService;
    let resumeFall: jasmine.Spy;
    let resumeChance: jasmine.Spy;
    let resumeCritical: jasmine.Spy;
    let openUnitChecks: jasmine.Spy;
    let showToast: jasmine.Spy;

    beforeEach(() => {
        resumeFall = jasmine.createSpy('resume').and.resolveTo();
        resumeChance = jasmine.createSpy('resumeChance').and.resolveTo();
        resumeCritical = jasmine.createSpy('resume').and.resolveTo();
        openUnitChecks = jasmine.createSpy('open').and.resolveTo(true);
        showToast = jasmine.createSpy('showToast');

        TestBed.configureTestingModule({
            providers: [
                CBTPhaseResolutionService,
                { provide: FallingResolutionService, useValue: { resume: resumeFall } },
                {
                    provide: MekCriticalResolutionService,
                    useValue: { resumeChance, resume: resumeCritical },
                },
                { provide: UnitCheckResolutionService, useValue: { open: openUnitChecks } },
                { provide: ToastService, useValue: { showToast } },
            ],
        });
        service = TestBed.inject(CBTPhaseResolutionService);
    });

    it('drains the complete chain and commits the phase only after it is empty', async () => {
        const order: string[] = [];
        const harness = createHarness();
        harness.pendingFallId = 'fall:1';
        harness.critical = { type: 'mek-critical-chance', id: 'critical:1' };

        resumeFall.and.callFake(async () => {
            order.push('fall');
            harness.pendingFallId = undefined;
            harness.pendingUnitChecks = 1;
        });
        openUnitChecks.and.callFake(async () => {
            if (harness.pendingUnitChecks > 0) {
                order.push('unit-check');
                harness.pendingUnitChecks = 0;
            } else {
                order.push('psr');
                harness.outcomes.set('psr:1', 'success');
            }
            return true;
        });
        resumeChance.and.callFake(async () => {
            order.push('critical');
            harness.critical = undefined;
            harness.checks = [fallCheck('psr:1')];
        });
        harness.endPhase.and.callFake(() => {
            order.push('commit');
        });

        expect(await service.endPhase(harness.unit)).toBeTrue();

        expect(order).toEqual(['fall', 'unit-check', 'critical', 'psr', 'commit']);
        expect(harness.endPhase).toHaveBeenCalledTimes(1);
    });

    it('aborts immediately when CLOSE leaves the current fall queued', async () => {
        const harness = createHarness();
        harness.pendingFallId = 'fall:1';

        expect(await service.endPhase(harness.unit)).toBeFalse();

        expect(resumeFall).toHaveBeenCalledTimes(1);
        expect(harness.endPhase).not.toHaveBeenCalled();
    });

    it('aborts without a hanging operation when the PSR dialog is closed', async () => {
        const harness = createHarness();
        harness.checks = [fallCheck('psr:1')];
        openUnitChecks.and.resolveTo(false);

        expect(await service.endPhase(harness.unit)).toBeFalse();

        expect(openUnitChecks).toHaveBeenCalledOnceWith([harness.unit], true, false);
        expect(harness.endPhase).not.toHaveBeenCalled();
        expect(service.isResolving(harness.unit)).toBeFalse();
    });

    it('keeps the phase uncommitted when its boundary consciousness dialog is closed', async () => {
        const harness = createHarness();
        harness.pendingUnitChecks = 1;
        openUnitChecks.and.resolveTo(false);

        expect(await service.endPhase(harness.unit)).toBeFalse();

        expect(openUnitChecks).toHaveBeenCalledOnceWith([harness.unit], true, false);
        expect(harness.endPhase).not.toHaveBeenCalled();
    });

    it('automatically rolls each unresolved PSR in yes mode', async () => {
        const harness = createHarness();
        harness.mode = 'yes';
        harness.checks = [fallCheck('psr:1'), fallCheck('psr:2')];
        spyOn(Math, 'random').and.returnValues(0.99, 0.99, 0, 0);
        resumeFall.and.callFake(async () => {
            harness.pendingFallId = undefined;
            harness.pendingUnitChecks = 1;
        });
        openUnitChecks.and.callFake(async () => {
            harness.pendingUnitChecks = 0;
            return true;
        });

        expect(await service.endPhase(harness.unit)).toBeTrue();

        expect(harness.outcomes).toEqual(new Map([
            ['psr:1', 'success'],
            ['psr:2', 'failed'],
        ]));
        expect(resumeFall).toHaveBeenCalledTimes(1);
        expect(openUnitChecks).toHaveBeenCalledTimes(1);
        expect(harness.endPhase).toHaveBeenCalledTimes(1);
        expect(showToast.calls.allArgs()).toEqual([
            ['unit:1 — Piloting Skill Check: PASSED (12 vs 7+) — psr:1', 'success'],
            ['unit:1 — Piloting Skill Check: FAILED (2 vs 7+) — psr:2', 'error'],
        ]);
    });

    it('opens yes-mode PSRs for manual resolution when the pending badge is used', async () => {
        const harness = createHarness();
        harness.mode = 'yes';
        harness.checks = [fallCheck('psr:1')];
        spyOn(Math, 'random');
        openUnitChecks.and.callFake(async () => {
            harness.outcomes.set('psr:1', 'success');
            return true;
        });

        expect(await service.resumePendingChain(harness.unit)).toBeTrue();

        expect(openUnitChecks).toHaveBeenCalledOnceWith([harness.unit], false, true);
        expect(Math.random).not.toHaveBeenCalled();
        expect(harness.outcomes.get('psr:1')).toBe('success');
        expect(showToast).not.toHaveBeenCalled();
    });

    it('rolls the TW shutdown PSR but automatically fails a later PSR while shutdown', async () => {
        const harness = createHarness();
        harness.mode = 'yes';
        harness.checks = [
            {
                id: 'shutdown', kind: PSR_CHECK_KIND.SHUTDOWN,
                failure: FALL_PSR_FAILURE, reason: 'Shutdown', fallCheck: 3,
            },
            {
                id: 'damage', kind: PSR_CHECK_KIND.DAMAGE_THRESHOLD,
                failure: FALL_PSR_FAILURE, reason: 'Received 20 damage', fallCheck: 1,
            },
        ];
        spyOn(harness.unit.turnState(), 'isPSRCheckAutomaticFailure')
            .and.callFake(check => check.kind !== PSR_CHECK_KIND.SHUTDOWN);
        spyOn(Math, 'random').and.returnValues(0.99, 0.99);
        resumeFall.and.callFake(async () => {
            harness.pendingFallId = undefined;
        });

        expect(await service.endPhase(harness.unit)).toBeTrue();

        expect(harness.outcomes).toEqual(new Map([
            ['shutdown', 'success'],
            ['damage', 'failed'],
        ]));
        expect(Math.random).toHaveBeenCalledTimes(2);
        expect(resumeFall).toHaveBeenCalledTimes(1);
        expect(showToast.calls.allArgs()).toEqual([
            ['unit:1 — Piloting Skill Check: PASSED (12 vs 7+) — Shutdown', 'success'],
            ['unit:1 — Piloting Skill Check: FAILED (automatic) — Received 20 damage', 'error'],
        ]);
    });

    it('keeps PSRs informational in no mode and clears them at the boundary', async () => {
        const harness = createHarness();
        harness.mode = 'no';
        harness.autoFall = true;
        harness.checks = [fallCheck('psr:1')];

        expect(await service.endPhase(harness.unit)).toBeTrue();

        expect(harness.resetPSRChecks).toHaveBeenCalled();
        expect(resumeFall).not.toHaveBeenCalled();
        expect(openUnitChecks).not.toHaveBeenCalled();
        expect(harness.endPhase).toHaveBeenCalledTimes(1);
    });

    it('does not pull a future consciousness recovery into the current phase', async () => {
        const harness = createHarness();
        // pendingUnitCheckCount is the actionable gate. A serialized recovery
        // whose readyTurn is in the future deliberately reports zero here.
        harness.pendingUnitChecks = 0;

        expect(await service.endPhase(harness.unit)).toBeTrue();

        expect(openUnitChecks).not.toHaveBeenCalled();
        expect(harness.endPhase).toHaveBeenCalledTimes(1);
    });

    it('drains a post-phase shutdown PSR, fall, and seatbelt chain without committing again', async () => {
        const harness = createHarness();
        harness.mode = 'yes';
        harness.pendingUnitChecks = 1;
        const order: string[] = [];
        spyOn(Math, 'random').and.returnValues(0, 0);
        openUnitChecks.and.callFake(async (_units: readonly CBTForceUnit[], atPhaseEnd: boolean) => {
            order.push(atPhaseEnd ? 'phase-check' : 'turn-check');
            harness.pendingUnitChecks = 0;
            if (order.length === 1) harness.checks = [fallCheck('shutdown')];
            return true;
        });
        resumeFall.and.callFake(async () => {
            order.push('fall');
            harness.pendingFallId = undefined;
            harness.pendingUnitChecks = 1;
        });

        expect(await service.resolvePendingChain(harness.unit)).toBeTrue();

        expect(order).toEqual(['turn-check', 'fall', 'turn-check']);
        expect(openUnitChecks).toHaveBeenCalledTimes(2);
        expect(resumeFall).toHaveBeenCalledOnceWith(harness.unit, true, false);
        expect(harness.endPhase).not.toHaveBeenCalled();
    });

    it('resumes an overlay event chain without closing phase groups or consolidating fall damage', async () => {
        const harness = createHarness();
        harness.pendingFallId = 'fall:1';
        harness.critical = { type: 'mek-critical-hit', id: 'critical:1' };

        resumeFall.and.callFake(async () => {
            harness.pendingFallId = undefined;
        });
        resumeCritical.and.callFake(async () => {
            harness.critical = undefined;
        });

        expect(await service.resumePendingChain(harness.unit)).toBeTrue();

        expect(resumeFall).toHaveBeenCalledOnceWith(harness.unit, false, true);
        expect(resumeCritical).toHaveBeenCalledOnceWith(harness.unit, 'critical:1', true);
        expect(harness.completePilotDamageTurn).not.toHaveBeenCalled();
        expect(harness.endPhase).not.toHaveBeenCalled();
    });

    it('opens the next queued critical automatically after the current critical is resolved', async () => {
        const harness = createHarness();
        harness.critical = { type: 'mek-critical-chance', id: 'critical:1' };
        resumeChance.and.callFake(async (_unit: CBTForceUnit, pendingId: string) => {
            harness.critical = pendingId === 'critical:1'
                ? { type: 'mek-critical-chance', id: 'critical:2' }
                : undefined;
        });

        expect(await service.resumePendingChain(harness.unit)).toBeTrue();

        expect(resumeChance.calls.allArgs()).toEqual([
            [harness.unit, 'critical:1', true],
            [harness.unit, 'critical:2', true],
        ]);
    });

    it('stops an overlay event chain when CLOSE leaves the current event queued', async () => {
        const harness = createHarness();
        harness.critical = { type: 'mek-critical-chance', id: 'critical:1' };

        expect(await service.resumePendingChain(harness.unit)).toBeFalse();

        expect(resumeChance).toHaveBeenCalledOnceWith(harness.unit, 'critical:1', true);
        expect(harness.critical).toEqual({ type: 'mek-critical-chance', id: 'critical:1' });
    });
});

function createHarness(): PhaseHarness {
    const harness = {
        unit: null as unknown as CBTForceUnit,
        mode: 'ask' as AutomationMode,
        prone: false,
        autoFall: false,
        pendingFallId: undefined as string | undefined,
        pendingUnitChecks: 0,
        critical: undefined as PhaseHarness['critical'],
        checks: [] as PSRCheck[],
        outcomes: new Map<string, 'success' | 'failed'>(),
        completePilotDamageTurn: jasmine.createSpy('completePilotDamageTurn'),
        endPhase: jasmine.createSpy('endPhase'),
        resetPSRChecks: jasmine.createSpy('resetPSRChecks'),
    } as PhaseHarness;
    const turnState = {
        completePilotDamageTurn: harness.completePilotDamageTurn,
        pendingUnitCheckCount: () => harness.pendingUnitChecks,
        pendingUnitCheckCountAtPhaseEnd: () => harness.pendingUnitChecks,
        getNextPendingCriticalEvent: () => harness.critical,
        getPSRChecks: () => harness.checks,
        getPSROutcome: (id: string) => harness.outcomes.get(id),
        PSRRollsCount: () => harness.checks.filter(check =>
            check.id !== undefined && !harness.outcomes.has(check.id)).length,
        actionablePSRRollsCount: () => harness.checks.filter(check =>
            check.id !== undefined && !harness.outcomes.has(check.id)).length,
        automaticPSRFailure: () => false,
        isPSRCheckAutomaticFailure: () => false,
        autoFall: () => harness.autoFall,
        failPendingPSRChecks: jasmine.createSpy('failPendingPSRChecks'),
        resolvePSRCheck: jasmine.createSpy('resolvePSRCheck').and.callFake(
            (id: string, outcome: 'success' | 'failed') => {
                if (harness.outcomes.has(id)) return false;
                harness.outcomes.set(id, outcome);
                const check = harness.checks.find(candidate => candidate.id === id);
                if (outcome === 'failed' && check && isFallPSRCheck(check) && !harness.prone) {
                    harness.prone = true;
                    harness.pendingFallId = 'fall:psr';
                }
                return true;
            },
        ),
        resolveAutomaticFall: jasmine.createSpy('resolveAutomaticFall').and.callFake(() => {
            if (!harness.autoFall || harness.prone) return false;
            harness.prone = true;
            harness.pendingFallId = 'fall:auto';
            return true;
        }),
        resetPSRChecks: harness.resetPSRChecks.and.callFake(() => {
            harness.checks = [];
            harness.outcomes.clear();
        }),
    };
    const unit = {
        id: 'unit:1',
        force: null as unknown,
        turnState: () => turnState,
        automationMode: (key: string) => key === 'pilotSkillCheck' ? harness.mode : 'ask',
        pendingFallCount: () => harness.pendingFallId ? 1 : 0,
        getPendingFall: (id?: string) => harness.pendingFallId
            && (!id || id === harness.pendingFallId)
            ? { id: harness.pendingFallId, source: 'psr', levelsFallen: 0 }
            : undefined,
        tracksPhaseAndTurn: () => true,
        getCondition: (condition: string) => condition === 'prone' && harness.prone,
        getNotificationDisplayName: () => 'unit:1',
        PSRTargetRoll: () => 7,
        getRuleCheck: () => undefined,
        resolveRuleCheck: jasmine.createSpy('resolveRuleCheck').and.returnValue(true),
        resolvePendingCrewDeaths: jasmine.createSpy('resolvePendingCrewDeaths'),
        endPhase: harness.endPhase,
    } as unknown as CBTForceUnit;
    (unit as unknown as { force: { units: () => CBTForceUnit[] } }).force = { units: () => [unit] };
    (harness as { unit: CBTForceUnit }).unit = unit;
    return harness;
}

function fallCheck(id: string): PSRCheck {
    return {
        id,
        kind: PSR_CHECK_KIND.DAMAGE_THRESHOLD,
        failure: FALL_PSR_FAILURE,
        fallCheck: 0,
        reason: id,
    };
}
