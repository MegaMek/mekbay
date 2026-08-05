import { Injector } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { CBTForce } from '../cbt-force.model';
import { CBTForceUnit } from '../cbt-force-unit.model';
import { DEAD_CREW_HIT_THRESHOLD, type CrewMemberState } from '../crew-member.model';
import { MountedEquipment, MountedWeapon } from '../mounted-equipment.model';
import { type CriticalSlot, type LocationData } from '../force-serialization';
import { AmmoEquipment, Equipment, WeaponEquipment, type AmmoType } from '../equipment.model';
import { EquipmentRegistry } from '../equipment-lookup';
import type { Unit, UnitSubtype } from '../units.model';
import { DataService } from '../../services/data.service';
import { EquipmentInteractionRegistryService } from '../../services/equipment-interaction-registry.service';
import { UnitInitializerService } from '../../services/unit-initializer.service';
import { createEmptyUnit } from '../../testing/unit-test-helpers';
import { MekRules } from './mek-rules';
import { MascHandler, MASC_ACTIVE_STATE_KEY } from '../../equipment-handlers/masc.handler';
import { HAG_FLAK_MODE, HAG_STANDARD_MODE, HagHandler } from '../../equipment-handlers/hag.handler';
import { INVENTORY_CONTROL_MODE_STATE } from '../../utils/inventory-control.util';
import { OptionsService } from '../../services/options.service';
import { TWMekRules } from './tw-rules';
import { VIBROBLADE_MODE_STATE, VIBROBLADE_ON_MODE, VibrobladeHandler } from '../../equipment-handlers/vibroblade.handler';
import { EquipmentFlag } from '../equipment-flags.type';

class TestCBTForce extends CBTForce {
    override emitChanged(): void {
    }
}

let dataService: jasmine.SpyObj<DataService>;
let unitInitializer: UnitInitializerService;
let injector: Injector;
let optionsService: OptionsService;

function createRulesHarness(options: {
    crewStates?: Exclude<CrewMemberState, 'dead'>[];
    crewHits?: number[];
    critSlots?: CriticalSlot[];
    committedDestroyedLocations?: string[];
    locationState?: Record<string, LocationData>;
    internalLocations?: string[];
    locationPoints?: number;
    shutdown?: boolean;
    walk?: number;
    run?: number;
    jump?: number;
    umu?: number;
    tons?: number;
    engine?: string;
    subtype?: UnitSubtype;
    rulesId?: 'core2026' | 'tw';
    forcedWithdrawal?: boolean;
} = {}): MekRules {
    return createForceUnitHarness(options).rules as MekRules;
}

function createCommittedLocationState(committedDestroyedLocations: string[] = []): Record<string, LocationData> {
    return committedDestroyedLocations.reduce<Record<string, LocationData>>((state, loc) => {
        state[loc] = { internal: 1 };
        return state;
    }, {});
}

function createForceUnitHarness(options: {
    crewStates?: Exclude<CrewMemberState, 'dead'>[];
    crewHits?: number[];
    critSlots?: CriticalSlot[];
    committedDestroyedLocations?: string[];
    locationState?: Record<string, LocationData>;
    internalLocations?: string[];
    locationPoints?: number;
    shutdown?: boolean;
    walk?: number;
    run?: number;
    jump?: number;
    umu?: number;
    tons?: number;
    engine?: string;
    subtype?: UnitSubtype;
    rulesId?: 'core2026' | 'tw';
    forcedWithdrawal?: boolean;
} = {}): CBTForceUnit {
    optionsService.options.update(current => ({
        ...current,
        CBTRules: options.rulesId ?? 'core2026',
        CBTOptionalRules: {
            ...current.CBTOptionalRules,
            forcedWithdrawal: options.forcedWithdrawal ?? true,
        },
    }));
    const crewStates = options.crewStates ?? ['healthy'];
    const crewHits = options.crewHits ?? [];
    const baseUnit = createEmptyUnit({
        type: 'Mek',
        subtype: options.subtype ?? 'BattleMek',
        crewSize: Math.max(crewStates.length, crewHits.length),
        walk: options.walk ?? 5,
        run: options.run ?? 8,
        jump: options.jump ?? 4,
        umu: options.umu ?? 2,
        tons: options.tons ?? 50,
        engine: options.engine ?? 'Fusion',
    });

    dataService.getUnitByName.and.callFake((name: string): Unit | undefined => name === baseUnit.name ? baseUnit : undefined);
    const force = new TestCBTForce('Test Force', dataService, unitInitializer, injector);
    const forceUnit = new CBTForceUnit(baseUnit, force, dataService, unitInitializer, injector);
    const internalLocations = options.internalLocations ?? ['LL', 'RL'];
    const locationPoints = options.locationPoints ?? 1;
    forceUnit.locations = {
        internal: new Map(internalLocations.map(loc => [loc, { loc, points: locationPoints }])),
        armor: new Map(internalLocations.map(loc => [loc, { loc, rear: false, points: locationPoints }])),
    };

    forceUnit.setLocations(options.locationState ?? createCommittedLocationState(options.committedDestroyedLocations), true);
    if (options.critSlots) {
        forceUnit.writeCrits(options.critSlots);
    }
    crewStates.forEach((state, index) => forceUnit.getCrewMember(index).setState(state));
    crewHits.forEach((hits, index) => forceUnit.getCrewMember(index).setHits(hits));
    if (options.shutdown) {
        forceUnit.setCondition('shutdown', true);
    }
    forceUnit.isLoaded.set(true);
    forceUnit.reconcileRuleChecks();

    return forceUnit;
}

function crit(name: string, destroyed = true): CriticalSlot {
    return {
        id: name.toLocaleLowerCase().replace(/\s+/g, '_'),
        name,
        destroyed: destroyed ? 1 : undefined,
    };
}

type ArmActuatorState = 'functional' | 'destroyed' | 'missing';

function armCritSlots(
    loc: 'LA' | 'RA',
    options: { hand?: ArmActuatorState; lowerArm?: ArmActuatorState } = {}
): CriticalSlot[] {
    const slots: CriticalSlot[] = [
        { ...crit('Shoulder', false), id: `${loc}-shoulder`, loc, slot: 0 },
        { ...crit('Upper Arm Actuator', false), id: `${loc}-upper-arm`, loc, slot: 1 },
    ];
    const addOptionalActuator = (name: string, slot: number, state: ArmActuatorState) => {
        if (state === 'missing') return;
        slots.push({ ...crit(name, state === 'destroyed'), id: `${loc}-${name.toLowerCase().replace(/\s+/g, '-')}`, loc, slot });
    };
    addOptionalActuator('Lower Arm Actuator', 2, options.lowerArm ?? 'functional');
    addOptionalActuator('Hand Actuator', 3, options.hand ?? 'functional');
    return slots;
}

function punchEntry(forceUnit: CBTForceUnit, loc: 'LA' | 'RA' = 'LA'): MountedEquipment {
    return new MountedEquipment({
        owner: forceUnit,
        id: `punch@${loc}`,
        name: 'punch',
        locations: new Set([loc]),
        intrinsicPhysicalAttack: true,
    });
}

function heavyDutyGyroCrit(index: number, destroyed = true): CriticalSlot {
    return {
        ...crit('Heavy-Duty Gyro', destroyed),
        id: `heavy-duty-gyro-${index}`,
        loc: 'CT',
        slot: index,
    };
}

function legActuatorCrit(id: string, name: string, loc: string, destroyed = true): CriticalSlot {
    return {
        id,
        name,
        loc,
        slot: 0,
        destroyed: destroyed ? 1 : undefined,
    };
}

function weapon(id: string, damage: string | number | number[], ranges: number[], ammoType: 'NA' | 'AC' = 'NA', rackSize = 0): WeaponEquipment {
    return new WeaponEquipment({
        id,
        name: id,
        type: 'weapon',
        weapon: { damage, ranges, ammoType, rackSize },
    });
}

function ammo(id: string, ammoType: 'AC', rackSize: number, shots: number): AmmoEquipment {
    return new AmmoEquipment({
        id,
        name: id,
        type: 'ammo',
        ammo: { type: ammoType, rackSize, shots },
    });
}

function droneOperatingSystem(): Equipment {
    return new Equipment({
        id: 'ISDroneOperatingSystem',
        name: 'Drone (Remote) Operating System',
        type: 'misc',
        flags: ['F_DRONE_OPERATING_SYSTEM'],
    });
}

function droneOperatingSystemEntry(forceUnit: CBTForceUnit, destroyed = false): MountedEquipment {
    return new MountedEquipment({
        owner: forceUnit,
        id: 'ISDroneOperatingSystem@HD#0',
        name: 'Drone (Remote) Operating System',
        equipment: droneOperatingSystem(),
        locations: new Set(['HD']),
        destroyed,
    });
}

function miscEquipment(id: string, name: string, flags: EquipmentFlag[]): Equipment {
    return new Equipment({
        id,
        name,
        type: 'misc',
        flags,
    });
}

function miscEntry(forceUnit: CBTForceUnit, equipment: Equipment): MountedEquipment {
    return new MountedEquipment({
        owner: forceUnit,
        id: equipment.id,
        name: equipment.name,
        equipment,
    });
}

function directFireWeaponEntry(forceUnit: CBTForceUnit, flags: EquipmentFlag[] = []): MountedEquipment {
    const equipment = new WeaponEquipment({
        id: 'DirectFireWeapon',
        name: 'Direct Fire Weapon',
        type: 'weapon',
        flags: ['F_DIRECT_FIRE', 'F_ENERGY', ...flags],
        weapon: { damage: 10, ranges: [5, 10, 15, 20], ammoType: 'NA' },
    });
    const weapon = new MountedWeapon({
        owner: forceUnit,
        id: equipment.id,
        name: equipment.name,
        equipment,
    });
    return new MountedEquipment({
        owner: forceUnit,
        id: `${equipment.id}-critical`,
        name: equipment.name,
        equipment,
        parent: weapon,
    });
}

function mediumVspLaserEntry(forceUnit: CBTForceUnit): MountedEquipment {
    const equipment = new WeaponEquipment({
        id: 'ISMediumVSPLaser',
        name: 'Medium VSP Laser',
        type: 'weapon',
        flags: ['F_DIRECT_FIRE', 'F_ENERGY', 'F_LASER', 'F_PULSE', 'F_VSP'],
        stats: { toHitModifier: [-3, -2, -1] },
        weapon: { damage: [9, 7, 5], ranges: [2, 5, 9, 13], ammoType: 'NA' },
    });
    const weapon = new MountedWeapon({
        owner: forceUnit,
        id: equipment.id,
        name: equipment.name,
        equipment,
    });
    return new MountedEquipment({
        owner: forceUnit,
        id: `${equipment.id}-critical`,
        name: equipment.name,
        equipment,
        parent: weapon,
    });
}

function hagWeaponEntry(forceUnit: CBTForceUnit, mode: string): MountedWeapon {
    const equipment = new WeaponEquipment({
        id: 'CLHAG20',
        name: 'HAG/20',
        type: 'weapon',
        flags: ['F_HAG', 'F_BALLISTIC', 'F_DIRECT_FIRE'],
        stats: {
            explosive: true
        },
        weapon: {
            ammoType: 'HAG',
            damage: 'cluster',
            rackSize: 20,
            ranges: [8, 16, 24, 32]
        }
    });
    return new MountedWeapon({
        owner: forceUnit,
        id: equipment.id,
        name: equipment.name,
        equipment,
        states: new Map([[INVENTORY_CONTROL_MODE_STATE, mode]])
    });
}

function criticalAutocannonEntry(
    forceUnit: CBTForceUnit,
    ammoType: AmmoType,
    critSlots: CriticalSlot[],
    flags: EquipmentFlag[] = ['F_AC', 'F_BALLISTIC', 'F_DIRECT_FIRE'],
): MountedEquipment {
    const equipment = new WeaponEquipment({
        id: `Autocannon-${ammoType}`,
        name: `Autocannon ${ammoType}`,
        type: 'weapon',
        flags,
        weapon: { damage: 10, ranges: [5, 10, 15, 20], ammoType },
    });
    return new MountedEquipment({
        owner: forceUnit,
        id: equipment.id,
        name: equipment.name,
        equipment,
        locations: new Set(['RA']),
        critSlots,
    });
}

