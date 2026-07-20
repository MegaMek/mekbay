import {
    EquipmentMap,
    MiscEquipment,
    StructureEquipment,
    WeaponEquipment,
    createEquipment,
} from './equipment.model';
import { getStructureByName, getStructureByTypeId } from './entity/components';

describe('equipment model', () => {
    it('deserializes structure records as StructureEquipment', () => {
        const equipment = createEquipment({
            id: 'IS Endo-Composite',
            name: 'Endo-Composite',
            type: 'structure',
            structure: { typeId: 6 },
            tech: { base: 'IS' },
        });

        expect(equipment).toBeInstanceOf(StructureEquipment);
        expect(equipment).toBeInstanceOf(MiscEquipment);
        expect(equipment.type).toBe('structure');
        expect((equipment as StructureEquipment).structureTypeId).toBe(6);
        expect(equipment.techBase).toBe('IS');
    });

    it('preserves exported structure type IDs without interpreting them', () => {
        const equipment = createEquipment({
            id: 'Unknown Structure',
            name: 'Unknown Structure',
            type: 'structure',
            structure: { typeId: 99 },
            tech: { base: 'All' },
        });

        expect((equipment as StructureEquipment).structureTypeId).toBe(99);
    });

    it('resolves structure equipment variants by ID or MTF name', () => {
        const equipmentDb: EquipmentMap = {
            'IS Endo Steel': createEquipment({
                id: 'IS Endo Steel', name: 'Endo Steel', type: 'structure',
                structure: { typeId: 2 }, tech: { base: 'IS' },
            }),
            'Clan Endo Steel': createEquipment({
                id: 'Clan Endo Steel', name: 'Endo Steel', type: 'structure',
                structure: { typeId: 2 }, tech: { base: 'Clan' },
            }),
            Standard: createEquipment({
                id: 'Standard', name: 'Standard', type: 'structure',
                structure: { typeId: 0 }, tech: { base: 'All' },
            }),
        };

        expect(getStructureByTypeId(2, 'IS', equipmentDb)?.id).toBe('IS Endo Steel');
        expect(getStructureByName('Endo Steel', 'Clan', equipmentDb)?.id).toBe('Clan Endo Steel');
        expect(getStructureByTypeId(0, 'Clan', equipmentDb)?.id).toBe('Standard');
    });

    it('derives intrinsic weapon categories and damage profiles', () => {
        const srm = weapon('srm-6', 'SRM 6', 'SRM', 'cluster', 6, ['F_MISSILE']);
        const ultra = weapon('uac-10', 'Ultra AC/10', 'AC_ULTRA', 10, 10, ['F_BALLISTIC']);
        const variable = weapon('variable', 'Variable Laser', 'NA', [10, 8, 5], 0, ['F_ENERGY']);

        expect(srm.getWeaponCategory()).toBe('missile');
        expect(srm.getDamageProfile()).toEqual({
            kind: 'missile-cluster', damagePerMissile: 2, maximum: 12,
        });
        expect(ultra.getWeaponCategory()).toBe('ballistic');
        expect(ultra.getDamageProfile()).toEqual({
            kind: 'fixed', damage: 10, maximum: 20, perShot: true,
        });
        expect(variable.getWeaponCategory()).toBe('energy');
        expect(variable.getDamageProfile()).toEqual({
            kind: 'range', damage: [10, 8, 5], maximum: 10,
        });
    });

    it('derives optional one-shot counts from weapon flags', () => {
        const standard = weapon('standard', 'Standard', 'NA', 5, 0, []);
        const oneShot = weapon('one-shot', 'One-Shot', 'SRM', 'cluster', 2, ['F_ONE_SHOT']);
        const doubleOneShot = weapon(
            'double-one-shot', 'Double One-Shot', 'SRM', 'cluster', 2,
            ['F_ONE_SHOT', 'F_DOUBLE_ONE_SHOT'],
        );

        expect(standard.oneShotCount).toBeUndefined();
        expect(oneShot.oneShotCount).toBe(1);
        expect(doubleOneShot.oneShotCount).toBe(2);
    });

    it('exposes intrinsic equipment classifications', () => {
        const compactHeatSinks = new MiscEquipment({
            id: '2 Compact Heat Sinks', name: '2 Compact Heat Sinks', type: 'misc',
            flags: ['F_DOUBLE_HEAT_SINK', 'F_COMPACT_HEAT_SINK'],
        });
        const armorKit = new MiscEquipment({
            id: 'armor-kit', name: 'Armor Kit', type: 'misc', flags: ['F_ARMOR_KIT'],
        });
        const internalWeapon = weapon(
            'internal', 'Internal', 'NA', 0, 0, ['INTERNAL_REPRESENTATION'],
        );

        expect(compactHeatSinks.isHeatSink).toBeTrue();
        expect(compactHeatSinks.isCompactHeatSink).toBeTrue();
        expect(compactHeatSinks.heatSinkUnitsPerMount).toBe(2);
        expect(armorKit.isArmorKit).toBeTrue();
        expect(internalWeapon.isInternalRepresentation).toBeTrue();
    });
});

function weapon(
    id: string,
    name: string,
    ammoType: 'SRM' | 'AC_ULTRA' | 'NA',
    damage: string | number | number[],
    rackSize: number,
    flags: string[],
): WeaponEquipment {
    return new WeaponEquipment({
        id, name, type: 'weapon', flags,
        weapon: { ammoType, damage, rackSize },
    });
}