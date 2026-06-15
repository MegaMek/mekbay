import { DialogRef, DIALOG_DATA } from '@angular/cdk/dialog';
import { CdkDragDrop } from '@angular/cdk/drag-drop';
import { TestBed } from '@angular/core/testing';
import { AmmoEquipment, WeaponEquipment, MiscEquipment, type EquipmentMap } from '../../models/equipment.model';
import type { CBTForceUnit } from '../../models/cbt-force-unit.model';
import type { CriticalSlot, MountedEquipment } from '../../models/force-serialization';
import { InventoryModeHandler } from '../../equipment-handlers/inventory-mode.handler';
import type { HandlerChoice } from '../../services/equipment-interaction-registry.service';
import { INVENTORY_CONTROL_MODE_STATE, inventoryControlSortKey, getInventoryControlGroups } from '../../utils/inventory-control.util';
import { AmmoControlDialogComponent, type AmmoControlDialogData } from '../ammo-control-dialog/ammo-control-dialog.component';
import { WeaponEquipmentDialogComponent, type WeaponEquipmentDialogContext, type WeaponEquipmentDialogData } from './weapon-equipment-dialog.component';

function addRuntimeSelection(unit: CBTForceUnit): CBTForceUnit {
    const selectedEntryIds = new Set<string>();
    const selectedRanges = new Map<string, 'min' | 'short' | 'medium' | 'long'>();
    const selectedAmmoOptions = new Map<string, string>();
    const syncEntry = (entry: MountedEquipment) => {
        const hasSelectedMode = !!entry.el?.querySelector(':scope > .alternativeMode.selected');
        entry.el?.classList.toggle('selected', selectedEntryIds.has(entry.id) || hasSelectedMode);
    };

    Object.assign(unit, {
        getInventoryControlSelectionSnapshot: () => ({
            selectedEntryIds: new Set(selectedEntryIds),
            selectedRanges: new Map(selectedRanges),
            selectedAmmoOptions: new Map(selectedAmmoOptions)
        }),
        isInventoryControlEntrySelected: (entryId: string) => selectedEntryIds.has(entryId),
        getInventoryControlSelectedRange: (entryId: string) => selectedRanges.get(entryId),
        getInventoryControlSelectedAmmoOption: (entryId: string) => selectedAmmoOptions.get(entryId),
        setInventoryControlEntrySelected: (entry: MountedEquipment, selected: boolean) => {
            if (selected) {
                selectedEntryIds.add(entry.id);
            } else {
                selectedEntryIds.delete(entry.id);
                selectedRanges.delete(entry.id);
            }
            syncEntry(entry);
        },
        setInventoryControlSelectedRange: (entry: MountedEquipment, range: 'min' | 'short' | 'medium' | 'long' | null) => {
            if (range === null) {
                selectedEntryIds.delete(entry.id);
                selectedRanges.delete(entry.id);
            } else {
                selectedEntryIds.add(entry.id);
                selectedRanges.set(entry.id, range);
            }
            syncEntry(entry);
        },
        setInventoryControlSelectedAmmoOption: (entryId: string, optionId: string) => selectedAmmoOptions.set(entryId, optionId),
        clearInventoryControlSelection: () => {
            selectedEntryIds.clear();
            selectedRanges.clear();
            selectedAmmoOptions.clear();
            unit.getInventory().forEach(syncEntry);
        },
        syncInventoryControlSelectionSvg: () => unit.getInventory().forEach(syncEntry)
    });
    return unit;
}

function weapon(id: string, ammoType: 'NA' | 'ATM' | 'MML' = 'NA', rackSize = 0): WeaponEquipment {
    return new WeaponEquipment({
        id,
        name: id,
        type: 'weapon',
        weapon: { ammoType, rackSize, ranges: [1, 2, 3, 4] }
    });
}

function ammo(id: string, ammoType: 'ATM' | 'MML', rackSize: number, munitionType: string[] = [], flags: string[] = []): AmmoEquipment {
    return new AmmoEquipment({
        id,
        name: id,
        shortName: id,
        type: 'ammo',
        flags,
        ammo: { type: ammoType, rackSize, shots: 10, munitionType }
    });
}

function misc(id: string, flags: string[] = []): MiscEquipment {
    return new MiscEquipment({ id, name: id, type: 'misc', flags });
}

function svgEntry(html: string): SVGElement {
    const wrapper = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    wrapper.innerHTML = html;
    const el = wrapper.firstElementChild as SVGElement;
    el.classList.add('inventoryEntry');
    return el;
}

