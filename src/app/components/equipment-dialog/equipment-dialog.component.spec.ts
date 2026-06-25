import { DialogRef, DIALOG_DATA } from '@angular/cdk/dialog';
import { TestBed } from '@angular/core/testing';
import { Subject } from 'rxjs';

import { WeaponEquipment } from '../../models/equipment.model';
import type { CBTForceUnit } from '../../models/cbt-force-unit.model';
import { MountedEquipment } from '../../models/force-serialization';
import { CBTInventoryControlRuntime } from '../../models/cbt-inventory-control-runtime.model';
import { KeyboardShortcutService } from '../../services/keyboard-shortcut.service';
import { OverlayManagerService } from '../../services/overlay-manager.service';
import { EquipmentDialogComponent } from './equipment-dialog.component';
import type { EquipmentDialogContext, EquipmentDialogData } from './equipment-dialog.model';

function addRuntimeSelection(unit: CBTForceUnit): CBTForceUnit {
    const runtime = new CBTInventoryControlRuntime(unit);

    Object.assign(unit, {
        inventoryControl: runtime,
        getInventoryControlSnapshot: () => runtime.getSnapshot(),
        getInventoryControlTargets: () => runtime.getTargets(),
        getInventoryControlTarget: (targetId: string) => runtime.getTarget(targetId),
        getInventoryControlEntryTargetId: (entryId: string) => runtime.getEntryTargetId(entryId),
        isInventoryControlEntrySelected: (entryId: string) => runtime.isEntrySelected(entryId),
        getInventoryControlEntryRange: (entryId: string) => runtime.getEntryRange(entryId),
        getInventoryControlEntryAmmoOption: (entryId: string) => runtime.getEntryAmmoOption(entryId),
        setInventoryControlEntrySelected: (entry: MountedEquipment, selected: boolean) => runtime.setEntrySelected(entry, selected),
        setInventoryControlEntryRange: (entry: MountedEquipment, range: 'short' | 'medium' | 'long' | null) => runtime.setEntryRange(entry, range),
        toggleInventoryControlEntryRange: (entry: MountedEquipment, range: 'short' | 'medium' | 'long', forceSelected = false) => runtime.toggleEntryRange(entry, range, forceSelected),
        setInventoryControlEntryAmmoOption: (entryId: string, optionId: string) => runtime.setEntryAmmoOption(entryId, optionId),
        setInventoryControlEntryTarget: (entry: MountedEquipment, targetId: string | null) => runtime.setEntryTarget(entry, targetId),
        createInventoryControlTarget: () => runtime.createTarget(),
        updateInventoryControlTarget: (targetId: string, patch: any) => runtime.updateTarget(targetId, patch),
        deleteInventoryControlTarget: (targetId: string) => runtime.deleteTarget(targetId),
        resetInventoryControlTargets: () => runtime.resetTargets(),
        clearInventoryControlSelection: () => runtime.clearSelection(),
        syncInventoryControlSelectionSvg: () => runtime.syncSelectionSvg()
    });
    return unit;
}

function weaponEntry(id: string): MountedEquipment {
    const wrapper = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    wrapper.innerHTML = '<g><g class="name"><text>Laser</text></g><text class="heat">4</text><text class="range_short">3</text><text class="range_medium">6</text><text class="range_long">9</text></g>';
    const el = wrapper.firstElementChild as SVGElement;
    el.classList.add('inventoryEntry');
    const equipment = new WeaponEquipment({
        id,
        name: id,
        type: 'weapon',
        weapon: { ammoType: 'NA', ranges: [3, 6, 9, 12] }
    });
    return new MountedEquipment({
        id,
        name: id,
        equipment,
        destroyed: false,
        physical: false,
        states: new Map<string, string>(),
        linkedWith: null,
        el,
        owner: undefined as any
    });
}

function createUnit(id: string, entries: MountedEquipment[] = []): CBTForceUnit {
    const heat = { current: 2, previous: 1, next: undefined as number | undefined };
    const unit = addRuntimeSelection({
        id,
        getInventory: () => entries,
        getCritSlots: () => [],
        getUnit: () => ({ chassis: id, model: 'Model', comp: [] }),
        getHeat: () => heat,
        setHeat: jasmine.createSpy('setHeat').and.callFake((value: number) => heat.next = value),
        gunnerySkill: () => 4,
        pilotingSkill: () => 5,
        turnState: () => ({
            moveMode: () => null,
            airborne: () => false,
            getAttackMovementModifier: () => 0,
            missingAttackMovementModifier: () => false,
            getSpottingModifier: () => 0,
            dirty: () => false,
            autoFall: () => false,
            PSRRollsCount: () => 0,
            currentPhase: () => ''
        }),
        readOnly: () => false,
        hasDirectInventory: () => true,
        setInventoryEntry: jasmine.createSpy('setInventoryEntry'),
        setCritSlot: jasmine.createSpy('setCritSlot'),
        rules: {
            heatDissipation: () => ({
                totalPips: 10,
                healthyPips: 10,
                damagedCount: 0,
                heatsinksOff: 0,
                totalDissipation: 0
            })
        }
    } as unknown as CBTForceUnit);
    entries.forEach(entry => entry.owner = unit);
    return unit;
}

