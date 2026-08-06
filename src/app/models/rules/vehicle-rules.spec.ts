import type { CBTForceUnit } from '../cbt-force-unit.model';
import type { CrewMemberState } from '../crew-member.model';
import { MountedEquipment, MountedWeapon } from '../mounted-equipment.model';
import { type CriticalSlot } from '../force-serialization';
import type { MotiveModes } from '../motiveModes.model';
import type { TurnState } from '../turn-state.model';
import { AmmoEquipment, Equipment, WeaponEquipment } from '../equipment.model';
import { EquipmentRegistry } from '../equipment-lookup';
import { createEmptyUnit } from '../../testing/unit-test-helpers';
import { VehicleRules } from './vehicle-rules';
import { MascHandler, MASC_ACTIVE_STATE_KEY } from '../../equipment-handlers/masc.handler';
import { TWVehicleRules } from './tw-rules';
import { CORE_2026_GAME_RULES, TW_GAME_RULES } from './game-rules';
import { EquipmentFlag } from '../equipment-flags.type';

const mascHandler = new MascHandler();

function crit(id: string, destroyed: number): CriticalSlot {
    return { id, destroyed, destroying: destroyed };
}

function weapon(id: string, flags: EquipmentFlag[] = []): WeaponEquipment {
    return new WeaponEquipment({
        id,
        name: id,
        type: 'weapon',
        flags,
        weapon: { ranges: [1, 2, 3, 4] }
    });
}

function equipment(id: string, flags: EquipmentFlag[] = []): Equipment {
    return new Equipment({
        id,
        name: id,
        type: 'misc',
        flags,
    });
}

function entry(options: {
    id?: string;
    equipment?: Equipment;
    locations?: string[];
    intrinsicPhysicalAttack?: boolean;
    destroyed?: boolean;
    critSlots?: CriticalSlot[];
} = {}): MountedEquipment {
    return new MountedEquipment({
        owner: undefined as unknown as CBTForceUnit,
        id: options.id ?? options.equipment?.id ?? 'entry',
        name: options.id ?? options.equipment?.name ?? 'entry',
        equipment: options.equipment,
        locations: new Set(options.locations ?? []),
        states: new Map<string, string>(),
        intrinsicPhysicalAttack: options.intrinsicPhysicalAttack,
        destroyed: options.destroyed,
        critSlots: options.critSlots,
    });
}

function turnState(airborne: boolean | null = null): TurnState {
    return { airborne: () => airborne, spotting: () => false } as unknown as TurnState;
}

function createRulesHarness(options: {
    crits?: CriticalSlot[];
    inventory?: MountedEquipment[];
    moveMode?: MotiveModes | null;
    type?: 'Tank' | 'VTOL' | 'Naval';
    walk?: number;
    walk2?: number;
    run?: number;
    run2?: number;
    crewStates?: CrewMemberState[];
    shutdown?: boolean;
    rulesId?: 'core2026' | 'tw';
    tons?: number;
    moveDistance?: number;
    selectedAmmo?: AmmoEquipment | null;
    gunnery?: number;
} = {}): VehicleRules {
    const baseUnit = createEmptyUnit({
        type: options.type ?? 'Tank',
        subtype: 'Combat Vehicle',
        walk: options.walk ?? 8,
        walk2: options.walk2 ?? options.walk ?? 8,
        run: options.run ?? 12,
        run2: options.run2 ?? options.run ?? 12,
        tons: options.tons ?? 40,
    });
    const crewStates = options.crewStates ?? ['healthy'];
    const crewMembers = crewStates.map(state => ({
        getState: () => state,
        getSkill: (skill: 'gunnery' | 'piloting') => skill === 'gunnery' ? options.gunnery ?? 4 : 5,
    }));
    let rules: VehicleRules;
    const unit = {
        gameRules: options.rulesId === 'tw' ? TW_GAME_RULES : CORE_2026_GAME_RULES,
        getCritSlots: () => options.crits ?? [],
        getInventory: () => options.inventory ?? [],
        getEquipmentRegistry: () => new EquipmentRegistry(Object.fromEntries((options.inventory ?? [])
            .flatMap(entry => entry.equipment ? [[entry.equipment.internalName, entry.equipment]] : []))),
        getInventoryControlSelectedAmmo: () => options.selectedAmmo ?? null,
        getInventoryControlRules: () => ({}),
        getUnit: () => baseUnit,
        getCondition: (state: string) => {
            if (state === 'shutdown') return options.shutdown ?? false;
            if (state === 'disconnected') return rules.hasComputedCondition('disconnected');
            return false;
        },
        getCrewMembers: () => crewMembers,
        getCrewMember: (id: number) => crewMembers[id],
        isEquipmentUnavailable: (source: MountedEquipment | CriticalSlot) => source instanceof MountedEquipment ? source.committedDestroyed() : !!source.destroyed,
        getRunMovementMultiplierBonus: (turnState: TurnState) => (options.inventory ?? [])
            .reduce((total, entry) => total + mascHandler.getRunMovementMultiplierBonus(entry, turnState), 0),
        pilotingSkill: () => 5,
        gunnerySkill: () => options.gunnery ?? 4,
        turnState: () => ({
            moveMode: () => options.moveMode ?? null,
            moveDistance: () => options.moveDistance ?? 0,
            spotting: () => false,
            getAttackMovementModifier: () => rules.getAttackMovementModifier(options.moveMode ?? null),
        }),
        locations: { internal: new Map() },
        destroyed: false,
        setDestroyed: jasmine.createSpy('setDestroyed'),
    } as unknown as CBTForceUnit;

    options.inventory?.forEach(entry => entry.owner = unit);
    rules = options.rulesId === 'tw' ? new TWVehicleRules(unit) : new VehicleRules(unit);
    return rules;
}

