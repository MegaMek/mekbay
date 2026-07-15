import {
    EquipmentMap,
    MiscEquipment,
    StructureEquipment,
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
});