function createDialog(data: EquipmentDialogData) {
    const dialogRef = { close: jasmine.createSpy('close') };
    const shortcutService = { register: jasmine.createSpy('register') };
    const overlayManager = {
        has: jasmine.createSpy('has').and.returnValue(false),
        closeManagedOverlay: jasmine.createSpy('closeManagedOverlay'),
        createManagedOverlay: jasmine.createSpy('createManagedOverlay'),
        repositionAll: jasmine.createSpy('repositionAll'),
        blockCloseUntil: jasmine.createSpy('blockCloseUntil'),
        unblockClose: jasmine.createSpy('unblockClose')
    };

    TestBed.configureTestingModule({
        imports: [EquipmentDialogComponent],
        providers: [
            { provide: DIALOG_DATA, useValue: data },
            { provide: DialogRef, useValue: dialogRef },
            { provide: KeyboardShortcutService, useValue: shortcutService },
            { provide: OverlayManagerService, useValue: overlayManager },
        ],
    });
    const fixture = TestBed.createComponent(EquipmentDialogComponent);
    fixture.detectChanges();
    return { fixture, component: fixture.componentInstance, dialogRef, shortcutService, overlayManager };
}

function createContext(): EquipmentDialogContext {
    return {
        toastService: { showToast: jasmine.createSpy('showToast') },
        dialogsService: { showNoticeHtml: jasmine.createSpy('showNoticeHtml').and.resolveTo(), showError: jasmine.createSpy('showError').and.resolveTo() },
        dataService: { getEquipments: () => ({}) },
        registry: { getChoices: () => [], handleSelection: () => false }
    } as unknown as EquipmentDialogContext;
}

describe('EquipmentDialogComponent', () => {
    it('opens directly to the requested tab', () => {
        const unit = createUnit('unit-a');
        const { fixture, component } = createDialog({ unit, context: createContext(), initialTab: 'ammo' });

        expect(component.activeTab()).toBe('ammo');
        expect(fixture.nativeElement.querySelector('ammo-loadout-panel')).not.toBeNull();
        expect(fixture.nativeElement.querySelector('weapons-equipment-panel')).toBeNull();
    });

    it('navigates units and notifies the selected unit change', () => {
        const first = createUnit('unit-a');
        const second = createUnit('unit-b');
        const onUnitChange = jasmine.createSpy('onUnitChange');
        const { component } = createDialog({ unitList: [first, second], unitIndex: 0, onUnitChange, context: createContext() });
        onUnitChange.calls.reset();

        component.onNext();

        expect(component.unit()).toBe(second);
        expect(onUnitChange).toHaveBeenCalledOnceWith(second, 1);
    });

    it('registers left and right arrow shortcuts for unit navigation', () => {
        const first = createUnit('unit-a');
        const second = createUnit('unit-b');
        const { component, shortcutService } = createDialog({ unitList: [first, second], context: createContext() });
        const registration = shortcutService.register.calls.mostRecent().args[0];

        expect(registration.handle(new KeyboardEvent('keydown', { key: 'ArrowRight' }))).toBeTrue();
        expect(component.unit()).toBe(second);
        expect(registration.handle(new KeyboardEvent('keydown', { key: 'ArrowLeft' }))).toBeTrue();
        expect(component.unit()).toBe(first);
        expect(registration.handle(new KeyboardEvent('keydown', { key: 'ArrowRight', ctrlKey: true }))).toBeFalse();
    });

    it('renders selected weapon actions beside dismiss in the dialog footer', () => {
        const laser = weaponEntry('laser');
        const unit = createUnit('unit-a', [laser]);
        const { fixture, component } = createDialog({ unit, context: createContext() });
        const panel = component.currentWeaponsPanel()!;
        const row = panel.groups().find(group => group.id === 'ranged')!.rows[0];

        panel.toggleSelected(row);
        fixture.detectChanges();

        const footerCenter = fixture.nativeElement.querySelector('.equipment-dialog-footer-center') as HTMLElement;
        expect(footerCenter.textContent).toContain('FIRE');
        expect(footerCenter.textContent).toContain('DISMISS');
        expect(footerCenter.querySelector('button[aria-label="Reset"]')).not.toBeNull();
    });
});