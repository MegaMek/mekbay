import { DialogRef, DIALOG_DATA } from '@angular/cdk/dialog';
import { provideZonelessChangeDetection, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { GameSystem } from '../../models/common.model';
import type { Force } from '../../models/force.model';
import type { Unit } from '../../models/units.model';
import { OptionsService } from '../../services/options.service';
import { ForceBudgetOptimizerDialogComponent } from './force-budget-optimizer-dialog.component';

interface ClassicSkillPrioritiesTestApi {
    gunnery: number;
    piloting: number;
    balance: number;
}

interface ForceBudgetOptimizerDialogTestApi {
    getClassicSkillPriorities(unit: Unit): ClassicSkillPrioritiesTestApi;
    getClassicSmartScore(priorities: ClassicSkillPrioritiesTestApi, gunnery: number, piloting: number): number;
    getPhysicalDamagePerTurn(unit: Unit): number;
}

describe('ForceBudgetOptimizerDialogComponent', () => {
    async function createComponent(): Promise<ForceBudgetOptimizerDialogTestApi> {
        const force = {
            gameSystem: GameSystem.CLASSIC,
            totalBv: jasmine.createSpy('totalBv').and.returnValue(0),
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
            ],
        }).compileComponents();

        const fixture = TestBed.createComponent(ForceBudgetOptimizerDialogComponent);
        return fixture.componentInstance as unknown as ForceBudgetOptimizerDialogTestApi;
    }

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

        const priorities = component.getClassicSkillPriorities(assassin);

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
        const priorities = component.getClassicSkillPriorities(assassin);

        const balancedScore = component.getClassicSmartScore(priorities, 4, 4);
        const pilotingSkewedScore = component.getClassicSmartScore(priorities, 6, 2);

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
        const priorities = component.getClassicSkillPriorities(rangedVehicle);

        const gunneryFocusedScore = component.getClassicSmartScore(priorities, 2, 6);
        const pilotingFocusedScore = component.getClassicSmartScore(priorities, 6, 2);

        expect(priorities.gunnery).toBe(31);
        expect(priorities.piloting).toBe(1);
        expect(gunneryFocusedScore).toBeGreaterThan(pilotingFocusedScore);
    });
});