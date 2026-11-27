import type { EntityMountedEquipment } from '../../models/entity/types/equipment';
import { describeConstructionChange, type ConstructionHistorySnapshot } from './construction-history-log';

const mount = (name: string, location: string, split?: string) =>
  ({
    displayName: () => name,
    location,
    placements: split ? [{ location, slotIndex: 0 }, { location: split, slotIndex: 0 }] : undefined,
  }) as EntityMountedEquipment;
const snapshot = (source: string, equipment: EntityMountedEquipment[] = []): ConstructionHistorySnapshot => ({
  source,
  equipment,
  artwork: null,
});
const label = (id: string) => ({ LA: 'Left Arm', RA: 'Right Arm' })[id] ?? id;

describe('describeConstructionChange', () => {
  it('names equipment as the loadout shows it and leaves its file rows out', () => {
    const before = snapshot('mass:50\n\nLeft Arm:\nShoulder\nISAC20\nISAC20\n\nRight Arm:\nShoulder\n-Empty-\n', [
      mount('AC/20', 'LA'),
      mount('Heat Sink', 'LA'),
      mount('Heat Sink', 'LA'),
    ]);
    const after = snapshot('mass:55\n\nLeft Arm:\nShoulder\n-Empty-\n\nRight Arm:\nShoulder\nISAC20\nISAC20\n', [
      mount('AC/20', 'RA', 'LA'),
      mount('Medium Laser', 'Unallocated'),
    ]);
    expect(describeConstructionChange(before, after, label)).toEqual([
      'Moved AC/20: Left Arm → Right Arm/Left Arm',
      'Removed Heat Sink (Left Arm) ×2',
      'Added Medium Laser (Unallocated)',
      'mass: 50 → 55',
    ]);
  });

  it('reads system slots and BLK blocks when no equipment changed', () => {
    const mtf = (slots: string) => `Weapons:0\n\nLeft Arm:\nShoulder\n${slots}\n`;
    expect(
      describeConstructionChange(snapshot(mtf('Hand Actuator')), snapshot(mtf('-Empty-')), label),
    ).toEqual(['Left Arm: − Hand Actuator']);
    const blk = (armor: string) => `<tonnage>\n25\n</tonnage>\n\n<armor>\n${armor}\n</armor>\n`;
    expect(describeConstructionChange(snapshot(blk('20\n16\n16')), snapshot(blk('20\n15\n16')), label)).toEqual([
      'armor: 16 → 15',
    ]);
  });
});
