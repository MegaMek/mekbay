import { AmmoEquipment, WeaponEquipment } from '../models/equipment.model';
import type { CriticalSlot, MountedEquipment } from '../models/force-serialization';
import type { CBTForceUnit } from '../models/cbt-force-unit.model';
import type { HandlerContext } from '../services/equipment-interaction-registry.service';
import { changeAmmoGroupRemaining, getAmmoControlEntriesForUnitWeapons, getAmmoControlGroups, getAmmoEntryRemaining, getAmmoGroupRemaining, type AmmoControlEntry } from './ammo-interaction.util';

function createAmmo(id: string, shortName: string): AmmoEquipment {
    return new AmmoEquipment({
        id,
        name: id,
        shortName,
        type: 'ammo',
        ammo: { type: 'AC_ULTRA', rackSize: 20, shots: 5, kgPerShot: 200 }
    });
}

function createContext(equipment: Record<string, AmmoEquipment>): HandlerContext {
    return {
        dataService: {
            getEquipments: () => equipment,
        },
        toastService: {
            showToast: jasmine.createSpy('showToast'),
        },
        dialogsService: {},
    } as unknown as HandlerContext;
}

function createEntry(params: {
    id: string;
    ammo: AmmoEquipment;
    consumed?: number;
    totalAmmo?: number;
    owner: Pick<CBTForceUnit, 'id' | 'setInventoryEntry' | 'getUnit'>;
}): AmmoControlEntry {
    const source = {
        owner: params.owner,
        id: params.id,
        name: params.ammo.internalName,
        equipment: params.ammo,
        locations: new Set(['BD']),
        states: new Map<string, string>(),
        totalAmmo: params.totalAmmo ?? 5,
        consumed: params.consumed ?? 0,
    } as unknown as MountedEquipment;

    return {
        id: `inventory:${params.id}`,
        owner: params.owner as CBTForceUnit,
        source,
        sourceType: 'inventory',
        locationLabel: 'BD',
        displayName: params.ammo.name,
        displayBinName: '#1 Bin [BD]',
        currentAmmo: params.ammo,
        originalAmmo: params.ammo,
        originalTotalAmmo: params.totalAmmo ?? 5,
        totalAmmo: params.totalAmmo ?? 5,
        consumed: params.consumed ?? 0,
        destroyed: false,
    };
}

function createCritEntry(params: {
    id: string;
    loc: string;
    slot: number;
    ammo: AmmoEquipment;
    destroyed?: boolean;
    owner: Pick<CBTForceUnit, 'id' | 'setCritSlot' | 'getUnit'>;
}): AmmoControlEntry {
    const source = {
        id: params.id,
        name: params.ammo.internalName,
        loc: params.loc,
        slot: params.slot,
        eq: params.ammo,
        totalAmmo: 5,
        consumed: 0,
        destroyed: params.destroyed ? Date.now() : undefined,
    } as CriticalSlot;

    return {
        id: `crit:${params.loc}:${params.slot}:${params.ammo.internalName}`,
        owner: params.owner as CBTForceUnit,
        source,
        sourceType: 'crit',
        locationLabel: params.loc,
        displayName: params.ammo.name,
        displayBinName: `#1 Bin [${params.loc}]`,
        currentAmmo: params.ammo,
        originalAmmo: params.ammo,
        originalTotalAmmo: 5,
        totalAmmo: 5,
        consumed: 0,
        destroyed: !!params.destroyed,
    };
}