describe('MekRules', () => {
    beforeEach(() => {
        dataService = jasmine.createSpyObj<DataService>('DataService', ['getEquipmentRegistry', 'findEquipment', 'getUnitByName']);
        dataService.getEquipmentRegistry.and.returnValue(new EquipmentRegistry({}));
        dataService.findEquipment.and.returnValue(undefined);
        TestBed.configureTestingModule({
            providers: [
                UnitInitializerService,
                { provide: DataService, useValue: dataService },
            ],
        });

        unitInitializer = TestBed.inject(UnitInitializerService);
        injector = TestBed.inject(Injector);
        optionsService = TestBed.inject(OptionsService);
        optionsService.options.update(options => ({ ...options, CBTRules: 'core2026' }));
        const registry = TestBed.inject(EquipmentInteractionRegistryService).getRegistry();
        registry.register(new MascHandler());
        registry.register(new HagHandler());
        registry.register(new VibrobladeHandler());
    });

    it('keeps Mek immobile false by default when crew are functional', () => {
        const rules = createRulesHarness();

        expect(rules.hasComputedCondition('immobile')).toBeFalse();
        expect(rules.hasComputedCondition('abandoned')).toBeFalse();
    });

    it('applies a functional targeting computer only to eligible direct-fire weapons', () => {
        const activeForceUnit = createForceUnitHarness({ critSlots: [crit('Targeting Computer', false)] });
        const destroyedForceUnit = createForceUnitHarness({ critSlots: [crit('Targeting Computer')] });

        expect(activeForceUnit.rules.computeEntryState(directFireWeaponEntry(activeForceUnit))).toEqual(jasmine.objectContaining({ hitMod: -1, isDamaged: false, weakenedHitMod: false }));
        expect(destroyedForceUnit.rules.computeEntryState(directFireWeaponEntry(destroyedForceUnit))).toEqual(jasmine.objectContaining({ hitMod: 0, isDamaged: false, weakenedHitMod: true }));
        expect(destroyedForceUnit.rules.computeEntryState(directFireWeaponEntry(destroyedForceUnit, ['F_TASER']))).toEqual(jasmine.objectContaining({ hitMod: 0, isDamaged: false, weakenedHitMod: false }));
    });

    it('stacks a targeting computer with each range-specific VSP laser modifier', () => {
        const activeForceUnit = createForceUnitHarness({ critSlots: [crit('Targeting Computer', false)] });
        const destroyedForceUnit = createForceUnitHarness({ critSlots: [crit('Targeting Computer')] });
        const ranges = [
            { range: 'short' as const, value: -4 },
            { range: 'medium' as const, value: -3 },
            { range: 'long' as const, value: -2 },
        ];

        const activeEntry = mediumVspLaserEntry(activeForceUnit);
        const activeState = activeForceUnit.rules.computeEntryState(activeEntry);
        expect(activeEntry.parent).toBeInstanceOf(MountedWeapon);
        expect((activeEntry.parent as MountedWeapon).getWeaponTypes()).toContain('P');
        expect(activeState).toEqual(jasmine.objectContaining({ hitMod: -1, weakenedHitMod: false }));
        for (const expected of ranges) {
            expect(activeForceUnit.gameRules.resolveToHit({
                subject: activeEntry,
                range: expected.range,
                stateModifier: activeState.hitMod,
                stateWeakened: activeState.weakenedHitMod,
            }).value).withContext(`functional targeting computer at ${expected.range} range`).toBe(expected.value);
        }

        const destroyedEntry = mediumVspLaserEntry(destroyedForceUnit);
        const destroyedState = destroyedForceUnit.rules.computeEntryState(destroyedEntry);
        expect(destroyedState).toEqual(jasmine.objectContaining({ hitMod: 0, weakenedHitMod: true }));
        const destroyedResolution = destroyedForceUnit.gameRules.resolveToHit({
            subject: destroyedEntry,
            range: 'short',
            stateModifier: destroyedState.hitMod,
            stateWeakened: destroyedState.weakenedHitMod,
        });
        expect(destroyedResolution.value).toBe(-3);
        expect(destroyedResolution.weakened).toBeTrue();
    });

    it('applies HAG mode and targeting-computer modifiers without stacking them', () => {
        const scenarios = [
            { label: 'STD without targeting computer', mode: HAG_STANDARD_MODE, targetingComputer: 'none', hitMod: 0, weakened: false, types: ['C', 'DB', 'X'] },
            { label: 'FLAK without targeting computer', mode: HAG_FLAK_MODE, targetingComputer: 'none', hitMod: -1, weakened: false, types: ['C', 'X', 'F'] },
            { label: 'STD with targeting computer', mode: HAG_STANDARD_MODE, targetingComputer: 'functional', hitMod: -1, weakened: false, types: ['C', 'DB', 'X'] },
            { label: 'FLAK with targeting computer', mode: HAG_FLAK_MODE, targetingComputer: 'functional', hitMod: -1, weakened: false, types: ['C', 'X', 'F'] },
            { label: 'STD with broken targeting computer', mode: HAG_STANDARD_MODE, targetingComputer: 'broken', hitMod: 0, weakened: true, types: ['C', 'DB', 'X'] },
            { label: 'FLAK with broken targeting computer', mode: HAG_FLAK_MODE, targetingComputer: 'broken', hitMod: -1, weakened: false, types: ['C', 'X', 'F'] },
        ] as const;

        for (const scenario of scenarios) {
            const critSlots = scenario.targetingComputer === 'none'
                ? []
                : [crit('Targeting Computer', scenario.targetingComputer === 'broken')];
            const forceUnit = createForceUnitHarness({ critSlots });
            const entry = hagWeaponEntry(forceUnit, scenario.mode);
            const rules = forceUnit.getInventoryControlRules();
            const state = forceUnit.rules.computeEntryState(entry);
            const effectiveTypes = rules.applyWeaponTypes?.(entry, new Set(entry.getWeaponTypes())) ?? new Set(entry.getWeaponTypes());
            const resolution = forceUnit.gameRules.resolveToHit({
                subject: entry,
                stateModifier: state.hitMod,
                stateWeakened: state.weakenedHitMod,
                adjustments: rules.resolveToHitAdjustments?.(entry)
            });

            expect([...effectiveTypes]).withContext(`${scenario.label} weapon types`).toEqual(scenario.types);
            expect(resolution.value).withContext(`${scenario.label} modifier`).toBe(scenario.hitMod);
            expect(resolution.weakened).withContext(`${scenario.label} weakened state`).toBe(scenario.weakened);
        }
    });

    it('marks intrinsic and weapon hit modifiers as weakened when their arm AES is destroyed', () => {
        const activeForceUnit = createForceUnitHarness({
            critSlots: [{ ...crit('AES', false), loc: 'LA' }],
            internalLocations: ['LA', 'RA'],
        });
        const destroyedForceUnit = createForceUnitHarness({
            critSlots: [{ ...crit('AES'), loc: 'LA' }],
            internalLocations: ['LA', 'RA'],
        });
        const punch = (forceUnit: CBTForceUnit) => new MountedEquipment({
            owner: forceUnit,
            id: 'punch@LA',
            name: 'punch',
            locations: new Set(['LA']),
            intrinsicPhysicalAttack: true,
        });
        const sword = (forceUnit: CBTForceUnit) => new MountedEquipment({
            owner: forceUnit,
            id: 'sword@LA',
            name: 'Sword',
            equipment: miscEquipment('Sword', 'Sword', ['F_HAND_WEAPON']),
            locations: new Set(['LA']),
        });

        expect(activeForceUnit.rules.computeEntryState(punch(activeForceUnit))).toEqual(jasmine.objectContaining({ hitMod: -1, weakenedHitMod: false }));
        expect(destroyedForceUnit.rules.computeEntryState(punch(destroyedForceUnit))).toEqual(jasmine.objectContaining({ hitMod: 0, weakenedHitMod: true }));
        expect(activeForceUnit.rules.computeEntryState(sword(activeForceUnit))).toEqual(jasmine.objectContaining({ hitMod: -1, weakenedHitMod: false }));
        expect(destroyedForceUnit.rules.computeEntryState(sword(destroyedForceUnit))).toEqual(jasmine.objectContaining({ hitMod: 0, weakenedHitMod: true }));
    });

    it('identifies every damaged actuator contributing to a punch modifier', () => {
        const forceUnit = createForceUnitHarness({
            critSlots: [
                { ...crit('Hand'), loc: 'LA' },
                { ...crit('Upper Arm'), loc: 'LA' },
                { ...crit('Lower Arm'), loc: 'LA' }
            ],
            internalLocations: ['LA', 'RA', 'LL', 'RL']
        });
        const punch = new MountedEquipment({
            owner: forceUnit,
            id: 'punch@LA',
            name: 'punch',
            locations: new Set(['LA']),
            intrinsicPhysicalAttack: true,
        });

        expect(forceUnit.rules.computeEntryState(punch)).toEqual(jasmine.objectContaining({
            hitMod: 5,
            weakenedHitMod: true,
            hitModifierBreakdown: [
                { label: 'Hand Actuator Destroyed (LA)', modifier: 1, negative: true },
                { label: 'Upper Arm Actuator Destroyed (LA)', modifier: 2, negative: true },
                { label: 'Lower Arm Actuator Destroyed (LA)', modifier: 2, negative: true }
            ]
        }));
    });

    it('applies missing punch actuator modifiers as design penalties without weakening', () => {
        const scenarios = [
            { label: 'fully actuated', options: {}, hitMod: 0, breakdown: [] },
            {
                label: 'missing hand', options: { hand: 'missing' as const }, hitMod: 1,
                breakdown: [{ label: 'Hand Actuator Missing (LA)', modifier: 1, designBaseline: true }]
            },
            {
                label: 'missing lower arm', options: { lowerArm: 'missing' as const }, hitMod: 2,
                breakdown: [{ label: 'Lower Arm Actuator Missing (LA)', modifier: 2, designBaseline: true }]
            },
            {
                label: 'missing hand and lower arm',
                options: { hand: 'missing' as const, lowerArm: 'missing' as const },
                hitMod: 3,
                breakdown: [
                    { label: 'Hand Actuator Missing (LA)', modifier: 1, designBaseline: true },
                    { label: 'Lower Arm Actuator Missing (LA)', modifier: 2, designBaseline: true }
                ]
            },
        ];

        for (const rulesId of ['core2026', 'tw'] as const) {
            for (const scenario of scenarios) {
                const forceUnit = createForceUnitHarness({
                    rulesId,
                    critSlots: armCritSlots('LA', scenario.options),
                    internalLocations: ['LA', 'RA', 'LL', 'RL'],
                });
                const punch = punchEntry(forceUnit);
                const state = forceUnit.rules.computeEntryState(punch);
                const resolution = forceUnit.gameRules.resolveToHit({
                    subject: punch,
                    stateModifier: state.hitMod,
                    stateModifierBreakdown: state.hitModifierBreakdown,
                    stateWeakened: state.weakenedHitMod,
                });
                const rulesBase = rulesId === 'core2026' ? -1 : 0;

                expect(state).withContext(`${rulesId}: ${scenario.label}`).toEqual(jasmine.objectContaining({
                    hitMod: scenario.hitMod,
                    hitModifierBreakdown: scenario.breakdown,
                    weakenedHitMod: false,
                }));
                expect(resolution.value).withContext(`${rulesId}: ${scenario.label} resolved modifier`)
                    .toBe(rulesBase + scenario.hitMod);
                expect(resolution.weakened).withContext(`${rulesId}: ${scenario.label} resolved weakening`).toBeFalse();
            }
        }
    });

    it('distinguishes destroyed lower-arm punch damage from design-reduced base damage', () => {
        const missingLowerArmUnit = createForceUnitHarness({
            critSlots: armCritSlots('LA', { lowerArm: 'missing' }),
            internalLocations: ['LA', 'RA', 'LL', 'RL'],
        });
        const destroyedLowerArmUnit = createForceUnitHarness({
            critSlots: armCritSlots('LA', { lowerArm: 'destroyed' }),
            internalLocations: ['LA', 'RA', 'LL', 'RL'],
        });

        expect((missingLowerArmUnit.rules as MekRules).computeMeleeDamage(3, 'punch', 'LA')).toEqual({ damage: 3, maxDamage: 3 });
        expect((destroyedLowerArmUnit.rules as MekRules).computeMeleeDamage(6, 'punch', 'LA')).toEqual({ damage: 3, maxDamage: 3 });
        expect(destroyedLowerArmUnit.rules.computeEntryState(punchEntry(destroyedLowerArmUnit)))
            .toEqual(jasmine.objectContaining({ hitMod: 2, weakenedHitMod: true }));
    });

    it('identifies shoulder and paired AES modifiers for push attacks', () => {
        const forceUnit = createForceUnitHarness({
            critSlots: [
                { ...crit('Shoulder'), loc: 'LA' },
                { ...crit('AES', false), loc: 'LA' },
                { ...crit('AES', false), loc: 'RA' }
            ],
            internalLocations: ['LA', 'RA', 'LL', 'RL']
        });
        const push = new MountedEquipment({ owner: forceUnit, id: 'push', name: 'push', intrinsicPhysicalAttack: true });

        expect(forceUnit.rules.computeEntryState(push)).toEqual(jasmine.objectContaining({
            hitMod: 1,
            hitModifierBreakdown: [
                { label: 'Shoulder Destroyed (LA)', modifier: 2, negative: true },
                { label: 'Paired Arm AES', modifier: -1 }
            ]
        }));
    });

    it('identifies aggregate leg actuator, foot, and AES modifiers for kicks', () => {
        const forceUnit = createForceUnitHarness({
            critSlots: [
                { ...crit('Upper Leg'), loc: 'LL' },
                { ...crit('Lower Leg'), loc: 'RL' },
                { ...crit('Foot'), loc: 'LL' },
                { ...crit('AES', false), loc: 'LL' },
                { ...crit('AES', false), loc: 'RL' }
            ],
            internalLocations: ['LA', 'RA', 'LL', 'RL']
        });
        const kick = new MountedEquipment({ owner: forceUnit, id: 'kick', name: 'kick', intrinsicPhysicalAttack: true });

        expect(forceUnit.rules.computeEntryState(kick)).toEqual(jasmine.objectContaining({
            hitMod: 4,
            hitModifierBreakdown: [
                { label: 'Leg Actuators Destroyed ×2', modifier: 4, negative: true },
                { label: 'Foot Actuator Destroyed', modifier: 1, negative: true },
                { label: 'Leg AES', modifier: -1 }
            ]
        }));
    });

    it('identifies mounted physical weapon actuator modifiers without a generic fallback', () => {
        const forceUnit = createForceUnitHarness({
            critSlots: [
                { ...crit('Upper Arm'), loc: 'LA' },
                { ...crit('Lower Arm'), loc: 'LA' },
                { ...crit('AES', false), loc: 'LA' }
            ],
            internalLocations: ['LA', 'RA', 'LL', 'RL']
        });
        const sword = new MountedEquipment({
            owner: forceUnit,
            id: 'sword@LA',
            name: 'Sword',
            equipment: miscEquipment('Sword', 'Sword', ['F_HAND_WEAPON']),
            locations: new Set(['LA']),
        });

        expect(forceUnit.rules.computeEntryState(sword)).toEqual(jasmine.objectContaining({
            hitMod: 3,
            hitModifierBreakdown: [
                { label: 'Upper Arm Actuator Destroyed (LA)', modifier: 2, negative: true },
                { label: 'Lower Arm Actuator Destroyed (LA)', modifier: 2, negative: true },
                { label: 'Arm AES (LA)', modifier: -1 }
            ]
        }));
    });

    it('marks paired-arm AES modifiers as weakened when damage removes their attack bonus', () => {
        const scenarios = [
            { label: 'one functional', slots: [{ loc: 'LA', destroyed: false }], club: { hitMod: -1, weakenedHitMod: false }, push: { hitMod: 0, weakenedHitMod: false } },
            { label: 'one unavailable', slots: [{ loc: 'LA', destroyed: true }], club: { hitMod: 0, weakenedHitMod: true }, push: { hitMod: 0, weakenedHitMod: false } },
            { label: 'both functional', slots: [{ loc: 'LA', destroyed: false }, { loc: 'RA', destroyed: false }], club: { hitMod: -1, weakenedHitMod: false }, push: { hitMod: -1, weakenedHitMod: false } },
            { label: 'one of two unavailable', slots: [{ loc: 'LA', destroyed: true }, { loc: 'RA', destroyed: false }], club: { hitMod: -1, weakenedHitMod: false }, push: { hitMod: 0, weakenedHitMod: true } },
            { label: 'both unavailable', slots: [{ loc: 'LA', destroyed: true }, { loc: 'RA', destroyed: true }], club: { hitMod: 0, weakenedHitMod: true }, push: { hitMod: 0, weakenedHitMod: true } },
        ];

        for (const scenario of scenarios) {
            const forceUnit = createForceUnitHarness({
                critSlots: scenario.slots.map(({ loc, destroyed }) => ({ ...crit(`AES ${loc}`, destroyed), name: 'AES', loc })),
                internalLocations: ['LA', 'RA'],
            });
            const physical = (name: 'club' | 'push') => new MountedEquipment({
                owner: forceUnit,
                id: name,
                name,
                intrinsicPhysicalAttack: true,
            });

            expect(forceUnit.rules.computeEntryState(physical('club')))
                .withContext(`${scenario.label} arm AES for club`)
                .toEqual(jasmine.objectContaining(scenario.club));
            expect(forceUnit.rules.computeEntryState(physical('push')))
                .withContext(`${scenario.label} arm AES for push`)
                .toEqual(jasmine.objectContaining(scenario.push));
        }
    });

    it('marks leg AES modifiers as weakened only when a complete installation is damaged', () => {
        const scenarios = [
            { label: 'all functional', slots: [{ loc: 'LL', destroyed: false }, { loc: 'RL', destroyed: false }], expected: { hitMod: -1, weakenedHitMod: false } },
            { label: 'all installed with one unavailable', slots: [{ loc: 'LL', destroyed: true }, { loc: 'RL', destroyed: false }], expected: { hitMod: 0, weakenedHitMod: true } },
            { label: 'partial functional installation', slots: [{ loc: 'LL', destroyed: false }], expected: { hitMod: 0, weakenedHitMod: false } },
            { label: 'partial unavailable installation', slots: [{ loc: 'LL', destroyed: true }], expected: { hitMod: 0, weakenedHitMod: false } },
        ];

        for (const scenario of scenarios) {
            const forceUnit = createForceUnitHarness({
                critSlots: scenario.slots.map(({ loc, destroyed }) => ({ ...crit(`AES ${loc}`, destroyed), name: 'AES', loc })),
                internalLocations: ['LL', 'RL'],
            });
            const kick = new MountedEquipment({
                owner: forceUnit,
                id: 'kick',
                name: 'kick',
                intrinsicPhysicalAttack: true,
            });

            expect(forceUnit.rules.computeEntryState(kick))
                .withContext(`${scenario.label} leg AES`)
                .toEqual(jasmine.objectContaining(scenario.expected));
        }
    });

    it('keeps spikes working when flooded but not when structurally destroyed or blown off', () => {
        const createSpikeUnit = () => createForceUnitHarness({
            internalLocations: ['LL'],
            critSlots: [{ ...crit('Spikes', false), loc: 'LL' }],
        });

        const flooded = createSpikeUnit();
        flooded.setLocationCondition('LL', 'flooded', true);
        flooded.endPhase();
        expect((flooded.rules as MekRules).physicalCombat()?.chargeDamage).toEqual(jasmine.objectContaining({ bonusDamage: 2, maxBonusDamage: 2 }));

        const blownOff = createSpikeUnit();
        blownOff.setLocationCondition('LL', 'blown-off', true);
        blownOff.endPhase();
        expect((blownOff.rules as MekRules).physicalCombat()?.chargeDamage).toEqual(jasmine.objectContaining({ bonusDamage: 0, maxBonusDamage: 2 }));

        const structurallyDestroyed = createSpikeUnit();
        structurallyDestroyed.addInternalHits('LL', structurallyDestroyed.getInternalPoints('LL'));
        structurallyDestroyed.endPhase();
        expect((structurallyDestroyed.rules as MekRules).physicalCombat()?.chargeDamage).toEqual(jasmine.objectContaining({ bonusDamage: 0, maxBonusDamage: 2 }));
    });

    it('calculates core2026 charge damage from tonnage and movement-distance TMM', () => {
        const forceUnit = createForceUnitHarness();
        forceUnit.getUnit().tons = 45;
        forceUnit.turnState().moveDistance.set(5);
        const charge = new MountedEquipment({
            owner: forceUnit,
            id: 'Charge',
            name: 'charge',
            intrinsicPhysicalAttack: true,
        });

        expect((forceUnit.rules as MekRules).physicalCombat()?.chargeDamage).toEqual({
            damage: 27,
            maxDamage: 36,
            bonusDamage: 0,
            maxBonusDamage: 0,
        });
        expect(forceUnit.rules.applyInventoryControlDisplayEffects(charge, {
            name: 'Charge',
            location: '—',
            heat: '—',
            damage: 'Legacy',
            hit: '—',
            min: '—',
            short: '—',
            medium: '—',
            long: '—',
        }).damage).toBe('27 [36]');

        forceUnit.turnState().moveDistance.set(8);
        expect(forceUnit.rules.applyInventoryControlDisplayEffects(charge, {
            name: 'Charge',
            location: '—',
            heat: '—',
            damage: 'Legacy',
            hit: '—',
            min: '—',
            short: '—',
            medium: '—',
            long: '—',
        }).damage).toBe('36');

        const twForceUnit = createForceUnitHarness({ rulesId: 'tw' });
        expect((twForceUnit.rules as MekRules).physicalCombat()?.chargeDamage.damage).toBeNull();
    });

    it('applies TSM to capped inactive vibroblade damage but not fixed active damage', () => {
        const tsm = miscEquipment('TSM', 'Triple Strength Myomer', ['F_TSM']);
        const forceUnit = createForceUnitHarness({
            internalLocations: ['RA'],
            critSlots: [{ ...crit('Triple Strength Myomer', false), loc: 'RA', eq: tsm }],
        });
        forceUnit.getUnit().tons = 100;
        forceUnit.setHeatData({ current: 9, previous: 9 });
        const vibroblade = new MountedEquipment({
            owner: forceUnit,
            id: 'ISSmallVibroblade',
            name: 'Vibroblade (Small)',
            equipment: miscEquipment('ISSmallVibroblade', 'Vibroblade (Small)', ['F_CLUB', 'S_VIBRO_SMALL']),
            locations: new Set(['RA']),
        });
        const display = {
            name: 'Vibroblade (Small)', location: 'RA', heat: '—', damage: '7', hit: '-2',
            min: '—', short: '—', medium: '—', long: '—',
        };

        expect(forceUnit.rules.applyInventoryControlDisplayEffects(vibroblade, display).damage).toBe('14');
        expect(forceUnit.applyInventoryControlDisplayEffects(vibroblade, display, {
            selectedRange: null,
            additionalHitModifier: 0,
            selectedAmmo: null,
        }).damage).toBe('14 [7]');

        vibroblade.states.set(VIBROBLADE_MODE_STATE, VIBROBLADE_ON_MODE);
        expect(forceUnit.applyInventoryControlDisplayEffects(vibroblade, display, {
            selectedRange: null,
            additionalHitModifier: 0,
            selectedAmmo: null,
        }).damage).toBe('7');
    });

    it('shows active vibroblade damage beside inactive damage', () => {
        const forceUnit = createForceUnitHarness({ internalLocations: ['RA'] });
        forceUnit.getUnit().tons = 40;
        const vibroblade = new MountedEquipment({
            owner: forceUnit,
            id: 'ISMediumVibroblade',
            name: 'Vibroblade (Medium)',
            equipment: miscEquipment('ISMediumVibroblade', 'Vibroblade (Medium)', ['F_CLUB', 'S_VIBRO_MEDIUM']),
            locations: new Set(['RA']),
        });
        const display = {
            name: 'Vibroblade (Medium)', location: 'RA', heat: '—', damage: '10', hit: '-2',
            min: '—', short: '—', medium: '—', long: '—',
        };

        expect(forceUnit.rules.applyInventoryControlDisplayEffects(vibroblade, display).damage).toBe('5');
        expect(forceUnit.applyInventoryControlDisplayEffects(vibroblade, display, {
            selectedRange: null,
            additionalHitModifier: 0,
            selectedAmmo: null,
        }).damage).toBe('5 [10]');
    });

    it('uses active MASC state for effective Mek run MP without changing potential max run MP', () => {
        const forceUnit = createForceUnitHarness({ walk: 5, critSlots: [crit('MASC', false)] });
        forceUnit.setInventory([miscEntry(forceUnit, miscEquipment('MASC', 'MASC', ['F_MASC']))]);
        const masc = forceUnit.getInventory()[0];
        const rules = forceUnit.rules as MekRules;

        expect(rules.getMaxDistanceForMoveMode('run')).toBe(10);
        expect(rules.getEffectiveMaxDistanceForMoveMode('run', forceUnit.turnState())).toBe(8);

        masc.setState(MASC_ACTIVE_STATE_KEY, 'true');

        expect(rules.getMaxDistanceForMoveMode('run')).toBe(10);
        expect(rules.getEffectiveMaxDistanceForMoveMode('run', forceUnit.turnState())).toBe(10);
    });

    it('stacks active MASC and active Supercharger for effective Mek run MP', () => {
        const forceUnit = createForceUnitHarness({
            walk: 6,
            critSlots: [crit('MASC', false), crit('Supercharger', false)],
        });
        forceUnit.setInventory([
            miscEntry(forceUnit, miscEquipment('MASC', 'MASC', ['F_MASC'])),
            miscEntry(forceUnit, miscEquipment('Supercharger', 'Supercharger', ['F_MASC', 'S_SUPERCHARGER']))
        ]);
        const [masc, supercharger] = forceUnit.getInventory();
        const rules = forceUnit.rules as MekRules;

        supercharger.setState(MASC_ACTIVE_STATE_KEY, 'true');

        expect(rules.getMaxDistanceForMoveMode('run')).toBe(15);
        expect(rules.getEffectiveMaxDistanceForMoveMode('run', forceUnit.turnState())).toBe(12);

        masc.setState(MASC_ACTIVE_STATE_KEY, 'true');

        expect(rules.getEffectiveMaxDistanceForMoveMode('run', forceUnit.turnState())).toBe(15);
    });

    it('keeps active destroyed MASC effective Mek run MP for the current turn', () => {
        const forceUnit = createForceUnitHarness({ walk: 5, critSlots: [crit('MASC', true)] });
        const masc = miscEntry(forceUnit, miscEquipment('MASC', 'MASC', ['F_MASC']));
        masc.setState(MASC_ACTIVE_STATE_KEY, 'true');
        forceUnit.setInventory([masc]);
        const rules = forceUnit.rules as MekRules;

        expect(rules.getMaxDistanceForMoveMode('run')).toBe(8);
        expect(rules.getEffectiveMaxDistanceForMoveMode('run', forceUnit.turnState())).toBe(10);
    });

    it('uses active Tripod dedicated crew for target-number skills', () => {
        const forceUnit = createForceUnitHarness({ subtype: 'Tripod BattleMek', crewStates: ['healthy', 'healthy', 'healthy'] });
        forceUnit.getCrewMember(0).setSkill('piloting', 5);
        forceUnit.getCrewMember(1).setSkill('gunnery', 3);
        forceUnit.getCrewMember(2).setSkill('gunnery', 2);
        forceUnit.getCrewMember(2).setSkill('piloting', 4);
        const rules = forceUnit.rules as MekRules;

        expect(rules.getTargetNumberGunnerySkill()).toBe(3);
        expect(rules.getTargetNumberGunneryModifierBreakdown()).toEqual([]);
        expect(rules.getTargetNumberPilotingSkill()).toBe(5);
        expect(rules.getTargetNumberPilotingModifierBreakdown()).toEqual([{ label: 'Dedicated Pilot', modifier: -1 }]);
        expect(rules.PSRTargetRoll()).toBe(4);
    });

    it('uses the first active alternate gunner with a modifier when the Tripod dedicated gunnery officer is disabled', () => {
        const forceUnit = createForceUnitHarness({ subtype: 'Tripod BattleMek', crewStates: ['healthy', 'unconscious', 'healthy'] });
        forceUnit.getCrewMember(0).setSkill('gunnery', 5);
        forceUnit.getCrewMember(1).setSkill('gunnery', 3);
        forceUnit.getCrewMember(2).setSkill('gunnery', 2);
        const rules = forceUnit.rules as MekRules;

        expect(rules.getTargetNumberGunnerySkill()).toBe(5);
        expect(rules.getTargetNumberGunneryModifierBreakdown()).toEqual([{ label: 'Dedicated Gunnery Officer disabled', modifier: 2 }]);
        const ranged = directFireWeaponEntry(forceUnit);
        expect(rules.computeEntryState(ranged)).toEqual(jasmine.objectContaining({
            hitMod: 2,
            hitModifierBreakdown: [{ label: 'Dedicated Gunnery Officer disabled', modifier: 2 }],
        }));
        expect(forceUnit.turnState().getAttackModifierBreakdown()).toEqual([]);
    });

    it('uses the first active alternate pilot with a modifier when the Tripod dedicated pilot is disabled', () => {
        const forceUnit = createForceUnitHarness({ subtype: 'Tripod BattleMek', crewStates: ['unconscious', 'healthy', 'healthy'] });
        forceUnit.getCrewMember(0).setSkill('piloting', 5);
        forceUnit.getCrewMember(1).setSkill('piloting', 6);
        forceUnit.getCrewMember(2).setSkill('piloting', 4);
        const rules = forceUnit.rules as MekRules;

        expect(rules.getTargetNumberPilotingSkill()).toBe(6);
        expect(rules.getTargetNumberPilotingModifierBreakdown()).toEqual([{ label: 'Dedicated Pilot disabled', modifier: 2 }]);
        expect(rules.PSRTargetRoll()).toBe(8);
    });

    it('applies the Tripod dedicated pilot modifier to physical attacks', () => {
        const forceUnit = createForceUnitHarness({ subtype: 'Tripod BattleMek', crewStates: ['healthy', 'healthy', 'healthy'] });
        const punch = new MountedEquipment({
            owner: forceUnit,
            id: 'punch',
            name: 'Punch',
            intrinsicPhysicalAttack: true,
            locations: new Set(['LA']),
        });
        const ranged = new MountedEquipment({ owner: forceUnit, id: 'laser', name: 'Laser' });

        expect(forceUnit.rules.computeEntryState(punch)).toEqual(jasmine.objectContaining({
            hitMod: -1,
            hitModifierBreakdown: [{ label: 'Dedicated Pilot', modifier: -1 }],
        }));
        expect(forceUnit.rules.computeEntryState(ranged)).toEqual(jasmine.objectContaining({
            hitMod: 0,
            hitModifierBreakdown: [],
        }));

        forceUnit.getCrewMember(0).setState('unconscious');

        expect(forceUnit.rules.computeEntryState(punch)).toEqual(jasmine.objectContaining({
            hitMod: 2,
            hitModifierBreakdown: [{ label: 'Dedicated Pilot disabled', modifier: 2 }],
        }));
    });

    it('includes intact Tripod legs in piloting checks', () => {
        const forceUnit = createForceUnitHarness({
            subtype: 'Tripod BattleMek',
            crewStates: ['healthy', 'healthy', 'healthy'],
            internalLocations: ['LL', 'CL', 'RL'],
        });

        expect(forceUnit.rules.PSRModifiers().modifiers).toEqual(jasmine.arrayContaining([
            jasmine.objectContaining({ reason: 'All legs are intact', pilotCheck: -1 }),
            jasmine.objectContaining({ reason: 'Dedicated Pilot', pilotCheck: -1 }),
        ]));
    });

    it('applies the Superheavy modifier only to physical attacks above 100 tons', () => {
        const superheavy = createForceUnitHarness({ tons: 101 });
        const assault = createForceUnitHarness({ tons: 100 });
        const physical = (forceUnit: CBTForceUnit) => new MountedEquipment({
            owner: forceUnit,
            id: 'kick',
            name: 'Kick',
            intrinsicPhysicalAttack: true,
        });
        const ranged = directFireWeaponEntry(superheavy);
        const superheavyPhysical = physical(superheavy);

        expect(superheavy.rules.getPhysicalAttackModifierBreakdown()).toEqual([{ label: 'Superheavy', modifier: 1, designBaseline: true }]);
        expect(superheavy.rules.getTargetNumberPilotingModifierBreakdown()).toEqual([]);
        expect(superheavy.rules.PSRModifiers().modifiers.map(modifier => modifier.reason)).not.toContain('Superheavy');
        expect(superheavy.rules.computeEntryState(superheavyPhysical)).toEqual(jasmine.objectContaining({
            hitMod: 1,
            hitModifierBreakdown: [{ label: 'Superheavy', modifier: 1, designBaseline: true }],
        }));
        const superheavyState = superheavy.rules.computeEntryState(superheavyPhysical);
        expect(superheavy.gameRules.resolveToHit({
            subject: superheavyPhysical,
            stateModifier: superheavyState.hitMod,
            stateModifierBreakdown: superheavyState.hitModifierBreakdown,
        }).weakened).toBeFalse();
        expect(superheavy.rules.computeEntryState(ranged)).toEqual(jasmine.objectContaining({ hitMod: 0 }));
        expect(assault.rules.computeEntryState(physical(assault))).toEqual(jasmine.objectContaining({ hitMod: 0 }));
    });

    it('does not apply gunnery modifiers to non-attack equipment', () => {
        const forceUnit = createForceUnitHarness();
        spyOn(forceUnit.rules, 'getTargetNumberGunneryModifierBreakdown')
            .and.returnValue([{ label: 'Test modifier', modifier: 2 }]);
        const utility = new MountedEquipment({
            owner: forceUnit,
            id: 'utility',
            name: 'Utility',
            equipment: miscEquipment('Utility', 'Utility', []),
        });

        expect(forceUnit.rules.computeEntryState(utility)).toEqual(jasmine.objectContaining({
            hitMod: 0,
            hitModifierBreakdown: [],
        }));
    });

    it('does not apply the spotting attack modifier when an active command console crew member can spot', () => {
        const forceUnit = createForceUnitHarness({
            crewStates: ['healthy', 'healthy'],
            critSlots: [
                { id: 'cockpit', name: 'Cockpit', loc: 'HD', slot: 2 },
                { id: 'command-console', name: 'Command Console', loc: 'HD', slot: 3 },
            ],
        });
        forceUnit.turnState().spotting.set(true);

        expect(forceUnit.turnState().getSpottingModifier()).toBe(0);
        expect(forceUnit.turnState().getAttackModifierBreakdown()).toEqual([]);
    });

    it('applies the spotting attack modifier when the command console crew member is disabled', () => {
        const forceUnit = createForceUnitHarness({
            crewStates: ['healthy', 'unconscious'],
            critSlots: [
                { id: 'cockpit', name: 'Cockpit', loc: 'HD', slot: 2 },
                { id: 'command-console', name: 'Command Console', loc: 'HD', slot: 3 },
            ],
        });
        forceUnit.turnState().spotting.set(true);

        expect(forceUnit.turnState().getSpottingModifier()).toBe(1);
        expect(forceUnit.turnState().getAttackModifierBreakdown()).toEqual([{ label: 'Spotting', modifier: 1 }]);
    });

    it('uses crew order instead of best skill for non-Tripod Mek target-number skills', () => {
        const forceUnit = createForceUnitHarness({ crewStates: ['healthy', 'healthy', 'healthy'] });
        forceUnit.getCrewMember(0).setSkill('gunnery', 5);
        forceUnit.getCrewMember(0).setSkill('piloting', 6);
        forceUnit.getCrewMember(1).setSkill('gunnery', 4);
        forceUnit.getCrewMember(1).setSkill('piloting', 5);
        forceUnit.getCrewMember(2).setSkill('gunnery', 2);
        forceUnit.getCrewMember(2).setSkill('piloting', 3);
        const rules = forceUnit.rules as MekRules;

        expect(rules.getTargetNumberGunnerySkill()).toBe(5);
        expect(rules.getTargetNumberPilotingSkill()).toBe(6);

        forceUnit.getCrewMember(0).setState('unconscious');

        expect(rules.getTargetNumberGunnerySkill()).toBe(4);
        expect(rules.getTargetNumberPilotingSkill()).toBe(5);
    });

    it('ignores small cockpit PSR modifiers for drone operating system Meks', () => {
        const forceUnit = createForceUnitHarness({
            critSlots: [{ id: 'small-cockpit', name: 'Small Cockpit', loc: 'HD', slot: 0 }],
        });
        forceUnit.setInventory([droneOperatingSystemEntry(forceUnit)]);
        const rules = forceUnit.rules as MekRules;

        expect(rules.PSRModifiers().modifier).toBe(0);
        expect(rules.PSRModifiers().modifiers.map(modifier => modifier.reason)).not.toContain('Mounts small or torso cockpit');
    });

    it('does not offer ejection for torso-mounted cockpits', () => {
        const headCockpitRules = createRulesHarness({
            critSlots: [{ id: 'cockpit-head', name: 'Cockpit', loc: 'HD', slot: 0 }],
        });
        const centerTorsoCockpitRules = createRulesHarness({
            critSlots: [{ id: 'cockpit-torso', name: 'Cockpit', loc: 'CT', slot: 0 }],
        });
        const sideTorsoCockpitRules = createRulesHarness({
            critSlots: [{ id: 'cockpit-side-torso', name: 'Cockpit', loc: 'LT', slot: 0 }],
        });

        expect(headCockpitRules.crewStateControls.map(control => control.key)).toEqual(['unconscious', 'ejected']);
        expect(centerTorsoCockpitRules.crewStateControls.map(control => control.key)).toEqual(['unconscious']);
        expect(sideTorsoCockpitRules.crewStateControls.map(control => control.key)).toEqual(['unconscious']);
    });

    it('maps main cockpit and command console destruction to their assigned crew members', () => {
        const forceUnit = createForceUnitHarness({
            crewStates: ['healthy', 'healthy'],
            critSlots: [
                { id: 'cockpit', name: 'Cockpit', loc: 'HD', slot: 2, destroyed: 1 },
                { id: 'command-console', name: 'Command Console', loc: 'HD', slot: 3 },
            ],
        });

        expect(forceUnit.getCrewMember(0).getState()).toBe('dead');
        expect(forceUnit.getCrewMember(1).getState()).toBe('healthy');

        forceUnit.writeCrits([
            { id: 'cockpit', name: 'Cockpit', loc: 'HD', slot: 2 },
            { id: 'command-console', name: 'Command Console', loc: 'HD', slot: 3, destroyed: 1 },
        ]);

        expect(forceUnit.getCrewMember(0).getState()).toBe('healthy');
        expect(forceUnit.getCrewMember(1).getState()).toBe('dead');
    });

    it('does not destroy command-console Meks until both cockpits are destroyed', () => {
        const forceUnit = createForceUnitHarness({
            crewStates: ['healthy', 'healthy'],
            critSlots: [
                { id: 'cockpit', name: 'Cockpit', loc: 'HD', slot: 2, destroyed: 1 },
                { id: 'command-console', name: 'Command Console', loc: 'HD', slot: 3 },
            ],
        });
        const rules = forceUnit.rules as MekRules;

        rules.evaluateDestroyed();

        expect(forceUnit.destroyed).toBeFalse();

        forceUnit.writeCrits([
            { id: 'cockpit', name: 'Cockpit', loc: 'HD', slot: 2, destroyed: 1 },
            { id: 'command-console', name: 'Command Console', loc: 'HD', slot: 3, destroyed: 1 },
        ]);

        rules.evaluateDestroyed();

        expect(forceUnit.destroyed).toBeTrue();
    });

    it('destroys a Mek on exactly three committed engine hits', () => {
        const forceUnit = createForceUnitHarness({
            critSlots: [
                { id: 'engine-0', name: 'Engine', loc: 'CT', slot: 0, destroyed: 1 },
                { id: 'engine-1', name: 'Engine', loc: 'CT', slot: 1, destroyed: 1 },
                { id: 'engine-2', name: 'Engine', loc: 'CT', slot: 2 },
            ],
        });
        const rules = forceUnit.rules as MekRules;

        rules.evaluateDestroyed();
        expect(forceUnit.destroyed).toBeFalse();

        forceUnit.getCritSlots()[2].destroyed = 1;
        rules.evaluateDestroyed();

        expect(MekRules.ENGINE_DESTRUCTION_HITS).toBe(3);
        expect(forceUnit.destroyed).toBeTrue();
    });

    it('swaps dual-cockpit crew member data while preserving crew slots', () => {
        const forceUnit = createForceUnitHarness({
            crewStates: ['healthy', 'healthy'],
            critSlots: [
                { id: 'cockpit', name: 'Cockpit', loc: 'HD', slot: 2 },
                { id: 'command-console', name: 'Command Console', loc: 'HD', slot: 3 },
            ],
        });
        forceUnit.getCrewMember(0).setName('Pilot');
        forceUnit.getCrewMember(0).setSkill('gunnery', 4);
        forceUnit.getCrewMember(0).setSkill('piloting', 5);
        forceUnit.getCrewMember(1).setName('Gunner');
        forceUnit.getCrewMember(1).setSkill('gunnery', 2);
        forceUnit.getCrewMember(1).setSkill('piloting', 6);
        forceUnit.getCrewMember(1).setState('unconscious');
        const rules = forceUnit.rules as MekRules;

        expect(rules.swapCrewMembers()).toBeTrue();

        expect(forceUnit.getCrewMember(0).getId()).toBe(0);
        expect(forceUnit.getCrewMember(0).getName()).toBe('Gunner');
        expect(forceUnit.getCrewMember(0).getSkill('gunnery')).toBe(2);
        expect(forceUnit.getCrewMember(0).getSkill('piloting')).toBe(6);
        expect(forceUnit.getCrewMember(0).getState()).toBe('unconscious');
        expect(forceUnit.getCrewMember(1).getId()).toBe(1);
        expect(forceUnit.getCrewMember(1).getName()).toBe('Pilot');
        expect(forceUnit.getCrewMember(1).getSkill('gunnery')).toBe(4);
        expect(forceUnit.getCrewMember(1).getSkill('piloting')).toBe(5);
        expect(forceUnit.getCrewMember(1).getState()).toBe('healthy');
    });

    it('does not swap dual-cockpit crew when either cockpit is destroyed', () => {
        const forceUnit = createForceUnitHarness({
            crewStates: ['healthy', 'healthy'],
            critSlots: [
                { id: 'cockpit', name: 'Cockpit', loc: 'HD', slot: 2 },
                { id: 'command-console', name: 'Command Console', loc: 'HD', slot: 3, destroyed: 1 },
            ],
        });
        const rules = forceUnit.rules as MekRules;

        expect(rules.canSwapCrewMembers()).toBeFalse();
        expect(rules.swapCrewMembers()).toBeFalse();
    });

    it('treats drone operating system Meks as crewless for crew-derived conditions', () => {
        const forceUnit = createForceUnitHarness({ crewStates: ['ejected'], crewHits: [4] });
        forceUnit.setInventory([droneOperatingSystemEntry(forceUnit)]);
        const rules = forceUnit.rules as MekRules;

        expect(rules.hasComputedCondition('abandoned')).toBeFalse();
        expect(rules.hasComputedCondition('crippled')).toBeFalse();
        expect(rules.hasComputedCondition('immobile')).toBeFalse();
    });

    it('makes disconnected drones Immobile under every rules system', () => {
        const forceUnit = createForceUnitHarness();
        forceUnit.setInventory([droneOperatingSystemEntry(forceUnit)]);
        const rules = forceUnit.rules as MekRules;

        forceUnit.setCondition('disconnected', true);

        expect(forceUnit.getCondition('disconnected')).toBeTrue();
        expect(rules.hasComputedCondition('immobile')).toBeTrue();
        expect(rules.movementState()).toEqual(jasmine.objectContaining({ walk: 0, run: 0, jump: 0, UMU: 0 }));

        forceUnit.setCondition('disconnected', false);
        forceUnit.setInventory([droneOperatingSystemEntry(forceUnit, true)]);

        expect(rules.hasComputedCondition('disconnected')).toBeTrue();
        expect(forceUnit.getCondition('disconnected')).toBeTrue();
        expect(rules.hasComputedCondition('immobile')).toBeTrue();
        expect(rules.movementState()).toEqual(jasmine.objectContaining({ walk: 0, run: 0, jump: 0, UMU: 0 }));

        const twForceUnit = createForceUnitHarness({ rulesId: 'tw' });
        twForceUnit.setInventory([droneOperatingSystemEntry(twForceUnit, true)]);
        expect(twForceUnit.rules.hasComputedCondition('immobile')).toBeTrue();
    });

    it('clears drone operating system disconnect after crit-backed OS repair commit', () => {
        const forceUnit = createForceUnitHarness({ internalLocations: ['HD', 'LL', 'RL'] });
        const droneCrit = { id: 'drone-os-crit', name: 'Drone Operating System', loc: 'HD', slot: 0 } as CriticalSlot;
        const entry = new MountedEquipment({
            owner: forceUnit,
            id: 'ISDroneOperatingSystem@HD#0',
            name: 'Drone (Remote) Operating System',
            equipment: droneOperatingSystem(),
            locations: new Set(['HD']),
            critSlots: [droneCrit],
        });

        forceUnit.writeCrits([droneCrit]);
        forceUnit.setInventory([entry]);
        const storedEntry = forceUnit.getInventory().find(item => item.id === entry.id)!;
        forceUnit.applyHitToCritSlot(droneCrit);
        forceUnit.endPhase();

        expect(storedEntry.committedDestroyed()).toBeFalse();
        expect(forceUnit.getCritSlots()[0].destroyed).toBeTruthy();
        expect((forceUnit.rules as MekRules).computeEntryState(storedEntry)).toEqual(jasmine.objectContaining({ isDamaged: true }));
        expect(forceUnit.getCondition('disconnected')).toBeTrue();
        expect(forceUnit.getCondition('immobile')).toBeTrue();

        forceUnit.applyHitToCritSlot(droneCrit, -1);
        forceUnit.endPhase();

        expect(storedEntry.committedDestroyed()).toBeFalse();
        expect(forceUnit.getCondition('disconnected')).toBeFalse();
        expect(forceUnit.getCondition('immobile')).toBeFalse();
    });

    it('marks inventory damaged when any mapped critical slot is destroyed', () => {
        const forceUnit = createForceUnitHarness({ internalLocations: ['RA'] });
        const rules = forceUnit.rules as MekRules;
        const firstCrit = { id: 'multi-slot-weapon', name: 'Multi Slot Weapon', loc: 'RA', slot: 0 } as CriticalSlot;
        const secondCrit = { id: 'multi-slot-weapon', name: 'Multi Slot Weapon', loc: 'RA', slot: 1 } as CriticalSlot;
        const entry = new MountedEquipment({
            owner: forceUnit,
            id: 'multi-slot-weapon',
            name: 'Multi Slot Weapon',
            locations: new Set(['RA']),
            critSlots: [firstCrit, secondCrit],
        });

        forceUnit.writeCrits([firstCrit, secondCrit]);
        forceUnit.setInventory([entry]);
        const storedEntry = forceUnit.getInventory().find(item => item.id === entry.id)!;
        forceUnit.applyHitToCritSlot(secondCrit);
        forceUnit.endPhase();

        expect(forceUnit.getCritSlots()[0].destroyed).toBeFalsy();
        expect(forceUnit.getCritSlots()[1].destroyed).toBeTruthy();
        expect(storedEntry.committedDestroyed()).toBeFalse();
        expect(rules.computeEntryState(storedEntry)).toEqual(jasmine.objectContaining({ isDamaged: true }));
    });

    it('requires two destroyed critical slots for Core2026 autocannons', () => {
        const ammoTypes: AmmoType[] = [
            'AC', 'AC_LBX', 'AC_ULTRA', 'AC_ULTRA_THB', 'AC_ROTARY',
            'AC_PRIMITIVE', 'PAC', 'NAC', 'LAC',
        ];

        for (const ammoType of ammoTypes) {
            const forceUnit = createForceUnitHarness({ internalLocations: ['RA'] });
            const firstCrit = { id: `Autocannon-${ammoType}`, name: `Autocannon ${ammoType}`, loc: 'RA', slot: 0 } as CriticalSlot;
            const secondCrit = { id: `Autocannon-${ammoType}`, name: `Autocannon ${ammoType}`, loc: 'RA', slot: 1 } as CriticalSlot;
            const entry = criticalAutocannonEntry(forceUnit, ammoType, [firstCrit, secondCrit]);
            forceUnit.writeCrits([firstCrit, secondCrit]);
            forceUnit.setInventory([entry]);
            const storedEntry = forceUnit.getInventory()[0];

            forceUnit.applyHitToCritSlot(firstCrit);
            forceUnit.endPhase();
            expect(forceUnit.rules.computeEntryState(storedEntry).isDamaged)
                .withContext(`${ammoType} after one destroyed critical slot`).toBeFalse();

            forceUnit.applyHitToCritSlot(secondCrit);
            forceUnit.endPhase();
            expect(forceUnit.rules.computeEntryState(storedEntry).isDamaged)
                .withContext(`${ammoType} after two destroyed critical slots`).toBeTrue();
        }
    });

    it('uses the one-slot critical destruction threshold for TW autocannons', () => {
        const forceUnit = createForceUnitHarness({ internalLocations: ['RA'], rulesId: 'tw' });
        const critSlot = { id: 'Autocannon-AC', name: 'Autocannon AC', loc: 'RA', slot: 0 } as CriticalSlot;
        const entry = criticalAutocannonEntry(forceUnit, 'AC', [critSlot]);
        forceUnit.writeCrits([critSlot]);
        forceUnit.setInventory([entry]);

        forceUnit.applyHitToCritSlot(critSlot);
        forceUnit.endPhase();

        expect(forceUnit.rules.computeEntryState(forceUnit.getInventory()[0]).isDamaged).toBeTrue();
    });

    it('uses the one-slot threshold when a Core2026 autocannon signature does not match', () => {
        const cases: { ammoType: AmmoType; flags: EquipmentFlag[]; description: string }[] = [
            { ammoType: 'AC', flags: ['F_BALLISTIC'], description: 'missing direct-fire flag' },
            { ammoType: 'AC', flags: ['F_DIRECT_FIRE'], description: 'missing ballistic flag' },
            { ammoType: 'NA', flags: ['F_BALLISTIC', 'F_DIRECT_FIRE'], description: 'non-autocannon ammo type' },
        ];

        for (const testCase of cases) {
            const forceUnit = createForceUnitHarness({ internalLocations: ['RA'] });
            const critSlot = { id: `Autocannon-${testCase.ammoType}`, name: 'Near-match weapon', loc: 'RA', slot: 0 } as CriticalSlot;
            const entry = criticalAutocannonEntry(forceUnit, testCase.ammoType, [critSlot], testCase.flags);
            forceUnit.writeCrits([critSlot]);
            forceUnit.setInventory([entry]);

            forceUnit.applyHitToCritSlot(critSlot);
            forceUnit.endPhase();

            expect(forceUnit.rules.computeEntryState(forceUnit.getInventory()[0]).isDamaged)
                .withContext(testCase.description).toBeTrue();
        }
    });

    it('sets Mek movement to zero when all crew are unconscious', () => {
        const rules = createRulesHarness({ crewStates: ['unconscious'] });

        expect(rules.movementState()).toEqual(jasmine.objectContaining({
            walk: 0,
            maxWalk: 0,
            run: 0,
            maxRun: 0,
            jump: 0,
            UMU: 0,
            moveImpaired: true,
            jumpImpaired: true,
            UMUImpaired: true,
        }));
        expect(rules.getMaxDistanceForMoveMode('walk')).toBe(0);
        expect(rules.getMaxDistanceForMoveMode('run')).toBe(0);
        expect(rules.getMaxDistanceForMoveMode('jump')).toBe(0);
        expect(rules.getMaxDistanceForMoveMode('UMU')).toBe(0);
    });

    it('marks Meks abandoned when every crew member is dead or ejected', () => {
        const rules = createRulesHarness({ crewStates: ['healthy', 'ejected'], crewHits: [DEAD_CREW_HIT_THRESHOLD] });

        expect(rules.hasComputedCondition('abandoned')).toBeTrue();
    });

    it('does not mark Meks abandoned while any crew member is alive in the unit', () => {
        const rules = createRulesHarness({ crewStates: ['healthy', 'unconscious'], crewHits: [DEAD_CREW_HIT_THRESHOLD] });

        expect(rules.hasComputedCondition('abandoned')).toBeFalse();
    });

    it('uses only the Core 2026 damage criteria for crippled Meks', () => {
        expect(createRulesHarness({ crewHits: [4] }).hasComputedCondition('crippled')).toBeFalse();
        expect(createRulesHarness({ critSlots: [crit('Sensor'), crit('Sensor')] }).hasComputedCondition('crippled')).toBeFalse();
        expect(createRulesHarness({ critSlots: [crit('Gyro'), crit('Engine')] }).hasComputedCondition('crippled')).toBeFalse();
        expect(createRulesHarness({ critSlots: [crit('Engine')] }).hasComputedCondition('crippled')).toBeFalse();
        expect(createRulesHarness({ critSlots: [crit('Engine'), crit('Engine')] }).hasComputedCondition('crippled')).toBeTrue();
        expect(createRulesHarness({
            critSlots: [
                { ...crit('Engine'), id: 'engine-1' },
                { ...crit('Engine', false), id: 'engine-2', destroying: 1 },
            ],
        }).hasComputedCondition('crippled')).toBeTrue();
    });

    it('marks Core 2026 Meks crippled from two destroyed limbs including a leg', () => {
        const internalLocations = ['LT', 'RT', 'CT', 'LA', 'RA', 'LL', 'RL'];

        expect(createRulesHarness({
            internalLocations,
            committedDestroyedLocations: ['LA', 'LL'],
        }).hasComputedCondition('crippled')).toBeTrue();
        expect(createRulesHarness({
            internalLocations,
            committedDestroyedLocations: ['LA', 'RA'],
        }).hasComputedCondition('crippled')).toBeFalse();
        expect(createRulesHarness({
            internalLocations,
            committedDestroyedLocations: ['LL'],
        }).hasComputedCondition('crippled')).toBeFalse();
        expect(createRulesHarness({
            internalLocations,
            locationPoints: 10,
            locationState: { LA: { internal: 1 }, LL: { internal: 1 } },
        }).hasComputedCondition('crippled')).toBeFalse();
    });

    it('applies Core 2026 destroyed-limb criteria to quadruped and tripod Meks', () => {
        expect(createRulesHarness({
            internalLocations: ['CT', 'LT', 'RT', 'FLL', 'FRL', 'RLL', 'RRL'],
            committedDestroyedLocations: ['FLL', 'FRL'],
        }).hasComputedCondition('crippled')).toBeTrue();
        expect(createRulesHarness({
            internalLocations: ['CT', 'LT', 'RT', 'LA', 'RA', 'LL', 'RL', 'CL'],
            committedDestroyedLocations: ['LA', 'CL'],
        }).hasComputedCondition('crippled')).toBeTrue();
    });

    it('requires and resolves a Core 2026 crippling check for the first destroyed torso on fusion Meks', () => {
        const internalLocations = ['LT', 'RT', 'CT', 'LA', 'RA', 'LL', 'RL'];
        const successfulUnit = createForceUnitHarness({
            internalLocations,
            committedDestroyedLocations: ['LT'],
        });
        const successfulCheck = successfulUnit.turnState().getPSRChecks()
            .find(check => check.reason === 'Torso destroyed');

        expect(successfulUnit.rules.hasComputedCondition('crippled')).toBeFalse();
        expect(successfulCheck).toBeDefined();
        expect(successfulCheck?.loc).toBe('LT');
        expect(successfulCheck?.pilotCheck).toBe(0);
        expect(successfulCheck?.failureOutcome).toBe('Crippled');
        expect(successfulCheck?.resolution).toBeDefined();
        expect(successfulUnit.resolveRuleCheck(
            successfulCheck!.resolution!.key,
            successfulCheck!.resolution!.token,
            'success'
        )).toBeTrue();
        expect(successfulUnit.rules.hasComputedCondition('crippled')).toBeFalse();
        expect(successfulUnit.turnState().getPSRChecks().some(check =>
            check.reason === 'Torso destroyed'
        )).toBeFalse();
        successfulUnit.endTurn();
        expect(successfulUnit.rules.hasComputedCondition('crippled')).toBeFalse();
        expect(successfulUnit.turnState().getPSRChecks().some(check =>
            check.reason === 'Torso destroyed'
        )).toBeFalse();

        const failedUnit = createForceUnitHarness({
            internalLocations,
            committedDestroyedLocations: ['RT'],
        });
        const failedCheck = failedUnit.turnState().getPSRChecks()
            .find(check => check.reason === 'Torso destroyed');

        expect(failedUnit.resolveRuleCheck(
            failedCheck!.resolution!.key,
            failedCheck!.resolution!.token,
            'failed'
        )).toBeTrue();
        expect(failedUnit.rules.hasComputedCondition('crippled')).toBeTrue();
        expect(failedUnit.turnState().getPSRChecks().some(check =>
            check.reason === 'Torso destroyed'
        )).toBeFalse();
        failedUnit.endTurn();
        expect(failedUnit.rules.hasComputedCondition('crippled')).toBeTrue();
    });

    it('skips Core 2026 crippling and torso checks when forced withdrawal is disabled', () => {
        const forceUnit = createForceUnitHarness({
            forcedWithdrawal: false,
            internalLocations: ['LT', 'RT', 'CT', 'LA', 'RA', 'LL', 'RL'],
            committedDestroyedLocations: ['LT'],
        });

        expect(forceUnit.rules.hasComputedCondition('crippled')).toBeFalse();
        expect(forceUnit.turnState().getPSRChecks().some(check =>
            check.reason === 'Torso destroyed'
        )).toBeFalse();

        optionsService.options.update(current => ({
            ...current,
            CBTOptionalRules: { ...current.CBTOptionalRules, forcedWithdrawal: true },
        }));
        TestBed.tick();

        expect(forceUnit.rules.hasComputedCondition('crippled')).toBeFalse();
        expect(forceUnit.turnState().getPSRChecks().some(check =>
            check.reason === 'Torso destroyed'
        )).toBeTrue();

        optionsService.options.update(current => ({
            ...current,
            CBTOptionalRules: { ...current.CBTOptionalRules, forcedWithdrawal: false },
        }));
        TestBed.tick();

        expect(forceUnit.rules.hasComputedCondition('crippled')).toBeFalse();
        expect(forceUnit.turnState().getPSRChecks().some(check =>
            check.reason === 'Torso destroyed'
        )).toBeFalse();
    });

    it('requests a new torso crippling check after repair and rejects the stale result', () => {
        const forceUnit = createForceUnitHarness({
            internalLocations: ['LT', 'RT', 'CT', 'LA', 'RA', 'LL', 'RL'],
            committedDestroyedLocations: ['LT'],
        });
        const firstCheck = forceUnit.turnState().getPSRChecks()
            .find(check => check.reason === 'Torso destroyed')!;

        forceUnit.setInternalHits('LT', 0);
        expect(forceUnit.getRuleCheck(firstCheck.resolution!.key)).toBeUndefined();

        forceUnit.setInternalHits('LT', 1);
        const secondCheck = forceUnit.turnState().getPSRChecks()
            .find(check => check.reason === 'Torso destroyed')!;

        expect(secondCheck.resolution!.token).not.toBe(firstCheck.resolution!.token);
        expect(forceUnit.resolveRuleCheck(
            firstCheck.resolution!.key,
            firstCheck.resolution!.token,
            'failed'
        )).toBeFalse();
        expect(forceUnit.rules.hasComputedCondition('crippled')).toBeFalse();
        expect(forceUnit.resolveRuleCheck(
            secondCheck.resolution!.key,
            secondCheck.resolution!.token,
            'failed'
        )).toBeTrue();
        expect(forceUnit.rules.hasComputedCondition('crippled')).toBeTrue();
    });

    it('preserves the first torso result while a second torso is destroyed', () => {
        const forceUnit = createForceUnitHarness({
            internalLocations: ['LT', 'RT', 'CT', 'LA', 'RA', 'LL', 'RL'],
            committedDestroyedLocations: ['LT'],
        });
        const check = forceUnit.turnState().getPSRChecks()
            .find(entry => entry.reason === 'Torso destroyed')!;
        forceUnit.resolveRuleCheck(check.resolution!.key, check.resolution!.token, 'success');

        forceUnit.setInternalHits('RT', 1);
        expect(forceUnit.rules.hasComputedCondition('crippled')).toBeTrue();
        expect(forceUnit.turnState().getPSRChecks().some(entry =>
            entry.reason === 'Torso destroyed'
        )).toBeFalse();

        forceUnit.setInternalHits('RT', 0);
        expect(forceUnit.rules.hasComputedCondition('crippled')).toBeFalse();
        expect(forceUnit.getRuleCheck(check.resolution!.key)?.token).toBe(check.resolution!.token);
        expect(forceUnit.turnState().getPSRChecks().some(entry =>
            entry.reason === 'Torso destroyed'
        )).toBeFalse();
    });

    it('requests a new check when a different torso remains destroyed after repair', () => {
        const forceUnit = createForceUnitHarness({
            internalLocations: ['LT', 'RT', 'CT', 'LA', 'RA', 'LL', 'RL'],
            committedDestroyedLocations: ['LT'],
        });
        const firstCheck = forceUnit.turnState().getPSRChecks()
            .find(entry => entry.reason === 'Torso destroyed')!;
        forceUnit.resolveRuleCheck(firstCheck.resolution!.key, firstCheck.resolution!.token, 'success');

        forceUnit.setInternalHits('RT', 1);
        forceUnit.setInternalHits('LT', 0);
        const nextCheck = forceUnit.turnState().getPSRChecks()
            .find(entry => entry.reason === 'Torso destroyed')!;

        expect(nextCheck.resolution!.token).not.toBe(firstCheck.resolution!.token);
        expect(forceUnit.getRuleCheck(nextCheck.resolution!.key)?.trigger).toBe('RT');
        expect(forceUnit.rules.hasComputedCondition('crippled')).toBeFalse();
    });

    it('serializes and restores the torso crippling outcome record', () => {
        const source = createForceUnitHarness({
            internalLocations: ['LT', 'RT', 'CT', 'LA', 'RA', 'LL', 'RL'],
            committedDestroyedLocations: ['LT'],
        });
        const check = source.turnState().getPSRChecks()
            .find(entry => entry.reason === 'Torso destroyed')!;
        source.resolveRuleCheck(check.resolution!.key, check.resolution!.token, 'failed');
        const serialized = source.serialize();

        expect(serialized.state.ruleChecks).toEqual({
            [check.resolution!.key]: {
                token: check.resolution!.token,
                trigger: 'LT',
                status: 'failed',
            },
        });

        const restored = createForceUnitHarness({
            internalLocations: ['LT', 'RT', 'CT', 'LA', 'RA', 'LL', 'RL'],
        });
        restored.update(serialized);

        expect(restored.rules.hasComputedCondition('crippled')).toBeTrue();
        expect(restored.turnState().getPSRChecks().some(entry =>
            entry.reason === 'Torso destroyed'
        )).toBeFalse();
    });

    it('uses the Core 2026 torso check for compact engines and immediate crippling for other engines', () => {
        const internalLocations = ['LT', 'RT', 'CT', 'LA', 'RA', 'LL', 'RL'];
        const compactUnit = createForceUnitHarness({
            engine: 'Compact',
            internalLocations,
            committedDestroyedLocations: ['CT'],
        });
        const xlUnit = createForceUnitHarness({
            engine: 'XL (IS)',
            internalLocations,
            committedDestroyedLocations: ['CT'],
        });

        expect(compactUnit.rules.hasComputedCondition('crippled')).toBeFalse();
        expect(compactUnit.turnState().getPSRChecks().some(check =>
            check.reason === 'Torso destroyed'
        )).toBeTrue();
        expect(xlUnit.rules.hasComputedCondition('crippled')).toBeTrue();
        expect(xlUnit.turnState().getPSRChecks().some(check =>
            check.reason === 'Torso destroyed'
        )).toBeFalse();
    });

    it('automatically cripples Core 2026 fusion Meks with two destroyed torsos without a check', () => {
        const forceUnit = createForceUnitHarness({
            internalLocations: ['LT', 'RT', 'CT', 'LA', 'RA', 'LL', 'RL'],
            committedDestroyedLocations: ['LT', 'RT'],
        });

        expect(forceUnit.rules.hasComputedCondition('crippled')).toBeTrue();
        expect(forceUnit.turnState().getPSRChecks().some(check =>
            check.reason === 'Torso destroyed'
        )).toBeFalse();
    });

    it('does not apply the Core 2026 torso crippling check to Total Warfare rules', () => {
        const forceUnit = createForceUnitHarness({
            rulesId: 'tw',
            forcedWithdrawal: false,
            internalLocations: ['LT', 'RT', 'CT', 'LA', 'RA', 'LL', 'RL'],
            committedDestroyedLocations: ['LT'],
        });

        expect(forceUnit.rules.hasComputedCondition('crippled')).toBeFalse();
        expect(forceUnit.turnState().getPSRChecks().some(check =>
            check.reason === 'Torso destroyed'
        )).toBeFalse();
    });

    it('includes pending fatal internal damage in Core 2026 limb criteria', () => {
        const forceUnit = createForceUnitHarness({
            internalLocations: ['LT', 'RT', 'CT', 'LA', 'RA', 'LL', 'RL'],
            committedDestroyedLocations: ['LA'],
        });

        expect(forceUnit.rules.hasComputedCondition('crippled')).toBeFalse();

        forceUnit.addInternalHits('LL', 1);

        expect(forceUnit.rules.hasComputedCondition('crippled')).toBeTrue();
    });

    it('retains Total Warfare crew and critical-damage crippling criteria', () => {
        expect(createRulesHarness({ rulesId: 'tw', crewHits: [4] }).hasComputedCondition('crippled')).toBeTrue();
        expect(createRulesHarness({ rulesId: 'tw', critSlots: [crit('Sensor'), crit('Sensor')] }).hasComputedCondition('crippled')).toBeTrue();
        expect(createRulesHarness({ rulesId: 'tw', critSlots: [crit('Gyro'), crit('Engine')] }).hasComputedCondition('crippled')).toBeTrue();
        expect(createRulesHarness({ rulesId: 'tw', critSlots: [crit('Engine'), crit('Engine')] }).hasComputedCondition('crippled')).toBeTrue();
        expect(createRulesHarness({ rulesId: 'tw', critSlots: [crit('Sensor'), crit('Sensor', false)] }).hasComputedCondition('crippled')).toBeFalse();
    });

    it('retains Total Warfare internal-damage crippling criteria', () => {
        expect(createRulesHarness({
            rulesId: 'tw',
            internalLocations: ['LT', 'RT', 'CT', 'LA', 'RA', 'LL', 'RL'],
            committedDestroyedLocations: ['LT'],
        }).hasComputedCondition('crippled')).toBeTrue();

        expect(createRulesHarness({
            rulesId: 'tw',
            internalLocations: ['LT', 'RT', 'CT', 'LA', 'RA', 'LL', 'RL'],
            locationPoints: 10,
            locationState: { LA: { internal: 1 }, RA: { internal: 1 }, LL: { internal: 1 } },
        }).hasComputedCondition('crippled')).toBeTrue();

        expect(createRulesHarness({
            rulesId: 'tw',
            internalLocations: ['LT', 'RT', 'CT', 'LA', 'RA', 'LL', 'RL'],
            locationPoints: 10,
            locationState: { CT: { internal: 1, armor: 10 }, RT: { internal: 1, armor: 10 } },
        }).hasComputedCondition('crippled')).toBeTrue();

        expect(createRulesHarness({
            rulesId: 'tw',
            internalLocations: ['LT', 'RT', 'CT', 'LA', 'RA', 'LL', 'RL'],
            locationPoints: 10,
            locationState: { CT: { internal: 1, armor: 0 }, RT: { internal: 1, armor: 10 } },
        }).hasComputedCondition('crippled')).toBeFalse();
    });

    it('keeps core2026 Meks mobile while a damage-available movement mode remains', () => {
        const forceUnit = createForceUnitHarness({
            internalLocations: ['LL', 'RA', 'RT'],
            committedDestroyedLocations: ['LL'],
        });

        expect(forceUnit.isInternalLocCommittedDestroyed('RA')).toBeFalse();
        expect(forceUnit.rules.hasComputedCondition('immobile')).toBeFalse();

        forceUnit.setLocations(createCommittedLocationState(['LL', 'RT']), true);

        expect(forceUnit.isInternalLocCommittedDestroyed('RA')).toBeTrue();
        expect(forceUnit.rules.hasComputedCondition('immobile')).toBeTrue();

        const twForceUnit = createForceUnitHarness({
            internalLocations: ['LL', 'RA', 'RT'],
            committedDestroyedLocations: ['LL', 'RA'],
            rulesId: 'tw',
        });
        expect(twForceUnit.rules.hasComputedCondition('immobile')).toBeTrue();
    });

    it('selects rules once while constructing each Mek', () => {
        const forceUnit = createForceUnitHarness({
            internalLocations: ['LL', 'RL'],
            committedDestroyedLocations: ['LL', 'RL'],
            jump: 0,
            umu: 0,
        });

        expect(forceUnit.gameRules.supportsLargeTarget).toBeTrue();
        expect(forceUnit.rules.hasComputedCondition('immobile')).toBeTrue();

        optionsService.options.update(options => ({ ...options, CBTRules: 'tw' }));
        expect(forceUnit.gameRules.supportsLargeTarget).toBeTrue();

        const twForceUnit = createForceUnitHarness({ rulesId: 'tw' });
        expect(twForceUnit.rules instanceof TWMekRules).toBeTrue();
        expect(twForceUnit.gameRules.supportsLargeTarget).toBeFalse();
    });

    it('uses the core2026 fixed 1/2 movement profile for one destroyed biped or tripod leg', () => {
        for (const internalLocations of [['LL', 'RL'], ['LL', 'CL', 'RL']]) {
            const rules = createRulesHarness({
                internalLocations,
                committedDestroyedLocations: ['LL'],
                walk: 5,
                run: 8,
            });

            expect(rules.movementState()).toEqual(jasmine.objectContaining({ walk: 1, run: 2, maxRun: 2 }));
            expect(rules.PSRModifiers().modifiers).toContain(jasmine.objectContaining({
                pilotCheck: 4, loc: 'LL', reason: 'Leg Destroyed',
            }));
        }
    });

    it('never lets destroyed-leg movement increase a slower biped', () => {
        const rules = createRulesHarness({
            committedDestroyedLocations: ['LL'],
            walk: 0,
            run: 1,
            jump: 0,
            umu: 0,
        });

        expect(rules.movementState()).toEqual(jasmine.objectContaining({ walk: 0, run: 0, maxRun: 0 }));
    });

    it('applies cumulative core2026 quadruped leg movement without forced checks for the first leg', () => {
        const locations = ['RLL', 'FLL', 'RRL', 'FRL'];
        const expected = [
            { destroyed: ['RLL'], walk: 4, run: 6, psr: 1 },
            { destroyed: ['RLL', 'FLL'], walk: 3, run: 5, psr: 2 },
            { destroyed: ['RLL', 'FLL', 'RRL'], walk: 1, run: 2, psr: 3 },
            { destroyed: locations, walk: 0, run: 0, psr: 4 },
        ];

        for (const scenario of expected) {
            const rules = createRulesHarness({
                internalLocations: locations,
                committedDestroyedLocations: scenario.destroyed,
                walk: 5,
                run: 8,
                jump: 0,
                umu: 0,
            });

            expect(rules.movementState()).toEqual(jasmine.objectContaining({ walk: scenario.walk, run: scenario.run }));
            expect(rules.PSRModifiers().modifiers
                .filter(modifier => modifier.reason === 'Leg Destroyed')
                .reduce((total, modifier) => total + (modifier.pilotCheck ?? 0), 0)).toBe(scenario.psr);
        }
    });

    it('requires one hex for running damage PSRs but checks zero-hex jumps', () => {
        const biped = createRulesHarness({ committedDestroyedLocations: ['LL'] });

        expect(biped.getCommittedDamageMovementModePSRCheck('run')?.loc).toBe('LL');
        expect(biped.getCommittedDamageMovementModePSRCheck('jump')?.loc).toBe('LL');
        expect(biped.getCommittedDamageMovementModePSRCheck('run')?.reason).toBe('Running with damaged leg');
        expect(biped.getCommittedDamageMovementModePSRCheck('jump')?.reason).toBe('Jumping with damaged leg');
        expect(biped.getCommittedDamageMovementModePSRCheck('run', 0)).toBeNull();
        expect(biped.getCommittedDamageMovementModePSRCheck('jump', 0)?.reason).toBe('Jumping with damaged leg');
        expect(biped.getCommittedDamageMovementModePSRCheck('jump', null)).toBeNull();
        expect(biped.getCommittedDamageMovementModePSRCheck('run', 1)?.reason).toBe('Running with damaged leg');
        expect(biped.getCommittedDamageMovementModePSRCheck('jump', 1)?.reason).toBe('Jumping with damaged leg');

        const oneLegQuad = createRulesHarness({
            internalLocations: ['RLL', 'FLL', 'RRL', 'FRL'],
            committedDestroyedLocations: ['RLL'],
        });
        const twoLegQuad = createRulesHarness({
            internalLocations: ['RLL', 'FLL', 'RRL', 'FRL'],
            committedDestroyedLocations: ['RLL', 'FLL'],
        });

        expect(oneLegQuad.getCommittedDamageMovementModePSRCheck('run', 1)).toBeNull();
        expect(twoLegQuad.getCommittedDamageMovementModePSRCheck('run', 1)?.reason).toBe('Running with damaged leg');
        expect(twoLegQuad.getCommittedDamageMovementModePSRCheck('run', 1)?.loc).toBeUndefined();
    });

    it('requires a jump PSR for foot damage without requiring a run PSR', () => {
        const rules = createRulesHarness({
            critSlots: [{ ...crit('Foot'), loc: 'RL' }],
        });

        expect(rules.getCommittedDamageMovementModePSRCheck('jump', 0)?.reason)
            .toBe('Jumping with damaged leg actuator');
        expect(rules.getCommittedDamageMovementModePSRCheck('run', 1)).toBeNull();
    });

    it('consolidates same-leg actuator hits into one Core PSR with cumulative modifiers', () => {
        const forceUnit = createForceUnitHarness({
            critSlots: [
                { ...legActuatorCrit('upper-leg', 'Upper Leg Actuator', 'LL', false), destroying: 1 },
                { ...legActuatorCrit('lower-leg', 'Lower Leg Actuator', 'LL', false), destroying: 1 },
                { ...legActuatorCrit('hip', 'Hip', 'LL', false), destroying: 1 },
            ],
        });
        const turnState = forceUnit.turnState();
        forceUnit.getCritSlots().forEach(slot => forceUnit.rules.evaluateCritSlotHit(slot));

        expect(turnState.getPSRCheckState().legActuators?.get('LL')).toBe(2);
        expect(turnState.getPSRCheckState().hipsHit?.has('LL')).toBeTrue();
        expect(turnState.getPSRChecks()).toEqual([jasmine.objectContaining({
            loc: 'LL',
            fallCheck: 3,
            pilotCheck: 3,
            reason: 'Hip hit, Leg Actuator hit',
            modifierReason: 'Hip hit, Leg Actuators hit (2)',
        })]);
        expect(turnState.PSRRollsCount()).toBe(1);
        expect(forceUnit.rules.PSRModifiers().modifier).toBe(3);
    });

    it('consolidates Core actuator triggers per leg rather than per unit', () => {
        const forceUnit = createForceUnitHarness();
        const turnState = forceUnit.turnState();
        turnState.setPSRCheckState({
            legActuators: new Map([['LL', 2], ['RL', 1]]),
            hipsHit: new Set(['RL']),
        });

        expect(turnState.getPSRChecks()).toEqual([
            jasmine.objectContaining({
                loc: 'LL', fallCheck: 2, pilotCheck: 2,
                reason: 'Leg Actuator hit', modifierReason: 'Leg Actuators hit (2)',
            }),
            jasmine.objectContaining({
                loc: 'RL', fallCheck: 2, pilotCheck: 2,
                reason: 'Hip hit, Leg Actuator hit', modifierReason: 'Hip hit, Leg Actuator hit',
            }),
        ]);
        expect(turnState.PSRRollsCount()).toBe(2);
        expect(forceUnit.rules.PSRModifiers().modifier).toBe(4);
    });

    it('stacks consolidated Core actuator modifiers onto every other phase PSR', () => {
        const forceUnit = createForceUnitHarness();
        const turnState = forceUnit.turnState();
        turnState.addDmgReceived(20);
        turnState.setPSRCheckState({
            hipsHit: new Set(['LL']),
            gyroHit: 1,
        });

        const checks = turnState.getPSRChecks();

        expect(checks.map(check => check.reason)).toEqual([
            'Received 20 damage',
            'Hip hit',
            'Gyro hit',
        ]);
        expect(checks.map(check => check.pilotCheck)).toEqual([1, 1, 2]);
        expect(checks.find(check => check.reason === 'Received 20 damage')?.loc).toBeUndefined();
        expect(checks.find(check => check.reason === 'Hip hit')?.loc).toBe('LL');
        expect(turnState.PSRRollsCount()).toBe(3);
        expect(forceUnit.rules.PSRModifiers().modifier).toBe(4);
    });

    it('uses one Core jump PSR for hip, leg, and foot damage in the same leg', () => {
        const forceUnit = createForceUnitHarness({
            critSlots: [
                legActuatorCrit('hip', 'Hip', 'LL'),
                legActuatorCrit('upper-leg', 'Upper Leg Actuator', 'LL'),
                legActuatorCrit('foot', 'Foot', 'LL'),
            ],
        });
        const turnState = forceUnit.turnState();
        turnState.moveMode.set('jump');
        turnState.moveDistance.set(1);

        expect(turnState.getPSRChecks()).toEqual([jasmine.objectContaining({
            loc: 'LL',
            fallCheck: 0,
            pilotCheck: 0,
            reason: 'Hip hit, Leg Actuator hit, Foot hit',
        })]);
        expect(turnState.PSRRollsCount()).toBe(1);
        expect(forceUnit.rules.PSRModifiers().modifier).toBe(3);
        expect(forceUnit.rules.PSRModifiers().modifiers).toEqual(jasmine.arrayContaining([
            jasmine.objectContaining({ pilotCheck: 1, loc: 'LL', reason: 'Hip Destroyed' }),
            jasmine.objectContaining({ pilotCheck: 1, loc: 'LL', reason: 'Leg Actuator(s) Destroyed' }),
            jasmine.objectContaining({ pilotCheck: 1, loc: 'LL', reason: 'Foot Actuator(s) Destroyed' }),
        ]));
    });

    it('uses separate Core jump PSRs for actuator damage in different legs', () => {
        const forceUnit = createForceUnitHarness({
            critSlots: [
                legActuatorCrit('upper-leg', 'Upper Leg Actuator', 'LL'),
                legActuatorCrit('foot', 'Foot', 'LL'),
                legActuatorCrit('hip', 'Hip', 'RL'),
            ],
        });
        const turnState = forceUnit.turnState();
        turnState.moveMode.set('jump');
        turnState.moveDistance.set(1);

        expect(turnState.getPSRChecks()).toEqual([
            jasmine.objectContaining({ loc: 'LL', reason: 'Leg Actuator hit, Foot hit' }),
            jasmine.objectContaining({ loc: 'RL', reason: 'Hip hit' }),
        ]);
        expect(turnState.PSRRollsCount()).toBe(2);
        expect(forceUnit.rules.PSRModifiers().modifier).toBe(3);
    });

    it('keeps pre-existing destroyed actuator modifiers grouped by location', () => {
        const forceUnit = createForceUnitHarness({
            critSlots: [
                legActuatorCrit('upper-leg', 'Upper Leg Actuator', 'LL'),
                legActuatorCrit('lower-leg', 'Lower Leg Actuator', 'LL'),
                legActuatorCrit('foot', 'Foot', 'RL'),
            ],
        });

        expect(forceUnit.rules.PSRModifiers().modifier).toBe(3);
        expect(forceUnit.rules.PSRModifiers().modifiers).toEqual(jasmine.arrayContaining([
            jasmine.objectContaining({
                pilotCheck: 2,
                loc: 'LL',
                reason: 'Leg Actuator(s) Destroyed',
                modifierReason: 'Leg Actuators Destroyed (2)',
            }),
            jasmine.objectContaining({
                pilotCheck: 1,
                loc: 'RL',
                reason: 'Foot Actuator(s) Destroyed',
                modifierReason: 'Foot Actuator Destroyed',
            }),
        ]));
    });

    it('merges current and movement actuator triggers for the same Core leg', () => {
        const forceUnit = createForceUnitHarness({
            critSlots: [legActuatorCrit('lower-leg', 'Lower Leg Actuator', 'LL')],
        });
        const turnState = forceUnit.turnState();
        turnState.setPSRCheckState({ hipsHit: new Set(['LL']) });
        turnState.moveMode.set('jump');
        turnState.moveDistance.set(1);

        expect(turnState.getPSRChecks()).toEqual([jasmine.objectContaining({
            loc: 'LL',
            fallCheck: 1,
            pilotCheck: 1,
            reason: 'Hip hit, Leg Actuator hit',
        })]);
        expect(turnState.PSRRollsCount()).toBe(1);
        expect(forceUnit.rules.PSRModifiers().modifier).toBe(2);
    });

    it('keeps the Core2026 PSR modifier unchanged when a second gyro hit causes autofall', () => {
        for (const critSlots of [
            [
                { ...crit('Gyro'), id: 'gyro-1', loc: 'CT', slot: 0 },
                { ...crit('Gyro', false), id: 'gyro-2', loc: 'CT', slot: 1, destroying: Date.now() },
            ],
            [
                { ...crit('Gyro', false), id: 'gyro-1', loc: 'CT', slot: 0, destroying: Date.now() },
                { ...crit('Gyro', false), id: 'gyro-2', loc: 'CT', slot: 1, destroying: Date.now() },
            ],
        ]) {
            const forceUnit = createForceUnitHarness({ critSlots });
            const turnState = forceUnit.turnState();
            turnState.setPSRCheckState({ gyroHit: 2, gyroDestroyed: true });

            expect(forceUnit.rules.autoFall()).toBeTrue();
            expect(turnState.getPSRChecks()).toContain(jasmine.objectContaining({
                fallCheck: 2,
                pilotCheck: 2,
                loc: 'CT',
                reason: 'Gyro hit',
            }));
            expect(forceUnit.rules.PSRModifiers().modifier).toBe(2);
        }
    });

    it('retains the TW destroyed-gyro PSR', () => {
        const forceUnit = createForceUnitHarness({
            rulesId: 'tw',
            critSlots: [
                { ...crit('Gyro'), id: 'gyro-1', loc: 'CT', slot: 0 },
                { ...crit('Gyro', false), id: 'gyro-2', loc: 'CT', slot: 1, destroying: Date.now() },
            ],
        });
        const turnState = forceUnit.turnState();
        turnState.setPSRCheckState({ gyroHit: 1, gyroDestroyed: true });

        expect(forceUnit.rules.autoFall()).toBeTrue();
        expect(turnState.getPSRChecks()).toContain(jasmine.objectContaining({
            fallCheck: 100,
            pilotCheck: 6,
            loc: 'CT',
            reason: 'Gyro destroyed',
        }));
    });

    it('applies +1 per destroyed Core2026 Heavy-Duty Gyro slot without forcing a hit PSR', () => {
        for (const destroyedCount of [1, 2, 3]) {
            const forceUnit = createForceUnitHarness({
                critSlots: Array.from({ length: 4 }, (_, index) => heavyDutyGyroCrit(index, index < destroyedCount)),
            });
            const turnState = forceUnit.turnState();
            turnState.setPSRCheckState({ gyroHit: 1, gyroDestroyed: false });

            expect(turnState.getPSRChecks().some(check => check.reason === 'Gyro hit')).toBeFalse();
            expect(forceUnit.rules.PSRModifiers()).toEqual(jasmine.objectContaining({ modifier: destroyedCount }));
            expect(forceUnit.rules.PSRModifiers().modifiers).toContain(jasmine.objectContaining({
                pilotCheck: destroyedCount,
                reason: 'Heavy-Duty Gyro damaged',
            }));
        }
    });

    it('applies pending Core2026 Heavy-Duty Gyro modifiers before commit', () => {
        for (const pendingHitCount of [1, 2, 3]) {
            const forceUnit = createForceUnitHarness({
                critSlots: Array.from({ length: 4 }, (_, index) => ({
                    ...heavyDutyGyroCrit(index, false),
                    destroying: index < pendingHitCount ? Date.now() : undefined,
                })),
            });
            const turnState = forceUnit.turnState();
            turnState.setPSRCheckState({ gyroHit: pendingHitCount, gyroDestroyed: false });

            expect(turnState.getPSRChecks()).toEqual([]);
            expect(forceUnit.rules.PSRModifiers()).toEqual(jasmine.objectContaining({ modifier: pendingHitCount }));
            expect(forceUnit.rules.PSRModifiers().modifiers).toContain(jasmine.objectContaining({
                pilotCheck: pendingHitCount,
                reason: 'Heavy-Duty Gyro damaged',
            }));
        }
    });

    it('requires an exact +2 PSR for jumping but no PSR for running with Heavy-Duty Gyro damage', () => {
        const rules = createRulesHarness({
            critSlots: [heavyDutyGyroCrit(0), heavyDutyGyroCrit(1, false), heavyDutyGyroCrit(2, false), heavyDutyGyroCrit(3, false)],
        });

        expect(rules.getCommittedDamageMovementModePSRCheck('run', 1)).toBeNull();
        expect(rules.getCommittedDamageMovementModePSRCheck('jump', 1)).toEqual(jasmine.objectContaining({
            fallCheck: 2,
            pilotCheck: 2,
            loc: 'CT',
            reason: 'Jumping with damaged heavy-duty gyro',
            ignorePreExistingGyro: true,
        }));
    });

    it('destroys a Core2026 Heavy-Duty Gyro on the fourth hit, not the third', () => {
        const thirdHitUnit = createForceUnitHarness({
            critSlots: [
                heavyDutyGyroCrit(0),
                heavyDutyGyroCrit(1),
                { ...heavyDutyGyroCrit(2, false), destroying: Date.now() },
                heavyDutyGyroCrit(3, false),
            ],
        });
        const thirdHit = thirdHitUnit.getCritSlots()[2];
        thirdHitUnit.rules.evaluateCritSlotHit(thirdHit);
        expect(thirdHitUnit.turnState().getPSRCheckState().gyroDestroyed).toBeFalse();
        expect(thirdHitUnit.rules.autoFall()).toBeFalse();

        const fourthHitUnit = createForceUnitHarness({
            critSlots: [
                heavyDutyGyroCrit(0),
                heavyDutyGyroCrit(1),
                heavyDutyGyroCrit(2),
                { ...heavyDutyGyroCrit(3, false), destroying: Date.now() },
            ],
        });
        const fourthHit = fourthHitUnit.getCritSlots()[3];
        fourthHitUnit.rules.evaluateCritSlotHit(fourthHit);
        expect(fourthHitUnit.turnState().getPSRCheckState().gyroDestroyed).toBeTrue();
        expect(fourthHitUnit.rules.autoFall()).toBeTrue();
        expect(fourthHitUnit.turnState().getPSRChecks()).toEqual([]);
    });

    it('retains TW Heavy-Duty Gyro run checks and third-hit destruction', () => {
        const forceUnit = createForceUnitHarness({
            rulesId: 'tw',
            critSlots: [
                heavyDutyGyroCrit(0),
                heavyDutyGyroCrit(1),
                { ...heavyDutyGyroCrit(2, false), destroying: Date.now() },
            ],
        });
        const thirdHit = forceUnit.getCritSlots()[2];
        forceUnit.rules.evaluateCritSlotHit(thirdHit);

        expect(forceUnit.rules.getCommittedDamageMovementModePSRCheck('run', 1)?.reason).toBe('Running with damaged gyro');
        expect(forceUnit.turnState().getPSRCheckState().gyroDestroyed).toBeTrue();
    });

    it('uses core2026 hip, foot, gyro, and lower-arm modifiers with TW overrides', () => {
        const forceUnit = createForceUnitHarness({
            internalLocations: ['LL', 'RL', 'LA', 'RA'],
            critSlots: [
                { ...crit('Hip'), loc: 'LL' },
                { ...crit('Foot'), loc: 'RL' },
                { ...crit('Gyro'), loc: 'CT' },
                { ...crit('Lower Arm'), loc: 'LA' },
            ],
        });
        const rules = forceUnit.rules as MekRules;
        const armWeapon = directFireWeaponEntry(forceUnit);
        armWeapon.locations = new Set(['LA']);

        expect(rules.PSRModifiers().modifiers).toContain(jasmine.objectContaining({
            pilotCheck: 1, loc: 'LL', reason: 'Hip Destroyed',
        }));
        expect(rules.PSRModifiers().modifiers.some(modifier => modifier.reason === 'Leg Actuator(s) Destroyed')).toBeFalse();
        expect(rules.PSRModifiers().modifiers).toContain(jasmine.objectContaining({ pilotCheck: 2, reason: 'Gyro damaged' }));
        expect(rules.computeEntryState(armWeapon).hitMod).toBe(0);

        const twForceUnit = createForceUnitHarness({
            internalLocations: ['LL', 'RL', 'LA', 'RA'],
            critSlots: [
                { ...crit('Hip'), loc: 'LL' },
                { ...crit('Foot'), loc: 'RL' },
                { ...crit('Gyro'), loc: 'CT' },
                { ...crit('Lower Arm'), loc: 'LA' },
            ],
            rulesId: 'tw',
        });
        const twRules = twForceUnit.rules as MekRules;
        const twArmWeapon = directFireWeaponEntry(twForceUnit);
        twArmWeapon.locations = new Set(['LA']);
        expect(twRules.PSRModifiers().modifiers).toContain(jasmine.objectContaining({
            pilotCheck: 2, loc: 'LL', reason: 'Hip Destroyed',
        }));
        expect(twRules.PSRModifiers().modifiers).toContain(jasmine.objectContaining({
            pilotCheck: 1, loc: 'RL', reason: 'Leg Actuator(s) Destroyed',
        }));
        expect(twRules.PSRModifiers().modifiers).toContain(jasmine.objectContaining({ pilotCheck: 3, reason: 'Gyro damaged' }));
        expect(twRules.computeEntryState(twArmWeapon).hitMod).toBe(1);
    });

    it('treats adding flooded and blown-off Mek locations as pending until phase commit', () => {
        const forceUnit = createForceUnitHarness({ internalLocations: ['LL', 'RL'] });

        expect(forceUnit.isInternalLocCommittedDestroyed('LL')).toBeFalse();
        expect(forceUnit.isArmorLocCommittedDestroyed('LL')).toBeFalse();

        forceUnit.setLocationCondition('LL', 'flooded', true);

        expect(forceUnit.getLocationCondition('LL', 'flooded')).toBeTrue();
        expect(forceUnit.isInternalLocDestroyed('LL')).toBeTrue();
        expect(forceUnit.turnState().dirtyPhase()).toBeTrue();
        expect(forceUnit.serialize().state.locations['LL'].conditions).toEqual([{ key: 'flooded', pending: true }]);
        expect(forceUnit.isInternalLocCommittedDestroyed('LL')).toBeFalse();
        expect(forceUnit.isArmorLocCommittedDestroyed('LL')).toBeFalse();

        forceUnit.endPhase();

        expect(forceUnit.isInternalLocCommittedDestroyed('LL')).toBeTrue();
        expect(forceUnit.isArmorLocCommittedDestroyed('LL')).toBeTrue();
        expect(forceUnit.serialize().state.locations['LL'].conditions).toEqual(['flooded']);

        forceUnit.setLocationCondition('LL', 'flooded', false);

        expect(forceUnit.getLocationCondition('LL', 'flooded')).toBeFalse();
        expect(forceUnit.isInternalLocCommittedDestroyed('LL')).toBeFalse();
        expect(forceUnit.serialize().state.locations['LL']).toBeUndefined();

        forceUnit.setLocationCondition('RL', 'blown-off', true);

        expect(forceUnit.isInternalLocCommittedDestroyed('LL')).toBeFalse();
        expect(forceUnit.isInternalLocCommittedDestroyed('RL')).toBeFalse();

        forceUnit.endPhase();

        expect(forceUnit.isInternalLocCommittedDestroyed('RL')).toBeTrue();
    });

    it('does not disable inventory in pending destructive location conditions until phase commit', () => {
        const forceUnit = createForceUnitHarness({ internalLocations: ['LL'] });
        const rules = forceUnit.rules as MekRules;
        const entry = new MountedEquipment({ owner: forceUnit, id: 'test-entry', name: 'Test Entry', locations: new Set(['LL']) });

        forceUnit.setLocationCondition('LL', 'flooded', true);

        expect(rules.computeEntryState(entry)).toEqual(jasmine.objectContaining({ isDamaged: false, isDisabled: false }));

        forceUnit.endPhase();

        expect(rules.computeEntryState(entry)).toEqual(jasmine.objectContaining({ isDamaged: false, isDisabled: true }));

        forceUnit.setLocationCondition('LL', 'flooded', false);

        expect(rules.computeEntryState(entry)).toEqual(jasmine.objectContaining({ isDamaged: false, isDisabled: false }));
    });

    it('marks blown-off location inventory as damaged and disabled without destroying it', () => {
        const forceUnit = createForceUnitHarness({ internalLocations: ['LL'] });
        const rules = forceUnit.rules as MekRules;
        const critSlot = { id: 'test-weapon', name: 'Test Weapon', loc: 'LL', slot: 0 } as CriticalSlot;
        const entry = new MountedEquipment({ owner: forceUnit, id: 'test-entry', name: 'Test Entry', locations: new Set(['LL']), critSlots: [critSlot] });

        forceUnit.writeCrits([critSlot]);
        forceUnit.setInventory([entry]);
        const storedEntry = forceUnit.getInventory().find(item => item.id === entry.id)!;
        forceUnit.setLocationCondition('LL', 'blown-off', true);
        forceUnit.endPhase();
        rules.computeAllEntryStates();

        expect(forceUnit.isInternalLocCommittedPhysicallyDestroyed('LL')).toBeTrue();
        expect(forceUnit.getCritSlots().every(slot => !slot.destroying && !slot.destroyed)).toBeTrue();
        expect(storedEntry.committedDestroyed()).toBeFalse();
        expect(rules.computeEntryState(storedEntry)).toEqual(jasmine.objectContaining({ isDamaged: true, isDisabled: true }));
    });

    it('marks inventory in structurally destroyed locations as damaged and disabled', () => {
        const forceUnit = createForceUnitHarness({ internalLocations: ['LL'] });
        const rules = forceUnit.rules as MekRules;
        const critSlot = { id: 'test-weapon', name: 'Test Weapon', loc: 'LL', slot: 0 } as CriticalSlot;
        const entry = new MountedEquipment({ owner: forceUnit, id: 'test-entry', name: 'Test Entry', locations: new Set(['LL']), critSlots: [critSlot] });

        forceUnit.writeCrits([critSlot]);
        forceUnit.setInventory([entry]);
        const storedEntry = forceUnit.getInventory().find(item => item.id === entry.id)!;
        forceUnit.addInternalHits('LL', forceUnit.getInternalPoints('LL'));
        forceUnit.endPhase();
        const entryStates = rules.computeAllEntryStates();

        expect(forceUnit.isInternalLocCommittedStructurallyDestroyed('LL')).toBeTrue();
        expect(storedEntry.committedDestroyed()).toBeFalse();
        expect(entryStates.get(storedEntry)).toEqual(jasmine.objectContaining({ isDamaged: true, isDisabled: true }));
        expect(rules.computeEntryState(storedEntry)).toEqual(jasmine.objectContaining({ isDamaged: true, isDisabled: true }));
    });

    it('marks linked locations blown off by parent structural destruction as damaged and disabled', () => {
        const forceUnit = createForceUnitHarness({ internalLocations: ['RT', 'RA'] });
        const rules = forceUnit.rules as MekRules;
        const parentCrit = { id: 'parent-weapon', name: 'Parent Weapon', loc: 'RT', slot: 0 } as CriticalSlot;
        const linkedCrit = { id: 'linked-weapon', name: 'Linked Weapon', loc: 'RA', slot: 0 } as CriticalSlot;
        const parentEntry = new MountedEquipment({ owner: forceUnit, id: 'parent-entry', name: 'Parent Entry', locations: new Set(['RT']), critSlots: [parentCrit] });
        const linkedEntry = new MountedEquipment({ owner: forceUnit, id: 'linked-entry', name: 'Linked Entry', locations: new Set(['RA']), critSlots: [linkedCrit] });

        forceUnit.writeCrits([parentCrit, linkedCrit]);
        forceUnit.setInventory([parentEntry, linkedEntry]);
        const storedParentEntry = forceUnit.getInventory().find(item => item.id === parentEntry.id)!;
        const storedLinkedEntry = forceUnit.getInventory().find(item => item.id === linkedEntry.id)!;
        forceUnit.addInternalHits('RT', forceUnit.getInternalPoints('RT'));
        forceUnit.endPhase();
        const entryStates = rules.computeAllEntryStates();

        expect(forceUnit.isInternalLocCommittedStructurallyDestroyed('RT')).toBeTrue();
        expect(forceUnit.isInternalLocCommittedStructurallyDestroyed('RA')).toBeFalse();
        expect(forceUnit.isInternalLocCommittedPhysicallyDestroyed('RA')).toBeTrue();
        expect(storedParentEntry.committedDestroyed()).toBeFalse();
        expect(storedLinkedEntry.committedDestroyed()).toBeFalse();
        expect(entryStates.get(storedParentEntry)).toEqual(jasmine.objectContaining({ isDamaged: true, isDisabled: true }));
        expect(entryStates.get(storedLinkedEntry)).toEqual(jasmine.objectContaining({ isDamaged: true, isDisabled: true }));
        expect(rules.computeEntryState(storedParentEntry)).toEqual(jasmine.objectContaining({ isDamaged: true, isDisabled: true }));
        expect(rules.computeEntryState(storedLinkedEntry)).toEqual(jasmine.objectContaining({ isDamaged: true, isDisabled: true }));
    });

    it('disables linked-location inventory from flooded torsos without marking it damaged', () => {
        const forceUnit = createForceUnitHarness({ internalLocations: ['LT', 'LA'] });
        const rules = forceUnit.rules as MekRules;
        const entry = new MountedEquipment({ owner: forceUnit, id: 'left-arm-entry', name: 'Left Arm Entry', locations: new Set(['LA']) });

        forceUnit.setLocationCondition('LT', 'flooded', true);
        forceUnit.endPhase();

        expect(forceUnit.isInternalLocCommittedDestroyed('LA')).toBeTrue();
        expect(forceUnit.isInternalLocCommittedPhysicallyDestroyed('LA')).toBeFalse();
        expect(rules.computeEntryState(entry)).toEqual(jasmine.objectContaining({ isDamaged: false, isDisabled: true }));
    });

    it('counts flooded critical slots as functionally destroyed without committing crit destruction', () => {
        const forceUnit = createForceUnitHarness({ internalLocations: ['LT'] });
        forceUnit.writeCrits([
            { id: 'engine-1', name: 'Engine', loc: 'LT', slot: 0 },
            { id: 'engine-2', name: 'Engine', loc: 'LT', slot: 1 },
            { id: 'engine-3', name: 'Engine', loc: 'LT', slot: 2 },
        ] as CriticalSlot[]);

        forceUnit.setLocationCondition('LT', 'flooded', true);
        forceUnit.endPhase();

        expect(forceUnit.destroyed).toBeTrue();
        expect(forceUnit.getCritSlots().every(slot => !slot.destroying && !slot.destroyed)).toBeTrue();
    });

    it('stores counted NARC location state without destroying the location', () => {
        const forceUnit = createForceUnitHarness({ internalLocations: ['LL'] });

        forceUnit.setLocationConditionValue('LL', 'narc', 2);

        expect(forceUnit.getLocationConditionValue('LL', 'narc')).toBe(2);
        expect(forceUnit.isInternalLocCommittedDestroyed('LL')).toBeFalse();
        expect(forceUnit.serialize().state.locations['LL'].conditions).toEqual([{ key: 'narc', value: 2 }]);
    });

    it('removes NARC from a location once physical internal destruction is committed', () => {
        const forceUnit = createForceUnitHarness({ internalLocations: ['LL'] });

        forceUnit.setLocationConditionValue('LL', 'narc', 2);
        forceUnit.addInternalHits('LL', forceUnit.getInternalPoints('LL'));

        expect(forceUnit.getLocationConditionValue('LL', 'narc')).toBe(2);

        forceUnit.endPhase();

        expect(forceUnit.isInternalLocCommittedPhysicallyDestroyed('LL')).toBeTrue();
        expect(forceUnit.getLocationConditionValue('LL', 'narc')).toBeUndefined();
        expect(forceUnit.serialize().state.locations['LL'].conditions).toBeUndefined();
    });

    it('removes NARC from a location once blown-off is committed', () => {
        const forceUnit = createForceUnitHarness({ internalLocations: ['LL'] });

        forceUnit.setLocationConditionValue('LL', 'narc', 2);
        forceUnit.setLocationCondition('LL', 'blown-off', true);

        expect(forceUnit.getLocationConditionValue('LL', 'narc')).toBe(2);

        forceUnit.endPhase();

        expect(forceUnit.isInternalLocCommittedPhysicallyDestroyed('LL')).toBeTrue();
        expect(forceUnit.getLocationConditionValue('LL', 'narc')).toBeUndefined();
        expect(forceUnit.serialize().state.locations['LL'].conditions).toEqual(['blown-off']);
    });
});
