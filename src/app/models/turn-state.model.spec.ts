import { computed, signal } from '@angular/core';
import type { CBTForceUnitState } from './cbt-force-unit-state.model';
import { MountedEquipment } from './mounted-equipment.model';
import { type CriticalSlot, type HeatProfile } from './force-serialization';
import { AeroRules } from './rules/aero-rules';
import { InfantryRules } from './rules/infantry-rules';
import { MekRules } from './rules/mek-rules';
import type { UnitTypeRules } from './rules/unit-type-rules';
import type { Unit } from './units.model';
import { calculateHeatProjection, TurnState } from './turn-state.model';
import { Equipment } from './equipment.model';
import { PpcCapacitorHandler, PPC_CAPACITOR_STATE_KEY } from '../equipment-handlers/ppc-capacitor.handler';
import { TWAeroRules, TWInfantryRules, TWMekRules } from './rules/tw-rules';
import { CORE_2026_GAME_RULES, TW_GAME_RULES } from './rules/game-rules';
import { EquipmentFlag } from './equipment-flags.type';

interface TurnStateHarnessOptions {
    critSlots?: CriticalSlot[];
    committedDestroyedLegs?: string[];
    currentDestroyedLegs?: string[];
    internalLocations?: string[];
    unit?: Partial<Unit>;
    destroyed?: boolean;
    prone?: boolean;
    shutdown?: boolean;
    skidding?: boolean;
    rulesType?: 'mek' | 'infantry' | 'aero';
    rulesId?: 'core2026' | 'tw';
}

interface TurnStateHarness {
    turnState: TurnState;
    critSlots: ReturnType<typeof signal<CriticalSlot[]>>;
    heat: ReturnType<typeof signal<HeatProfile>>;
    inventory: ReturnType<typeof signal<MountedEquipment[]>>;
    rules: UnitTypeRules;
}

function createCritSlot(
    name: string,
    loc: string,
    overrides: Partial<CriticalSlot> = {}
): CriticalSlot {
    const flags = getCritSlotEquipmentFlags(name);
    return {
        id: `${name}@${loc}#0`,
        name,
        loc,
        slot: 0,
        ...(flags.length > 0 ? { eq: createEquipment(name, flags) } : {}),
        ...overrides,
    };
}

function createEquipment(name: string, flags: EquipmentFlag[]): Equipment {
    return new Equipment({
        id: name,
        name,
        type: 'misc',
        flags,
    });
}

function getCritSlotEquipmentFlags(name: string): EquipmentFlag[] {
    if (name === 'Improved Jump Jet') return ['F_JUMP_JET', 'S_IMPROVED'];
    if (name === 'Prototype Improved Jump Jet') return ['F_JUMP_JET', 'S_IMPROVED', 'S_PROTOTYPE'];
    if (name === 'RISC Super-Cooled Myomer') return ['F_SCM'];
    return [];
}

