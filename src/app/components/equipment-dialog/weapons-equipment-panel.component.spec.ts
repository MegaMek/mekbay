import { CdkDragDrop, CdkDragStart } from '@angular/cdk/drag-drop';
import { TestBed } from '@angular/core/testing';
import { AmmoEquipment, WeaponEquipment, MiscEquipment, type EquipmentMap } from '../../models/equipment.model';
import type { CBTForceUnit } from '../../models/cbt-force-unit.model';
import { INVENTORY_CONTROL_TARGET_COLORS, InventoryControlRuntimeState, type InventoryControlRuntimeTarget, type InventoryControlRuntimeTargetId } from '../../models/inventory-control-runtime-state.model';
import type { CriticalSlot, HeatProfile, MountedEquipment } from '../../models/force-serialization';
import { InventoryModeHandler } from '../../equipment-handlers/inventory-mode.handler';
import type { HandlerChoice } from '../../services/equipment-interaction-registry.service';
import { INVENTORY_CONTROL_MODE_STATE, inventoryControlSortKey, getInventoryControlGroups } from '../../utils/inventory-control.util';
import { WeaponsEquipmentPanelComponent } from './weapons-equipment-panel.component';
import type { EquipmentDialogContext } from './equipment-dialog.model';
import type { MotiveModes } from '../../models/motiveModes.model';

function addRuntimeSelection(unit: CBTForceUnit): CBTForceUnit {
    const runtime = new InventoryControlRuntimeState(() => unit.getInventory());

    Object.assign(unit, {
        getInventoryControlSelectionSnapshot: () => runtime.getSelectionSnapshot(),
        getInventoryControlTargets: () => runtime.getTargets(),
        getInventoryControlTarget: (targetId: InventoryControlRuntimeTargetId) => runtime.getTarget(targetId),
        getInventoryControlSelectedTarget: (entryId: string) => runtime.getSelectedTarget(entryId),
        isInventoryControlEntrySelected: (entryId: string) => runtime.isEntrySelected(entryId),
        getInventoryControlSelectedRange: (entryId: string) => runtime.getSelectedRange(entryId),
        getInventoryControlSelectedAmmoOption: (entryId: string) => runtime.getSelectedAmmoOption(entryId),
        setInventoryControlEntrySelected: (entry: MountedEquipment, selected: boolean) => runtime.setEntrySelected(entry, selected),
        setInventoryControlSelectedRange: (entry: MountedEquipment, range: 'short' | 'medium' | 'long' | null) => runtime.setSelectedRange(entry, range),
        toggleInventoryControlSelectedRange: (entry: MountedEquipment, range: 'short' | 'medium' | 'long', forceSelected = false) => runtime.toggleSelectedRange(entry, range, forceSelected),
        setInventoryControlSelectedAmmoOption: (entryId: string, optionId: string) => runtime.setSelectedAmmoOption(entryId, optionId),
        setInventoryControlSelectedTarget: (entry: MountedEquipment, targetId: InventoryControlRuntimeTargetId | null) => runtime.setSelectedTarget(entry, targetId),
        createInventoryControlTarget: () => runtime.createTarget(),
        updateInventoryControlTarget: (targetId: InventoryControlRuntimeTargetId, patch: Partial<Omit<InventoryControlRuntimeTarget, 'id' | 'letter'>>) => runtime.updateTarget(targetId, patch),
        deleteInventoryControlTarget: (targetId: InventoryControlRuntimeTargetId) => runtime.deleteTarget(targetId),
        resetInventoryControlTargets: () => runtime.resetTargets(),
        clearInventoryControlSelection: () => runtime.clearSelection(),
        syncInventoryControlSelectionSvg: () => runtime.syncSelectionSvg()
    });
    return unit;
}

