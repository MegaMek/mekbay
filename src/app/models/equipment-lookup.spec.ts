import { EquipmentRegistry } from './equipment-lookup';
import { createEquipment, type EquipmentMap } from './equipment.model';

describe('equipment lookup', () => {
    const equipmentDb: EquipmentMap = {
        ISWidget: createEquipment({
            id: 'ISWidget',
            name: 'Widget',
            type: 'misc',
            aliases: ['IS Widget', 'Widget Alias'],
            tech: { base: 'IS' },
        }),
        'Widget Alias': createEquipment({
            id: 'Widget Alias',
            name: 'Exact Widget',
            type: 'misc',
            tech: { base: 'All' },
        }),
    };
    const registry = new EquipmentRegistry(equipmentDb);

    it('indexes internal names and aliases case-insensitively', () => {
        expect(registry.find('iswidget')?.id).toBe('ISWidget');
        expect(registry.find('IS WIDGET')?.id).toBe('ISWidget');
    });

    it('trims lookup keys', () => {
        expect(registry.find('  IS Widget  ')?.id).toBe('ISWidget');
    });

    it('never lets an alias shadow an internal name', () => {
        expect(registry.find('Widget Alias')?.id).toBe('Widget Alias');
        expect(registry.find('widget alias')?.id).toBe('Widget Alias');
    });

    it('is not invalidated by later changes to the source map', () => {
        const source = { ...equipmentDb };
        const isolatedRegistry = new EquipmentRegistry(source);
        delete source['ISWidget'];

        expect(isolatedRegistry.find('ISWidget')?.id).toBe('ISWidget');
    });

    it('returns null for unknown equipment', () => {
        expect(registry.find('Missing')).toBeNull();
    });
});
