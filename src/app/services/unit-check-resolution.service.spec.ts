// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import { provideZonelessChangeDetection, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { of } from 'rxjs';
import type { CBTForceUnit } from '../models/cbt-force-unit.model';
import type { PendingEventInput, SerializedPendingUnitCheck } from '../models/force-serialization';
import type { AutomationMode } from '../models/options.model';
import type { HeatAmmoExplosionCandidate } from '../utils/heat-effects.util';
import {
    pendingCheckReviewGroupList,
    pendingUnitCheckGroupList,
    pendingUnitCheckGroupStage,
    pendingUnitCheckStage,
    type PendingCheckReviewEntry,
    type PendingUnitCheckEntry,
} from '../utils/unit-check.util';
import { DialogsService } from './dialogs.service';
import { OptionsService } from './options.service';
import { ToastService } from './toast.service';
import { UnitCheckResolutionService } from './unit-check-resolution.service';

describe('UnitCheckResolutionService', () => {
    type CheckInput = PendingEventInput<SerializedPendingUnitCheck>;

    let service: UnitCheckResolutionService;
    let createDialog: jasmine.Spy;
    let showToast: jasmine.Spy;
    let automationModes: Record<string, AutomationMode>;

    function createHarness(
        initialChecks: readonly CheckInput[],
        rulesId: 'core2026' | 'tw' = 'core2026',
        psrCount = 0,
        unitType: 'Mek' | 'Aero' = 'Mek',
        airborne = false,
        criticalCount = 0,
        unitId = 'unit-under-test',
    ) {
        const checks = new Map(initialChecks.map(check => [
            check.id,
            { type: 'unit-check', ...check } as SerializedPendingUnitCheck,
        ]));
        const psrChecks = Array.from({ length: psrCount }, (_value, index) => ({
            id: `psr:${index + 1}`,
            fallCheck: 0,
            reason: `PSR ${index + 1}`,
            failureOutcome: 'Fall',
        }));
        const psrOutcomes = new Map<string, 'success' | 'failed'>();
        const psrOutcomeSelections = signal<Readonly<Record<string, 'success' | 'failed'>>>({});
        const psrDiceSelections = signal<Readonly<Record<string, readonly [number, number]>>>({});
        let crewState = 'healthy';
        const queuePendingUnitCheck = jasmine.createSpy('queuePendingUnitCheck').and.callFake(
            (check: CheckInput) => {
                checks.set(check.id, { type: 'unit-check', ...check } as SerializedPendingUnitCheck);
                return true;
            },
        );
        const discardPendingUnitCheck = jasmine.createSpy('discardPendingUnitCheck').and.callFake((id: string) =>
            checks.delete(id));
        const discardPendingUnitChecks = jasmine.createSpy('discardPendingUnitChecks').and.callFake(
            (predicate: (check: SerializedPendingUnitCheck) => boolean) => {
                let removed = 0;
                for (const [id, check] of checks) {
                    if (!predicate(check)) continue;
                    checks.delete(id);
                    removed++;
                }
                return removed;
            },
        );
        const crew = {
            getState: jasmine.createSpy('getState').and.callFake(() => crewState),
            setState: jasmine.createSpy('setState').and.callFake((state: string) => { crewState = state; }),
            getHits: jasmine.createSpy('getHits').and.returnValue(3),
        };
        const refreshPendingUnitCheckTargets = jasmine.createSpy('refreshPendingUnitCheckTargets').and.callFake(() => {
            if (crewState === 'healthy') return;
            for (const [id, check] of checks) {
                if (check.kind !== 'seatbelt') continue;
                const { target: _target, result: _result, ...facts } = check;
                checks.set(id, {
                    ...facts,
                    result: { kind: 'automatic', outcome: 'failed' },
                } as SerializedPendingUnitCheck);
            }
        });
        const turnState = {
            getPendingUnitCheck: (id: string) => checks.get(id),
            getPendingUnitChecks: () => Array.from(checks.values()),
            pendingUnitCheckCount: () => checks.size,
            actionablePendingUnitChecks: () => Array.from(checks.values()).filter(check =>
                (!('readyTurn' in check) || check.readyTurn <= 0)
                && !(rulesId === 'core2026'
                    && check.kind === 'consciousness'
                    && check.pilotDamageGroup.startsWith('combat:'))),
            phaseEndPendingUnitChecks: () => Array.from(checks.values()).filter(check =>
                !('readyTurn' in check) || check.readyTurn <= 0),
            queuePendingUnitCheck,
            discardPendingUnitCheck,
            discardPendingUnitChecks,
            setPendingUnitCheckOutcome: (
                id: string,
                outcome: 'success' | 'failed',
                roll?: readonly number[],
            ) => {
                const check = checks.get(id);
                if (!check || check.target === undefined) return false;
                checks.set(id, {
                    ...check,
                    result: roll
                        ? { kind: 'roll', dice: [roll[0], roll[1]] as const }
                        : { kind: 'manual', outcome },
                } as SerializedPendingUnitCheck);
                return true;
            },
            setPendingUnitCheckSelection: (id: string, selectionId: string) => {
                const check = checks.get(id);
                if (!check || check.kind !== 'heat-ammo-explosion') return false;
                checks.set(id, { ...check, selectionId });
                return true;
            },
            refreshPendingUnitCheckTargets,
            setPSRCheckState: jasmine.createSpy('setPSRCheckState'),
            getPSRCheckState: () => ({}),
            PSRRollsCount: () => psrChecks.filter(check => !psrOutcomes.has(check.id)).length,
            actionablePSRRollsCount: () => psrChecks.filter(check => !psrOutcomes.has(check.id)).length,
            automaticPSRFailure: () => false,
            autoFall: () => false,
            getPSRChecks: () => psrChecks,
            getPSROutcome: (id: string) => psrOutcomes.get(id),
            resolvePSRCheck: jasmine.createSpy('resolvePSRCheck').and.callFake(
                (id: string, outcome: 'success' | 'failed') => {
                    if (psrOutcomes.has(id)) return false;
                    psrOutcomes.set(id, outcome);
                    return true;
                },
            ),
            pendingCriticalChanceCount: () => criticalCount,
            pendingCriticalHitCount: () => criticalCount,
            failPendingPSRChecks: jasmine.createSpy('failPendingPSRChecks'),
            getTurnCounter: () => 0,
            airborne: () => airborne,
            dirty: () => false,
        };
        const queueConsciousnessRecovery = jasmine.createSpy('queueConsciousnessRecovery').and.callFake(
            (crewId: number, delay: number, replacingCheckId?: string) => {
                if (Array.from(checks.values()).some(check => check.id !== replacingCheckId
                    && check.kind === 'consciousness-recovery'
                    && (check.crewId ?? 0) === crewId)) return false;
                return queuePendingUnitCheck({
                    id: `recovery:${crewId}:${checks.size}`,
                    kind: 'consciousness-recovery',
                    crewId,
                    target: 7,
                    readyTurn: delay,
                });
            },
        );
        const unit = {
            id: unitId,
            automationMode: () => 'ask',
            getNotificationDisplayName: () => unitId,
            psrOutcomeSelections,
            psrDiceSelections,
            getRuleCheck: () => undefined,
            resolveRuleCheck: jasmine.createSpy('resolveRuleCheck'),
            pendingFallCount: () => 0,
            turnState: () => turnState,
            applyPilotHits: jasmine.createSpy('applyPilotHits'),
            applyLifeSupportDrowningCrewHits: jasmine.createSpy('applyLifeSupportDrowningCrewHits'),
            applyHeatCrewHits: jasmine.createSpy('applyHeatCrewHits'),
            applyInternalExplosionCrewHits: jasmine.createSpy('applyInternalExplosionCrewHits'),
            setCondition: jasmine.createSpy('setCondition'),
            getCondition: () => false,
            getCrewMember: () => crew,
            getCrewMembers: () => [crew],
            setCrewState: jasmine.createSpy('setCrewState').and.callFake(
                (crewId: number, state: string, recoveryDelay = 1) => {
                    crew.setState(state);
                    if (state === 'unconscious') queueConsciousnessRecovery(crewId, recoveryDelay);
                    return true;
                },
            ),
            queueConsciousnessRecovery,
            getUnit: () => ({ type: unitType }),
            gameRules: {
                id: rulesId,
                aggregatedEndPhaseConsciousRolls: rulesId === 'core2026',
            },
            rules: {
                getBasePilotingSkill: () => 5,
                getStandardControlRollTarget: () => 5,
                getActivePilotCrewId: () => crewState === 'healthy' ? 0 : null,
                isRemoteDrone: () => false,
            },
            PSRModifiers: () => ({ modifier: 0 }),
        } as unknown as CBTForceUnit;
        return {
            unit,
            checks,
            psrOutcomes,
            turnState,
            crew,
            queuePendingUnitCheck,
            discardPendingUnitCheck,
        };
    }

    function apply(unit: CBTForceUnit, checks: readonly CheckInput[], atPhaseEnd = false): void {
        const entries: PendingUnitCheckEntry[] = checks.map(check => ({
            unit,
            check: { type: 'unit-check', ...check } as SerializedPendingUnitCheck,
        }));
        (service as unknown as {
            applyResolved(entries: readonly PendingUnitCheckEntry[], atPhaseEnd?: boolean): void;
        }).applyResolved(entries, atPhaseEnd);
    }

    beforeEach(() => {
        automationModes = {
            heatEffectsCheck: 'ask',
            pilotHitsAndConsciousnessCheck: 'ask',
        };
        createDialog = jasmine.createSpy('createDialog').and.returnValue({ closed: of(undefined) });
        showToast = jasmine.createSpy('showToast');
        TestBed.configureTestingModule({
            providers: [
                provideZonelessChangeDetection(),
                UnitCheckResolutionService,
                { provide: DialogsService, useValue: { createDialog } },
                { provide: OptionsService, useValue: {
                    cbtAutomationMode: (key: string) => automationModes[key] ?? 'ask',
                } },
                { provide: ToastService, useValue: { showToast } },
            ],
        });
        service = TestBed.inject(UnitCheckResolutionService);
    });

    it('automatically rolls and applies consciousness checks in yes mode', async () => {
        automationModes['pilotHitsAndConsciousnessCheck'] = 'yes';
        spyOn(Math, 'random').and.returnValues(0, 0);
        const harness = createHarness([{
            id: 'consciousness',
            kind: 'consciousness',
            crewId: 0,
            pilotDamageGroup: 'immediate:test',
            target: 5,
        }], 'tw');

        expect(await service.open([harness.unit])).toBeTrue();

        expect(Math.random).toHaveBeenCalledTimes(2);
        expect(harness.unit.setCrewState).toHaveBeenCalledOnceWith(0, 'unconscious', 1);
        expect(Array.from(harness.checks.values()).map(check => check.kind))
            .toEqual(['consciousness-recovery']);
        expect(createDialog).not.toHaveBeenCalled();
        expect(showToast).toHaveBeenCalledOnceWith(
            'unit-under-test — Consciousness check: FAILED (2 vs 5+) — crew member rendered unconscious',
            'error',
        );
    });

    it('opens yes-mode checks for manual resolution when the pending badge is used', async () => {
        automationModes['pilotHitsAndConsciousnessCheck'] = 'yes';
        spyOn(Math, 'random');
        const harness = createHarness([{
            id: 'consciousness',
            kind: 'consciousness',
            crewId: 0,
            pilotDamageGroup: 'immediate:test',
            target: 5,
        }], 'tw');

        expect(await service.open([harness.unit], false, true)).toBeFalse();

        expect(createDialog).toHaveBeenCalledTimes(1);
        expect(Math.random).not.toHaveBeenCalled();
        expect(harness.checks.has('consciousness')).toBeTrue();
        expect(harness.unit.setCrewState).not.toHaveBeenCalled();
        expect(showToast).not.toHaveBeenCalled();
    });

    it('keeps an aerospace unit controlled when another crew member can take over', async () => {
        automationModes['pilotHitsAndConsciousnessCheck'] = 'yes';
        const harness = createHarness([{
            id: 'consciousness',
            kind: 'consciousness',
            crewId: 0,
            pilotDamageGroup: 'immediate:test',
            result: { kind: 'automatic', outcome: 'failed' },
        }], 'tw', 0, 'Aero', true);
        spyOn(harness.unit.rules, 'getActivePilotCrewId').and.returnValue(1);

        expect(await service.open([harness.unit])).toBeTrue();

        expect(harness.unit.setCrewState).toHaveBeenCalledOnceWith(0, 'unconscious', 1);
        expect(harness.turnState.failPendingPSRChecks).not.toHaveBeenCalled();
        expect(harness.unit.setCondition).not.toHaveBeenCalledWith('out-of-control', true);
    });

    it('summarizes automatic checks for multiple crew members in one toast', async () => {
        automationModes['pilotHitsAndConsciousnessCheck'] = 'yes';
        spyOn(Math, 'random').and.returnValues(0.99, 0.99, 0.99, 0.99);
        const harness = createHarness([
            {
                id: 'seatbelt:0',
                kind: 'seatbelt',
                crewId: 0,
                pilotDamageGroup: 'immediate:fall',
                target: 5,
            },
            {
                id: 'seatbelt:1',
                kind: 'seatbelt',
                crewId: 1,
                pilotDamageGroup: 'immediate:fall',
                result: { kind: 'automatic', outcome: 'failed' },
            },
            {
                id: 'seatbelt:2',
                kind: 'seatbelt',
                crewId: 2,
                pilotDamageGroup: 'immediate:fall',
                target: 4,
            },
        ]);
        (harness.unit.applyPilotHits as jasmine.Spy).and.returnValue(1);

        expect(await service.open([harness.unit])).toBeTrue();

        expect(harness.unit.applyPilotHits).toHaveBeenCalledOnceWith(1, 'immediate:fall', 1);
        expect(showToast).toHaveBeenCalledOnceWith(
            'unit-under-test — Seatbelt checks — Crew 1: PASSED (12 vs 5+) — pilot damage avoided; Crew 2: FAILED (automatic) — 1 pilot hit applied; Crew 3: PASSED (12 vs 4+) — pilot damage avoided',
            'error',
        );
    });

    it('automatically rolls and applies heat checks in yes mode', async () => {
        automationModes['heatEffectsCheck'] = 'yes';
        spyOn(Math, 'random').and.returnValues(0, 0);
        const harness = createHarness([{
            id: 'shutdown',
            kind: 'heat-shutdown',
            target: 6,
        }], 'tw');

        expect(await service.open([harness.unit])).toBeTrue();

        expect(harness.unit.setCondition).toHaveBeenCalledOnceWith('shutdown', true);
        expect(harness.checks.size).toBe(0);
        expect(createDialog).not.toHaveBeenCalled();
        expect(showToast).toHaveBeenCalledOnceWith(
            'unit-under-test — Shutdown: FAILED (2 vs 6+) — unit shut down',
            'error',
        );
    });

    it('shows a success toast when an automatic check passes', async () => {
        automationModes['heatEffectsCheck'] = 'yes';
        spyOn(Math, 'random').and.returnValues(0.99, 0.99);
        const harness = createHarness([{
            id: 'restart',
            kind: 'shutdown-recovery',
            target: 6,
        }], 'tw');

        expect(await service.open([harness.unit])).toBeTrue();

        expect(harness.unit.setCondition).toHaveBeenCalledOnceWith('shutdown', false);
        expect(showToast).toHaveBeenCalledOnceWith(
            'unit-under-test — Shutdown recovery: PASSED (12 vs 6+) — unit restarted',
            'success',
        );
    });

    it('reports the pilot hits actually applied by automatic damage', async () => {
        automationModes['pilotHitsAndConsciousnessCheck'] = 'yes';
        const harness = createHarness([{
            id: 'life-support',
            kind: 'heat-life-support',
            result: { kind: 'automatic', outcome: 'failed' },
            hits: 1,
        }]);
        (harness.unit.applyHeatCrewHits as jasmine.Spy).and.returnValue(3);

        expect(await service.open([harness.unit])).toBeTrue();

        expect(showToast).toHaveBeenCalledOnceWith(
            'unit-under-test — Life Support damage: FAILED (automatic) — 3 pilot hits applied',
            'error',
        );
    });

    it('applies an aerospace ammo explosion to the whole crew once', () => {
        const entry = {
            critSlots: [],
            setPendingDestroyed: jasmine.createSpy('setPendingDestroyed'),
            setCommittedDestroyed: jasmine.createSpy('setCommittedDestroyed'),
        };
        const applyCrewHits = jasmine.createSpy('applyInternalExplosionCrewHits').and.returnValue(3);
        const unit = {
            getInventory: () => [],
            isEquipmentOperational: () => true,
            findCurrentCriticalSlot: () => null,
            setInventoryEntry: jasmine.createSpy('setInventoryEntry'),
            addInternalHits: jasmine.createSpy('addInternalHits'),
            applyInternalExplosionCrewHits: applyCrewHits,
        } as unknown as CBTForceUnit;
        const candidate = {
            id: 'ammo',
            equipment: 'LRM Ammo',
            location: 'Fuselage',
            damagePerShot: 1,
            shots: 20,
            rawDamage: 20,
            entry,
        } as unknown as HeatAmmoExplosionCandidate;

        const effect = (service as unknown as {
            applyAeroAmmoExplosion(
                target: CBTForceUnit,
                ammo: HeatAmmoExplosionCandidate,
                group?: string,
            ): string | null;
        }).applyAeroAmmoExplosion(unit, candidate, 'heat:ammo');

        expect(applyCrewHits).toHaveBeenCalledOnceWith(1, 'heat:ammo');
        expect(effect).toBe('LRM Ammo exploded for 20 damage in Fuselage; 2 SI damage applied; 3 pilot hits applied');
    });

    it('applies deterministic Life Support damage once and removes the persisted result', () => {
        const check: CheckInput = {
            id: 'life-support',
            kind: 'heat-life-support',
            pilotDamageGroup: 'end-turn:one',
            result: { kind: 'automatic', outcome: 'failed' },
            hits: 2,
        };
        const harness = createHarness([check]);

        apply(harness.unit, [check]);

        expect(harness.unit.applyHeatCrewHits).toHaveBeenCalledOnceWith(2, 'end-turn:one');
        expect(harness.checks.size).toBe(0);
    });

    it('keeps submerged Life Support damage in the End Phase instead of the Heat Phase group', () => {
        const check: CheckInput = {
            id: 'drowning',
            kind: 'life-support-drowning',
            pilotDamageGroup: 'turn-closed:immediate:end-turn:one:end',
            result: { kind: 'automatic', outcome: 'failed' },
            hits: 1,
        };
        const harness = createHarness([check]);

        apply(harness.unit, [check]);

        expect(harness.unit.applyLifeSupportDrowningCrewHits).toHaveBeenCalledOnceWith(1, check.pilotDamageGroup);
        expect(harness.unit.applyHeatCrewHits).not.toHaveBeenCalled();
        expect(harness.checks.size).toBe(0);
    });

    it('applies approved Life Support damage silently and opens only its resulting consciousness roll', async () => {
        const lifeSupport: CheckInput = {
            id: 'life-support',
            kind: 'heat-life-support',
            pilotDamageGroup: 'turn-closed:heat:end-turn:one',
            result: { kind: 'automatic', outcome: 'failed' },
            hits: 2,
        };
        const harness = createHarness([lifeSupport]);
        (harness.unit.applyHeatCrewHits as jasmine.Spy).and.callFake((hits: number, group: string) => {
            harness.queuePendingUnitCheck({
                id: 'consciousness',
                kind: 'consciousness',
                crewId: 0,
                pilotDamageGroup: group,
                target: 5,
            });
            return hits;
        });

        await service.open([harness.unit]);

        expect(harness.unit.applyHeatCrewHits).toHaveBeenCalledOnceWith(2, lifeSupport.pilotDamageGroup);
        expect(Array.from(harness.checks.values()).map(check => check.kind)).toEqual(['consciousness']);
        expect(createDialog).toHaveBeenCalledTimes(1);
    });

    it('discards queued pilot-hit and consciousness automation when its mode is no', async () => {
        automationModes['pilotHitsAndConsciousnessCheck'] = 'no';
        const harness = createHarness([
            {
                id: 'life-support',
                kind: 'heat-life-support',
                result: { kind: 'automatic', outcome: 'failed' },
                hits: 1,
            },
            {
                id: 'consciousness',
                kind: 'consciousness',
                crewId: 0,
                pilotDamageGroup: 'immediate:test',
                target: 3,
            },
            {
                id: 'recovery',
                kind: 'consciousness-recovery',
                crewId: 0,
                target: 3,
                readyTurn: 0,
            },
        ]);

        await service.open([harness.unit]);

        expect(harness.checks.size).toBe(0);
        expect(harness.unit.applyHeatCrewHits).not.toHaveBeenCalled();
        expect(createDialog).not.toHaveBeenCalled();
    });

    it('exposes open Core combat consciousness only to an END PHASE resolution', async () => {
        const harness = createHarness([{
            id: 'consciousness',
            kind: 'consciousness',
            crewId: 0,
            pilotDamageGroup: 'combat:current-phase',
            target: 7,
        }]);

        expect(await service.open([harness.unit])).toBeTrue();
        expect(createDialog).not.toHaveBeenCalled();

        expect(await service.open([harness.unit], true)).toBeFalse();
        expect(createDialog).toHaveBeenCalledTimes(1);
        expect(createDialog.calls.mostRecent().args[1].data.atPhaseEnd).toBeTrue();
    });

    it('reviews every unit heat check and consciousness roll in one rules-ordered list', () => {
        const first = createHarness([
            { id: 'shutdown:one', kind: 'heat-shutdown', target: 6 },
            { id: 'ammo:one', kind: 'heat-ammo-explosion', target: 4 },
            {
                id: 'life-support:one', kind: 'heat-life-support', hits: 1,
                result: { kind: 'automatic', outcome: 'failed' },
            },
            {
                id: 'consciousness:one', kind: 'consciousness', crewId: 0,
                pilotDamageGroup: 'turn-closed:heat:end-turn:test', target: 5,
            },
        ], 'core2026', 0, 'Mek', false, 0, 'unit-one');
        const second = createHarness([
            { id: 'shutdown:two', kind: 'heat-shutdown', target: 6 },
            { id: 'ammo:two', kind: 'heat-ammo-explosion', target: 4 },
            {
                id: 'life-support:two', kind: 'heat-life-support', hits: 1,
                result: { kind: 'automatic', outcome: 'failed' },
            },
            {
                id: 'consciousness:two', kind: 'consciousness', crewId: 0,
                pilotDamageGroup: 'turn-closed:heat:end-turn:test', target: 5,
            },
        ], 'core2026', 0, 'Mek', false, 0, 'unit-two');

        expect(pendingUnitCheckGroupList([first.unit, second.unit])
            .map(entry => entry.check.id)).toEqual([
                'shutdown:one',
                'shutdown:two',
                'ammo:one',
                'ammo:two',
                'life-support:one',
                'life-support:two',
                'consciousness:one',
                'consciousness:two',
            ]);
    });

    it('applies one submitted full list in internal rules stages', () => {
        const checks: CheckInput[] = [
            {
                id: 'shutdown', kind: 'heat-shutdown', target: 6,
                result: { kind: 'manual', outcome: 'success' },
            },
            {
                id: 'ammo', kind: 'heat-ammo-explosion', target: 4,
                result: { kind: 'manual', outcome: 'success' },
            },
            {
                id: 'consciousness', kind: 'consciousness', crewId: 0,
                pilotDamageGroup: 'turn-closed:heat:end-turn:test', target: 5,
                result: { kind: 'manual', outcome: 'success' },
            },
        ];
        const harness = createHarness(checks);

        apply(harness.unit, checks);

        expect(harness.checks.size).toBe(0);
        expect(harness.unit.setCondition).not.toHaveBeenCalledWith('shutdown', false);
    });

    it('applies consciousness, PSR, and later unit checks from one submitted list', () => {
        const checks: CheckInput[] = [
            {
                id: 'consciousness', kind: 'consciousness', crewId: 0,
                pilotDamageGroup: 'immediate:test', target: 5,
                result: { kind: 'manual', outcome: 'success' },
            },
            {
                id: 'seatbelt', kind: 'seatbelt', crewId: 0, target: 5,
                result: { kind: 'manual', outcome: 'success' },
            },
        ];
        const harness = createHarness(checks, 'tw', 1);
        harness.unit.psrOutcomeSelections.set({ 'psr:1': 'success' });
        const entries = pendingCheckReviewGroupList([harness.unit]);

        (service as unknown as {
            applyResolved(entries: readonly PendingCheckReviewEntry[]): void;
        }).applyResolved(entries);

        expect(entries.map(entry => entry.check.id)).toEqual([
            'consciousness',
            'psr:1',
            'seatbelt',
        ]);
        expect(harness.psrOutcomes.get('psr:1')).toBe('success');
        expect(harness.checks.size).toBe(0);
    });

    it('turns a failed TW heat shutdown into a persistent fall PSR', () => {
        const check: CheckInput = {
            id: 'shutdown',
            kind: 'heat-shutdown',
            target: 6,
            result: { kind: 'manual', outcome: 'failed' },
        };
        const harness = createHarness([check], 'tw');

        apply(harness.unit, [check]);

        expect(harness.unit.setCondition).toHaveBeenCalledOnceWith('shutdown', true);
        expect(harness.turnState.setPSRCheckState).toHaveBeenCalledOnceWith({ shutdown: true });
        expect(harness.checks.size).toBe(0);
    });

    it('does not create a shutdown PSR under Core rules', () => {
        const check: CheckInput = {
            id: 'shutdown',
            kind: 'heat-shutdown',
            target: 6,
            result: { kind: 'manual', outcome: 'failed' },
        };
        const harness = createHarness([check], 'core2026');

        apply(harness.unit, [check]);

        expect(harness.unit.setCondition).toHaveBeenCalledOnceWith('shutdown', true);
        expect(harness.turnState.setPSRCheckState).not.toHaveBeenCalled();
    });

    it('restarts the engine only when shutdown recovery succeeds', () => {
        const check: CheckInput = {
            id: 'shutdown-recovery',
            kind: 'shutdown-recovery',
            target: 6,
            result: { kind: 'manual', outcome: 'success' },
        };
        const harness = createHarness([check]);

        apply(harness.unit, [check]);

        expect(harness.unit.setCondition).toHaveBeenCalledOnceWith('shutdown', false);
        expect(harness.checks.size).toBe(0);
    });

    it('queues next-turn recovery when a consciousness check fails', () => {
        const check: CheckInput = {
            id: 'consciousness',
            kind: 'consciousness',
            crewId: 0,
            pilotDamageGroup: 'turn-closed:immediate:end-turn:one',
            target: 7,
            result: { kind: 'manual', outcome: 'failed' },
        };
        const harness = createHarness([check]);

        apply(harness.unit, [check]);

        expect(harness.crew.setState).toHaveBeenCalledOnceWith('unconscious');
        expect(harness.queuePendingUnitCheck).toHaveBeenCalledWith(jasmine.objectContaining({
            kind: 'consciousness-recovery',
            target: 7,
            readyTurn: 1,
        }));
        expect(Array.from(harness.checks.values())).toEqual([
            jasmine.objectContaining({ kind: 'consciousness-recovery' }),
        ]);
    });

    it('fails every pending PSR when the active pilot becomes unconscious', () => {
        const check: CheckInput = {
            id: 'consciousness',
            kind: 'consciousness',
            crewId: 0,
            pilotDamageGroup: 'immediate:test',
            target: 7,
            result: { kind: 'manual', outcome: 'failed' },
        };
        const harness = createHarness([check], 'tw', 2);

        apply(harness.unit, [check]);

        expect(harness.turnState.failPendingPSRChecks).toHaveBeenCalledTimes(1);
    });

    it('queues recovery for the next turn when consciousness is lost before turn end', () => {
        const check: CheckInput = {
            id: 'consciousness',
            kind: 'consciousness',
            crewId: 0,
            pilotDamageGroup: 'combat:one',
            target: 7,
            result: { kind: 'manual', outcome: 'failed' },
        };
        const harness = createHarness([check]);

        apply(harness.unit, [check], true);

        expect(harness.queuePendingUnitCheck).toHaveBeenCalledWith(jasmine.objectContaining({
            kind: 'consciousness-recovery',
            readyTurn: 1,
        }));
    });

    it('persists a later Control Roll when an airborne Aero pilot falls unconscious', () => {
        const check: CheckInput = {
            id: 'consciousness',
            kind: 'consciousness',
            crewId: 0,
            pilotDamageGroup: 'phase-closed:combat:one',
            target: 7,
            result: { kind: 'manual', outcome: 'failed' },
        };
        const harness = createHarness([check], 'tw', 0, 'Aero', true);

        apply(harness.unit, [check]);

        expect(harness.unit.setCondition).toHaveBeenCalledWith('out-of-control', true);
        expect(Array.from(harness.checks.values())).toEqual(jasmine.arrayWithExactContents([
            jasmine.objectContaining({
                kind: 'consciousness-recovery',
                readyTurn: 1,
            }),
            jasmine.objectContaining({
                kind: 'aero-control-recovery',
                readyTurn: 1,
            }),
        ]));
    });

    it('keeps consciousness and recovery scoped to the affected crew member', () => {
        const check: CheckInput = {
            id: 'consciousness',
            kind: 'consciousness',
            pilotDamageGroup: 'turn-closed:immediate:end-turn:one',
            crewId: 2,
            target: 7,
            result: { kind: 'manual', outcome: 'failed' },
        };
        const harness = createHarness([check]);

        apply(harness.unit, [check]);

        expect(harness.queuePendingUnitCheck).toHaveBeenCalledWith(jasmine.objectContaining({
            kind: 'consciousness-recovery',
            crewId: 2,
        }));
    });

    it('keeps aerospace random movement active until a later Control Roll succeeds', () => {
        const check: CheckInput = {
            id: 'random-movement',
            kind: 'heat-random-movement',
            target: 8,
            result: { kind: 'manual', outcome: 'failed' },
        };
        const harness = createHarness([check]);

        apply(harness.unit, [check]);

        expect(harness.unit.setCondition).toHaveBeenCalledWith('random-movement', true);
        expect(harness.unit.setCondition).toHaveBeenCalledWith('out-of-control', true);
        expect(harness.queuePendingUnitCheck).toHaveBeenCalledWith(jasmine.objectContaining({
            kind: 'aero-control-recovery',
            cause: 'heat-random-movement',
            target: 5,
            readyTurn: 1,
        }));
    });

    it('applies a submitted heat Avoid Roll before its submitted Control Roll', () => {
        const check: CheckInput = {
            id: 'random-movement',
            kind: 'heat-random-movement',
            target: 8,
            result: { kind: 'manual', outcome: 'success' },
        };
        const recovery: CheckInput = {
            id: 'control-recovery',
            kind: 'aero-control-recovery',
            cause: 'heat-random-movement',
            target: 5,
            result: { kind: 'manual', outcome: 'success' },
            readyTurn: 0,
        };
        const harness = createHarness([check, recovery]);

        apply(harness.unit, [check, recovery]);

        expect(harness.unit.setCondition).toHaveBeenCalledWith('random-movement', false);
        expect(harness.unit.setCondition).toHaveBeenCalledWith('out-of-control', false);
        expect(harness.checks.size).toBe(0);
    });

    it('does not erase unrelated random movement after a fresh heat Avoid Roll succeeds', () => {
        const check: CheckInput = {
            id: 'random-movement',
            kind: 'heat-random-movement',
            target: 8,
            result: { kind: 'manual', outcome: 'success' },
        };
        const harness = createHarness([check]);

        apply(harness.unit, [check]);

        expect(harness.unit.setCondition).not.toHaveBeenCalledWith('random-movement', false);
        expect(harness.unit.setCondition).not.toHaveBeenCalledWith('out-of-control', false);
    });

    it('clears both heat-induced conditions when its later Control Roll succeeds', () => {
        const check: CheckInput = {
            id: 'control-recovery',
            kind: 'aero-control-recovery',
            cause: 'heat-random-movement',
            target: 5,
            result: { kind: 'manual', outcome: 'success' },
            readyTurn: 0,
        };
        const harness = createHarness([check]);

        apply(harness.unit, [check]);

        expect(harness.unit.setCondition).toHaveBeenCalledWith('out-of-control', false);
        expect(harness.unit.setCondition).toHaveBeenCalledWith('random-movement', false);
    });

    it('preserves unrelated random movement when a generic Control Roll regains control', () => {
        const check: CheckInput = {
            id: 'control-recovery',
            kind: 'aero-control-recovery',
            target: 5,
            result: { kind: 'manual', outcome: 'success' },
            readyTurn: 0,
        };
        const harness = createHarness([check]);

        apply(harness.unit, [check]);

        expect(harness.unit.setCondition).toHaveBeenCalledWith('out-of-control', false);
        expect(harness.unit.setCondition).not.toHaveBeenCalledWith('random-movement', false);
    });

    it('retries a failed Control Roll while an unconscious Aero pilot can still recover', () => {
        const check: CheckInput = {
            id: 'control-recovery',
            kind: 'aero-control-recovery',
            target: 5,
            result: { kind: 'manual', outcome: 'failed' },
            readyTurn: 0,
        };
        const harness = createHarness([check], 'tw', 0, 'Aero', true);
        harness.crew.setState('unconscious');
        harness.queuePendingUnitCheck.calls.reset();

        apply(harness.unit, [check]);

        expect(harness.queuePendingUnitCheck).toHaveBeenCalledOnceWith(jasmine.objectContaining({
            kind: 'aero-control-recovery',
            readyTurn: 1,
        }));
    });

    it('does not create endless Control recovery rolls after an Aero controller is gone', () => {
        const check: CheckInput = {
            id: 'control-recovery',
            kind: 'aero-control-recovery',
            target: 5,
            result: { kind: 'manual', outcome: 'failed' },
            readyTurn: 0,
        };
        const harness = createHarness([check], 'tw', 0, 'Aero', true);
        harness.crew.setState('ejected');
        harness.queuePendingUnitCheck.calls.reset();

        apply(harness.unit, [check]);

        expect(harness.queuePendingUnitCheck).not.toHaveBeenCalled();
        expect(harness.checks.size).toBe(0);
    });

    it('applies Core seatbelt before consciousness within one submitted list', () => {
        const seatbelt: CheckInput = {
            id: 'seatbelt',
            kind: 'seatbelt',
            crewId: 0,
            pilotDamageGroup: 'combat:test',
            target: 5,
            result: { kind: 'manual', outcome: 'failed' },
        };
        const consciousness: CheckInput = {
            id: 'consciousness',
            kind: 'consciousness',
            crewId: 0,
            pilotDamageGroup: 'combat:test',
            target: 5,
            result: { kind: 'manual', outcome: 'success' },
        };
        const harness = createHarness([seatbelt, consciousness]);

        apply(harness.unit, [seatbelt, consciousness], true);

        expect(harness.unit.applyPilotHits).toHaveBeenCalledOnceWith(1, 'combat:test', 0);
        expect(harness.checks.has('seatbelt')).toBeFalse();
        expect(harness.checks.has('consciousness')).toBeFalse();
    });

    it('auto-fails a later submitted TW seatbelt after consciousness is lost', () => {
        const seatbelt: CheckInput = {
            id: 'seatbelt',
            kind: 'seatbelt',
            crewId: 0,
            target: 5,
            result: { kind: 'manual', outcome: 'success' },
        };
        const consciousness: CheckInput = {
            id: 'consciousness',
            kind: 'consciousness',
            crewId: 0,
            pilotDamageGroup: 'combat:test',
            target: 5,
            result: { kind: 'manual', outcome: 'failed' },
        };
        const harness = createHarness([seatbelt, consciousness], 'tw');

        apply(harness.unit, [seatbelt, consciousness]);

        expect(harness.crew.setState).toHaveBeenCalledOnceWith('unconscious');
        expect(harness.unit.applyPilotHits).toHaveBeenCalledOnceWith(1, undefined, 0);
        expect(harness.checks.has('seatbelt')).toBeFalse();
    });

    it('pauses later submitted heat effects for a newly-created consciousness interrupt', () => {
        const seatbelt: CheckInput = {
            id: 'seatbelt',
            kind: 'seatbelt',
            crewId: 0,
            result: { kind: 'automatic', outcome: 'failed' },
        };
        const ammo: CheckInput = {
            id: 'ammo',
            kind: 'heat-ammo-explosion',
            target: 4,
            result: { kind: 'manual', outcome: 'success' },
        };
        const harness = createHarness([seatbelt, ammo], 'tw');
        (harness.unit.applyPilotHits as jasmine.Spy).and.callFake(() => {
            harness.queuePendingUnitCheck({
                id: 'consciousness:interrupt',
                kind: 'consciousness',
                crewId: 0,
                pilotDamageGroup: 'immediate:fall',
                target: 5,
            });
        });

        apply(harness.unit, [seatbelt, ammo]);

        expect(harness.unit.applyPilotHits).toHaveBeenCalledOnceWith(1, undefined, 0);
        expect(harness.checks.has('seatbelt')).toBeFalse();
        expect(harness.checks.has('ammo')).toBeTrue();
        expect(harness.checks.has('consciousness:interrupt')).toBeTrue();
    });

    it('continues to later TW heat effects after a submitted consciousness success', () => {
        const lifeSupport: CheckInput = {
            id: 'life-support',
            kind: 'heat-life-support',
            result: { kind: 'automatic', outcome: 'failed' },
            hits: 1,
        };
        const consciousness: CheckInput = {
            id: 'consciousness',
            kind: 'consciousness',
            crewId: 0,
            pilotDamageGroup: 'immediate:test',
            target: 5,
            result: { kind: 'manual', outcome: 'success' },
        };
        const harness = createHarness([lifeSupport, consciousness], 'tw');

        apply(harness.unit, [lifeSupport, consciousness]);

        expect(harness.unit.applyHeatCrewHits).toHaveBeenCalledOnceWith(1, undefined);
        expect(harness.checks.has('life-support')).toBeFalse();
        expect(harness.checks.has('consciousness')).toBeFalse();
    });

    it('applies Core Heat Phase consciousness before submitted submerged Life Support damage', () => {
        const consciousness: CheckInput = {
            id: 'heat-consciousness',
            kind: 'consciousness',
            crewId: 0,
            pilotDamageGroup: 'turn-closed:heat:end-turn:test',
            target: 5,
            result: { kind: 'manual', outcome: 'success' },
        };
        const drowning: CheckInput = {
            id: 'drowning',
            kind: 'life-support-drowning',
            result: { kind: 'automatic', outcome: 'failed' },
            hits: 1,
        };
        const harness = createHarness([consciousness, drowning]);

        apply(harness.unit, [consciousness, drowning]);

        expect(harness.checks.has('heat-consciousness')).toBeFalse();
        expect(harness.checks.has('drowning')).toBeFalse();
        expect(harness.unit.applyLifeSupportDrowningCrewHits).toHaveBeenCalledOnceWith(1, undefined);
        expect(harness.unit.applyHeatCrewHits).not.toHaveBeenCalled();
    });

    it('applies Core End Phase recovery before submitted submerged Life Support damage', () => {
        const recovery: CheckInput = {
            id: 'recovery',
            kind: 'consciousness-recovery',
            crewId: 0,
            target: 7,
            result: { kind: 'manual', outcome: 'success' },
            readyTurn: 0,
        };
        const drowning: CheckInput = {
            id: 'drowning',
            kind: 'life-support-drowning',
            result: { kind: 'automatic', outcome: 'failed' },
            hits: 1,
        };
        const harness = createHarness([recovery, drowning]);
        harness.crew.setState('unconscious');

        expect(pendingUnitCheckStage(harness.unit).map(check => check.id)).toEqual(['recovery']);

        apply(harness.unit, [recovery, drowning]);

        expect(harness.crew.setState).toHaveBeenCalledWith('healthy');
        expect(harness.checks.has('recovery')).toBeFalse();
        expect(harness.checks.has('drowning')).toBeFalse();
        expect(harness.unit.applyLifeSupportDrowningCrewHits).toHaveBeenCalledOnceWith(1, undefined);
        expect(harness.unit.applyHeatCrewHits).not.toHaveBeenCalled();
    });

    it('offers only the next consciousness roll per crew member', () => {
        const checks: CheckInput[] = [
            {
                id: 'pilot-1a', kind: 'consciousness', crewId: 1,
                pilotDamageGroup: 'immediate:one', target: 3,
            },
            {
                id: 'pilot-1b', kind: 'consciousness', crewId: 1,
                pilotDamageGroup: 'immediate:one', target: 5,
            },
            {
                id: 'pilot-2a', kind: 'consciousness', crewId: 2,
                pilotDamageGroup: 'immediate:one', target: 7,
            },
        ];
        const harness = createHarness(checks, 'tw');

        expect(pendingUnitCheckStage(harness.unit).map(check => check.id)).toEqual([
            'pilot-1a',
            'pilot-2a',
        ]);
    });

    it('holds a Core combat-phase consciousness roll until the phase is committed', () => {
        const open = createHarness([
            {
                id: 'consciousness', kind: 'consciousness', crewId: 0,
                pilotDamageGroup: 'combat:weapon', target: 5,
            },
        ]);
        const committed = createHarness([
            {
                id: 'consciousness', kind: 'consciousness', crewId: 0,
                pilotDamageGroup: 'phase-closed:combat:weapon', target: 5,
            },
        ]);

        expect(pendingUnitCheckStage(open.unit)).toEqual([]);
        expect(pendingUnitCheckStage(committed.unit).map(check => check.id)).toEqual(['consciousness']);
    });

    it('offers TW consciousness before a simultaneously pending PSR', () => {
        const checks: CheckInput[] = [
            { id: 'seatbelt', kind: 'seatbelt', crewId: 0, target: 5 },
            {
                id: 'consciousness', kind: 'consciousness', crewId: 0,
                pilotDamageGroup: 'combat:weapon', target: 5,
            },
        ];
        const harness = createHarness(checks, 'tw', 1);

        expect(pendingUnitCheckStage(harness.unit).map(check => check.id)).toEqual(['consciousness']);
    });

    it('offers immediate TW consciousness through an unfinished critical chain', () => {
        const harness = createHarness([
            {
                id: 'consciousness', kind: 'consciousness', crewId: 0,
                pilotDamageGroup: 'immediate:test', target: 5,
            },
            { id: 'recovery', kind: 'consciousness-recovery', crewId: 0, target: 7, readyTurn: 0 },
        ], 'tw', 0, 'Mek', false, 1);

        expect(pendingUnitCheckStage(harness.unit).map(check => check.id)).toEqual(['consciousness']);
    });

    it('offers TW consciousness recovery before a simultaneous Control Roll or PSR', () => {
        const checks: CheckInput[] = [
            { id: 'control', kind: 'aero-control-recovery', target: 5, readyTurn: 0 },
            { id: 'recovery', kind: 'consciousness-recovery', crewId: 0, target: 7, readyTurn: 0 },
        ];
        const harness = createHarness(checks, 'tw', 1, 'Aero', true);

        expect(pendingUnitCheckStage(harness.unit).map(check => check.id)).toEqual(['recovery']);
    });

    it('groups eligible recovery rolls across units at the global End Phase stage', () => {
        const first = createHarness([
            { id: 'recovery:1', kind: 'consciousness-recovery', crewId: 0, target: 7, readyTurn: 0 },
        ]);
        const second = createHarness([
            { id: 'recovery:2', kind: 'consciousness-recovery', crewId: 0, target: 5, readyTurn: 0 },
        ]);

        expect(pendingUnitCheckGroupStage([first.unit, second.unit]).map(entry => entry.check.id)).toEqual([
            'recovery:1',
            'recovery:2',
        ]);
    });
});
