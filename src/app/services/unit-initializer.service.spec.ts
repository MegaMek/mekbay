import { Injector } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { CBTForce } from '../models/cbt-force.model';
import { CBTForceUnit } from '../models/cbt-force-unit.model';
import { AmmoEquipment, ArmorEquipment, MiscEquipment, StructureEquipment, WeaponEquipment, type EquipmentMap } from '../models/equipment.model';
import { MountedEquipment, MountedWeapon } from '../models/mounted-equipment.model';
import { isIntrinsicOneShotAmmoMount } from '../utils/ammo-interaction.util';
import { createEmptyUnit } from '../testing/unit-test-helpers';
import { DataService } from './data.service';
import { CRITICAL_ONLY_INVENTORY_EXCLUDED_EQUIPMENT, UnitInitializerService } from './unit-initializer.service';

class TestCBTForce extends CBTForce {
    override emitChanged(): void {
    }
}

function createSvg(markup: string): SVGSVGElement {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.innerHTML = markup;
    return svg;
}

function createEquipment(): EquipmentMap {
    const masc = new MiscEquipment({ id: 'CLMASC', name: 'MASC', type: 'misc', flags: ['F_MASC'] });
    const supercharger = new MiscEquipment({ id: 'Supercharger', name: 'Supercharger', type: 'misc', flags: ['F_MASC', 'S_SUPERCHARGER'] });
    const caseII = new MiscEquipment({ id: 'CLCASEII', name: 'CASE II', type: 'misc', flags: ['F_CASE_II'] });
    const endoSteel = new StructureEquipment({ id: 'ISEndoSteel', name: 'Endo Steel', type: 'structure', flags: ['F_ENDO_STEEL'], structure: { typeId: 2 } });
    const ferroFibrous = new ArmorEquipment({ id: 'ISFerroFibrous', name: 'Ferro-Fibrous', type: 'armor', armor: { type: 'Ferro-Fibrous' } });
    const hardenedArmor = new ArmorEquipment({ id: 'HardenedArmor', name: 'Hardened Armor', type: 'armor', armor: { type: 'Hardened' } });
    const doubleHeatSink = new MiscEquipment({ id: 'ISDoubleHeatSink', name: 'Double Heat Sink', type: 'misc', flags: ['F_DOUBLE_HEAT_SINK'] });
    const improvedJumpJet = new MiscEquipment({ id: 'ISImprovedJumpJet', name: 'Improved Jump Jet', type: 'misc', flags: ['F_JUMP_JET'] });
    const mediumLaser = new WeaponEquipment({ id: 'CLMediumLaser', name: 'Medium Laser', type: 'weapon', weapon: { ammoType: 'NA' } });
    const ultraAc20Ammo = new AmmoEquipment({ id: 'CLUltraAC20Ammo', name: 'Ultra AC/20 Ammo', type: 'ammo', ammo: { type: 'AC_ULTRA', rackSize: 20, shots: 5 } });
    return {
        [masc.internalName]: masc,
        [supercharger.internalName]: supercharger,
        [caseII.internalName]: caseII,
        [endoSteel.internalName]: endoSteel,
        [ferroFibrous.internalName]: ferroFibrous,
        [hardenedArmor.internalName]: hardenedArmor,
        [doubleHeatSink.internalName]: doubleHeatSink,
        [improvedJumpJet.internalName]: improvedJumpJet,
        [mediumLaser.internalName]: mediumLaser,
        [ultraAc20Ammo.internalName]: ultraAc20Ammo,
    };
}

