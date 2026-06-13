import { AmmoEquipment } from '../models/equipment.model';
import type { CriticalSlot, MountedEquipment } from '../models/force-serialization';
import type { CBTForceUnit } from '../models/cbt-force-unit.model';
import type { HandlerContext } from '../services/equipment-interaction-registry.service';
import { changeAmmoGroupRemaining, getAmmoControlGroups, getAmmoGroupRemaining, type AmmoControlEntry } from './ammo-interaction.util';

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
    } as CriticalSlot;

    return {
        id: `crit:${params.loc}:${params.slot}:${params.ammo.internalName}`,
        owner: params.owner as CBTForceUnit,
        source,
        sourceType: 'crit',
        locationLabel: params.loc,
        displayName: params.ammo.name,
        currentAmmo: params.ammo,
        originalAmmo: params.ammo,
        originalTotalAmmo: 5,
        totalAmmo: 5,
        consumed: 0,
        destroyed: false,
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
        expect(groups[0].totalAmmo).toBe(10);
        expect(groups[1].displayName).toBe('Clan Ultra AC/20 Precision Ammo');
        expect(groups[1].expandable).toBeFalse();
        expect(groups[1].totalAmmo).toBe(4);
    });

    it('groups crit ammo by current ammo type and location', () => {
        const owner = {
            id: 'unit-1',
            setCritSlot: jasmine.createSpy('setCritSlot'),
            getUnit: () => ({ techBase: 'Clan' }),
        } as unknown as Pick<CBTForceUnit, 'id' | 'setCritSlot' | 'getUnit'>;
        const entries = [
            createCritEntry({ id: 'ammo-lt-0', loc: 'LT', slot: 0, ammo: standardAmmo, owner }),
            createCritEntry({ id: 'ammo-lt-1', loc: 'LT', slot: 1, ammo: standardAmmo, owner }),
            createCritEntry({ id: 'ammo-rt-0', loc: 'RT', slot: 0, ammo: standardAmmo, owner }),
        ];

        const groups = getAmmoControlGroups(entries);

        expect(groups.length).toBe(2);
        expect(groups[0].locationLabel).toBe('LT');
        expect(groups[0].displayName).toBe('Clan Ultra AC/20 Ammo');
        expect(groups[0].expandable).toBeTrue();
        expect(groups[0].entries.length).toBe(2);
        expect(groups[0].totalAmmo).toBe(10);
        expect(groups[1].locationLabel).toBe('RT');
        expect(groups[1].expandable).toBeFalse();
        expect(groups[1].totalAmmo).toBe(5);
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
});
