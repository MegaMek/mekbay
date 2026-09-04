// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import { TestBed } from '@angular/core/testing';
import { Subject, of } from 'rxjs';
import {
    FallingDamageDialogComponent,
    type FallingDamageDialogResult,
} from '../components/falling-damage-dialog/falling-damage-dialog.component';
import { FallingNoticeDialogComponent } from '../components/falling-notice-dialog/falling-notice-dialog.component';
import type { CBTForceUnit, CBTMekFallDamageRoll } from '../models/cbt-force-unit.model';
import { resolveMekFallArmorDamage } from '../utils/mek-falling.util';
import { CBTAutomationService } from './cbt-automation.service';
import { DialogsService } from './dialogs.service';
import { FallingResolutionService } from './falling-resolution.service';
import { ToastService } from './toast.service';

describe('FallingResolutionService', () => {
    let service: FallingResolutionService;
    let resolveAutomation: jasmine.Spy;
    let createDialog: jasmine.Spy;
    let closed: Subject<FallingDamageDialogResult | undefined>;
    let showToast: jasmine.Spy;

    beforeEach(() => {
        closed = new Subject<FallingDamageDialogResult | undefined>();
        resolveAutomation = jasmine.createSpy('resolve').and.callFake(
            (_key: string, events: Array<{ id: string }>) =>
                Promise.resolve(new Set(events.map(event => event.id))),
        );
        createDialog = jasmine.createSpy('createDialog').and.callFake((component: unknown) =>
            component === FallingNoticeDialogComponent ? { closed: of(undefined) } : { closed });
        showToast = jasmine.createSpy('showToast');
        TestBed.configureTestingModule({
            providers: [
                FallingResolutionService,
                { provide: CBTAutomationService, useValue: { resolve: resolveAutomation } },
                { provide: DialogsService, useValue: { createDialog } },
                { provide: ToastService, useValue: { showToast } },
            ],
        });
        service = TestBed.inject(FallingResolutionService);
    });

    it('auto-resolves yes mode after showing the rolled falling direction', async () => {
        const harness = createUnit('yes');
        spyOn(Math, 'random').and.returnValues(0.2, 0.99, 0.99, 0.5, 0.5);

        await service.open(harness.unit, {
            kind: 'falling',
            id: 'fall:1',
            source: 'psr',
            levelsFallen: 0,
        }, false);

        expect(createDialog).toHaveBeenCalledOnceWith(
            FallingNoticeDialogComponent,
            {
                disableClose: true,
                data: {
                    unitName: 'Test Mek',
                    orientation: jasmine.objectContaining({
                        roll: 2,
                        facingInstruction: 'Keep the current facing',
                    }),
                },
            },
        );
        expect(harness.addArmorHits).toHaveBeenCalledWith('HD', 5, false, false);
        expect(harness.applyHeadHitCrewHits).toHaveBeenCalledTimes(1);
        expect(harness.completePendingFall).toHaveBeenCalledOnceWith('fall:1');
        expect(showToast).toHaveBeenCalledWith(
            'Test Mek — Fall resolved: 6 damage applied — 5 to Head; 1 to Left Torso',
            'error',
        );
    });

    it('opens the falling panel instead of auto-resolving yes mode when manually requested', async () => {
        const harness = createUnit('yes');
        spyOn(Math, 'random');

        const operation = service.open(harness.unit, {
            kind: 'falling',
            id: 'fall:1',
            source: 'psr',
            levelsFallen: 0,
        }, false, true);
        await settlePromises();

        expect(createDialog).toHaveBeenCalledOnceWith(
            FallingDamageDialogComponent,
            jasmine.objectContaining({
                disableClose: false,
                data: jasmine.objectContaining({ unit: harness.unit }),
            }),
        );
        expect(Math.random).not.toHaveBeenCalled();
        expect(harness.completePendingFall).not.toHaveBeenCalled();

        closed.next({ action: 'close' });
        closed.complete();
        await operation;
    });

    it('reports the pilot hits actually applied by an automatic fall', async () => {
        const harness = createUnit('yes', 'yes');
        harness.applyHeadHitCrewHits.and.returnValue(3);
        spyOn(Math, 'random').and.returnValues(0.2, 0.99, 0.99, 0.5, 0.5);

        await service.open(harness.unit, {
            kind: 'falling',
            id: 'fall:1',
            source: 'psr',
            levelsFallen: 0,
        }, false);

        expect(showToast).toHaveBeenCalledWith(
            'Test Mek — Pilot hits from falling: 3 applied',
            'error',
        );
    });

    it('opens the fall directly, applies the selected damage, and resolves falling head hits', async () => {
        const harness = createUnit();
        const operation = service.open(harness.unit, {
            kind: 'falling',
            id: 'fall:1',
            source: 'stand-attempt',
            levelsFallen: 0,
        }, false);
        await settlePromises();

        expect(createDialog).toHaveBeenCalled();

        closed.next(headHitFallResult());
        closed.complete();
        await operation;

        expect(harness.addArmorHits).toHaveBeenCalledOnceWith('HD', 5, false, false);
        expect(resolveAutomation.calls.allArgs().map(args => args[0])).toEqual([
            'pilotHitsAndConsciousnessCheck',
        ]);
        expect(harness.applyHeadHitCrewHits).toHaveBeenCalledTimes(1);
        expect(harness.completePendingFall).toHaveBeenCalledOnceWith('fall:1');
        expect(showToast).toHaveBeenCalledWith(
            'Keep the current facing; 5 falling damage applied',
            'error',
        );
    });

    it('leaves the complete fall unapplied when the falling head-hit review is cancelled', async () => {
        resolveAutomation.and.resolveTo(null);
        const harness = createUnit();
        const operation = service.open(harness.unit, {
            kind: 'falling',
            id: 'fall:1',
            source: 'psr',
            levelsFallen: 0,
        }, false);
        await settlePromises();

        closed.next(headHitFallResult());
        closed.complete();
        await operation;

        expect(harness.addArmorHits).not.toHaveBeenCalled();
        expect(harness.applyHeadHitCrewHits).not.toHaveBeenCalled();
        expect(harness.completePendingFall).not.toHaveBeenCalled();
        expect(harness.unit.getPendingFall('fall:1')).toBeDefined();
    });

    it('applies fall damage but not a rejected falling head-hit injury', async () => {
        resolveAutomation.and.resolveTo(new Set<string>());
        const harness = createUnit();
        const operation = service.open(harness.unit, {
            kind: 'falling',
            id: 'fall:1',
            source: 'psr',
            levelsFallen: 0,
        }, false);
        await settlePromises();

        closed.next(headHitFallResult());
        closed.complete();
        await operation;

        expect(harness.addArmorHits).toHaveBeenCalledOnceWith('HD', 5, false, false);
        expect(harness.applyHeadHitCrewHits).not.toHaveBeenCalled();
        expect(harness.completePendingFall).toHaveBeenCalledOnceWith('fall:1');
    });

    it('does not let a later queued fall bypass the first pending fall', async () => {
        const harness = createUnit();
        const first = harness.unit.getPendingFall('fall:1')!;
        const second = { ...first, id: 'fall:2' };
        (harness.unit as unknown as { getPendingFall: (id?: string) => typeof first | undefined })
            .getPendingFall = id => id ? [first, second].find(fall => fall.id === id) : first;

        await service.open(harness.unit, {
            kind: 'falling',
            id: 'fall:2',
            source: 'psr',
            levelsFallen: 0,
        }, false);

        expect(createDialog).not.toHaveBeenCalled();
    });

    it('skips a queued fall without opening a dialog when falling automation is no', async () => {
        const harness = createUnit('no');

        await service.open(harness.unit, {
            kind: 'falling',
            id: 'fall:1',
            source: 'psr',
            levelsFallen: 0,
        }, false);

        expect(createDialog).not.toHaveBeenCalled();
        expect(harness.addArmorHits).not.toHaveBeenCalled();
        expect(harness.skipPendingFall).toHaveBeenCalledOnceWith('fall:1');
        expect(harness.completePendingFall).not.toHaveBeenCalled();
    });

    it('discards the fall without damage or seatbelt work when IGNORE is pressed', async () => {
        const harness = createUnit();
        const operation = service.open(harness.unit, {
            kind: 'falling',
            id: 'fall:1',
            source: 'psr',
            levelsFallen: 0,
        }, false);
        await settlePromises();

        closed.next({ action: 'ignore' });
        closed.complete();
        await operation;

        expect(harness.addArmorHits).not.toHaveBeenCalled();
        expect(harness.completePendingFall).not.toHaveBeenCalled();
        expect(harness.skipPendingFall).toHaveBeenCalledOnceWith('fall:1');
        expect(harness.unit.getPendingFall('fall:1')).toBeUndefined();
    });

    it('leaves the fall pending and does not release seatbelt work when CLOSE is pressed', async () => {
        const harness = createUnit();
        const operation = service.open(harness.unit, {
            kind: 'falling',
            id: 'fall:1',
            source: 'psr',
            levelsFallen: 0,
        }, false);
        await settlePromises();

        closed.next({ action: 'close' });
        closed.complete();
        await operation;

        expect(harness.addArmorHits).not.toHaveBeenCalled();
        expect(harness.completePendingFall).not.toHaveBeenCalled();
        expect(harness.unit.getPendingFall('fall:1')).toBeDefined();
    });

    it('leaves the fall pending when the dialog is dismissed', async () => {
        const harness = createUnit();

        const operation = service.open(harness.unit, {
            kind: 'falling',
            id: 'fall:1',
            source: 'psr',
            levelsFallen: 0,
        }, false);
        await settlePromises();
        closed.next(undefined);
        closed.complete();
        await operation;

        expect(createDialog).toHaveBeenCalled();
        expect(harness.completePendingFall).not.toHaveBeenCalled();
    });
});