describe('ammo interaction direct inventory groups', () => {
    const standardAmmo = createAmmo('Clan Ultra AC/20 Ammo', 'Ultra AC/20 Ammo');
    const precisionAmmo = createAmmo('Clan Ultra AC/20 Precision Ammo', 'Ultra AC/20 Precision Ammo');

    function createOwner(): Pick<CBTForceUnit, 'id' | 'setInventoryEntry' | 'getUnit'> {
        return {
            id: 'unit-1',
            setInventoryEntry: jasmine.createSpy('setInventoryEntry'),
            getUnit: () => ({
                techBase: 'Clan',
                comp: [
                    { id: 'CLUltraAC20', q: 1, q2: 0, n: 'Ultra AC/20', t: 'B', p: 1, l: 'FR' },
                    { id: standardAmmo.internalName, q: 2, q2: 10, n: 'Ultra AC/20 Ammo', t: 'X', p: 0, l: 'BD' },
                ],
            }),
        } as unknown as Pick<CBTForceUnit, 'id' | 'setInventoryEntry' | 'getUnit'>;
    }

    it('groups direct inventory bins by current ammo type and location', () => {
        const owner = createOwner();
        const entries = [
            createEntry({ id: 'Clan Ultra AC/20 Ammo@BD#1.0', ammo: standardAmmo, owner }),
            createEntry({ id: 'Clan Ultra AC/20 Ammo@BD#1.1', ammo: standardAmmo, owner }),
            createEntry({ id: 'Clan Ultra AC/20 Ammo@BD#1.2', ammo: precisionAmmo, owner, totalAmmo: 4 }),
        ];

        const groups = getAmmoControlGroups(entries);

        expect(groups.length).toBe(2);
        expect(groups[0].displayName).toBe('Clan Ultra AC/20 Ammo');
        expect(groups[0].expandable).toBeTrue();
        expect(groups[0].entries.map(entry => entry.id)).toEqual([
            'inventory:Clan Ultra AC/20 Ammo@BD#1.0',
            'inventory:Clan Ultra AC/20 Ammo@BD#1.1',
        ]);
        expect(groups[0].entries.map(entry => entry.displayBinName)).toEqual(['#1 Bin [BD]', '#2 Bin [BD]']);
        expect(groups[0].totalAmmo).toBe(10);
        expect(groups[1].displayName).toBe('Clan Ultra AC/20 Precision Ammo');
        expect(groups[1].expandable).toBeTrue();
        expect(groups[1].totalAmmo).toBe(4);
    });

    it('numbers crit ammo bins in visible order with their locations', () => {
        const owner = {
            id: 'unit-1',
            setCritSlot: jasmine.createSpy('setCritSlot'),
            getUnit: () => ({ techBase: 'Clan' }),
            svg: () => null,
        } as unknown as Pick<CBTForceUnit, 'id' | 'setCritSlot' | 'getUnit'>;
        const entries = [
            createCritEntry({ id: 'ammo-lt-5', loc: 'LT', slot: 5, ammo: standardAmmo, owner }),
            createCritEntry({ id: 'ammo-lt-1', loc: 'LT', slot: 1, ammo: standardAmmo, owner }),
            createCritEntry({ id: 'ammo-rt-0', loc: 'RT', slot: 0, ammo: standardAmmo, owner }),
        ];

        const groups = getAmmoControlGroups(entries);

        expect(groups.length).toBe(1);
        expect(groups[0].displayName).toBe('Clan Ultra AC/20 Ammo');
        expect(groups[0].expandable).toBeTrue();
        expect(groups[0].entries.map(entry => (entry.source as CriticalSlot).slot)).toEqual([0, 1, 5]);
        expect(groups[0].entries.map(entry => entry.displayBinName)).toEqual(['#1 Bin [RT]', '#2 Bin [LT]', '#3 Bin [LT]']);
        expect(groups[0].totalAmmo).toBe(15);
    });

    it('matches zero-rack ammo types such as Gauss by ammo type', () => {
        const gaussWeapon = new WeaponEquipment({
            id: 'CLGaussRifle',
            name: 'Gauss Rifle',
            type: 'weapon',
            weapon: { ammoType: 'GAUSS', rackSize: 0 }
        });
        const gaussAmmo = new AmmoEquipment({
            id: 'Clan Gauss Ammo',
            name: 'Gauss Rifle Ammo [Clan]',
            type: 'ammo',
            ammo: { type: 'GAUSS', rackSize: 0, shots: 8 }
        });
        const owner = {
            getInventory: () => ([
                { id: 'CLGaussRifle@RA#0', name: gaussWeapon.internalName, equipment: gaussWeapon, states: new Map() },
            ]),
            getCritSlots: () => ([
                { id: 'Clan Gauss Ammo@RA#1', name: gaussAmmo.internalName, loc: 'RA', slot: 1, eq: gaussAmmo, totalAmmo: 8, consumed: 0 },
            ]),
            svg: () => null,
        } as unknown as CBTForceUnit;

        const entries = getAmmoControlEntriesForUnitWeapons(owner, {
            [gaussWeapon.internalName]: gaussWeapon,
            [gaussAmmo.internalName]: gaussAmmo,
        });

        expect(entries.length).toBe(1);
        expect(entries[0].displayName).toBe('Gauss Rifle Ammo [Clan]');
        expect(entries[0].locationLabel).toBe('RA');
    });

    it('drains grouped bins from the last bin and refills the most recently drained bin', () => {
        const owner = createOwner();
        const context = createContext({ [standardAmmo.internalName]: standardAmmo });
        const entries = [
            createEntry({ id: 'Clan Ultra AC/20 Ammo@BD#1.0', ammo: standardAmmo, owner }),
            createEntry({ id: 'Clan Ultra AC/20 Ammo@BD#1.1', ammo: standardAmmo, owner }),
        ];
        const group = getAmmoControlGroups(entries)[0];

        for (let i = 0; i < 5; i++) {
            expect(changeAmmoGroupRemaining(group, -1, context)).toBeTrue();
        }

        expect(entries[0].consumed).toBe(0);
        expect(entries[1].consumed).toBe(5);
        expect(getAmmoGroupRemaining(group)).toBe(5);

        expect(changeAmmoGroupRemaining(group, -1, context)).toBeTrue();
        expect(entries[0].consumed).toBe(1);
        expect(entries[1].consumed).toBe(5);
        expect(getAmmoGroupRemaining(group)).toBe(4);

        expect(changeAmmoGroupRemaining(group, 1, context)).toBeTrue();
        expect(entries[0].consumed).toBe(0);
        expect(entries[1].consumed).toBe(5);
        expect(getAmmoGroupRemaining(group)).toBe(5);
    });

    it('skips destroyed crit bins when changing grouped ammo quantity', () => {
        const owner = {
            id: 'unit-1',
            setCritSlot: jasmine.createSpy('setCritSlot'),
            getUnit: () => ({ techBase: 'Clan' }),
            svg: () => null,
        } as unknown as Pick<CBTForceUnit, 'id' | 'setCritSlot' | 'getUnit'>;
        const context = createContext({ [standardAmmo.internalName]: standardAmmo });
        const entries = [
            createCritEntry({ id: 'ammo-lt-0', loc: 'LT', slot: 0, ammo: standardAmmo, destroyed: true, owner }),
            createCritEntry({ id: 'ammo-lt-1', loc: 'LT', slot: 1, ammo: standardAmmo, owner }),
        ];
        const group = getAmmoControlGroups(entries)[0];

        expect(group.destroyed).toBeFalse();
        expect(getAmmoEntryRemaining(entries[0])).toBe(0);
        expect(getAmmoGroupRemaining(group)).toBe(5);
        expect(changeAmmoGroupRemaining(group, -1, context)).toBeTrue();

        expect(entries[0].consumed).toBe(0);
        expect(entries[1].consumed).toBe(1);
        expect(getAmmoGroupRemaining(group)).toBe(4);
        expect(owner.setCritSlot).toHaveBeenCalledOnceWith(entries[1].source as CriticalSlot);
    });

    it('marks a group destroyed only when all bins are destroyed', () => {
        const owner = {
            id: 'unit-1',
            setCritSlot: jasmine.createSpy('setCritSlot'),
            getUnit: () => ({ techBase: 'Clan' }),
            svg: () => null,
        } as unknown as Pick<CBTForceUnit, 'id' | 'setCritSlot' | 'getUnit'>;
        const entries = [
            createCritEntry({ id: 'ammo-lt-0', loc: 'LT', slot: 0, ammo: standardAmmo, destroyed: true, owner }),
            createCritEntry({ id: 'ammo-lt-1', loc: 'LT', slot: 1, ammo: standardAmmo, destroyed: true, owner }),
        ];

        const group = getAmmoControlGroups(entries)[0];

        expect(group.destroyed).toBeTrue();
        expect(group.expandable).toBeTrue();
        expect(getAmmoGroupRemaining(group)).toBe(0);
    });
});
