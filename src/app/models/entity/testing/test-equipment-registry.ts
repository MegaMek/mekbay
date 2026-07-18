import { EquipmentRegistry } from '../../equipment-lookup';
import { ArmorEquipment, EquipmentMap } from '../../equipment.model';

export const TEST_STANDARD_ARMOR = new ArmorEquipment({
  id: 'Standard Armor',
  name: 'Standard',
  type: 'armor',
  aliases: ['IS Standard Armor', 'Clan Standard Armor'],
  armor: { type: 'STANDARD', weightPerPoint: 0.05 },
  tech: {
    base: 'All',
    rating: 'D',
    level: 'Introductory',
    availability: { sl: 'C', sw: 'C', clan: 'C', da: 'B' },
    advancement: {
      is: { prototype: '~2460', production: '2470', common: '2470' },
      clan: { prototype: '~2460', production: '2470', common: '2470' },
    },
  },
});

export const TEST_BA_STANDARD_ARMOR = new ArmorEquipment({
  id: 'IS BA Standard (Basic)',
  name: 'BA Standard (Basic)',
  type: 'armor',
  armor: { type: 'BA_STANDARD', weightPerPoint: 0.05 },
  tech: {
    base: 'All',
    rating: 'E',
    level: 'Standard',
    availability: { sl: 'F', sw: 'F', clan: 'E', da: 'D' },
    advancement: {
      is: { prototype: '~2680', common: '~3054', reintroduced: '3050' },
      clan: { prototype: '~2680', production: '2868', common: '3054' },
    },
  },
});

export function createTestEquipmentRegistry(
  equipment: EquipmentMap = {},
): EquipmentRegistry {
  return new EquipmentRegistry({
    [TEST_STANDARD_ARMOR.id]: TEST_STANDARD_ARMOR,
    [TEST_BA_STANDARD_ARMOR.id]: TEST_BA_STANDARD_ARMOR,
    ...equipment,
  });
}

export const TEST_EQUIPMENT_REGISTRY = createTestEquipmentRegistry();
