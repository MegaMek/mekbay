import type { CBTForceUnit } from '../cbt-force-unit.model';
import type { CriticalSlot, MountedEquipment } from '../force-serialization';
import type { MotiveModes } from '../motiveModes.model';
import { WeaponEquipment } from '../equipment.model';
import { createEmptyUnit } from '../../testing/unit-test-helpers';
import { VehicleRules } from './vehicle-rules';

function crit(id: string, destroyed: number): CriticalSlot {
    return { id, destroyed, destroying: destroyed };
}

function weapon(id: string, flags: string[] = []): WeaponEquipment {
    return new WeaponEquipment({
        id,
        name: id,
        type: 'weapon',
        flags,
        weapon: { ranges: [1, 2, 3, 4] }
    });
}

function entry(options: {
    id?: string;
    equipment?: WeaponEquipment;
    locations?: string[];
    physical?: boolean;
} = {}): MountedEquipment {
    return {
        id: options.id ?? options.equipment?.id ?? 'entry',
        name: options.id ?? options.equipment?.name ?? 'entry',
        equipment: options.equipment,
        locations: new Set(options.locations ?? []),
        states: new Map<string, string>(),
        physical: options.physical,
    } as unknown as MountedEquipment;
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
} = {}): VehicleRules {
    const baseUnit = createEmptyUnit({
        type: options.type ?? 'Tank',
        subtype: 'Combat Vehicle',
        walk: options.walk ?? 8,
        walk2: options.walk2 ?? options.walk ?? 8,
        run: options.run ?? 12,
        run2: options.run2 ?? options.run ?? 12,
    });
    let rules: VehicleRules;
    const unit = {
        getCritSlots: () => options.crits ?? [],
        getInventory: () => options.inventory ?? [],
        getUnit: () => baseUnit,
        pilotingSkill: () => 5,
        turnState: () => ({
            moveMode: () => options.moveMode ?? null,
            getAttackMovementModifier: () => rules.getAttackMovementModifier(options.moveMode ?? null),
        }),
        locations: { internal: new Map() },
        destroyed: false,
        setDestroyed: jasmine.createSpy('setDestroyed'),
    } as unknown as CBTForceUnit;

    rules = new VehicleRules(unit);
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
            maxWalk: 8,
            run: 5,
            maxRun: 12,
            moveImpaired: true,
        }));
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

    it('reduces VTOL walk MP by one for each committed rotor hit', () => {
        const rules = createRulesHarness({
            crits: [{ id: 'rotor', hits: 3, pendingHits: 2 }],
            type: 'VTOL',
            walk: 8,
            run: 12,
        });

        expect(rules.movementState()).toEqual(jasmine.objectContaining({
            walk: 5,
            maxWalk: 8,
            run: 12,
            maxRun: 12,
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
        const rules = createRulesHarness({
            crits: [
                crit('commander_hit', 10),
                crit('copilot_hit', 15),
                crit('driver_hit', 20),
                crit('sensor_hit_3', 30),
                crit('flight_stabilizer_hit', 40),
                crit('motive_system_hit_2', 50),
            ],
        });

        expect(rules.gunneryModifier()).toBe(6);
        expect(rules.pilotingModifier()).toBe(8);
        expect(rules.PSRModifiers().modifier).toBe(8);
        expect(rules.gunneryModifiers()).toEqual([
            { modifier: 1, reason: 'Commander hit' },
            { modifier: 1, reason: 'Co-Pilot hit' },
            { modifier: 3, reason: 'Sensor hit 3' },
            { modifier: 1, reason: 'Flight stabilizer hit' },
        ]);
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

    it('disables non-physical weapons at sensor hit level four', () => {
        const weaponEntry = entry({ equipment: weapon('AC/5') });
        const chargeEntry = entry({ id: 'Charge', physical: true });
        const rules = createRulesHarness({
            crits: [crit('sensor_hit_4', 10)],
            inventory: [weaponEntry, chargeEntry],
        });

        expect(rules.computeEntryState(weaponEntry).isDisabled).toBeTrue();
        expect(rules.computeEntryState(chargeEntry).isDisabled).toBeFalse();
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
        expect(rules.hasDamagedStabilizerAffectingEntry(frontRightWeapon)).toBeTrue();
        expect(rules.hasDamagedStabilizerAffectingEntry(rearWeapon)).toBeFalse();
    });
});
