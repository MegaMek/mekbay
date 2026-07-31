import { createEquipment, WeaponEquipment } from '../models/equipment.model';
import { clusterTableForUnit, clusterTableRows, hitLocationRows, referenceTableNotes } from './record-sheet-reference-table';

describe('record-sheet-reference-table', () => {
  it('contains the exact biped, quad, and tripod boundary rows', () => {
    expect(hitLocationRows('biped')[0]).toEqual({ roll: '2*', leftSide: 'LT(C)', frontRear: 'CT(C)', rightSide: 'RT(C)' });
    expect(hitLocationRows('quad')[10]).toEqual({ roll: '12', leftSide: 'HD', frontRear: 'HD', rightSide: 'HD' });
    expect(hitLocationRows('tripod')[1].leftSide).toBe('Leg (+1)†');
  });

  it('builds cluster rows without columns when none were discovered', () => {
    expect(clusterTableRows([])).toHaveSize(11);
    expect(clusterTableRows([])[0]).toEqual(['2']);
  });

  it('renders every rapid-fire column', () => {
    expect(clusterTableRows([2, 3, 4, 5, 6])[0]).toEqual(['2', '1', '1', '1', '1', '2']);
  });

  it('derives notes from equipment flags and adds tripod notes once', () => {
    const equipment = [
      createEquipment({ id: 'atm', name: 'ATM', type: 'weapon', flags: ['F_ATM'] }),
      createEquipment({ id: 'apollo', name: 'Apollo', type: 'misc', flags: ['F_APOLLO'] }),
      createEquipment({ id: 'hag', name: 'HAG', type: 'weapon', flags: ['F_HAG'] }),
    ];

    expect(referenceTableNotes('tripod', equipment)).toEqual([
      { id: 'tactical', text: jasmine.any(String) },
      { id: 'artemisIV', text: jasmine.any(String) },
      { id: 'apollo', text: jasmine.any(String) },
      { id: 'hag', text: jasmine.any(String) },
      { id: 'tripodLeg', text: jasmine.any(String) },
    ]);
  });

  it('does not require a Mek location table for equipment notes', () => {
    const hag = createEquipment({ id: 'hag', name: 'HAG', type: 'weapon', flags: ['F_HAG'] });
    expect(referenceTableNotes(undefined, [hag]).map(note => note.id)).toEqual(['tactical', 'hag']);
  });

  it('derives rapid-fire columns from the native weapon records', () => {
    const ultra = new WeaponEquipment({
      id: 'ultra', name: 'Ultra AC', type: 'weapon',
      weapon: { ammoType: 'AC_ULTRA', rackSize: 2 },
    });
    const rotary = new WeaponEquipment({
      id: 'rotary', name: 'Rotary AC', type: 'weapon',
      weapon: { ammoType: 'AC_ROTARY', rackSize: 6 },
    });

    const table = clusterTableForUnit({
      type: 'Mek',
      subtype: 'BattleMek',
      comp: [
        { id: 'ultra', q: 1, n: 'Ultra AC', t: 'B', p: 0, l: 'RA', eq: ultra },
        { id: 'rotary', q: 1, n: 'Rotary AC', t: 'B', p: 0, l: 'LA', eq: rotary },
      ],
    });

    expect(table.clusterSizes).toEqual([2, 3, 4, 5, 6]);
    expect(table.hitLocationTable).toBe('biped');
  });

  it('includes equipment nested in bays and ignores unresolved components', () => {
    const lrm = new WeaponEquipment({
      id: 'lrm', name: 'LRM 5', type: 'weapon',
      weapon: { ammoType: 'LRM', rackSize: 5 },
    });

    const table = clusterTableForUnit({
      type: 'Tank',
      subtype: 'Combat Vehicle',
      comp: [{
        id: 'bay', q: 1, n: 'Missile Bay', t: 'C', p: 0, l: 'BD',
        bay: [{ id: 'lrm', q: 1, n: 'LRM 5', t: 'M', p: 0, l: 'BD', eq: lrm }],
      }],
    });

    expect(table.clusterSizes).toEqual([5]);
    expect(table.equipment).toEqual([lrm]);
  });
});
