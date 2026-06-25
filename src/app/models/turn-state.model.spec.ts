import { computed, signal } from '@angular/core';
import type { CBTForceUnitState } from './cbt-force-unit-state.model';
import type { CriticalSlot, HeatProfile } from './force-serialization';
import { InfantryRules } from './rules/infantry-rules';
import { MekRules } from './rules/mek-rules';
import type { UnitTypeRules } from './rules/unit-type-rules';
import type { Unit } from './units.model';
import { TurnState } from './turn-state.model';

interface TurnStateHarnessOptions {
    critSlots?: CriticalSlot[];
    committedDestroyedLegs?: string[];
    currentDestroyedLegs?: string[];
    internalLocations?: string[];
    unit?: Partial<Unit>;
    prone?: boolean;
    immobile?: boolean;
    skidding?: boolean;
    rulesType?: 'mek' | 'infantry';
}

interface TurnStateHarness {
    turnState: TurnState;
    critSlots: ReturnType<typeof signal<CriticalSlot[]>>;
    rules: UnitTypeRules;
}

function createCritSlot(
    name: string,
    loc: string,
    overrides: Partial<CriticalSlot> = {}
): CriticalSlot {
    return {
        id: `${name}@${loc}#0`,
        name,
        loc,
        slot: 0,
        ...overrides,
    };
}

function createTurnStateHarness(options: TurnStateHarnessOptions = {}): TurnStateHarness {
    const critSlots = signal<CriticalSlot[]>(options.critSlots ?? []);
    const heat = signal<HeatProfile>({ current: 0, previous: 0 });
    const committedDestroyedLegs = new Set(options.committedDestroyedLegs ?? []);
    const currentDestroyedLegs = new Set(options.currentDestroyedLegs ?? []);
    const internalLocations = new Map((options.internalLocations ?? ['LL', 'RL']).map(loc => [loc, 1]));
    let turnState: TurnState;

    const unit = {
        locations: { internal: internalLocations },
        shutdown: false,
        getCritSlots: () => critSlots(),
        isInternalLocCommittedDestroyed: (loc: string) => committedDestroyedLegs.has(loc),
        isInternalLocDestroyed: (loc: string) => currentDestroyedLegs.has(loc) || committedDestroyedLegs.has(loc),
        getUnit: () => ({ type: 'Mek', ...options.unit } as Unit),
        turnState: () => turnState,
    };

    const unitState = {
        unit,
        heat,
        hasUnconsolidatedCrits: computed(() => false),
        hasUnconsolidatedLocations: computed(() => false),
        hasUnconsolidatedInventory: computed(() => false),
        prone: () => options.prone ?? false,
        immobile: () => options.immobile ?? false,
        skidding: () => options.skidding ?? false,
    } as unknown as CBTForceUnitState;

    turnState = new TurnState(unitState);
    const rules = options.rulesType === 'infantry'
        ? new InfantryRules(unit as any)
        : new MekRules(unit as any);
    (unit as any).rules = rules;

    return {
        turnState,
        critSlots,
        rules,
    };
}

function getReasons(turnState: TurnState): string[] {
    return turnState.getPSRChecks().map(check => check.reason);
}

