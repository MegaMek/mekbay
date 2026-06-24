import { Injector } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { AmmoEquipment, WeaponEquipment, type EquipmentMap } from './equipment.model';
import { CBTForce } from './cbt-force.model';
import { CBTForceUnit } from './cbt-force-unit.model';
import { INVENTORY_CONTROL_TARGET_MAX_COUNT } from './inventory-control-runtime-state.model';
import type { CBTSerializedUnit, CriticalSlot } from './force-serialization';
import { DataService } from '../services/data.service';
import { UnitInitializerService } from '../services/unit-initializer.service';
import { UnitSvgService } from '../services/unit-svg.service';
import { UnitSvgVehicleService } from '../services/unit-svg-vehicle.service';
import { createEmptyUnit } from '../testing/unit-test-helpers';
import type { Unit } from './units.model';

function createEquipment(): EquipmentMap {
    const ultraAc20 = new WeaponEquipment({
        id: 'CLUltraAC20',
        name: 'Ultra AC/20',
        type: 'weapon',
        weapon: { ammoType: 'AC_ULTRA', rackSize: 20, ranges: [4, 8, 12, 16] }
    });
    const ultraAc20Ammo = new AmmoEquipment({
        id: 'Clan Ultra AC/20 Ammo',
        name: 'Clan Ultra AC/20 Ammo',
        shortName: 'Ultra AC/20 Ammo',
        type: 'ammo',
        ammo: { type: 'AC_ULTRA', rackSize: 20, shots: 5, kgPerShot: 200 }
    });
    const ultraAc20PrecisionAmmo = new AmmoEquipment({
        id: 'Clan Ultra AC/20 Precision Ammo',
        name: 'Clan Ultra AC/20 Precision Ammo',
        shortName: 'Ultra AC/20 Precision Ammo',
        type: 'ammo',
        ammo: { type: 'AC_ULTRA', rackSize: 20, shots: 4, kgPerShot: 250 }
    });
    const mediumVspLaser = new WeaponEquipment({
        id: 'ISMediumVSPLaser',
        name: 'Medium VSP Laser',
        type: 'weapon',
        flags: ['F_DIRECT_FIRE','F_PULSE','F_VSP'],
        weapon: { ammoType: 'NA', heat: 7, damage: [9, 7, 5], ranges: [2, 5, 9, 13] }
    });

    return {
        [ultraAc20.internalName]: ultraAc20,
        [ultraAc20Ammo.internalName]: ultraAc20Ammo,
        [ultraAc20PrecisionAmmo.internalName]: ultraAc20PrecisionAmmo,
        [mediumVspLaser.internalName]: mediumVspLaser,
    };
}

function createVehicleUnit(equipment: EquipmentMap): Unit {
    return createEmptyUnit({
        name: 'CVSMTankDestroyer_SM1',
        chassis: 'SM Tank Destroyer',
        model: 'SM1',
        type: 'Tank',
        subtype: 'Hovercraft',
        heat: -1,
        dissipation: -1,
        comp: [
            { id: 'CLUltraAC20', q: 1, q2: 0, n: 'Ultra AC/20', t: 'B', p: 1, l: 'FR', r: '4/8/12', m: '0', d: '20/Shot', md: '40.0', c: '1', os: 0, eq: equipment['CLUltraAC20'] },
            { id: 'Clan Ultra AC/20 Ammo', q: 6, q2: 30, n: 'Ultra AC/20 Ammo', t: 'X', p: 0, l: 'BD', c: '0', os: 0, eq: equipment['Clan Ultra AC/20 Ammo'] },
        ],
        sheets: ['vehicle/test.svg'],
    });
}

function createVehicleSvg(): SVGSVGElement {
    const parser = new DOMParser();
    return parser.parseFromString(`
        <svg xmlns="http://www.w3.org/2000/svg">
            <g class="inventoryEntry" id="CLUltraAC20@FR#0" hitMod="0">
                <g class="name"><text>Ultra AC/20</text></g>
                <text class="location">FR</text>
                <text class="range_short">4</text>
                <text class="range_medium">8</text>
                <text class="range_long">12</text>
                <rect class="hitMod-rect" display="block"></rect>
                <text class="hitMod-text" display="block">+0</text>
                <rect class="targetTn-rect" display="none"></rect>
                <text class="targetTn-text" display="none"></text>
            </g>
            <g id="ammoProfile"><text>Ammo: (Ultra AC/20) 30</text></g>
        </svg>
    `, 'image/svg+xml').documentElement as unknown as SVGSVGElement;
}

