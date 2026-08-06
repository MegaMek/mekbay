// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import { DialogRef, DIALOG_DATA } from '@angular/cdk/dialog';
import { provideZonelessChangeDetection, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { GameSystem } from '../../models/common.model';
import type { Force } from '../../models/force.model';
import type { Unit } from '../../models/units.model';
import { OptionsService } from '../../services/options.service';
import { UnitSearchFiltersService } from '../../services/unit-search-filters.service';
import { ForceBudgetOptimizerDialogComponent } from './force-budget-optimizer-dialog.component';

interface ClassicSkillPrioritiesTestApi {
    gunnery: number;
    piloting: number;
    balance: number;
}

interface ForceBudgetOptimizerDialogTestApi {
    targetBudget(): number;
    getCBTSkillPriorities(unit: Unit): ClassicSkillPrioritiesTestApi;
    getCBTSmartScore(priorities: ClassicSkillPrioritiesTestApi, gunnery: number, piloting: number): number;
    getPhysicalDamagePerTurn(unit: Unit): number;
    selectBestAffordableState(states: readonly OptimizationStateTestApi[], targetBudget: number): OptimizationStateTestApi | null;
}

interface OptimizationStateTestApi {
    totalCost: number;
    smartScore: number;
    previous: OptimizationStateTestApi | null;
    choice: null;
}

describe('ForceBudgetOptimizerDialogComponent', () => {
    async function createComponent(forceTotal = 0, bvPvLimit = 0): Promise<ForceBudgetOptimizerDialogTestApi> {
        const force = {
            gameSystem: GameSystem.CLASSIC,
            totalBv: jasmine.createSpy('totalBv').and.returnValue(forceTotal),
            units: signal([]),
            readOnly: signal(false),
        } as unknown as Force;

        const optionsServiceStub = {
            options: signal({
                forceBudgetOptimizerLastSkills: {
                    gunnery: { min: 2, max: 6 },
                    piloting: { min: 2, max: 6 },
                    skill: { min: 2, max: 6 },
                    maxDelta: 8,
                },
            }),
            setOption: jasmine.createSpy('setOption').and.resolveTo(undefined),
        };

        await TestBed.configureTestingModule({
            imports: [ForceBudgetOptimizerDialogComponent],
            providers: [
                provideZonelessChangeDetection(),
                { provide: DialogRef, useValue: { close: jasmine.createSpy('close') } },
                { provide: DIALOG_DATA, useValue: { force } },
                { provide: OptionsService, useValue: optionsServiceStub },
                { provide: UnitSearchFiltersService, useValue: { bvPvLimit: signal(bvPvLimit) } },
            ],
        }).compileComponents();

        const fixture = TestBed.createComponent(ForceBudgetOptimizerDialogComponent);
        return fixture.componentInstance as unknown as ForceBudgetOptimizerDialogTestApi;
    }

    it('uses the active BV/PV limit as the initial optimization target', async () => {
        const component = await createComponent(5_000, 7_500);

        expect(component.targetBudget()).toBe(7_500);
    });

    it('uses the current force total when no positive BV/PV limit is set', async () => {
        const component = await createComponent(5_000, 0);

        expect(component.targetBudget()).toBe(5_000);
    });

    function createUnit(overrides: Partial<Unit>): Unit {
        return {
            type: 'Mek',
            tons: 0,
            dpt: 0,
            comp: [],
            ...overrides,
        } as Unit;
    }

    it('uses ranged DPT and physical plus kick damage as comparable Classic skill priorities', async () => {
        const component = await createComponent();
        const assassin = createUnit({
            tons: 40,
            dpt: 11.3,
            comp: [
                { id: 'Sword', q: 1, n: 'Sword', t: 'P', p: 5, l: 'LA', md: '5' },
            ],
        });

        const priorities = component.getCBTSkillPriorities(assassin);

        expect(component.getPhysicalDamagePerTurn(assassin)).toBe(13);
        expect(priorities.gunnery).toBeCloseTo(12.3, 5);
        expect(priorities.piloting).toBe(14);
        expect(priorities.balance).toBeCloseTo(11.3, 5);
    });

    it('prefers balanced gunnery and piloting for units with balanced ranged and physical damage', async () => {
        const component = await createComponent();
        const assassin = createUnit({
            tons: 40,
            dpt: 11.3,
            comp: [
                { id: 'Sword', q: 1, n: 'Sword', t: 'P', p: 5, l: 'LA', md: '5' },
            ],
        });
        const priorities = component.getCBTSkillPriorities(assassin);

        const balancedScore = component.getCBTSmartScore(priorities, 4, 4);
        const pilotingSkewedScore = component.getCBTSmartScore(priorities, 6, 2);

        expect(balancedScore).toBeGreaterThan(pilotingSkewedScore);
    });

    it('prioritizes gunnery for ranged-focused units', async () => {
        const component = await createComponent();
        const rangedVehicle = createUnit({
            type: 'Tank',
            tons: 80,
            dpt: 30,
            comp: [],
        });
        const priorities = component.getCBTSkillPriorities(rangedVehicle);

        const gunneryFocusedScore = component.getCBTSmartScore(priorities, 2, 6);
        const pilotingFocusedScore = component.getCBTSmartScore(priorities, 6, 2);

        expect(priorities.gunnery).toBe(31);
        expect(priorities.piloting).toBe(1);
        expect(gunneryFocusedScore).toBeGreaterThan(pilotingFocusedScore);
    });

    it('selects the nearest result without exceeding the target budget', async () => {
        const component = await createComponent();
        const best = component.selectBestAffordableState([
            createState(7998, 0),
            createState(8001, 1000),
            createState(7995, 2000),
        ], 8000);

        expect(best?.totalCost).toBe(7998);
    });

    it('returns no result when every final state exceeds the target budget', async () => {
        const component = await createComponent();
        const best = component.selectBestAffordableState([
            createState(8001, 1000),
            createState(8002, 2000),
        ], 8000);

        expect(best).toBeNull();
    });

    function createState(totalCost: number, smartScore: number): OptimizationStateTestApi {
        return {
            totalCost,
            smartScore,
            previous: null,
            choice: null,
        };
    }
});