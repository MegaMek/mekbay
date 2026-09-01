// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import { Overlay } from '@angular/cdk/overlay';
import { provideZonelessChangeDetection } from '@angular/core';
import { TestBed } from '@angular/core/testing';

import type { CBTUnitSnapshot } from '../../models/cbt-unit-snapshot';
import { createDirectMekRuntimeFixture } from '../../models/runtime/testing/direct-mek-runtime-fixture';
import type { RuntimeUnitNotificationSnapshot } from './unit-notification-runtime.util';
import { projectRuntimeUnitNotifications } from './unit-notification-runtime.util';
import {
    projectRuntimeFallTooltip,
    projectRuntimePendingNotification,
    UnitNotificationBadgesComponent,
} from './unit-notification-badges.component';

describe('direct runtime unit notifications', () => {
    it('aggregates the complete queue and follows origin/next priority', () => {
        const snapshot = notificationSnapshot([
            event('critical-hit', 1, 'Critical Hit: Left Torso'),
            event('critical-chance', 3, 'Critical Chance: Center Torso'),
            event('psr', 2, 'Piloting Skill Rolls'),
            event('unit-check', 2, 'Consciousness check'),
        ]);

        expect(projectRuntimePendingNotification(snapshot)).toEqual({
            kind: 'unit-check',
            count: 8,
            tooltip: [
                { label: 'Consciousness check', value: 'Pending' },
                { label: 'Critical Hit: Left Torso', value: 'Pending' },
                { label: 'Critical Chance: Center Torso', value: 'Pending' },
                { label: 'Piloting Skill Rolls', value: 'Pending' },
            ],
        });
    });

    it('uses the first queued critical type after higher-priority work is gone', () => {
        const snapshot = notificationSnapshot([
            event('critical-hit', 1, 'Critical Hit'),
            event('critical-chance', 2, 'Critical Chance'),
        ]);

        expect(projectRuntimePendingNotification(snapshot)).toEqual(jasmine.objectContaining({
            kind: 'critical-hit',
            count: 3,
        }));
    });

    it('groups pending fall consequences ahead of every other event', () => {
        const snapshot = notificationSnapshot(
            [event('fall', 1, 'Fall damage'), event('psr', 2, 'PSR')],
            [{ label: 'Automatic fall', value: 'Gyro destroyed' }],
        );

        expect(projectRuntimePendingNotification(snapshot)).toEqual(jasmine.objectContaining({
            kind: 'fall',
            count: 3,
        }));
        expect(projectRuntimeFallTooltip(snapshot)).toEqual([
            { label: 'Automatic fall', value: 'Gyro destroyed' },
        ]);
    });

    it('reads pending-combat PSRs from the exact End Phase preview', () => {
        const fixture = createDirectMekRuntimeFixture('total-warfare');
        const foot = [...fixture.index.slots.values()].find(candidate =>
            fixture.index.locations.get(candidate.locationId)?.code === 'LL'
            && candidate.componentIds.some(componentId => {
                const component = fixture.index.components.get(componentId);
                return component?.kind === 'system' && component.systemType === 'Foot Actuator';
            }))!;
        expect(fixture.instance.dispatch({
            type: 'hit-critical',
            slotId: foot.id,
            hits: 1,
            target: 'pending',
        }).accepted).toBeTrue();
        expect(fixture.instance.query().mekPilotChecks()).toEqual([]);

        const projected = projectRuntimeUnitNotifications(
            unitSnapshot(fixture),
            { pilotHitsAndConsciousnessCheck: 'ask' },
        );

        expect(projectRuntimePendingNotification(projected)).toEqual({
            kind: 'psr',
            count: 1,
            tooltip: [{ label: 'Leg Actuator hit', value: 'Target 5+' }],
        });
        expect(fixture.instance.query().mekPilotChecks()).toEqual([]);
    });

    it('renders the numbered warning used by both badge hosts', async () => {
        await TestBed.configureTestingModule({
            imports: [UnitNotificationBadgesComponent],
            providers: [
                provideZonelessChangeDetection(),
                { provide: Overlay, useValue: {} },
            ],
        }).compileComponents();
        const fixture = TestBed.createComponent(UnitNotificationBadgesComponent);
        fixture.componentRef.setInput('snapshot', notificationSnapshot([
            event('psr', 2, 'Piloting Skill Rolls'),
        ]));
        fixture.componentRef.setInput('interactive', true);
        fixture.componentRef.setInput('display', 'overlay');
        fixture.detectChanges();

        const badge = fixture.nativeElement.querySelector('.pending-events-warning.psr-warning');
        expect(badge).not.toBeNull();
        expect(badge.getAttribute('aria-label')).toBe('Resume 2 pending events; next: PSR checks');
        expect(badge.querySelector('text')?.textContent?.trim()).toBe('2!');
    });
});

function event(
    kind: RuntimeUnitNotificationSnapshot['pendingEvents'][number]['kind'],
    count: number,
    label: string,
): RuntimeUnitNotificationSnapshot['pendingEvents'][number] {
    return Object.freeze({
        kind,
        count,
        tooltip: Object.freeze([{ label, value: 'Pending' }]),
    });
}

function notificationSnapshot(
    pendingEvents: RuntimeUnitNotificationSnapshot['pendingEvents'],
    automaticFallTooltip: RuntimeUnitNotificationSnapshot['automaticFallTooltip'] = null,
): RuntimeUnitNotificationSnapshot {
    return Object.freeze({
        pendingEvents: Object.freeze(pendingEvents),
        automaticFallTooltip,
    });
}

function unitSnapshot(
    fixture: ReturnType<typeof createDirectMekRuntimeFixture>,
): CBTUnitSnapshot {
    return Object.freeze({
        instanceId: 'unit:direct-fixture',
        entity: fixture.entity,
        index: fixture.index,
        sourceRef: fixture.identity,
        ruleset: fixture.instance.ruleset(),
        crewAssignment: fixture.instance.query().crewAssignment(),
        state: fixture.instance.snapshot(),
        query: fixture.instance.query(),
    });
}