describe('TurnState', () => {

    describe('getPSRChecks', () => {
        it('includes movement PSR checks when applyMovePSR is enabled', () => {
            const { turnState } = createTurnStateHarness({
                critSlots: [createCritSlot('Gyro', 'CT', { destroyed: 1 })],
            });
            turnState.moveMode.set('run');
            turnState.applyMovePSR.set(true);

            expect(getReasons(turnState)).toContain('Running with damaged gyro');
        });

        it('omits movement PSR checks when applyMovePSR is disabled', () => {
            const { turnState } = createTurnStateHarness({
                critSlots: [createCritSlot('Gyro', 'CT', { destroyed: 1 })],
            });
            turnState.moveMode.set('run');
            turnState.applyMovePSR.set(false);

            expect(getReasons(turnState)).not.toContain('Running with damaged gyro');
        });

        it('keeps current-turn gyro-hit PSRs separate from committed move PSR checks', () => {
            const gyroCrit = createCritSlot('Gyro', 'CT', { destroying: 1 });
            const { turnState, rules } = createTurnStateHarness({ critSlots: [gyroCrit] });

            rules.evaluateCritSlotHit(gyroCrit);

            expect(getReasons(turnState)).toContain('Gyro hit');
            expect(getReasons(turnState)).not.toContain('Running with damaged gyro');
        });

        it('keeps current-turn leg actuator hit PSRs separate from committed move PSR checks', () => {
            const legCrit = createCritSlot('Upper Leg Actuator', 'LL', { destroying: 1 });
            const { turnState, rules } = createTurnStateHarness({ critSlots: [legCrit] });

            rules.evaluateCritSlotHit(legCrit);

            expect(getReasons(turnState)).toContain('Leg actuator hit');
            expect(getReasons(turnState)).not.toContain('Jumping with damaged leg actuator');
        });
    });

    describe('modifier breakdowns', () => {
        it('keeps the attacker modifier total in sync with the rules breakdown', () => {
            const { turnState } = createTurnStateHarness();
            turnState.moveMode.set('jump');
            turnState.spotting.set(true);

            expect(turnState.getAttackModifierBreakdown()).toEqual([
                { label: 'Attacker movement', modifier: 3 },
                { label: 'Spotting', modifier: 1 },
            ]);
            expect(turnState.getTotalTargetModifierAsAttacker()).toBe(4);
        });

        it('uses LAM airborne attack movement modifiers', () => {
            const { turnState } = createTurnStateHarness({
                unit: { subtype: 'Land-Air BattleMek' },
            });

            turnState.airborne.set(false);
            turnState.moveMode.set('walk');
            expect(turnState.getAttackMovementModifier()).toBe(1);

            turnState.airborne.set(true);
            expect(turnState.getAttackMovementModifier()).toBe(3);

            turnState.moveMode.set('run');
            expect(turnState.getAttackMovementModifier()).toBe(4);
        });

        it('keeps the defender modifier total in sync with the rules breakdown', () => {
            const { turnState } = createTurnStateHarness({
                prone: true,
                skidding: true,
                rulesType: 'infantry',
                unit: { type: 'Infantry', subtype: 'Battle Armor', moveType: 'VTOL' },
            });
            turnState.moveMode.set('jump');
            turnState.moveDistance.set(7);

            expect(turnState.getDefenseModifierBreakdown()).toEqual([
                { label: 'Prone', modifier: -2 },
                { label: 'Skidding', modifier: 2 },
                { label: 'Jumped', modifier: 1 },
                { label: 'Moved 7-9 hexes', modifier: 3 },
                { label: 'Battle Armor', modifier: 1 },
            ]);
            expect(turnState.getTotalTargetModifierAsDefender()).toBe(5);
        });

        it('counts an explicitly airborne defender even before movement is selected', () => {
            const { turnState } = createTurnStateHarness();

            turnState.airborne.set(true);

            expect(turnState.getDefenseModifierBreakdown()).toEqual([
                { label: 'Airborne', modifier: 1 },
            ]);
            expect(turnState.getTotalTargetModifierAsDefender()).toBe(1);
        });
    });

    describe('movement distance limits', () => {
        it('uses unit rules for minimum movement distance', () => {
            const { turnState } = createTurnStateHarness({
                rulesType: 'infantry',
                unit: { type: 'Infantry', subtype: 'Battle Armor' },
            });

            turnState.moveMode.set('jump');
            expect(turnState.minDistanceCurrentMoveMode()).toBe(1);

            turnState.moveMode.set('walk');
            expect(turnState.minDistanceCurrentMoveMode()).toBe(0);
        });
    });
});