function weapon(id: string, ammoType: 'NA' | 'ATM' | 'MML' | 'AC_ULTRA' = 'NA', rackSize = 0, ranges: number[] = [1, 2, 3, 4]): WeaponEquipment {
    return new WeaponEquipment({
        id,
        name: id,
        type: 'weapon',
        weapon: { ammoType, rackSize, ranges }
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
    critSlots?: CriticalSlot[];
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
        locations: params.locations,
        critSlots: params.critSlots
    } as MountedEquipment;
}

interface CreateComponentOptions {
    readOnly?: boolean;
    hasDirectInventory?: boolean;
    tracksHeat?: boolean;
    heatDissipation?: number;
    heatNext?: number;
    gunnerySkill?: number;
    pilotingSkill?: number;
    moveMode?: MotiveModes | null;
}

function createComponent(
    entries: MountedEquipment[],
    equipmentMap: EquipmentMap = {},
    critSlots: CriticalSlot[] = [],
    entryStates = new Map<MountedEquipment, { isDamaged: boolean; isDisabled: boolean; hitMod: number }>(),
    options: CreateComponentOptions = {}
) {
    let context: EquipmentDialogContext;
    const modeHandler = new InventoryModeHandler();
    const toasts: Array<{ id: string; message: string; type: 'info' | 'success' | 'error'; data?: Record<string, unknown> }> = [];
    const toastService = {
        showToast: jasmine.createSpy('showToast').and.callFake((message: string, type: 'info' | 'success' | 'error', id?: string, data?: Record<string, unknown>) => {
            const toastId = id ?? `toast-${toasts.length + 1}`;
            const existingIndex = toasts.findIndex(toast => toast.id === toastId);
            if (existingIndex === -1) {
                toasts.push({ id: toastId, message, type, data });
            } else {
                toasts[existingIndex] = { id: toastId, message, type, data };
            }
            return toastId;
        }),
        toasts: () => toasts,
    };
    const dialogsService = {
        createDialog: jasmine.createSpy('createDialog').and.returnValue({ closed: { subscribe: jasmine.createSpy('subscribe') } }),
        showNoticeHtml: jasmine.createSpy('showNoticeHtml').and.resolveTo(),
        showError: jasmine.createSpy('showError').and.resolveTo()
    };
    const heat: HeatProfile = { current: 2, previous: 1, next: options.heatNext };
    const rules = {
        computeAllEntryStates: () => entryStates,
        ...(options.tracksHeat === false ? {} : {
            heatDissipation: () => ({
                totalPips: 10,
                healthyPips: 10,
                damagedCount: 0,
                heatsinksOff: 0,
                totalDissipation: options.heatDissipation ?? 0
            })
        })
    };
    const unit = {
        getInventory: () => entries,
        getCritSlots: () => critSlots,
        getUnit: () => ({ comp: [] }),
        getHeat: () => heat,
        setHeat: jasmine.createSpy('setHeat').and.callFake((value: number) => heat.next = value),
        gunnerySkill: () => options.gunnerySkill ?? 4,
        pilotingSkill: () => options.pilotingSkill ?? 5,
        turnState: () => ({
            moveMode: () => options.moveMode ?? null,
            airborne: () => false,
        }),
        svgService: {
            inventoryTargetHeatFireModifier: () => 0
        },
        readOnly: () => options.readOnly ?? false,
        hasDirectInventory: () => options.hasDirectInventory ?? true,
        setInventoryEntry: jasmine.createSpy('setInventoryEntry'),
        setCritSlot: jasmine.createSpy('setCritSlot'),
        rules
    } as unknown as CBTForceUnit;
    addRuntimeSelection(unit);
    entries.forEach(item => item.owner = unit);
    context = {
            toastService,
            dialogsService,
            dataService: { getEquipments: () => equipmentMap },
            registry: {
                getChoices: (entry: MountedEquipment) => modeHandler.applicableTo(entry) ? modeHandler.getChoices(entry, context) : [],
                handleSelection: (entry: MountedEquipment, choice: HandlerChoice) => modeHandler.handleSelection(entry, choice, context)
            }
        } as unknown as EquipmentDialogContext;

    TestBed.configureTestingModule({
        imports: [WeaponsEquipmentPanelComponent],
    });
    const fixture = TestBed.createComponent(WeaponsEquipmentPanelComponent);
    fixture.componentRef.setInput('unit', unit);
    fixture.componentRef.setInput('context', context);
    fixture.componentRef.setInput('readOnly', options.readOnly);
    fixture.detectChanges();
    return { fixture, component: fixture.componentInstance, unit, dialogsService, toastService, heat };
}

describe('WeaponsEquipmentPanelComponent', () => {
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

    it('keeps inactive direct inventory rows in original order', () => {
        const broken = entry({ id: 'broken', equipment: weapon('broken'), destroyed: true, el: svgEntry('<g><g class="name"><text>Broken</text></g></g>') });
        const laser = entry({ id: 'laser', equipment: weapon('laser'), el: svgEntry('<g><g class="name"><text>Laser</text></g></g>') });
        const unit = { getInventory: () => [broken, laser], getCritSlots: () => [], rules: {} } as unknown as CBTForceUnit;
        [broken, laser].forEach(item => item.owner = unit);

        const groups = getInventoryControlGroups(unit);

        expect(groups.find(group => group.id === 'ranged')?.rows.map(row => row.id)).toEqual(['broken', 'laser']);
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

    it('marks jammed inventory-only rows disabled without entry state rules', () => {
        const uac = entry({
            id: 'uac',
            equipment: weapon('uac', 'AC_ULTRA'),
            states: new Map([['state', 'jammed']]),
            el: svgEntry('<g><g class="name"><text>Ultra AC/2</text></g></g>')
        });
        const unit = { getInventory: () => [uac], getCritSlots: () => [], rules: {} } as unknown as CBTForceUnit;
        uac.owner = unit;

        const row = getInventoryControlGroups(unit).find(group => group.id === 'ranged')!.rows[0];

        expect(row.disabled).toBeTrue();
        expect(uac.el!.classList.contains('disabledInventory')).toBeTrue();
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
        expect(mml.el?.querySelector(':scope > .alternativeMode.selected')?.getAttribute('mode')).toBe('LRM');
        expect(component.modeChoice(row)?.choices?.map(choice => choice.value)).toEqual(['LRM']);
        expect(component.handlerChoices(row)).toEqual([]);
    });

    it('shows linked weapon enhancements as modifiers instead of standalone rows', () => {
        const artemis = entry({
            id: 'ISArtemisIV@RT#5',
            equipment: misc('ISArtemisIV', ['F_WEAPON_ENHANCEMENT']),
            destroyed: true,
            el: svgEntry('<g class="linked"><g class="name"><text>w/Artemis IV</text></g></g>')
        });
        const lrm = entry({
            id: 'LRM 20@RT#0',
            equipment: weapon('LRM 20', 'MML', 20),
            linkedWith: [artemis],
            el: svgEntry('<g><g class="name"><text>LRM 20</text></g><text class="location">RT</text><text class="heat">6</text><g class="damage"><text>1/Msl [M,C,S]</text></g></g>')
        });
        artemis.parent = lrm;
        const { component } = createComponent([lrm, artemis]);
        const rows = component.groups().flatMap(group => group.rows);

        expect(rows.map(row => row.id)).toEqual(['LRM 20@RT#0']);
        expect(rows[0].modifiers).toEqual([{ name: 'w/Artemis IV', destroyed: true }]);
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
        const laser = entry({ id: 'laser', equipment: weapon('laser'), el: svgEntry('<g><rect class="inventoryEntryButton"></rect><rect class="shrButton inventoryEntryButton"></rect><rect class="medButton inventoryEntryButton"></rect><rect class="lngButton inventoryEntryButton"></rect><g class="name"><text>Laser</text></g><text class="range_short">3</text><text class="range_medium">6</text><text class="range_long">9</text></g>') });
        const { component } = createComponent([laser]);
        const row = component.groups().find(group => group.id === 'ranged')!.rows[0];

        component.selectRange(row, 'medium');
        expect(component.isSelected(row)).toBeTrue();
        expect(component.isRangeSelected(row, 'medium')).toBeTrue();
        expect(laser.el!.classList.contains('selected-range-medium')).toBeTrue();
        expect(laser.el!.classList.contains('selected-range-short')).toBeFalse();

        component.toggleSelected(row);
        expect(component.isSelected(row)).toBeFalse();
        expect(component.isRangeSelected(row, 'medium')).toBeFalse();
        expect(laser.el!.classList.contains('selected-range-medium')).toBeFalse();

        component.selectRange(row, 'medium');
        component.selectRange(row, 'medium');
        expect(component.isSelected(row)).toBeFalse();
        expect(component.isRangeSelected(row, 'medium')).toBeFalse();
    });

    it('syncs target distance selections to SVG range button classes', () => {
        const laser = entry({ id: 'laser', equipment: weapon('laser', 'NA', 0, [3, 6, 9, 12]), el: svgEntry('<g><rect class="inventoryEntryButton"></rect><rect class="shrButton inventoryEntryButton"></rect><rect class="medButton inventoryEntryButton"></rect><rect class="lngButton inventoryEntryButton"></rect><rect class="extButton inventoryEntryButton"></rect><g class="name"><text>Laser</text></g><text class="range_short">3</text><text class="range_medium">6</text><text class="range_long">9</text></g>') });
        const { unit } = createComponent([laser]);

        unit.createInventoryControlTarget();
        unit.updateInventoryControlTarget('A', { distance: 10 });
        unit.setInventoryControlSelectedTarget(laser, 'A');

        expect(laser.el!.classList.contains('selected-range-extreme')).toBeTrue();
        expect(laser.el!.classList.contains('selected-range-long')).toBeFalse();
    });

    it('upgrades existing weapon selections to the first target and toggles the single target like a checkbox', () => {
        const laser = entry({ id: 'laser', equipment: weapon('laser'), el: svgEntry('<g><g class="name"><text>Laser</text></g><text class="range_short">3</text><text class="range_medium">6</text><text class="range_long">9</text></g>') });
        const { component, fixture, unit } = createComponent([laser]);
        const row = component.groups().find(group => group.id === 'ranged')!.rows[0];

        component.toggleSelected(row);
        unit.createInventoryControlTarget();
        (component as any).refresh();
        fixture.detectChanges();

        expect(unit.getInventoryControlSelectedTarget(row.id)).toBe('A');
        expect(component.isSelected(row)).toBeTrue();
        const selector = fixture.nativeElement.querySelector('.weapon-equipment-row .target-selector') as HTMLButtonElement;
        expect(selector.textContent?.trim()).toBe('A');

        selector.click();
        fixture.detectChanges();

        expect(unit.getInventoryControlSelectedTarget(row.id)).toBeUndefined();
        expect(component.isSelected(row)).toBeFalse();
    });

    it('opens target choices for multiple targets and assigns the picked target', () => {
        const laser = entry({ id: 'laser', equipment: weapon('laser'), el: svgEntry('<g><g class="name"><text>Laser</text></g><text class="range_short">3</text><text class="range_medium">6</text><text class="range_long">9</text></g>') });
        const { component, fixture, unit } = createComponent([laser]);
        const row = component.groups().find(group => group.id === 'ranged')!.rows[0];
        unit.createInventoryControlTarget();
        unit.createInventoryControlTarget();
        unit.updateInventoryControlTarget('B', { distance: 4, tnModifier: 1 });
        (component as any).refresh();
        fixture.detectChanges();

        (fixture.nativeElement.querySelector('.weapon-equipment-row .target-selector') as HTMLButtonElement).click();
        fixture.detectChanges();
        const choices = Array.from(document.body.querySelectorAll('.weapon-target-choice-menu .target-choice')) as HTMLButtonElement[];
        expect(choices.map(choice => choice.querySelector('.target-choice-token')?.textContent?.trim())).toEqual(['—', 'A', 'B']);
        expect(choices.map(choice => choice.querySelector('.target-choice-tn')?.textContent?.trim() ?? '')).toEqual(['', '4', '7']);

        choices[2].click();
        fixture.detectChanges();

        expect(unit.getInventoryControlSelectedTarget(row.id)).toBe('B');
        expect(component.isSelected(row)).toBeTrue();
        fixture.destroy();
    });

    it('uses the target selector for ranged select all when targets exist', () => {
        const first = entry({ id: 'first', equipment: weapon('first'), el: svgEntry('<g><g class="name"><text>First</text></g></g>') });
        const second = entry({ id: 'second', equipment: weapon('second'), el: svgEntry('<g><g class="name"><text>Second</text></g></g>') });
        const broken = entry({ id: 'broken', equipment: weapon('broken'), destroyed: true, el: svgEntry('<g><g class="name"><text>Broken</text></g></g>') });
        const disabled = entry({ id: 'disabled', equipment: weapon('disabled'), el: svgEntry('<g><g class="name"><text>Disabled</text></g></g>') });
        const punch = entry({ id: 'punch', physical: true, el: svgEntry('<g><g class="name"><text>Punch</text></g></g>') });
        const entryStates = new Map<MountedEquipment, { isDamaged: boolean; isDisabled: boolean; hitMod: number }>([
            [disabled, { isDamaged: false, isDisabled: true, hitMod: 0 }]
        ]);
        const { component, fixture, unit } = createComponent([first, second, broken, disabled, punch], {}, [], entryStates);
        unit.createInventoryControlTarget();
        (component as any).refresh();
        fixture.detectChanges();
        const rangedSection = (Array.from(fixture.nativeElement.querySelectorAll('.weapon-equipment-section')) as HTMLElement[])
            .find(section => section.querySelector('h3')?.textContent?.trim() === 'Ranged Weapons')!;
        const headerSelector = rangedSection.querySelector('.select-header .target-selector') as HTMLButtonElement;
        const rows = component.groups().flatMap(group => group.rows);
        const firstRow = rows.find(row => row.id === 'first')!;
        const secondRow = rows.find(row => row.id === 'second')!;
        const brokenRow = rows.find(row => row.id === 'broken')!;
        const disabledRow = rows.find(row => row.id === 'disabled')!;
        const punchRow = rows.find(row => row.id === 'punch')!;

        headerSelector.click();
        fixture.detectChanges();

        expect(unit.getInventoryControlSelectedTarget(firstRow.id)).toBe('A');
        expect(unit.getInventoryControlSelectedTarget(secondRow.id)).toBe('A');
        expect(unit.getInventoryControlSelectedTarget(brokenRow.id)).toBeUndefined();
        expect(unit.getInventoryControlSelectedTarget(disabledRow.id)).toBeUndefined();
        expect(unit.getInventoryControlSelectedTarget(punchRow.id)).toBeUndefined();
        expect(component.groupTargetSelection(component.groups().find(group => group.id === 'ranged')!)?.id).toBe('A');

        unit.setInventoryControlSelectedTarget(brokenRow.entry, 'A');
        unit.setInventoryControlSelectedTarget(disabledRow.entry, 'A');

        (rangedSection.querySelector('.select-header .target-selector') as HTMLButtonElement).click();
        fixture.detectChanges();

        expect(component.isSelected(firstRow)).toBeFalse();
        expect(component.isSelected(secondRow)).toBeFalse();
        expect(component.isSelected(brokenRow)).toBeFalse();
        expect(component.isSelected(disabledRow)).toBeFalse();
        expect(component.isSelected(punchRow)).toBeFalse();
    });

    it('uses assigned target distance for range selection and target number math', () => {
        const laser = entry({ id: 'laser', equipment: weapon('laser'), el: svgEntry('<g><g class="name"><text>Laser</text></g><text class="range_min">6</text><text class="range_short">3</text><text class="range_medium">6</text><text class="range_long">9</text></g>') });
        const { component, fixture, unit } = createComponent([laser], {}, [], new Map([[laser, { isDamaged: false, isDisabled: false, hitMod: 1 }]]), { gunnerySkill: 4, moveMode: 'run' });
        const row = component.groups().find(group => group.id === 'ranged')!.rows[0];
        unit.createInventoryControlTarget();
        unit.updateInventoryControlTarget('A', { distance: 8, tnModifier: 1 });
        unit.setInventoryControlSelectedTarget(row.entry, 'A');
        (component as any).refresh();
        fixture.detectChanges();

        expect(component.canSelectRange(row, 'long')).toBeFalse();
        expect(component.isRangeSelected(row, 'long')).toBeTrue();
        expect(component.isOutOfLongRange(row)).toBeFalse();
        expect(component.isOutOfExtremeRange(row)).toBeFalse();
        expect(component.targetNumberText(row)).toBe('12');
        expect(component.targetNumberTooltip(row)).toEqual([
            { label: 'Gunnery', value: '4' },
            { label: 'Movement (Run)', value: '+2' },
            { label: 'Target (A)', value: '+1' },
            { label: 'Range (Long)', value: '+4' },
            { label: 'Hit Modifier', value: '+1' },
            { isBreak: true },
            { label: 'Total', value: '12', isHeader: true },
        ]);
        expect((fixture.nativeElement.querySelector('.tn-cell') as HTMLElement).hasAttribute('data-tooltip-host')).toBeTrue();
        const selectedRangeCell = fixture.nativeElement.querySelector('.range-long') as HTMLElement;
        expect(selectedRangeCell.classList.contains('selected-range')).toBeTrue();
        expect(selectedRangeCell.style.getPropertyValue('--range-selection-color')).toBe(INVENTORY_CONTROL_TARGET_COLORS[0]);
    });

    it('shows heat fire modifiers as a separate target number term', () => {
        const laser = entry({ id: 'laser', equipment: weapon('laser'), el: svgEntry('<g><g class="name"><text>Laser</text></g><text class="range_short">3</text><text class="range_medium">6</text><text class="range_long">9</text></g>') });
        const { component, fixture, unit } = createComponent([laser], {}, [], new Map([[laser, { isDamaged: false, isDisabled: false, hitMod: 3 }]]), { gunnerySkill: 4 });
        (unit.svgService as any).inventoryTargetHeatFireModifier = () => 2;
        const row = component.groups().find(group => group.id === 'ranged')!.rows[0];
        unit.createInventoryControlTarget();
        unit.updateInventoryControlTarget('A', { distance: 4, tnModifier: 1 });
        unit.setInventoryControlSelectedTarget(row.entry, 'A');
        (component as any).refresh();
        fixture.detectChanges();

        expect(component.targetNumberText(row)).toBe('10');
        expect(component.targetNumberTooltip(row)).toEqual([
            { label: 'Gunnery', value: '4' },
            { label: 'Movement (None)', value: '+0' },
            { label: 'Target (A)', value: '+1' },
            { label: 'Range (Medium)', value: '+2' },
            { label: 'Hit Modifier', value: '+1' },
            { label: 'Heat - Fire Modifier', value: '+2' },
            { isBreak: true },
            { label: 'Total', value: '10', isHeader: true },
        ]);
    });

    it('uses piloting skill for physical target numbers', () => {
        const punch = entry({ id: 'punch', physical: true, el: svgEntry('<g><g class="name"><text>Punch</text></g></g>') });
        const { component, unit } = createComponent([punch], {}, [], new Map(), { pilotingSkill: 6 });
        const row = component.groups().find(group => group.id === 'physical')!.rows[0];
        unit.createInventoryControlTarget();
        unit.updateInventoryControlTarget('A', { distance: 10, tnModifier: 1 });
        unit.setInventoryControlSelectedTarget(row.entry, 'A');
        (component as any).refresh();

        expect(component.isRangeSelected(row, 'short')).toBeFalse();
        expect(component.isOutOfLongRange(row)).toBeFalse();
        expect(component.isOutOfExtremeRange(row)).toBeFalse();
        expect(component.targetNumberText(row)).toBe('7');
        expect(component.targetNumberTooltip(row)).toEqual([
            { label: 'Piloting', value: '6' },
            { label: 'Movement (None)', value: '+0' },
            { label: 'Target (A)', value: '+1' },
            { isBreak: true },
            { label: 'Total', value: '7', isHeader: true },
        ]);
    });

    it('marks target numbers out of range beyond long range', () => {
        const laser = entry({ id: 'laser', equipment: weapon('laser', 'NA', 0, [3, 6, 9, 12]), el: svgEntry('<g><g class="name"><text>Laser</text></g><text class="range_short">3</text><text class="range_medium">6</text><text class="range_long">9</text></g>') });
        const { component, fixture, unit } = createComponent([laser], {}, [], new Map(), { gunnerySkill: 4 });
        const row = component.groups().find(group => group.id === 'ranged')!.rows[0];
        unit.createInventoryControlTarget();
        unit.updateInventoryControlTarget('A', { distance: 11, tnModifier: 1 });
        unit.setInventoryControlSelectedTarget(row.entry, 'A');
        (component as any).refresh();
        fixture.detectChanges();

        expect(component.isOutOfLongRange(row)).toBeTrue();
        expect(component.isOutOfExtremeRange(row)).toBeFalse();
        expect(component.targetNumberText(row)).toBe('X');
        expect(component.targetNumberTooltip(row)).toEqual([{ value: 'OUT OF RANGE', isHeader: true }]);
        expect((fixture.nativeElement.querySelector('.tn-cell') as HTMLElement).classList.contains('out-of-range')).toBeTrue();
        const rangeCells = Array.from(fixture.nativeElement.querySelectorAll('.range-cell')) as HTMLElement[];
        expect(rangeCells.every(cell => cell.classList.contains('out-of-range'))).toBeTrue();
        expect(rangeCells.every(cell => cell.style.getPropertyValue('--range-selection-color') === '')).toBeTrue();
    });

    it('toggles all ranged weapons from the ranged group header checkbox', () => {
        const first = entry({ id: 'first', equipment: weapon('first'), el: svgEntry('<g><g class="name"><text>First</text></g></g>') });
        const second = entry({ id: 'second', equipment: weapon('second'), el: svgEntry('<g><g class="name"><text>Second</text></g></g>') });
        const broken = entry({ id: 'broken', equipment: weapon('broken'), destroyed: true, el: svgEntry('<g><g class="name"><text>Broken</text></g></g>') });
        const disabled = entry({ id: 'disabled', equipment: weapon('disabled'), el: svgEntry('<g><g class="name"><text>Disabled</text></g></g>') });
        const punch = entry({ id: 'punch', physical: true, el: svgEntry('<g><g class="name"><text>Punch</text></g></g>') });
        const entryStates = new Map<MountedEquipment, { isDamaged: boolean; isDisabled: boolean; hitMod: number }>([
            [disabled, { isDamaged: false, isDisabled: true, hitMod: 0 }]
        ]);
        const { component, fixture, unit } = createComponent([first, second, broken, disabled, punch], {}, [], entryStates);
        fixture.detectChanges();

        const sections = Array.from(fixture.nativeElement.querySelectorAll('.weapon-equipment-section')) as HTMLElement[];
        const rangedSection = sections.find(section => section.querySelector('h3')?.textContent?.trim() === 'Ranged Weapons')!;
        const checkbox = rangedSection.querySelector<HTMLInputElement>('.ranged-select-all')!;
        const rows = component.groups().flatMap(group => group.rows);
        const firstRow = rows.find(row => row.id === 'first')!;
        const secondRow = rows.find(row => row.id === 'second')!;
        const brokenRow = rows.find(row => row.id === 'broken')!;
        const disabledRow = rows.find(row => row.id === 'disabled')!;
        const punchRow = rows.find(row => row.id === 'punch')!;

        checkbox.click();
        fixture.detectChanges();

        expect(component.isSelected(firstRow)).toBeTrue();
        expect(component.isSelected(secondRow)).toBeTrue();
        expect(component.isSelected(brokenRow)).toBeFalse();
        expect(component.isSelected(disabledRow)).toBeFalse();
        expect(component.isSelected(punchRow)).toBeFalse();
        expect(rangedSection.querySelector<HTMLInputElement>('.ranged-select-all')!.checked).toBeTrue();

        unit.setInventoryControlEntrySelected(brokenRow.entry, true);
        unit.setInventoryControlEntrySelected(disabledRow.entry, true);

        rangedSection.querySelector<HTMLInputElement>('.ranged-select-all')!.click();
        fixture.detectChanges();

        expect(component.isSelected(firstRow)).toBeFalse();
        expect(component.isSelected(secondRow)).toBeFalse();
        expect(component.isSelected(brokenRow)).toBeFalse();
        expect(component.isSelected(disabledRow)).toBeFalse();
        expect(component.isSelected(punchRow)).toBeFalse();
        expect(rangedSection.querySelector<HTMLInputElement>('.ranged-select-all')!.checked).toBeFalse();
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

    it('raises selected weapon heat before dissipation and consumes shared ammo bins', async () => {
        const standardAmmo = ammo('ATM 6 Standard', 'ATM', 6, ['M_STANDARD']);
        const first = entry({
            id: 'first-atm',
            equipment: weapon('ATM 6', 'ATM', 6),
            el: svgEntry('<g><g class="name"><text>ATM 6</text></g><text class="heat">4</text><text class="range_short">5</text></g>')
        });
        const second = entry({
            id: 'second-atm',
            equipment: weapon('ATM 6', 'ATM', 6),
            el: svgEntry('<g><g class="name"><text>ATM 6</text></g><text class="heat">3</text><text class="range_short">5</text></g>')
        });
        const ammoBin = entry({ id: 'std-ammo', equipment: standardAmmo, totalAmmo: 5, consumed: 1, locations: new Set(['CT']) });
        const equipmentMap: EquipmentMap = { [standardAmmo.internalName]: standardAmmo };
        const { component, fixture, unit, heat } = createComponent([first, second, ammoBin], equipmentMap, [], new Map(), { heatDissipation: 3 });
        const rows = component.groups().find(group => group.id === 'ranged')!.rows;

        component.toggleSelected(rows[0]);
        component.toggleSelected(rows[1]);
        fixture.detectChanges();

        expect(component.selectedHeatTotal()).toBe(7);
        expect(component.selectedHeatProjection()).toEqual(jasmine.objectContaining({
            current: 2,
            selection: 7,
            dissipation: 3,
            final: 6,
            dissipationWidth: 10,
            pendingWidth: 30
        }));
        expect(component.consumeButtonLabel()).toBe('CONSUME HEAT & AMMO');

        await component.consumeSelectedHeatAndAmmo();

        expect(ammoBin.consumed).toBe(3);
        expect(unit.setInventoryEntry).toHaveBeenCalledWith(ammoBin);
        expect(unit.setHeat).toHaveBeenCalledWith(9);
        expect(heat.next).toBe(9);
    });

    it('hides heat information and consumes only ammo for units that do not track heat', async () => {
        const standardAmmo = ammo('ATM 6 Standard', 'ATM', 6, ['M_STANDARD']);
        const atm = entry({
            id: 'atm',
            equipment: weapon('ATM 6', 'ATM', 6),
            el: svgEntry('<g><g class="name"><text>ATM 6</text></g><text class="heat">4</text><text class="range_short">5</text></g>')
        });
        const ammoBin = entry({ id: 'std-ammo', equipment: standardAmmo, totalAmmo: 5, consumed: 1, locations: new Set(['CT']) });
        const equipmentMap: EquipmentMap = { [standardAmmo.internalName]: standardAmmo };
        const { component, fixture, unit } = createComponent([atm, ammoBin], equipmentMap, [], new Map(), { tracksHeat: false });
        const row = component.groups().find(group => group.id === 'ranged')!.rows[0];

        component.toggleSelected(row);
        fixture.detectChanges();

        expect(component.selectedHeatProjection()).toBeNull();
        expect(component.consumeButtonLabel()).toBe('CONSUME AMMO');

        await component.consumeSelectedHeatAndAmmo();

        expect(ammoBin.consumed).toBe(2);
        expect(unit.setHeat).not.toHaveBeenCalled();
    });

    it('adjusts selected ammo from row stepper controls', () => {
        const standardAmmo = ammo('ATM 6 Standard', 'ATM', 6, ['M_STANDARD']);
        const atm = entry({
            id: 'atm',
            equipment: weapon('ATM 6', 'ATM', 6),
            el: svgEntry('<g><g class="name"><text>ATM 6</text></g><text class="heat">4</text><text class="range_short">5</text></g>')
        });
        const ammoBin = entry({ id: 'std-ammo', equipment: standardAmmo, totalAmmo: 5, consumed: 1, locations: new Set(['CT']) });
        const equipmentMap: EquipmentMap = { [standardAmmo.internalName]: standardAmmo };
        const { component, fixture, unit, toastService } = createComponent([atm, ammoBin], equipmentMap, [], new Map(), { tracksHeat: false });
        let row = component.groups().find(group => group.id === 'ranged')!.rows[0];

        fixture.detectChanges();
        const buttons = fixture.nativeElement.querySelectorAll('.ammo-stepper-button') as NodeListOf<HTMLButtonElement>;
        expect(buttons.length).toBe(2);
        expect(buttons[0].textContent?.trim()).toBe('-');
        expect(buttons[1].textContent?.trim()).toBe('+');

        expect(component.canAdjustAmmo(row, 1)).toBeTrue();
        expect(component.canAdjustAmmo(row, -1)).toBeTrue();
        component.adjustAmmo(row, 1);

        expect(ammoBin.consumed).toBe(2);
        expect(unit.setInventoryEntry).toHaveBeenCalledWith(ammoBin);
        expect(toastService.showToast).toHaveBeenCalledWith('-1 from CT ATM 6 Standard (3/5)', 'info', 'ammo-control-undefined-inventory:std-ammo', { ammoDeltaRemaining: -1 });

        row = component.groups().find(group => group.id === 'ranged')!.rows[0];
        component.adjustAmmo(row, -1);
        expect(ammoBin.consumed).toBe(1);
        expect(toastService.showToast).toHaveBeenCalledWith('+1 to CT ATM 6 Standard (4/5)', 'info', 'ammo-control-undefined-inventory:std-ammo', { ammoDeltaRemaining: 1 });

        for (let i = 0; i < 2; i++) {
            row = component.groups().find(group => group.id === 'ranged')!.rows[0];
            component.adjustAmmo(row, -1);
        }
        row = component.groups().find(group => group.id === 'ranged')!.rows[0];
        expect(ammoBin.consumed).toBe(0);
        expect(component.canAdjustAmmo(row, -1)).toBeFalse();

        for (let i = 0; i < 6; i++) {
            row = component.groups().find(group => group.id === 'ranged')!.rows[0];
            component.adjustAmmo(row, 1);
        }
        row = component.groups().find(group => group.id === 'ranged')!.rows[0];
        expect(ammoBin.consumed).toBe(5);
        expect(component.canAdjustAmmo(row, 1)).toBeFalse();
    });

    it('switches to another compatible ammo bin after the selected bin is depleted', async () => {
        const standardAmmo = ammo('ATM 6 Standard', 'ATM', 6, ['M_STANDARD']);
        const atm = entry({
            id: 'atm',
            equipment: weapon('ATM 6', 'ATM', 6),
            el: svgEntry('<g><g class="name"><text>ATM 6</text></g><text class="heat">4</text><text class="range_short">5</text></g>')
        });
        const leftBin = entry({ id: 'left-ammo', equipment: standardAmmo, totalAmmo: 1, consumed: 0, locations: new Set(['LT']) });
        const rightBin = entry({ id: 'right-ammo', equipment: standardAmmo, totalAmmo: 5, consumed: 0, locations: new Set(['RT']) });
        const equipmentMap: EquipmentMap = { [standardAmmo.internalName]: standardAmmo };
        const { component } = createComponent([atm, leftBin, rightBin], equipmentMap, [], new Map(), { tracksHeat: false });
        let row = component.groups().find(group => group.id === 'ranged')!.rows[0];

        expect(component.selectedAmmoOption(row)).toBe(row.ammo.options[0].id);
        component.toggleSelected(row);

        await component.consumeSelectedHeatAndAmmo();

        expect(leftBin.consumed).toBe(1);
        expect(rightBin.consumed).toBe(0);
        row = component.groups().find(group => group.id === 'ranged')!.rows[0];
        expect(component.selectedAmmoOption(row)).toBe(row.ammo.options[1].id);
        expect(component.ammoText(row)).toBe('[RT] ATM 6 Standard (5/5)');

        await component.consumeSelectedHeatAndAmmo();

        expect(leftBin.consumed).toBe(1);
        expect(rightBin.consumed).toBe(1);
    });

    it('does not switch to a different ammo type after the selected bin is depleted', async () => {
        const fragAmmo = ammo('LRM 15 Frag', 'MML', 15);
        const smokeAmmo = ammo('LRM 15 Smoke', 'MML', 15);
        const lrm = entry({
            id: 'lrm',
            equipment: weapon('LRM 15', 'MML', 15),
            el: svgEntry('<g><g class="name"><text>LRM 15</text></g><text class="heat">5</text><text class="range_short">7</text></g>')
        });
        const fragBin = entry({ id: 'frag-ammo', equipment: fragAmmo, totalAmmo: 10, consumed: 5, locations: new Set(['LT']) });
        const smokeBin = entry({ id: 'smoke-ammo', equipment: smokeAmmo, totalAmmo: 1, consumed: 0, locations: new Set(['LT']) });
        const emptySmokeBin = entry({ id: 'empty-smoke-ammo', equipment: smokeAmmo, totalAmmo: 10, consumed: 10, locations: new Set(['RT']) });
        const equipmentMap: EquipmentMap = {
            [fragAmmo.internalName]: fragAmmo,
            [smokeAmmo.internalName]: smokeAmmo,
        };
        const { component, dialogsService } = createComponent([lrm, fragBin, smokeBin, emptySmokeBin], equipmentMap, [], new Map(), { tracksHeat: false });
        let row = component.groups().find(group => group.id === 'ranged')!.rows[0];
        component.selectAmmoOption(row, row.ammo.options[1].id);
        row = component.groups().find(group => group.id === 'ranged')!.rows[0];

        expect(component.ammoText(row)).toBe('[LT] LRM 15 Smoke (1/1)');
        component.toggleSelected(row);

        await component.consumeSelectedHeatAndAmmo();

        expect(smokeBin.consumed).toBe(1);
        expect(fragBin.consumed).toBe(5);
        row = component.groups().find(group => group.id === 'ranged')!.rows[0];
        expect(component.selectedAmmoOption(row)).toBe(row.ammo.options[1].id);
        expect(component.ammoText(row)).toBe('[LT] LRM 15 Smoke (0/1)');

        await component.consumeSelectedHeatAndAmmo();

        expect(dialogsService.showError).toHaveBeenCalledWith('LRM 15 has no available ammo.', 'No Ammo');
        expect(fragBin.consumed).toBe(5);
    });

    it('starts selected heat projection from existing pending heat', async () => {
        const standardAmmo = ammo('ATM 6 Standard', 'ATM', 6, ['M_STANDARD']);
        const atm = entry({
            id: 'atm',
            equipment: weapon('ATM 6', 'ATM', 6),
            el: svgEntry('<g><g class="name"><text>ATM 6</text></g><text class="heat">4</text><text class="range_short">5</text></g>')
        });
        const ammoBin = entry({ id: 'std-ammo', equipment: standardAmmo, totalAmmo: 5, consumed: 1, locations: new Set(['CT']) });
        const equipmentMap: EquipmentMap = { [standardAmmo.internalName]: standardAmmo };
        const { component, fixture, unit, heat } = createComponent([atm, ammoBin], equipmentMap, [], new Map(), { heatDissipation: 3, heatNext: 8 });
        const row = component.groups().find(group => group.id === 'ranged')!.rows[0];

        component.toggleSelected(row);
        fixture.detectChanges();

        expect(component.selectedHeatProjection()).toEqual(jasmine.objectContaining({
            current: 8,
            selection: 4,
            dissipation: 3,
            final: 9,
            pendingWidth: 40
        }));

        await component.consumeSelectedHeatAndAmmo();

        expect(unit.setHeat).toHaveBeenCalledWith(12);
        expect(heat.next).toBe(12);
    });

    it('fills projected heat bar when final heat reaches the heat scale cap', () => {
        const standardAmmo = ammo('ATM 6 Standard', 'ATM', 6, ['M_STANDARD']);
        const atm = entry({
            id: 'atm',
            equipment: weapon('ATM 6', 'ATM', 6),
            el: svgEntry('<g><g class="name"><text>ATM 6</text></g><text class="heat">4</text><text class="range_short">5</text></g>')
        });
        const ammoBin = entry({ id: 'std-ammo', equipment: standardAmmo, totalAmmo: 5, consumed: 1, locations: new Set(['CT']) });
        const equipmentMap: EquipmentMap = { [standardAmmo.internalName]: standardAmmo };
        const { component, fixture } = createComponent([atm, ammoBin], equipmentMap, [], new Map(), { heatDissipation: 3, heatNext: 29 });
        const row = component.groups().find(group => group.id === 'ranged')!.rows[0];

        component.toggleSelected(row);
        fixture.detectChanges();

        expect(component.selectedHeatProjection()?.final).toBe(30);
        expect(component.selectedHeatProjection()?.retainedWidth).toBe(100);
    });

    it('blocks heat and ammo consumption when a selected weapon has no ammo', async () => {
        const atm = entry({
            id: 'atm',
            equipment: weapon('ATM 6', 'ATM', 6),
            el: svgEntry('<g><g class="name"><text>ATM 6</text></g><text class="heat">4</text><text class="range_short">5</text></g>')
        });
        const { component, dialogsService, unit } = createComponent([atm]);
        const row = component.groups().find(group => group.id === 'ranged')!.rows[0];

        component.toggleSelected(row);
        await component.consumeSelectedHeatAndAmmo();

        expect(dialogsService.showError).toHaveBeenCalledWith('ATM 6 has no available ammo.', 'No Ammo');
        expect(unit.setHeat).not.toHaveBeenCalled();
    });

    it('blocks heat and ammo consumption when a shared selected bin is short', async () => {
        const standardAmmo = ammo('ATM 6 Standard', 'ATM', 6, ['M_STANDARD']);
        const first = entry({
            id: 'first-atm',
            equipment: weapon('ATM 6', 'ATM', 6),
            el: svgEntry('<g><g class="name"><text>ATM 6</text></g><text class="heat">4</text><text class="range_short">5</text></g>')
        });
        const second = entry({
            id: 'second-atm',
            equipment: weapon('ATM 6', 'ATM', 6),
            el: svgEntry('<g><g class="name"><text>ATM 6</text></g><text class="heat">3</text><text class="range_short">5</text></g>')
        });
        const ammoBin = entry({ id: 'std-ammo', equipment: standardAmmo, totalAmmo: 5, consumed: 4, locations: new Set(['CT']) });
        const equipmentMap: EquipmentMap = { [standardAmmo.internalName]: standardAmmo };
        const { component, dialogsService, unit } = createComponent([first, second, ammoBin], equipmentMap);
        const rows = component.groups().find(group => group.id === 'ranged')!.rows;

        component.toggleSelected(rows[0]);
        component.toggleSelected(rows[1]);
        await component.consumeSelectedHeatAndAmmo();

        expect(dialogsService.showError).toHaveBeenCalledWith('ATM 6 Standard (1/5) does not have enough ammo for the selected weapons.', 'Not Enough Ammo');
        expect(ammoBin.consumed).toBe(4);
        expect(unit.setHeat).not.toHaveBeenCalled();
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
        expect(component.rowTracksAmmo(row)).toBeTrue();
        expect(component.rowHasAmmo(row)).toBeFalse();
        expect(component.ammoText(row)).toBe('');
        expect(component.ammoDepleted(row)).toBeTrue();
        component.selectAmmoOption(row, row.ammo.options[0].id);
        expect(component.selectedAmmoOption(row)).toBe(row.ammo.options[0].id);

        await component.handleChoice(row, { ...component.modeChoice(row)!, value: 'High Explosive', label: 'HE' });
        row = component.groups().find(group => group.id === 'ranged')!.rows[0];
        expect(component.rowTracksAmmo(row)).toBeTrue();
        expect(component.rowHasAmmo(row)).toBeFalse();
        expect(component.ammoText(row)).toBe('');
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
        const { component, fixture } = createComponent([atm]);
        const row = component.groups().find(group => group.id === 'ranged')!.rows[0];

        expect(row.ammo.options).toEqual([]);
        expect(component.rowTracksAmmo(row)).toBeTrue();
        expect(component.rowHasAmmo(row)).toBeFalse();
        expect(component.ammoDepleted(row)).toBeTrue();
        expect(component.ammoText(row)).toBe('');
        fixture.detectChanges();
        expect((fixture.nativeElement.querySelector('.ammo-cell') as HTMLElement).textContent?.trim()).toBe('NO AMMO');
        expect(fixture.nativeElement.querySelectorAll('.ammo-stepper-button').length).toBe(0);
    });

    it('shows No ammo instead of a dropdown when all ammo choices are depleted', () => {
        const standardAmmo = ammo('ATM 6 Standard', 'ATM', 6, ['M_STANDARD']);
        const atm = entry({
            id: 'atm',
            equipment: weapon('ATM 6', 'ATM', 6),
            el: svgEntry('<g><g class="name"><text>ATM 6</text></g><g class="alternativeMode" mode="Standard"><g class="name"><text>Standard</text></g><g class="damage"><text>2/Msl</text></g><text class="range_short">5</text></g></g>')
        });
        const leftBin = entry({ id: 'left-ammo', equipment: standardAmmo, totalAmmo: 10, consumed: 10, locations: new Set(['LT']) });
        const rightBin = entry({ id: 'right-ammo', equipment: standardAmmo, totalAmmo: 10, consumed: 10, locations: new Set(['RT']) });
        const equipmentMap: EquipmentMap = { [standardAmmo.internalName]: standardAmmo };
        const { component, fixture } = createComponent([atm, leftBin, rightBin], equipmentMap);
        const row = component.groups().find(group => group.id === 'ranged')!.rows[0];

        expect(row.ammo.options.map(option => ({ remaining: option.remaining, destroyed: option.destroyed }))).toEqual([
            { remaining: 0, destroyed: false },
            { remaining: 0, destroyed: false }
        ]);
        expect(component.showAmmoDropdown(row)).toBeFalse();
        expect(component.rowTracksAmmo(row)).toBeTrue();
        expect(component.rowHasAmmo(row)).toBeFalse();
        expect(component.ammoText(row)).toBe('');
        expect(component.ammoDepleted(row)).toBeTrue();
        expect(component.ammoDestroyed(row)).toBeFalse();
        fixture.detectChanges();
        expect((fixture.nativeElement.querySelector('.ammo-cell') as HTMLElement).textContent?.trim()).toBe('NO AMMO');
        expect(fixture.nativeElement.querySelectorAll('.ammo-stepper-button').length).toBe(0);
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
        const { component, fixture } = createComponent([atm, leftBin, rightBin], equipmentMap);
        const row = component.groups().find(group => group.id === 'ranged')!.rows[0];

        expect(row.ammo.options.map(option => ({ remaining: option.remaining, destroyed: option.destroyed }))).toEqual([
            { remaining: 0, destroyed: true },
            { remaining: 0, destroyed: true }
        ]);
        expect(component.showAmmoDropdown(row)).toBeFalse();
        expect(component.rowTracksAmmo(row)).toBeTrue();
        expect(component.rowHasAmmo(row)).toBeFalse();
        expect(component.ammoText(row)).toBe('');
        expect(component.ammoDepleted(row)).toBeTrue();
        expect(component.ammoDestroyed(row)).toBeFalse();
        fixture.detectChanges();
        expect((fixture.nativeElement.querySelector('.ammo-cell') as HTMLElement).textContent?.trim()).toBe('NO AMMO');
        expect(fixture.nativeElement.querySelectorAll('.ammo-stepper-button').length).toBe(0);
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