import { computed, signal } from '@angular/core';
import type { CBTForceUnitState } from './cbt-force-unit-state.model';
import type { CriticalSlot, HeatProfile } from './force-serialization';
import type { Unit } from './units.model';
import { TurnState } from './turn-state.model';

interface TurnStateHarnessOptions {
    critSlots?: CriticalSlot[];
    committedDestroyedLegs?: string[];
    currentDestroyedLegs?: string[];
    internalLocations?: string[];
}

interface TurnStateHarness {
    turnState: TurnState;
    critSlots: ReturnType<typeof signal<CriticalSlot[]>>;
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

    const unit = {
        locations: { internal: internalLocations },
        shutdown: false,
        getCritSlots: () => critSlots(),
        isInternalLocCommittedDestroyed: (loc: string) => committedDestroyedLegs.has(loc),
        isInternalLocDestroyed: (loc: string) => currentDestroyedLegs.has(loc) || committedDestroyedLegs.has(loc),
        getUnit: () => ({ type: 'Mek' } as Unit),
    };

    const unitState = {
        unit,
        heat,
        hasUnconsolidatedCrits: computed(() => false),
        hasUnconsolidatedLocations: computed(() => false),
        prone: () => false,
        immobile: () => false,
        skidding: () => false,
    } as unknown as CBTForceUnitState;

    return {
        turnState: new TurnState(unitState),
        critSlots,
    };
}

function getReasons(turnState: TurnState): string[] {
    return turnState.getPSRChecks().map(check => check.reason);
}

describe('TurnState', () => {
    describe('getCommittedDamageMovementModePSRCheck', () => {
        it('returns null for non-run and non-jump move modes', () => {
            const { turnState } = createTurnStateHarness();

            expect(turnState.getCommittedDamageMovementModePSRCheck(null)).toBeNull();
            expect(turnState.getCommittedDamageMovementModePSRCheck('walk')).toBeNull();
            expect(turnState.getCommittedDamageMovementModePSRCheck('stationary')).toBeNull();
        });

        it('returns a running-with-damaged-gyro check for committed gyro damage', () => {
            const { turnState } = createTurnStateHarness({
                critSlots: [createCritSlot('Gyro', 'CT', { destroyed: 1 })],
            });

            expect(turnState.getCommittedDamageMovementModePSRCheck('run')).toEqual(jasmine.objectContaining({
                reason: 'Running with damaged gyro',
                fallCheck: 0,
                pilotCheck: 0,
            }));
        });

        it('returns a jumping-with-damaged-leg check for committed leg destruction', () => {
            const { turnState } = createTurnStateHarness({
                committedDestroyedLegs: ['LL'],
            });

            expect(turnState.getCommittedDamageMovementModePSRCheck('jump')).toEqual(jasmine.objectContaining({
                reason: 'Jumping with damaged leg',
            }));
        });

        it('returns a jumping-with-damaged-leg-actuator check for committed actuator damage', () => {
            const { turnState } = createTurnStateHarness({
                critSlots: [createCritSlot('Upper Leg Actuator', 'LL', { destroyed: 1 })],
            });

            expect(turnState.getCommittedDamageMovementModePSRCheck('jump')).toEqual(jasmine.objectContaining({
                reason: 'Jumping with damaged leg actuator',
            }));
        });

        it('returns a running-with-damaged-hip check for committed hip damage', () => {
            const { turnState } = createTurnStateHarness({
                critSlots: [createCritSlot('Hip', 'LL', { destroyed: 1 })],
            });

            expect(turnState.getCommittedDamageMovementModePSRCheck('run')).toEqual(jasmine.objectContaining({
                reason: 'Running with damaged hip',
            }));
        });

        it('does not require a run PSR for non-hip leg actuator damage alone', () => {
            const { turnState } = createTurnStateHarness({
                critSlots: [createCritSlot('Upper Leg Actuator', 'LL', { destroyed: 1 })],
            });

            expect(turnState.getCommittedDamageMovementModePSRCheck('run')).toBeNull();
        });

        it('ignores current-turn damage that is not yet committed', () => {
            const { turnState } = createTurnStateHarness({
                critSlots: [createCritSlot('Gyro', 'CT', { destroying: 1 })],
            });

            expect(turnState.getCommittedDamageMovementModePSRCheck('run')).toBeNull();
            expect(turnState.getCommittedDamageMovementModePSRCheck('jump')).toBeNull();
        });

        it('drives movementModeRequiresPSR from committed damage only', () => {
            const { turnState } = createTurnStateHarness({
                critSlots: [createCritSlot('Hip', 'LL', { destroyed: 1 })],
            });

            expect(turnState.movementModeRequiresPSR('run')).toBeTrue();
            expect(turnState.movementModeRequiresPSR('jump')).toBeTrue();
            expect(turnState.movementModeRequiresPSR('walk')).toBeFalse();
        });
    });

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
            const { turnState } = createTurnStateHarness({ critSlots: [gyroCrit] });

            turnState.evaluateCritSlotHit(gyroCrit);

            expect(turnState.getCommittedDamageMovementModePSRCheck('run')).toBeNull();
            expect(getReasons(turnState)).toContain('Gyro hit');
            expect(getReasons(turnState)).not.toContain('Running with damaged gyro');
        });

        it('keeps current-turn leg actuator hit PSRs separate from committed move PSR checks', () => {
            const legCrit = createCritSlot('Upper Leg Actuator', 'LL', { destroying: 1 });
            const { turnState } = createTurnStateHarness({ critSlots: [legCrit] });

            turnState.evaluateCritSlotHit(legCrit);

            expect(turnState.getCommittedDamageMovementModePSRCheck('jump')).toBeNull();
            expect(getReasons(turnState)).toContain('Leg actuator hit');
            expect(getReasons(turnState)).not.toContain('Jumping with damaged leg actuator');
        });
    });
});