import { Injector } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { AmmoEquipment, WeaponEquipment, type EquipmentMap } from './equipment.model';
import { CBTForce } from './cbt-force.model';
import { CBTForceUnit } from './cbt-force-unit.model';
import { INVENTORY_CONTROL_TARGET_MAX_COUNT } from './inventory-control-runtime-state.model';
import type { CBTSerializedUnit } from './force-serialization';
import { DataService } from '../services/data.service';
import { UnitInitializerService } from '../services/unit-initializer.service';
import { createEmptyUnit } from '../testing/unit-test-helpers';
import type { Unit } from './units.model';

function createEquipment(): EquipmentMap {
    const ultraAc20 = new WeaponEquipment({
        id: 'CLUltraAC20',
        name: 'Ultra AC/20',
        type: 'weapon',
        weapon: { ammoType: 'AC_ULTRA', rackSize: 20 }
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

    return {
        [ultraAc20.internalName]: ultraAc20,
        [ultraAc20Ammo.internalName]: ultraAc20Ammo,
        [ultraAc20PrecisionAmmo.internalName]: ultraAc20PrecisionAmmo,
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
            <g class="inventoryEntry" id="CLUltraAC20@FR#0" baseHitMod="0">
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

    function initialize(unit: CBTForceUnit): void {
        unitInitializer.initializeUnitIfNeeded(unit, createVehicleSvg());
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

        forceUnit.setInventoryControlSelectedRange(weaponEntry, 'medium');
        const target = forceUnit.createInventoryControlTarget();

        expect(target?.id).toBe('A');
        expect(forceUnit.isInventoryControlEntrySelected(weaponEntry.id)).toBeTrue();
        expect(forceUnit.getInventoryControlSelectedTarget(weaponEntry.id)).toBe('A');
        expect(forceUnit.getInventoryControlSelectedRange(weaponEntry.id)).toBeUndefined();

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
        forceUnit.setInventoryControlSelectedTarget(weaponEntry, 'B');
        expect(forceUnit.isInventoryControlEntrySelected(weaponEntry.id)).toBeTrue();
        expect(forceUnit.getInventoryControlSelectedTarget(weaponEntry.id)).toBe('B');

        forceUnit.deleteInventoryControlTarget('B');
        expect(forceUnit.getInventoryControlTargets().map(target => target.id)).toEqual(['A']);
        expect(forceUnit.isInventoryControlEntrySelected(weaponEntry.id)).toBeFalse();
        expect(forceUnit.getInventoryControlSelectedTarget(weaponEntry.id)).toBeUndefined();

        forceUnit.setInventoryControlSelectedTarget(weaponEntry, 'A');
        forceUnit.resetInventoryControlTargets();
        expect(forceUnit.getInventoryControlTargets()).toEqual([]);
        expect(forceUnit.isInventoryControlEntrySelected(weaponEntry.id)).toBeFalse();
        expect(forceUnit.getInventoryControlSelectedTarget(weaponEntry.id)).toBeUndefined();
    });

    it('renders selected target TN in a separate SVG overlay without mutating hit modifier', () => {
        const forceUnit = createForceUnit();
        initialize(forceUnit);
        const weaponEntry = forceUnit.getInventory().find(entry => entry.equipment instanceof WeaponEquipment)!;
        const hitModText = weaponEntry.el!.querySelector(':scope > .hitMod-text') as SVGTextElement;
        const targetTnRect = weaponEntry.el!.querySelector(':scope > .targetTn-rect') as SVGRectElement;
        const targetTnText = weaponEntry.el!.querySelector(':scope > .targetTn-text') as SVGTextElement;

        forceUnit.createInventoryControlTarget();
        forceUnit.updateInventoryControlTarget('A', { distance: 8, tnModifier: 1 });
        forceUnit.setInventoryControlSelectedTarget(weaponEntry, 'A');

        expect(hitModText.textContent).toBe('+0');
        expect(targetTnRect.getAttribute('display')).toBe('block');
        expect(targetTnText.getAttribute('display')).toBe('block');
        expect(targetTnText.textContent).toBe('7');

        forceUnit.setInventoryControlSelectedTarget(weaponEntry, null);

        expect(hitModText.textContent).toBe('+0');
        expect(targetTnRect.getAttribute('display')).toBe('none');
        expect(targetTnText.getAttribute('display')).toBe('none');
        expect(targetTnText.textContent).toBe('');
    });

    it('renders selected target TN for physical club entries without range thresholds', () => {
        const forceUnit = createForceUnit();
        initialize(forceUnit);
        const weaponEntry = forceUnit.getInventory().find(entry => entry.equipment instanceof WeaponEquipment)!;
        weaponEntry.equipment!.flags.add('F_CLUB');
        weaponEntry.el!.querySelectorAll(':scope > .range_short, :scope > .range_medium, :scope > .range_long').forEach(node => node.remove());
        const targetTnText = weaponEntry.el!.querySelector(':scope > .targetTn-text') as SVGTextElement;

        forceUnit.createInventoryControlTarget();
        forceUnit.updateInventoryControlTarget('A', { distance: 8, tnModifier: 1 });
        forceUnit.setInventoryControlSelectedTarget(weaponEntry, 'A');

        expect(targetTnText.getAttribute('display')).toBe('block');
        expect(targetTnText.textContent).toBe('6');
    });

    it('marks target-selected inventory entries out of range for red SVG highlighting', () => {
        const forceUnit = createForceUnit();
        initialize(forceUnit);
        const weaponEntry = forceUnit.getInventory().find(entry => entry.equipment instanceof WeaponEquipment)!;
        const targetTnText = weaponEntry.el!.querySelector(':scope > .targetTn-text') as SVGTextElement;

        forceUnit.createInventoryControlTarget();
        forceUnit.updateInventoryControlTarget('A', { distance: 13 });
        forceUnit.setInventoryControlSelectedTarget(weaponEntry, 'A');

        expect(weaponEntry.el!.classList.contains('selected-target-out-of-range')).toBeTrue();
        expect(targetTnText.textContent).toBe('X');

        forceUnit.setInventoryControlSelectedTarget(weaponEntry, null);

        expect(weaponEntry.el!.classList.contains('selected-target-out-of-range')).toBeFalse();
        expect(targetTnText.textContent).toBe('');
    });

    it('preserves valid target assignments across updates and prunes stale entry assignments', () => {
        const forceUnit = createForceUnit();
        initialize(forceUnit);
        const weaponEntry = forceUnit.getInventory().find(entry => entry.equipment instanceof WeaponEquipment)!;
        forceUnit.createInventoryControlTarget();
        forceUnit.setInventoryControlSelectedTarget(weaponEntry, 'A');
        forceUnit.setInventoryControlSelectedAmmoOption(weaponEntry.id, 'ammo-option');

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

        expect(forceUnit.getInventoryControlSelectedTarget(weaponEntry.id)).toBe('A');
        expect(forceUnit.getInventoryControlSelectionSnapshot().selectedAmmoOptions.get(weaponEntry.id)).toBe('ammo-option');

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

        expect(forceUnit.getInventoryControlSelectedTarget(weaponEntry.id)).toBeUndefined();
        expect(forceUnit.getInventoryControlSelectionSnapshot().selectedAmmoOptions.has(weaponEntry.id)).toBeFalse();
        expect(forceUnit.isInventoryControlEntrySelected(weaponEntry.id)).toBeFalse();
    });
});
