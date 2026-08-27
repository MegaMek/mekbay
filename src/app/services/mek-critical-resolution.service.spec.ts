// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import { TestBed } from '@angular/core/testing';
import { Subject } from 'rxjs';
import { MekCriticalChanceDialogComponent } from '../components/page-viewer/mek-critical-chance-dialog.component';
import { MekCriticalHitDialogComponent } from '../components/page-viewer/mek-critical-hit-dialog.component';
import { MekFloatingCriticalDialogComponent } from '../components/page-viewer/mek-floating-critical-dialog.component';
import type { CBTForceUnit } from '../models/cbt-force-unit.model';
import type {
    PendingEventInput,
    SerializedPendingMekCritical,
    SerializedPendingMekCriticalChance,
    SerializedPendingUnitCheck,
} from '../models/force-serialization';
import { CORE_2026_GAME_RULES, TW_GAME_RULES } from '../models/rules/game-rules';
import { DialogsService } from './dialogs.service';
import { MekCriticalHitAutomationService } from './mek-critical-hit-automation.service';
import { MekCriticalResolutionService } from './mek-critical-resolution.service';
import { ToastService } from './toast.service';
import { UnitCheckResolutionService } from './unit-check-resolution.service';

describe('MekCriticalResolutionService', () => {
    let service: MekCriticalResolutionService;
    let createDialog: jasmine.Spy;
    let dialogClosures: Subject<unknown>[];
    let pendingChances: SerializedPendingMekCriticalChance[];
    let pendingHits: SerializedPendingMekCritical[];
    let pendingCriticalOrder: string[];
    let pendingFallCount: number;
    let pendingUnitChecks: SerializedPendingUnitCheck[];
    let queuePendingCriticalChance: jasmine.Spy;
    let queuePendingCriticalHits: jasmine.Spy;
    let replacePendingCriticalChanceWithHits: jasmine.Spy;
    let replacePendingCriticalHitWithChance: jasmine.Spy;
    let applyCriticalRoll: jasmine.Spy;
    let criticalAutomationMode: 'yes' | 'ask' | 'no';
    let showToast: jasmine.Spy;
    let openUnitChecks: jasmine.Spy;
    let unit: CBTForceUnit;

    beforeEach(() => {
        pendingChances = [];
        pendingHits = [];
        pendingCriticalOrder = [];
        pendingFallCount = 0;
        pendingUnitChecks = [];
        criticalAutomationMode = 'ask';
        applyCriticalRoll = jasmine.createSpy('applyRoll').and.resolveTo({
            cancelled: false,
            outcome: {
                applied: true,
                slotNumber: 1,
                equipment: 'Engine',
                armoredAbsorption: false,
            },
        });
        dialogClosures = [];
        createDialog = jasmine.createSpy('createDialog').and.callFake(() => {
            const closed = new Subject<unknown>();
            dialogClosures.push(closed);
            return { closed };
        });
        queuePendingCriticalChance = jasmine.createSpy('queuePendingCriticalChance').and.callFake(
            (entry: PendingEventInput<SerializedPendingMekCriticalChance>) => {
                if (pendingChances.some(candidate => candidate.id === entry.id)) return false;
                pendingChances.push({ type: 'mek-critical-chance', ...entry });
                pendingCriticalOrder.push(entry.id);
                return true;
            },
        );
        queuePendingCriticalHits = jasmine.createSpy('queuePendingCriticalHits').and.callFake(
            (entry: PendingEventInput<SerializedPendingMekCritical>) => {
                if (pendingHits.some(candidate => candidate.id === entry.id)) return false;
                pendingHits.push({ type: 'mek-critical-hit', ...entry });
                pendingCriticalOrder.push(entry.id);
                return true;
            },
        );
        replacePendingCriticalChanceWithHits = jasmine.createSpy('replacePendingCriticalChanceWithHits').and.callFake(
            (entry: Pick<SerializedPendingMekCritical,
                'id' | 'targetLocation' | 'remainingHits' | 'caseII' | 'floatingLocation'>) => {
                const chanceIndex = pendingChances.findIndex(candidate => candidate.id === entry.id);
                if (chanceIndex === -1 || pendingHits.some(candidate => candidate.id === entry.id)) return false;
                const chance = pendingChances[chanceIndex];
                const {
                    type: _type,
                    result: _result,
                    roll: _chanceRoll,
                    explosionProtection,
                    hardenedArmorApplies,
                    throughArmorHitArc,
                    ...base
                } = chance;
                pendingChances.splice(chanceIndex, 1);
                pendingHits.push({
                    ...base,
                    type: 'mek-critical-hit',
                    targetLocation: entry.targetLocation,
                    remainingHits: entry.remainingHits,
                    chanceOrigin: {
                        ...(explosionProtection !== undefined ? { explosionProtection } : {}),
                        ...(hardenedArmorApplies !== undefined ? { hardenedArmorApplies } : {}),
                        ...(throughArmorHitArc !== undefined ? { throughArmorHitArc } : {}),
                    },
                    ...(entry.floatingLocation ? { floatingLocation: entry.floatingLocation } : {}),
                    ...(entry.caseII ? { caseII: entry.caseII } : {}),
                });
                return true;
            },
        );
        replacePendingCriticalHitWithChance = jasmine.createSpy('replacePendingCriticalHitWithChance').and.callFake(
            (id: string) => {
                const hitIndex = pendingHits.findIndex(candidate => candidate.id === id);
                if (hitIndex === -1 || pendingHits[hitIndex].chanceOrigin === undefined) return false;
                const {
                    type: _type,
                    targetLocation: _targetLocation,
                    remainingHits: _remainingHits,
                    chanceOrigin,
                    floatingLocation: _floatingLocation,
                    caseII: _caseII,
                    roll: _roll,
                    ...base
                } = pendingHits[hitIndex];
                pendingHits.splice(hitIndex, 1);
                pendingChances.push({ type: 'mek-critical-chance', ...base, ...chanceOrigin });
                return true;
            },
        );
        const turnState = {
            currentPilotDamageGroup: () => 'combat:test',
            queuePendingCriticalChance,
            getPendingCriticalChance: (id: string) => pendingChances.find(entry => entry.id === id),
            getPendingCriticalChances: () => pendingChances,
            getNextPendingCriticalEvent: () => pendingCriticalOrder.flatMap(id => [
                pendingChances.find(entry => entry.id === id)
                    ?? pendingHits.find(entry => entry.id === id),
            ]).find(entry => entry !== undefined),
            pendingFallCount: () => pendingFallCount,
            setPendingCriticalChanceResult: (id: string, result: SerializedPendingMekCriticalChance['result']) =>
                updateChance(id, pending => {
                    if (result !== undefined) return { ...pending, result };
                    const { result: _result, ...withoutResult } = pending;
                    return withoutResult;
                }),
            setPendingCriticalChanceRoll: (id: string, roll: readonly [number, number] | undefined) =>
                updateChance(id, pending => {
                    if (roll !== undefined) return { ...pending, roll };
                    const { roll: _roll, ...withoutRoll } = pending;
                    return withoutRoll;
                }),
            discardPendingCriticalChance: (id: string) => {
                const originalLength = pendingChances.length;
                pendingChances = pendingChances.filter(entry => entry.id !== id);
                return pendingChances.length !== originalLength;
            },
            replacePendingCriticalChanceWithHits,
            replacePendingCriticalHitWithChance,
            queuePendingCriticalHits,
            getPendingCriticalHit: (id: string) => pendingHits.find(entry => entry.id === id),
            getPendingCriticalHits: () => pendingHits,
            setPendingCriticalRoll: (id: string, roll: readonly number[]) =>
                updateHit(id, pending => ({ ...pending, roll: [...roll] })),
            clearPendingCriticalRoll: (id: string) => updateHit(id, pending => {
                const { roll: _roll, ...withoutRoll } = pending;
                return withoutRoll;
            }),
            setPendingCriticalCaseIICheckResult: (
                id: string,
                result: 'resolve' | 'discard',
                roll: readonly [number, number],
            ) => updateHit(id, pending => ({
                ...pending,
                caseII: { status: 'pending', result, roll },
            })),
            passPendingCriticalCaseIICheck: (id: string) => updateHit(id, pending => ({
                ...pending,
                caseII: { status: 'passed' },
            })),
            resolvePendingCriticalHit: (id: string) => {
                const index = pendingHits.findIndex(entry => entry.id === id);
                if (index === -1) return false;
                const pending = pendingHits[index];
                if (pending.remainingHits <= 1) {
                    pendingHits.splice(index, 1);
                    return true;
                }
                const { roll: _roll, ...withoutRoll } = pending;
                pendingHits[index] = {
                    ...withoutRoll,
                    remainingHits: pending.remainingHits - 1,
                };
                return true;
            },
            setPendingFloatingCriticalLocation: (
                id: string,
                locationRoll: number | null,
                dice: readonly [number, number] | null,
                tripodLegRoll: number | null,
            ) => updateHit(id, pending => ({
                ...pending,
                floatingLocation: {
                    hitArc: pending.floatingLocation!.hitArc,
                    ...(locationRoll !== null ? { locationRoll } : {}),
                    ...(dice !== null ? { dice } : {}),
                    ...(tripodLegRoll !== null ? { tripodLegRoll } : {}),
                },
            })),
            resolvePendingFloatingCriticalLocation: (id: string, targetLocation: string) =>
                updateHit(id, pending => {
                    if (!pending.floatingLocation) return pending;
                    const { floatingLocation: _floatingLocation, ...resolved } = pending;
                    return { ...resolved, targetLocation };
                }),
            discardPendingCriticalHits: (id: string) => {
                const originalLength = pendingHits.length;
                pendingHits = pendingHits.filter(entry => entry.id !== id);
                return pendingHits.length !== originalLength;
            },
            actionablePendingUnitChecks: () => pendingUnitChecks,
        };
        unit = {
            id: 'unit-a',
            gameRules: CORE_2026_GAME_RULES,
            rules: { mountedCriticalDamageDestructionThreshold: () => 1 },
            locations: { internal: new Map([['CT', {}]]) },
            automationMode: (key: string) => key === 'criticalHitChanceCheck'
                ? criticalAutomationMode
                : 'ask',
            turnState: () => turnState,
            getNotificationDisplayName: () => 'Atlas AS7-D',
            getUnit: () => ({ structureType: '', armorType: '', features: [], comp: [] }),
            getCritSlots: () => [],
            getCritSlot: () => null,
            usesFloatingCriticals: () => false,
        } as unknown as CBTForceUnit;
        showToast = jasmine.createSpy('showToast');
        openUnitChecks = jasmine.createSpy('open').and.resolveTo();

        TestBed.configureTestingModule({
            providers: [
                MekCriticalResolutionService,
                { provide: DialogsService, useValue: { createDialog } },
                { provide: MekCriticalHitAutomationService, useValue: { applyRoll: applyCriticalRoll } },
                { provide: ToastService, useValue: { showToast } },
                { provide: UnitCheckResolutionService, useValue: { open: openUnitChecks } },
            ],
        });
        service = TestBed.inject(MekCriticalResolutionService);
    });

    it('persists hits before opening a backdrop-dismissible guided dialog', async () => {
        const operation = service.queue(unit, {
            id: 'critical:1',
            location: 'LT',
            hits: 2,
            locationDestroyed: true,
            consolidateImmediately: false,
        });

        expect(queuePendingCriticalHits).toHaveBeenCalledOnceWith({
            id: 'critical:1',
            location: 'LT',
            targetLocation: 'LT',
            remainingHits: 2,
            locationDestroyed: true,
            pilotDamageGroup: 'combat:test',
        });
        expect(createDialog).toHaveBeenCalledOnceWith(
            MekCriticalHitDialogComponent,
            jasmine.objectContaining({
                disableClose: false,
                data: jasmine.objectContaining({
                    unit,
                    location: 'LT',
                    requiredHits: 2,
                    pendingCriticalId: 'critical:1',
                }),
            }),
        );

        closeDialog(0, undefined);
        await operation;
        expect(pendingHits[0].remainingHits).toBe(2);
    });

    it('does not reopen an existing critical when a duplicate enqueue is rejected', async () => {
        addHit({
            id: 'critical:duplicate',
            location: 'CT',
            targetLocation: 'CT',
            remainingHits: 1,
        });

        await service.queue(unit, {
            id: 'critical:duplicate',
            location: 'LT',
            hits: 2,
            consolidateImmediately: false,
        });

        expect(queuePendingCriticalHits).toHaveBeenCalled();
        expect(createDialog).not.toHaveBeenCalled();
        expect(pendingHits).toEqual([jasmine.objectContaining({
            id: 'critical:duplicate',
            location: 'CT',
            remainingHits: 1,
        })]);
    });

    it('opens a serialized pending hit from the overlay path', async () => {
        addHit({
            id: 'saved-critical',
            location: 'RA',
            targetLocation: 'RT',
            remainingHits: 1,
            consolidateImmediately: true,
            roll: [3, 4],
        });

        const operation = service.resume(unit);

        expect(createDialog.calls.mostRecent().args[1].data).toEqual(jasmine.objectContaining({
            location: 'RA',
            targetLocation: 'RT',
            requiredHits: 1,
            consolidateImmediately: true,
            pendingCriticalId: 'saved-critical',
        }));

        closeDialog(0, { completed: false });
        await operation;
    });

    it('opens a menu critical hit as a transient one-shot without queue state', async () => {
        const operation = service.openManual(unit, 'CT', true);

        expect(queuePendingCriticalHits).not.toHaveBeenCalled();
        expect(queuePendingCriticalChance).not.toHaveBeenCalled();
        expect(pendingHits).toEqual([]);
        expect(pendingChances).toEqual([]);
        expect(createDialog).toHaveBeenCalledOnceWith(
            MekCriticalHitDialogComponent,
            jasmine.objectContaining({ disableClose: false }),
        );
        const data = createDialog.calls.mostRecent().args[1].data;
        expect(data).toEqual(jasmine.objectContaining({
            unit,
            location: 'CT',
            targetLocation: 'CT',
            requiredHits: 1,
            consolidateImmediately: true,
            canUndoToChance: false,
            manual: true,
        }));
        expect(data.pendingCriticalId).toBeUndefined();

        closeDialog(0, undefined);
        await operation;

        expect(pendingHits).toEqual([]);
        expect(pendingChances).toEqual([]);
    });

    it('keeps menu chance-to-hit UNDO in memory without serializing either dialog', async () => {
        const operation = service.openManualChance(unit, 'CT', false);

        expect(queuePendingCriticalChance).not.toHaveBeenCalled();
        expect(createDialog.calls.argsFor(0)[0]).toBe(MekCriticalChanceDialogComponent);
        expect(createDialog.calls.argsFor(0)[1].data).toEqual(jasmine.objectContaining({
            locationLabel: 'Center Torso',
            manual: true,
        }));
        expect(createDialog.calls.argsFor(0)[1].data.onResultChange).toBeUndefined();

        closeDialog(0, { kind: 'critical-hits', count: 2 });
        await new Promise<void>(resolve => setTimeout(resolve, 0));

        expect(queuePendingCriticalHits).not.toHaveBeenCalled();
        expect(createDialog.calls.argsFor(1)[0]).toBe(MekCriticalHitDialogComponent);
        const hitData = createDialog.calls.argsFor(1)[1].data;
        expect(hitData).toEqual(jasmine.objectContaining({
            unit,
            location: 'CT',
            targetLocation: 'CT',
            requiredHits: 2,
            canUndoToChance: true,
            manual: true,
        }));
        expect(hitData.pendingCriticalId).toBeUndefined();

        closeDialog(1, { completed: false, undoToChance: true });
        await new Promise<void>(resolve => setTimeout(resolve, 0));

        expect(replacePendingCriticalHitWithChance).not.toHaveBeenCalled();
        expect(createDialog.calls.argsFor(2)[0]).toBe(MekCriticalChanceDialogComponent);
        expect(createDialog.calls.argsFor(2)[1].data.manual).toBeTrue();
        closeDialog(2, undefined);
        await operation;

        expect(pendingHits).toEqual([]);
        expect(pendingChances).toEqual([]);
    });

    it('does not open duplicate dialogs for the same unit', async () => {
        addHit({
            id: 'critical:1',
            location: 'CT',
            targetLocation: 'CT',
            remainingHits: 1,
        });

        const first = service.resume(unit);
        await service.resume(unit);

        expect(createDialog).toHaveBeenCalledTimes(1);
        closeDialog(0, { completed: false });
        await first;
    });

    it('does not let a queued callback bypass an earlier critical chance that was left pending', async () => {
        addChance({ id: 'chance:first', location: 'CT' });
        addChance({ id: 'chance:second', location: 'CT' });

        await service.resumeChance(unit, 'chance:second');

        expect(createDialog).not.toHaveBeenCalled();

        const first = service.resumeChance(unit, 'chance:first');
        expect(createDialog).toHaveBeenCalledTimes(1);
        closeDialog(0, undefined);
        await first;
    });

    it('does not open a later chance while an earlier critical-hit stage remains pending', async () => {
        addHit({
            id: 'hit:first',
            location: 'CT',
            targetLocation: 'CT',
            remainingHits: 1,
        });
        addChance({ id: 'chance:second', location: 'CT' });

        await service.resumeChance(unit, 'chance:second');

        expect(createDialog).not.toHaveBeenCalled();
    });

    it('does not open critical work while falling damage is pending', async () => {
        addChance({ id: 'chance:1', location: 'CT' });
        pendingFallCount = 1;

        await service.resumeChance(unit, 'chance:1');

        expect(createDialog).not.toHaveBeenCalled();
    });

    it('resolves pending Total Warfare consciousness before reopening a critical', async () => {
        (unit as unknown as { gameRules: typeof TW_GAME_RULES }).gameRules = TW_GAME_RULES;
        addHit({
            id: 'critical:1',
            location: 'CT',
            targetLocation: 'CT',
            remainingHits: 1,
        });
        addUnitCheck({
            id: 'consciousness:1',
            kind: 'consciousness',
            crewId: 0,
            pilotDamageGroup: 'combat:test',
            target: 5,
        });

        await service.resume(unit);

        expect(openUnitChecks).toHaveBeenCalledOnceWith([unit]);
        expect(createDialog).not.toHaveBeenCalled();
        expect(pendingHits).toHaveSize(1);
    });

    it('pauses a Total Warfare critical, resolves its new consciousness roll, then resumes it', async () => {
        (unit as unknown as { gameRules: typeof TW_GAME_RULES }).gameRules = TW_GAME_RULES;
        addHit({
            id: 'critical:1',
            location: 'CT',
            targetLocation: 'CT',
            remainingHits: 2,
        });
        openUnitChecks.and.callFake(async () => {
            pendingUnitChecks = [];
        });

        const operation = service.resume(unit);
        addUnitCheck({
            id: 'consciousness:1',
            kind: 'consciousness',
            crewId: 0,
            pilotDamageGroup: 'combat:test',
            target: 3,
        });
        closeDialog(0, { completed: false, interruptedForConsciousness: true });
        await new Promise<void>(resolve => setTimeout(resolve, 0));

        expect(openUnitChecks).toHaveBeenCalledOnceWith([unit]);
        expect(createDialog).toHaveBeenCalledTimes(2);
        expect(createDialog.calls.argsFor(1)[0]).toBe(MekCriticalHitDialogComponent);

        closeDialog(1, { completed: false });
        await operation;
        expect(pendingHits).toHaveSize(1);
    });

    it('opens a queued chance directly and keeps it pending when the dialog closes', async () => {
        const operation = service.queueChance(unit, {
            id: 'chance:1',
            location: 'CT',
            consolidateImmediately: false,
        });

        expect(pendingChances).toEqual([{
            type: 'mek-critical-chance',
            id: 'chance:1',
            location: 'CT',
            pilotDamageGroup: 'combat:test',
        }]);
        expect(createDialog).toHaveBeenCalledOnceWith(
            MekCriticalChanceDialogComponent,
            jasmine.objectContaining({ disableClose: false }),
        );

        closeDialog(0, undefined);
        await operation;
        expect(pendingChances).toHaveSize(1);
    });

    it('removes a NO CRITICAL result instead of creating critical-hit work', async () => {
        addChance({ id: 'chance:1', location: 'CT' });

        const operation = service.resumeChance(unit);
        closeDialog(0, { kind: 'none' });
        await operation;

        expect(pendingChances).toEqual([]);
        expect(pendingHits).toEqual([]);
    });

    it('persists and restores exact chance dice when its dialog is dismissed', async () => {
        addChance({
            id: 'chance:1',
            location: 'CT',
        });

        const operation = service.resumeChance(unit);
        const chanceData = createDialog.calls.mostRecent().args[1].data;
        chanceData.onRollChange([5, 5]);
        chanceData.onResultChange({ kind: 'critical-hits', count: 2 });

        expect(pendingChances[0]).toEqual({
            type: 'mek-critical-chance',
            id: 'chance:1',
            location: 'CT',
            roll: [5, 5],
            result: 2,
        });
        expect(createDialog).toHaveBeenCalledOnceWith(
            MekCriticalChanceDialogComponent,
            jasmine.objectContaining({ disableClose: false }),
        );

        closeDialog(0, undefined);
        await operation;
        expect(pendingChances[0].result).toBe(2);

        const reopened = service.resumeChance(unit);
        expect(createDialog.calls.mostRecent().args[1].data.initialRoll).toEqual([5, 5]);
        closeDialog(1, undefined);
        await reopened;
    });

    it('restores the Core CASE II explosion modifier with a pending chance', async () => {
        const operation = service.queueChance(unit, {
            id: 'chance:case-ii',
            location: 'CT',
            consolidateImmediately: false,
            explosionProtection: 'case-ii',
            pilotDamageGroup: 'combat:test',
        });

        expect(queuePendingCriticalChance).toHaveBeenCalledOnceWith({
            id: 'chance:case-ii',
            location: 'CT',
            explosionProtection: 'case-ii',
            pilotDamageGroup: 'combat:test',
        });
        expect(createDialog.calls.mostRecent().args[1].data.modifiers).toEqual([
            { label: 'CASE II internal explosion', value: -1 },
        ]);

        closeDialog(0, undefined);
        await operation;
    });

    it('persists an exact Hardened Armor facing decision and restores its modifier', async () => {
        (unit as unknown as { getUnit: () => object }).getUnit = () => ({
            structureType: '',
            armorType: 'Hardened',
            features: [],
            comp: [],
        });
        const operation = service.queueChance(unit, {
            id: 'chance:hardened',
            location: 'CT',
            consolidateImmediately: false,
            hardenedArmorApplies: true,
            pilotDamageGroup: 'combat:test',
        });

        expect(queuePendingCriticalChance).toHaveBeenCalledOnceWith({
            id: 'chance:hardened',
            location: 'CT',
            hardenedArmorApplies: true,
            pilotDamageGroup: 'combat:test',
        });
        expect(createDialog.calls.mostRecent().args[1].data.modifiers).toEqual([
            { label: 'Hardened armor in damaged facing', value: -2 },
        ]);

        closeDialog(0, undefined);
        await operation;
    });

    it('marks every Total Warfare CASE II critical for its separate 2D6 check', async () => {
        (unit as unknown as { gameRules: typeof TW_GAME_RULES }).gameRules = TW_GAME_RULES;
        addChance({
            id: 'chance:case-ii',
            location: 'CT',
            explosionProtection: 'case-ii',
        });

        const operation = service.resumeChance(unit);
        closeDialog(0, { kind: 'critical-hits', count: 2 });
        await new Promise<void>(resolve => setTimeout(resolve, 0));

        expect(pendingHits).toEqual([jasmine.objectContaining({
            location: 'CT',
            remainingHits: 2,
            caseII: { status: 'pending' },
        })]);
        expect(createDialog.calls.argsFor(1)[1].data).toEqual(jasmine.objectContaining({
            caseIICheckRequired: true,
            caseIICheckPassed: false,
        }));

        closeDialog(1, { completed: false });
        await operation;
    });

    it('keeps the chance pending if its critical-hit work cannot be queued', async () => {
        replacePendingCriticalChanceWithHits.and.returnValue(false);
        addChance({ id: 'chance:1', location: 'CT' });

        const operation = service.resumeChance(unit);
        closeDialog(0, { kind: 'critical-hits', count: 1 });
        await operation;

        expect(pendingChances).toHaveSize(1);
        expect(createDialog).toHaveBeenCalledTimes(1);
    });

    it('turns an accepted chance result into serialized hits before opening their dialog', async () => {
        addChance({
            id: 'chance:1',
            location: 'CT',
            pilotDamageGroup: 'turn-closed:immediate:end-turn:heat',
        });

        const operation = service.resumeChance(unit);
        closeDialog(0, { kind: 'critical-hits', count: 2 });
        await new Promise<void>(resolve => setTimeout(resolve, 0));

        expect(pendingChances).toEqual([]);
        expect(pendingHits).toEqual([jasmine.objectContaining({
            id: 'chance:1',
            location: 'CT',
            targetLocation: 'CT',
            remainingHits: 2,
            pilotDamageGroup: 'turn-closed:immediate:end-turn:heat',
            chanceOrigin: {},
        })]);
        expect(createDialog.calls.argsFor(1)[0]).toBe(MekCriticalHitDialogComponent);
        expect(createDialog.calls.argsFor(1)[1].data.pilotDamageGroup)
            .toBe('turn-closed:immediate:end-turn:heat');

        closeDialog(1, { completed: false });
        await operation;
    });

    it('persists and resolves a floating critical before opening its critical-hit dialog', async () => {
        (unit as unknown as { usesFloatingCriticals: () => boolean }).usesFloatingCriticals = () => true;
        addChance({
            id: 'chance:floating',
            location: 'CT',
            throughArmorHitArc: 'front',
        });

        const operation = service.resumeChance(unit);
        closeDialog(0, { kind: 'critical-hits', count: 1 });
        await new Promise<void>(resolve => setTimeout(resolve, 0));

        expect(createDialog.calls.argsFor(1)[0]).toBe(MekFloatingCriticalDialogComponent);
        expect(pendingHits[0]).toEqual(jasmine.objectContaining({
            id: 'chance:floating',
            floatingLocation: { hitArc: 'front' },
            chanceOrigin: { throughArmorHitArc: 'front' },
        }));

        const floatingData = createDialog.calls.argsFor(1)[1].data;
        floatingData.onDraftChange(7, [3, 4], null);
        expect(pendingHits[0].floatingLocation).toEqual({
            hitArc: 'front',
            locationRoll: 7,
            dice: [3, 4],
        });

        closeDialog(1, { action: 'apply', location: 'CT' });
        await new Promise<void>(resolve => setTimeout(resolve, 0));

        expect(createDialog.calls.argsFor(2)[0]).toBe(MekCriticalHitDialogComponent);
        expect(createDialog.calls.argsFor(2)[1].data).toEqual(jasmine.objectContaining({
            targetLocation: 'CT',
            pendingCriticalId: 'chance:floating',
        }));
        expect(pendingHits[0].floatingLocation).toBeUndefined();

        closeDialog(2, { completed: false });
        await operation;
    });

    it('restores a floating-critical location roll after CLOSE', async () => {
        addHit({
            id: 'critical:floating-paused',
            location: 'CT',
            targetLocation: 'CT',
            remainingHits: 1,
            floatingLocation: {
                hitArc: 'rear',
                locationRoll: 8,
                dice: [2, 6],
            },
        });

        const first = service.resume(unit);
        expect(createDialog.calls.argsFor(0)[0]).toBe(MekFloatingCriticalDialogComponent);
        expect(createDialog.calls.argsFor(0)[1].data).toEqual(jasmine.objectContaining({
            hitArc: 'rear',
            initialLocationRoll: 8,
            initialRoll: [2, 6],
        }));
        closeDialog(0, undefined);
        await first;

        const reopened = service.resume(unit);
        expect(createDialog.calls.argsFor(1)[0]).toBe(MekFloatingCriticalDialogComponent);
        expect(createDialog.calls.argsFor(1)[1].data.initialRoll).toEqual([2, 6]);
        closeDialog(1, undefined);
        await reopened;
    });

    it('consumes the floating critical without opening a hit dialog after SKIP', async () => {
        addHit({
            id: 'critical:floating-skipped',
            location: 'CT',
            targetLocation: 'CT',
            remainingHits: 2,
            floatingLocation: { hitArc: 'front' },
        });

        const operation = service.resume(unit);
        expect(createDialog.calls.argsFor(0)[0]).toBe(MekFloatingCriticalDialogComponent);

        closeDialog(0, { action: 'skip' });
        await operation;

        expect(pendingHits).toEqual([]);
        expect(createDialog).toHaveBeenCalledTimes(1);
    });

    it('restores the exact chance stage when an untouched hit dialog requests undo', async () => {
        addChance({
            id: 'chance:undo',
            location: 'CT',
            explosionProtection: 'case-ii',
            hardenedArmorApplies: true,
            consolidateImmediately: true,
            pilotDamageGroup: 'combat:test',
        });

        const operation = service.resumeChance(unit, 'chance:undo');
        closeDialog(0, { kind: 'critical-hits', count: 2 });
        await new Promise<void>(resolve => setTimeout(resolve, 0));

        expect(pendingHits[0]).toEqual(jasmine.objectContaining({
            id: 'chance:undo',
            remainingHits: 2,
            chanceOrigin: {
                explosionProtection: 'case-ii',
                hardenedArmorApplies: true,
            },
        }));
        expect(createDialog.calls.argsFor(1)[1].data.canUndoToChance).toBeTrue();

        closeDialog(1, { completed: false, undoToChance: true });
        await new Promise<void>(resolve => setTimeout(resolve, 0));

        expect(replacePendingCriticalHitWithChance).toHaveBeenCalledOnceWith('chance:undo');
        expect(pendingHits).toEqual([]);
        expect(pendingChances).toEqual([{
            type: 'mek-critical-chance',
            id: 'chance:undo',
            location: 'CT',
            explosionProtection: 'case-ii',
            hardenedArmorApplies: true,
            consolidateImmediately: true,
            pilotDamageGroup: 'combat:test',
        }]);
        expect(createDialog.calls.argsFor(2)[0]).toBe(MekCriticalChanceDialogComponent);
        expect(createDialog.calls.argsFor(2)[1].data.initialResult).toBeUndefined();

        closeDialog(2, undefined);
        await operation;
    });

    it('applies a blow-off result and consumes its pending chance', async () => {
        const setLocationCondition = jasmine.createSpy('setLocationCondition');
        (unit as unknown as { setLocationCondition: jasmine.Spy }).setLocationCondition = setLocationCondition;
        addChance({ id: 'chance:1', location: 'HD' });

        const operation = service.resumeChance(unit);
        closeDialog(0, { kind: 'blown-off' });
        await operation;

        expect(setLocationCondition).toHaveBeenCalledOnceWith('HD', 'blown-off', true, false);
        expect(pendingChances).toEqual([]);
        expect(pendingHits).toEqual([]);
        expect(showToast).toHaveBeenCalledWith('Head blown off', 'error');
    });

    it('automatically rolls and applies a critical chance when automation is yes', async () => {
        criticalAutomationMode = 'yes';
        const setLocationCondition = jasmine.createSpy('setLocationCondition');
        (unit as unknown as { setLocationCondition: jasmine.Spy }).setLocationCondition = setLocationCondition;
        spyOn(Math, 'random').and.returnValues(0.99, 0.99);
        addChance({ id: 'chance:auto', location: 'LA' });

        await service.resumeChance(unit, 'chance:auto');

        expect(createDialog).not.toHaveBeenCalled();
        expect(setLocationCondition).toHaveBeenCalledOnceWith('LA', 'blown-off', true, false);
        expect(pendingChances).toEqual([]);
        expect(pendingHits).toEqual([]);
        expect(showToast).toHaveBeenCalledWith(
            'Atlas AS7-D — Critical chance: Left Arm blown off',
            'error',
        );
    });

    it('opens the chance and hit panels in yes mode when manually requested', async () => {
        criticalAutomationMode = 'yes';
        spyOn(Math, 'random');
        addChance({ id: 'chance:manual', location: 'CT' });

        const operation = service.resumeChance(unit, 'chance:manual', true);
        expect(createDialog.calls.argsFor(0)[0]).toBe(MekCriticalChanceDialogComponent);

        closeDialog(0, { kind: 'critical-hits', count: 1 });
        await new Promise<void>(resolve => setTimeout(resolve, 0));

        expect(createDialog.calls.argsFor(1)[0]).toBe(MekCriticalHitDialogComponent);
        expect(Math.random).not.toHaveBeenCalled();
        expect(applyCriticalRoll).not.toHaveBeenCalled();

        closeDialog(1, undefined);
        await operation;
    });

    it('reports when an automatic critical chance produces no critical hits', async () => {
        criticalAutomationMode = 'yes';
        spyOn(Math, 'random').and.returnValues(0, 0);
        addChance({ id: 'chance:none', location: 'CT' });

        await service.resumeChance(unit, 'chance:none');

        expect(showToast).toHaveBeenCalledOnceWith(
            'Atlas AS7-D — Critical chance in Center Torso: no critical hits (roll 2)',
            'success',
        );
        expect(pendingChances).toEqual([]);
    });

    it('automatically rolls and applies queued critical hits when automation is yes', async () => {
        criticalAutomationMode = 'yes';
        const slot = {
            id: 'engine@CT:0',
            loc: 'CT',
            slot: 0,
            name: 'Engine',
            hits: 0,
            pendingHits: 0,
            destroying: false,
            destroyed: false,
        };
        (unit as unknown as {
            getCritSlots: () => unknown[];
            getCritSlot: (location: string, index: number) => unknown | null;
        }).getCritSlots = () => [slot];
        (unit as unknown as {
            getCritSlot: (location: string, index: number) => unknown | null;
        }).getCritSlot = (location, index) => location === 'CT' && index === 0 ? slot : null;
        spyOn(Math, 'random').and.returnValue(0);

        await service.queue(unit, {
            id: 'critical:auto',
            location: 'CT',
            hits: 1,
            consolidateImmediately: false,
        });

        expect(createDialog).not.toHaveBeenCalled();
        expect(applyCriticalRoll).toHaveBeenCalledOnceWith(
            unit,
            'CT',
            [1, 1],
            false,
            { transfer: false, pilotDamageGroup: 'combat:test' },
        );
        expect(showToast).toHaveBeenCalledOnceWith(
            'Atlas AS7-D — Critical hit in Center Torso: Engine (slot 1)',
            'error',
        );
        expect(pendingHits).toEqual([]);
    });

    it('shows a success toast when an automatic CASE II check discards a critical', async () => {
        criticalAutomationMode = 'yes';
        spyOn(Math, 'random').and.returnValues(0.99, 0.99);
        addHit({
            id: 'critical:case-ii',
            location: 'CT',
            targetLocation: 'CT',
            remainingHits: 1,
            caseII: { status: 'pending' },
        });

        await service.resume(unit, 'critical:case-ii');

        expect(showToast).toHaveBeenCalledOnceWith(
            'Atlas AS7-D — CASE II critical check: PASSED (12 vs 8+)',
            'success',
        );
        expect(applyCriticalRoll).not.toHaveBeenCalled();
        expect(pendingHits).toEqual([]);
    });

    it('lets intact armored limb actuators absorb a blow-off result', async () => {
        const shoulder = {
            id: 'shoulder@LA',
            name: 'Shoulder',
            loc: 'LA',
            slot: 0,
            armored: true,
            hits: 0,
        };
        const applyHitToCritSlot = jasmine.createSpy('applyHitToCritSlot');
        const setLocationCondition = jasmine.createSpy('setLocationCondition');
        (unit as unknown as {
            getCritSlots: () => unknown[];
            applyHitToCritSlot: jasmine.Spy;
            setLocationCondition: jasmine.Spy;
        }).getCritSlots = () => [shoulder];
        (unit as unknown as { applyHitToCritSlot: jasmine.Spy }).applyHitToCritSlot = applyHitToCritSlot;
        (unit as unknown as { setLocationCondition: jasmine.Spy }).setLocationCondition = setLocationCondition;
        addChance({ id: 'chance:1', location: 'LA' });

        const operation = service.resumeChance(unit);
        closeDialog(0, { kind: 'blown-off' });
        await operation;

        expect(applyHitToCritSlot).toHaveBeenCalledOnceWith(shoulder, 1, false);
        expect(setLocationCondition).not.toHaveBeenCalled();
        expect(pendingChances).toEqual([]);
        expect(showToast).toHaveBeenCalledWith('Armored Shoulder absorbs the blow-off result', 'info');
    });

    it('queues an explicitly requested serialized chance while keeping it resumable', async () => {
        const operation = service.queueChance(unit, {
            id: 'manual:1',
            location: 'CT',
            consolidateImmediately: true,
        });

        expect(pendingChances[0]).toEqual(jasmine.objectContaining({
            type: 'mek-critical-chance',
            id: 'manual:1',
            location: 'CT',
            consolidateImmediately: true,
        }));
        expect(createDialog).toHaveBeenCalledOnceWith(
            MekCriticalChanceDialogComponent,
            jasmine.objectContaining({ disableClose: false }),
        );

        closeDialog(0, { kind: 'none' });
        await operation;
        expect(pendingChances).toEqual([]);
    });

    function addChance(entry: PendingEventInput<SerializedPendingMekCriticalChance>): void {
        pendingChances.push({ type: 'mek-critical-chance', ...entry });
        pendingCriticalOrder.push(entry.id);
    }

    function addHit(entry: PendingEventInput<SerializedPendingMekCritical>): void {
        pendingHits.push({ type: 'mek-critical-hit', ...entry });
        pendingCriticalOrder.push(entry.id);
    }

    function addUnitCheck(entry: PendingEventInput<SerializedPendingUnitCheck>): void {
        pendingUnitChecks.push({ type: 'unit-check', ...entry } as SerializedPendingUnitCheck);
    }

    function updateChance(
        id: string,
        update: (pending: SerializedPendingMekCriticalChance) => SerializedPendingMekCriticalChance,
    ): boolean {
        const index = pendingChances.findIndex(entry => entry.id === id);
        if (index === -1) return false;
        pendingChances[index] = update(pendingChances[index]);
        return true;
    }

    function updateHit(
        id: string,
        update: (pending: SerializedPendingMekCritical) => SerializedPendingMekCritical,
    ): boolean {
        const index = pendingHits.findIndex(entry => entry.id === id);
        if (index === -1) return false;
        pendingHits[index] = update(pendingHits[index]);
        return true;
    }

    function closeDialog(index: number, result: unknown): void {
        dialogClosures[index].next(result);
        dialogClosures[index].complete();
    }
});
