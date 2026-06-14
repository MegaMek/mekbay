import { DialogRef, DIALOG_DATA } from '@angular/cdk/dialog';
import { TestBed } from '@angular/core/testing';
import { AmmoEquipment } from '../../models/equipment.model';
import type { CBTForceUnit } from '../../models/cbt-force-unit.model';
import type { CriticalSlot } from '../../models/force-serialization';
import type { HandlerContext } from '../../services/equipment-interaction-registry.service';
import { AmmoControlDialogComponent, type AmmoControlDialogData } from './ammo-control-dialog.component';
import type { AmmoControlEntry } from '../../utils/ammo-interaction.util';

function createAmmo(id: string): AmmoEquipment {
    return new AmmoEquipment({
        id,
        name: id,
        type: 'ammo',
        ammo: { type: 'AC_ULTRA', rackSize: 20, shots: 5 }
    });
}

function createCritEntry(params: {
    loc: string;
    slot: number;
    ammo: AmmoEquipment;
    consumed?: number;
    destroyed?: boolean;
    owner: Pick<CBTForceUnit, 'id' | 'readOnly' | 'getUnit'>;
}): AmmoControlEntry {
    const source = {
        id: `${params.ammo.internalName}@${params.loc}#${params.slot}`,
        name: params.ammo.internalName,
        loc: params.loc,
        slot: params.slot,
        eq: params.ammo,
        totalAmmo: 5,
        consumed: params.consumed ?? 0,
        destroyed: params.destroyed ? Date.now() : undefined,
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
        consumed: params.consumed ?? 0,
        destroyed: !!params.destroyed,
    };
}

describe('AmmoControlDialogComponent', () => {
    it('recomputes visible groups from live entries while open', () => {
        const standardAmmo = createAmmo('Clan Ultra AC/20 Ammo');
        const precisionAmmo = createAmmo('Clan Ultra AC/20 Precision Ammo');
        const owner = {
            id: 'unit-1',
            readOnly: () => false,
            getUnit: () => ({ techBase: 'Clan' }),
        } as unknown as Pick<CBTForceUnit, 'id' | 'readOnly' | 'getUnit'>;
        let liveEntries = [
            createCritEntry({ loc: 'LT', slot: 0, ammo: standardAmmo, owner }),
            createCritEntry({ loc: 'LT', slot: 1, ammo: standardAmmo, owner }),
        ];
        const data: AmmoControlDialogData = {
            title: 'Ammo',
            entries: liveEntries,
            getEntries: () => liveEntries,
            context: {} as HandlerContext,
        };

        TestBed.configureTestingModule({
            imports: [AmmoControlDialogComponent],
            providers: [
                { provide: DIALOG_DATA, useValue: data },
                { provide: DialogRef, useValue: { close: jasmine.createSpy('close') } },
            ],
        });
        const fixture = TestBed.createComponent(AmmoControlDialogComponent);
        const component = fixture.componentInstance;

        let groups = component.groups();
        expect(groups.length).toBe(1);
        expect(groups[0].entries.length).toBe(2);
        expect(component.groupRemaining(groups[0])).toBe(10);

        liveEntries = [
            createCritEntry({ loc: 'LT', slot: 0, ammo: precisionAmmo, owner }),
            createCritEntry({ loc: 'LT', slot: 1, ammo: standardAmmo, destroyed: true, owner }),
        ];

        groups = component.groups();
        expect(groups.length).toBe(2);
        expect(groups.map(group => group.displayName)).toEqual(['Clan Ultra AC/20 Precision Ammo', 'Clan Ultra AC/20 Ammo']);
        expect(groups.map(group => group.destroyed)).toEqual([false, true]);
        expect(component.groupRemaining(groups[0])).toBe(5);
        expect(component.groupRemaining(groups[1])).toBe(0);
    });
});