function entry(params: {
    id: string;
    equipment?: WeaponEquipment | MiscEquipment | AmmoEquipment;
    physical?: boolean;
    destroyed?: boolean;
    el?: SVGElement;
    states?: Map<string, string>;
    linkedWith?: MountedEquipment[];
    totalAmmo?: number;
    consumed?: number;
    locations?: Set<string>;
}): MountedEquipment {
    const owner = {
        setInventoryEntry: jasmine.createSpy('setInventoryEntry'),
        readOnly: () => false,
        hasDirectInventory: () => true,
        getInventory: () => [],
        getCritSlots: () => [],
        getUnit: () => ({ comp: [] }),
        rules: {}
    } as unknown as CBTForceUnit;
    return {
        owner,
        id: params.id,
        name: params.id,
        equipment: params.equipment,
        physical: params.physical ?? false,
        destroyed: params.destroyed ?? false,
        states: params.states ?? new Map<string, string>(),
        el: params.el,
        linkedWith: params.linkedWith ?? null,
        totalAmmo: params.totalAmmo,
        consumed: params.consumed,
        locations: params.locations
    } as MountedEquipment;
}

interface CreateComponentOptions {
    readOnly?: boolean;
    hasDirectInventory?: boolean;
}

function createComponent(
    entries: MountedEquipment[],
    equipmentMap: EquipmentMap = {},
    critSlots: CriticalSlot[] = [],
    entryStates = new Map<MountedEquipment, { isDamaged: boolean; isDisabled: boolean; hitMod: number }>(),
    options: CreateComponentOptions = {}
) {
    let context: WeaponEquipmentDialogContext;
    const modeHandler = new InventoryModeHandler();
    const dialogsService = { createDialog: jasmine.createSpy('createDialog').and.returnValue({ closed: { subscribe: jasmine.createSpy('subscribe') } }) };
    const unit = {
        getInventory: () => entries,
        getCritSlots: () => critSlots,
        getUnit: () => ({ comp: [] }),
        readOnly: () => options.readOnly ?? false,
        hasDirectInventory: () => options.hasDirectInventory ?? true,
        setInventoryEntry: jasmine.createSpy('setInventoryEntry'),
        rules: { computeAllEntryStates: () => entryStates }
    } as unknown as CBTForceUnit;
    addRuntimeSelection(unit);
    entries.forEach(item => item.owner = unit);
    context = {
            toastService: { showToast: jasmine.createSpy('showToast') },
            dialogsService,
            dataService: { getEquipments: () => equipmentMap },
            registry: {
                getChoices: (entry: MountedEquipment) => modeHandler.applicableTo(entry) ? modeHandler.getChoices(entry, context) : [],
                handleSelection: (entry: MountedEquipment, choice: HandlerChoice) => modeHandler.handleSelection(entry, choice, context)
            }
        } as unknown as WeaponEquipmentDialogContext;
    const data: WeaponEquipmentDialogData = {
        title: 'Weapons & Equipment',
        unit,
        context,
        readOnly: options.readOnly,
    };

    TestBed.configureTestingModule({
        imports: [WeaponEquipmentDialogComponent],
        providers: [
            { provide: DIALOG_DATA, useValue: data },
            { provide: DialogRef, useValue: { close: jasmine.createSpy('close') } },
        ],
    });
    const fixture = TestBed.createComponent(WeaponEquipmentDialogComponent);
    return { fixture, component: fixture.componentInstance, unit, dialogsService };
}

