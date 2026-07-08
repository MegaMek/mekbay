import { computed, signal } from '@angular/core';
import type { CBTForceUnitState } from './cbt-force-unit-state.model';
import { MountedEquipment, type CriticalSlot, type HeatProfile } from './force-serialization';
import { AeroRules } from './rules/aero-rules';
import { InfantryRules } from './rules/infantry-rules';
import { MekRules } from './rules/mek-rules';
import type { UnitTypeRules } from './rules/unit-type-rules';
import type { Unit } from './units.model';
import { TurnState } from './turn-state.model';
import { Equipment } from './equipment.model';
import { PpcCapacitorHandler, PPC_CAPACITOR_STATE_KEY } from '../equipment-handlers/ppc-capacitor.handler';

interface TurnStateHarnessOptions {
    critSlots?: CriticalSlot[];
    committedDestroyedLegs?: string[];
    currentDestroyedLegs?: string[];
    internalLocations?: string[];
    unit?: Partial<Unit>;
    prone?: boolean;
    skidding?: boolean;
    rulesType?: 'mek' | 'infantry' | 'aero';
}

interface TurnStateHarness {
    turnState: TurnState;
    critSlots: ReturnType<typeof signal<CriticalSlot[]>>;
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

function createEquipment(name: string, flags: string[]): Equipment {
    return new Equipment({
        id: name,
        name,
        type: 'misc',
        flags,
    });
}

function getCritSlotEquipmentFlags(name: string): string[] {
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
    let turnState: TurnState;

    const unit = {
        locations: { internal: internalLocations },
        isLoaded: () => true,
        shutdown: false,
        getCondition: () => false,
        getCrewMembers: () => [{ getState: () => 'healthy' }],
        getCritSlots: () => critSlots(),
        getInventory: () => inventory(),
        getHeat: () => heat(),
        getEquipmentHeatSources: () => inventory().flatMap(entry => heatSourceHandlers
            .flatMap(handler => handler.getInventoryHeatSources?.(entry, turnState) ?? [])),
        getRunMovementMultiplierBonus: () => 0,
        isInternalLocCommittedDestroyed: (loc: string) => committedDestroyedLegs.has(loc),
        isInternalLocDestroyed: (loc: string) => currentDestroyedLegs.has(loc) || committedDestroyedLegs.has(loc),
        isEquipmentUnavailable: (slot: CriticalSlot) => !!slot.destroyed || (slot.loc ? committedDestroyedLegs.has(slot.loc) : false),
        getUnit: () => ({ type: 'Mek', ...options.unit } as Unit),
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
    const rules = options.rulesType === 'infantry'
        ? new InfantryRules(unit as any)
        : options.rulesType === 'aero'
            ? new AeroRules(unit as any)
            : new MekRules(unit as any);
    (unit as any).rules = rules;

    return {
        turnState,
        critSlots,
        inventory,
        rules,
    };
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

describe('TurnState', () => {

    describe('serialization', () => {
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

        it('omits false and empty turn state data from serialized output', () => {
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

            expect(turnState.serialize()).toBeUndefined();
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
                { label: 'Jump', modifier: 3 },
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
                { label: 'Prone', modifier: 1, alternateModifier: -2, alternateModifierLabel: 'adjacent' },
                { label: 'Skidding', modifier: 2 },
                { label: 'Jumped', modifier: 1 },
                { label: 'Moved 7-9 hexes', modifier: 3 },
                { label: 'Battle Armor', modifier: 1 },
            ]);
            expect(turnState.getTotalTargetModifierAsDefender()).toEqual({ modifier: 8, alternateModifier: 5 });
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
            });
            turnState.moveMode.set('walk');
            turnState.moveDistance.set(3);

            expect(turnState.getDefenseModifierBreakdown()).toEqual([
                { label: 'Prone', modifier: 1, alternateModifier: -2, alternateModifierLabel: 'adjacent' },
                { label: 'Skidding', modifier: 2 },
                { label: 'Moved 3-4 hexes', modifier: 1 },
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

            turnState.resetTurnHeatSources();

            expect(getFiredHeat(turnState)).toBe(0);
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
            const ppcEquipment = createEquipment('Light PPC', ['F_PPC']);
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