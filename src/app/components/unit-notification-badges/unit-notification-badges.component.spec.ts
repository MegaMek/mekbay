// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import { Overlay } from '@angular/cdk/overlay';
import { provideZonelessChangeDetection, signal, type WritableSignal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import type { CBTForceUnit } from '../../models/cbt-force-unit.model';
import type {
    SerializedPendingMekCritical,
    SerializedPendingMekCriticalChance,
    SerializedPendingUnitCheck,
} from '../../models/force-serialization';
import { UnitNotificationBadgesComponent } from './unit-notification-badges.component';

describe('UnitNotificationBadgesComponent', () => {
    let fixture: ComponentFixture<UnitNotificationBadgesComponent>;
    let autoFall: WritableSignal<boolean>;
    let automaticPsrFailure: WritableSignal<boolean>;
    let psrOutcome: WritableSignal<'success' | 'failed' | undefined>;
    let prone: WritableSignal<boolean>;
    let pendingFallCount: WritableSignal<number>;
    let psrCount: WritableSignal<number>;
    let chanceCount: WritableSignal<number>;
    let criticalHitCount: WritableSignal<number>;
    let criticalOrder: WritableSignal<readonly ('mek-critical-chance' | 'mek-critical-hit')[]>;
    let unitCheckCount: WritableSignal<number>;

    beforeEach(async () => {
        autoFall = signal(false);
        automaticPsrFailure = signal(false);
        psrOutcome = signal(undefined);
        prone = signal(false);
        pendingFallCount = signal(0);
        psrCount = signal(0);
        chanceCount = signal(3);
        criticalHitCount = signal(1);
        criticalOrder = signal(['mek-critical-hit', 'mek-critical-chance']);
        unitCheckCount = signal(2);

        await TestBed.configureTestingModule({
            imports: [UnitNotificationBadgesComponent],
            providers: [
                provideZonelessChangeDetection(),
                { provide: Overlay, useValue: {} },
            ],
        }).compileComponents();

        fixture = TestBed.createComponent(UnitNotificationBadgesComponent);
        fixture.componentRef.setInput('unit', createUnit());
        fixture.detectChanges();
    });

    it('summarizes the complete mixed queue in event order', () => {
        expect(fixture.componentInstance.pendingNotification()).toEqual({
            kind: 'unit-check',
            count: 6,
            tooltip: [
                { label: 'Consciousness check', value: 'Target 6+' },
                { label: 'Consciousness check', value: 'Target 6+' },
                { label: 'Critical Hit: Left Torso', value: '1 hit' },
                { label: 'Critical Chance: Center Torso', value: 'Pending' },
                { label: 'Critical Chance: Center Torso', value: 'Pending' },
                { label: 'Critical Chance: Center Torso', value: 'Pending' },
            ],
        });
    });

    it('uses the first queued critical type after higher-priority work is gone', () => {
        unitCheckCount.set(0);

        expect(fixture.componentInstance.pendingNotification()).toEqual(jasmine.objectContaining({
            kind: 'critical-hit',
            count: 4,
        }));

        criticalOrder.set(['mek-critical-chance', 'mek-critical-hit']);

        expect(fixture.componentInstance.pendingNotification()).toEqual(jasmine.objectContaining({
            kind: 'critical-chance',
            count: 4,
        }));
    });

    it('groups pending fall damage but keeps automatic fall outside the numbered queue', () => {
        autoFall.set(true);
        pendingFallCount.set(1);

        expect(fixture.componentInstance.hasPendingFalls()).toBeTrue();
        expect(fixture.componentInstance.hasAutoFall()).toBeFalse();
        expect(fixture.componentInstance.pendingNotification()).toEqual(jasmine.objectContaining({
            kind: 'fall',
            count: 7,
        }));

        pendingFallCount.set(0);
        unitCheckCount.set(0);
        chanceCount.set(1);
        criticalHitCount.set(0);
        psrCount.set(1);

        expect(fixture.componentInstance.hasAutoFall()).toBeTrue();
        expect(fixture.componentInstance.pendingNotification()).toEqual(jasmine.objectContaining({
            kind: 'critical-chance',
            count: 1,
        }));
    });

    it('shows an automatic-fall badge when an unconscious pilot will fail every pending PSR', () => {
        unitCheckCount.set(0);
        chanceCount.set(0);
        criticalHitCount.set(0);
        psrCount.set(2);
        automaticPsrFailure.set(true);
        fixture.detectChanges();

        expect(fixture.componentInstance.pendingNotification()).toBeNull();
        expect(fixture.componentInstance.hasAutoFall()).toBeTrue();
        expect(fixture.componentInstance.fallTooltip()).toEqual([
            { label: 'PSR 1', value: 'Fall' },
            { label: 'PSR 2', value: 'Fall' },
        ]);
        expect(fixture.nativeElement.querySelector('.automatic-fall-warning')).not.toBeNull();
    });

    it('keeps the automatic-fall badge visible for a stored failed PSR until its fall is applied', () => {
        unitCheckCount.set(0);
        chanceCount.set(0);
        criticalHitCount.set(0);
        psrCount.set(1);
        automaticPsrFailure.set(true);
        psrOutcome.set('failed');
        fixture.detectChanges();

        expect(fixture.componentInstance.pendingNotification()).toBeNull();
        expect(fixture.componentInstance.hasAutoFall()).toBeTrue();
        expect(fixture.componentInstance.fallTooltip()).toEqual([
            { label: 'PSR 1', value: 'Fall' },
        ]);

        prone.set(true);
        fixture.detectChanges();
        expect(fixture.componentInstance.hasAutoFall()).toBeFalse();
    });

    it('emits activation only when interaction is enabled', () => {
        const activated = jasmine.createSpy('activated');
        const event = jasmine.createSpyObj<Event>('event', ['preventDefault', 'stopPropagation']);
        fixture.componentInstance.activated.subscribe(activated);

        fixture.componentInstance.activate(event, 'unit-check');
        expect(activated).not.toHaveBeenCalled();

        fixture.componentRef.setInput('interactive', true);
        fixture.detectChanges();
        fixture.componentInstance.activate(event, 'unit-check');

        expect(event.preventDefault).toHaveBeenCalledTimes(1);
        expect(event.stopPropagation).toHaveBeenCalledTimes(1);
        expect(activated).toHaveBeenCalledOnceWith({ kind: 'unit-check', event });
    });

    function createUnit(): CBTForceUnit {
        const checks = (): SerializedPendingUnitCheck[] => Array.from(
            { length: unitCheckCount() },
            (_, index) => ({
                type: 'unit-check',
                id: `consciousness:${index}`,
                kind: 'consciousness',
                target: 6,
                crewId: 0,
                pilotDamageGroup: 'combat:closed',
            }),
        );
        const chances = (): SerializedPendingMekCriticalChance[] => Array.from(
            { length: chanceCount() },
            (_, index) => ({
                type: 'mek-critical-chance',
                id: `chance:${index}`,
                location: 'CT',
            }),
        );
        const hits = (): SerializedPendingMekCritical[] => criticalHitCount() > 0 ? [{
            type: 'mek-critical-hit',
            id: 'critical:0',
            location: 'LT',
            targetLocation: 'LT',
            remainingHits: criticalHitCount(),
        }] : [];
        const turnState = {
            autoFall: () => autoFall(),
            automaticPSRFailure: () => automaticPsrFailure(),
            isPSRCheckAutomaticFailure: () => automaticPsrFailure(),
            actionablePSRRollsCount: () => autoFall() || automaticPsrFailure() || psrOutcome() !== undefined
                ? 0
                : psrCount(),
            PSRRollsCount: () => psrOutcome() === undefined ? psrCount() : 0,
            getPSRChecks: () => Array.from({ length: psrCount() }, (_, index) => ({
                id: `psr:${index}`,
                fallCheck: 1,
                failureOutcome: 'Fall',
                reason: `PSR ${index + 1}`,
            })),
            getPSROutcome: () => psrOutcome(),
            pendingCriticalChanceCount: () => chanceCount(),
            pendingCriticalHitCount: () => criticalHitCount(),
            getPendingCriticalChances: chances,
            getPendingCriticalHits: hits,
            getPendingEvents: () => criticalOrder().flatMap<
                SerializedPendingMekCriticalChance | SerializedPendingMekCritical
            >(type => type === 'mek-critical-chance' ? chances() : hits()),
            pendingUnitCheckCount: () => unitCheckCount(),
            actionablePendingUnitChecks: checks,
        };
        return {
            gameRules: { aggregatedEndPhaseConsciousRolls: false },
            rules: { controlRollFullLabel: 'Piloting Skill Rolls' },
            pendingFallCount: () => pendingFallCount(),
            turnState: () => turnState,
            PSRTargetRoll: () => 7,
            getHeat: () => ({ current: 19 }),
            getCrewMember: () => undefined,
            getCrewMembers: () => [],
            getCondition: (condition: string) => condition === 'prone' && prone(),
        } as unknown as CBTForceUnit;
    }
});
