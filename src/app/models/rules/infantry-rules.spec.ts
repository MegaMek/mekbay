import type { CBTForceUnit } from '../cbt-force-unit.model';
import { WeaponEquipment } from '../equipment.model';
import { MountedEquipment } from '../mounted-equipment.model';
import { type LocationData } from '../force-serialization';
import type { UnitComponent } from '../units.model';
import { InfantryRules } from './infantry-rules';

function weapon(id: string): WeaponEquipment {
    return new WeaponEquipment({
        id,
        name: id,
        type: 'weapon',
        weapon: { ammoType: 'AC', rackSize: 2, ranges: [8, 16, 24, 32] }
    });
}

function createHarness(committedTroopDamage = 7): { rules: InfantryRules; entries: MountedEquipment[]; fieldGunComponent: UnitComponent } {
    const fieldGunComponent = { id: 'Autocannon/2', q: 3, n: 'AC/2', t: 'B', p: 1, l: 'FGUN', r: '8/16/24', m: '4', d: '2', cw: 6 } as UnitComponent;
    const unit = {
        getUnit: () => ({ type: 'Infantry', subtype: 'Mechanized Conventional Infantry', internal: 20, squads: 4, squadSize: 5, comp: [fieldGunComponent] }),
        getCritSlots: () => [],
        getCommittedInternalHits: (loc: string) => loc === 'TROOP' ? committedTroopDamage : 0,
        locations: { armor: new Map<string, LocationData>(), internal: new Map<string, LocationData>([['TROOP', { points: 20 } as unknown as LocationData]]) }
    } as unknown as CBTForceUnit;
    const fieldGun = weapon('Autocannon/2');
    const entries = [0, 1, 2].map(index => new MountedEquipment({
        owner: unit,
        id: `Autocannon/2@FGUN#0.${index}`,
        name: 'Autocannon/2',
        equipment: fieldGun,
        locations: new Set(['FGUN'])
    }));
    return { rules: new InfantryRules(unit), entries, fieldGunComponent };
}

describe('InfantryRules', () => {
    it('disables field-gun inventory entries beyond the functional crew count', () => {
        const { rules, entries, fieldGunComponent } = createHarness();

        expect(rules.getFieldGunComponent(entries[0])).toBe(fieldGunComponent);
        expect(rules.getFieldGunFunctionalCount(fieldGunComponent)).toBe(2);
        expect(entries.map(entry => rules.computeEntryState(entry).isDisabled)).toEqual([false, false, true]);
    });
});