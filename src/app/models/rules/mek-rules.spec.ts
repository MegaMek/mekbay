// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import { Injector } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { CBTForce } from '../cbt-force.model';
import { CBTForceUnit } from '../cbt-force-unit.model';
import { DEAD_CREW_HIT_THRESHOLD, type CrewMemberState } from '../crew-member.model';
import { MountedEquipment, MountedWeapon } from '../mounted-equipment.model';
import { type CriticalSlot, type LocationData } from '../force-serialization';
import { AmmoEquipment, Equipment, WeaponEquipment, type AmmoType } from '../equipment.model';
import { EquipmentRegistry } from '../equipment-lookup';
import type { UnitSummary, UnitComponent, UnitSubtype } from '../unit-summary.model';
import { DataService } from '../../services/data.service';
import { EquipmentInteractionRegistryService } from '../../services/equipment-interaction-registry.service';
import { UnitInitializerService } from '../../services/unit-initializer.service';
import { createEmptyUnit } from '../../testing/unit-test-helpers';
import { type ToHitModifierBreakdownEntry } from './game-rules';
import { ENTRY_DISABLED_STATE_KEY, ENTRY_DISABLED_STATE_VALUE, PSR_CHECK_KIND, PSR_FAILURE_KIND } from './unit-type-rules';
import { MekRules } from './mek-rules';
import { MascHandler, MASC_ACTIVE_STATE_KEY } from '../../equipment-handlers/masc.handler';
import { HAG_FLAK_MODE, HAG_MODE_STATE_KEY, HAG_STANDARD_MODE, HagHandler } from '../../equipment-handlers/hag.handler';
import { OptionsService } from '../../services/options.service';
import { TWMekRules } from './tw-rules';
import { VIBROBLADE_MODE_STATE, VIBROBLADE_ON_MODE, VibrobladeHandler } from '../../equipment-handlers/vibroblade.handler';
import { PPC_CAPACITOR_CHARGED_STATE, PPC_CAPACITOR_CHARGING_STATE, PPC_CAPACITOR_STATE_KEY, PpcCapacitorHandler } from '../../equipment-handlers/ppc-capacitor.handler';
import { EquipmentFlag } from '../equipment-flags.type';
import { isInventoryControlSelectableEntry, syncSvgMode } from '../../utils/inventory-control.util';
import { MEK_LOCATIONS, MEK_QUAD_LOCATIONS, MEK_TRIPOD_LOCATIONS } from '../entity/types';

class TestCBTForce extends CBTForce {
    override emitChanged(): void {
    }
}

let dataService: jasmine.SpyObj<DataService>;
let unitInitializer: UnitInitializerService;
let injector: Injector;
let optionsService: OptionsService;

function toHitModifierTotal(modifiers: readonly ToHitModifierBreakdownEntry[]): number {
    return modifiers.reduce((total, modifier) => total + modifier.modifier, 0);
}

function hasWeakenedHitModifier(modifiers: readonly ToHitModifierBreakdownEntry[]): boolean {
    return modifiers.some(modifier => modifier.weakened === true);
}

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
    components?: UnitComponent[];
} = {}): MekRules {
    return createForceUnitHarness(options).rules as MekRules;
}

function createCommittedLocationState(committedDestroyedLocations: string[] = []): Record<string, LocationData> {
    return committedDestroyedLocations.reduce<Record<string, LocationData>>((state, loc) => {
        state[loc] = { internal: 1 };
        return state;
    }, {});
}

function normalizeGeneratedCriticalSlots(criticalSlots: readonly CriticalSlot[]): CriticalSlot[] {
    const usedSlotsByLocation = new Map<string, Set<number>>();
    const idCounts = new Map<string, number>();

    for (const criticalSlot of criticalSlots) {
        if (criticalSlot.loc && criticalSlot.slot !== undefined) {
            const usedSlots = usedSlotsByLocation.get(criticalSlot.loc) ?? new Set<number>();
            usedSlots.add(criticalSlot.slot);
            usedSlotsByLocation.set(criticalSlot.loc, usedSlots);
        }
    }

    return criticalSlots.map(criticalSlot => {
        let normalized = criticalSlot;
        if (criticalSlot.loc && criticalSlot.slot === undefined) {
            const usedSlots = usedSlotsByLocation.get(criticalSlot.loc) ?? new Set<number>();
            let slot = 0;
            while (usedSlots.has(slot)) slot++;
            usedSlots.add(slot);
            usedSlotsByLocation.set(criticalSlot.loc, usedSlots);
            normalized = { ...normalized, slot };
        }

        if (!normalized.loc || normalized.slot === undefined) {
            const count = idCounts.get(normalized.id) ?? 0;
            idCounts.set(normalized.id, count + 1);
            if (count > 0) normalized = { ...normalized, id: `${normalized.id}-${count}` };
        }
        return normalized;
    });
}

