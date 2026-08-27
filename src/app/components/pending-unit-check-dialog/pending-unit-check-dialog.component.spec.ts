// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import { DIALOG_DATA, DialogRef } from '@angular/cdk/dialog';
import { provideZonelessChangeDetection, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import type { CBTForceUnit } from '../../models/cbt-force-unit.model';
import type { SerializedPendingUnitCheck } from '../../models/force-serialization';
import type { PSRCheck } from '../../models/rules/unit-type-rules';
import {
    PendingUnitCheckDialogComponent,
    type PendingUnitCheckDialogData,
} from './pending-unit-check-dialog.component';
import { PendingUnitCheckRowComponent } from './pending-unit-check-row.component';

function createUnit(
    id: string,
    name: string,
    check: SerializedPendingUnitCheck | readonly SerializedPendingUnitCheck[],
    rulesId: 'core2026' | 'tw' = 'core2026',
): {
    readonly unit: CBTForceUnit;
    readonly checks: ReturnType<typeof signal<readonly SerializedPendingUnitCheck[]>>;
    readonly psrChecks: ReturnType<typeof signal<readonly PSRCheck[]>>;
} {
    const checks = signal<readonly SerializedPendingUnitCheck[]>(
        Array.isArray(check) ? check : [check as SerializedPendingUnitCheck],
    );
    const psrChecks = signal<readonly PSRCheck[]>([]);
    const psrOutcomes = signal<Readonly<Record<string, 'success' | 'failed'>>>({});
    const psrOutcomeSelections = signal<Readonly<Record<string, 'success' | 'failed'>>>({});
    const psrDiceSelections = signal<Readonly<Record<string, readonly [number, number]>>>({});
    const crew = {
        getHits: () => 3,
        getName: () => '',
        getState: () => 'unconscious',
    };
    const turnState = {
        actionablePendingUnitChecks: () => checks().filter(candidate =>
            !('readyTurn' in candidate) || candidate.readyTurn <= 0),
        pendingCriticalChanceCount: () => 0,
        pendingCriticalHitCount: () => 0,
        PSRRollsCount: () => psrChecks().filter(check =>
            !!check.id && psrOutcomes()[check.id] === undefined).length,
        actionablePSRRollsCount: () => psrChecks().filter(check =>
            !!check.id && psrOutcomes()[check.id] === undefined).length,
        automaticPSRFailure: () => false,
        isPSRCheckAutomaticFailure: () => false,
        autoFall: () => false,
        getPSRChecks: psrChecks,
        getPSROutcome: (id: string) => psrOutcomes()[id],
        getPendingUnitCheck: (checkId: string) => checks().find(candidate => candidate.id === checkId),
        setPendingUnitCheckOutcome: (
            checkId: string,
            outcome: 'success' | 'failed',
            roll?: readonly number[],
        ) => {
            if (!checks().some(candidate => candidate.id === checkId)) return false;
            checks.update(current => current.map(candidate => candidate.id === checkId
                ? {
                    ...candidate,
                    result: roll
                        ? { kind: 'roll' as const, dice: [roll[0], roll[1]] as const }
                        : { kind: 'manual' as const, outcome },
                } as SerializedPendingUnitCheck
                : candidate));
            return true;
        },
    };
    return {
        checks,
        psrChecks,
        unit: {
            id,
            gameRules: {
                id: rulesId,
                aggregatedEndPhaseConsciousRolls: rulesId === 'core2026',
            },
            automationMode: () => 'ask',
            pendingFallCount: () => 0,
            turnState: () => turnState,
            psrOutcomeSelections,
            psrDiceSelections,
            PSRTargetRoll: () => 5,
            getRuleCheck: () => undefined,
            rules: {
                getActivePilotCrewId: () => 0,
                controlRollFullLabel: 'Piloting Skill Rolls',
            },
            getNotificationDisplayName: () => name,
            getCrewMember: () => crew,
            getCrewMembers: () => [crew],
            getHeat: () => ({ current: 0, previous: 0 }),
            getUnit: () => ({ type: 'Mek' }),
            getCritSlots: () => [],
        } as unknown as CBTForceUnit,
    };
}

describe('PendingUnitCheckDialogComponent', () => {
    let fixture: ComponentFixture<PendingUnitCheckDialogComponent>;
    let close: jasmine.Spy;
    let applyResolved: jasmine.Spy;
    let first: ReturnType<typeof createUnit>;
    let second: ReturnType<typeof createUnit>;

    beforeEach(async () => {
        first = createUnit('one', 'Atlas', {
            type: 'unit-check',
            id: 'recovery:one',
            kind: 'consciousness-recovery',
            crewId: 0,
            target: 7,
            readyTurn: 0,
        });
        second = createUnit('two', 'Marauder', {
            type: 'unit-check',
            id: 'recovery:two',
            kind: 'consciousness-recovery',
            crewId: 0,
            target: 7,
            readyTurn: 0,
        });
        close = jasmine.createSpy('close');
        applyResolved = jasmine.createSpy('applyResolved').and.callFake(
            (entries: readonly { unit: CBTForceUnit; check: SerializedPendingUnitCheck }[]) => {
                for (const entry of entries) {
                    const harness = entry.unit === first.unit ? first : second;
                    harness.checks.update(current => current.filter(check => check.id !== entry.check.id));
                }
            },
        );
        const data: PendingUnitCheckDialogData = {
            units: [first.unit, second.unit],
            applyResolved,
        };

        await TestBed.configureTestingModule({
            imports: [PendingUnitCheckDialogComponent],
            providers: [
                provideZonelessChangeDetection(),
                { provide: DIALOG_DATA, useValue: data },
                { provide: DialogRef, useValue: { close } },
            ],
        }).compileComponents();
        fixture = TestBed.createComponent(PendingUnitCheckDialogComponent);
        fixture.detectChanges();
    });

    afterEach(() => TestBed.resetTestingModule());

    it('groups every eligible recovery and supports physical-dice outcomes', () => {
        const rows = fixture.debugElement.queryAll(By.directive(PendingUnitCheckRowComponent));

        expect(rows.length).toBe(2);

        rows[0].componentInstance.choose('success');
        rows[1].componentInstance.choose('failed');

        expect(first.checks()[0].result).toEqual({ kind: 'manual', outcome: 'success' });
        expect(second.checks()[0].result).toEqual({ kind: 'manual', outcome: 'failed' });
        expect(fixture.componentInstance.allResolved()).toBeTrue();

        fixture.componentInstance.apply();

        expect(applyResolved).toHaveBeenCalledTimes(1);
        expect(close).toHaveBeenCalledOnceWith(true);
        expect(first.checks()).toEqual([]);
        expect(second.checks()).toEqual([]);
    });

    it('shows a header roll button for multiple rollable checks and rolls every row', () => {
        const rows = fixture.debugElement.queryAll(By.directive(PendingUnitCheckRowComponent))
            .map(row => row.componentInstance as PendingUnitCheckRowComponent);
        const rollSpies = rows.map(row => spyOn(row, 'roll'));
        const rollAllButton = fixture.debugElement.query(By.css('.unit-check-roll-all'));

        expect(rollAllButton).not.toBeNull();

        rollAllButton.triggerEventHandler('click');

        expect(rollSpies.every(spy => spy.calls.count() === 1)).toBeTrue();
    });

    it('does not show the header roll button for a single rollable check', () => {
        second.checks.set([]);
        fixture.detectChanges();

        expect(fixture.debugElement.query(By.css('.unit-check-roll-all'))).toBeNull();
    });

    it('orders shutdown, ammo, and consciousness events across every unit', () => {
        first.checks.set([
            { type: 'unit-check', id: 'shutdown:one', kind: 'heat-shutdown', target: 6 },
            { type: 'unit-check', id: 'ammo:one', kind: 'heat-ammo-explosion', target: 4 },
            {
                type: 'unit-check', id: 'consciousness:one', kind: 'consciousness', crewId: 0,
                pilotDamageGroup: 'turn-closed:heat:end-turn:test', target: 5,
            },
        ]);
        second.checks.set([
            { type: 'unit-check', id: 'shutdown:two', kind: 'heat-shutdown', target: 6 },
            { type: 'unit-check', id: 'ammo:two', kind: 'heat-ammo-explosion', target: 4 },
            {
                type: 'unit-check', id: 'consciousness:two', kind: 'consciousness', crewId: 0,
                pilotDamageGroup: 'turn-closed:heat:end-turn:test', target: 5,
            },
        ]);
        fixture.detectChanges();

        const rows = fixture.debugElement.queryAll(By.directive(PendingUnitCheckRowComponent));
        expect(rows.map(row => [
            row.componentInstance.entry().unit.id,
            row.componentInstance.label(),
        ])).toEqual([
            ['one', 'Shutdown'],
            ['two', 'Shutdown'],
            ['one', 'Ammunition explosion'],
            ['two', 'Ammunition explosion'],
            ['one', 'Consciousness check'],
            ['two', 'Consciousness check'],
        ]);
    });

    it('shows PSRs in sequence and auto-fails them after the active pilot loses consciousness', () => {
        first.checks.set([
            {
                type: 'unit-check', id: 'consciousness:one', kind: 'consciousness', crewId: 0,
                pilotDamageGroup: 'immediate:test', target: 5,
            },
            { type: 'unit-check', id: 'seatbelt:one', kind: 'seatbelt', crewId: 0, target: 5 },
        ]);
        second.checks.set([]);
        (first.unit.gameRules as { id: 'core2026' | 'tw'; aggregatedEndPhaseConsciousRolls: boolean }).id = 'tw';
        (first.unit.gameRules as { id: 'core2026' | 'tw'; aggregatedEndPhaseConsciousRolls: boolean })
            .aggregatedEndPhaseConsciousRolls = false;
        first.psrChecks.set([{
            id: 'psr:one',
            fallCheck: 0,
            reason: '20 or more damage',
            failureOutcome: 'Fall',
        }]);
        fixture.detectChanges();

        let rows = fixture.debugElement.queryAll(By.directive(PendingUnitCheckRowComponent));
        expect(rows.map(row => row.componentInstance.label())).toEqual([
            'Consciousness check',
            'Piloting Skill Check',
            'Seatbelt check · Falling',
        ]);
        expect(rows.map(row => row.componentInstance.failureOutcome())).toEqual([
            'unconsciousness',
            'Fall',
            'pilot hit',
        ]);
        rows[0].componentInstance.choose('failed');
        fixture.detectChanges();
        rows = fixture.debugElement.queryAll(By.directive(PendingUnitCheckRowComponent));

        expect(rows[1].componentInstance.outcome()).toBe('failed');
        expect(rows[1].componentInstance.isAutomatic()).toBeTrue();
    });

    it('persists completed choices when the dialog is closed or dismissed', () => {
        const row = fixture.debugElement.query(By.directive(PendingUnitCheckRowComponent))
            .componentInstance as PendingUnitCheckRowComponent;

        row.choose('success');
        fixture.componentInstance.close();

        expect(first.checks()[0].result).toEqual({ kind: 'manual', outcome: 'success' });
        expect(second.checks()[0].result).toBeUndefined();
        expect(applyResolved).not.toHaveBeenCalled();
        expect(close).toHaveBeenCalledOnceWith(false);
    });

    it('restores the exact virtual dice after the dialog is closed and reopened', () => {
        jasmine.clock().install();
        try {
            const row = fixture.debugElement.query(By.directive(PendingUnitCheckRowComponent))
                .componentInstance as PendingUnitCheckRowComponent;

            row.roller()!.roll([4, 4]);
            jasmine.clock().tick(500);
            fixture.componentInstance.close();

            expect(first.checks()[0]).toEqual(jasmine.objectContaining({
                result: { kind: 'roll', dice: [4, 4] },
            }));

            fixture.destroy();
            fixture = TestBed.createComponent(PendingUnitCheckDialogComponent);
            fixture.detectChanges();
            const reopenedRow = fixture.debugElement.query(By.directive(PendingUnitCheckRowComponent))
                .componentInstance as PendingUnitCheckRowComponent;

            expect(reopenedRow.roller()!.diceResults()).toEqual([4, 4]);
            expect(reopenedRow.roller()!.rollFinished()).toBeTrue();
        } finally {
            jasmine.clock().uninstall();
        }
    });

    it('identifies seatbelt checks as fall consequences even when unit-local IDs match', () => {
        first.checks.set([{
            type: 'unit-check',
            id: 'seatbelt',
            kind: 'seatbelt',
            crewId: 0,
            target: 5,
        }]);
        second.checks.set([{
            type: 'unit-check',
            id: 'seatbelt',
            kind: 'seatbelt',
            crewId: 0,
            target: 5,
        }]);
        fixture.detectChanges();

        const rows = fixture.debugElement.queryAll(By.directive(PendingUnitCheckRowComponent))
            .map(row => row.componentInstance as PendingUnitCheckRowComponent);

        expect(rows.map(row => row.label())).toEqual([
            'Seatbelt check · Falling',
            'Seatbelt check · Falling',
        ]);
        expect(rows.every(row => row.description().includes('Reason: Falling.'))).toBeTrue();
        expect(rows.every(row => row.failureOutcome() === 'pilot hit')).toBeTrue();
    });
});