function createTurnStateHarness(options: TurnStateHarnessOptions = {}): TurnStateHarness {
    const critSlots = signal<CriticalSlot[]>(options.critSlots ?? []);
    const inventory = signal<MountedEquipment[]>([]);
    const heat = signal<HeatProfile>({ current: 0, previous: 0 });
    const committedDestroyedLegs = new Set(options.committedDestroyedLegs ?? []);
    const currentDestroyedLegs = new Set(options.currentDestroyedLegs ?? []);
    const internalLocations = new Map((options.internalLocations ?? ['LL', 'RL']).map(loc => [loc, 1]));
    const heatSourceHandlers = [new PpcCapacitorHandler()];
    const ruleChecks = new Map<string, { token: string; trigger: string; status: 'pending' | 'success' | 'failed' }>();
    const setCondition = jasmine.createSpy('setCondition');
    let turnState: TurnState;

    const unit = {
        gameRules: options.rulesId === 'tw' ? TW_GAME_RULES : CORE_2026_GAME_RULES,
        locations: { internal: internalLocations },
        isLoaded: () => true,
        destroyed: options.destroyed ?? false,
        shutdown: options.shutdown ?? false,
        getCondition: () => false,
        getCrewMembers: () => [{ getState: () => 'healthy' }],
        getCritSlots: () => critSlots(),
        getInventory: () => inventory(),
        getHeat: () => heat(),
        getEquipmentHeatSources: () => inventory().flatMap(entry => heatSourceHandlers
            .flatMap(handler => handler.getInventoryHeatSources?.(entry, turnState) ?? [])),
        getRunMovementMultiplierBonus: () => 0,
        usesForcedWithdrawal: () => true,
        isInternalLocCommittedDestroyed: (loc: string) => committedDestroyedLegs.has(loc),
        isInternalLocDestroyed: (loc: string) => currentDestroyedLegs.has(loc) || committedDestroyedLegs.has(loc),
        isEquipmentUnavailable: (slot: CriticalSlot) => !!slot.destroyed || (slot.loc ? committedDestroyedLegs.has(slot.loc) : false),
        getRuleCheck: (key: string) => ruleChecks.get(key),
        setRuleCheck: (key: string, check: { token: string; trigger: string; status: 'pending' | 'success' | 'failed' } | undefined) => {
            if (check) ruleChecks.set(key, check);
            else ruleChecks.delete(key);
            return true;
        },
        setCondition,
        getUnit: () => ({ type: 'Mek', comp: [], ...options.unit } as Unit),
        turnState: () => turnState,
    };

    const unitState = {
        unit,
        heat,
        hasUnconsolidatedCrits: computed(() => false),
        hasUnconsolidatedLocations: computed(() => false),
        hasUnconsolidatedInventory: computed(() => false),
        hasCondition: (state: string) => {
            if (state === 'prone') return options.prone ?? false;
            if (state === 'skidding') return options.skidding ?? false;
            return false;
        },
        skidding: () => options.skidding ?? false,
    } as unknown as CBTForceUnitState;

    turnState = new TurnState(unitState);
    const rules = options.rulesId === 'tw'
        ? options.rulesType === 'infantry'
            ? new TWInfantryRules(unit as any)
            : options.rulesType === 'aero'
                ? new TWAeroRules(unit as any)
                : new TWMekRules(unit as any)
        : options.rulesType === 'infantry'
            ? new InfantryRules(unit as any)
            : options.rulesType === 'aero'
                ? new AeroRules(unit as any)
                : new MekRules(unit as any);
    (unit as any).rules = rules;
    turnState.capturePassiveHeatSourceBaseline();

    return {
        turnState,
        critSlots,
        heat,
        inventory,
        rules,
    };
}

function createTurnStateHarnessWithDissipation(dissipation: number): TurnStateHarness {
    const heatSink = new Equipment({
        id: 'test-heat-sink',
        name: 'Test Heat Sink',
        type: 'misc',
        flags: ['F_HEAT_SINK'],
    });
    return createTurnStateHarness({
        unit: {
            heat: dissipation,
            comp: [{
                id: 'test-heat-sinks',
                q: dissipation,
                q2: 0,
                n: 'Test Heat Sink',
                t: 'E',
                p: -1,
                l: '',
                c: '',
                os: 0,
                eq: heatSink,
            }],
        },
    });
}

function getReasons(turnState: TurnState): string[] {
    return turnState.getPSRChecks().map(check => check.reason);
}

function getMovementHeat(turnState: TurnState): number {
    return turnState.heatSources().find(source => source.id === 'movement')?.value ?? 0;
}

function getFiredHeat(turnState: TurnState): number {
    return turnState.heatSources().find(source => source.id === 'weapons')?.value ?? 0;
}

function getDamagedEngineHeat(turnState: TurnState): number {
    return turnState.heatSources().find(source => source.id === 'damaged-engine')?.value ?? 0;
}