function createVspUnit(equipment: EquipmentMap): Unit {
    return createEmptyUnit({
        name: 'VSP Test Unit',
        chassis: 'VSP Test',
        model: 'T1',
        type: 'Tank',
        subtype: 'Hovercraft',
        heat: -1,
        dissipation: -1,
        comp: [
            { id: 'ISMediumVSPLaser', q: 1, q2: 0, n: 'Medium VSP Laser', t: 'E', p: 1, l: 'FR', r: '2/5/9', m: '-4', d: '9/7/5', md: '9.0', c: '1', os: 0, eq: equipment['ISMediumVSPLaser'] },
        ],
        sheets: ['vehicle/vsp-test.svg'],
    });
}

function createVspSvg(): SVGSVGElement {
    const parser = new DOMParser();
    return parser.parseFromString(`
        <svg xmlns="http://www.w3.org/2000/svg">
            <g class="inventoryEntry" id="ISMediumVSPLaser@FR#0" hitMod="-4">
                <g class="name"><text>Medium VSP Laser</text></g>
                <g class="damage"><text>9/7/5 [Variable]</text></g>
                <text class="location">FR</text>
                <text class="range_short">2</text>
                <text class="range_medium">5</text>
                <text class="range_long">9</text>
                <rect class="hitMod-rect" display="block"></rect>
                <text class="hitMod-text" display="block">-4</text>
                <rect class="targetTn-rect" display="none"></rect>
                <text class="targetTn-text" display="none"></text>
            </g>
        </svg>
    `, 'image/svg+xml').documentElement as unknown as SVGSVGElement;
}

class ExposedUnitSvgService extends UnitSvgService {
    refreshInventory(): void {
        this.updateInventory();
    }
}

class ExposedUnitSvgVehicleService extends UnitSvgVehicleService {
    refreshInventory(): void {
        this.updateInventory();
    }

    refreshCritLocs(critLocs = this.unit.getCritSlots()): void {
        this.updateCritLocDisplay(critLocs);
    }
}

class TestCBTForce extends CBTForce {
    emitCount = 0;

    override emitChanged(): void {
        this.emitCount++;
    }
}

