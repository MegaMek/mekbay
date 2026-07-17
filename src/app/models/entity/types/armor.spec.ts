import { EquipmentRegistry } from '../../equipment-lookup';
import { createEquipment, type EquipmentMap } from '../../equipment.model';
import { resolveArmorEquipment } from './armor';
import { resolveMtfArmorEquipment } from '../parsers/mtf-codec';

describe('MTF armor equipment resolution', () => {
  const equipmentDb: EquipmentMap = {
    'IS Ferro-Fibrous': createEquipment({
      id: 'IS Ferro-Fibrous', name: 'Ferro-Fibrous', type: 'armor',
      aliases: ['IS Ferro-Fibrous Armor'], armor: { type: 'FERRO_FIBROUS' }, tech: { base: 'IS' },
    }),
    'Clan Ferro-Fibrous': createEquipment({
      id: 'Clan Ferro-Fibrous', name: 'Ferro-Fibrous', type: 'armor',
      aliases: ['Clan Ferro-Fibrous Armor'], armor: { type: 'FERRO_FIBROUS' }, tech: { base: 'Clan' },
    }),
    'Standard Armor': createEquipment({
      id: 'Standard Armor', name: 'Standard', type: 'armor',
      aliases: ['IS Standard Armor', 'Clan Standard Armor'], armor: { type: 'STANDARD' }, tech: { base: 'All' },
    }),
    Standard: createEquipment({
      id: 'Standard', name: 'Standard', type: 'structure',
      aliases: ['IS Standard Structure'], structure: { typeId: 0 }, tech: { base: 'All' },
    }),
  };
  const registry = new EquipmentRegistry(equipmentDb);

  it('uses the MTF armor tech base to disambiguate display names', () => {
    expect(resolveMtfArmorEquipment('Ferro-Fibrous', false, registry)?.id)
      .toBe('IS Ferro-Fibrous');
    expect(resolveMtfArmorEquipment('Ferro-Fibrous', true, registry)?.id)
      .toBe('Clan Ferro-Fibrous');
  });

  it('resolves universal armor through its tech-prefixed aliases', () => {
    expect(resolveMtfArmorEquipment('Standard', true, registry)?.id)
      .toBe('Standard Armor');
  });

  it('does not accept a non-armor name collision', () => {
    expect(resolveMtfArmorEquipment('Standard Structure', false, registry)).toBeNull();
  });

  it('returns null for an unknown armor name', () => {
    expect(resolveMtfArmorEquipment('Missing', false, registry)).toBeNull();
  });

  it('builds a fresh armor index for each registry generation', () => {
    expect(resolveArmorEquipment('REACTIVE', false, registry)).toBeNull();

    const refreshedRegistry = new EquipmentRegistry({
      ...equipmentDb,
      'Custom Reactive Armor': createEquipment({
        id: 'Custom Reactive Armor', name: 'Custom Reactive', type: 'armor',
        armor: { type: 'REACTIVE' }, tech: { base: 'IS' },
      }),
    });

    expect(resolveArmorEquipment('REACTIVE', false, refreshedRegistry)?.id)
      .toBe('Custom Reactive Armor');
    expect(resolveArmorEquipment('REACTIVE', false, registry)).toBeNull();
  });
});