function createUnit(
    fallingMode: 'yes' | 'ask' | 'no' = 'ask',
    pilotHitsMode: 'yes' | 'ask' | 'no' = 'ask',
): {
    unit: CBTForceUnit;
    addArmorHits: jasmine.Spy;
    applyHeadHitCrewHits: jasmine.Spy;
    completePendingFall: jasmine.Spy;
    skipPendingFall: jasmine.Spy;
} {
    const armorHits = new Map<string, number>();
    const addArmorHits = jasmine.createSpy('addArmorHits').and.callFake((location: string, hits: number) => {
        armorHits.set(location, (armorHits.get(location) ?? 0) + hits);
        return hits;
    });
    const applyHeadHitCrewHits = jasmine.createSpy('applyHeadHitCrewHits').and.returnValue(1);
    const pendingFalls: Array<{
        id: string;
        source: 'psr' | 'stand-attempt';
        levelsFallen: number;
        orientationRoll: number | null;
        damageRolls: CBTMekFallDamageRoll[];
    }> = [{
        id: 'fall:1',
        source: 'psr' as const,
        levelsFallen: 0,
        orientationRoll: null,
        damageRolls: [],
    }];
    const completePendingFall = jasmine.createSpy('completePendingFall').and.callFake((id: string) => {
        const index = pendingFalls.findIndex(pending => pending.id === id);
        if (index < 0) return false;
        pendingFalls.splice(index, 1);
        return true;
    });
    const skipPendingFall = jasmine.createSpy('skipPendingFall').and.callFake((id: string) => {
        const index = pendingFalls.findIndex(pending => pending.id === id);
        if (index < 0) return false;
        pendingFalls.splice(index, 1);
        return true;
    });
    const unit = {
        id: 'unit:test-mek',
        gameRules: { id: 'core2026', aggregatedEndPhaseConsciousRolls: true },
        turnState: () => ({ cover: () => undefined }),
        locations: { internal: new Map([['HD', { loc: 'HD' }], ['CT', { loc: 'CT' }]]) },
        getUnit: () => ({
            type: 'Mek',
            subtype: 'BattleMek',
            tons: 55,
            comp: [],
            armorType: 'Standard Armor',
            structureType: 'Standard',
        }),
        getNotificationDisplayName: () => 'Test Mek',
        automationMode: (key: string) => key === 'fallingCheck'
            ? fallingMode
            : key === 'pilotHitsAndConsciousnessCheck' ? pilotHitsMode : 'ask',
        getPendingFall: (id?: string) => id
            ? pendingFalls.find(pending => pending.id === id)
            : pendingFalls[0],
        setPendingFallRolls: (
            id: string,
            orientationRoll: number,
            damageRolls: readonly CBTMekFallDamageRoll[],
        ) => {
            const pending = pendingFalls.find(candidate => candidate.id === id);
            if (!pending) return false;
            pending.orientationRoll = orientationRoll;
            pending.damageRolls = [...damageRolls];
            return true;
        },
        completePendingFall,
        skipPendingFall,
        getArmorPoints: (location: string) => location === 'HD' ? 9 : 10,
        getArmorHits: (location: string) => armorHits.get(location) ?? 0,
        getArmorTypeAt: () => 'STANDARD',
        hasArmorType: () => false,
        addArmorHits,
        getModularArmorState: () => ({ hits: 0, points: 0, remaining: 0 }),
        addModularArmorHits: () => 0,
        applyMekFallArmorDamage: (
            location: string,
            damage: number,
            rear: boolean,
            consolidateImmediately: boolean,
        ) => {
            const resolution = resolveMekFallArmorDamage(
                'core2026',
                damage,
                (location === 'HD' ? 9 : 10) - (armorHits.get(location) ?? 0),
                'STANDARD',
            );
            if (resolution.armorDamage > 0) {
                addArmorHits(location, resolution.armorDamage, rear, consolidateImmediately);
            }
            return resolution;
        },
        getInternalPoints: () => 10,
        getInternalHits: () => 0,
        isInternalLocPhysicallyDestroyed: () => false,
        getStructureKindAt: () => 'standard',
        addInternalHits: jasmine.createSpy('addInternalHits').and.callFake((_location: string, hits: number) => hits),
        queueMekCriticalChance: jasmine.createSpy('queueMekCriticalChance'),
        applyHeadHitCrewHits,
    } as unknown as CBTForceUnit;
    return { unit, addArmorHits, applyHeadHitCrewHits, completePendingFall, skipPendingFall };
}

async function settlePromises(): Promise<void> {
    await Promise.resolve();
    await Promise.resolve();
}

function headHitFallResult(): FallingDamageDialogResult {
    return {
        action: 'accept',
        orientation: {
            roll: 1,
            facingOffset: 0,
            facingInstruction: 'Keep the current facing',
            hitArc: 'front',
            hitArcLabel: 'Front',
            rulesExplanation: 'Test',
        },
        groups: [{
            damage: 5,
            hitLocationRoll: 12,
            rawTableResult: 'HD',
            tableLabel: 'HD',
            location: 'HD',
            locationLabel: 'Head',
            rear: false,
            critical: false,
        }],
    };
}