describe('CBTForceUnit direct inventory ammo bins', () => {
    let equipment: EquipmentMap;
    let dataService: jasmine.SpyObj<DataService>;
    let unitInitializer: UnitInitializerService;
    let injector: Injector;

    beforeEach(() => {
        equipment = createEquipment();
        dataService = jasmine.createSpyObj<DataService>('DataService', ['getEquipments', 'getUnitByName']);
        dataService.getEquipments.and.returnValue(equipment);

        TestBed.configureTestingModule({
            providers: [
                UnitInitializerService,
                { provide: DataService, useValue: dataService },
            ],
        });

        unitInitializer = TestBed.inject(UnitInitializerService);
        injector = TestBed.inject(Injector);
    });

    function createForceUnit(unit: Unit = createVehicleUnit(equipment)): CBTForceUnit {
        dataService.getUnitByName.and.callFake((name: string) => name === unit.name ? unit : undefined);
        const force = new TestCBTForce('Test Force', dataService, unitInitializer, injector);
        return new CBTForceUnit(unit, force, dataService, unitInitializer, injector);
    }

    function initialize(unit: CBTForceUnit, svg = createVehicleSvg()): void {
        unit.svg.set(svg);
        unitInitializer.initializeUnitIfNeeded(unit, svg);
        unit.isLoaded.set(true);
    }

    it('splits direct inventory ammo into one entry per bin using q and q2', () => {
        const forceUnit = createForceUnit();

        initialize(forceUnit);

        const ammoEntries = forceUnit.getInventory().filter(entry => entry.equipment instanceof AmmoEquipment);
        expect(ammoEntries.length).toBe(6);
        expect(ammoEntries.map(entry => entry.id)).toEqual([
            'Clan Ultra AC/20 Ammo@BD#1.0',
            'Clan Ultra AC/20 Ammo@BD#1.1',
            'Clan Ultra AC/20 Ammo@BD#1.2',
            'Clan Ultra AC/20 Ammo@BD#1.3',
            'Clan Ultra AC/20 Ammo@BD#1.4',
            'Clan Ultra AC/20 Ammo@BD#1.5',
        ]);
        expect(ammoEntries.map(entry => entry.totalAmmo)).toEqual([5, 5, 5, 5, 5, 5]);
        expect(ammoEntries.map(entry => entry.consumed)).toEqual([0, 0, 0, 0, 0, 0]);
    });

    it('filters available movement modes through unit rules', () => {
        const forceUnit = createForceUnit();
        initialize(forceUnit);

        expect(forceUnit.getAvailableMotiveModes().some(option => option.mode === 'run')).toBeTrue();

        forceUnit.writeCrits([{ id: 'flight_stabilizer_hit', destroyed: 1 } as CriticalSlot]);

        expect(forceUnit.getAvailableMotiveModes().some(option => option.mode === 'run')).toBeFalse();
    });

    it('serializes and updates direct inventory ammo custom type, count, and total per bin', () => {
        const forceUnit = createForceUnit();
        initialize(forceUnit);

        const ammoEntries = forceUnit.getInventory().filter(entry => entry.equipment instanceof AmmoEquipment);
        ammoEntries[0].ammo = 'Clan Ultra AC/20 Precision Ammo';
        ammoEntries[0].totalAmmo = 4;
        ammoEntries[0].consumed = 2;
        forceUnit.setInventoryEntry(ammoEntries[0]);
        ammoEntries[5].consumed = 5;
        forceUnit.setInventoryEntry(ammoEntries[5]);

        const serializedInventory = forceUnit.serialize().state.inventory;

        expect(serializedInventory).toEqual([
            {
                id: 'Clan Ultra AC/20 Ammo@BD#1.0',
                consumed: 2,
                ammo: 'Clan Ultra AC/20 Precision Ammo',
                totalAmmo: 4,
            },
            {
                id: 'Clan Ultra AC/20 Ammo@BD#1.5',
                consumed: 5,
                totalAmmo: 5,
            },
        ]);

        const serializedUnit = {
            id: 'reloaded-unit',
            unit: forceUnit.getUnit().name,
            state: {
                crew: [],
                crits: [],
                heat: { current: 0, previous: 0 },
                locations: {},
                modified: false,
                destroyed: false,
                shutdown: false,
                inventory: serializedInventory,
            },
        } as CBTSerializedUnit;
        const reloadForce = new TestCBTForce('Reload Force', dataService, unitInitializer, injector);
        const reloadedUnit = CBTForceUnit.deserialize(serializedUnit, reloadForce, dataService, unitInitializer, injector);
        initialize(reloadedUnit);

        const reloadedAmmoEntries = reloadedUnit.getInventory().filter(entry => entry.equipment instanceof AmmoEquipment);
        expect(reloadedAmmoEntries[0].ammo).toBe('Clan Ultra AC/20 Precision Ammo');
        expect(reloadedAmmoEntries[0].totalAmmo).toBe(4);
        expect(reloadedAmmoEntries[0].consumed).toBe(2);
        expect(reloadedAmmoEntries[5].ammo).toBeUndefined();
        expect(reloadedAmmoEntries[5].totalAmmo).toBe(5);
        expect(reloadedAmmoEntries[5].consumed).toBe(5);
    });

    it('repairAll restores direct inventory ammo bins to original ammo and split quantities', () => {
        const forceUnit = createForceUnit();
        initialize(forceUnit);
        const ammoEntries = forceUnit.getInventory().filter(entry => entry.equipment instanceof AmmoEquipment);
        ammoEntries[0].ammo = 'Clan Ultra AC/20 Precision Ammo';
        ammoEntries[0].totalAmmo = 4;
        ammoEntries[0].consumed = 4;
        forceUnit.setInventoryEntry(ammoEntries[0]);
        ammoEntries[5].consumed = 5;
        forceUnit.setInventoryEntry(ammoEntries[5]);

        forceUnit.repairAll();

        const repairedAmmoEntries = forceUnit.getInventory().filter(entry => entry.equipment instanceof AmmoEquipment);
        expect(repairedAmmoEntries.length).toBe(6);
        expect(repairedAmmoEntries.map(entry => entry.ammo)).toEqual([undefined, undefined, undefined, undefined, undefined, undefined]);
        expect(repairedAmmoEntries.map(entry => entry.totalAmmo)).toEqual([5, 5, 5, 5, 5, 5]);
        expect(repairedAmmoEntries.map(entry => entry.consumed)).toEqual([0, 0, 0, 0, 0, 0]);
    });

    it('keeps inventory control targets transient and upgrades existing selections to the first target', () => {
        const forceUnit = createForceUnit();
        initialize(forceUnit);
        const weaponEntry = forceUnit.getInventory().find(entry => entry.equipment instanceof WeaponEquipment)!;

        forceUnit.setInventoryControlEntryRange(weaponEntry, 'medium');
        const target = forceUnit.createInventoryControlTarget();

        expect(target?.id).toBe('A');
        expect(forceUnit.isInventoryControlEntrySelected(weaponEntry.id)).toBeTrue();
        expect(forceUnit.getInventoryControlEntryTargetId(weaponEntry.id)).toBe('A');
        expect(forceUnit.getInventoryControlEntryRange(weaponEntry.id)).toBeUndefined();

        const serialized = forceUnit.serialize();
        expect(JSON.stringify(serialized)).not.toContain('Target A');
        expect(serialized.state.inventory).toBeUndefined();
    });

    it('reuses deleted target letters and caps targets at twelve', () => {
        const forceUnit = createForceUnit();
        initialize(forceUnit);

        expect(forceUnit.createInventoryControlTarget()?.id).toBe('A');
        expect(forceUnit.createInventoryControlTarget()?.id).toBe('B');
        expect(forceUnit.createInventoryControlTarget()?.id).toBe('C');

        forceUnit.deleteInventoryControlTarget('B');
        expect(forceUnit.createInventoryControlTarget()?.id).toBe('B');
        expect(forceUnit.getInventoryControlTargets().map(target => target.id)).toEqual(['A', 'B', 'C']);

        while (forceUnit.getInventoryControlTargets().length < INVENTORY_CONTROL_TARGET_MAX_COUNT) {
            expect(forceUnit.createInventoryControlTarget()).not.toBeNull();
        }
        expect(forceUnit.createInventoryControlTarget()).toBeNull();
        expect(forceUnit.getInventoryControlTargets().length).toBe(INVENTORY_CONTROL_TARGET_MAX_COUNT);
    });

    it('deselects entries assigned to deleted targets and clears all target selections on reset', () => {
        const forceUnit = createForceUnit();
        initialize(forceUnit);
        const weaponEntry = forceUnit.getInventory().find(entry => entry.equipment instanceof WeaponEquipment)!;

        forceUnit.createInventoryControlTarget();
        forceUnit.createInventoryControlTarget();
        forceUnit.setInventoryControlEntryTarget(weaponEntry, 'B');
        expect(forceUnit.isInventoryControlEntrySelected(weaponEntry.id)).toBeTrue();
        expect(forceUnit.getInventoryControlEntryTargetId(weaponEntry.id)).toBe('B');

        forceUnit.deleteInventoryControlTarget('B');
        expect(forceUnit.getInventoryControlTargets().map(target => target.id)).toEqual(['A']);
        expect(forceUnit.isInventoryControlEntrySelected(weaponEntry.id)).toBeFalse();
        expect(forceUnit.getInventoryControlEntryTargetId(weaponEntry.id)).toBeUndefined();

        forceUnit.setInventoryControlEntryTarget(weaponEntry, 'A');
        forceUnit.resetInventoryControlTargets();
        expect(forceUnit.getInventoryControlTargets()).toEqual([]);
        expect(forceUnit.isInventoryControlEntrySelected(weaponEntry.id)).toBeFalse();
        expect(forceUnit.getInventoryControlEntryTargetId(weaponEntry.id)).toBeUndefined();
    });

    it('does not mutate hit modifier or render target TN text during runtime target selection sync', () => {
        const forceUnit = createForceUnit();
        initialize(forceUnit);
        const weaponEntry = forceUnit.getInventory().find(entry => entry.equipment instanceof WeaponEquipment)!;
        const hitModText = weaponEntry.el!.querySelector(':scope > .hitMod-text') as SVGTextElement;
        const targetTnRect = weaponEntry.el!.querySelector(':scope > .targetTn-rect') as SVGRectElement;
        const targetTnText = weaponEntry.el!.querySelector(':scope > .targetTn-text') as SVGTextElement;

        forceUnit.createInventoryControlTarget();
        forceUnit.updateInventoryControlTarget('A', { distance: 8, tnModifier: 1 });
        forceUnit.setInventoryControlEntryTarget(weaponEntry, 'A');

        expect(hitModText.textContent).toBe('+0');
        expect(targetTnRect.getAttribute('display')).toBe('none');
        expect(targetTnText.getAttribute('display')).toBe('none');
        expect(targetTnText.textContent).toBe('');

        forceUnit.setInventoryControlEntryTarget(weaponEntry, null);

        expect(hitModText.textContent).toBe('+0');
        expect(targetTnRect.getAttribute('display')).toBe('none');
        expect(targetTnText.getAttribute('display')).toBe('none');
        expect(targetTnText.textContent).toBe('');
    });

    it('renders selected range damage and pulse hit modifiers on the SVG inventory entry', () => {
        const forceUnit = createForceUnit(createVspUnit(equipment));
        initialize(forceUnit, createVspSvg());
        const weaponEntry = forceUnit.getInventory().find(entry => entry.equipment instanceof WeaponEquipment)!;
        const damageText = weaponEntry.el!.querySelector(':scope > .damage > text') as SVGTextElement;
        const hitModText = weaponEntry.el!.querySelector(':scope > .hitMod-text') as SVGTextElement;
        const svgService = TestBed.runInInjectionContext(() => new ExposedUnitSvgService(forceUnit, unitInitializer));

        forceUnit.setInventoryControlEntryRange(weaponEntry, 'short');
        svgService.refreshInventory();
        expect(damageText.textContent).toBe('9 [Variable]');
        expect(hitModText.textContent).toBe('-3');

        forceUnit.setInventoryControlEntryRange(weaponEntry, 'medium');
        svgService.refreshInventory();
        expect(damageText.textContent).toBe('7 [Variable]');
        expect(hitModText.textContent).toBe('-2');

        forceUnit.setInventoryControlEntryRange(weaponEntry, 'long');
        svgService.refreshInventory();
        expect(damageText.textContent).toBe('5 [Variable]');
        expect(hitModText.textContent).toBe('-1');

        forceUnit.setInventoryControlEntryRange(weaponEntry, null);
        svgService.refreshInventory();
        expect(damageText.textContent).toBe('9/7/5 [Variable]');
        expect(hitModText.textContent).toBe('-4');
    });

    it('renders wildcard vehicle stabilizer hit modifiers until movement mode is selected', () => {
        const forceUnit = createForceUnit();
        initialize(forceUnit);
        const weaponEntry = forceUnit.getInventory().find(entry => entry.equipment instanceof WeaponEquipment)!;
        const hitModRect = weaponEntry.el!.querySelector(':scope > .hitMod-rect') as SVGRectElement;
        const hitModText = weaponEntry.el!.querySelector(':scope > .hitMod-text') as SVGTextElement;
        const svgService = TestBed.runInInjectionContext(() => new ExposedUnitSvgVehicleService(forceUnit, unitInitializer));

        forceUnit.setCritLoc({ id: 'stabilizer_hit_front', destroyed: 10, destroying: 10 });
        svgService.refreshInventory();
        expect(hitModText.textContent).toBe('*');
        expect(hitModRect.getAttribute('display')).toBe('block');
        expect(weaponEntry.el!.classList.contains('weakenedHitMod')).toBeTrue();

        forceUnit.turnState().moveMode.set('run');
        svgService.refreshInventory();
        expect(hitModText.textContent).toBe('+2');
    });

    it('renders VTOL rotor committed and pending hit counts separately', () => {
        const forceUnit = createForceUnit(createEmptyUnit({
            ...createVehicleUnit(equipment),
            type: 'VTOL',
        }));
        const svg = createVehicleSvg();
        const rotorGroup = document.createElementNS('http://www.w3.org/2000/svg', 'g');
        rotorGroup.setAttribute('id', 'rotor_hits_group');
        rotorGroup.setAttribute('class', 'screen-only critLoc counterGroup rotorHitsControl');
        rotorGroup.setAttribute('critId', 'rotor');
        rotorGroup.setAttribute('type', 'rotor');
        const counter = document.createElementNS('http://www.w3.org/2000/svg', 'text');
        counter.setAttribute('id', 'rotor_hits_counter');
        rotorGroup.appendChild(counter);
        svg.appendChild(rotorGroup);
        initialize(forceUnit, svg);
        const svgService = TestBed.runInInjectionContext(() => new ExposedUnitSvgVehicleService(forceUnit, unitInitializer));

        forceUnit.setCritLoc({ id: 'rotor', hits: 2, pendingHits: 1, el: rotorGroup });
        svgService.refreshCritLocs();

        expect(counter.textContent).toBe('2+1');
        expect(counter.querySelector('.rotorHitsCommitted')?.textContent).toBe('2');
        expect(counter.querySelector('.rotorHitsPending.positive')?.textContent).toBe('+1');
        expect(rotorGroup.classList.contains('rotorHitsDamaged')).toBeTrue();
        expect(rotorGroup.classList.contains('rotorHitsPendingPositive')).toBeTrue();

        forceUnit.setCritLoc({ id: 'rotor', hits: 2, pendingHits: -1, el: rotorGroup });
        svgService.refreshCritLocs();

        expect(counter.textContent).toBe('2-1');
        expect(counter.querySelector('.rotorHitsPending.negative')?.textContent).toBe('-1');
        expect(rotorGroup.classList.contains('rotorHitsPendingPositive')).toBeFalse();
        expect(rotorGroup.classList.contains('rotorHitsPendingNegative')).toBeTrue();
    });

    it('renders repeatable motive hit pips for committed and pending hits', () => {
        const forceUnit = createForceUnit();
        const svg = createVehicleSvg();
        const group = document.createElementNS('http://www.w3.org/2000/svg', 'g');
        const motiveHit = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
        motiveHit.setAttribute('id', 'motive_system_hit_2');
        motiveHit.classList.add('critLoc');
        const pipsGroup = document.createElementNS('http://www.w3.org/2000/svg', 'g');
        pipsGroup.setAttribute('id', 'motive_system_hit_2_pips');
        for (let index = 0; index < 9; index++) {
            const pip = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
            pip.classList.add('motiveHitPip', 'hidden');
            pipsGroup.appendChild(pip);
        }
        group.append(motiveHit, pipsGroup);
        svg.appendChild(group);
        initialize(forceUnit, svg);
        const svgService = TestBed.runInInjectionContext(() => new ExposedUnitSvgVehicleService(forceUnit, unitInitializer));

        svgService.refreshCritLocs([{ id: 'motive_system_hit_2', hits: 3, pendingHits: 2, hitTimestamps: [10, 20, 30], el: motiveHit }]);

        const pips = Array.from(pipsGroup.querySelectorAll<SVGCircleElement>('.motiveHitPip'));
        expect(pips.filter(pip => pip.classList.contains('damaged')).length).toBe(3);
        expect(pips.filter(pip => pip.classList.contains('willChange')).length).toBe(2);
        expect(pips.filter(pip => pip.classList.contains('hidden')).length).toBe(4);
        expect(motiveHit.classList.contains('damaged')).toBeTrue();
        expect(motiveHit.classList.contains('willChange')).toBeFalse();

        svgService.refreshCritLocs([{ id: 'motive_system_hit_2', hits: 3, pendingHits: -2, hitTimestamps: [10, 20, 30], el: motiveHit }]);

        expect(pips.filter(pip => pip.classList.contains('damaged')).length).toBe(3);
        expect(pips.filter(pip => pip.classList.contains('pendingRemoval')).length).toBe(2);
        expect(pips.filter(pip => pip.classList.contains('hidden')).length).toBe(6);
        expect(motiveHit.classList.contains('damaged')).toBeTrue();
        expect(motiveHit.classList.contains('willChange')).toBeFalse();

        svgService.refreshCritLocs([{ id: 'motive_system_hit_2', hits: 0, pendingHits: 1, el: motiveHit }]);

        expect(motiveHit.classList.contains('damaged')).toBeFalse();
        expect(motiveHit.classList.contains('willChange')).toBeTrue();

        svgService.refreshCritLocs([{ id: 'motive_system_hit_2', hits: 1, pendingHits: -1, hitTimestamps: [10], el: motiveHit }]);

        expect(motiveHit.classList.contains('damaged')).toBeTrue();
        expect(motiveHit.classList.contains('willChange')).toBeTrue();
    });

    it('renders a no-aim warning on SVG target overlays when aimed shots are blocked', () => {
        const forceUnit = createForceUnit(createVspUnit(equipment));
        initialize(forceUnit, createVspSvg());
        const weaponEntry = forceUnit.getInventory().find(entry => entry.equipment instanceof WeaponEquipment)!;
        const targetTnText = weaponEntry.el!.querySelector(':scope > .targetTn-text') as SVGTextElement;
        const svgService = TestBed.runInInjectionContext(() => new ExposedUnitSvgService(forceUnit, unitInitializer));

        forceUnit.createInventoryControlTarget();
        forceUnit.updateInventoryControlTarget('A', { distance: 1, tnCalculator: { stance: 'immobile' } });
        forceUnit.setInventoryControlEntryTarget(weaponEntry, 'A');
        svgService.refreshInventory();

        expect(targetTnText.textContent).toBe('1');

        forceUnit.updateInventoryControlTarget('A', { tnCalculator: { stance: 'normal' } });
        svgService.refreshInventory();
    });

    it('keeps target selection state independent of SVG presentation rendering', () => {
        const forceUnit = createForceUnit();
        initialize(forceUnit);
        const weaponEntry = forceUnit.getInventory().find(entry => entry.equipment instanceof WeaponEquipment)!;
        const targetTnText = weaponEntry.el!.querySelector(':scope > .targetTn-text') as SVGTextElement;

        forceUnit.createInventoryControlTarget();
        forceUnit.updateInventoryControlTarget('A', { distance: 13 });
        forceUnit.setInventoryControlEntryTarget(weaponEntry, 'A');

        expect(forceUnit.getInventoryControlEntryTargetId(weaponEntry.id)).toBe('A');
        expect(targetTnText.textContent).toBe('');

        forceUnit.setInventoryControlEntryTarget(weaponEntry, null);

        expect(forceUnit.getInventoryControlEntryTargetId(weaponEntry.id)).toBeUndefined();
        expect(targetTnText.textContent).toBe('');
    });

    it('preserves valid target assignments across updates and prunes stale entry assignments', () => {
        const forceUnit = createForceUnit();
        initialize(forceUnit);
        const weaponEntry = forceUnit.getInventory().find(entry => entry.equipment instanceof WeaponEquipment)!;
        forceUnit.createInventoryControlTarget();
        forceUnit.setInventoryControlEntryTarget(weaponEntry, 'A');
        forceUnit.setInventoryControlEntryAmmoOption(weaponEntry.id, 'ammo-option');

        forceUnit.update({
            id: forceUnit.id,
            unit: forceUnit.getUnit().name,
            state: {
                crew: forceUnit.getCrewMembers().map(crew => crew.serialize()),
                crits: [],
                heat: { current: 0, previous: 0 },
                locations: {},
                modified: false,
                destroyed: false,
                shutdown: false,
            },
        } as CBTSerializedUnit);

        expect(forceUnit.getInventoryControlEntryTargetId(weaponEntry.id)).toBe('A');
        expect(forceUnit.getInventoryControlSnapshot().entryStates.get(weaponEntry.id)?.ammoOption).toBe('ammo-option');

        forceUnit.setInventory([]);
        forceUnit.update({
            id: forceUnit.id,
            unit: forceUnit.getUnit().name,
            state: {
                crew: forceUnit.getCrewMembers().map(crew => crew.serialize()),
                crits: [],
                heat: { current: 0, previous: 0 },
                locations: {},
                modified: false,
                destroyed: false,
                shutdown: false,
            },
        } as CBTSerializedUnit);

        expect(forceUnit.getInventoryControlEntryTargetId(weaponEntry.id)).toBeUndefined();
        expect(forceUnit.getInventoryControlSnapshot().entryStates.has(weaponEntry.id)).toBeFalse();
        expect(forceUnit.isInventoryControlEntrySelected(weaponEntry.id)).toBeFalse();
    });
});