describe('VehicleRules', () => {
    it('provides vehicle attack movement modifiers through the rules system', () => {
        const rules = createRulesHarness();

        expect(rules.getAttackMovementModifier('stationary')).toBe(0);
        expect(rules.getAttackMovementModifier('walk')).toBe(1);
        expect(rules.getAttackMovementModifier('run')).toBe(2);
        expect(rules.getAttackMovementModifier('jump')).toBe(3);
    });

    it('applies a mounted targeting computer to eligible direct-fire weapons', () => {
        const directFire = new MountedWeapon({
            owner: undefined as unknown as CBTForceUnit,
            id: 'DirectFire',
            name: 'DirectFire',
            equipment: weapon('DirectFire', ['F_BALLISTIC', 'F_DIRECT_FIRE']),
        });
        const targetingComputer = entry({ equipment: equipment('TargetingComputer', ['F_TARGETING_COMPUTER']) });
        const activeRules = createRulesHarness({ inventory: [directFire, targetingComputer] });

        expect(activeRules.computeEntryState(directFire)).toEqual(jasmine.objectContaining({ hitMod: -1 }));

        const destroyedDirectFire = new MountedWeapon({
            owner: undefined as unknown as CBTForceUnit,
            id: 'DestroyedDirectFire',
            name: 'DestroyedDirectFire',
            equipment: weapon('DestroyedDirectFire', ['F_BALLISTIC', 'F_DIRECT_FIRE']),
        });
        const destroyedTargetingComputer = entry({
            equipment: equipment('DestroyedTargetingComputer', ['F_TARGETING_COMPUTER']),
            destroyed: true,
        });
        const destroyedRules = createRulesHarness({ inventory: [destroyedDirectFire, destroyedTargetingComputer] });

        expect(destroyedRules.computeEntryState(destroyedDirectFire)).toEqual(jasmine.objectContaining({
            hitMod: 0,
            hitModifierBreakdown: [{ label: 'DestroyedTargetingComputer Destroyed', modifier: 0, weakened: true }],
        }));
    });

    it('does not apply a targeting computer when selected ammo creates a cluster flak attack', () => {
        const autocannon = new WeaponEquipment({
            id: 'LBX',
            name: 'LBX',
            type: 'weapon',
            flags: ['F_BALLISTIC', 'F_DIRECT_FIRE'],
            weapon: { ammoType: 'AC_LBX', ranges: [1, 2, 3, 4] },
        });
        const flechetteAmmo = new AmmoEquipment({
            id: 'LBX Ammo',
            name: 'LBX Ammo',
            type: 'ammo',
            ammo: { type: 'AC_LBX', munitionType: ['M_CLUSTER'] },
        });
        const mountedAutocannon = new MountedWeapon({
            owner: undefined as unknown as CBTForceUnit,
            id: autocannon.id,
            name: autocannon.name,
            equipment: autocannon,
            ammo: flechetteAmmo.internalName,
        });
        const targetingComputer = entry({ equipment: equipment('TargetingComputer', ['F_TARGETING_COMPUTER']) });
        const rules = createRulesHarness({
            inventory: [mountedAutocannon, entry({ equipment: flechetteAmmo }), targetingComputer],
            selectedAmmo: flechetteAmmo
        });

        expect(rules.computeEntryState(mountedAutocannon)).toEqual(jasmine.objectContaining({ hitMod: 0 }));
    });

    it('excludes cluster and flak weapons from targeting computers except non-flak HAGs', () => {
        const targetingComputer = entry({ equipment: equipment('TargetingComputer', ['F_TARGETING_COMPUTER']) });
        const clusterWeapon = new MountedWeapon({
            owner: undefined as unknown as CBTForceUnit,
            id: 'ClusterWeapon',
            name: 'ClusterWeapon',
            equipment: new WeaponEquipment({
                id: 'ClusterWeapon',
                name: 'ClusterWeapon',
                type: 'weapon',
                flags: ['F_DIRECT_FIRE', 'F_BALLISTIC'],
                weapon: { ammoType: 'NA', damage: 'cluster', ranges: [1, 2, 3, 4] },
            }),
        });
        const flakWeapon = new MountedWeapon({
            owner: undefined as unknown as CBTForceUnit,
            id: 'FlakWeapon',
            name: 'FlakWeapon',
            equipment: new WeaponEquipment({
                id: 'FlakWeapon',
                name: 'FlakWeapon',
                type: 'weapon',
                flags: ['F_DIRECT_FIRE'],
                weapon: { ammoType: 'SBGAUSS', ranges: [1, 2, 3, 4] },
            }),
        });
        const hag = new MountedWeapon({
            owner: undefined as unknown as CBTForceUnit,
            id: 'HAG',
            name: 'HAG',
            equipment: weapon('HAG', ['F_DIRECT_FIRE', 'F_BALLISTIC', 'F_HAG']),
        });
        const rules = createRulesHarness({ inventory: [clusterWeapon, flakWeapon, hag, targetingComputer] });

        expect(rules.computeEntryState(clusterWeapon)).toEqual(jasmine.objectContaining({ hitMod: 0 }));
        expect(rules.computeEntryState(flakWeapon)).toEqual(jasmine.objectContaining({ hitMod: 0 }));
        expect(rules.computeEntryState(hag)).toEqual(jasmine.objectContaining({ hitMod: -1 }));
    });

    it('does not allow pulse weapons to make aimed shots against mobile targets', () => {
        const pulseWeapon = new MountedWeapon({
            owner: undefined as unknown as CBTForceUnit,
            id: 'PulseWeapon',
            name: 'PulseWeapon',
            equipment: weapon('PulseWeapon', ['F_DIRECT_FIRE', 'F_ENERGY', 'F_PULSE']),
        });
        const standardWeapon = new MountedWeapon({
            owner: undefined as unknown as CBTForceUnit,
            id: 'StandardWeapon',
            name: 'StandardWeapon',
            equipment: weapon('StandardWeapon', ['F_DIRECT_FIRE', 'F_ENERGY']),
        });
        const rules = createRulesHarness();

        expect(rules.canMakeTargetingComputerAimedShot(pulseWeapon, true)).toBeFalse();
        expect(rules.canMakeTargetingComputerAimedShot(pulseWeapon, false)).toBeTrue();
        expect(rules.canMakeTargetingComputerAimedShot(standardWeapon, true)).toBeTrue();
        expect(rules.canMakeTargetingComputerAimedShot(entry(), false)).toBeFalse();
    });

    it('applies ordered motive movement damage by timestamp', () => {
        const rules = createRulesHarness({
            crits: [
                crit('motive_system_hit_3', 10),
                crit('motive_system_hit_2', 20),
            ],
            walk: 8,
            run: 12,
        });

        expect(rules.movementState()).toEqual(jasmine.objectContaining({
            walk: 3,
            maxWalk: 3,
            run: 5,
            maxRun: 5,
            moveImpaired: true,
        }));
    });

    it('derives vehicle run MP from current walk MP', () => {
        const rules = createRulesHarness({
            walk: 8,
            run: 99,
            run2: 120,
        });

        expect(rules.movementState()).toEqual(jasmine.objectContaining({
            walk: 8,
            maxWalk: 8,
            run: 12,
            maxRun: 12,
            moveImpaired: false,
        }));
        expect(rules.getMaxDistanceForMoveMode('run')).toBe(12);
    });

    it('uses working Supercharger inventory to calculate max run MP', () => {
        const superchargerEntry = entry({ equipment: equipment('Supercharger', ['F_MASC', 'S_SUPERCHARGER']) });
        const rules = createRulesHarness({
            inventory: [superchargerEntry],
            walk: 8,
        });

        expect(rules.movementState()).toEqual(jasmine.objectContaining({
            walk: 8,
            run: 12,
            maxRun: 16,
            moveImpaired: false,
        }));
        expect(rules.getMaxDistanceForMoveMode('run')).toBe(16);
    });

    it('ignores destroyed vehicle boost equipment when calculating max run MP', () => {
        const destroyedSupercharger = entry({
            equipment: equipment('Supercharger', ['F_MASC', 'S_SUPERCHARGER']),
            critSlots: [crit('Supercharger', 10)],
        });
        const destroyedJetBooster = entry({
            equipment: equipment('ISVTOLJetBooster', ['F_MASC', 'F_JET_BOOSTER']),
            destroyed: true,
        });
        const rules = createRulesHarness({
            inventory: [destroyedSupercharger, destroyedJetBooster],
            walk: 8,
        });

        expect(rules.movementState()).toEqual(jasmine.objectContaining({
            run: 12,
            maxRun: 12,
            moveImpaired: false,
        }));
    });

    it('treats VTOL jet boosters as Supercharger-equivalent movement equipment', () => {
        const jetBooster = entry({ equipment: equipment('ISVTOLJetBooster', ['F_MASC', 'F_JET_BOOSTER']) });
        const rules = createRulesHarness({
            inventory: [jetBooster],
            type: 'VTOL',
            walk: 8,
        });

        expect(rules.movementState()).toEqual(jasmine.objectContaining({
            run: 12,
            maxRun: 16,
            moveImpaired: false,
        }));
    });

    it('uses active boost state for effective vehicle run MP without changing potential max run MP', () => {
        const jetBooster = entry({ equipment: equipment('ISVTOLJetBooster', ['F_MASC', 'F_JET_BOOSTER']) });
        const rules = createRulesHarness({
            inventory: [jetBooster],
            type: 'VTOL',
            walk: 8,
        });

        expect(rules.getMaxDistanceForMoveMode('run')).toBe(16);
        expect(rules.getEffectiveMaxDistanceForMoveMode('run', turnState(true))).toBe(12);

        jetBooster.setState(MASC_ACTIVE_STATE_KEY, 'true');

        expect(rules.getMaxDistanceForMoveMode('run')).toBe(16);
        expect(rules.getEffectiveMaxDistanceForMoveMode('run', turnState(true))).toBe(16);
    });

    it('requires airborne state for active VTOL Jet Booster effective run MP', () => {
        const jetBooster = entry({ equipment: equipment('ISVTOLJetBooster', ['F_MASC', 'F_JET_BOOSTER']) });
        jetBooster.setState(MASC_ACTIVE_STATE_KEY, 'true');
        const rules = createRulesHarness({
            inventory: [jetBooster],
            type: 'VTOL',
            walk: 8,
        });

        expect(rules.getEffectiveMaxDistanceForMoveMode('run', turnState(false))).toBe(12);
        expect(rules.getEffectiveMaxDistanceForMoveMode('run', turnState(true))).toBe(16);
    });

    it('keeps active destroyed VTOL Jet Booster effective run MP for the current turn', () => {
        const jetBooster = entry({
            equipment: equipment('ISVTOLJetBooster', ['F_MASC', 'F_JET_BOOSTER']),
            destroyed: true,
        });
        jetBooster.setState(MASC_ACTIVE_STATE_KEY, 'true');
        const rules = createRulesHarness({
            inventory: [jetBooster],
            type: 'VTOL',
            walk: 8,
        });

        expect(rules.getMaxDistanceForMoveMode('run')).toBe(12);
        expect(rules.getEffectiveMaxDistanceForMoveMode('run', turnState(true))).toBe(16);
    });

    it('disables run movement after a flight stabilizer hit', () => {
        const superchargerEntry = entry({ equipment: equipment('Supercharger', ['F_MASC', 'S_SUPERCHARGER']) });
        const rules = createRulesHarness({
            crits: [crit('flight_stabilizer_hit', 10)],
            inventory: [superchargerEntry],
            walk: 8,
        });

        expect(rules.movementState()).toEqual(jasmine.objectContaining({
            walk: 8,
            run: 0,
            maxRun: 0,
            moveImpaired: true,
        }));
        expect(rules.isMotiveModeAvailable('run')).toBeFalse();
    });

    it('marks vehicles abandoned and immobile when the crew is killed', () => {
        const rules = createRulesHarness({ crewStates: ['killed'], walk: 8 });

        expect(rules.hasComputedCondition('abandoned')).toBeTrue();
        expect(rules.hasComputedCondition('immobile')).toBeTrue();
        expect(rules.movementState()).toEqual(jasmine.objectContaining({
            walk: 0,
            maxWalk: 0,
            run: 0,
            maxRun: 0,
            moveImpaired: true,
        }));
        expect(rules.isMotiveModeAvailable('walk')).toBeFalse();
        expect(rules.isMotiveModeAvailable('run')).toBeFalse();
    });

    it('disables run movement while the vehicle crew is stunned', () => {
        const rules = createRulesHarness({ crewStates: ['stunned'], walk: 8 });

        expect(rules.hasComputedCondition('abandoned')).toBeFalse();
        expect(rules.hasComputedCondition('immobile')).toBeFalse();
        expect(rules.movementState()).toEqual(jasmine.objectContaining({
            walk: 8,
            maxWalk: 8,
            run: 0,
            maxRun: 0,
            moveImpaired: true,
        }));
        expect(rules.isMotiveModeAvailable('walk')).toBeTrue();
        expect(rules.isMotiveModeAvailable('run')).toBeFalse();
    });

    it('uses motive timestamp order for different final MP values', () => {
        const rules = createRulesHarness({
            crits: [
                crit('motive_system_hit_2', 10),
                crit('motive_system_hit_3', 20),
            ],
            walk: 8,
        });

        expect(rules.movementState().walk).toBe(4);
    });

    it('marks vehicles immobile after a disabling motive system hit', () => {
        const rules = createRulesHarness({
            crits: [crit('motive_system_hit_4', 10)],
            walk: 8,
        });

        expect(rules.hasComputedCondition('immobile')).toBeTrue();
        expect(rules.movementState()).toEqual(jasmine.objectContaining({ walk: 0, run: 0, moveImpaired: true }));
    });

    it('applies repeatable motive damage chronologically but counts each piloting level once', () => {
        const physicalEntry = entry({ intrinsicPhysicalAttack: true });
        const rules = createRulesHarness({
            crits: [
                { id: 'motive_system_hit_2', hits: 2, hitTimestamps: [10, 30] },
                { id: 'motive_system_hit_3', hits: 1, hitTimestamps: [20] },
            ],
            inventory: [physicalEntry],
            walk: 8,
            run: 12,
        });

        expect(rules.movementState()).toEqual(jasmine.objectContaining({
            walk: 3,
            maxWalk: 3,
            run: 5,
            maxRun: 5,
            moveImpaired: true,
        }));
        expect(rules.PSRModifiers().modifiers.filter(modifier => modifier.reason === 'Motive system hit')).toEqual([
            { pilotCheck: 2, reason: 'Motive system hit' },
            { pilotCheck: 3, reason: 'Motive system hit' },
        ]);
    });

    it('reduces VTOL walk MP by one for each committed rotor hit', () => {
        const rules = createRulesHarness({
            crits: [{ id: 'rotor', hits: 3, pendingHits: 2 }],
            type: 'VTOL',
            walk: 8,
            run: 12,
        });

        expect(rules.movementState()).toEqual(jasmine.objectContaining({
            walk: 5,
            maxWalk: 5,
            run: 8,
            maxRun: 8,
            moveImpaired: true,
        }));
    });

    it('sets vehicle MP to zero after an engine hit', () => {
        const rules = createRulesHarness({
            crits: [crit('engine_hit_1', 10)],
            walk: 8,
            run: 12,
        });

        expect(rules.movementState()).toEqual(jasmine.objectContaining({ walk: 0, run: 0, moveImpaired: true }));
    });

    it('derives gunnery and piloting modifiers from vehicle crits', () => {
        const weaponEntry = entry({ equipment: weapon('AC/5') });
        const physicalEntry = entry({ intrinsicPhysicalAttack: true });
        const rules = createRulesHarness({
            crits: [
                crit('commander_hit', 10),
                crit('copilot_hit', 15),
                crit('driver_hit', 20),
                crit('sensor_hit_3', 30),
                crit('flight_stabilizer_hit', 40),
                crit('motive_system_hit_2', 50),
            ],
            inventory: [weaponEntry, physicalEntry],
            gunnery: 4,
        });

        expect(rules.PSRModifiers().modifier).toBe(8);
        const expectedRangedModifiers = [
            { label: 'Commander hit', modifier: 1, weakened: true },
            { label: 'Co-pilot hit', modifier: 1, weakened: true },
            { label: 'Flight stabilizer hit', modifier: 1, weakened: true },
            { label: 'Sensor hits', modifier: 3, weakened: true },
        ];
        expect(rules.getBaseGunnerySkill()).toBe(4);
        const weaponState = rules.computeEntryState(weaponEntry);
        expect(weaponState.hitMod).toBe(6);
        expect(weaponState.hitModifierBreakdown).toEqual(expectedRangedModifiers);
        expect(rules.getBaseGunnerySkill() + weaponState.hitMod).toBe(10);
        expect(rules.computeEntryState(physicalEntry)).toEqual(jasmine.objectContaining({
            hitMod: 1,
            hitModifierBreakdown: [
                { label: 'Commander hit', modifier: 1, weakened: true },
            ],
        }));
    });

    it('makes drone vehicles Immobile after a commander hit disconnects them', () => {
        const weaponEntry = entry({ equipment: weapon('AC/5') });
        const physicalEntry = entry({ intrinsicPhysicalAttack: true });
        const rules = createRulesHarness({
            crits: [
                crit('commander_hit', 10),
                crit('copilot_hit', 15),
                crit('driver_hit', 20),
                crit('pilot_hit', 25),
            ],
            inventory: [
                weaponEntry,
                physicalEntry,
                entry({ equipment: equipment('ISDroneOperatingSystem', ['F_DRONE_OPERATING_SYSTEM']) }),
            ],
        });

        expect(rules.hasComputedCondition('disconnected')).toBeTrue();
        expect(rules.hasComputedCondition('immobile')).toBeTrue();
        expect(rules.movementState()).toEqual(jasmine.objectContaining({ walk: 0, run: 0, moveImpaired: true }));
        expect(rules.computeEntryState(weaponEntry)).toEqual(jasmine.objectContaining({
            hitMod: 0,
            hitModifierBreakdown: [],
        }));
        expect(rules.computeEntryState(physicalEntry)).toEqual(jasmine.objectContaining({
            hitMod: 0,
            hitModifierBreakdown: [],
        }));
        expect(rules.PSRModifiers().modifier).toBe(0);
    });

    it('makes disconnected drone vehicles Immobile under every rules system', () => {
        const rules = createRulesHarness({
            inventory: [entry({ equipment: equipment('ISDroneOperatingSystem', ['F_DRONE_OPERATING_SYSTEM']), destroyed: true })],
        });

        expect(rules.hasComputedCondition('disconnected')).toBeTrue();
        expect(rules.hasComputedCondition('immobile')).toBeTrue();
        expect(rules.movementState()).toEqual(jasmine.objectContaining({ walk: 0, run: 0, moveImpaired: true }));

        const twRules = createRulesHarness({
            inventory: [entry({ equipment: equipment('ISDroneOperatingSystem', ['F_DRONE_OPERATING_SYSTEM']), destroyed: true })],
            rulesId: 'tw',
        });
        expect(twRules.hasComputedCondition('immobile')).toBeTrue();
    });

    it('disables energy equipment after an engine hit', () => {
        const energyEntry = entry({ equipment: weapon('Medium Laser', ['F_ENERGY']) });
        const ballisticEntry = entry({ equipment: weapon('AC/5', ['F_BALLISTIC']) });
        const rules = createRulesHarness({
            crits: [crit('engine_hit_1', 10)],
            inventory: [energyEntry, ballisticEntry],
        });

        expect(rules.computeEntryState(energyEntry).isDisabled).toBeTrue();
        expect(rules.computeEntryState(ballisticEntry).isDisabled).toBeFalse();
    });

    it('disables non-physical weapons at Sensor hits level four', () => {
        const weaponEntry = entry({ equipment: weapon('AC/5') });
        const chargeEntry = entry({ id: 'Charge', intrinsicPhysicalAttack: true });
        const rules = createRulesHarness({
            crits: [crit('sensor_hit_4', 10)],
            inventory: [weaponEntry, chargeEntry],
        });

        expect(rules.computeEntryState(weaponEntry).isDisabled).toBeTrue();
        expect(rules.computeEntryState(chargeEntry).isDisabled).toBeFalse();
    });

    it('calculates charge damage for core2026 vehicles and preserves TW sheet damage', () => {
        const rules = createRulesHarness({ tons: 60, moveDistance: 5 });
        expect(rules.chargeDamage()).toEqual({
            damage: 36,
            maxDamage: 60,
            bonusDamage: 0,
            maxBonusDamage: 0,
        });

        const twRules = createRulesHarness({ tons: 60, moveDistance: 5, rulesId: 'tw' });
        expect(twRules.chargeDamage()).toEqual({
            damage: null,
            maxDamage: null,
            bonusDamage: 0,
            maxBonusDamage: 0,
        });
    });

    it('adds the movement hit modifier again for weapons in damaged stabilizer locations', () => {
        const frontWeapon = entry({ equipment: weapon('Front Weapon'), locations: ['FR'] });
        const rearWeapon = entry({ equipment: weapon('Rear Weapon'), locations: ['RR'] });
        const frontRightWeapon = entry({ equipment: weapon('Front Right Weapon'), locations: ['FRRS'] });
        const rules = createRulesHarness({
            crits: [crit('stabilizer_hit_front', 10), crit('stabilizer_hit_right', 20)],
            inventory: [frontWeapon, rearWeapon, frontRightWeapon],
            moveMode: 'run',
        });

        expect(rules.computeEntryState(frontWeapon).hitMod).toBe(2);
        expect(rules.computeEntryState(rearWeapon).hitMod).toBe(0);
        expect(rules.computeEntryState(frontRightWeapon).hitMod).toBe(2);
    });

    it('reports stabilizer-affected weapons before movement mode is selected', () => {
        const frontRightWeapon = entry({ equipment: weapon('Front Right Weapon'), locations: ['FRRS'] });
        const rearWeapon = entry({ equipment: weapon('Rear Weapon'), locations: ['RR'] });
        const rules = createRulesHarness({
            crits: [crit('stabilizer_hit_front', 10)],
            inventory: [frontRightWeapon, rearWeapon],
            moveMode: null,
        });

        expect(rules.computeEntryState(frontRightWeapon).hitMod).toBe(0);
        expect(rules.computeEntryState(frontRightWeapon).hitModifierBreakdown).toContain(jasmine.objectContaining({
            label: 'Stabilizer Hit', modifier: 0, weakened: true,
        }));
        expect(rules.computeEntryState(rearWeapon).hitModifierBreakdown).not.toContain(jasmine.objectContaining({
            label: 'Stabilizer Hit',
        }));
    });
});
