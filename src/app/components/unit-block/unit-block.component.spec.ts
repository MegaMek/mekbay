// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import { Overlay } from '@angular/cdk/overlay';
import { provideZonelessChangeDetection, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { CBTForceUnit } from '../../models/cbt-force-unit.model';
import type { CrewMemberState } from '../../models/crew-member.model';
import type { CrewStateDefinition } from '../../models/rules/unit-type-rules';
import { VEHICLE_CREW_STATE_DISPLAYS } from '../../models/rules/vehicle-rules';
import { OptionsService } from '../../services/options.service';
import { SpriteStorageService } from '../../services/sprite-storage.service';
import { UnitBlockComponent } from './unit-block.component';

describe('UnitBlockComponent', () => {
    beforeEach(() => {
        TestBed.configureTestingModule({
            imports: [UnitBlockComponent],
            providers: [
                provideZonelessChangeDetection(),
                {
                    provide: OptionsService,
                    useValue: { options: () => ({ trackPhaseAndTurn: true, unitDisplayName: 'chassisModel' }) },
                },
                { provide: Overlay, useValue: {} },
                {
                    provide: SpriteStorageService,
                    useValue: { loading: signal(false) },
                },
            ],
        });
    });

    it('includes crew state and one aggregated NARC badge alongside unit conditions', () => {
        const forceUnit = Object.create(CBTForceUnit.prototype) as CBTForceUnit;
        const crewStates: CrewMemberState[] = ['stunned', 'stunned'];
        Object.assign(forceUnit, {
            getConditions: () => new Map([['jammed', undefined]]),
            getCrewMembers: () => crewStates.map(state => ({ getState: () => state })),
            getLocationCondition: (location: string, condition: string) =>
                condition === 'narc' && (location === 'LT' || location === 'RT'),
        });
        Object.defineProperty(forceUnit, 'getLocations', {
            value: () => ({ LT: {}, CT: {}, RT: {} }),
        });
        Object.defineProperty(forceUnit, 'rules', {
            value: {
                crewStateDefinition: (state: CrewMemberState): CrewStateDefinition | undefined =>
                    VEHICLE_CREW_STATE_DISPLAYS.find(definition => definition.key === state),
                locationConditionControls: [{ key: 'narc', label: 'NARC', color: '#f00', counted: true }],
            },
        });

        const fixture = TestBed.createComponent(UnitBlockComponent);
        fixture.componentRef.setInput('forceUnit', forceUnit);

        expect(fixture.componentInstance.activeConditions()).toEqual([
            { key: 'jammed', label: 'JAMMED', color: '#ff6be6' },
            { key: 'crew-stunned', label: 'STUNNED', color: '#ff5ce6' },
            { key: 'location-narc', label: 'NARC', color: '#f00' },
        ]);
    });

    it('renders compact notifications as a normal-flow row inside the unit content', () => {
        const forceUnit = Object.create(CBTForceUnit.prototype) as CBTForceUnit;
        const turnState = {
            dirty: () => false,
            autoFall: () => false,
            actionablePSRRollsCount: () => 0,
            pendingCriticalChanceCount: () => 3,
            pendingCriticalHitCount: () => 1,
            getPendingCriticalChances: () => [{
                type: 'mek-critical-chance' as const,
                id: 'chance:1',
                location: 'CT',
            }],
            getPendingCriticalHits: () => [{
                type: 'mek-critical-hit' as const,
                id: 'critical:1',
                location: 'LT',
                targetLocation: 'LT',
                remainingHits: 1,
            }],
            getPendingEvents: () => [{
                type: 'mek-critical-hit' as const,
                id: 'critical:1',
                location: 'LT',
                targetLocation: 'LT',
                remainingHits: 1,
            }, {
                type: 'mek-critical-chance' as const,
                id: 'chance:1',
                location: 'CT',
            }],
            pendingUnitCheckCount: () => 0,
        };
        Object.defineProperty(forceUnit, 'force', {
            value: { gameSystem: 'cbt' },
            configurable: true,
        });
        Object.defineProperty(forceUnit, 'rules', {
            value: { controlRollFullLabel: 'Piloting Skill Rolls' },
            configurable: true,
        });
        Object.defineProperty(forceUnit, 'destroyed', {
            value: false,
            configurable: true,
        });
        Object.assign(forceUnit, {
            gameRules: { aggregatedEndPhaseConsciousRolls: true },
            getUnit: () => ({ chassis: 'Atlas', model: 'AS7-D' }),
            commander: () => false,
            alias: () => '',
            getPilotStats: () => '4/5',
            pendingFallCount: () => 0,
            turnState: () => turnState,
        });

        const fixture = TestBed.createComponent(UnitBlockComponent);
        fixture.componentRef.setInput('forceUnit', forceUnit);
        fixture.componentRef.setInput('compactMode', true);
        fixture.detectChanges();

        const square = fixture.nativeElement.querySelector('.unit-square') as HTMLElement;
        const content = square.querySelector('.unit-content') as HTMLElement;
        const badges = content.querySelector('unit-notification-badges') as HTMLElement;
        expect(fixture.componentInstance.compactMode()).toBeTrue();
        expect(content.contains(badges)).toBeTrue();
        expect(badges.classList).toContain('compact-notification-row');
        expect(badges.classList).not.toContain('compact');
        expect(badges.querySelector('.critical-chance-warning')?.textContent).toContain('3');
        expect(badges.querySelector('.critical-hit-warning')?.textContent).toContain('1');
        expect(Array.from(badges.querySelectorAll(
            '.critical-chance-warning, .critical-hit-warning',
        )).map(badge => badge.classList[1])).toEqual([
            'critical-hit-warning',
            'critical-chance-warning',
        ]);
        expect(getComputedStyle(content).flexDirection).toBe('column');
        expect(getComputedStyle(badges).position).toBe('static');
    });
});
