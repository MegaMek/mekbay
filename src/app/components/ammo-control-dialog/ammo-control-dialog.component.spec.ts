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
        displayBinName: `Bin #1 [${params.loc}]`,
        currentAmmo: params.ammo,
        originalAmmo: params.ammo,
        originalTotalAmmo: 5,
        totalAmmo: 5,
        consumed: params.consumed ?? 0,
        destroyed: !!params.destroyed,
    };
}

describe('AmmoControlDialogComponent', () => {
    function configureDialog(data: AmmoControlDialogData): AmmoControlDialogComponent {
        TestBed.configureTestingModule({
            imports: [AmmoControlDialogComponent],
            providers: [
                { provide: DIALOG_DATA, useValue: data },
                { provide: DialogRef, useValue: { close: jasmine.createSpy('close') } },
            ],
        });

        return TestBed.createComponent(AmmoControlDialogComponent).componentInstance;
    }

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
        const component = configureDialog(data);

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

    it('allows a single-bin ammo group to expand', () => {
        const standardAmmo = createAmmo('Clan Ultra AC/20 Ammo');
        const owner = {
            id: 'unit-1',
            readOnly: () => false,
            getUnit: () => ({ techBase: 'Clan' }),
        } as unknown as Pick<CBTForceUnit, 'id' | 'readOnly' | 'getUnit'>;
        const data: AmmoControlDialogData = {
            title: 'Ammo',
            entries: [createCritEntry({ loc: 'LT', slot: 0, ammo: standardAmmo, owner })],
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
        fixture.detectChanges();

        const expandButton: HTMLButtonElement | null = fixture.nativeElement.querySelector('.ammo-expand-button');
        expect(expandButton).toBeNull();
        expect(fixture.nativeElement.querySelector('.ammo-bin-list')).toBeNull();
    });

    it('shows location badges beside the group name', () => {
        const standardAmmo = createAmmo('Clan Ultra AC/20 Ammo');
        const owner = {
            id: 'unit-1',
            readOnly: () => false,
            getUnit: () => ({ techBase: 'Clan' }),
            getLocations: () => ({
                LT: { armor: 0 },
                RT: { armor: 6 },
            }),
            locations: {
                armor: new Map([
                    ['LT', { loc: 'LT', rear: false, points: 10 }],
                    ['RT', { loc: 'RT', rear: false, points: 6 }],
                    ['CT', { loc: 'CT', rear: false, points: 12 }],
                ]),
            },
        } as unknown as Pick<CBTForceUnit, 'id' | 'readOnly' | 'getUnit'>;
        const data: AmmoControlDialogData = {
            title: 'Ammo',
            entries: [
                createCritEntry({ loc: 'LT', slot: 0, ammo: standardAmmo, owner }),
                createCritEntry({ loc: 'LT', slot: 1, ammo: standardAmmo, owner }),
                createCritEntry({ loc: 'RT', slot: 2, ammo: standardAmmo, owner }),
                createCritEntry({ loc: 'CT', slot: 3, ammo: standardAmmo, destroyed: true, owner }),
            ],
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
        fixture.detectChanges();

        const badges = Array.from(fixture.nativeElement.querySelectorAll('.ammo-location-badge')) as HTMLElement[];

        expect(badges.map(badge => badge.textContent?.trim())).toEqual(['2× LT', 'RT', 'CT']);
        expect(badges[0].classList.contains('exposed')).toBeFalse();
        expect(badges[0].classList.contains('destroyed')).toBeFalse();
        expect(badges[1].classList.contains('exposed')).toBeTrue();
        expect(badges[2].classList.contains('destroyed')).toBeTrue();

        fixture.nativeElement.querySelector('.ammo-expand-button')?.click();
        fixture.detectChanges();
        const binBadges = Array.from(fixture.nativeElement.querySelectorAll('.ammo-bin .ammo-location-badge')) as HTMLElement[];

        expect(binBadges.map(badge => badge.textContent?.trim())).toEqual(['LT', 'LT', 'RT', 'CT']);
        expect(binBadges[0].classList.contains('exposed')).toBeFalse();
        expect(binBadges[1].classList.contains('exposed')).toBeFalse();
        expect(binBadges[2].classList.contains('exposed')).toBeTrue();
        expect(binBadges[3].classList.contains('destroyed')).toBeTrue();
    });

    it('shows per-bin quantity controls only for active bins', () => {
        const standardAmmo = createAmmo('Clan Ultra AC/20 Ammo');
        const owner = {
            id: 'unit-1',
            readOnly: () => false,
            setCritSlot: jasmine.createSpy('setCritSlot'),
            getUnit: () => ({ techBase: 'Clan' }),
            svg: () => null,
        } as unknown as Pick<CBTForceUnit, 'id' | 'readOnly' | 'setCritSlot' | 'getUnit' | 'svg'>;
        const activeEntry = createCritEntry({ loc: 'LT', slot: 0, ammo: standardAmmo, owner, consumed: 1 });
        const destroyedEntry = createCritEntry({ loc: 'LT', slot: 1, ammo: standardAmmo, owner, destroyed: true });
        const data: AmmoControlDialogData = {
            title: 'Ammo',
            entries: [activeEntry, destroyedEntry],
            context: {
                dataService: { getEquipments: () => ({ [standardAmmo.internalName]: standardAmmo }) },
                toastService: { showToast: jasmine.createSpy('showToast') },
            } as unknown as HandlerContext,
        };

        TestBed.configureTestingModule({
            imports: [AmmoControlDialogComponent],
            providers: [
                { provide: DIALOG_DATA, useValue: data },
                { provide: DialogRef, useValue: { close: jasmine.createSpy('close') } },
            ],
        });
        const fixture = TestBed.createComponent(AmmoControlDialogComponent);
        fixture.detectChanges();
        fixture.nativeElement.querySelector('.ammo-expand-button')?.click();
        fixture.detectChanges();

        const binRows = Array.from(fixture.nativeElement.querySelectorAll('.ammo-bin')) as HTMLElement[];
        expect(binRows[0].querySelectorAll('.ammo-bin-adjust').length).toBe(2);
        expect(binRows[1].querySelectorAll('.ammo-bin-adjust').length).toBe(0);

        (binRows[0].querySelector('.ammo-bin-adjust') as HTMLButtonElement).click();
        fixture.detectChanges();

        expect(activeEntry.consumed).toBe(2);
        expect(owner.setCritSlot).toHaveBeenCalledWith(activeEntry.source as CriticalSlot);
        expect(binRows[0].querySelector('.ammo-count')?.textContent?.trim()).toBe('3/5');
    });

    it('keeps rebuilt groups open after a bin changes ammo type', () => {
        const standardAmmo = createAmmo('Clan Ultra AC/20 Ammo');
        const precisionAmmo = createAmmo('Clan Ultra AC/20 Precision Ammo');
        const owner = {
            id: 'unit-1',
            readOnly: () => false,
            getUnit: () => ({ techBase: 'Clan' }),
        } as unknown as Pick<CBTForceUnit, 'id' | 'readOnly' | 'getUnit'>;
        const changedEntry = createCritEntry({ loc: 'LT', slot: 0, ammo: standardAmmo, owner });
        const remainingEntry = createCritEntry({ loc: 'LT', slot: 1, ammo: standardAmmo, owner });
        const data: AmmoControlDialogData = {
            title: 'Ammo',
            entries: [changedEntry, remainingEntry],
            getEntries: () => [changedEntry, remainingEntry],
            context: {} as HandlerContext,
        };
        const component = configureDialog(data);
        const group = component.groups()[0];

        component.toggleGroup(group);
        expect(component.isExpanded(group)).toBeTrue();

        changedEntry.currentAmmo = precisionAmmo;
        changedEntry.displayName = precisionAmmo.name;

        const rebuiltGroups = component.groups();

        expect(rebuiltGroups.length).toBe(2);
        expect(rebuiltGroups.every(rebuiltGroup => component.isExpanded(rebuiltGroup))).toBeTrue();
    });
});