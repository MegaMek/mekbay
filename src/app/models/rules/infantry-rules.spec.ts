import type { CBTForceUnit } from '../cbt-force-unit.model';
import { AmmoEquipment, WeaponEquipment } from '../equipment.model';
import { MountedAmmo, MountedEquipment } from '../mounted-equipment.model';
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

    it('does not mutate derived intrinsic ammo while evaluating Battle Armor destruction', () => {
        const weaponEntry = new MountedEquipment({
            owner: null as unknown as CBTForceUnit,
            id: 'one-shot',
            name: 'One-shot Weapon',
            equipment: weapon('one-shot'),
        });
        const intrinsicAmmo = new MountedAmmo({
            owner: null as unknown as CBTForceUnit,
            id: 'one-shot:intrinsic-one-shot-ammo',
            name: 'Ammo',
            equipment: new AmmoEquipment({ id: 'Ammo', name: 'Ammo', type: 'ammo', ammo: { type: 'AC', rackSize: 2 } }),
            parent: weaponEntry,
            intrinsicOneShotAmmo: true,
        });
        const unit = {
            getUnit: () => ({ type: 'Infantry', subtype: 'Battle Armor', squadSize: 1 }),
            getInventory: () => [weaponEntry, intrinsicAmmo],
            isArmorLocCommittedDestroyed: () => true,
            isArmorLocDestroyed: () => true,
            getCritSlots: () => [],
            destroyed: false,
            setDestroyed: jasmine.createSpy('setDestroyed'),
        } as unknown as CBTForceUnit;
        weaponEntry.owner = unit;
        intrinsicAmmo.owner = unit;

        new InfantryRules(unit).evaluateInventoryDestruction();

        expect(weaponEntry.committedDestroyed()).toBeTrue();
        expect(intrinsicAmmo.committedDestroyed()).toBeFalse();
    });
});