describe('WeaponEquipmentDialogComponent', () => {
    it('groups ranged, physical, equipment, and destroyed entries', () => {
        const laser = entry({ id: 'laser', equipment: weapon('laser'), el: svgEntry('<g><g class="name"><text>Laser</text></g></g>') });
        const punch = entry({ id: 'punch', physical: true, el: svgEntry('<g><g class="name"><text>Punch</text></g></g>') });
        const hatchet = entry({ id: 'hatchet', equipment: misc('Hatchet', ['F_CLUB']), el: svgEntry('<g><g class="name"><text>Hatchet</text></g></g>') });
        const ecm = entry({ id: 'ecm', equipment: misc('ECM'), el: svgEntry('<g><g class="name"><text>ECM</text></g></g>') });
        const broken = entry({ id: 'broken', equipment: weapon('broken'), destroyed: true, el: svgEntry('<g><g class="name"><text>Broken</text></g></g>') });
        const unit = { getInventory: () => [laser, punch, hatchet, ecm, broken], getCritSlots: () => [], rules: {} } as unknown as CBTForceUnit;
        [laser, punch, hatchet, ecm, broken].forEach(item => item.owner = unit);

        const groups = getInventoryControlGroups(unit);

        expect(groups.find(group => group.id === 'ranged')?.rows.map(row => row.id)).toEqual(['laser', 'broken']);
        expect(groups.find(group => group.id === 'physical')?.rows.map(row => row.id)).toEqual(['punch', 'hatchet']);
        expect(groups.find(group => group.id === 'equipment')?.rows.map(row => row.id)).toEqual(['ecm']);
        expect(groups.find(group => group.id === 'ranged')?.rows.find(row => row.id === 'broken')?.destroyed).toBeTrue();
    });

    it('marks rows disabled from entry state rules', () => {
        const laser = entry({ id: 'laser', equipment: weapon('laser'), el: svgEntry('<g><g class="name"><text>Laser</text></g></g>') });
        const entryStates = new Map<MountedEquipment, { isDamaged: boolean; isDisabled: boolean; hitMod: number }>([
            [laser, { isDamaged: false, isDisabled: true, hitMod: 0 }]
        ]);
        const { component } = createComponent([laser], {}, [], entryStates);
        const row = component.groups().find(group => group.id === 'ranged')!.rows[0];

        expect(row.disabled).toBeTrue();
        expect(row.destroyed).toBeFalse();
    });

    it('repairs destroyed direct inventory entries', () => {
        const broken = entry({ id: 'broken', equipment: weapon('broken'), destroyed: true, el: svgEntry('<g><g class="name"><text>Broken</text></g></g>') });
        const { component, unit } = createComponent([broken]);
        const row = component.groups().find(group => group.id === 'ranged')!.rows[0];

        expect(component.canMarkDestroyed(row)).toBeFalse();
        expect(component.canRepair(row)).toBeTrue();

        component.repair(row);

        expect(broken.destroyed).toBeFalse();
        expect(unit.setInventoryEntry).toHaveBeenCalledWith(broken);
    });

    it('uses real alternative modes and treats label-only modes as modifiers', () => {
        const mml = entry({
            id: 'mml',
            equipment: weapon('mml'),
            el: svgEntry(`
                <g>
                    <g class="name"><text>MML 9</text></g>
                    <text class="location">RT</text>
                    <text class="heat">5</text>
                    <g class="damage"><text>[M,C,S]</text></g>
                    <text class="range_min"></text><text class="range_short"></text><text class="range_medium"></text><text class="range_long"></text>
                    <g class="alternativeMode" mode="w/Artemis IV"><g class="name"><text>w/Artemis IV</text></g></g>
                    <g class="alternativeMode" mode="LRM"><g class="name"><text>LRM</text></g><g class="damage"><text>1/Msl</text></g><text class="range_min">6</text><text class="range_short">7</text><text class="range_medium">14</text><text class="range_long">21</text></g>
                </g>
            `)
        });
        const { component } = createComponent([mml]);
        const row = component.groups().find(group => group.id === 'ranged')!.rows[0];

        expect(row.modes.map(mode => mode.mode)).toEqual(['LRM']);
        expect(row.modifiers.map(modifier => modifier.name)).toEqual(['w/Artemis IV']);
        expect(row.selectedMode).toBe('LRM');
        expect(row.display.damage).toBe('1/Msl');
        expect(row.display.long).toBe('21');
        expect(component.modeChoice(row)?.choices?.map(choice => choice.value)).toEqual(['LRM']);
        expect(component.handlerChoices(row)).toEqual([]);
        expect(component.canSelectRange(row, 'min')).toBeFalse();
    });

    it('persists mode and sort order but keeps selection transient', async () => {
        const first = entry({ id: 'first', equipment: weapon('first'), el: svgEntry('<g><g class="name"><text>First</text></g></g>') });
        const second = entry({ id: 'second', equipment: weapon('second'), el: svgEntry('<g><g class="name"><text>Second</text></g></g>') });
        const modeEntry = entry({
            id: 'mode',
            equipment: weapon('mode'),
            el: svgEntry('<g><g class="name"><text>Mode</text></g><g class="alternativeMode" mode="A"><g class="name"><text>A</text></g><g class="damage"><text>1</text></g></g></g>')
        });
        const { component, fixture } = createComponent([first, second, modeEntry]);
        const group = component.groups().find(candidate => candidate.id === 'ranged')!;

        component.drop({ previousIndex: 0, currentIndex: 1 } as CdkDragDrop<any>, group);

        const rangedSortKey = inventoryControlSortKey('ranged');
        expect(first.states.get(rangedSortKey)).toBe('1');
        expect(second.states.get(rangedSortKey)).toBe('0');

        const row = component.groups().find(candidate => candidate.id === 'ranged')!.rows.find(candidate => candidate.id === 'mode')!;
        await component.handleChoice(row, { ...component.modeChoice(row)!, value: 'A', label: 'A' });
        component.selectRange(row, 'short');
        const updatedRow = component.groups().find(candidate => candidate.id === 'ranged')!.rows.find(candidate => candidate.id === 'mode')!;

        expect(modeEntry.states.get(INVENTORY_CONTROL_MODE_STATE)).toBe('A');
        expect(component.modeChoice(updatedRow)?.value).toBe('A');
        expect(modeEntry.states.has('selected')).toBeFalse();
        expect(modeEntry.states.has('range')).toBeFalse();
        fixture.destroy();
    });

    it('keeps range selection tied to entry selection', () => {
        const laser = entry({ id: 'laser', equipment: weapon('laser'), el: svgEntry('<g><g class="name"><text>Laser</text></g><text class="range_short">3</text><text class="range_medium">6</text><text class="range_long">9</text></g>') });
        const { component } = createComponent([laser]);
        const row = component.groups().find(group => group.id === 'ranged')!.rows[0];

        component.selectRange(row, 'medium');
        expect(component.isSelected(row)).toBeTrue();
        expect(component.isRangeSelected(row, 'medium')).toBeTrue();

        component.toggleSelected(row);
        expect(component.isSelected(row)).toBeFalse();
        expect(component.isRangeSelected(row, 'medium')).toBeFalse();

        component.selectRange(row, 'medium');
        component.selectRange(row, 'medium');
        expect(component.isSelected(row)).toBeFalse();
        expect(component.isRangeSelected(row, 'medium')).toBeFalse();
    });

    it('resets entry and range selections from the dialog and SVG', () => {
        const laser = entry({ id: 'laser', equipment: weapon('laser'), el: svgEntry('<g><g class="name"><text>Laser</text></g><text class="range_short">3</text><text class="range_medium">6</text><text class="range_long">9</text></g>') });
        const punch = entry({ id: 'punch', physical: true, el: svgEntry('<g><g class="name"><text>Punch</text></g><text class="range_short">1</text><text class="range_medium">2</text><text class="range_long">3</text></g>') });
        const { component, unit } = createComponent([laser, punch]);
        const rows = component.groups().flatMap(group => group.rows);
        const laserRow = rows.find(row => row.id === 'laser')!;
        const punchRow = rows.find(row => row.id === 'punch')!;

        component.selectRange(laserRow, 'medium');
        component.toggleSelected(punchRow);
        expect(component.isSelected(laserRow)).toBeTrue();
        expect(component.isRangeSelected(laserRow, 'medium')).toBeTrue();
        expect(component.isSelected(punchRow)).toBeTrue();
        expect(laser.el!.classList.contains('selected')).toBeTrue();
        expect(punch.el!.classList.contains('selected')).toBeTrue();

        component.resetSelections();

        expect(component.isSelected(laserRow)).toBeFalse();
        expect(component.isRangeSelected(laserRow, 'medium')).toBeFalse();
        expect(component.isSelected(punchRow)).toBeFalse();
        expect(unit.getInventoryControlSelectionSnapshot().selectedEntryIds.size).toBe(0);
        expect(unit.getInventoryControlSelectionSnapshot().selectedRanges.size).toBe(0);
        expect(laser.el!.classList.contains('selected')).toBeFalse();
        expect(punch.el!.classList.contains('selected')).toBeFalse();
    });

    it('opens the ammo dialog from the weapon dialog actions', () => {
        const standardAmmo = ammo('ATM 6 Standard', 'ATM', 6, ['M_STANDARD']);
        const atm = entry({
            id: 'atm',
            equipment: weapon('ATM 6', 'ATM', 6),
            el: svgEntry('<g><g class="name"><text>ATM 6</text></g><g class="alternativeMode" mode="Standard"><g class="name"><text>Standard</text></g><g class="damage"><text>2/Msl</text></g><text class="range_short">5</text></g></g>')
        });
        const ammoBin = entry({ id: 'std-ammo', equipment: standardAmmo, totalAmmo: 10, consumed: 2, locations: new Set(['CT']) });
        const equipmentMap: EquipmentMap = { [standardAmmo.internalName]: standardAmmo };
        const { component, dialogsService } = createComponent([atm, ammoBin], equipmentMap);

        expect(component.canOpenAmmoDialog()).toBeTrue();
        component.openAmmoDialog();

        expect(dialogsService.createDialog).toHaveBeenCalledWith(AmmoControlDialogComponent, jasmine.objectContaining({
            data: jasmine.objectContaining({
                title: 'Ammo',
                readOnly: false,
                entries: jasmine.any(Array),
                getEntries: jasmine.any(Function)
            })
        }));
        const data = dialogsService.createDialog.calls.mostRecent().args[1]!.data as AmmoControlDialogData;
        expect(data.entries.length).toBe(1);
        expect(data.getEntries!().length).toBe(1);
    });

    it('hides the action column when no group has ammo or controls', () => {
        const laser = entry({ id: 'laser', equipment: weapon('laser'), el: svgEntry('<g><g class="name"><text>Laser</text></g></g>') });
        const { component, fixture } = createComponent([laser], {}, [], new Map(), { readOnly: true });

        expect(component.hasAmmoColumn()).toBeFalse();
        expect(component.hasControlsColumn()).toBeFalse();
        expect(component.hasActionsColumn()).toBeFalse();

        fixture.detectChanges();
        const root = fixture.nativeElement.querySelector('.weapon-equipment-dialog') as HTMLElement;
        expect(root.classList.contains('hide-actions-column')).toBeTrue();
        expect(fixture.nativeElement.querySelector('.ammo-header')).toBeNull();
        expect(fixture.nativeElement.querySelector('.controls-header')).toBeNull();
        expect(fixture.nativeElement.querySelector('.actions-header')).toBeNull();
        expect(fixture.nativeElement.querySelector('.ammo-cell')).toBeNull();
        expect(fixture.nativeElement.querySelector('.controls-cell')).toBeNull();
        expect(fixture.nativeElement.querySelector('.actions-cell')).toBeNull();
    });

    it('combines optional ammo and controls into one action column', () => {
        const standardAmmo = ammo('ATM 6 Standard', 'ATM', 6, ['M_STANDARD']);
        const atm = entry({
            id: 'atm',
            equipment: weapon('ATM 6', 'ATM', 6),
            el: svgEntry('<g><g class="name"><text>ATM 6</text></g><g class="alternativeMode" mode="Standard"><g class="name"><text>Standard</text></g><g class="damage"><text>2/Msl</text></g><text class="range_short">5</text></g></g>')
        });
        const ammoBin = entry({ id: 'std-ammo', equipment: standardAmmo, totalAmmo: 10, consumed: 2, locations: new Set(['CT']) });
        const punch = entry({ id: 'punch', physical: true, el: svgEntry('<g><g class="name"><text>Punch</text></g><text class="range_short">1</text><text class="range_medium">2</text><text class="range_long">3</text></g>') });
        const equipmentMap: EquipmentMap = { [standardAmmo.internalName]: standardAmmo };
        const { component, fixture } = createComponent([atm, ammoBin, punch], equipmentMap, [], new Map(), { readOnly: true });
        const rangedGroup = component.groups().find(group => group.id === 'ranged')!;
        const physicalGroup = component.groups().find(group => group.id === 'physical')!;

        expect(component.hasAmmoColumn()).toBeTrue();
        expect(component.hasControlsColumn()).toBeFalse();
        expect(component.hasActionsColumn()).toBeTrue();
        expect(component.groupHasAmmo(rangedGroup)).toBeTrue();
        expect(component.groupHasControls(rangedGroup)).toBeFalse();
        expect(component.groupHasActions(rangedGroup)).toBeTrue();
        expect(component.groupActionsHeader(rangedGroup)).toBe('Ammo');
        expect(component.groupHasAmmo(physicalGroup)).toBeFalse();
        expect(component.groupHasControls(physicalGroup)).toBeFalse();
        expect(component.groupHasActions(physicalGroup)).toBeFalse();
        expect(component.groupActionsHeader(physicalGroup)).toBe('');

        fixture.detectChanges();
        const sections = Array.from(fixture.nativeElement.querySelectorAll('.weapon-equipment-section')) as HTMLElement[];
        const rangedSection = sections.find(section => section.querySelector('h3')?.textContent?.trim() === 'Ranged Weapons')!;
        const physicalSection = sections.find(section => section.querySelector('h3')?.textContent?.trim() === 'Physical Weapons')!;
        expect(rangedSection.querySelector('.actions-header')?.textContent?.trim()).toBe('Ammo');
        expect(rangedSection.querySelector('.ammo-header')).toBeNull();
        expect(rangedSection.querySelector('.controls-header')).toBeNull();
        expect(physicalSection.querySelector('.actions-header')?.textContent?.trim()).toBe('');
        expect(physicalSection.querySelector('.ammo-header')).toBeNull();
        expect(physicalSection.querySelector('.controls-header')).toBeNull();
        expect(physicalSection.querySelector('.actions-cell')).not.toBeNull();
        expect(physicalSection.querySelector('.actions-cell')?.classList.contains('empty-row-actions')).toBeTrue();
        expect(rangedSection.querySelector('.name-cell .mode-badge')?.textContent?.trim()).toBe('STD');
    });

    it('labels the combined action column from group contents', () => {
        const standardAmmo = ammo('ATM 6 Standard', 'ATM', 6, ['M_STANDARD']);
        const atm = entry({
            id: 'atm',
            equipment: weapon('ATM 6', 'ATM', 6),
            el: svgEntry('<g><g class="name"><text>ATM 6</text></g><g class="alternativeMode" mode="Standard"><g class="name"><text>Standard</text></g><g class="damage"><text>2/Msl</text></g><text class="range_short">5</text></g></g>')
        });
        const ammoBin = entry({ id: 'std-ammo', equipment: standardAmmo, totalAmmo: 10, consumed: 2, locations: new Set(['CT']) });
        const punch = entry({ id: 'punch', physical: true, el: svgEntry('<g><g class="name"><text>Punch</text></g><text class="range_short">1</text><text class="range_medium">2</text><text class="range_long">3</text></g>') });
        const equipmentMap: EquipmentMap = { [standardAmmo.internalName]: standardAmmo };
        const { component, fixture } = createComponent([atm, ammoBin, punch], equipmentMap);
        const rangedGroup = component.groups().find(group => group.id === 'ranged')!;
        const physicalGroup = component.groups().find(group => group.id === 'physical')!;

        expect(component.groupActionsHeader(rangedGroup)).toBe('Ammo & Controls');
        expect(component.groupActionsHeader(physicalGroup)).toBe('Controls');

        fixture.detectChanges();
        const sections = Array.from(fixture.nativeElement.querySelectorAll('.weapon-equipment-section')) as HTMLElement[];
        const rangedSection = sections.find(section => section.querySelector('h3')?.textContent?.trim() === 'Ranged Weapons')!;
        const physicalSection = sections.find(section => section.querySelector('h3')?.textContent?.trim() === 'Physical Weapons')!;
        expect(rangedSection.querySelector('.actions-header')?.textContent?.trim()).toBe('Ammo & Controls');
        expect(physicalSection.querySelector('.actions-header')?.textContent?.trim()).toBe('Controls');
    });

    it('shows mode-aware ammo totals and marks empty ammo', async () => {
        const standardAmmo = ammo('ATM 6 Standard', 'ATM', 6, ['M_STANDARD']);
        const erAmmo = ammo('ATM 6 ER', 'ATM', 6, ['M_EXTENDED_RANGE']);
        const heAmmo = ammo('ATM 6 HE', 'ATM', 6, ['M_HIGH_EXPLOSIVE']);
        const atm = entry({
            id: 'atm',
            equipment: weapon('ATM 6', 'ATM', 6),
            el: svgEntry(`
                <g>
                    <g class="name"><text>ATM 6</text></g>
                    <text class="location">RT</text>
                    <g class="alternativeMode" mode="Standard"><g class="name"><text>Standard</text></g><g class="damage"><text>2/Msl</text></g><text class="range_short">5</text></g>
                    <g class="alternativeMode" mode="Extended Range"><g class="name"><text>Extended Range</text></g><g class="damage"><text>1/Msl</text></g><text class="range_short">9</text></g>
                    <g class="alternativeMode" mode="High Explosive"><g class="name"><text>High Explosive</text></g><g class="damage"><text>3/Msl</text></g><text class="range_short">3</text></g>
                </g>
            `)
        });
        const standardBin = entry({ id: 'std-ammo', equipment: standardAmmo, totalAmmo: 10, consumed: 2, locations: new Set(['CT']) });
        const erBin = entry({ id: 'er-ammo', equipment: erAmmo, totalAmmo: 10, consumed: 10, locations: new Set(['RT']) });
        const destroyedHeBin = entry({ id: 'he-ammo', equipment: heAmmo, totalAmmo: 10, consumed: 0, destroyed: true });
        const equipmentMap: EquipmentMap = {
            [standardAmmo.internalName]: standardAmmo,
            [erAmmo.internalName]: erAmmo,
            [heAmmo.internalName]: heAmmo,
        };
        const { component, fixture } = createComponent([atm, standardBin, erBin, destroyedHeBin], equipmentMap);

        let row = component.groups().find(group => group.id === 'ranged')!.rows[0];
        expect(row.selectedMode).toBe('Standard');
        expect(component.modeChoice(row)?.choices?.map(choice => choice.label)).toEqual(['STD', 'ER', 'HE']);
        expect(component.ammoText(row)).toBe('ATM 6 Standard (8/10)');
        expect(component.ammoDepleted(row)).toBeFalse();
        expect(row.ammo.options.map(option => option.label)).toEqual(['ATM 6 Standard (8/10)']);
        fixture.detectChanges();
        const inlineMode = fixture.nativeElement.querySelector('.name-cell .mode-choice') as HTMLElement;
        expect(inlineMode.textContent?.trim()).toContain('STD');

        await component.handleChoice(row, { ...component.modeChoice(row)!, value: 'Extended Range', label: 'ER' });
        row = component.groups().find(group => group.id === 'ranged')!.rows[0];
        expect(component.ammoText(row)).toBe('ATM 6 ER (0/10)');
        expect(component.ammoDepleted(row)).toBeTrue();
        component.selectAmmoOption(row, row.ammo.options[0].id);
        expect(component.selectedAmmoOption(row)).toBe(row.ammo.options[0].id);

        await component.handleChoice(row, { ...component.modeChoice(row)!, value: 'High Explosive', label: 'HE' });
        row = component.groups().find(group => group.id === 'ranged')!.rows[0];
        expect(component.ammoText(row)).toBe('NO AMMO');
        expect(component.ammoDepleted(row)).toBeTrue();
        expect(component.ammoDestroyed(row)).toBeFalse();
    });

    it('uses a flat dropdown only when multiple compatible ammo sources exist', () => {
        const standardAmmo = ammo('ATM 6 Standard', 'ATM', 6, ['M_STANDARD']);
        const atm = entry({
            id: 'atm',
            equipment: weapon('ATM 6', 'ATM', 6),
            el: svgEntry('<g><g class="name"><text>ATM 6</text></g><g class="alternativeMode" mode="Standard"><g class="name"><text>Standard</text></g><g class="damage"><text>2/Msl</text></g><text class="range_short">5</text></g></g>')
        });
        const leftBin = entry({ id: 'left-ammo', equipment: standardAmmo, totalAmmo: 10, consumed: 1, locations: new Set(['LT']) });
        const rightBin = entry({ id: 'right-ammo', equipment: standardAmmo, totalAmmo: 10, consumed: 5, locations: new Set(['RT']) });
        const equipmentMap: EquipmentMap = { [standardAmmo.internalName]: standardAmmo };
        const { component } = createComponent([atm, leftBin, rightBin], equipmentMap);
        const row = component.groups().find(group => group.id === 'ranged')!.rows[0];

        expect(row.ammo.options.map(option => option.label)).toEqual([
            '[LT] ATM 6 Standard (9/10)',
            '[RT] ATM 6 Standard (5/10)'
        ]);
        expect(component.selectedAmmoOption(row)).toBe(row.ammo.options[0].id);
        expect(component.ammoText(row)).toBe('[LT] ATM 6 Standard (9/10)');
    });

    it('shows No ammo only when a weapon has no ammo choices', () => {
        const atm = entry({
            id: 'atm',
            equipment: weapon('ATM 6', 'ATM', 6),
            el: svgEntry('<g><g class="name"><text>ATM 6</text></g><g class="alternativeMode" mode="Standard"><g class="name"><text>Standard</text></g><g class="damage"><text>2/Msl</text></g><text class="range_short">5</text></g></g>')
        });
        const { component } = createComponent([atm]);
        const row = component.groups().find(group => group.id === 'ranged')!.rows[0];

        expect(row.ammo.options).toEqual([]);
        expect(component.ammoDepleted(row)).toBeTrue();
        expect(component.ammoText(row)).toBe('NO AMMO');
    });

    it('shows No ammo instead of a dropdown when all ammo choices are destroyed', () => {
        const standardAmmo = ammo('ATM 6 Standard', 'ATM', 6, ['M_STANDARD']);
        const atm = entry({
            id: 'atm',
            equipment: weapon('ATM 6', 'ATM', 6),
            el: svgEntry('<g><g class="name"><text>ATM 6</text></g><g class="alternativeMode" mode="Standard"><g class="name"><text>Standard</text></g><g class="damage"><text>2/Msl</text></g><text class="range_short">5</text></g></g>')
        });
        const leftBin = entry({ id: 'left-ammo', equipment: standardAmmo, totalAmmo: 10, consumed: 0, destroyed: true, locations: new Set(['LT']) });
        const rightBin = entry({ id: 'right-ammo', equipment: standardAmmo, totalAmmo: 10, consumed: 0, destroyed: true, locations: new Set(['RT']) });
        const equipmentMap: EquipmentMap = { [standardAmmo.internalName]: standardAmmo };
        const { component } = createComponent([atm, leftBin, rightBin], equipmentMap);
        const row = component.groups().find(group => group.id === 'ranged')!.rows[0];

        expect(row.ammo.options.map(option => ({ remaining: option.remaining, destroyed: option.destroyed }))).toEqual([
            { remaining: 0, destroyed: true },
            { remaining: 0, destroyed: true }
        ]);
        expect(component.showAmmoDropdown(row)).toBeFalse();
        expect(component.ammoText(row)).toBe('NO AMMO');
        expect(component.ammoDepleted(row)).toBeTrue();
        expect(component.ammoDestroyed(row)).toBeFalse();
    });

    it('groups same-location ammo bins', () => {
        const lrmAmmo = ammo('MML 9/LRM Artemis', 'MML', 9, [], ['F_MML_LRM']);
        const srmAmmo = ammo('MML 9/SRM Artemis', 'MML', 9, [], ['F_MML_SRM']);
        const mml = entry({
            id: 'mml',
            equipment: weapon('MML 9', 'MML', 9),
            el: svgEntry('<g><g class="name"><text>MML 9</text></g><g class="alternativeMode" mode="LRM"><g class="name"><text>LRM</text></g><g class="damage"><text>1/Msl</text></g><text class="range_short">7</text></g></g>')
        });
        const fullBin = entry({ id: 'full-lrm', equipment: lrmAmmo, totalAmmo: 13, consumed: 0, locations: new Set(['RT']) });
        const partialBin = entry({ id: 'partial-lrm', equipment: lrmAmmo, totalAmmo: 13, consumed: 3, locations: new Set(['RT']) });
        const srmBin = entry({ id: 'srm', equipment: srmAmmo, totalAmmo: 11, consumed: 0, locations: new Set(['RT']) });
        const equipmentMap: EquipmentMap = {
            [lrmAmmo.internalName]: lrmAmmo,
            [srmAmmo.internalName]: srmAmmo,
        };
        const created = createComponent([mml, fullBin, partialBin, srmBin], equipmentMap);
        const row = created.component.groups().find(group => group.id === 'ranged')!.rows[0];

        expect(row.ammo.options.map(option => option.label)).toEqual(['MML 9/LRM Artemis (23/26)']);
        expect(created.component.ammoText(row)).toBe('MML 9/LRM Artemis (23/26)');
    });

    it('counts destroyed ammo bins as empty inside grouped ammo', () => {
        const lrmAmmo = ammo('MML 9/LRM Artemis', 'MML', 9, [], ['F_MML_LRM']);
        const srmAmmo = ammo('MML 9/SRM Artemis', 'MML', 9, [], ['F_MML_SRM']);
        const mml = entry({
            id: 'mml',
            equipment: weapon('MML 9', 'MML', 9),
            el: svgEntry('<g><g class="name"><text>MML 9</text></g><g class="alternativeMode" mode="LRM"><g class="name"><text>LRM</text></g><g class="damage"><text>1/Msl</text></g><text class="range_short">7</text></g></g>')
        });
        const fullBin = entry({ id: 'full-lrm', equipment: lrmAmmo, totalAmmo: 13, consumed: 0, locations: new Set(['RT']) });
        const srmBin = entry({ id: 'srm', equipment: srmAmmo, totalAmmo: 11, consumed: 0, locations: new Set(['RT']) });
        const equipmentMap: EquipmentMap = {
            [lrmAmmo.internalName]: lrmAmmo,
            [srmAmmo.internalName]: srmAmmo,
        };

        const destroyedBin = entry({ id: 'destroyed-lrm', equipment: lrmAmmo, totalAmmo: 13, consumed: 3, destroyed: true, locations: new Set(['RT']) });
        const created = createComponent([mml, fullBin, destroyedBin, srmBin], equipmentMap);
        const row = created.component.groups().find(group => group.id === 'ranged')!.rows[0];

        expect(row.ammo.options.map(option => ({ label: option.label, destroyed: option.destroyed, disabled: option.disabled }))).toEqual([
            { label: 'MML 9/LRM Artemis (13/26)', destroyed: false, disabled: false }
        ]);
        expect(created.component.ammoText(row)).toBe('MML 9/LRM Artemis (13/26)');
        expect(created.component.ammoDestroyed(row)).toBeFalse();
    });

    it('prefers a non-destroyed non-empty ammo bin when mode changes', async () => {
        const erAmmo = ammo('ATM 6 ER', 'ATM', 6, ['M_EXTENDED_RANGE']);
        const atm = entry({
            id: 'atm',
            equipment: weapon('ATM 6', 'ATM', 6),
            el: svgEntry(`
                <g>
                    <g class="name"><text>ATM 6</text></g>
                    <g class="alternativeMode" mode="Standard"><g class="name"><text>Standard</text></g><g class="damage"><text>2/Msl</text></g><text class="range_short">5</text></g>
                    <g class="alternativeMode" mode="Extended Range"><g class="name"><text>Extended Range</text></g><g class="damage"><text>1/Msl</text></g><text class="range_short">9</text></g>
                </g>
            `)
        });
        const destroyedBin = entry({ id: 'destroyed-er', equipment: erAmmo, totalAmmo: 10, consumed: 0, destroyed: true, locations: new Set(['LT']) });
        const emptyBin = entry({ id: 'empty-er', equipment: erAmmo, totalAmmo: 10, consumed: 10, locations: new Set(['RT']) });
        const liveBin = entry({ id: 'live-er', equipment: erAmmo, totalAmmo: 10, consumed: 4, locations: new Set(['CT']) });
        const equipmentMap: EquipmentMap = { [erAmmo.internalName]: erAmmo };
        const { component } = createComponent([atm, destroyedBin, emptyBin, liveBin], equipmentMap);

        let row = component.groups().find(group => group.id === 'ranged')!.rows[0];
        await component.handleChoice(row, { ...component.modeChoice(row)!, value: 'Extended Range', label: 'ER' });
        row = component.groups().find(group => group.id === 'ranged')!.rows[0];

        expect(row.ammo.options.map(option => ({ label: option.label, disabled: option.disabled, destroyed: option.destroyed }))).toEqual([
            { label: '[LT] ATM 6 ER (0/10)', disabled: true, destroyed: true },
            { label: '[RT] ATM 6 ER (0/10)', disabled: false, destroyed: false },
            { label: '[CT] ATM 6 ER (6/10)', disabled: false, destroyed: false },
        ]);
        expect(component.selectedAmmoOption(row)).toBe(row.ammo.options[2].id);
        expect(component.ammoText(row)).toBe('[CT] ATM 6 ER (6/10)');
        expect(component.ammoDestroyed(row)).toBeFalse();
    });

    it('includes ammo location labels for units with critical slots', () => {
        const standardAmmo = ammo('ATM 6 Standard', 'ATM', 6, ['M_STANDARD']);
        const atm = entry({
            id: 'atm',
            equipment: weapon('ATM 6', 'ATM', 6),
            el: svgEntry('<g><g class="name"><text>ATM 6</text></g><g class="alternativeMode" mode="Standard"><g class="name"><text>Standard</text></g><g class="damage"><text>2/Msl</text></g><text class="range_short">5</text></g></g>')
        });
        const critSlot = {
            loc: 'CT',
            slot: 0,
            id: standardAmmo.internalName,
            name: standardAmmo.internalName,
            eq: standardAmmo,
            totalAmmo: 20,
            consumed: 10
        } as CriticalSlot;
        const equipmentMap: EquipmentMap = { [standardAmmo.internalName]: standardAmmo };
        const { component } = createComponent([atm], equipmentMap, [critSlot]);
        const row = component.groups().find(group => group.id === 'ranged')!.rows[0];

        expect(component.ammoText(row)).toBe('ATM 6 Standard (10/20)');
    });
});