function canonicalMekInternalLocations(subtype: UnitSubtype, requested: readonly string[] = []): string[] {
    const isQuad = subtype.startsWith('Quad')
        || requested.some(loc => ['FLL', 'FRL', 'RLL', 'RRL'].includes(loc));
    const isTripod = subtype.startsWith('Tripod') || requested.includes('CL');
    const canonical: readonly string[] = isQuad
        ? MEK_QUAD_LOCATIONS
        : isTripod
            ? MEK_TRIPOD_LOCATIONS
            : MEK_LOCATIONS;
    return [...new Set([...canonical, ...requested])];
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
    components?: UnitComponent[];
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
        comp: options.components ?? [],
    });

    dataService.getUnitByName.and.callFake((name: string): UnitSummary | undefined => name === baseUnit.name ? baseUnit : undefined);
    const force = new TestCBTForce('Test Force', dataService, unitInitializer, injector);
    const forceUnit = new CBTForceUnit(baseUnit, force, dataService, unitInitializer, injector);
    const internalLocations = canonicalMekInternalLocations(baseUnit.subtype, options.internalLocations);
    const locationPoints = options.locationPoints ?? 1;
    forceUnit.locations = {
        internal: new Map(internalLocations.map(loc => [loc, { loc, points: locationPoints }])),
        armor: new Map(internalLocations.map(loc => [loc, { loc, rear: false, points: locationPoints }])),
    };

    forceUnit.setLocations(options.locationState ?? createCommittedLocationState(options.committedDestroyedLocations), true);
    if (options.critSlots) {
        const targetingComputer = miscEquipment('ISTargeting Computer', 'Targeting Computer', ['F_TARGETING_COMPUTER']);
        const criticalSlots = normalizeGeneratedCriticalSlots(options.critSlots).map(slot =>
            slot.name === 'Targeting Computer' ? { ...slot, eq: targetingComputer } : slot
        );
        forceUnit.writeCrits(criticalSlots);
        const targetingComputerSlots = criticalSlots.filter(slot => slot.eq === targetingComputer);
        if (targetingComputerSlots.length > 0) {
            forceUnit.setInventory([new MountedEquipment({
                owner: forceUnit,
                id: targetingComputer.id,
                name: targetingComputer.id,
                equipment: targetingComputer,
                critSlots: targetingComputerSlots,
            })]);
        }
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

function clawEntry(forceUnit: CBTForceUnit, loc: 'LA' | 'RA' = 'LA'): MountedEquipment {
    return new MountedEquipment({
        owner: forceUnit,
        id: `ISClaw@${loc}`,
        name: 'Claw',
        equipment: miscEquipment('ISClaw', 'Claw', ['F_HAND_WEAPON', 'S_CLAW']),
        locations: new Set([loc]),
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
    const slotByActuator: Record<string, number> = {
        hip: 0,
        'upper-leg': 1,
        'lower-leg': 2,
        foot: 3,
    };
    return {
        id,
        name,
        loc,
        slot: slotByActuator[id],
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

function createShieldHarness(
    rulesId: 'core2026' | 'tw',
    destroyedShieldCriticals = 0,
): { forceUnit: CBTForceUnit; shield: MountedEquipment } {
    const shieldEquipment = miscEquipment(
        'ISMediumShield',
        'Shield (Medium)',
        ['F_SHIELD', 'S_SHIELD_MEDIUM'],
    );
    const tsm = miscEquipment('TSM', 'Triple Strength Myomer', ['F_TSM']);
    const shieldCriticals: CriticalSlot[] = Array.from({ length: 5 }, (_, index) => ({
        ...crit('Shield (Medium)', index < destroyedShieldCriticals),
        id: `ISMediumShield@LA#${index + 4}`,
        loc: 'LA',
        slot: index + 4,
        eq: shieldEquipment,
    }));
    const forceUnit = createForceUnitHarness({
        rulesId,
        tons: 70,
        internalLocations: ['LA', 'RA', 'LL', 'RL', 'RT'],
        critSlots: [
            ...armCritSlots('LA'),
            ...armCritSlots('RA'),
            ...shieldCriticals,
            { ...crit('Triple Strength Myomer', false), loc: 'RT', slot: 0, eq: tsm },
        ],
    });
    forceUnit.locations!.armor.set('DALA', { loc: 'DALA', rear: false, points: 5 });
    forceUnit.locations!.armor.set('DCLA', { loc: 'DCLA', rear: false, points: 18 });
    const currentShieldCriticals = forceUnit.getCritSlots().filter(slot => slot.eq === shieldEquipment);
    forceUnit.setInventory([new MountedEquipment({
        owner: forceUnit,
        id: 'ISMediumShield@LA',
        name: 'Shield (Medium)',
        equipment: shieldEquipment,
        locations: new Set(['LA']),
        critSlots: currentShieldCriticals,
    })]);
    return { forceUnit, shield: forceUnit.getInventory()[0] };
}

function unitComponent(equipment: Equipment, quantity: number, location: string): UnitComponent {
    return {
        id: equipment.id,
        q: quantity,
        n: equipment.name,
        t: 'C',
        p: 0,
        l: location,
        eq: equipment,
    };
}

function createShieldPropulsionHarness(
    rulesId: 'core2026' | 'tw',
    size: 'medium' | 'large',
    destroyedShieldCriticals = 0,
): { forceUnit: CBTForceUnit; shield: MountedEquipment } {
    const large = size === 'large';
    const shieldEquipment = miscEquipment(
        large ? 'ISLargeShield' : 'ISMediumShield',
        large ? 'Shield (Large)' : 'Shield (Medium)',
        ['F_SHIELD', large ? 'S_SHIELD_LARGE' : 'S_SHIELD_MEDIUM'],
    );
    const jumpJet = miscEquipment('ISJumpJet', 'Jump Jet', ['F_JUMP_JET']);
    const umu = miscEquipment('ISUMU', 'UMU', ['F_UMU']);
    const shieldCriticalCount = large ? 7 : 5;
    const shieldCriticals: CriticalSlot[] = Array.from({ length: shieldCriticalCount }, (_, index) => ({
        ...crit(shieldEquipment.name, index < destroyedShieldCriticals),
        id: `${shieldEquipment.id}@LA#${index + 4}`,
        loc: 'LA',
        slot: index + 4,
        eq: shieldEquipment,
    }));
    const forceUnit = createForceUnitHarness({
        rulesId,
        walk: 4,
        run: 6,
        jump: large ? 0 : 2,
        umu: large ? 0 : 2,
        components: [
            unitComponent(jumpJet, 3, 'LT'),
            unitComponent(umu, 2, 'RT'),
        ],
        internalLocations: ['LA', 'RA', 'LT', 'RT', 'LL', 'RL'],
        critSlots: [
            ...armCritSlots('LA'),
            ...armCritSlots('RA'),
            ...shieldCriticals,
            ...Array.from({ length: 3 }, (_, index) => ({
                ...crit('Jump Jet', false),
                id: `jump-jet-${index}`,
                loc: 'LT',
                slot: index,
                eq: jumpJet,
            })),
            ...Array.from({ length: 2 }, (_, index) => ({
                ...crit('UMU', false),
                id: `umu-${index}`,
                loc: 'RT',
                slot: index,
                eq: umu,
            })),
        ],
    });
    forceUnit.locations!.armor.set('DALA', {
        loc: 'DALA', rear: false, points: large ? 7 : 5,
    });
    forceUnit.locations!.armor.set('DCLA', {
        loc: 'DCLA', rear: false, points: large ? 25 : 18,
    });
    const currentShieldCriticals = forceUnit.getCritSlots().filter(slot => slot.eq === shieldEquipment);
    forceUnit.setInventory([new MountedEquipment({
        owner: forceUnit,
        id: `${shieldEquipment.id}@LA`,
        name: shieldEquipment.name,
        equipment: shieldEquipment,
        locations: new Set(['LA']),
        critSlots: currentShieldCriticals,
    })]);
    return { forceUnit, shield: forceUnit.getInventory()[0] };
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
        states: new Map([[HAG_MODE_STATE_KEY, mode]])
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
    it('subtracts the remaining partial-wing bonus from jump heat without reducing minimum heat', () => {
        const partialWing = miscEquipment('ISPartialWing', 'Partial Wing', ['F_PARTIAL_WING']);
        const scenarios = [
            { label: 'intact light or medium wing', tons: 55, distance: 6, destroyedCrits: 0, expectedHeat: 4 },
            { label: 'damaged light or medium wing', tons: 55, distance: 6, destroyedCrits: 1, expectedHeat: 5 },
            { label: 'minimum standard jump heat', tons: 55, distance: 3, destroyedCrits: 0, expectedHeat: 3 },
        ];

        for (const scenario of scenarios) {
            const critSlots = Array.from({ length: scenario.destroyedCrits + 1 }, (_, index) => ({
                ...crit('Partial Wing', index < scenario.destroyedCrits),
                id: `partial-wing-${index}`,
                loc: 'CT',
                slot: index,
                eq: partialWing,
            }));
            const forceUnit = createForceUnitHarness({ tons: scenario.tons, critSlots });
            const turnState = forceUnit.turnState();
            turnState.moveMode.set('jump');
            turnState.moveDistance.set(scenario.distance);

            expect(forceUnit.rules.heatSources(turnState).find(source => source.id === 'movement')?.value)
                .withContext(scenario.label)
                .toBe(scenario.expectedHeat);
        }
    });

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

    it('owns the ruleset-specific standing-up PSR modifier in Mek rules', () => {
        expect(createRulesHarness().standingUpPSRModifier).toBe(-1);
        expect(createRulesHarness({ rulesId: 'tw' }).standingUpPSRModifier).toBe(0);
    });

    it('removes a broken targeting computer modifier from direct-fire weapons at every range', () => {
        const activeForceUnit = createForceUnitHarness({ critSlots: [crit('Targeting Computer', false)] });
        const destroyedForceUnit = createForceUnitHarness({ critSlots: [crit('Targeting Computer')] });
        const ranges = ['short', 'medium', 'long'] as const;

        const activeEntry = directFireWeaponEntry(activeForceUnit);
        const destroyedEntry = directFireWeaponEntry(destroyedForceUnit);
        const activeModifiers = activeForceUnit.rules.getEquipmentToHitModifiers(activeEntry);
        const destroyedModifiers = destroyedForceUnit.rules.getEquipmentToHitModifiers(destroyedEntry);
        const ineligibleModifiers = destroyedForceUnit.rules.getEquipmentToHitModifiers(directFireWeaponEntry(destroyedForceUnit, ['F_TASER']));
        const destroyedTargetingComputer = destroyedForceUnit.getMountedEquipmentByFlag('F_TARGETING_COMPUTER')[0];

        expect(destroyedTargetingComputer).toBeDefined();
        expect(destroyedForceUnit.isEquipmentOperational(destroyedTargetingComputer)).toBeFalse();
        expect(toHitModifierTotal(activeModifiers)).toBe(-1);
        expect(toHitModifierTotal(destroyedModifiers)).toBe(0);
        expect(toHitModifierTotal(ineligibleModifiers)).toBe(0);
        expect(hasWeakenedHitModifier(activeModifiers)).toBeFalse();
        expect(hasWeakenedHitModifier(destroyedModifiers)).toBeTrue();
        expect(hasWeakenedHitModifier(ineligibleModifiers)).toBeFalse();
        expect(destroyedModifiers).toEqual([
            { label: 'Targeting Computer Destroyed', modifier: 0, weakened: true }
        ]);

        for (const range of ranges) {
            const activeResolution = activeForceUnit.gameRules.resolveToHit({
                subject: activeEntry,
                range,
                stateModifiers: activeModifiers,
            });
            const destroyedResolution = destroyedForceUnit.gameRules.resolveToHit({
                subject: destroyedEntry,
                range,
                stateModifiers: destroyedModifiers,
            });

            expect(activeResolution.value)
                .withContext(`functional targeting computer at ${range} range`)
                .toBe(-1);
            expect(activeResolution.weakened)
                .withContext(`functional targeting computer weakened state at ${range} range`)
                .toBeFalse();
            expect(destroyedResolution.value)
                .withContext(`destroyed targeting computer at ${range} range`)
                .toBe(0);
            expect(destroyedResolution.weakened)
                .withContext(`destroyed targeting computer weakened state at ${range} range`)
                .toBeTrue();
            expect(destroyedResolution.modifierBreakdown)
                .withContext(`destroyed targeting computer breakdown at ${range} range`)
                .toEqual([{ label: 'Targeting Computer Destroyed', modifier: 0, weakened: true }]);
        }
    });

    it('labels a disabled targeting computer as disabled instead of destroyed', () => {
        const forceUnit = createForceUnitHarness({ critSlots: [crit('Targeting Computer', false)] });
        const targetingComputer = forceUnit.getMountedEquipmentByFlag('F_TARGETING_COMPUTER')[0];
        targetingComputer.states.set(ENTRY_DISABLED_STATE_KEY, ENTRY_DISABLED_STATE_VALUE);
        forceUnit.setInventoryEntry(targetingComputer);

        expect(forceUnit.getEquipmentStatus(targetingComputer)).toBe('disabled');
        expect(forceUnit.rules.getEquipmentToHitModifiers(directFireWeaponEntry(forceUnit))).toEqual([{
            label: 'Targeting Computer Disabled',
            modifier: 0,
            weakened: true,
        }]);
    });

    it('keeps Mek sensor and actuator failures in action policy instead of equipment status', () => {
        const sensorDisabledUnit = createForceUnitHarness({
            critSlots: [
                { ...crit('Sensor'), id: 'head-sensor-1', loc: 'HD', slot: 0 },
                { ...crit('Sensor'), id: 'head-sensor-2', loc: 'HD', slot: 1 },
            ],
            internalLocations: ['HD', 'LA', 'RA', 'LL', 'RL'],
        });
        const weapon = directFireWeaponEntry(sensorDisabledUnit);

        expect(sensorDisabledUnit.getEquipmentStatus(weapon)).toBe('available');
        expect(sensorDisabledUnit.canPerformEquipmentAction(weapon, 'fire')).toBeFalse();

        const actuatorDisabledUnit = createForceUnitHarness({
            critSlots: armCritSlots('LA').map(slot => slot.name === 'Shoulder'
                ? { ...slot, destroyed: 1 }
                : slot),
            internalLocations: ['LA', 'RA', 'LL', 'RL'],
        });
        const punch = punchEntry(actuatorDisabledUnit);
        const club = new MountedEquipment({
            owner: actuatorDisabledUnit,
            id: 'club',
            name: 'club',
            intrinsicPhysicalAttack: true,
        });
        const hatchet = new MountedEquipment({
            owner: actuatorDisabledUnit,
            id: 'hatchet@LA',
            name: 'Hatchet',
            equipment: miscEquipment('Hatchet', 'Hatchet', ['F_HAND_WEAPON']),
            locations: new Set(['LA']),
        });

        expect(actuatorDisabledUnit.getEquipmentStatus(punch)).toBe('available');
        expect(actuatorDisabledUnit.getEquipmentStatus(club)).toBe('available');
        expect(actuatorDisabledUnit.getEquipmentStatus(hatchet)).toBe('available');
        expect(actuatorDisabledUnit.canPerformEquipmentAction(punch, 'physical-attack')).toBeFalse();
        expect(actuatorDisabledUnit.canPerformEquipmentAction(club, 'physical-attack')).toBeFalse();
        expect(actuatorDisabledUnit.canPerformEquipmentAction(hatchet, 'physical-attack')).toBeFalse();
    });

    it('removes the targeting computer bonus when any critical in its installation is destroyed', () => {
        const forceUnit = createForceUnitHarness({
            critSlots: [
                { ...crit('Targeting Computer', false), id: 'targeting-computer-1', loc: 'LT', slot: 0 },
                { ...crit('Targeting Computer'), id: 'targeting-computer-2', loc: 'LT', slot: 1 },
                { ...crit('Targeting Computer', false), id: 'targeting-computer-3', loc: 'RT', slot: 0 },
            ],
            internalLocations: ['LT', 'RT'],
        });

        const modifiers = forceUnit.rules.getEquipmentToHitModifiers(directFireWeaponEntry(forceUnit));

        expect(toHitModifierTotal(modifiers)).toBe(0);
        expect(modifiers).toEqual([
            { label: 'Targeting Computer Destroyed', modifier: 0, weakened: true }
        ]);
    });

    it('resolves stored PPC capacitor states without cycling', () => {
        TestBed.inject(EquipmentInteractionRegistryService).getRegistry().register(new PpcCapacitorHandler());
        const forceUnit = createForceUnitHarness({ critSlots: [crit('Targeting Computer', false)] });
        const capacitor = new MountedEquipment({
            owner: forceUnit,
            id: 'PPC Capacitor',
            name: 'PPC Capacitor',
            equipment: new Equipment({
                id: 'PPC Capacitor',
                name: 'PPC Capacitor',
                type: 'misc',
                flags: ['F_WEAPON_ENHANCEMENT', 'F_PPC_CAPACITOR'],
            }),
        });
        const weapon = new MountedWeapon({
            owner: forceUnit,
            id: 'Light PPC',
            name: 'Light PPC',
            equipment: new WeaponEquipment({
                id: 'Light PPC',
                name: 'Light PPC',
                type: 'weapon',
                flags: ['F_PPC', 'F_DIRECT_FIRE', 'F_ENERGY', 'F_PPC_CAPACITOR_COMPATIBLE'],
                weapon: { damage: 5, ranges: [3, 6, 9, 12], ammoType: 'NA' },
            }),
        });
        weapon.linkedWith = [capacitor];
        forceUnit.setInventory([...forceUnit.getInventory(), weapon, capacitor]);

        const stored = () => ({
            weapon: forceUnit.getInventory().find(entry => entry.id === weapon.id) as MountedWeapon,
            capacitor: forceUnit.getInventory().find(entry => entry.id === capacitor.id)!,
        });
        const expectTargetingComputerApplies = (context: string) => {
            const current = stored();
            expect(current.weapon).withContext(`${context}: stored weapon`).toBeDefined();
            expect(current.capacitor).withContext(`${context}: stored capacitor`).toBeDefined();
            expect(current.weapon.linkedWith).withContext(`${context}: stored link`).toContain(current.capacitor);
            expect(() => forceUnit.rules.getEquipmentToHitModifiers(current.weapon))
                .withContext(`${context}: no query cycle`)
                .not.toThrow();
            expect(forceUnit.rules.getEquipmentToHitModifiers(current.weapon))
                .withContext(`${context}: targeting computer modifier`)
                .toContain(jasmine.objectContaining({ label: 'Targeting Computer', modifier: -1 }));
        };

        expectTargetingComputerApplies('discharged');

        let current = stored();
        current.capacitor.setState(PPC_CAPACITOR_STATE_KEY, PPC_CAPACITOR_CHARGING_STATE);
        forceUnit.setInventoryEntry(current.capacitor);
        expectTargetingComputerApplies('charging');

        current = stored();
        current.capacitor.setState(PPC_CAPACITOR_STATE_KEY, PPC_CAPACITOR_CHARGED_STATE);
        forceUnit.setInventoryEntry(current.capacitor);
        expectTargetingComputerApplies('charged');

        current = stored();
        current.capacitor.setCommittedDestroyed(true);
        forceUnit.setInventoryEntry(current.capacitor);
        expectTargetingComputerApplies('unavailable');
    });

    it('removes a broken targeting computer modifier from each VSP laser range', () => {
        const activeForceUnit = createForceUnitHarness({ critSlots: [crit('Targeting Computer', false)] });
        const destroyedForceUnit = createForceUnitHarness({ critSlots: [crit('Targeting Computer')] });
        const ranges = [
            { range: 'short' as const, baseValue: -3, activeValue: -4 },
            { range: 'medium' as const, baseValue: -2, activeValue: -3 },
            { range: 'long' as const, baseValue: -1, activeValue: -2 },
        ];

        const activeEntry = mediumVspLaserEntry(activeForceUnit);
        const activeModifiers = activeForceUnit.rules.getEquipmentToHitModifiers(activeEntry);
        expect(activeEntry.parent).toBeInstanceOf(MountedWeapon);
        expect((activeEntry.parent as MountedWeapon).getWeaponTypes()).toContain('P');
        expect(toHitModifierTotal(activeModifiers)).toBe(-1);
        for (const expected of ranges) {
            expect(activeForceUnit.gameRules.resolveToHit({
                subject: activeEntry,
                range: expected.range,
                stateModifiers: activeModifiers,
            }).value).withContext(`functional targeting computer at ${expected.range} range`).toBe(expected.activeValue);
        }

        const destroyedEntry = mediumVspLaserEntry(destroyedForceUnit);
        const destroyedModifiers = destroyedForceUnit.rules.getEquipmentToHitModifiers(destroyedEntry);
        const destroyedTargetingComputer = destroyedForceUnit.getMountedEquipmentByFlag('F_TARGETING_COMPUTER')[0];

        expect(destroyedTargetingComputer).toBeDefined();
        expect(destroyedForceUnit.isEquipmentOperational(destroyedTargetingComputer)).toBeFalse();
        expect(toHitModifierTotal(destroyedModifiers)).toBe(0);
        expect(destroyedModifiers).toEqual([
            { label: 'Targeting Computer Destroyed', modifier: 0, weakened: true }
        ]);
        for (const expected of ranges) {
            const destroyedResolution = destroyedForceUnit.gameRules.resolveToHit({
                subject: destroyedEntry,
                range: expected.range,
                stateModifiers: destroyedModifiers,
            });

            expect(destroyedResolution.value)
                .withContext(`destroyed targeting computer at ${expected.range} VSP range`)
                .toBe(expected.baseValue);
            expect(destroyedResolution.weakened)
                .withContext(`destroyed targeting computer weakened state at ${expected.range} VSP range`)
                .toBeTrue();
            expect(destroyedResolution.modifierBreakdown)
                .withContext(`destroyed targeting computer breakdown at ${expected.range} VSP range`)
                .toEqual([
                    { label: 'Base Hit Modifier', modifier: expected.baseValue },
                    { label: 'Targeting Computer Destroyed', modifier: 0, weakened: true },
                ]);
        }
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
            const stateModifiers = forceUnit.rules.getEquipmentToHitModifiers(entry);
            const effectiveTypes = forceUnit.getEffectiveWeaponTypes(entry);
            const resolution = forceUnit.gameRules.resolveToHit({
                subject: entry,
                stateModifiers,
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

        const activePunch = activeForceUnit.rules.getEquipmentToHitModifiers(punch(activeForceUnit));
        const destroyedPunch = destroyedForceUnit.rules.getEquipmentToHitModifiers(punch(destroyedForceUnit));
        const activeSword = activeForceUnit.rules.getEquipmentToHitModifiers(sword(activeForceUnit));
        const destroyedSword = destroyedForceUnit.rules.getEquipmentToHitModifiers(sword(destroyedForceUnit));
        expect(toHitModifierTotal(activePunch)).toBe(-1);
        expect(toHitModifierTotal(destroyedPunch)).toBe(0);
        expect(toHitModifierTotal(activeSword)).toBe(-1);
        expect(toHitModifierTotal(destroyedSword)).toBe(0);
        expect(hasWeakenedHitModifier(activePunch)).toBeFalse();
        expect(hasWeakenedHitModifier(destroyedPunch)).toBeTrue();
        expect(hasWeakenedHitModifier(activeSword)).toBeFalse();
        expect(hasWeakenedHitModifier(destroyedSword)).toBeTrue();
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

        const punchModifiers = forceUnit.rules.getEquipmentToHitModifiers(punch);
        expect(toHitModifierTotal(punchModifiers)).toBe(5);
        expect(punchModifiers).toEqual([
            { label: 'Hand Actuator Destroyed (LA)', modifier: 1, weakened: true },
            { label: 'Upper Arm Actuator Destroyed (LA)', modifier: 2, weakened: true },
            { label: 'Lower Arm Actuator Destroyed (LA)', modifier: 2, weakened: true }
        ]);
    });

    it('applies missing punch actuator modifiers as design penalties without weakening', () => {
        const scenarios = [
            { label: 'fully actuated', options: {}, hitMod: 0, breakdown: [] },
            {
                label: 'missing hand', options: { hand: 'missing' as const }, hitMod: 1,
                breakdown: [{ label: 'Hand Actuator Missing (LA)', modifier: 1 }]
            },
            {
                label: 'missing lower arm', options: { lowerArm: 'missing' as const }, hitMod: 2,
                breakdown: [{ label: 'Lower Arm Actuator Missing (LA)', modifier: 2 }]
            },
            {
                label: 'missing hand and lower arm',
                options: { hand: 'missing' as const, lowerArm: 'missing' as const },
                hitMod: 3,
                breakdown: [
                    { label: 'Hand Actuator Missing (LA)', modifier: 1 },
                    { label: 'Lower Arm Actuator Missing (LA)', modifier: 2 }
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
                const stateModifiers = forceUnit.rules.getEquipmentToHitModifiers(punch);
                const resolution = forceUnit.gameRules.resolveToHit({
                    subject: punch,
                    stateModifiers,
                });
                const rulesBase = rulesId === 'core2026' ? -1 : 0;

                expect(stateModifiers).withContext(`${rulesId}: ${scenario.label}`).toEqual(scenario.breakdown);
                expect(resolution.value).withContext(`${rulesId}: ${scenario.label} resolved modifier`)
                    .toBe(rulesBase + scenario.hitMod);
                expect(resolution.weakened).withContext(`${rulesId}: ${scenario.label} resolved weakening`).toBeFalse();
            }
        }
    });

    it('distinguishes destroyed lower-arm punch damage from design-reduced base damage', () => {
        const missingLowerArmUnit = createForceUnitHarness({
            tons: 60,
            critSlots: armCritSlots('LA', { lowerArm: 'missing' }),
            internalLocations: ['LA', 'RA', 'LL', 'RL'],
        });
        const destroyedLowerArmUnit = createForceUnitHarness({
            tons: 60,
            critSlots: armCritSlots('LA', { lowerArm: 'destroyed' }),
            internalLocations: ['LA', 'RA', 'LL', 'RL'],
        });

        expect((missingLowerArmUnit.rules as MekRules).computeMeleeDamage(6, 'punch', 'LA')).toEqual({ damage: 3, maxDamage: 3 });
        expect((destroyedLowerArmUnit.rules as MekRules).computeMeleeDamage(6, 'punch', 'LA')).toEqual({ damage: 3, maxDamage: 3 });
        expect((missingLowerArmUnit.rules as MekRules).resolveInventoryMeleeDamageDisplay(
            punchEntry(missingLowerArmUnit), '3', 'punch', 'LA'
        )).toEqual({ damage: 3, text: '3', weakened: false });
        expect((destroyedLowerArmUnit.rules as MekRules).resolveInventoryMeleeDamageDisplay(
            punchEntry(destroyedLowerArmUnit), '6', 'punch', 'LA'
        )).toEqual({ damage: 3, text: '3', weakened: true });
        expect(toHitModifierTotal(destroyedLowerArmUnit.rules.getEquipmentToHitModifiers(punchEntry(destroyedLowerArmUnit))))
            .toBe(2);
    });

    it('rounds odd Land-Air BattleMek punch damage up after halving it', () => {
        const forceUnit = createForceUnitHarness({
            tons: 45,
            subtype: 'Land-Air BattleMek',
            critSlots: armCritSlots('LA'),
            internalLocations: ['LA', 'RA', 'LL', 'RL'],
        });

        expect((forceUnit.rules as MekRules).resolveInventoryMeleeDamageDisplay(
            punchEntry(forceUnit),
            '5',
            'punch',
            'LA',
        )).toEqual({ damage: 3, text: '3', weakened: false });
    });

    it('adds the Core shield bash bonus before the TSM punch multiplier', () => {
        const { forceUnit, shield } = createShieldHarness('core2026');
        const rules = forceUnit.rules as MekRules;
        const sheetDisplay = {
            name: 'Shield (Medium)', location: 'LA', heat: '—', damage: '15', hit: '-2',
            min: '—', short: '—', medium: '—', long: '—',
        };

        expect(rules.computeMeleeDamage(7, 'punch', 'LA')).toEqual({ damage: 9, maxDamage: 18 });
        expect(rules.computeMeleeDamage(7, 'punch', 'RA')).toEqual({ damage: 7, maxDamage: 14 });
        expect(rules.applyInventoryControlDisplayEffects(punchEntry(forceUnit), {
            ...sheetDisplay,
            name: 'Punch',
            damage: '9 [18]',
        }).damage).toBe('9 [18]');
        expect(rules.resolveShieldDamageDisplay(shield)).toEqual({ damage: 2, text: '+2', weakened: false });
        expect(rules.applyInventoryControlDisplayEffects(shield, sheetDisplay).damage).toBe('+2');
        expect(rules.canPerformEquipmentAction(shield, 'physical-attack')).toBeFalse();
        expect(rules.hasIndependentInventoryControlAction(shield)).toBeFalse();
        expect(isInventoryControlSelectableEntry(shield)).toBeFalse();
    });

    it('shows the Core shield bash modifier for every shield size', () => {
        for (const [sizeFlag, bashBonus] of [
            ['S_SHIELD_SMALL', 1],
            ['S_SHIELD_MEDIUM', 2],
            ['S_SHIELD_LARGE', 3],
        ] as const) {
            const forceUnit = createForceUnitHarness({ rulesId: 'core2026' });
            const shield = new MountedEquipment({
                owner: forceUnit,
                id: `Shield@${sizeFlag}`,
                name: 'Shield',
                equipment: miscEquipment(`Shield-${sizeFlag}`, 'Shield', ['F_SHIELD', sizeFlag]),
                locations: new Set(['LA']),
            });
            forceUnit.setInventory([shield]);
            const rules = forceUnit.rules as MekRules;

            expect(rules.resolveShieldDamageDisplay(shield)).toEqual({
                damage: bashBonus,
                text: `+${bashBonus}`,
                weakened: false,
            });
        }
    });

    it('changes the Core shield bash bonus only when shield destruction or repair commits', () => {
        const { forceUnit, shield } = createShieldHarness('core2026');
        const rules = forceUnit.rules as MekRules;
        const punchDamage = () => rules.computeMeleeDamage(7, 'punch', 'LA');
        const shieldDamage = () => rules.resolveShieldDamageDisplay(shield);

        expect(punchDamage()).toEqual({ damage: 9, maxDamage: 18 });
        expect(shieldDamage()).toEqual({ damage: 2, text: '+2', weakened: false });

        expect(shield.setPendingDestroyed(true)).toBeTrue();
        expect(shield.isDestroying()).toBeTrue();
        expect(punchDamage()).toEqual({ damage: 9, maxDamage: 18 });
        expect(shieldDamage()).toEqual({ damage: 2, text: '+2', weakened: false });

        expect(shield.commitPendingDestroyed()).toBeTrue();
        expect(punchDamage()).toEqual({ damage: 7, maxDamage: 14 });
        expect(shieldDamage()).toEqual({ damage: null, text: '—', weakened: false });

        expect(shield.setPendingDestroyed(false)).toBeTrue();
        expect(shield.isRepairing()).toBeTrue();
        expect(punchDamage()).toEqual({ damage: 7, maxDamage: 14 });
        expect(shieldDamage()).toEqual({ damage: null, text: '—', weakened: false });

        expect(shield.commitPendingDestroyed()).toBeTrue();
        expect(punchDamage()).toEqual({ damage: 9, maxDamage: 18 });
        expect(shieldDamage()).toEqual({ damage: 2, text: '+2', weakened: false });
    });

    it('keeps TW punches unchanged and calculates historical shield damage without TSM', () => {
        const { forceUnit, shield } = createShieldHarness('tw');
        const rules = forceUnit.rules as MekRules;
        const sheetDisplay = {
            name: 'Shield (Medium)', location: 'LA', heat: '—', damage: '—', hit: '-2',
            min: '—', short: '—', medium: '—', long: '—',
        };

        expect(rules.computeMeleeDamage(7, 'punch', 'LA')).toEqual({ damage: 7, maxDamage: 14 });
        expect(rules.applyInventoryControlDisplayEffects(punchEntry(forceUnit), {
            ...sheetDisplay,
            name: 'Punch',
            damage: '9 [18]',
        }).damage).toBe('7 [14]');
        expect(rules.resolveShieldDamageDisplay(shield)).toEqual({ damage: 5, text: '5', weakened: false });
        expect(rules.applyInventoryControlDisplayEffects(shield, sheetDisplay).damage).toBe('5');
        expect(rules.canPerformEquipmentAction(shield, 'physical-attack')).toBeTrue();
        expect(rules.hasIndependentInventoryControlAction(shield)).toBeTrue();
        expect(isInventoryControlSelectableEntry(shield)).toBeTrue();
    });

    it('does not render either passive Core or active TW shields as disabled inventory', () => {
        for (const rulesId of ['core2026', 'tw'] as const) {
            const { forceUnit, shield } = createShieldHarness(rulesId);
            const el = document.createElementNS('http://www.w3.org/2000/svg', 'g');
            el.classList.add('inventoryEntry');
            shield.el = el;
            forceUnit.setInventoryControlEntrySelected(shield, true);

            syncSvgMode(shield, null);

            expect(el.classList.contains('disabledInventory'))
                .withContext(rulesId)
                .toBeFalse();
            expect(el.classList.contains('selected'))
                .withContext(rulesId)
                .toBe(rulesId === 'tw');
        }
    });

    it('calculates shield critical damage and suppresses a Core bonus at zero capacity', () => {
        const damagedTW = createShieldHarness('tw', 1);
        expect((damagedTW.forceUnit.rules as MekRules).resolveShieldDamageDisplay(damagedTW.shield))
            .toEqual({ damage: 4, text: '4', weakened: true });
        expect(damagedTW.forceUnit.isEquipmentOperational(damagedTW.shield)).toBeTrue();
        expect(damagedTW.forceUnit.canPerformEquipmentAction(damagedTW.shield, 'physical-attack')).toBeTrue();

        const depletedCore = createShieldHarness('core2026', 4);
        expect((depletedCore.forceUnit.rules as MekRules).computeMeleeDamage(7, 'punch', 'LA'))
            .toEqual({ damage: 7, maxDamage: 14 });
        expect(depletedCore.forceUnit.isEquipmentOperational(depletedCore.shield)).toBeFalse();
    });

    it('subtracts 1 DA and 5 DC for every destroyed shield critical in both rulesets', () => {
        for (const rulesId of ['core2026', 'tw'] as const) {
            const { forceUnit } = createShieldHarness(rulesId, 1);
            const rules = forceUnit.rules as MekRules;

            expect(rules.getShieldTrackHits('DALA')).withContext(`${rulesId} DA`).toBe(1);
            expect(rules.getShieldTrackHits('DCLA')).withContext(`${rulesId} DC`).toBe(5);
        }
    });

    it('uses exhausted DA or DC for Core shield mobility but retains the TW modifier', () => {
        for (const track of ['DALA', 'DCLA'] as const) {
            const core = createShieldHarness('core2026');
            const tw = createShieldHarness('tw');
            const hits = core.forceUnit.getArmorPoints(track);
            core.forceUnit.setArmorHits(track, hits);
            tw.forceUnit.setArmorHits(track, hits);

            expect((core.forceUnit.rules as MekRules).movementState())
                .withContext(`Core ${track}`)
                .toEqual(jasmine.objectContaining({ walk: 6, run: 9 }));
            expect(core.forceUnit.isEquipmentOperational(core.shield))
                .withContext(`Core ${track}`)
                .toBeFalse();
            expect((tw.forceUnit.rules as MekRules).movementState())
                .withContext(`TW ${track}`)
                .toEqual(jasmine.objectContaining({ walk: 5, run: 8 }));
            expect(tw.forceUnit.isEquipmentOperational(tw.shield))
                .withContext(`TW ${track}`)
                .toBeFalse();
        }
    });

    it('removes the shield mobility modifier at the ruleset-specific destruction threshold', () => {
        const coreZeroCapacity = createShieldHarness('core2026', 4);
        const twOneCriticalRemaining = createShieldHarness('tw', 4);
        const twAllCriticalsDestroyed = createShieldHarness('tw', 5);

        expect((coreZeroCapacity.forceUnit.rules as MekRules).movementState())
            .toEqual(jasmine.objectContaining({ walk: 6, run: 9 }));
        expect((twOneCriticalRemaining.forceUnit.rules as MekRules).movementState())
            .toEqual(jasmine.objectContaining({ walk: 5, run: 8 }));
        expect((twAllCriticalsDestroyed.forceUnit.rules as MekRules).movementState())
            .toEqual(jasmine.objectContaining({ walk: 6, run: 9 }));
    });

    it('restores shield-suppressed Jump and UMU from installed propulsion', () => {
        for (const rulesId of ['core2026', 'tw'] as const) {
            const activeMedium = createShieldPropulsionHarness(rulesId, 'medium');
            const destroyedMedium = createShieldPropulsionHarness(rulesId, 'medium', 5);
            const activeLarge = createShieldPropulsionHarness(rulesId, 'large');
            const destroyedLarge = createShieldPropulsionHarness(rulesId, 'large', 7);

            expect((activeMedium.forceUnit.rules as MekRules).movementState())
                .withContext(`${rulesId} active medium shield`)
                .toEqual(jasmine.objectContaining({ walk: 4, jump: 2, UMU: 2 }));
            expect((destroyedMedium.forceUnit.rules as MekRules).movementState())
                .withContext(`${rulesId} destroyed medium shield`)
                .toEqual(jasmine.objectContaining({ walk: 5, jump: 3, UMU: 2 }));
            expect((activeLarge.forceUnit.rules as MekRules).movementState())
                .withContext(`${rulesId} active large shield`)
                .toEqual(jasmine.objectContaining({ walk: 4, jump: 0, UMU: 0 }));
            expect((destroyedLarge.forceUnit.rules as MekRules).movementState())
                .withContext(`${rulesId} destroyed large shield`)
                .toEqual(jasmine.objectContaining({ walk: 5, jump: 3, UMU: 2 }));

            const activeModes = activeLarge.forceUnit.getAvailableMotiveModes(false).map(option => option.mode);
            const restoredModes = destroyedLarge.forceUnit.getAvailableMotiveModes(false).map(option => option.mode);
            expect(activeModes).withContext(`${rulesId} active large shield modes`).not.toContain('jump');
            expect(activeModes).withContext(`${rulesId} active large shield modes`).not.toContain('UMU');
            expect(restoredModes).withContext(`${rulesId} destroyed large shield modes`).toContain('jump');
            expect(restoredModes).withContext(`${rulesId} destroyed large shield modes`).toContain('UMU');
        }
    });

    it('uses Core DA exhaustion but TW critical destruction to restore shield-suppressed Jump', () => {
        const core = createShieldPropulsionHarness('core2026', 'medium');
        const tw = createShieldPropulsionHarness('tw', 'medium');
        core.forceUnit.setArmorHits('DALA', 5);
        tw.forceUnit.setArmorHits('DALA', 5);

        expect((core.forceUnit.rules as MekRules).movementState())
            .toEqual(jasmine.objectContaining({ jump: 3 }));
        expect((tw.forceUnit.rules as MekRules).movementState())
            .toEqual(jasmine.objectContaining({ jump: 2 }));
    });

    it('uses DA zero in Core but all unavailable shield criticals in TW for the mobility modifier', () => {
        const core = createShieldHarness('core2026');
        const tw = createShieldHarness('tw');
        for (const forceUnit of [core.forceUnit, tw.forceUnit]) {
            for (const slot of forceUnit.getCritSlots().filter(candidate =>
                candidate.loc === 'LA' && !candidate.eq?.hasFlag('F_SHIELD'))) {
                forceUnit.setCritLoc({ ...slot, destroyed: 1 });
            }
        }

        expect((core.forceUnit.rules as MekRules).movementState())
            .toEqual(jasmine.objectContaining({ walk: 6, run: 9 }));
        expect((tw.forceUnit.rules as MekRules).movementState())
            .toEqual(jasmine.objectContaining({ walk: 5, run: 8 }));

        tw.forceUnit.setLocations(createCommittedLocationState(['LA']), true);

        expect((tw.forceUnit.rules as MekRules).movementState())
            .toEqual(jasmine.objectContaining({ walk: 6, run: 9 }));
    });

    it('restores ended equipment penalties before applying movement damage', () => {
        const shieldEquipment = miscEquipment(
            'ISMediumShield',
            'Shield (Medium)',
            ['F_SHIELD', 'S_SHIELD_MEDIUM'],
        );
        const modularArmor = miscEquipment(
            'ISModularArmor',
            'Modular Armor',
            ['F_MODULAR_ARMOR'],
        );
        const shieldCriticals: CriticalSlot[] = Array.from({ length: 5 }, (_, index) => ({
            ...crit('Shield (Medium)'),
            id: `ISMediumShield@LA#${index + 4}`,
            loc: 'LA',
            slot: index + 4,
            eq: shieldEquipment,
        }));
        const forceUnit = createForceUnitHarness({
            rulesId: 'tw',
            walk: 2,
            run: 3,
            internalLocations: ['LA', 'RA', 'LT', 'LL', 'RL'],
            critSlots: [
                ...shieldCriticals,
                { ...crit('Modular Armor', false), id: 'modular-armor', loc: 'LT', slot: 0, eq: modularArmor },
                { ...crit('Hip'), id: 'left-hip', loc: 'LL', slot: 0 },
            ],
        });
        const currentShieldCriticals = forceUnit.getCritSlots().filter(slot => slot.eq === shieldEquipment);
        forceUnit.setInventory([new MountedEquipment({
            owner: forceUnit,
            id: 'ISMediumShield@LA',
            name: 'Shield (Medium)',
            equipment: shieldEquipment,
            locations: new Set(['LA']),
            critSlots: currentShieldCriticals,
        })]);

        // Stored Walk 2 includes both -1 penalties. The destroyed shield first
        // restores the live base to 3; the surviving modular armor remains baked
        // in, then the TW hip hit halves 3 to 2.
        expect((forceUnit.rules as MekRules).movementState())
            .toEqual(jasmine.objectContaining({ walk: 2, run: 3 }));
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

        const pushModifiers = forceUnit.rules.getEquipmentToHitModifiers(push);
        expect(toHitModifierTotal(pushModifiers)).toBe(1);
        expect(pushModifiers).toEqual([
            { label: 'Shoulder Destroyed (LA)', modifier: 2, weakened: true },
            { label: 'Paired Arm AES', modifier: -1 }
        ]);
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

        const kickModifiers = forceUnit.rules.getEquipmentToHitModifiers(kick);
        expect(toHitModifierTotal(kickModifiers)).toBe(4);
        expect(kickModifiers).toEqual([
            { label: 'Leg Actuators Destroyed ×2', modifier: 4, weakened: true },
            { label: 'Foot Actuator Destroyed', modifier: 1, weakened: true },
            { label: 'Leg AES', modifier: -1 }
        ]);
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

        const swordModifiers = forceUnit.rules.getEquipmentToHitModifiers(sword);
        expect(toHitModifierTotal(swordModifiers)).toBe(3);
        expect(swordModifiers).toEqual([
            { label: 'Upper Arm Actuator Destroyed (LA)', modifier: 2, weakened: true },
            { label: 'Lower Arm Actuator Destroyed (LA)', modifier: 2, weakened: true },
            { label: 'Arm AES (LA)', modifier: -1 }
        ]);
    });

    it('halves claw damage for destroyed upper and lower arm actuators', () => {
        const tsm = miscEquipment('TSM', 'Triple Strength Myomer', ['F_TSM']);
        const scenarios = [
            { destroyed: ['Upper Arm Actuator'], expected: '4 [8]' },
            { destroyed: ['Lower Arm Actuator'], expected: '4 [8]' },
            { destroyed: ['Upper Arm Actuator', 'Lower Arm Actuator'], expected: '2 [4]' },
        ];

        for (const scenario of scenarios) {
            const armSlots = armCritSlots('LA').map(slot => scenario.destroyed.includes(slot.name ?? '')
                ? { ...slot, destroyed: 1 }
                : slot);
            const forceUnit = createForceUnitHarness({
                tons: 55,
                critSlots: [
                    ...armSlots,
                    { ...crit('Triple Strength Myomer', false), loc: 'RT', slot: 0, eq: tsm },
                ],
                internalLocations: ['LA', 'RA', 'LL', 'RL', 'RT'],
            });
            const claw = clawEntry(forceUnit);

            expect(forceUnit.rules.applyInventoryControlDisplayEffects(claw, {
                name: 'Claw', location: 'LA', heat: '—', damage: '8', hit: '0',
                min: '—', short: '—', medium: '—', long: '—',
            }).damage).withContext(scenario.destroyed.join(' and ')).toBe(scenario.expected);
        }
    });

    it('does not penalize a claw for a missing hand actuator', () => {
        const forceUnit = createForceUnitHarness({
            tons: 55,
            critSlots: armCritSlots('LA', { hand: 'missing' }),
            internalLocations: ['LA', 'RA', 'LL', 'RL'],
        });
        const claw = clawEntry(forceUnit);
        const modifiers = forceUnit.rules.getEquipmentToHitModifiers(claw);

        expect(modifiers).toEqual([]);
        expect(forceUnit.gameRules.resolveToHit({ subject: claw, stateModifiers: modifiers }).value).toBe(0);
        expect(forceUnit.rules.canPerformEquipmentAction(claw, 'physical-attack')).toBeTrue();
        expect(forceUnit.rules.applyInventoryControlDisplayEffects(claw, {
            name: 'Claw', location: 'LA', heat: '—', damage: '8', hit: '0',
            min: '—', short: '—', medium: '—', long: '—',
        }).damage).toBe('8');
    });

    it('marks paired-arm AES modifiers as weakened when damage removes their attack bonus', () => {
        const scenarios = [
            { label: 'one functional', slots: [{ loc: 'LA', destroyed: false }], club: { hitMod: -1, weakened: false }, push: { hitMod: 0, weakened: false } },
            { label: 'one unavailable', slots: [{ loc: 'LA', destroyed: true }], club: { hitMod: 0, weakened: true }, push: { hitMod: 0, weakened: false } },
            { label: 'both functional', slots: [{ loc: 'LA', destroyed: false }, { loc: 'RA', destroyed: false }], club: { hitMod: -1, weakened: false }, push: { hitMod: -1, weakened: false } },
            { label: 'one of two unavailable', slots: [{ loc: 'LA', destroyed: true }, { loc: 'RA', destroyed: false }], club: { hitMod: -1, weakened: false }, push: { hitMod: 0, weakened: true } },
            { label: 'both unavailable', slots: [{ loc: 'LA', destroyed: true }, { loc: 'RA', destroyed: true }], club: { hitMod: 0, weakened: true }, push: { hitMod: 0, weakened: true } },
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

            const clubModifiers = forceUnit.rules.getEquipmentToHitModifiers(physical('club'));
            const pushModifiers = forceUnit.rules.getEquipmentToHitModifiers(physical('push'));
            expect(toHitModifierTotal(clubModifiers)).withContext(`${scenario.label} arm AES for club`).toBe(scenario.club.hitMod);
            expect(hasWeakenedHitModifier(clubModifiers)).withContext(`${scenario.label} arm AES for club`).toBe(scenario.club.weakened);
            expect(toHitModifierTotal(pushModifiers)).withContext(`${scenario.label} arm AES for push`).toBe(scenario.push.hitMod);
            expect(hasWeakenedHitModifier(pushModifiers)).withContext(`${scenario.label} arm AES for push`).toBe(scenario.push.weakened);
        }
    });

    it('marks leg AES modifiers as weakened only when a complete installation is damaged', () => {
        const scenarios = [
            { label: 'all functional', slots: [{ loc: 'LL', destroyed: false }, { loc: 'RL', destroyed: false }], expected: { hitMod: -1, weakened: false } },
            { label: 'all installed with one unavailable', slots: [{ loc: 'LL', destroyed: true }, { loc: 'RL', destroyed: false }], expected: { hitMod: 0, weakened: true } },
            { label: 'partial functional installation', slots: [{ loc: 'LL', destroyed: false }], expected: { hitMod: 0, weakened: false } },
            { label: 'partial unavailable installation', slots: [{ loc: 'LL', destroyed: true }], expected: { hitMod: 0, weakened: false } },
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

            const modifiers = forceUnit.rules.getEquipmentToHitModifiers(kick);
            expect(toHitModifierTotal(modifiers)).withContext(`${scenario.label} leg AES`).toBe(scenario.expected.hitMod);
            expect(hasWeakenedHitModifier(modifiers)).withContext(`${scenario.label} leg AES`).toBe(scenario.expected.weakened);
        }
    });

    it('keeps spikes working when flooded but not when structurally destroyed or blown off', () => {
        const createSpikeUnit = () => createForceUnitHarness({
            internalLocations: ['LL'],
            critSlots: [{ ...crit('Spikes', false), loc: 'LL' }],
        });
        const chargeDisplay = (forceUnit: CBTForceUnit) => forceUnit.rules.applyInventoryControlDisplayEffects(
            new MountedEquipment({
                owner: forceUnit,
                id: 'Charge',
                name: 'charge',
                intrinsicPhysicalAttack: true,
            }),
            {
                name: 'Charge', location: '—', heat: '—', damage: 'Wrong SVG value', hit: 'Vs',
                min: '—', short: '—', medium: '—', long: '—',
            },
        ).damage;

        const flooded = createSpikeUnit();
        flooded.setLocationCondition('LL', 'flooded', true);
        flooded.endPhase();
        expect((flooded.rules as MekRules).physicalCombat()?.chargeDamage).toEqual(jasmine.objectContaining({
            bonusDamage: 2,
            maxBonusDamage: 2,
            displayFormula: '10×(TMM+1)+2',
        }));
        expect(chargeDisplay(flooded)).toBe('10×(TMM+1)+2');

        const blownOff = createSpikeUnit();
        blownOff.setLocationCondition('LL', 'blown-off', true);
        blownOff.endPhase();
        expect((blownOff.rules as MekRules).physicalCombat()?.chargeDamage).toEqual(jasmine.objectContaining({ bonusDamage: 0, maxBonusDamage: 2 }));
        expect(chargeDisplay(blownOff)).toBe('10×(TMM+1)');

        const structurallyDestroyed = createSpikeUnit();
        structurallyDestroyed.addInternalHits('LL', structurallyDestroyed.getInternalPoints('LL'));
        structurallyDestroyed.endPhase();
        expect((structurallyDestroyed.rules as MekRules).physicalCombat()?.chargeDamage).toEqual(jasmine.objectContaining({ bonusDamage: 0, maxBonusDamage: 2 }));
    });

    it('applies a working Ram Plate to the CORE charge formula and rounded damage before spikes', () => {
        const forceUnit = createForceUnitHarness({
            tons: 45,
            run: 8,
            internalLocations: ['LL'],
            critSlots: [{ ...crit('Spikes', false), loc: 'LL' }],
        });
        const ramPlate = new MountedEquipment({
            owner: forceUnit,
            id: 'ISRamPlate',
            name: 'Ram Plate',
            equipment: miscEquipment('ISRamPlate', 'Ram Plate', ['F_RAM_PLATE']),
        });
        const charge = new MountedEquipment({
            owner: forceUnit,
            id: 'Charge',
            name: 'charge',
            intrinsicPhysicalAttack: true,
        });
        const display = {
            name: 'Charge', location: '—', heat: '—', damage: 'Wrong SVG value', hit: 'Vs',
            min: '—', short: '—', medium: '—', long: '—',
        };
        forceUnit.setInventory([ramPlate]);
        const mountedRamPlate = forceUnit.getInventory()[0];

        expect(forceUnit.rules.applyInventoryControlDisplayEffects(charge, display).damage)
            .toBe('13.5×(TMM+1)+2');

        forceUnit.turnState().moveMode.set('walk');
        forceUnit.turnState().moveDistance.set(5);
        expect(forceUnit.rules.chargeDamage()).toEqual({
            damage: 43,
            maxDamage: 56,
            bonusDamage: 2,
            maxBonusDamage: 2,
        });

        mountedRamPlate.setCommittedDestroyed(true);
        expect(forceUnit.rules.chargeDamage()).toEqual({
            damage: 29,
            maxDamage: 56,
            bonusDamage: 2,
            maxBonusDamage: 2,
        });

        forceUnit.turnState().moveMode.set(null);
        expect(forceUnit.rules.applyInventoryControlDisplayEffects(charge, display).damage)
            .toBe('9×(TMM+1)+2');
    });

    it('calculates charge damage using the selected ruleset', () => {
        const forceUnit = createForceUnitHarness();
        forceUnit.getUnit().tons = 45;
        forceUnit.turnState().moveMode.set('walk');
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

        const twForceUnit = createForceUnitHarness({ rulesId: 'tw', tons: 45, run: 8 });
        twForceUnit.turnState().moveDistance.set(5);
        const twCharge = new MountedEquipment({
            owner: twForceUnit,
            id: 'Charge',
            name: 'charge',
            intrinsicPhysicalAttack: true,
        });
        const twChargeDisplay = {
            name: 'Charge',
            location: '—',
            heat: '—',
            damage: 'Wrong SVG value',
            hit: 'Vs',
            min: '—',
            short: '—',
            medium: '—',
            long: '—',
        };
        expect(twForceUnit.rules.applyInventoryControlDisplayEffects(twCharge, twChargeDisplay).damage)
            .toBe('4.5/hex');

        twForceUnit.turnState().moveMode.set('walk');
        expect((twForceUnit.rules as MekRules).physicalCombat()?.chargeDamage).toEqual({
            damage: 18,
            maxDamage: 32,
            bonusDamage: 0,
            maxBonusDamage: 0,
        });
        expect(twForceUnit.rules.applyInventoryControlDisplayEffects(twCharge, twChargeDisplay).damage)
            .toBe('18 [32]');

        const ramPlateEquipment = miscEquipment('ISRamPlate', 'Ram Plate', ['F_RAM_PLATE']);
        const ramPlate = new MountedEquipment({
            owner: twForceUnit,
            id: 'ISRamPlate',
            name: 'Ram Plate',
            equipment: ramPlateEquipment,
        });
        twForceUnit.setInventory([ramPlate]);
        twForceUnit.turnState().moveDistance.set(2);
        expect((twForceUnit.rules as MekRules).physicalCombat()?.chargeDamage).toEqual({
            damage: 8,
            maxDamage: 48,
            bonusDamage: 0,
            maxBonusDamage: 0,
        });
        expect(twForceUnit.rules.applyInventoryControlDisplayEffects(twCharge, twChargeDisplay).damage)
            .toBe('8 [48]');
    });

    it('shows the TW per-hex charge formula with a Ram Plate and spikes until movement is selected', () => {
        const forceUnit = createForceUnitHarness({
            rulesId: 'tw',
            tons: 45,
            run: 8,
            internalLocations: ['LL'],
            critSlots: [{ ...crit('Spikes', false), loc: 'LL' }],
        });
        forceUnit.setInventory([new MountedEquipment({
            owner: forceUnit,
            id: 'ISRamPlate',
            name: 'Ram Plate',
            equipment: miscEquipment('ISRamPlate', 'Ram Plate', ['F_RAM_PLATE']),
        })]);
        const charge = new MountedEquipment({
            owner: forceUnit,
            id: 'Charge',
            name: 'charge',
            intrinsicPhysicalAttack: true,
        });
        const display = {
            name: 'Charge', location: '—', heat: '—', damage: 'Wrong SVG value', hit: 'Vs',
            min: '—', short: '—', medium: '—', long: '—',
        };

        expect(forceUnit.rules.applyInventoryControlDisplayEffects(charge, display).damage)
            .toBe('6.75/hex+2');

        forceUnit.turnState().moveMode.set('walk');
        forceUnit.turnState().moveDistance.set(5);
        expect(forceUnit.rules.applyInventoryControlDisplayEffects(charge, display).damage)
            .toBe('29 [50]');
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
            hitModifierBreakdown: forceUnit.rules.getEquipmentToHitModifiers(vibroblade),
            selectedAmmo: null,
        }).damage).toBe('14 [7]');

        vibroblade.states.set(VIBROBLADE_MODE_STATE, VIBROBLADE_ON_MODE);
        expect(forceUnit.applyInventoryControlDisplayEffects(vibroblade, display, {
            selectedRange: null,
            hitModifierBreakdown: forceUnit.rules.getEquipmentToHitModifiers(vibroblade),
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
            hitModifierBreakdown: forceUnit.rules.getEquipmentToHitModifiers(vibroblade),
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

        expect(rules.getBaseGunnerySkill()).toBe(3);
        const rangedModifiers = rules.getEquipmentToHitModifiers(directFireWeaponEntry(forceUnit));
        expect(toHitModifierTotal(rangedModifiers)).toBe(0);
        expect(rangedModifiers).toEqual([]);
        expect(rules.getBasePilotingSkill()).toBe(5);
        const punchModifiers = rules.getEquipmentToHitModifiers(punchEntry(forceUnit));
        expect(toHitModifierTotal(punchModifiers)).toBe(-1);
        expect(punchModifiers).toEqual([{ label: 'Dedicated Pilot', modifier: -1 }]);
        expect(rules.PSRModifiers().modifier).toBe(-2);
        expect(rules.PSRTargetRoll()).toBe(3);
    });

    it('uses the first active alternate gunner with a modifier when the Tripod dedicated gunnery officer is disabled', () => {
        const forceUnit = createForceUnitHarness({ subtype: 'Tripod BattleMek', crewStates: ['healthy', 'unconscious', 'healthy'] });
        forceUnit.getCrewMember(0).setSkill('gunnery', 5);
        forceUnit.getCrewMember(1).setSkill('gunnery', 3);
        forceUnit.getCrewMember(2).setSkill('gunnery', 2);
        const rules = forceUnit.rules as MekRules;

        expect(rules.getBaseGunnerySkill()).toBe(5);
        const ranged = directFireWeaponEntry(forceUnit);
        const rangedModifiers = rules.getEquipmentToHitModifiers(ranged);
        expect(toHitModifierTotal(rangedModifiers)).toBe(2);
        expect(rangedModifiers).toEqual([
            { label: 'Dedicated Gunnery Officer disabled', modifier: 2, weakened: true },
        ]);
        expect(forceUnit.turnState().getAttackModifierBreakdown()).toEqual([]);
    });

    it('applies type-specific Prone attacker modifiers directly to ranged weapons', () => {
        const scenarios = [
            { context: 'Biped', subtype: 'BattleMek' as const, locations: ['LL', 'RL'], label: 'Prone', modifier: 2 },
            { context: 'Tripod', subtype: 'Tripod BattleMek' as const, locations: ['LL', 'CL', 'RL'], label: 'Prone Tripod', modifier: 1 },
            { context: 'Quad', subtype: 'Quad BattleMek' as const, locations: ['FLL', 'FRL', 'RLL', 'RRL'], label: 'Prone Quad', modifier: 0 },
        ];

        for (const scenario of scenarios) {
            const forceUnit = createForceUnitHarness({
                subtype: scenario.subtype,
                internalLocations: scenario.locations,
            });
            forceUnit.setCondition('prone', true);
            const ranged = directFireWeaponEntry(forceUnit);

            expect(forceUnit.turnState().getAttackModifierBreakdown()).withContext(scenario.context).toEqual([]);
            const rangedModifiers = forceUnit.rules.getEquipmentToHitModifiers(ranged);
            expect(toHitModifierTotal(rangedModifiers)).withContext(scenario.context).toBe(scenario.modifier);
            expect(rangedModifiers).withContext(scenario.context).toEqual([
                { label: scenario.label, modifier: scenario.modifier, weakened: true },
            ]);
        }
    });

    it('uses the best available alternate pilot with a modifier when the Tripod dedicated pilot is disabled', () => {
        const forceUnit = createForceUnitHarness({ subtype: 'Tripod BattleMek', crewStates: ['unconscious', 'healthy', 'healthy'] });
        forceUnit.getCrewMember(0).setSkill('piloting', 5);
        forceUnit.getCrewMember(1).setSkill('piloting', 6);
        forceUnit.getCrewMember(2).setSkill('piloting', 4);
        const rules = forceUnit.rules as MekRules;

        expect(rules.getBasePilotingSkill()).toBe(4);
        expect(rules.getActivePilotCrewId()).toBe(2);
        const punchModifiers = rules.getEquipmentToHitModifiers(punchEntry(forceUnit));
        expect(toHitModifierTotal(punchModifiers)).toBe(2);
        expect(punchModifiers).toEqual([
            { label: 'Dedicated Pilot disabled', modifier: 2, weakened: true },
        ]);
        expect(rules.PSRModifiers().modifier).toBe(1);
        expect(rules.PSRTargetRoll()).toBe(5);
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

        const initialPunchModifiers = forceUnit.rules.getEquipmentToHitModifiers(punch);
        expect(toHitModifierTotal(initialPunchModifiers)).toBe(-1);
        expect(initialPunchModifiers).toEqual([{ label: 'Dedicated Pilot', modifier: -1 }]);
        const initialRangedModifiers = forceUnit.rules.getEquipmentToHitModifiers(ranged);
        expect(toHitModifierTotal(initialRangedModifiers)).toBe(0);
        expect(initialRangedModifiers).toEqual([]);

        forceUnit.getCrewMember(0).setState('unconscious');

        const disabledPunchModifiers = forceUnit.rules.getEquipmentToHitModifiers(punch);
        expect(toHitModifierTotal(disabledPunchModifiers)).toBe(2);
        expect(disabledPunchModifiers).toEqual([
            { label: 'Dedicated Pilot disabled', modifier: 2, weakened: true },
        ]);
    });

    it('includes intact Tripod legs in piloting checks', () => {
        const forceUnit = createForceUnitHarness({
            subtype: 'Tripod BattleMek',
            crewStates: ['healthy', 'healthy', 'healthy'],
            internalLocations: ['LL', 'CL', 'RL'],
        });

        expect(forceUnit.rules.PSRModifiers().modifiers).toEqual(jasmine.arrayContaining([
            jasmine.objectContaining({ reason: 'No Destroyed Legs', pilotCheck: -1 }),
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

        expect(superheavy.rules.PSRModifiers().modifiers.map(modifier => modifier.reason)).not.toContain('Superheavy');
        const superheavyModifiers = superheavy.rules.getEquipmentToHitModifiers(superheavyPhysical);
        expect(toHitModifierTotal(superheavyModifiers)).toBe(1);
        expect(superheavyModifiers).toEqual([{ label: 'Superheavy', modifier: 1 }]);
        expect(superheavy.gameRules.resolveToHit({
            subject: superheavyPhysical,
            stateModifiers: superheavyModifiers,
        }).weakened).toBeFalse();
        expect(toHitModifierTotal(superheavy.rules.getEquipmentToHitModifiers(ranged))).toBe(0);
        expect(toHitModifierTotal(assault.rules.getEquipmentToHitModifiers(physical(assault)))).toBe(0);
    });

    it('does not apply gunnery modifiers to non-attack equipment', () => {
        const forceUnit = createForceUnitHarness();
        forceUnit.setCondition('prone', true);
        const utility = new MountedEquipment({
            owner: forceUnit,
            id: 'utility',
            name: 'Utility',
            equipment: miscEquipment('Utility', 'Utility', []),
        });

        const utilityModifiers = forceUnit.rules.getEquipmentToHitModifiers(utility);
        expect(toHitModifierTotal(utilityModifiers)).toBe(0);
        expect(utilityModifiers).toEqual([]);
    });

    it('does not apply the spotting attack modifier with an active command console', () => {
        const forceUnit = createForceUnitHarness({
            crewStates: ['healthy', 'healthy'],
            critSlots: [
                { id: 'cockpit', name: 'Cockpit', loc: 'HD', slot: 2 },
                { id: 'command-console', name: 'Command Console', loc: 'HD', slot: 3 },
            ],
        });
        forceUnit.turnState().spotting.set(true);

        const noSpottingModifiers = forceUnit.rules.getEquipmentToHitModifiers(directFireWeaponEntry(forceUnit));
        expect(toHitModifierTotal(noSpottingModifiers)).toBe(0);
        expect(noSpottingModifiers).toEqual([]);
    });

    it('applies the spotting attack modifier without a command console', () => {
        const forceUnit = createForceUnitHarness({
            crewStates: ['healthy'],
            critSlots: [],
        });
        forceUnit.turnState().spotting.set(true);

        const spottingModifiers = forceUnit.rules.getEquipmentToHitModifiers(directFireWeaponEntry(forceUnit));
        expect(toHitModifierTotal(spottingModifiers)).toBe(1);
        expect(spottingModifiers).toEqual([{ label: 'Spotting', modifier: 1 }]);
    });

    it('applies skidding and spotting to ranged and physical equipment modifiers', () => {
        const forceUnit = createForceUnitHarness({ rulesId: 'tw' });
        forceUnit.setCondition('skidding', true);
        forceUnit.turnState().spotting.set(true);

        const rangedModifiers = forceUnit.rules.getEquipmentToHitModifiers(directFireWeaponEntry(forceUnit));
        expect(toHitModifierTotal(rangedModifiers)).toBe(2);
        expect(rangedModifiers).toEqual([
            { label: 'Skidding', modifier: 1 },
            { label: 'Spotting', modifier: 1 },
        ]);
        const physicalModifiers = forceUnit.rules.getEquipmentToHitModifiers(punchEntry(forceUnit));
        expect(toHitModifierTotal(physicalModifiers)).toBe(2);
        expect(physicalModifiers).toEqual([
            { label: 'Skidding', modifier: 1 },
            { label: 'Spotting', modifier: 1 },
        ]);
    });

    it('keeps crew 0 as pilot while available, then uses the best alternate piloting skill', () => {
        const forceUnit = createForceUnitHarness({ crewStates: ['healthy', 'healthy', 'healthy'] });
        forceUnit.getCrewMember(0).setSkill('gunnery', 5);
        forceUnit.getCrewMember(0).setSkill('piloting', 6);
        forceUnit.getCrewMember(1).setSkill('gunnery', 4);
        forceUnit.getCrewMember(1).setSkill('piloting', 5);
        forceUnit.getCrewMember(2).setSkill('gunnery', 2);
        forceUnit.getCrewMember(2).setSkill('piloting', 3);
        const rules = forceUnit.rules as MekRules;

        expect(rules.getBaseGunnerySkill()).toBe(5);
        expect(rules.getBasePilotingSkill()).toBe(6);
        expect(rules.getActivePilotCrewId()).toBe(0);

        forceUnit.getCrewMember(0).setState('unconscious');

        expect(rules.getBaseGunnerySkill()).toBe(4);
        expect(rules.getBasePilotingSkill()).toBe(3);
        expect(rules.getActivePilotCrewId()).toBe(2);
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
        expect(forceUnit.getEquipmentStatus(storedEntry)).toBe('destroyed');
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
        expect(forceUnit.getEquipmentStatus(storedEntry)).toBe('destroyed');
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
            expect(forceUnit.getEquipmentStatus(storedEntry) === 'destroyed')
                .withContext(`${ammoType} after one destroyed critical slot`).toBeFalse();

            forceUnit.applyHitToCritSlot(forceUnit.getCritSlot('RA', 0)!);
            forceUnit.endPhase();
            expect(forceUnit.getEquipmentStatus(storedEntry) === 'destroyed')
                .withContext(`${ammoType} after two hits to the same slot`).toBeFalse();

            forceUnit.applyHitToCritSlot(secondCrit);
            forceUnit.endPhase();
            expect(forceUnit.getEquipmentStatus(storedEntry) === 'destroyed')
                .withContext(`${ammoType} after two destroyed critical slots`).toBeTrue();
        }
    });

    it('counts two hits to the same one-slot Core2026 autocannon', () => {
        const forceUnit = createForceUnitHarness({ internalLocations: ['RA'] });
        const critSlot = {
            id: 'Autocannon-AC', name: 'Autocannon AC', loc: 'RA', slot: 0,
        } as CriticalSlot;
        const entry = criticalAutocannonEntry(forceUnit, 'AC', [critSlot]);
        forceUnit.writeCrits([critSlot]);
        forceUnit.setInventory([entry]);
        const storedEntry = forceUnit.getInventory()[0];

        forceUnit.applyHitToCritSlot(critSlot);
        forceUnit.endPhase();
        expect(forceUnit.getEquipmentStatus(storedEntry)).toBe('available');

        forceUnit.applyHitToCritSlot(forceUnit.getCritSlot('RA', 0)!);
        forceUnit.endPhase();
        expect(forceUnit.getEquipmentStatus(storedEntry)).toBe('destroyed');
    });

    it('requires three hits to destroy an armored one-slot Core2026 AC/2', () => {
        const forceUnit = createForceUnitHarness({ internalLocations: ['RA'] });
        const critSlot = {
            id: 'Autocannon-AC', name: 'AC/2', loc: 'RA', slot: 0, armored: true,
        } as CriticalSlot;
        const entry = criticalAutocannonEntry(forceUnit, 'AC', [critSlot]);
        forceUnit.writeCrits([critSlot]);
        forceUnit.setInventory([entry]);
        const storedEntry = forceUnit.getInventory()[0];

        forceUnit.applyHitToCritSlot(forceUnit.getCritSlot('RA', 0)!);
        forceUnit.endPhase();
        expect(forceUnit.getEquipmentStatus(storedEntry)).toBe('available');

        forceUnit.applyHitToCritSlot(forceUnit.getCritSlot('RA', 0)!);
        forceUnit.endPhase();
        expect(forceUnit.getEquipmentStatus(storedEntry)).toBe('available');

        forceUnit.applyHitToCritSlot(forceUnit.getCritSlot('RA', 0)!);
        forceUnit.endPhase();
        expect(forceUnit.getCritSlot('RA', 0)?.hits).toBe(3);
        expect(forceUnit.getEquipmentStatus(storedEntry)).toBe('destroyed');
    });

    it('uses the one-slot critical destruction threshold for TW autocannons', () => {
        const forceUnit = createForceUnitHarness({ internalLocations: ['RA'], rulesId: 'tw' });
        const critSlot = { id: 'Autocannon-AC', name: 'Autocannon AC', loc: 'RA', slot: 0 } as CriticalSlot;
        const entry = criticalAutocannonEntry(forceUnit, 'AC', [critSlot]);
        forceUnit.writeCrits([critSlot]);
        forceUnit.setInventory([entry]);

        forceUnit.applyHitToCritSlot(critSlot);
        forceUnit.endPhase();

        expect(forceUnit.getEquipmentStatus(forceUnit.getInventory()[0])).toBe('destroyed');
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

            expect(forceUnit.getEquipmentStatus(forceUnit.getInventory()[0]))
                .withContext(testCase.description).toBe('destroyed');
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
        const forceUnit = createForceUnitHarness({ crewStates: ['healthy', 'ejected'], crewHits: [DEAD_CREW_HIT_THRESHOLD] });

        forceUnit.endPhase();

        expect(forceUnit.rules.hasComputedCondition('abandoned')).toBeTrue();
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
            .find(check => check.kind === PSR_CHECK_KIND.TORSO_DESTROYED);

        expect(successfulUnit.rules.hasComputedCondition('crippled')).toBeFalse();
        expect(successfulCheck).toBeDefined();
        expect(successfulCheck?.loc).toBe('LT');
        expect(successfulCheck?.pilotCheck).toBe(0);
        expect(successfulCheck?.failure).toEqual({
            kind: PSR_FAILURE_KIND.RULE_RESOLUTION,
            label: 'Crippled',
        });
        expect(successfulCheck?.resolution).toBeDefined();
        expect(successfulUnit.resolveRuleCheck(
            successfulCheck!.resolution!.key,
            successfulCheck!.resolution!.token,
            'success'
        )).toBeTrue();
        expect(successfulUnit.rules.hasComputedCondition('crippled')).toBeFalse();
        expect(successfulUnit.turnState().getPSRChecks().some(check =>
            check.kind === PSR_CHECK_KIND.TORSO_DESTROYED
        )).toBeFalse();
        successfulUnit.endTurn();
        expect(successfulUnit.rules.hasComputedCondition('crippled')).toBeFalse();
        expect(successfulUnit.turnState().getPSRChecks().some(check =>
            check.kind === PSR_CHECK_KIND.TORSO_DESTROYED
        )).toBeFalse();

        const failedUnit = createForceUnitHarness({
            internalLocations,
            committedDestroyedLocations: ['RT'],
        });
        const failedCheck = failedUnit.turnState().getPSRChecks()
            .find(check => check.kind === PSR_CHECK_KIND.TORSO_DESTROYED);

        expect(failedUnit.resolveRuleCheck(
            failedCheck!.resolution!.key,
            failedCheck!.resolution!.token,
            'failed'
        )).toBeTrue();
        expect(failedUnit.rules.hasComputedCondition('crippled')).toBeTrue();
        expect(failedUnit.turnState().getPSRChecks().some(check =>
            check.kind === PSR_CHECK_KIND.TORSO_DESTROYED
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
            check.kind === PSR_CHECK_KIND.TORSO_DESTROYED
        )).toBeFalse();

        optionsService.options.update(current => ({
            ...current,
            CBTOptionalRules: { ...current.CBTOptionalRules, forcedWithdrawal: true },
        }));
        TestBed.tick();

        expect(forceUnit.rules.hasComputedCondition('crippled')).toBeFalse();
        expect(forceUnit.turnState().getPSRChecks().some(check =>
            check.kind === PSR_CHECK_KIND.TORSO_DESTROYED
        )).toBeTrue();

        optionsService.options.update(current => ({
            ...current,
            CBTOptionalRules: { ...current.CBTOptionalRules, forcedWithdrawal: false },
        }));
        TestBed.tick();

        expect(forceUnit.rules.hasComputedCondition('crippled')).toBeFalse();
        expect(forceUnit.turnState().getPSRChecks().some(check =>
            check.kind === PSR_CHECK_KIND.TORSO_DESTROYED
        )).toBeFalse();
    });

    it('requests a new torso crippling check after repair and rejects the stale result', () => {
        const forceUnit = createForceUnitHarness({
            internalLocations: ['LT', 'RT', 'CT', 'LA', 'RA', 'LL', 'RL'],
            committedDestroyedLocations: ['LT'],
        });
        const firstCheck = forceUnit.turnState().getPSRChecks()
            .find(check => check.kind === PSR_CHECK_KIND.TORSO_DESTROYED)!;

        forceUnit.setInternalHits('LT', 0);
        expect(forceUnit.getRuleCheck(firstCheck.resolution!.key)).toBeUndefined();

        forceUnit.setInternalHits('LT', 1);
        const secondCheck = forceUnit.turnState().getPSRChecks()
            .find(check => check.kind === PSR_CHECK_KIND.TORSO_DESTROYED)!;

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
            .find(entry => entry.kind === PSR_CHECK_KIND.TORSO_DESTROYED)!;
        forceUnit.resolveRuleCheck(check.resolution!.key, check.resolution!.token, 'success');

        forceUnit.setInternalHits('RT', 1);
        expect(forceUnit.rules.hasComputedCondition('crippled')).toBeTrue();
        expect(forceUnit.turnState().getPSRChecks().some(entry =>
            entry.kind === PSR_CHECK_KIND.TORSO_DESTROYED
        )).toBeFalse();

        forceUnit.setInternalHits('RT', 0);
        expect(forceUnit.rules.hasComputedCondition('crippled')).toBeFalse();
        expect(forceUnit.getRuleCheck(check.resolution!.key)?.token).toBe(check.resolution!.token);
        expect(forceUnit.turnState().getPSRChecks().some(entry =>
            entry.kind === PSR_CHECK_KIND.TORSO_DESTROYED
        )).toBeFalse();
    });

    it('requests a new check when a different torso remains destroyed after repair', () => {
        const forceUnit = createForceUnitHarness({
            internalLocations: ['LT', 'RT', 'CT', 'LA', 'RA', 'LL', 'RL'],
            committedDestroyedLocations: ['LT'],
        });
        const firstCheck = forceUnit.turnState().getPSRChecks()
            .find(entry => entry.kind === PSR_CHECK_KIND.TORSO_DESTROYED)!;
        forceUnit.resolveRuleCheck(firstCheck.resolution!.key, firstCheck.resolution!.token, 'success');

        forceUnit.setInternalHits('RT', 1);
        forceUnit.setInternalHits('LT', 0);
        const nextCheck = forceUnit.turnState().getPSRChecks()
            .find(entry => entry.kind === PSR_CHECK_KIND.TORSO_DESTROYED)!;

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
            .find(entry => entry.kind === PSR_CHECK_KIND.TORSO_DESTROYED)!;
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
            entry.kind === PSR_CHECK_KIND.TORSO_DESTROYED
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
            check.kind === PSR_CHECK_KIND.TORSO_DESTROYED
        )).toBeTrue();
        expect(xlUnit.rules.hasComputedCondition('crippled')).toBeTrue();
        expect(xlUnit.turnState().getPSRChecks().some(check =>
            check.kind === PSR_CHECK_KIND.TORSO_DESTROYED
        )).toBeFalse();
    });

    it('automatically cripples Core 2026 fusion Meks with two destroyed torsos without a check', () => {
        const forceUnit = createForceUnitHarness({
            internalLocations: ['LT', 'RT', 'CT', 'LA', 'RA', 'LL', 'RL'],
            committedDestroyedLocations: ['LT', 'RT'],
        });

        expect(forceUnit.rules.hasComputedCondition('crippled')).toBeTrue();
        expect(forceUnit.turnState().getPSRChecks().some(check =>
            check.kind === PSR_CHECK_KIND.TORSO_DESTROYED
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
            check.kind === PSR_CHECK_KIND.TORSO_DESTROYED
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

    it('restores the modular armor Walk penalty only after every panel is unavailable', () => {
        for (const rulesId of ['core2026', 'tw'] as const) {
            const createUnit = (lastPanelConsumed: number) => {
                const modularArmor = miscEquipment(
                    'ISModularArmor',
                    'Modular Armor',
                    ['F_MODULAR_ARMOR'],
                );
                return createForceUnitHarness({
                    rulesId,
                    walk: 0,
                    run: 0,
                    internalLocations: ['LT', 'RT', 'LL', 'RL'],
                    critSlots: [
                        { ...crit('Modular Armor'), id: 'modular-armor-lt', loc: 'LT', slot: 0, eq: modularArmor },
                        {
                            ...crit('Modular Armor', false),
                            id: 'modular-armor-rt',
                            loc: 'RT',
                            slot: 0,
                            consumed: lastPanelConsumed,
                            eq: modularArmor,
                        },
                    ],
                });
            };
            const onePanelRemaining = createUnit(9);
            const allPanelsUnavailable = createUnit(10);

            expect((onePanelRemaining.rules as MekRules).movementState())
                .withContext(rulesId)
                .toEqual(jasmine.objectContaining({ walk: 0, run: 0 }));
            expect((onePanelRemaining.rules as MekRules).PSRModifiers().modifier)
                .withContext(rulesId)
                .toBe(1);
            expect((allPanelsUnavailable.rules as MekRules).movementState())
                .withContext(rulesId)
                .toEqual(jasmine.objectContaining({ walk: 1, run: 2 }));
            expect((allPanelsUnavailable.rules as MekRules).PSRModifiers().modifier)
                .withContext(rulesId)
                .toBe(0);
        }
    });

    it('restores modular-armor Jump MP before applying Jump Jet damage', () => {
        for (const rulesId of ['core2026', 'tw'] as const) {
            const modularArmor = miscEquipment(
                'ISModularArmor',
                'Modular Armor',
                ['F_MODULAR_ARMOR'],
            );
            const jumpJet = miscEquipment('ISJumpJet', 'Jump Jet', ['F_JUMP_JET']);
            const forceUnit = createForceUnitHarness({
                rulesId,
                jump: 2,
                umu: 0,
                components: [unitComponent(jumpJet, 3, 'LT')],
                internalLocations: ['LT', 'RT', 'LL', 'RL'],
                critSlots: [
                    {
                        ...crit('Modular Armor', false),
                        id: 'modular-armor',
                        loc: 'RT',
                        slot: 0,
                        consumed: 10,
                        eq: modularArmor,
                    },
                    ...Array.from({ length: 3 }, (_, index) => ({
                        ...crit('Jump Jet', index === 0),
                        id: `jump-jet-${index}`,
                        loc: 'LT',
                        slot: index,
                        eq: jumpJet,
                    })),
                ],
            });

            expect((forceUnit.rules as MekRules).movementState())
                .withContext(rulesId)
                .toEqual(jasmine.objectContaining({ jump: 2, jumpImpaired: true }));
            expect(forceUnit.getAvailableMotiveModes(false).map(option => option.mode))
                .withContext(rulesId)
                .toContain('jump');
        }
    });

    it('restores modular-armor Jump from mounted Improved Jump Jets rather than occupied slots', () => {
        for (const rulesId of ['core2026', 'tw'] as const) {
            const modularArmor = miscEquipment(
                'ISModularArmor',
                'Modular Armor',
                ['F_MODULAR_ARMOR'],
            );
            const improvedJumpJet = miscEquipment(
                'ISImprovedJumpJet',
                'Improved Jump Jet',
                ['F_JUMP_JET', 'S_IMPROVED'],
            );
            const forceUnit = createForceUnitHarness({
                rulesId,
                jump: 1,
                umu: 0,
                components: [unitComponent(improvedJumpJet, 2, 'LT')],
                internalLocations: ['LT', 'RT', 'LL', 'RL'],
                critSlots: [
                    {
                        ...crit('Modular Armor', false),
                        id: 'modular-armor',
                        loc: 'RT',
                        slot: 0,
                        consumed: 10,
                        eq: modularArmor,
                    },
                    ...Array.from({ length: 4 }, (_, index) => ({
                        ...crit('Improved Jump Jet', false),
                        id: `improved-jump-jet-${Math.floor(index / 2)}`,
                        loc: 'LT',
                        slot: index,
                        eq: improvedJumpJet,
                    })),
                ],
            });

            expect((forceUnit.rules as MekRules).movementState())
                .withContext(rulesId)
                .toEqual(jasmine.objectContaining({ jump: 2, jumpImpaired: false }));

            forceUnit.applyHitToCritSlot(forceUnit.getCritSlot('LT', 0)!);
            forceUnit.endPhase();
            expect((forceUnit.rules as MekRules).movementState())
                .withContext(`${rulesId} first occupied slot`)
                .toEqual(jasmine.objectContaining({ jump: 1, jumpImpaired: true }));

            forceUnit.applyHitToCritSlot(forceUnit.getCritSlot('LT', 1)!);
            forceUnit.endPhase();
            expect((forceUnit.rules as MekRules).movementState())
                .withContext(`${rulesId} second occupied slot of the same mount`)
                .toEqual(jasmine.objectContaining({ jump: 1, jumpImpaired: true }));
        }
    });

    it('uses restored equipment movement as the Core pre-damage immobility baseline', () => {
        const modularArmor = miscEquipment(
            'ISModularArmor',
            'Modular Armor',
            ['F_MODULAR_ARMOR'],
        );
        const createUnit = (consumed: number) => createForceUnitHarness({
            rulesId: 'core2026',
            walk: 0,
            run: 0,
            jump: 0,
            umu: 0,
            internalLocations: ['LT', 'LL', 'RL'],
            critSlots: [
                {
                    ...crit('Modular Armor', false),
                    id: 'modular-armor',
                    loc: 'LT',
                    slot: 0,
                    consumed,
                    eq: modularArmor,
                },
                { ...crit('Hip'), id: 'left-hip', loc: 'LL', slot: 0 },
            ],
        });
        const activeArmor = createUnit(9);
        const destroyedArmor = createUnit(10);

        expect((activeArmor.rules as MekRules).movementState())
            .toEqual(jasmine.objectContaining({ walk: 0, run: 0 }));
        expect(activeArmor.rules.hasComputedCondition('immobile')).toBeFalse();
        expect((destroyedArmor.rules as MekRules).movementState())
            .toEqual(jasmine.objectContaining({ walk: 0, run: 0, moveImpaired: true }));
        expect(destroyedArmor.rules.hasComputedCondition('immobile')).toBeTrue();
    });

    it('marks movement impaired when damage consumes Walk MP restored from destroyed equipment', () => {
        const modularArmor = miscEquipment(
            'ISModularArmor',
            'Modular Armor',
            ['F_MODULAR_ARMOR'],
        );
        const forceUnit = createForceUnitHarness({
            rulesId: 'core2026',
            walk: 0,
            run: 0,
            internalLocations: ['LT', 'RT', 'LL', 'RL'],
            critSlots: [
                {
                    ...crit('Modular Armor', false),
                    id: 'modular-armor',
                    loc: 'LT',
                    slot: 0,
                    consumed: 10,
                    eq: modularArmor,
                },
                { ...crit('Hip'), id: 'left-hip', loc: 'LL', slot: 0 },
            ],
        });

        expect((forceUnit.rules as MekRules).movementState()).toEqual(jasmine.objectContaining({
            walk: 0,
            run: 0,
            moveImpaired: true,
        }));

        const shieldUnit = createShieldHarness('core2026', 4).forceUnit;
        shieldUnit.writeCrits([
            ...shieldUnit.getCritSlots(),
            { ...crit('Hip'), id: 'left-hip', loc: 'LL', slot: 0 },
        ]);

        expect((shieldUnit.rules as MekRules).movementState()).toEqual(jasmine.objectContaining({
            walk: 5,
            run: 8,
            moveImpaired: true,
        }));
    });

    it('marks TW biped, tripod, and quad Meks immobile after the required four limbs are destroyed', () => {
        const scenarios = [
            {
                context: 'Biped',
                internalLocations: ['LT', 'RT', 'CT', 'LA', 'RA', 'LL', 'RL'],
                mobileDestroyedLocationSets: [['LA', 'RA', 'LL']],
                immobileDestroyedLocations: ['LA', 'RA', 'LL', 'RL'],
            },
            {
                context: 'Tripod',
                internalLocations: ['LT', 'RT', 'CT', 'LA', 'RA', 'LL', 'CL', 'RL'],
                mobileDestroyedLocationSets: [
                    ['LA', 'RA', 'LL'],
                    ['LA', 'LL', 'CL', 'RL'],
                ],
                immobileDestroyedLocations: ['LA', 'RA', 'LL', 'CL'],
            },
            {
                context: 'Quad',
                internalLocations: ['LT', 'RT', 'CT', 'FLL', 'FRL', 'RLL', 'RRL'],
                mobileDestroyedLocationSets: [['FLL', 'FRL', 'RLL']],
                immobileDestroyedLocations: ['FLL', 'FRL', 'RLL', 'RRL'],
            },
        ];

        for (const scenario of scenarios) {
            const immobileUnit = createForceUnitHarness({
                internalLocations: scenario.internalLocations,
                committedDestroyedLocations: scenario.immobileDestroyedLocations,
                rulesId: 'tw',
            });

            for (const destroyedLocations of scenario.mobileDestroyedLocationSets) {
                const mobileUnit = createForceUnitHarness({
                    internalLocations: scenario.internalLocations,
                    committedDestroyedLocations: destroyedLocations,
                    rulesId: 'tw',
                });
                expect(mobileUnit.rules.hasComputedCondition('immobile'))
                    .withContext(`${scenario.context} with ${destroyedLocations.join(', ')} destroyed`)
                    .toBeFalse();
            }
            expect(immobileUnit.rules.hasComputedCondition('immobile'))
                .withContext(`${scenario.context} after the fourth required limb is destroyed`)
                .toBeTrue();
        }
    });

    it('marks Core biped and tripod Meks immobile when two destroyed legs reduce ground MP to zero', () => {
        const scenarios = [
            {
                context: 'Biped',
                internalLocations: ['LT', 'RT', 'CT', 'LA', 'RA', 'LL', 'RL'],
                twoDestroyedLegs: ['LL', 'RL'],
            },
            {
                context: 'Tripod',
                internalLocations: ['LT', 'RT', 'CT', 'LA', 'RA', 'LL', 'CL', 'RL'],
                twoDestroyedLegs: ['LL', 'CL'],
            },
        ];

        for (const scenario of scenarios) {
            const mobileUnit = createForceUnitHarness({
                internalLocations: scenario.internalLocations,
                committedDestroyedLocations: ['LL'],
                jump: 0,
                umu: 0,
            });
            const immobileUnit = createForceUnitHarness({
                internalLocations: scenario.internalLocations,
                committedDestroyedLocations: scenario.twoDestroyedLegs,
                jump: 0,
                umu: 0,
            });

            expect((mobileUnit.rules as MekRules).movementState())
                .withContext(`${scenario.context} with one destroyed leg`)
                .toEqual(jasmine.objectContaining({ walk: 1, run: 2 }));
            expect(mobileUnit.rules.hasComputedCondition('immobile'))
                .withContext(`${scenario.context} with one destroyed leg`)
                .toBeFalse();
            expect((immobileUnit.rules as MekRules).movementState())
                .withContext(`${scenario.context} with two destroyed legs`)
                .toEqual(jasmine.objectContaining({ walk: 0, run: 0 }));
            expect(immobileUnit.rules.hasComputedCondition('immobile'))
                .withContext(`${scenario.context} with two destroyed legs`)
                .toBeTrue();
        }
    });

    it('keeps a Core Mek mobile until damage reduces its canonical ground movement to zero', () => {
        const forceUnit = createForceUnitHarness({
            internalLocations: ['HD', 'CT', 'LT', 'RT', 'LA', 'RA', 'LL', 'RL'],
            committedDestroyedLocations: ['LL'],
            jump: 0,
            umu: 0,
        });

        expect(forceUnit.rules.hasComputedCondition('immobile')).toBeFalse();

        forceUnit.setLocations(createCommittedLocationState(['LL', 'RL']), true);

        expect(forceUnit.rules.hasComputedCondition('immobile')).toBeTrue();
    });

    it('only lets surviving Jump MP prevent Core damage immobility while standing', () => {
        const forceUnit = createForceUnitHarness({
            internalLocations: ['LA', 'RA', 'LL', 'RL'],
            committedDestroyedLocations: ['LL', 'RL'],
            critSlots: [crit('Jump Jet', false)],
            jump: 3,
            umu: 0,
        });
        const rules = forceUnit.rules as MekRules;

        expect(rules.movementState()).toEqual(jasmine.objectContaining({
            walk: 0,
            run: 0,
            jump: 3,
        }));
        expect(rules.hasComputedCondition('immobile')).toBeFalse();

        forceUnit.setCondition('prone', true);

        expect(rules.hasComputedCondition('immobile')).toBeTrue();

        const twForceUnit = createForceUnitHarness({
            internalLocations: ['LA', 'RA', 'LL', 'RL'],
            committedDestroyedLocations: ['LL', 'RL'],
            critSlots: [crit('Jump Jet', false)],
            jump: 1,
            umu: 0,
            rulesId: 'tw',
        });
        expect(twForceUnit.rules.hasComputedCondition('immobile')).toBeFalse();

        twForceUnit.setCondition('prone', true);

        // TW explicitly says that a biped with both legs destroyed is not Immobile.
        expect(twForceUnit.rules.hasComputedCondition('immobile')).toBeFalse();
    });

    it('does not mark a prone Core Mek immobile when heat, rather than damage, reduced ground MP to zero', () => {
        const forceUnit = createForceUnitHarness({
            critSlots: [crit('Jump Jet', false)],
            jump: 1,
            umu: 0,
        });
        forceUnit.setHeat(30, true);
        forceUnit.setCondition('prone', true);

        expect((forceUnit.rules as MekRules).movementState()).toEqual(jasmine.objectContaining({
            walk: 0,
            run: 0,
            jump: 1,
        }));
        expect(forceUnit.rules.hasComputedCondition('immobile')).toBeFalse();
    });

    it('does not mark a prone Core 0/0/1 Mek immobile when its unit profile already includes equipment penalties', () => {
        const forceUnit = createForceUnitHarness({
            critSlots: [crit('Jump Jet', false)],
            walk: 0,
            run: 0,
            jump: 1,
            umu: 0,
        });
        forceUnit.setCondition('prone', true);

        expect((forceUnit.rules as MekRules).movementState()).toEqual(jasmine.objectContaining({
            walk: 0,
            run: 0,
            jump: 1,
        }));
        expect(forceUnit.rules.hasComputedCondition('immobile')).toBeFalse();
    });

    it('does not offer depleted Jump or UMU modes', () => {
        const forceUnit = createForceUnitHarness({
            critSlots: [
                { ...crit('Jump Jet'), loc: 'LT' },
                { ...crit('UMU'), loc: 'RT' },
            ],
            jump: 1,
            umu: 1,
        });

        const modes = forceUnit.getAvailableMotiveModes(false).map(option => option.mode);
        expect(forceUnit.rules.isMotiveModeAvailable('jump')).toBeFalse();
        expect(forceUnit.rules.isMotiveModeAvailable('UMU')).toBeFalse();
        expect(modes).not.toContain('jump');
        expect(modes).not.toContain('UMU');
    });

    it('does not let UMU MP keep a prone zero-ground-MP Core Mek mobile', () => {
        const forceUnit = createForceUnitHarness({
            internalLocations: ['LA', 'RA', 'LL', 'RL'],
            committedDestroyedLocations: ['LL', 'RL'],
            critSlots: [crit('UMU', false)],
            jump: 0,
            umu: 2,
        });

        expect(forceUnit.rules.hasComputedCondition('immobile')).toBeFalse();

        forceUnit.setCondition('prone', true);

        expect(forceUnit.rules.hasComputedCondition('immobile')).toBeTrue();
    });

    it('selects rules once while constructing each Mek', () => {
        const forceUnit = createForceUnitHarness({
            internalLocations: ['LL', 'RL'],
            committedDestroyedLocations: ['LL', 'RL'],
            jump: 0,
            umu: 0,
        });

        expect(forceUnit.rules.hasComputedCondition('immobile')).toBeTrue();

        optionsService.options.update(options => ({ ...options, CBTRules: 'tw' }));

        const twForceUnit = createForceUnitHarness({ rulesId: 'tw' });
        expect(twForceUnit.rules instanceof TWMekRules).toBeTrue();
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

    it('offers ordinary or minimum Run movement when the selected rules permit it after leg destruction', () => {
        const coreBiped = createForceUnitHarness({ committedDestroyedLocations: ['LL'] });
        const coreTripod = createForceUnitHarness({
            internalLocations: ['LL', 'CL', 'RL'],
            committedDestroyedLocations: ['LL'],
        });
        const coreQuadWithTwoDestroyedLegs = createForceUnitHarness({
            internalLocations: ['RLL', 'FLL', 'RRL', 'FRL'],
            committedDestroyedLocations: ['RLL', 'FLL'],
            walk: 3,
            run: 5,
        });
        const coreQuadWithThreeDestroyedLegs = createForceUnitHarness({
            internalLocations: ['RLL', 'FLL', 'RRL', 'FRL'],
            committedDestroyedLocations: ['RLL', 'FLL', 'RRL'],
        });
        const twBiped = createForceUnitHarness({ committedDestroyedLocations: ['LL'], rulesId: 'tw' });
        const twTripod = createForceUnitHarness({
            internalLocations: ['LL', 'CL', 'RL'],
            committedDestroyedLocations: ['LL'],
            rulesId: 'tw',
        });
        const twQuadWithOneDestroyedLeg = createForceUnitHarness({
            internalLocations: ['RLL', 'FLL', 'RRL', 'FRL'],
            committedDestroyedLocations: ['RLL'],
            rulesId: 'tw',
        });
        const twQuadWithTwoDestroyedLegs = createForceUnitHarness({
            internalLocations: ['RLL', 'FLL', 'RRL', 'FRL'],
            committedDestroyedLocations: ['RLL', 'FLL'],
            rulesId: 'tw',
        });
        const twQuadWithThreeDestroyedLegs = createForceUnitHarness({
            internalLocations: ['RLL', 'FLL', 'RRL', 'FRL'],
            committedDestroyedLocations: ['RLL', 'FLL', 'RRL'],
            rulesId: 'tw',
        });
        const offersRun = (unit: CBTForceUnit) => unit.getAvailableMotiveModes(false)
            .some(option => option.mode === 'run');
        const runAvailability = (unit: CBTForceUnit) => ({
            rules: unit.rules.isMotiveModeAvailable('run'),
            offered: offersRun(unit),
        });

        expect((coreBiped.rules as MekRules).movementState())
            .toEqual(jasmine.objectContaining({ walk: 1, run: 2 }));
        expect((coreTripod.rules as MekRules).movementState())
            .toEqual(jasmine.objectContaining({ walk: 1, run: 2 }));
        expect((coreQuadWithTwoDestroyedLegs.rules as MekRules).movementState())
            .toEqual(jasmine.objectContaining({ walk: 1, run: 2 }));
        expect((coreQuadWithThreeDestroyedLegs.rules as MekRules).movementState())
            .toEqual(jasmine.objectContaining({ walk: 1, run: 2 }));
        expect((twBiped.rules as MekRules).movementState())
            .toEqual(jasmine.objectContaining({ walk: 1, run: 0 }));
        expect((twTripod.rules as MekRules).movementState())
            .toEqual(jasmine.objectContaining({ walk: 1, run: 0 }));
        expect((twQuadWithOneDestroyedLeg.rules as MekRules).movementState())
            .toEqual(jasmine.objectContaining({ walk: 4, run: 6 }));
        expect((twQuadWithTwoDestroyedLegs.rules as MekRules).movementState())
            .toEqual(jasmine.objectContaining({ walk: 1, run: 0 }));
        expect((twQuadWithThreeDestroyedLegs.rules as MekRules).movementState())
            .toEqual(jasmine.objectContaining({ walk: 0, run: 0 }));
        expect(runAvailability(coreBiped)).toEqual({ rules: true, offered: true });
        expect(runAvailability(coreTripod)).toEqual({ rules: true, offered: true });
        expect(runAvailability(coreQuadWithTwoDestroyedLegs))
            .toEqual({ rules: true, offered: true });
        expect(runAvailability(coreQuadWithThreeDestroyedLegs))
            .toEqual({ rules: true, offered: true });
        expect(runAvailability(twBiped)).toEqual({ rules: true, offered: true });
        expect(runAvailability(twTripod)).toEqual({ rules: true, offered: true });
        expect(runAvailability(twQuadWithOneDestroyedLeg))
            .toEqual({ rules: true, offered: true });
        expect(runAvailability(twQuadWithTwoDestroyedLegs))
            .toEqual({ rules: true, offered: true });
        expect(runAvailability(twQuadWithThreeDestroyedLegs))
            .toEqual({ rules: false, offered: false });
    });

    it('offers TW Running Minimum Movement and spends it on a one-legged stand attempt', () => {
        const forceUnit = createForceUnitHarness({
            committedDestroyedLocations: ['LL'],
            rulesId: 'tw',
        });
        const turnState = forceUnit.turnState();
        const offersRun = () => forceUnit.getAvailableMotiveModes(false)
            .some(option => option.mode === 'run');

        expect(forceUnit.rules.isMotiveModeAvailable('run')).toBeTrue();
        expect(offersRun()).toBeTrue();
        expect(forceUnit.rules.getEffectiveMaxDistanceForMoveMode('run', turnState)).toBe(1);

        turnState.moveMode.set('run');
        turnState.moveDistance.set(1);

        expect(turnState.movementCapacityCurrentMoveMode()).toBe(1);
        expect(turnState.maxDistanceCurrentMoveMode()).toBe(1);
        expect(forceUnit.getAvailableMotiveModes(false).find(option => option.mode === 'run')?.psr).toBeFalse();

        forceUnit.setCondition('prone', true);

        expect(forceUnit.rules.isMotiveModeAvailable('run')).toBeTrue();
        expect(offersRun()).toBeTrue();
        expect(turnState.movementCapacityCurrentMoveMode()).toBe(1);
        expect(turnState.maxDistanceCurrentMoveMode()).toBe(1);

        expect(turnState.resolveStandAttempt('success')).toBeTrue();

        expect(turnState.moveMode()).toBe('run');
        expect(turnState.standAttempts()).toBe(1);
        expect(forceUnit.rules.getMovementPointsSpent(turnState)).toBe(2);
        expect(turnState.movementCapacityCurrentMoveMode()).toBe(1);
        expect(turnState.maxDistanceCurrentMoveMode()).toBe(0);
        expect(offersRun()).toBeTrue();

        turnState.moveMode.set(null);

        expect(offersRun()).toBeTrue();
    });

    it('does not grant TW Running Minimum Movement without usable Walking MP', () => {
        const forceUnit = createForceUnitHarness({
            committedDestroyedLocations: ['LL'],
            rulesId: 'tw',
            walk: 0,
            run: 0,
        });

        expect((forceUnit.rules as MekRules).movementState())
            .toEqual(jasmine.objectContaining({ walk: 0, run: 0 }));
        expect(forceUnit.rules.isMotiveModeAvailable('run')).toBeFalse();
        expect(forceUnit.getAvailableMotiveModes(false).some(option => option.mode === 'run')).toBeFalse();
        expect(forceUnit.rules.getEffectiveMaxDistanceForMoveMode('run', forceUnit.turnState())).toBe(0);
    });

    it('requires heat-adjusted Walking MP for ground movement and standing', () => {
        const forceUnit = createForceUnitHarness({ walk: 5, run: 8 });
        const turnState = forceUnit.turnState();
        forceUnit.setCondition('prone', true);

        forceUnit.setHeatData({ current: 24, previous: 24 });

        expect((forceUnit.rules as MekRules).movementState())
            .toEqual(jasmine.objectContaining({ walk: 1, run: 2 }));
        expect(forceUnit.rules.isMotiveModeAvailable('walk')).toBeTrue();
        expect(forceUnit.rules.isMotiveModeAvailable('run')).toBeTrue();
        expect(turnState.canStandUp()).toBeTrue();

        forceUnit.setHeatData({ current: 30, previous: 30 });

        expect((forceUnit.rules as MekRules).movementState())
            .toEqual(jasmine.objectContaining({ walk: 0, run: 0 }));
        expect(forceUnit.rules.isMotiveModeAvailable('walk')).toBeFalse();
        expect(forceUnit.rules.isMotiveModeAvailable('run')).toBeFalse();
        expect(forceUnit.getAvailableMotiveModes(false).map(option => option.mode))
            .not.toContain('walk');
        expect(forceUnit.getAvailableMotiveModes(false).map(option => option.mode))
            .not.toContain('run');
        expect(turnState.canStandUp()).toBeFalse();
    });

    it('does not offer Walk when leg destruction leaves no ground MP or facing change', () => {
        const scenarios = [
            {
                context: 'Core biped with both legs destroyed',
                internalLocations: ['LL', 'RL'],
                committedDestroyedLocations: ['LL', 'RL'],
                rulesId: 'core2026' as const,
            },
            {
                context: 'Core quad with all legs destroyed',
                internalLocations: ['RLL', 'FLL', 'RRL', 'FRL'],
                committedDestroyedLocations: ['RLL', 'FLL', 'RRL', 'FRL'],
                rulesId: 'core2026' as const,
            },
            {
                context: 'TW biped with both legs destroyed',
                internalLocations: ['LL', 'RL'],
                committedDestroyedLocations: ['LL', 'RL'],
                rulesId: 'tw' as const,
            },
            {
                context: 'TW quad with three legs destroyed',
                internalLocations: ['RLL', 'FLL', 'RRL', 'FRL'],
                committedDestroyedLocations: ['RLL', 'FLL', 'RRL'],
                rulesId: 'tw' as const,
            },
        ];

        for (const scenario of scenarios) {
            const forceUnit = createForceUnitHarness(scenario);

            expect((forceUnit.rules as MekRules).movementState()?.walk)
                .withContext(scenario.context)
                .toBe(0);
            expect(forceUnit.rules.isMotiveModeAvailable('walk'))
                .withContext(scenario.context)
                .toBeFalse();
            expect(forceUnit.getAvailableMotiveModes(false).some(option => option.mode === 'walk'))
                .withContext(scenario.context)
                .toBeFalse();
        }
    });

    it('offers only Stationary when a TW Mek is actually immobile', () => {
        const forceUnit = createForceUnitHarness({
            internalLocations: ['LA', 'RA', 'LL', 'RL'],
            committedDestroyedLocations: ['LA', 'RA', 'LL', 'RL'],
            rulesId: 'tw',
            jump: 4,
            umu: 2,
        });

        expect(forceUnit.getCondition('immobile')).toBeTrue();
        expect(forceUnit.getAvailableMotiveModes(false).map(option => option.mode)).toEqual(['stationary']);
    });

    it('colors Run for the current action rather than a potential destroyed-leg check', () => {
        const forceUnit = createForceUnitHarness({
            internalLocations: ['RLL', 'FLL', 'RRL', 'FRL'],
            committedDestroyedLocations: ['RLL', 'FLL', 'RRL'],
            walk: 4,
            run: 6,
        });
        const turnState = forceUnit.turnState();
        const runOption = () => forceUnit.getAvailableMotiveModes(false)
            .find(option => option.mode === 'run');
        turnState.moveMode.set('run');
        turnState.moveDistance.set(0);
        forceUnit.setCondition('prone', true);

        expect(runOption()?.psr).toBeFalse();

        forceUnit.setCondition('prone', false);
        turnState.moveDistance.set(1);

        expect(runOption()?.psr).toBeTrue();
    });

    it('applies hip-hit movement effects to a Core Quad with two destroyed legs', () => {
        const forceUnit = createForceUnitHarness({
            internalLocations: ['RLL', 'FLL', 'RRL', 'FRL'],
            committedDestroyedLocations: ['RLL', 'FLL'],
            walk: 4,
            run: 6,
        });
        const turnState = forceUnit.turnState();
        turnState.moveMode.set('run');
        turnState.moveDistance.set(0);

        const runOption = forceUnit.getAvailableMotiveModes(false)
            .find(option => option.mode === 'run');

        expect(runOption?.psr).toBeFalse();
        expect(turnState.getPSRChecks().some(
            check => check.kind === PSR_CHECK_KIND.QUAD_TWO_DESTROYED_LEGS_MOVEMENT,
        )).toBeFalse();

        turnState.moveDistance.set(1);

        expect(forceUnit.getAvailableMotiveModes(false).find(option => option.mode === 'run')?.psr).toBeTrue();
        expect(turnState.getPSRChecks()).toContain(jasmine.objectContaining({
            kind: PSR_CHECK_KIND.QUAD_TWO_DESTROYED_LEGS_MOVEMENT,
        }));
    });

    it('keeps TW Run colored when running itself triggers a zero-hex damage PSR', () => {
        const forceUnit = createForceUnitHarness({
            critSlots: [{ ...crit('Gyro'), loc: 'CT' }],
            rulesId: 'tw',
        });
        const turnState = forceUnit.turnState();
        turnState.moveMode.set('run');
        turnState.moveDistance.set(0);

        const runOption = forceUnit.getAvailableMotiveModes(false)
            .find(option => option.mode === 'run');

        expect(runOption?.psr).toBeTrue();
    });

    it('does not invent a TW PSR merely because destroyed-leg Minimum Movement counts as running', () => {
        const biped = createForceUnitHarness({
            committedDestroyedLocations: ['LL'],
            rulesId: 'tw',
        });
        const bipedTurnState = biped.turnState();
        bipedTurnState.moveMode.set('run');
        bipedTurnState.moveDistance.set(0);

        expect((biped.rules as MekRules).movementState())
            .toEqual(jasmine.objectContaining({ walk: 1, run: 0 }));
        expect(biped.rules.isMotiveModeAvailable('run')).toBeTrue();
        expect(biped.rules.getCommittedDamageMovementModePSRCheck('run', 0)).toBeNull();
        expect(biped.getAvailableMotiveModes(false).find(option => option.mode === 'run')?.psr).toBeFalse();

        const oneDestroyedLegQuad = createRulesHarness({
            internalLocations: ['RLL', 'FLL', 'RRL', 'FRL'],
            committedDestroyedLocations: ['RLL'],
            rulesId: 'tw',
        });
        const twoDestroyedLegQuad = createRulesHarness({
            internalLocations: ['RLL', 'FLL', 'RRL', 'FRL'],
            committedDestroyedLocations: ['RLL', 'FLL'],
            rulesId: 'tw',
        });

        expect(oneDestroyedLegQuad.getCommittedDamageMovementModePSRCheck('run', 0)).toBeNull();
        expect(twoDestroyedLegQuad.isMotiveModeAvailable('run')).toBeTrue();
        expect(twoDestroyedLegQuad.getCommittedDamageMovementModePSRCheck('run', 0)).toBeNull();
    });

    it('ignores a TW hip hit in a destroyed leg but checks a hip in the surviving leg', () => {
        const destroyedLegHip = createRulesHarness({
            committedDestroyedLocations: ['LL'],
            critSlots: [{ ...crit('Hip'), loc: 'LL' }],
            rulesId: 'tw',
        });
        const survivingLegHip = createRulesHarness({
            committedDestroyedLocations: ['LL'],
            critSlots: [{ ...crit('Hip'), loc: 'RL' }],
            rulesId: 'tw',
        });

        expect(destroyedLegHip.getCommittedDamageMovementModePSRCheck('run', 0)).toBeNull();
        expect(survivingLegHip.getCommittedDamageMovementModePSRCheck('run', 0)?.reason)
            .toBe('Running with damaged hip');
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
            { destroyed: ['RLL', 'FLL', 'RRL'], walk: 1, run: 2, psr: 4 },
            { destroyed: locations, walk: 0, run: 0, psr: 0 },
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

    it('keeps the fixed Core 1/2 profile when the sole remaining Quad leg has actuator damage', () => {
        const rules = createRulesHarness({
            internalLocations: ['RLL', 'FLL', 'RRL', 'FRL'],
            committedDestroyedLocations: ['RLL', 'FLL', 'RRL'],
            critSlots: [{ ...crit('Upper Leg Actuator'), loc: 'FRL' }],
            walk: 5,
            run: 8,
        });

        expect(rules.movementState()).toEqual(jasmine.objectContaining({ walk: 1, run: 2 }));
    });

    it('uses aggregate TW Quad leg-destruction PSR modifiers', () => {
        const locations = ['RLL', 'FLL', 'RRL', 'FRL'];
        const expected = [
            { destroyed: ['RLL'], modifier: 0 },
            { destroyed: ['RLL', 'FLL'], modifier: 5 },
            { destroyed: ['RLL', 'FLL', 'RRL'], modifier: 0 },
            { destroyed: locations, modifier: 0 },
        ];

        for (const scenario of expected) {
            const rules = createRulesHarness({
                internalLocations: locations,
                committedDestroyedLocations: scenario.destroyed,
                rulesId: 'tw',
            });

            expect(rules.PSRModifiers().modifier)
                .withContext(`${scenario.destroyed.length} destroyed Quad legs`)
                .toBe(scenario.modifier);
        }
    });

    it('applies the TW Quad one-leg +5 only to the required jump PSR', () => {
        const forceUnit = createForceUnitHarness({
            internalLocations: ['RLL', 'FLL', 'RRL', 'FRL'],
            committedDestroyedLocations: ['RLL'],
            rulesId: 'tw',
        });
        const turnState = forceUnit.turnState();

        expect(forceUnit.rules.PSRModifiers().modifier).toBe(0);
        expect(forceUnit.rules.getCommittedDamageMovementModePSRCheck('run', 0)).toBeNull();
        expect(forceUnit.rules.getCommittedDamageMovementModePSRCheck('jump', 0))
            .toEqual(jasmine.objectContaining({ pilotCheck: 5, reason: 'Jumping with damaged leg' }));

        turnState.moveMode.set('jump');
        turnState.moveDistance.set(1);

        expect(turnState.getPSRChecks()).toEqual([
            jasmine.objectContaining({ pilotCheck: 5, reason: 'Jumping with damaged leg' }),
        ]);
        expect(forceUnit.rules.PSRModifiers().modifier).toBe(5);
    });

    it('halves TW Quad Walking MP for each surviving-leg hip hit after leg-loss adjustment', () => {
        const rules = createRulesHarness({
            internalLocations: ['RLL', 'FLL', 'RRL', 'FRL'],
            committedDestroyedLocations: ['RLL'],
            critSlots: [{ ...crit('Hip'), loc: 'FRL' }],
            rulesId: 'tw',
            walk: 5,
            run: 8,
        });

        expect(rules.movementState()).toEqual(jasmine.objectContaining({ walk: 2, run: 3 }));
    });

    it('reduces TW ground MP to zero at the terminal hip threshold without making the Mek immobile', () => {
        const scenarios = [
            { name: 'biped', locations: ['LL', 'RL'], hips: ['LL', 'RL'] },
            { name: 'tripod', locations: ['LL', 'RL', 'CL'], hips: ['LL', 'RL'] },
            { name: 'tripod past threshold', locations: ['LL', 'RL', 'CL'], hips: ['LL', 'RL', 'CL'] },
            { name: 'quad', locations: ['RLL', 'FLL', 'RRL', 'FRL'], hips: ['RLL', 'FLL', 'RRL', 'FRL'] },
        ];

        for (const scenario of scenarios) {
            const forceUnit = createForceUnitHarness({
                internalLocations: scenario.locations,
                critSlots: scenario.hips.map((loc, index) => ({
                    ...crit('Hip'),
                    id: `${loc}-hip`,
                    loc,
                    slot: index,
                })),
                rulesId: 'tw',
                walk: 5,
                run: 8,
            });

            expect((forceUnit.rules as MekRules).movementState())
                .withContext(scenario.name)
                .toEqual(jasmine.objectContaining({ walk: 0, run: 0, moveImpaired: true }));
            expect(forceUnit.rules.hasComputedCondition('immobile'))
                .withContext(scenario.name)
                .toBeFalse();
        }
    });

    it('keeps the Core Quad two-destroyed-leg run trigger to one PSR', () => {
        const forceUnit = createForceUnitHarness({
            internalLocations: ['RLL', 'FLL', 'RRL', 'FRL'],
            committedDestroyedLocations: ['RLL', 'FLL'],
            critSlots: [
                { ...crit('Hip'), id: 'rear-left-hip', loc: 'RLL' },
                { ...crit('Hip'), id: 'front-left-hip', loc: 'FLL' },
            ],
        });
        const turnState = forceUnit.turnState();
        turnState.moveMode.set('run');
        turnState.moveDistance.set(1);

        expect(turnState.getPSRChecks().filter(
            check => check.kind === PSR_CHECK_KIND.QUAD_TWO_DESTROYED_LEGS_MOVEMENT,
        ).length)
            .toBe(1);
    });

    it('does not let an intact Core Quad stand with a destroyed gyro', () => {
        const forceUnit = createForceUnitHarness({
            internalLocations: ['RLL', 'FLL', 'RRL', 'FRL'],
            critSlots: [
                { id: 'gyro-1', name: 'Gyro', loc: 'CT', slot: 0, destroyed: 1 },
                { id: 'gyro-2', name: 'Gyro', loc: 'CT', slot: 1, destroyed: 1 },
            ],
        });
        forceUnit.setCondition('prone', true);

        expect(forceUnit.turnState().canStandUp()).toBeFalse();
        // This only classifies an otherwise-legal stand; canStandUp owns eligibility.
        expect(forceUnit.turnState().canStandWithoutPSR()).toBeTrue();
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
        const threeLegQuad = createRulesHarness({
            internalLocations: ['RLL', 'FLL', 'RRL', 'FRL'],
            committedDestroyedLocations: ['RLL', 'FLL', 'RRL'],
        });

        expect(oneLegQuad.getCommittedDamageMovementModePSRCheck('run', 1)).toBeNull();
        expect(oneLegQuad.getCommittedDamageMovementModePSRCheck('jump', 1)).toBeNull();
        expect(twoLegQuad.getCommittedDamageMovementModePSRCheck('run', 0)).toBeNull();
        expect(twoLegQuad.getCommittedDamageMovementModePSRCheck('run', 1)?.reason)
            .toBe('Running with two destroyed legs');
        expect(twoLegQuad.getCommittedDamageMovementModePSRCheck('run', 1)?.kind)
            .toBe(PSR_CHECK_KIND.QUAD_TWO_DESTROYED_LEGS_MOVEMENT);
        expect(twoLegQuad.getCommittedDamageMovementModePSRCheck('jump', 0)?.reason)
            .toBe('Jumping with two destroyed legs');
        expect(twoLegQuad.getCommittedDamageMovementModePSRCheck('run', 1)?.loc).toBeUndefined();
        expect(threeLegQuad.getCommittedDamageMovementModePSRCheck('run', 0)).toBeNull();
        expect(threeLegQuad.getCommittedDamageMovementModePSRCheck('run', 1)?.reason)
            .toBe('Running with damaged leg');
        expect(threeLegQuad.getCommittedDamageMovementModePSRCheck('jump', 0)?.reason)
            .toBe('Jumping with damaged leg');

        const damagedGyro = createRulesHarness({
            critSlots: [{ ...crit('Gyro'), loc: 'CT' }],
        });
        const damagedHip = createRulesHarness({
            critSlots: [{ ...crit('Hip'), loc: 'LL' }],
        });

        expect(damagedGyro.getCommittedDamageMovementModePSRCheck('run', 0)).toBeNull();
        expect(damagedHip.getCommittedDamageMovementModePSRCheck('run', 0)).toBeNull();

        const twDamagedGyro = createRulesHarness({
            critSlots: [{ ...crit('Gyro'), loc: 'CT' }],
            rulesId: 'tw',
        });
        const twDamagedHip = createRulesHarness({
            critSlots: [{ ...crit('Hip'), loc: 'LL' }],
            rulesId: 'tw',
        });

        expect(twDamagedGyro.getCommittedDamageMovementModePSRCheck('run', 0)?.reason)
            .toBe('Running with damaged gyro');
        expect(twDamagedHip.getCommittedDamageMovementModePSRCheck('run', 0)?.reason)
            .toBe('Running with damaged hip');
        expect(twDamagedHip.getCommittedDamageMovementModePSRCheck('run', 0)?.kind)
            .toBe(PSR_CHECK_KIND.DAMAGED_HIP_MOVEMENT);
    });

    it('requires a jump PSR for foot damage without requiring a run PSR', () => {
        const rules = createRulesHarness({
            critSlots: [{ ...crit('Foot'), loc: 'RL' }],
        });

        expect(rules.getCommittedDamageMovementModePSRCheck('jump', 0)?.reason)
            .toBe('Jumping with damaged leg actuator');
        expect(rules.getCommittedDamageMovementModePSRCheck('jump', 0)?.kind)
            .toBe(PSR_CHECK_KIND.DAMAGED_LEG_ACTUATOR_MOVEMENT);
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

    it('ignores Core fall checks while prone but retains the Core hip modifier', () => {
        const forceUnit = createForceUnitHarness({
            critSlots: [legActuatorCrit('hip', 'Hip', 'LL')],
        });
        const turnState = forceUnit.turnState();
        forceUnit.setCondition('prone', true);
        turnState.moveMode.set('run');
        turnState.moveDistance.set(0);
        turnState.addDmgReceived(20);
        turnState.setPSRCheckState({ hipsHit: new Set(['LL']) });

        expect(turnState.getPSRChecks()).toEqual([]);
        expect(turnState.PSRRollsCount()).toBe(0);
        expect(forceUnit.rules.PSRModifiers()).toEqual(jasmine.objectContaining({
            modifier: 1,
            modifiers: jasmine.arrayContaining([
                jasmine.objectContaining({ pilotCheck: 1, loc: 'LL', reason: 'Hip Destroyed' }),
            ]),
        }));
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
        expect(checks.find(check => check.kind === PSR_CHECK_KIND.DAMAGE_THRESHOLD)?.loc).toBeUndefined();
        expect(checks.find(check => check.kind === PSR_CHECK_KIND.LEG_DAMAGE)?.loc).toBe('LL');
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
        expect(forceUnit.rules.PSRModifiers().modifier).toBe(2);
        expect(forceUnit.rules.PSRModifiers().modifiers).toEqual(jasmine.arrayContaining([
            jasmine.objectContaining({ pilotCheck: 1, loc: 'LL', reason: 'Hip Destroyed' }),
            jasmine.objectContaining({ pilotCheck: 1, loc: 'LL', reason: 'Leg Actuator(s) Destroyed' }),
        ]));
        expect(forceUnit.rules.PSRModifiers().modifiers.some(
            modifier => modifier.reason === 'Foot Actuator(s) Destroyed',
        )).toBeFalse();
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
        expect(forceUnit.rules.PSRModifiers().modifier).toBe(2);
    });

    it('keeps Core pre-existing leg actuator modifiers grouped by location and ignores feet', () => {
        const forceUnit = createForceUnitHarness({
            critSlots: [
                legActuatorCrit('upper-leg', 'Upper Leg Actuator', 'LL'),
                legActuatorCrit('lower-leg', 'Lower Leg Actuator', 'LL'),
                legActuatorCrit('foot', 'Foot', 'RL'),
            ],
        });

        expect(forceUnit.rules.PSRModifiers().modifier).toBe(2);
        expect(forceUnit.rules.PSRModifiers().modifiers).toEqual(jasmine.arrayContaining([
            jasmine.objectContaining({
                pilotCheck: 2,
                loc: 'LL',
                reason: 'Leg Actuator(s) Destroyed',
                modifierReason: 'Leg Actuators Destroyed (2)',
            }),
        ]));
        expect(forceUnit.rules.PSRModifiers().modifiers.some(modifier => modifier.loc === 'RL')).toBeFalse();
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

            expect(turnState.getPSRChecks().some(
                check => check.kind === PSR_CHECK_KIND.GYRO_HIT,
            )).toBeFalse();
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
            reason: 'Jumping with damaged HD gyro',
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
        expect(rules.PSRModifiers().modifiers.some(modifier =>
            modifier.reason === 'Leg Actuator(s) Destroyed'
            || modifier.reason === 'Foot Actuator(s) Destroyed'
        )).toBeFalse();
        expect(rules.PSRModifiers().modifiers).toContain(jasmine.objectContaining({ pilotCheck: 2, reason: 'Gyro damaged' }));
        expect(toHitModifierTotal(rules.getEquipmentToHitModifiers(armWeapon))).toBe(0);

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
        expect(toHitModifierTotal(twRules.getEquipmentToHitModifiers(twArmWeapon))).toBe(1);
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

    it('treats a pending blown-off leg as an immediate fall trigger', () => {
        const forceUnit = createForceUnitHarness({ internalLocations: ['LL', 'RL'] });
        const turnState = forceUnit.turnState();

        forceUnit.setLocationCondition('LL', 'blown-off', true);

        expect(turnState.getPSRCheckState().legsDestroyed).toEqual(new Set(['LL']));
        expect(turnState.autoFall()).toBeTrue();
        expect(forceUnit.getCondition('prone')).toBeFalse();
        expect(turnState.getPSRChecks()).toContain(jasmine.objectContaining({
            loc: 'LL',
            reason: 'Leg destroyed',
        }));

        forceUnit.setLocationCondition('LL', 'blown-off', false);

        expect(turnState.getPSRCheckState().legsDestroyed).toEqual(new Set());
        expect(turnState.autoFall()).toBeFalse();

        forceUnit.setLocationCondition('LL', 'blown-off', true);
        expect(turnState.resolveAutomaticFall()).toBeTrue();
        forceUnit.endPhase();

        expect(turnState.autoFall()).toBeFalse();
        expect(forceUnit.getCondition('prone')).toBeTrue();
    });

    it('treats a flooded CORE leg as a destroyed leg and immediate fall trigger', () => {
        const forceUnit = createForceUnitHarness({ internalLocations: ['LL', 'RL'] });
        const turnState = forceUnit.turnState();

        forceUnit.setLocationCondition('LL', 'flooded', true);

        expect(turnState.getPSRCheckState().legsDestroyed).toEqual(new Set(['LL']));
        expect(turnState.autoFall()).toBeTrue();
        expect(turnState.getPSRChecks()).toContain(jasmine.objectContaining({
            loc: 'LL',
            reason: 'Leg destroyed',
        }));
    });

    it('treats the first pending blown-off quad leg as an immediate fall trigger', () => {
        const forceUnit = createForceUnitHarness({ internalLocations: ['FLL', 'FRL', 'RLL', 'RRL'] });
        const turnState = forceUnit.turnState();

        forceUnit.setLocationCondition('FLL', 'blown-off', true);

        expect(turnState.getPSRCheckState().legsDestroyed).toEqual(new Set(['FLL']));
        expect(turnState.autoFall()).toBeTrue();

        expect(turnState.resolveAutomaticFall()).toBeTrue();
        forceUnit.endPhase();

        expect(turnState.autoFall()).toBeFalse();
        expect(forceUnit.getCondition('prone')).toBeTrue();
    });

    it('does not disable inventory in pending destructive location conditions until phase commit', () => {
        const forceUnit = createForceUnitHarness({ internalLocations: ['LL'] });
        const rules = forceUnit.rules as MekRules;
        const entry = new MountedEquipment({ owner: forceUnit, id: 'test-entry', name: 'Test Entry', locations: new Set(['LL']) });

        forceUnit.setLocationCondition('LL', 'flooded', true);

        expect(forceUnit.getEquipmentStatus(entry)).toBe('available');

        forceUnit.endPhase();

        expect(forceUnit.getEquipmentStatus(entry)).toBe('disabled');

        forceUnit.setLocationCondition('LL', 'flooded', false);

        expect(forceUnit.getEquipmentStatus(entry)).toBe('available');
    });

    it('marks blown-off location inventory as damaged and disabled without destroying it', () => {
        const forceUnit = createForceUnitHarness({ internalLocations: ['LL'] });
        const critSlot = { id: 'test-weapon', name: 'Test Weapon', loc: 'LL', slot: 0 } as CriticalSlot;
        const entry = new MountedEquipment({ owner: forceUnit, id: 'test-entry', name: 'Test Entry', locations: new Set(['LL']), critSlots: [critSlot] });

        forceUnit.writeCrits([critSlot]);
        forceUnit.setInventory([entry]);
        const storedEntry = forceUnit.getInventory().find(item => item.id === entry.id)!;
        forceUnit.setLocationCondition('LL', 'blown-off', true);
        forceUnit.endPhase();
        expect(forceUnit.isInternalLocCommittedPhysicallyDestroyed('LL')).toBeTrue();
        expect(forceUnit.getCritSlots().every(slot => !slot.destroying && !slot.destroyed)).toBeTrue();
        expect(storedEntry.committedDestroyed()).toBeFalse();
        expect(forceUnit.getEquipmentStatus(storedEntry)).toBe('destroyed');
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
        const firstModifiers = rules.getEquipmentToHitModifiers(storedEntry);
        const secondModifiers = rules.getEquipmentToHitModifiers(storedEntry);

        expect(forceUnit.isInternalLocCommittedStructurallyDestroyed('LL')).toBeTrue();
        expect(storedEntry.committedDestroyed()).toBeFalse();
        expect(firstModifiers).toEqual(secondModifiers);
        expect(firstModifiers).not.toBe(secondModifiers);
        expect(forceUnit.getEquipmentStatus(storedEntry)).toBe('destroyed');
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
        const parentModifiers = rules.getEquipmentToHitModifiers(storedParentEntry);
        const linkedModifiers = rules.getEquipmentToHitModifiers(storedLinkedEntry);

        expect(forceUnit.isInternalLocCommittedStructurallyDestroyed('RT')).toBeTrue();
        expect(forceUnit.isInternalLocCommittedStructurallyDestroyed('RA')).toBeFalse();
        expect(forceUnit.isInternalLocCommittedPhysicallyDestroyed('RA')).toBeTrue();
        expect(storedParentEntry.committedDestroyed()).toBeFalse();
        expect(storedLinkedEntry.committedDestroyed()).toBeFalse();
        const freshParentModifiers = rules.getEquipmentToHitModifiers(storedParentEntry);
        const freshLinkedModifiers = rules.getEquipmentToHitModifiers(storedLinkedEntry);
        expect(parentModifiers).toEqual(freshParentModifiers);
        expect(parentModifiers).not.toBe(freshParentModifiers);
        expect(linkedModifiers).toEqual(freshLinkedModifiers);
        expect(linkedModifiers).not.toBe(freshLinkedModifiers);
        expect(forceUnit.getEquipmentStatus(storedParentEntry)).toBe('destroyed');
        expect(forceUnit.getEquipmentStatus(storedLinkedEntry)).toBe('destroyed');
    });

    it('disables linked-location inventory from flooded torsos without marking it damaged', () => {
        const forceUnit = createForceUnitHarness({ internalLocations: ['LT', 'LA'] });
        const rules = forceUnit.rules as MekRules;
        const entry = new MountedEquipment({ owner: forceUnit, id: 'left-arm-entry', name: 'Left Arm Entry', locations: new Set(['LA']) });

        forceUnit.setLocationCondition('LT', 'flooded', true);
        forceUnit.endPhase();

        expect(forceUnit.isInternalLocCommittedDestroyed('LA')).toBeTrue();
        expect(forceUnit.isInternalLocCommittedPhysicallyDestroyed('LA')).toBeFalse();
        expect(forceUnit.getEquipmentStatus(entry)).toBe('disabled');
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

    it('uses Core 2026 Life Support heat thresholds, including torso-mounted cockpits', () => {
        const intact = createRulesHarness();
        const standard = createRulesHarness({
            critSlots: [
                { id: 'life-support', name: 'Life Support', loc: 'HD', slot: 0, destroyed: 1 },
            ],
        });
        const torsoCockpit = createRulesHarness({
            critSlots: [
                { id: 'cockpit', name: 'Cockpit', loc: 'CT', slot: 0 },
                { id: 'life-support', name: 'Life Support', loc: 'HD', slot: 0, destroyed: 1 },
            ],
        });

        expect(intact.heatLifeSupportPilotHits(30)).toBe(0);
        expect([9, 10, 19, 20].map(heat => standard.heatLifeSupportPilotHits(heat))).toEqual([0, 1, 1, 2]);
        expect([1, 14, 15].map(heat => torsoCockpit.heatLifeSupportPilotHits(heat))).toEqual([1, 1, 2]);
    });

    it('suppresses head-hit pilot damage for a torso-mounted cockpit', () => {
        const standard = createRulesHarness();
        const torsoCockpit = createRulesHarness({
            critSlots: [{ id: 'cockpit', name: 'Cockpit', loc: 'CT', slot: 0 }],
        });

        expect(standard.headHitPilotHits()).toBe(1);
        expect(torsoCockpit.headHitPilotHits()).toBe(0);
    });

    it('applies damaged Life Support drowning in Depth 2 standing or Depth 1 prone', () => {
        const forceUnit = createForceUnitHarness({
            critSlots: [{ id: 'life-support', name: 'Life Support', loc: 'HD', slot: 0, destroyed: 1 }],
        });

        expect(forceUnit.rules.submergedLifeSupportPilotHits()).toBe(0);

        forceUnit.turnState().setCover('underwater-depth-1');
        expect(forceUnit.rules.submergedLifeSupportPilotHits()).toBe(0);

        forceUnit.setCondition('prone', true);
        expect(forceUnit.rules.submergedLifeSupportPilotHits()).toBe(1);

        forceUnit.setCondition('prone', false);

        forceUnit.turnState().setCover('underwater-depth-2');

        expect(forceUnit.rules.submergedLifeSupportPilotHits()).toBe(1);
    });

    it('superheavy Meks are height 3, they need Depth 2 and Prone to start drowning', () => {
        const forceUnit = createForceUnitHarness({
            tons: 150,
            critSlots: [{ id: 'life-support', name: 'Life Support', loc: 'HD', slot: 0, destroyed: 1 }],
        });
        forceUnit.setCondition('prone', true);
        expect(forceUnit.getHeight()).toBe(2);
        forceUnit.turnState().setCover('underwater-depth-1');
        expect(forceUnit.turnState().submerged()).toBeFalse();
        forceUnit.turnState().setCover('underwater-depth-2');
        expect(forceUnit.turnState().submerged()).toBeTrue();
        expect(forceUnit.rules.submergedLifeSupportPilotHits()).toBe(1);
    });
});