describe('UnitInitializerService', () => {
    let dataService: jasmine.SpyObj<DataService>;
    let injector: Injector;
    let service: UnitInitializerService;

    beforeEach(() => {
        dataService = jasmine.createSpyObj<DataService>('DataService', ['getEquipments']);
        dataService.getEquipments.and.returnValue(createEquipment());
        TestBed.configureTestingModule({
            providers: [
                UnitInitializerService,
                { provide: DataService, useValue: dataService },
            ],
        });
        injector = TestBed.inject(Injector);
        service = TestBed.inject(UnitInitializerService);
        CRITICAL_ONLY_INVENTORY_EXCLUDED_EQUIPMENT.clear();
    });

    function createForceUnit(unit = createEmptyUnit({
            name: 'BMTest_MASC-1',
            type: 'Mek',
            subtype: 'BattleMek',
        })): CBTForceUnit {
        const force = new TestCBTForce('Test Force', dataService, service, injector);
        return new CBTForceUnit(unit, force, dataService, service, injector);
    }

    it('synthesizes mounted equipment for critical-only equipment', () => {
        const forceUnit = createForceUnit();
        const svg = createSvg(`
            <rect class="critSlot" loc="LT" uid="CLMASC@LT#7" slot="7" name="CLMASC"></rect>
            <rect class="critSlot" loc="LT" uid="CLMASC@LT#7" slot="8" name="CLMASC"></rect>
            <rect class="critSlot" loc="RT" uid="Supercharger@RT#10" slot="10" name="Supercharger"></rect>
            <rect class="critSlot" loc="LT" uid="CLCASEII@LT#11" slot="11" name="CLCASEII"></rect>
            <rect class="critSlot" loc="CT" uid="Engine@CT#0" slot="0" name="Engine"></rect>
        `);

        service.initializeUnitIfNeeded(forceUnit, svg);

        const inventory = forceUnit.getInventory();
        const masc = inventory.find(entry => entry.id === 'CLMASC@LT#7');
        const supercharger = inventory.find(entry => entry.id === 'Supercharger@RT#10');

        expect(inventory.map(entry => entry.id)).toEqual(['CLMASC@LT#7', 'Supercharger@RT#10']);
        expect(masc?.equipment?.flags.has('F_MASC')).toBeTrue();
        expect(masc?.critSlots?.length).toBe(2);
        expect(Array.from(masc?.locations ?? [])).toEqual(['LT']);
        expect(supercharger?.equipment?.flags.has('F_MASC')).toBeTrue();
        expect(supercharger?.critSlots?.length).toBe(1);
    });

    it('skips critical-only equipment listed in the exclusion set', () => {
        CRITICAL_ONLY_INVENTORY_EXCLUDED_EQUIPMENT.add('CLCASEII');
        const forceUnit = createForceUnit();
        const svg = createSvg(`
            <rect class="critSlot" loc="LT" uid="CLMASC@LT#7" slot="7" name="CLMASC"></rect>
            <rect class="critSlot" loc="LT" uid="CLCASEII@LT#11" slot="11" name="CLCASEII"></rect>
        `);

        service.initializeUnitIfNeeded(forceUnit, svg);

        expect(forceUnit.getInventory().map(entry => entry.id)).toEqual(['CLMASC@LT#7']);
    });

    it('does not synthesize construction, heat-sink, or jump-jet critical-slot fillers', () => {
        const forceUnit = createForceUnit();
        const svg = createSvg(`
            <rect class="critSlot" loc="LA" uid="ISEndoSteel@LA#0" slot="0" name="ISEndoSteel"></rect>
            <rect class="critSlot" loc="LT" uid="ISFerroFibrous@LT#1" slot="1" name="ISFerroFibrous"></rect>
            <rect class="critSlot" loc="CT" uid="HardenedArmor@CT#2" slot="2" name="HardenedArmor"></rect>
            <rect class="critSlot" loc="RT" uid="ISDoubleHeatSink@RT#3" slot="3" name="ISDoubleHeatSink"></rect>
            <rect class="critSlot" loc="LL" uid="ISImprovedJumpJet@LL#4" slot="4" name="ISImprovedJumpJet"></rect>
            <rect class="critSlot" loc="LT" uid="CLMASC@LT#7" slot="7" name="CLMASC"></rect>
        `);

        service.initializeUnitIfNeeded(forceUnit, svg);

        expect(forceUnit.getInventory().map(entry => entry.id)).toEqual(['CLMASC@LT#7']);
        expect(forceUnit.getCritSlots().length).toBe(6);
    });

    it('preserves existing critical-only entry state when rebuilding synthesized inventory', () => {
        const forceUnit = createForceUnit();
        forceUnit.setInventory([new MountedEquipment({
            owner: forceUnit,
            id: 'CLMASC@LT#7',
            name: 'CLMASC',
            states: new Map([['masc', '3']]),
        })], true);
        const svg = createSvg('<rect class="critSlot" loc="LT" uid="CLMASC@LT#7" slot="7" name="CLMASC"></rect>');

        service.initializeUnitIfNeeded(forceUnit, svg);

        expect(forceUnit.getInventory()[0].states.get('masc')).toBe('3');
    });

    it('does not duplicate critical-only equipment already represented by an inventory row', () => {
        const forceUnit = createForceUnit();
        const svg = createSvg(`
            <rect class="critSlot" loc="LT" uid="CLMASC@LT#7" slot="7" name="CLMASC"></rect>
            <g class="inventoryEntry" id="CLMASC@LT#7"><g class="location"><text>LT</text></g></g>
        `);

        service.initializeUnitIfNeeded(forceUnit, svg);

        expect(forceUnit.getInventory().filter(entry => entry.id === 'CLMASC@LT#7').length).toBe(1);
    });

    it('does not mirror Mek ammo critical slots into inventory entries', () => {
        const forceUnit = createForceUnit();
        const svg = createSvg(`
            <rect class="critSlot ammoSlot" loc="LT" uid="CLUltraAC20Ammo@LT#7" slot="7" name="CLUltraAC20Ammo" totalAmmo="5"></rect>
            <g class="inventoryEntry" id="CLUltraAC20Ammo@LT#7"><g class="location"><text>LT</text></g></g>
        `);

        service.initializeUnitIfNeeded(forceUnit, svg);

        expect(forceUnit.getCritSlots().filter(entry => entry.id === 'CLUltraAC20Ammo@LT#7').length).toBe(1);
        expect(forceUnit.getInventory().some(entry => entry.id === 'CLUltraAC20Ammo@LT#7')).toBeFalse();
    });

    it('materializes compatible intrinsic one-shot ammo while initializing weapon mounts', () => {
        const equipment = createEquipment();
        const weapon = new WeaponEquipment({
            id: 'ISBALRM5OS', name: 'LRM 5 (OS)', type: 'weapon', flags: ['F_ONE_SHOT', 'F_MISSILE', 'F_LRM', 'F_BA_WEAPON'],
            weapon: { ammoType: 'LRM', rackSize: 5, damage: 'cluster' },
        });
        const standard = new AmmoEquipment({
            id: 'IS BA Ammo LRM-5', name: 'BA LRM 5 Ammo', type: 'ammo', flags: ['F_BATTLEARMOR'],
            ammo: { type: 'LRM', rackSize: 5, munitionType: ['M_STANDARD'] },
        });
        const incendiary = new AmmoEquipment({
            id: 'IS BA Ammo LRM-5 w/ Incendiary', name: 'BA LRM 5 Incendiary Ammo', type: 'ammo', flags: ['F_BATTLEARMOR'],
            ammo: { type: 'LRM', rackSize: 5, munitionType: ['M_STANDARD', 'M_INCENDIARY_LRM'] },
        });
        dataService.getEquipments.and.returnValue({
            ...equipment,
            [weapon.internalName]: weapon,
            [standard.internalName]: standard,
            [incendiary.internalName]: incendiary,
        });
        const forceUnit = createForceUnit();
        const svg = createSvg(`
            <g class="inventoryEntry" id="ISBALRM5OS@RA#0">
                <g class="location"><text>RA</text></g>
            </g>
        `);

        service.initializeUnitIfNeeded(forceUnit, svg);

        const mountedWeapon = forceUnit.getInventory()
            .find(entry => entry.id === 'ISBALRM5OS@RA#0');
        const intrinsicAmmo = forceUnit.getInventory()
            .find(isIntrinsicOneShotAmmoMount);

        expect(mountedWeapon).toBeInstanceOf(MountedWeapon);
        expect(intrinsicAmmo).toBeDefined();
        expect(intrinsicAmmo?.parent).toBe(mountedWeapon);
        expect(mountedWeapon?.linkedWith).toEqual([intrinsicAmmo!]);
        expect(intrinsicAmmo?.totalAmmo).toBe(1);
    });

    it('materializes one Battle Armor weapon mount per trooper during initialization', () => {
        const equipment = createEquipment();
        const taser = new WeaponEquipment({
            id: 'ISBATaser', name: 'BA Taser', type: 'weapon', flags: ['F_BA_WEAPON'],
            weapon: { ammoType: 'TASER', damage: 1 },
        });
        dataService.getEquipments.and.returnValue({ ...equipment, [taser.internalName]: taser });
        const forceUnit = createForceUnit(createEmptyUnit({
            name: 'BATaserSquad', type: 'Infantry', subtype: 'Battle Armor',
            comp: [
                { id: taser.internalName, n: taser.name, t: 'E', q: 1, p: 1, l: 'T1' },
                { id: taser.internalName, n: taser.name, t: 'E', q: 1, p: 2, l: 'T2' },
                { id: taser.internalName, n: taser.name, t: 'E', q: 1, p: 3, l: 'T3' },
            ],
        }));
        const svg = createSvg(`
            <g class="inventoryEntry" id="ISBATaser@Squad#0">
                <g class="location"><text>Squad</text></g>
            </g>
        `);

        service.initializeUnitIfNeeded(forceUnit, svg);

        const mounts = forceUnit.getInventory();
        expect(mounts.map(entry => entry.id)).toEqual([
            'ISBATaser@Squad#0:T1',
            'ISBATaser@Squad#0:T2',
            'ISBATaser@Squad#0:T3',
        ]);
        expect(mounts.every(entry => entry instanceof MountedWeapon)).toBeTrue();
        expect(mounts.map(entry => Array.from(entry.locations ?? []))).toEqual([['T1'], ['T2'], ['T3']]);
        expect(mounts.every(entry => entry.el === undefined)).toBeTrue();
    });

    it('materializes Battle Armor energy weapons per trooper with canonical locations', () => {
        const equipment = createEquipment();
        const laser = new WeaponEquipment({
            id: 'CLBAERMicroLaser', name: 'BA ER Micro Laser', type: 'weapon', flags: ['F_BA_WEAPON', 'F_ENERGY'],
            weapon: { ammoType: 'NA', damage: 1 },
        });
        dataService.getEquipments.and.returnValue({ ...equipment, [laser.internalName]: laser });
        const forceUnit = createForceUnit(createEmptyUnit({
            name: 'BALaserSquad', type: 'Infantry', subtype: 'Battle Armor',
            comp: [
                { id: laser.internalName, n: laser.name, t: 'E', q: 1, p: 1, l: 'Trooper 1' },
                { id: laser.internalName, n: laser.name, t: 'E', q: 1, p: 2, l: 'T2' },
            ],
        }));
        const svg = createSvg('<g class="inventoryEntry" id="CLBAERMicroLaser@Squad#0"><g class="location"><text>Squad</text></g></g>');

        service.initializeUnitIfNeeded(forceUnit, svg);

        expect(forceUnit.getInventory().map(entry => entry.id)).toEqual([
            'CLBAERMicroLaser@Squad#0:T1',
            'CLBAERMicroLaser@Squad#0:T2',
        ]);
        expect(forceUnit.getInventory().map(entry => Array.from(entry.locations ?? []))).toEqual([['T1'], ['T2']]);
    });
});