describe('TurnState', () => {

    describe('calculateHeatProjection', () => {
        it('adds positive sources, subtracts dissipation, and clamps at zero', () => {
            expect(calculateHeatProjection(10, [
                { id: 'movement', label: 'Movement', value: 2 },
                { id: 'invalid', label: 'Invalid', value: Number.NaN },
                { id: 'negative', label: 'Negative', value: -5 },
            ], 5)).toEqual({
                current: 10,
                sourceHeat: 2,
                dissipation: 5,
                consumedDissipation: 5,
                projected: 7,
                delta: -3,
            });

            expect(calculateHeatProjection(2, [], 10).projected).toBe(0);
        });

        it('consumes only the dissipation needed before clipping at zero', () => {
            expect(calculateHeatProjection(5, [
                { id: 'movement', label: 'Movement', value: 1 },
            ], 20)).toEqual({
                current: 5,
                sourceHeat: 1,
                dissipation: 20,
                consumedDissipation: 6,
                projected: 0,
                delta: -5,
            });
            expect(calculateHeatProjection(5, [], 5).consumedDissipation).toBe(5);
            expect(calculateHeatProjection(5, [], 0).consumedDissipation).toBe(0);
        });
    });

    describe('heat dissipation balance', () => {
        it('does not expose a no-op heat resolution for zero-valued sources', () => {
            const { turnState, heat } = createTurnStateHarness();
            heat.set({ current: 5, previous: 5 });

            expect(turnState.heatSources()).toContain(jasmine.objectContaining({
                id: 'movement',
                value: 0,
            }));
            expect(turnState.heatProjection().projected).toBe(5);
            expect(turnState.hasPendingHeatResolution()).toBeFalse();
            expect(turnState.heatProjectionVisible()).toBeFalse();
        });

        it('keeps balanced positive heat sources pending for acknowledgement', () => {
            const { turnState, heat } = createTurnStateHarnessWithDissipation(2);
            heat.set({ current: 5, previous: 5 });
            turnState.moveMode.set('run');

            expect(turnState.heatProjection()).toEqual(jasmine.objectContaining({
                sourceHeat: 2,
                consumedDissipation: 2,
                projected: 5,
                delta: 0,
            }));
            expect(turnState.hasPendingHeatResolution()).toBeTrue();
            expect(turnState.heatProjectionVisible()).toBeTrue();
        });

        it('derives remaining cooling, an exact-zero balance, and a pending deficit from current capacity', () => {
            const { turnState, heat } = createTurnStateHarnessWithDissipation(5);
            turnState.acknowledgeHeatSources(3);

            expect(turnState.heatDissipationBalance()).toBe(2);
            expect(turnState.effectiveHeatDissipation()).toBe(2);
            expect(turnState.heatSources()).toEqual([]);

            heat.update(current => ({ ...current, heatsinksOff: 2 }));
            expect(turnState.heatDissipationBalance()).toBe(0);
            expect(turnState.effectiveHeatDissipation()).toBe(0);
            expect(turnState.hasPendingHeatResolution()).toBeFalse();

            heat.update(current => ({ ...current, heatsinksOff: 4 }));
            expect(turnState.heatDissipationBalance()).toBe(-2);
            expect(turnState.effectiveHeatDissipation()).toBe(0);
            expect(turnState.heatSources()).toEqual([{
                id: 'heat-dissipation-deficit',
                label: 'Dissipation',
                value: 2,
            }]);
            expect(turnState.heatProjection()).toEqual(jasmine.objectContaining({
                sourceHeat: 2,
                consumedDissipation: 0,
                projected: 2,
                delta: 2,
            }));
            expect(turnState.hasPendingHeatResolution()).toBeTrue();
        });

        it('settles a capacity deficit without acknowledging the derived heat source', () => {
            const { turnState, heat } = createTurnStateHarnessWithDissipation(5);
            turnState.acknowledgeHeatSources(5);
            heat.update(current => ({ ...current, heatsinksOff: 3 }));

            expect(turnState.heatDissipationBalance()).toBe(-3);

            turnState.acknowledgeHeatSources(0);

            expect(turnState.heatDissipationBalance()).toBe(0);
            expect(turnState.heatSources()).toEqual([]);
            expect(turnState.serialize()?.heatDissipationConsumed).toBe(2);
            expect(turnState.serialize()?.acknowledgedHeatSources?.['heat-dissipation-deficit']).toBeUndefined();
        });

        it('round-trips a pending deficit from consumed dissipation and current sink settings', () => {
            const { turnState, heat } = createTurnStateHarnessWithDissipation(5);
            turnState.acknowledgeHeatSources(5);
            heat.update(current => ({ ...current, heatsinksOff: 3 }));
            const serialized = turnState.serialize();

            const { turnState: restored, heat: restoredHeat } = createTurnStateHarnessWithDissipation(5);
            restoredHeat.update(current => ({ ...current, heatsinksOff: 3 }));
            restored.update(serialized);

            expect(restored.heatDissipationBalance()).toBe(-3);
            expect(restored.heatProjection().projected).toBe(3);
            expect(restored.serialize()?.heatDissipationConsumed).toBe(5);
            expect(restored.serialize()?.acknowledgedHeatSources?.['heat-dissipation-deficit']).toBeUndefined();
        });
    });

    describe('serialization', () => {
        it('round-trips resolved PSR outcomes', () => {
            const { turnState } = createTurnStateHarness();
            turnState.addDmgReceived(20);
            const check = turnState.getPSRChecks().find(entry => entry.fallCheck !== undefined)!;

            expect(check.id).toBeDefined();
            expect(check.failureOutcome).toBe('Fall');
            expect(turnState.resolvePSRCheck(check.id!, 'success')).toBeTrue();
            expect(turnState.PSRRollsCount()).toBe(0);

            const serialized = turnState.serialize();
            expect(serialized?.psrOutcomes).toEqual({ [check.id!]: 'success' });

            const { turnState: restored } = createTurnStateHarness();
            restored.update(serialized);
            expect(restored.getPSROutcome(check.id!)).toBe('success');
            expect(restored.PSRRollsCount()).toBe(0);
        });

        it('fails every check with the same outcome and applies prone', () => {
            const { turnState } = createTurnStateHarness({ rulesId: 'tw' });
            turnState.setPSRCheckState({ legActuators: new Map([['LL', 2]]) });
            const checks = turnState.getPSRChecks().filter(entry => entry.reason === 'Leg actuator hit');

            expect(checks.length).toBe(2);
            expect(checks[0].id).not.toBe(checks[1].id);
            expect(turnState.resolvePSRCheck(checks[1].id!, 'failed')).toBeTrue();
            expect(turnState.getPSROutcome(checks[0].id!)).toBe('failed');
            expect(turnState.getPSROutcome(checks[1].id!)).toBe('failed');
            expect(turnState.unitState.unit.setCondition).toHaveBeenCalledOnceWith('prone', true);
            expect(turnState.PSRRollsCount()).toBe(0);
        });

        it('groups unresolved failures by outcome without overwriting resolved checks', () => {
            const { turnState, rules } = createTurnStateHarness();
            spyOn(rules, 'getPSRChecks').and.returnValue([
                { reason: 'First fall check', fallCheck: 0, failureOutcome: 'Fall' },
                { reason: 'Second fall check', fallCheck: 1, failureOutcome: 'Fall' },
                { reason: 'Control check', fallCheck: 2, failureOutcome: 'Immobilized' },
            ]);
            const [firstFall, secondFall, control] = turnState.getPSRChecks();

            expect(turnState.resolvePSRCheck(firstFall.id!, 'success')).toBeTrue();
            expect(turnState.resolvePSRCheck(secondFall.id!, 'failed')).toBeTrue();
            expect(turnState.getPSROutcome(firstFall.id!)).toBe('success');
            expect(turnState.getPSROutcome(secondFall.id!)).toBe('failed');
            expect(turnState.getPSROutcome(control.id!)).toBeUndefined();
        });

        it('round-trips turn signals and PSR check state through a plain object', () => {
            const { turnState } = createTurnStateHarness();
            turnState.airborne.set(true);
            turnState.moveMode.set('jump');
            turnState.moveDistance.set(5);
            turnState.addDmgReceived(23);
            turnState.addFiredHeat(9);
            turnState.spotting.set(true);
            turnState.setPSRCheckState({
                legActuators: new Map([['LL', 2]]),
                hipsHit: new Set(['RL']),
                gyroHit: 1,
                gyroDestroyed: true,
                legsDestroyed: new Set(['LL']),
                shutdown: true,
            });

            const serialized = turnState.serialize();

            expect(serialized).toEqual({
                airborne: true,
                moveMode: 'jump',
                moveDistance: 5,
                dmgReceived: 23,
                weaponsHeat: 9,
                psrChecks: {
                    legActuators: { LL: 2 },
                    hipsHit: ['RL'],
                    gyroHit: 1,
                    gyroDestroyed: true,
                    legsDestroyed: ['LL'],
                    shutdown: true,
                },
                spotting: true,
            });

            const { turnState: restored } = createTurnStateHarness();
            restored.update(serialized);
            const restoredPsrChecks = restored.getPSRCheckState();

            expect(restored.airborne()).toBeTrue();
            expect(restored.moveMode()).toBe('jump');
            expect(restored.moveDistance()).toBe(5);
            expect(restored.dmgReceived()).toBe(23);
            expect(restored.weaponsHeat()).toBe(9);
            expect(restored.spotting()).toBeTrue();
            expect(restoredPsrChecks.legActuators?.get('LL')).toBe(2);
            expect(restoredPsrChecks.hipsHit?.has('RL')).toBeTrue();
            expect(restoredPsrChecks.gyroHit).toBe(1);
            expect(restoredPsrChecks.gyroDestroyed).toBeTrue();
            expect(restoredPsrChecks.legsDestroyed?.has('LL')).toBeTrue();
            expect(restoredPsrChecks.shutdown).toBeTrue();

            restored.update(undefined);
            expect(restored.serialize()).toBeUndefined();
        });

        it('persists disabled movement PSRs while omitting other false and empty state', () => {
            const { turnState } = createTurnStateHarness();
            turnState.airborne.set(false);
            turnState.applyMovePSR.set(false);
            turnState.spotting.set(false);
            turnState.setPSRCheckState({
                legActuators: new Map([['LL', 0]]),
                gyroHit: 0,
                gyroDestroyed: false,
                shutdown: false,
            });

            const serialized = turnState.serialize();

            expect(serialized).toEqual({ applyMovePSR: false });

            const { turnState: restored } = createTurnStateHarness();
            restored.update(serialized);
            expect(restored.applyMovePSR()).toBeFalse();
            expect(restored.dirty()).toBeFalse();
            expect(restored.dirtyPhase()).toBeFalse();
        });

        it('preserves applied heat sources without serializing derived source values', () => {
            const { turnState } = createTurnStateHarnessWithDissipation(5);
            turnState.moveMode.set('run');
            turnState.addFiredHeat(6);

            turnState.acknowledgeHeatSources(3);

            expect(turnState.serialize()).toEqual({
                moveMode: 'run',
                acknowledgedHeatSources: { movement: '[2,null,null]' },
                heatDissipationConsumed: 3,
            });

            const { turnState: restored } = createTurnStateHarnessWithDissipation(5);
            restored.update(turnState.serialize());

            expect(restored.heatProjectionVisible()).toBeFalse();
            expect(restored.heatSources()).toEqual([]);
            expect(restored.serialize()?.heatDissipationConsumed).toBe(3);
        });

        it('returns an isolated acknowledged heat-source snapshot', () => {
            const { turnState } = createTurnStateHarness();
            turnState.moveMode.set('run');
            turnState.acknowledgeHeatSources();
            const serialized = turnState.serialize()!;

            serialized.acknowledgedHeatSources!['movement'] = 'changed';

            expect(turnState.serialize()?.acknowledgedHeatSources?.['movement']).not.toBe('changed');
        });
    });

    describe('movement distance', () => {
        it('clamps the selected move distance to the current move mode range', () => {
            const { turnState } = createTurnStateHarness({ unit: { walk: 5, run: 8, run2: 8 } });
            turnState.moveMode.set('run');
            turnState.moveDistance.set(15);

            turnState.clampMoveDistanceToCurrentModeRange();

            expect(turnState.moveDistance()).toBe(8);
        });
    });

    describe('getPSRChecks', () => {
        it('includes movement PSR checks when applyMovePSR is enabled', () => {
            const { turnState } = createTurnStateHarness({
                critSlots: [createCritSlot('Gyro', 'CT', { destroyed: 1 })],
            });
            turnState.moveMode.set('run');
            turnState.moveDistance.set(1);
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

            expect(getReasons(turnState)).toContain('Leg Actuator hit');
            expect(getReasons(turnState)).not.toContain('Jumping with damaged leg actuator');
        });
    });

    describe('modifier breakdowns', () => {
        it('keeps the attacker modifier total in sync with the rules breakdown', () => {
            const { turnState } = createTurnStateHarness();
            turnState.moveMode.set('jump');
            turnState.spotting.set(true); // This will not affect

            expect(turnState.getAttackModifierBreakdown()).toEqual([
                { label: 'Jump', modifier: 3 },
            ]);
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
                skidding: true,
                rulesType: 'infantry',
                rulesId: 'tw',
                unit: { type: 'Infantry', subtype: 'Battle Armor', moveType: 'VTOL' },
            });
            turnState.moveMode.set('jump');
            turnState.moveDistance.set(7);

            expect(turnState.getDefenseModifierBreakdown()).toEqual([
                { label: 'Skidding', modifier: 2 },
                { label: 'Jumped', modifier: 1 },
                { label: 'Moved 7-9 hexes', modifier: 3 },
                { label: 'Battle Armor', modifier: 1 },
            ]);
            expect(turnState.getTotalTargetModifierAsDefender()).toEqual({ modifier: 7 });
        });

        it('counts an explicitly airborne defender even before movement is selected', () => {
            const { turnState } = createTurnStateHarness();

            turnState.airborne.set(true);

            expect(turnState.getDefenseModifierBreakdown()).toEqual([
                { label: 'Airborne', modifier: 1 },
            ]);
            expect(turnState.getTotalTargetModifierAsDefender()).toEqual({ modifier: 1 });
        });

        it('tracks alternate defender modifier totals for adjacent prone targets', () => {
            const { turnState } = createTurnStateHarness({
                prone: true,
                skidding: true,
                rulesId: 'tw',
            });
            turnState.moveMode.set('walk');
            turnState.moveDistance.set(3);

            expect(turnState.getDefenseModifierBreakdown()).toEqual([
                { label: 'Skidding', modifier: 2 },
                { label: 'Moved 3-4 hexes', modifier: 1 },
                { label: 'Prone', modifier: 1, alternateModifier: -2, alternateModifierLabel: 'adjacent' },
            ]);
            expect(turnState.getTotalTargetModifierAsDefender()).toEqual({ modifier: 4, alternateModifier: 1 });
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

    describe('movement heat', () => {
        it('uses standard mek movement heat by default', () => {
            const { turnState } = createTurnStateHarness();

            turnState.moveMode.set('stationary');
            expect(getMovementHeat(turnState)).toBe(0);

            turnState.moveMode.set('walk');
            expect(getMovementHeat(turnState)).toBe(1);

            turnState.moveMode.set('run');
            expect(getMovementHeat(turnState)).toBe(2);

            turnState.moveMode.set('jump');
            turnState.moveDistance.set(5);
            expect(getMovementHeat(turnState)).toBe(5);
        });

        it('uses reduced jump heat for working improved jump jets', () => {
            const { turnState } = createTurnStateHarness({
                critSlots: [
                    createCritSlot('Improved Jump Jet', 'LT'),
                    createCritSlot('Improved Jump Jet', 'LT'),
                    createCritSlot('Improved Jump Jet', 'LT'),
                    createCritSlot('Improved Jump Jet', 'RT'),
                    createCritSlot('Improved Jump Jet', 'RT'),
                    createCritSlot('Improved Jump Jet', 'RT'),
                ],
            });

            turnState.moveMode.set('jump');
            turnState.moveDistance.set(6);

            expect(getMovementHeat(turnState)).toBe(3);
        });

        it('uses XXL engine movement heat without active Super-Cooled Myomer', () => {
            const { turnState } = createTurnStateHarness({
                unit: { engine: 'XXL (Clan)' },
            });

            turnState.moveMode.set('stationary');
            expect(getMovementHeat(turnState)).toBe(2);

            turnState.moveMode.set('walk');
            expect(getMovementHeat(turnState)).toBe(4);

            turnState.moveMode.set('run');
            expect(getMovementHeat(turnState)).toBe(6);

            turnState.moveMode.set('jump');
            turnState.moveDistance.set(5);
            expect(getMovementHeat(turnState)).toBe(10);
        });

        it('keeps the XXL jump minimum at 6 heat', () => {
            const { turnState } = createTurnStateHarness({
                unit: { engine: 'XXL (IS)' },
            });

            turnState.moveMode.set('jump');
            turnState.moveDistance.set(1);

            expect(getMovementHeat(turnState)).toBe(6);
        });

        it('makes improved jump jets generate normal jump heat on XXL engines', () => {
            const { turnState } = createTurnStateHarness({
                unit: { engine: 'XXL (IS)' },
                critSlots: [
                    createCritSlot('Improved Jump Jet', 'LT'),
                    createCritSlot('Improved Jump Jet', 'LT'),
                    createCritSlot('Improved Jump Jet', 'RT'),
                    createCritSlot('Improved Jump Jet', 'RT'),
                    createCritSlot('Improved Jump Jet', 'CT'),
                ],
            });

            turnState.moveMode.set('jump');
            turnState.moveDistance.set(1);
            expect(getMovementHeat(turnState)).toBe(3);

            turnState.moveDistance.set(5);

            expect(getMovementHeat(turnState)).toBe(5);
        });

        it('doubles prototype improved jump jet heat', () => {
            const { turnState } = createTurnStateHarness({
                critSlots: [
                    createCritSlot('Prototype Improved Jump Jet', 'LT'),
                    createCritSlot('Prototype Improved Jump Jet', 'LT'),
                    createCritSlot('Prototype Improved Jump Jet', 'RT'),
                    createCritSlot('Prototype Improved Jump Jet', 'RT'),
                    createCritSlot('Prototype Improved Jump Jet', 'CT'),
                ],
            });

            turnState.moveMode.set('jump');
            turnState.moveDistance.set(1);
            expect(getMovementHeat(turnState)).toBe(6);

            turnState.moveDistance.set(5);
            expect(getMovementHeat(turnState)).toBe(10);
        });

        it('quadruples prototype improved jump jet heat on XXL engines', () => {
            const { turnState } = createTurnStateHarness({
                unit: { engine: 'XXL (IS)' },
                critSlots: [
                    createCritSlot('Prototype Improved Jump Jet', 'LT'),
                    createCritSlot('Prototype Improved Jump Jet', 'LT'),
                    createCritSlot('Prototype Improved Jump Jet', 'RT'),
                    createCritSlot('Prototype Improved Jump Jet', 'RT'),
                    createCritSlot('Prototype Improved Jump Jet', 'CT'),
                ],
            });

            turnState.moveMode.set('jump');
            turnState.moveDistance.set(1);
            expect(getMovementHeat(turnState)).toBe(12);

            turnState.moveDistance.set(5);
            expect(getMovementHeat(turnState)).toBe(20);
        });

        it('suppresses non-jump movement heat while any Super-Cooled Myomer crit is working', () => {
            const { turnState } = createTurnStateHarness({
                unit: { engine: 'XXL (Clan)' },
                critSlots: [
                    createCritSlot('RISC Super-Cooled Myomer', 'LT', { destroyed: 1 }),
                    createCritSlot('RISC Super-Cooled Myomer', 'RT'),
                ],
            });

            turnState.moveMode.set('stationary');
            expect(getMovementHeat(turnState)).toBe(0);

            turnState.moveMode.set('walk');
            expect(getMovementHeat(turnState)).toBe(0);

            turnState.moveMode.set('run');
            expect(getMovementHeat(turnState)).toBe(0);

            turnState.moveMode.set('jump');
            turnState.moveDistance.set(5);
            expect(getMovementHeat(turnState)).toBe(10);
        });

        it('restores XXL movement heat when all Super-Cooled Myomer crits are destroyed', () => {
            const { turnState } = createTurnStateHarness({
                unit: { engine: 'XXL (Clan)' },
                critSlots: [
                    createCritSlot('RISC Super-Cooled Myomer', 'LT', { destroyed: 1 }),
                    createCritSlot('RISC Super-Cooled Myomer', 'RT', { destroyed: 1 }),
                ],
            });

            turnState.moveMode.set('walk');
            expect(getMovementHeat(turnState)).toBe(4);
        });

        it('tracks fired heat as a resettable turn heat source', () => {
            const { turnState } = createTurnStateHarness();

            expect(getFiredHeat(turnState)).toBe(0);

            turnState.addFiredHeat(7);
            turnState.addFiredHeat(3);

            expect(getFiredHeat(turnState)).toBe(10);

            turnState.acknowledgeHeatSources();

            expect(getFiredHeat(turnState)).toBe(0);
        });

        it('clears all current heat sources and reactivates when a weapon fires again', () => {
            const { turnState } = createTurnStateHarness();
            turnState.moveMode.set('run');
            turnState.addFiredHeat(6);

            turnState.acknowledgeHeatSources();

            expect(turnState.weaponsHeat()).toBe(0);
            expect(turnState.heatSources()).toEqual([]);
            expect(turnState.heatProjectionVisible()).toBeFalse();

            turnState.addFiredHeat(6);

            expect(getFiredHeat(turnState)).toBe(6);
            expect(getMovementHeat(turnState)).toBe(0);
            expect(turnState.heatSources().map(source => source.id)).toEqual(['weapons']);
            expect(turnState.heatProjectionVisible()).toBeTrue();
        });

        it('does not reactivate applied sources for invalid fired heat', () => {
            const { turnState } = createTurnStateHarness();
            turnState.acknowledgeHeatSources();

            [0, -1, Number.NaN, Number.POSITIVE_INFINITY].forEach(value => turnState.addFiredHeat(value));

            expect(turnState.heatProjectionVisible()).toBeFalse();
            expect(turnState.heatSources()).toEqual([]);
        });

        it('reactivates actionable heat for movement changes and readdition', () => {
            const { turnState } = createTurnStateHarness();
            turnState.moveMode.set('run');
            turnState.moveDistance.set(5);
            turnState.acknowledgeHeatSources();

            turnState.moveMode.set('walk');
            expect(turnState.heatProjectionVisible()).toBeTrue();
            expect(getMovementHeat(turnState)).toBe(1);

            turnState.acknowledgeHeatSources();
            turnState.moveMode.set(null);
            turnState.moveDistance.set(null);
            expect(getMovementHeat(turnState)).toBe(0);
            expect(turnState.heatProjectionVisible()).toBeFalse();

            turnState.acknowledgeHeatSources();
            turnState.moveMode.set('run');
            turnState.moveDistance.set(5);
            expect(turnState.heatProjectionVisible()).toBeTrue();
            expect(getMovementHeat(turnState)).toBe(2);
        });

        it('reactivates only when changed criticals alter passive heat sources', () => {
            const engineCrit = createCritSlot('Engine', 'CT');
            const unrelatedCrit = createCritSlot('Sensors', 'HD');
            const { turnState, critSlots } = createTurnStateHarness({ critSlots: [engineCrit, unrelatedCrit] });
            turnState.acknowledgeHeatSources();

            unrelatedCrit.destroying = 1;
            critSlots.set([...critSlots()]);
            turnState.reconcileHeatSources();
            expect(turnState.heatProjectionVisible()).toBeFalse();

            engineCrit.destroying = 1;
            critSlots.set([...critSlots()]);
            turnState.reconcileHeatSources();
            expect(turnState.heatProjectionVisible()).toBeTrue();
            expect(getDamagedEngineHeat(turnState)).toBe(5);

            turnState.acknowledgeHeatSources();
            engineCrit.destroying = undefined;
            critSlots.set([...critSlots()]);
            turnState.reconcileHeatSources();
            expect(turnState.heatProjectionVisible()).toBeFalse();
            expect(getDamagedEngineHeat(turnState)).toBe(0);

            engineCrit.destroying = 2;
            critSlots.set([...critSlots()]);
            turnState.reconcileHeatSources();
            expect(turnState.heatProjectionVisible()).toBeTrue();
            expect(getDamagedEngineHeat(turnState)).toBe(5);
        });

        it('reactivates capped engine heat when another engine critical appears', () => {
            const engineCrits = [
                createCritSlot('Engine', 'CT', { id: 'engine@CT#0', destroying: 1 }),
                createCritSlot('Engine', 'CT', { id: 'engine@CT#1', destroying: 2 }),
                createCritSlot('Engine', 'CT', { id: 'engine@CT#2' }),
            ];
            const { turnState, critSlots } = createTurnStateHarness({ critSlots: engineCrits });
            turnState.acknowledgeHeatSources();
            expect(turnState.heatProjectionVisible()).toBeFalse();

            engineCrits[2].destroying = 3;
            critSlots.set([...engineCrits]);
            turnState.reconcileHeatSources();

            expect(turnState.heatProjectionVisible()).toBeTrue();
            expect(getDamagedEngineHeat(turnState)).toBe(10);
        });

        it('does not generate damaged-engine heat for destroyed or shutdown Meks', () => {
            const engineCrits = [
                createCritSlot('Engine', 'CT', { id: 'engine@CT#0', destroyed: 1 }),
                createCritSlot('Engine', 'CT', { id: 'engine@CT#1', destroyed: 1 }),
            ];
            const operational = createTurnStateHarness({ critSlots: engineCrits });
            const destroyed = createTurnStateHarness({ critSlots: engineCrits, destroyed: true });
            const shutdown = createTurnStateHarness({ critSlots: engineCrits, shutdown: true });

            expect(getDamagedEngineHeat(operational.turnState)).toBe(10);
            expect(operational.turnState.hasPendingHeatResolution()).toBeTrue();
            expect(operational.turnState.dirty()).toBeFalse();
            expect(getDamagedEngineHeat(destroyed.turnState)).toBe(0);
            expect(destroyed.turnState.dirty()).toBeFalse();
            expect(getDamagedEngineHeat(shutdown.turnState)).toBe(0);
            expect(shutdown.turnState.dirty()).toBeFalse();
        });

        it('keeps acknowledged engine heat suppressed when movement changes', () => {
            const engineCrit = createCritSlot('Engine', 'CT', { destroying: 1 });
            const { turnState } = createTurnStateHarness({ critSlots: [engineCrit] });
            turnState.moveMode.set('run');
            turnState.acknowledgeHeatSources();

            turnState.moveMode.set('walk');

            expect(turnState.heatSources().map(source => source.id)).toEqual(['movement']);
            expect(getMovementHeat(turnState)).toBe(1);
            expect(getDamagedEngineHeat(turnState)).toBe(0);
        });

        it('includes fired heat for aero rules that do not add movement heat sources', () => {
            const { turnState } = createTurnStateHarness({
                rulesType: 'aero',
                unit: { type: 'Aero', subtype: 'Aerospace Fighter' },
            });

            turnState.addFiredHeat(6);

            expect(turnState.heatSources()).toEqual([
                { id: 'weapons', label: 'Weapons', value: 6 },
            ]);
        });

        it('adds charged PPC capacitor heat while the linked PPC and capacitor are usable', () => {
            const { turnState, inventory } = createTurnStateHarness({ rulesType: 'aero' });
            const owner = turnState.unitState.unit;
            const ppcEquipment = createEquipment('Light PPC', ['F_PPC', 'F_PPC_CAPACITOR_COMPATIBLE']);
            const capacitorEquipment = createEquipment('PPC Capacitor', ['F_WEAPON_ENHANCEMENT', 'F_PPC_CAPACITOR']);
            const ppc = new MountedEquipment({ owner, id: 'Light PPC@RA#3', name: 'Light PPC', equipment: ppcEquipment });
            const capacitor = new MountedEquipment({
                owner,
                id: 'PPC Capacitor@RA#5',
                name: 'PPC Capacitor',
                equipment: capacitorEquipment,
                parent: ppc,
                states: new Map([[PPC_CAPACITOR_STATE_KEY, 'charged']])
            });
            ppc.linkedWith = [capacitor];
            inventory.set([ppc, capacitor]);

            expect(turnState.heatSources()).toContain(jasmine.objectContaining({
                id: 'ppc-capacitor:Light PPC@RA#3',
                label: 'PPC Capacitor',
                value: 5
            }));

            capacitor.setCommittedDestroyed(true);

            expect(turnState.heatSources().some(source => source.id.startsWith('ppc-capacitor:'))).toBeFalse();
        });
    });
});