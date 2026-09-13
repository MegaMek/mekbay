// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
import { signal } from '@angular/core';
import { ToastService } from '../services/toast.service';
import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { Dialog, DialogRef } from '@angular/cdk/dialog';
import { CdkVirtualScrollViewport } from '@angular/cdk/scrolling';
import { By } from '@angular/platform-browser';
import { UnitConstructionComponent } from './unit-construction.component';
import { ConstructionForceService, type ConstructionDamageProjection } from './construction-force.service';
import { createConstructionEntity, installConstructionEquipment } from './domain';
import { setConstructionBuildingTopology } from './domain/construction-building-topology';
import { ConstructionTopologyComponent } from './components/construction-topology.component';
import { StaticEmplacementEntity } from '../models/entity/entities/misc/static-emplacement-entity';
import { buildingLocationName } from '../models/entity/types/building';
import { createTestEquipmentRegistry } from '../models/entity/testing/test-equipment-registry';
import { parseEntity } from '../models/entity/parse-entity';
import { ArmorEquipment, type Equipment, MiscEquipment, WeaponEquipment } from '../models/equipment.model';
import { MountedArmor, MountedEngine, MountedStructure, STANDARD_STRUCTURE_EQUIPMENT } from '../models/entity/components';
import { MekEntity } from '../models/entity/entities';
import { EquipmentCatalogService } from '../services/catalogs/equipment-catalog.service';
import { CustomUnitsService } from '../services/custom-units.service';
import { DataService } from '../services/data.service';
import { DialogsService } from '../services/dialogs.service';
import { LayoutService } from '../services/layout.service';
import { OptionsService } from '../services/options.service';
import { NativeEntityService } from '../services/native-entity.service';
import { UnitNameService } from '../services/unit-name.service';
import { formatUnitChassis } from '../utils/unit-display-name.util';
import { UnitSearchIndexService } from '../services/unit-search-index.service';
import type { UnitSummary } from '../models/unit-summary.model';
import { StatBarSpecsPipe } from '../pipes/stat-bar-specs.pipe';

describe('construction equipment warehouse', () => {
    const tech = { base: 'All', level: 'Standard', advancement: { is: { common: '2500' }, clan: { common: '2500' } } } as const;
    const weapons = Array.from({ length: 220 }, (_, index) => new WeaponEquipment({
        id: `Warehouse laser ${String(index).padStart(3, '0')}`, name: `Warehouse laser ${String(index).padStart(3, '0')}`,
        type: 'weapon', tech, flags: ['F_MEK_WEAPON', 'F_ENERGY'], stats: { tonnage: 1, criticalSlots: 1 },
    }));
    const autocannon = new WeaponEquipment({ id: 'Warehouse AC/10', name: 'Warehouse AC/10', type: 'weapon', tech,
        flags: ['F_MEK_WEAPON', 'F_BALLISTIC'], stats: { tonnage: 12, criticalSlots: 7, bv: 123 },
        weapon: { damage: 10, heat: 3, minRange: 4, ranges: [7, 14, 21, 28] } });
    const tankEquipment = new MiscEquipment({ id: 'Tank equipment', name: 'Tank equipment', type: 'misc', tech,
        flags: ['F_TANK_EQUIPMENT'], stats: { tonnage: 1, criticalSlots: 1 } });
    const buildingLaser = new WeaponEquipment({ id: 'Building laser', name: 'Building laser', type: 'weapon', tech,
        flags: ['F_TANK_WEAPON', 'F_ENERGY'], stats: { tonnage: 1, criticalSlots: 1 } });
    const jumpJet = new MiscEquipment({ id: 'Jump jet', name: 'Jump jet', type: 'misc', tech,
        flags: ['F_MEK_EQUIPMENT', 'F_JUMP_JET'], stats: { tonnage: 0.5, criticalSlots: 1 } });
    const retained = new MiscEquipment({ id: 'Retained technology', name: 'Retained technology', type: 'misc',
        tech: { base: 'IS', level: 'Standard', advancement: { is: { common: '2700', extinct: '2800' } } },
        flags: ['F_MEK_EQUIPMENT'], stats: { tonnage: 1, criticalSlots: 20 } });
    const future = new MiscEquipment({ id: 'Future technology', name: 'Future technology', type: 'misc',
        tech: { base: 'IS', level: 'Standard', advancement: { is: { common: '3200' } } },
        flags: ['F_MEK_EQUIPMENT'], stats: { tonnage: 1, criticalSlots: 1 } });
    const clan = new MiscEquipment({ id: 'Clan technology', name: 'Clan technology', type: 'misc',
        tech: { base: 'Clan', level: 'Standard', advancement: { clan: { common: '2500' } } },
        flags: ['F_MEK_EQUIPMENT'], stats: { tonnage: 1, criticalSlots: 1 } });
    const experimental = new MiscEquipment({ id: 'Experimental technology', name: 'Experimental technology', type: 'misc',
        tech: { base: 'IS', level: 'Experimental', advancement: { is: { prototype: '2500' } } },
        flags: ['F_MEK_EQUIPMENT'], stats: { tonnage: 1, criticalSlots: 1 } });
    const sortAlpha = new WeaponEquipment({ id: 'Warehouse sort Alpha', name: 'Warehouse sort Alpha', type: 'weapon', tech,
        flags: ['F_MEK_WEAPON', 'F_ENERGY'], stats: { criticalSlots: 10, tonnage: 12, bv: 110 },
        weapon: { damage: 10, minRange: 4, ranges: [7, 14, 21, 24] } });
    const sortBeta = new WeaponEquipment({ id: 'Warehouse sort Beta', name: 'Warehouse sort Beta', type: 'weapon', tech,
        flags: ['F_MEK_WEAPON', 'F_ENERGY'], stats: { criticalSlots: 2, tonnage: 2, bv: 22 },
        weapon: { damage: 2, ranges: [3, 6, 9, 30] } });
    const sortGamma = new WeaponEquipment({ id: 'Warehouse sort Gamma', name: 'Warehouse sort Gamma', type: 'weapon', tech,
        flags: ['F_MEK_WEAPON', 'F_ENERGY'], stats: { criticalSlots: 2, tonnage: 0.5, bv: 50 },
        weapon: { damage: [5, 3, 2], ranges: [4, 8, 12, 16] } });
    const sortVariable = new MiscEquipment({ id: 'Warehouse sort Variable', name: 'Warehouse sort Variable', type: 'misc', tech,
        flags: ['F_MEK_EQUIPMENT'], stats: { criticalSlots: 'variable', tonnage: 'variable', bv: 'variable' } });
    const sortEquipment = [sortAlpha, sortBeta, sortGamma, sortVariable];
    const isTargetingComputer = new MiscEquipment({ id: 'Warehouse mass IS targeting computer', name: 'Warehouse mass IS targeting computer', type: 'misc',
        tech: { ...tech, base: 'IS' }, flags: ['F_MEK_EQUIPMENT', 'F_TARGETING_COMPUTER'], stats: { tonnage: 'variable', criticalSlots: 'variable' } });
    const clanTargetingComputer = new MiscEquipment({ id: 'Warehouse mass Clan targeting computer', name: 'Warehouse mass Clan targeting computer', type: 'misc',
        tech: { ...tech, base: 'Clan' }, flags: ['F_MEK_EQUIPMENT', 'F_TARGETING_COMPUTER'], stats: { tonnage: 'variable', criticalSlots: 'variable' } });
    const variableJet = new MiscEquipment({ id: 'Warehouse mass Thruster', name: 'Warehouse mass Thruster', type: 'misc', tech,
        flags: ['F_MEK_EQUIPMENT', 'F_JUMP_JET'], stats: { tonnage: 'variable', criticalSlots: 1 } });
    const massEquipment = [isTargetingComputer, clanTargetingComputer, variableJet];
    const registry = createTestEquipmentRegistry(Object.fromEntries([...weapons, ...sortEquipment, ...massEquipment, autocannon, tankEquipment, buildingLaser, jumpJet, retained, future, clan, experimental].map(eq => [eq.id, eq])));
    let fixture: ComponentFixture<UnitConstructionComponent>;
    let editor: UnitConstructionComponent;

    beforeEach(() => {
        TestBed.configureTestingModule({ providers: [
            { provide: ToastService, useValue: { showToast: jasmine.createSpy('showToast') } },
            { provide: DialogRef, useValue: { close: () => {} } },
            { provide: Dialog, useValue: { openDialogs: [] } },
            { provide: LayoutService, useValue: { windowWidth: signal(1440) } },
            { provide: EquipmentCatalogService, useValue: { getEquipmentRegistry: () => registry } },
            { provide: CustomUnitsService, useValue: { summaries: signal([]),
                parseDraft: (source: string, format: string) => parseEntity(source, `draft.${format}`, registry).entity } },
            { provide: DataService, useValue: { getUnitByUuid: () => undefined, searchCorpusVersion: signal(0) } },
            { provide: DialogsService, useValue: {} },
            { provide: NativeEntityService, useValue: {} },
            { provide: UnitNameService, useValue: { chassis: formatUnitChassis, name: (unit: UnitSummary) => unit.name } },
            { provide: UnitSearchIndexService, useValue: new UnitSearchIndexService() },
            { provide: ConstructionForceService, useValue: { damage: () => null } },
        ] });
        fixture = TestBed.createComponent(UnitConstructionComponent);
        editor = fixture.componentInstance;
        Object.assign(fixture.nativeElement.style, { height: '1000px', width: '1440px' });
    });

    async function renderWarehouse(): Promise<void> {
        fixture.detectChanges();
        await fixture.whenStable();
        const viewport = fixture.debugElement.query(By.directive(CdkVirtualScrollViewport)).componentInstance as CdkVirtualScrollViewport;
        viewport.checkViewportSize();
        // CDK processes native scroll events on the animation-frame scheduler.
        await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
        fixture.detectChanges();
        await fixture.whenStable();
    }

    it('keeps the family filter active when the destination filter is off and follows the current unit', () => {
        editor.filterByLocation.set(false);
        expect(editor.filteredEquipment()).toContain(weapons[0]);
        expect(editor.filteredEquipment()).not.toContain(tankEquipment);
        editor.entity.set(createConstructionEntity('Tank', registry));
        expect(editor.filteredEquipment()).toContain(tankEquipment);
        expect(editor.filteredEquipment()).not.toContain(weapons[0]);
    });

    it('can show incompatible equipment while keeping search and category filters active', () => {
        editor.showIncompatibleEquipment.set(true);
        editor.query.set('Tank equipment');
        expect(editor.filteredEquipment()).toEqual([tankEquipment]);
        editor.filterByLocation.set(true);
        editor.selectedLocation.set('RA');
        expect(editor.filteredEquipment()).toEqual([tankEquipment]);
        editor.category.set('energy');
        expect(editor.filteredEquipment()).toEqual([]);
        editor.category.set('misc');
        editor.showIncompatibleEquipment.set(false);
        expect(editor.filteredEquipment()).toEqual([]);
    });

    it('marks the chosen warehouse item and cancels placement with Escape in the inspector or workspace', async () => {
        Object.assign(TestBed.inject(Dialog), { openDialogs: [TestBed.inject(DialogRef)] });
        editor.query.set(sortBeta.name);
        await renderWarehouse();
        const root = fixture.nativeElement as HTMLElement;
        const source = root.querySelector<HTMLButtonElement>('.warehouse-equipment')!;
        const before = editor.entity().equipment().length;
        for (const cancel of ['inspector', 'workspace']) {
            source.click();
            fixture.detectChanges();
            await fixture.whenStable();
            expect(source.getAttribute('aria-pressed')).toBe('true');
            expect(source.closest('.warehouse-item')?.classList.contains('selected')).toBeTrue();
            const slot = root.querySelector<HTMLButtonElement>('[data-location="RT"] .empty-slot')!;
            expect(slot.textContent).toContain('ADD HERE');
            expect(slot.getAttribute('aria-label')).toContain(sortBeta.name);
            if (cancel === 'inspector') {
                const event = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true });
                root.querySelector('.installed-inspector')!.dispatchEvent(event);
                expect(event.defaultPrevented).toBeTrue();
            } else {
                editor.closeInstalledInspector();
                fixture.detectChanges();
                document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
            }
            fixture.detectChanges();
            expect(editor.canPlaceSelectedEquipment()).toBeFalse();
            expect(editor.inspectorOpen()).toBeFalse();
            expect(source.getAttribute('aria-pressed')).toBe('false');
            expect(root.querySelector('.placement-ready')).toBeNull();
            expect(slot.textContent).toContain('EMPTY SLOT');
            expect(slot.disabled).toBeTrue();
            editor.clickSlot('RT');
            expect(editor.entity().equipment().length).toBe(before);
        }
    });

    it('cancels pending placement on outside clicks and right-click without consuming equipment', async () => {
        editor.query.set(sortBeta.name);
        await renderWarehouse();
        const root = fixture.nativeElement as HTMLElement;
        const source = root.querySelector<HTMLButtonElement>('.warehouse-equipment')!;
        const before = editor.entity().equipment().length;
        for (const action of ['outside', 'inspector-control', 'right-click-open', 'right-click-closed']) {
            source.click();
            fixture.detectChanges();
            if (action === 'outside' || action === 'right-click-closed') {
                root.querySelector<HTMLButtonElement>('.inspector-close')!.click();
                fixture.detectChanges();
                expect(editor.canPlaceSelectedEquipment()).toBeTrue();
                expect(source.getAttribute('aria-pressed')).toBe('true');
            }
            if (action.startsWith('right-click')) {
                const event = new MouseEvent('contextmenu', { bubbles: true, cancelable: true, button: 2 });
                root.querySelector('.empty-slot.placement-ready span')!.dispatchEvent(event);
                expect(event.defaultPrevented).toBeTrue();
                expect(editor.inspectorOpen()).toBeFalse();
            } else if (action === 'inspector-control') {
                root.querySelector<HTMLSelectElement>('[aria-label="Install equipment location"]')!.click();
                expect(editor.inspectorOpen()).toBeTrue();
                expect(editor.selectedEquipment()).toBe(sortBeta);
            } else {
                // A stopped bubble must not prevent outside-click cancellation.
                const outside = root.querySelector<HTMLElement>('.workshop-header')!;
                outside.addEventListener('click', event => event.stopPropagation(), { once: true });
                outside.click();
            }
            fixture.detectChanges();
            expect(editor.canPlaceSelectedEquipment()).withContext(action).toBeFalse();
            expect(source.getAttribute('aria-pressed')).toBe('false');
            expect(root.querySelector('.placement-ready')).toBeNull();
            expect(editor.entity().equipment().length).toBe(before);
        }
        const contextMenu = new MouseEvent('contextmenu', { bubbles: true, cancelable: true, button: 2 });
        root.dispatchEvent(contextMenu);
        expect(contextMenu.defaultPrevented).toBeFalse();
    });

    it('keeps placement active through the mobile inspector close controls until ADD HERE consumes it', async () => {
        TestBed.inject(LayoutService).windowWidth.set(600);
        editor.query.set(sortBeta.name);
        const root = fixture.nativeElement as HTMLElement;
        for (const selector of ['.inspector-close', '.inspector-place', '.installed-inspector-backdrop']) {
            editor.equipmentDrawerOpen.set(true);
            await renderWarehouse();
            const source = root.querySelector<HTMLButtonElement>('.warehouse-equipment')!;
            source.click();
            fixture.detectChanges();
            root.querySelector<HTMLElement>(selector)!.click();
            fixture.detectChanges();
            expect(editor.inspectorOpen()).toBeFalse();
            expect(editor.canPlaceSelectedEquipment()).withContext(selector).toBeTrue();
        }
        root.querySelector<HTMLElement>('[data-location="RT"] .empty-slot.placement-ready span')!.click();
        fixture.detectChanges();
        expect(editor.selectedMount()?.equipmentId).toBe(sortBeta.id);
        expect(editor.selectedMount()?.location).toBe('RT');
        expect(editor.canPlaceSelectedEquipment()).toBeFalse();
        expect(root.querySelector('.placement-ready')).toBeNull();
    });

    it('keeps hover inspection separate from the equipment chosen for slot placement', async () => {
        editor.query.set('Warehouse sort');
        await renderWarehouse();
        const root = fixture.nativeElement as HTMLElement;
        const source = (eq: Equipment) => root.querySelector<HTMLButtonElement>(`.warehouse-equipment[aria-label="${eq.name}"]`)!;
        editor.inspectEquipment(sortAlpha, source(sortAlpha), true);
        fixture.detectChanges();
        expect(editor.canPlaceSelectedEquipment()).toBeFalse();
        expect(root.querySelector('.placement-ready')).toBeNull();
        source(sortBeta).click();
        editor.closeInstalledInspector();
        editor.inspectEquipment(sortGamma, source(sortGamma), true);
        fixture.detectChanges();
        expect(editor.selectedEquipment()).toBe(sortGamma);
        expect(source(sortBeta).getAttribute('aria-pressed')).toBe('true');
        expect(source(sortGamma).getAttribute('aria-pressed')).toBe('false');
        root.querySelector<HTMLButtonElement>('[data-location="RT"] .empty-slot')!.click();
        fixture.detectChanges();
        expect(editor.selectedMount()?.equipmentId).toBe(sortBeta.id);
        expect(editor.selectedMount()?.location).toBe('RT');
        expect(editor.canPlaceSelectedEquipment()).toBeFalse();
        expect(root.querySelector('.placement-ready')).toBeNull();
    });

    it('preserves the optional destination filter without conflating it with the unit family', () => {
        editor.query.set('Jump jet');
        for (const showIncompatible of [false, true]) {
            editor.showIncompatibleEquipment.set(showIncompatible);
            editor.filterByLocation.set(false);
            editor.selectedLocation.set('RA');
            expect(editor.filteredEquipment()).toEqual([jumpJet]);
            editor.filterByLocation.set(true);
            expect(editor.filteredEquipment()).toEqual([]);
            editor.selectedLocation.set('RT');
            expect(editor.filteredEquipment()).toEqual([jumpJet]);
        }
    });

    it('combines eligibility and physical-fit filters without relaxing installation rules', () => {
        editor.query.set('technology');
        editor.selectedLocation.set('RA');
        editor.entity().year.set(3000);
        editor.entity().originalBuildYear.set(2600);
        const combinations = [
            { show: false, fit: false, expected: [retained] },
            { show: true, fit: false, expected: [clan, experimental, future, retained] },
            { show: false, fit: true, expected: [] },
            { show: true, fit: true, expected: [clan, experimental, future] },
        ];
        for (const { show, fit, expected } of combinations) {
            editor.showIncompatibleEquipment.set(show);
            editor.filterByLocation.set(fit);
            expect(editor.filteredEquipment()).withContext(`show incompatible: ${show}, fits in: ${fit}`).toEqual(expected);
        }
        expect(() => installConstructionEquipment(editor.entity(), future, 'RA')).toThrowError(/Not available/);
    });

    it('keeps location filtering off by default and exposes its disabled dropdown below the search disclosure', async () => {
        fixture.detectChanges();
        await fixture.whenStable();
        const root = fixture.nativeElement as HTMLElement;
        expect(editor.filterByLocation()).toBeFalse();
        expect(root.querySelector('.warehouse-filters')).toBeNull();
        const toggle = root.querySelector<HTMLButtonElement>('[aria-controls="construction-equipment-filters"]')!;
        expect(toggle.parentElement?.querySelector('[aria-label="Search equipment"]')).not.toBeNull();
        expect(toggle.getAttribute('aria-expanded')).toBe('false');
        toggle.click(); fixture.detectChanges();
        await fixture.whenStable();
        const filters = root.querySelector('.warehouse-filters')!;
        const location = filters.querySelector<HTMLSelectElement>('select')!;
        expect(location.disabled).toBeTrue();
        expect(root.querySelector('.warehouse-search-row')?.nextElementSibling).toBe(filters);
        const checkbox = filters.querySelector<HTMLInputElement>('input')!;
        checkbox.click(); fixture.detectChanges();
        await fixture.whenStable();
        expect(location.disabled).toBeFalse();
        expect(checkbox.getBoundingClientRect().top + checkbox.offsetHeight / 2)
            .toBeCloseTo(location.getBoundingClientRect().top + location.offsetHeight / 2, 0);
        root.querySelector<HTMLInputElement>('.warehouse-heading .warehouse-platform-filter input')!.click(); fixture.detectChanges();
        await fixture.whenStable();
        expect(checkbox.disabled).toBeFalse();
        expect(checkbox.checked).toBeTrue();
        expect(location.disabled).toBeFalse();
        expect(toggle.classList.contains('active')).toBeTrue();
        checkbox.click(); fixture.detectChanges(); await fixture.whenStable();
        expect(location.disabled).toBeTrue();
        expect(editor.showIncompatibleEquipment()).toBeTrue();
    });

    it('filters date, technology and rules level without filtering free slots, including retained OEM technology', () => {
        editor.query.set('technology');
        editor.entity().year.set(3000);
        expect(editor.filteredEquipment()).toEqual([]);
        editor.entity().originalBuildYear.set(2600);
        // Both end years are unavailable; the legal interval is inside the OEM-to-introduction range.
        expect(editor.filteredEquipment()).toEqual([retained]);
        editor.entity().mixedTech.set(true);
        expect(editor.filteredEquipment()).toContain(clan);
        editor.entity().rulesLevel.set(4);
        expect(editor.filteredEquipment()).toContain(experimental);
        expect(editor.filteredEquipment()).not.toContain(future);
        editor.filterByLocation.set(true);
        expect(editor.filteredEquipment()).not.toContain(retained);
        editor.showIncompatibleEquipment.set(true);
        expect(editor.filteredEquipment()).toContain(future);
    });

    it('renders the repair delta, effective/pristine BV and pending costs on their respective single lines', async () => {
        spyOn(editor, 'unitBV').and.returnValue(1730);
        const effectiveBV = spyOn(editor, 'effectiveBV').and.returnValue(750);
        spyOn(editor, 'repairBVDelta').and.returnValue(250);
        spyOn(editor, 'unitCost').and.returnValue(1000);
        spyOn(editor, 'pendingRepairQuote').and.returnValue({ cost: 20, basis: 'Repair', spCost: 55, spBasis: 'SP' });
        spyOn(editor, 'pendingSupportPoints').and.returnValue({ cost: 55, basis: 'SP' });
        fixture.detectChanges();
        await fixture.whenStable();
        const root = fixture.nativeElement as HTMLElement;
        const line = root.querySelector<HTMLElement>('.bv-line')!;
        expect(line.textContent!.replace(/\s/g, '')).toBe('(+250)750/1,730BV');
        expect(line.firstElementChild!.classList.contains('repair-gain')).toBeTrue();
        expect(line.querySelector('.pristine-bv')?.parentElement?.classList.contains('bv-total')).toBeTrue();
        const costs = root.querySelector<HTMLElement>('.cost-line')!;
        expect(costs.textContent!.replace(/\s/g, '')).toBe('1,000C-Bills(+20repair)·55SP');
        expect(getComputedStyle(costs).whiteSpace).toBe('nowrap');
        effectiveBV.and.returnValue(1730);
        fixture.detectChanges();
        expect(root.querySelector('.pristine-bv')).toBeNull();
    });

    it('shows aggregate intact points and only the staged repair gain on the defense bars', () => {
        editor.entity().armorValues.set(new Map([['HD', { front: 9, rear: 0 }], ['RA', { front: 10, rear: 0 }]]));
        const baseline = jasmine.createSpyObj<ConstructionDamageProjection>('baseline', ['armorDamage', 'internalDamage']);
        const preview = jasmine.createSpyObj<ConstructionDamageProjection>('preview', ['armorDamage', 'internalDamage']);
        baseline.armorDamage.and.callFake((location, face) => face === 'rear' ? 0 : location === 'HD' ? 5 : location === 'RA' ? 6 : 0);
        preview.armorDamage.and.callFake((location, face) => face !== 'rear' && location === 'RA' ? 3 : 0);
        baseline.internalDamage.and.callFake(location => location === 'LA' ? 3 : 0);
        preview.internalDamage.and.callFake(location => location === 'LA' ? 1 : 0);
        spyOn(editor, 'sourceDamage').and.returnValue(baseline);
        spyOn(editor, 'runtimeDamage').and.returnValue(preview);
        const internal = editor.entity().totalInternalPoints();
        spyOn(fixture.debugElement.injector.get(StatBarSpecsPipe), 'transform').and.returnValue([
            { label: 'Armor', value: 19, max: 100, percent: 19 },
            { label: 'Structure', value: internal, max: 100, percent: internal },
        ]);
        const [armor, structure] = editor.summaryStats();
        expect(armor.valueText).toBe('16 / 19');
        expect(armor.pendingRepair).toBe(8);
        expect(armor.repairStart).toBe(8);
        expect(armor.repairPercent).toBe(8);
        expect(structure.value).toBe(internal - 1);
        expect(structure.pendingRepair).toBe(2);
    });

    it('keeps incompatible installed choices visible and red without offering them elsewhere', async () => {
        const armor = new ArmorEquipment({ id: 'Future armor', name: 'Future armor', type: 'armor',
            tech: { base: 'All', level: 'Standard', advancement: { is: { common: '3200' }, clan: { common: '3200' } } },
            flags: ['F_MEK_EQUIPMENT'], armor: { type: 'STANDARD' } });
        const entity = editor.entity() as MekEntity;
        entity.setArmorAt('RA', new MountedArmor({ armor }));
        entity.gyroType.set('Superheavy');
        expect(editor.armorOptions('RA')).toContain(armor);
        expect(editor.armorOptions('LA')).not.toContain(armor);
        fixture.detectChanges(); await fixture.whenStable();
        const root = fixture.nativeElement as HTMLElement;
        const material = root.querySelector<HTMLSelectElement>('select[aria-label="Right Arm armor material"]')!;
        expect(material.value).toBe(armor.id);
        expect(material.classList.contains('danger')).toBeTrue();
        expect(material.selectedOptions[0].disabled).toBeTrue();
        expect(material.selectedOptions[0].textContent).toContain('(incompatible)');
        editor.panel.set('systems'); fixture.detectChanges(); await fixture.whenStable();
        const gyro = root.querySelector<HTMLSelectElement>('select[aria-label="Gyro"]')!;
        expect(gyro.classList.contains('danger')).toBeTrue();
        expect(gyro.selectedOptions[0].disabled).toBeTrue();
        root.querySelector<HTMLButtonElement>('.configuration-filter')!.click();
        fixture.detectChanges(); await fixture.whenStable();
        expect(editor.showIncompatibleEquipment()).toBeTrue();
        expect(editor.armorOptions('LA')).toContain(armor);
        expect(editor.materialInvalid(armor)).toBeTrue();
        expect(entity.armorAt('RA').armor).toBe(armor);
        expect(entity.gyroType()).toBe('Superheavy');
    });

    it('virtualizes the complete catalog with stable row heights and resets a scrolled search', async () => {
        editor.query.set('Warehouse laser');
        fixture.detectChanges();
        await fixture.whenStable();
        const viewport = fixture.debugElement.query(By.directive(CdkVirtualScrollViewport)).componentInstance as CdkVirtualScrollViewport;
        viewport.checkViewportSize();
        fixture.detectChanges();
        await fixture.whenStable();
        const rows = () => [...fixture.nativeElement.querySelectorAll('.warehouse-item')] as HTMLElement[];
        expect(rows().length).toBeGreaterThan(0);
        expect(rows().length).toBeLessThan(weapons.length);
        expect(rows().every(row => row.getBoundingClientRect().height === editor.equipmentRowHeight)).toBeTrue();
        viewport.scrollToIndex(180);
        await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
        fixture.detectChanges();
        await fixture.whenStable();
        expect(viewport.measureScrollOffset()).toBeGreaterThan(0);
        editor.query.set('Warehouse laser 005');
        fixture.detectChanges();
        await fixture.whenStable();
        expect(viewport.measureScrollOffset()).toBe(0);
        expect(rows().length).toBe(1);
        expect(rows()[0].textContent).toContain('Warehouse laser 005');
    });

    it('keeps its source row aligned when dragging equipment from the virtual viewport', async () => {
        editor.query.set('Warehouse laser 005');
        fixture.detectChanges();
        await fixture.whenStable();
        const viewport = fixture.debugElement.query(By.directive(CdkVirtualScrollViewport)).componentInstance as CdkVirtualScrollViewport;
        viewport.checkViewportSize();
        fixture.detectChanges();
        await fixture.whenStable();
        const root = fixture.nativeElement as HTMLElement;
        const item = root.querySelector<HTMLElement>('.warehouse-item')!;
        const rect = item.getBoundingClientRect();
        const x = rect.left + 10, y = rect.top + 10;
        const mouse = (target: EventTarget, type: string, clientX: number, clientY: number) => target.dispatchEvent(new MouseEvent(type, {
            bubbles: true, cancelable: true, view: window, detail: 1, buttons: type === 'mouseup' ? 0 : 1, button: 0, clientX, clientY,
        }));
        mouse(item.querySelector('.equipment-name')!, 'mousedown', x, y);
        mouse(document, 'mousemove', x + 15, y + 15);
        fixture.detectChanges();
        expect(editor.dragging()?.equipmentId).toBe('Warehouse laser 005');
        const placeholder = root.querySelector<HTMLElement>('.equipment-list .warehouse-placeholder');
        expect(placeholder).not.toBeNull();
        expect(placeholder?.getBoundingClientRect().height).toBe(editor.equipmentRowHeight);
        expect(getComputedStyle(root.querySelector('.equipment-list')!).overflowY).toBe('hidden');
        mouse(document, 'mouseup', x + 15, y + 15);
        await fixture.whenStable();
        fixture.detectChanges();
        expect(editor.dragging()).toBeNull();
        expect(root.querySelector('.warehouse-item')).not.toBeNull();
    });

    describe('building topology drops', () => {
        const destination = buildingLocationName({ q: 1, r: 0 }, 2);
        const mouse = (target: EventTarget, type: string, point: { x: number; y: number }) => target.dispatchEvent(new MouseEvent(type, {
            bubbles: true, cancelable: true, view: window, detail: 1, buttons: type === 'mouseup' ? 0 : 1,
            button: 0, clientX: point.x, clientY: point.y,
        }));
        const center = (element: Element) => {
            const rect = element.getBoundingClientRect();
            return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
        };
        async function createTopology(mode: 'top' | 'pancake' = 'top', equipment = buildingLaser) {
            const entity = createConstructionEntity('BuildingEntity', registry) as StaticEmplacementEntity;
            setConstructionBuildingTopology(entity, [{ q: 0, r: 0 }, { q: 1, r: 0 }], 3);
            editor.entity.set(entity);
            editor.panel.set('topology');
            editor.query.set(equipment.name);
            editor.showIncompatibleEquipment.set(true);
            const root = fixture.nativeElement as HTMLElement;
            Object.assign(root.style, { position: 'fixed', inset: '0', width: '100vw', height: '100vh' });
            await renderWarehouse();
            const topology = fixture.debugElement.query(By.directive(ConstructionTopologyComponent))
                .componentInstance as ConstructionTopologyComponent;
            topology.setViewMode(mode);
            if (mode === 'top') {
                topology.selectFloor(2);
                topology.zoom.set(150);
                topology.pan.set({ x: 10, y: -5 });
            }
            fixture.detectChanges();
            await fixture.whenStable();
            const hex = root.querySelector<SVGGElement>(`.hex-map [data-location="${destination}"]`)!;
            hex.scrollIntoView({ block: 'center', inline: 'nearest' });
            return { root, topology, hex };
        }
        async function beginDrag(root: HTMLElement, selector = '.warehouse-item .equipment-name') {
            const source = root.querySelector<HTMLElement>(selector)!;
            const point = center(source);
            mouse(source, 'mousedown', point);
            mouse(document, 'mousemove', { x: point.x + 15, y: point.y + 15 });
            fixture.detectChanges();
            await fixture.whenStable();
            expect(editor.dragging()).withContext(`${selector} drag started`).not.toBeNull();
        }
        function moveTo(element: Element) {
            const point = center(element);
            mouse(document, 'mousemove', point);
            fixture.detectChanges();
            return point;
        }
        async function release(point: { x: number; y: number }) {
            mouse(document, 'mouseup', point);
            await fixture.whenStable();
            fixture.detectChanges();
        }

        for (const mode of ['top', 'pancake'] as const) {
            it(`installs warehouse equipment on the dropped hex and floor in ${mode} view with undo and redo`, async () => {
                const { root, topology, hex } = await createTopology(mode);
                const sourceLocation = editor.selectedLocation();
                await beginDrag(root);
                const point = moveTo(hex);
                try {
                    expect(editor.dragTarget()?.location).toBe(destination);
                    expect(editor.selectedLocation()).toBe(sourceLocation);
                    expect(hex.classList.contains('drop-target')).toBeTrue();
                    expect(root.querySelector('.equipment-drop-hint')?.textContent).toContain('Release to place equipment');
                    expect(root.querySelector('.map-stage.cdk-drop-list-dragging')).not.toBeNull();
                } finally {
                    await release(point);
                }
                expect(TestBed.inject(ToastService).showToast).not.toHaveBeenCalledWith(jasmine.any(String), 'error');
                expect(editor.entity().equipment().map(mount => [mount.equipmentId, mount.location]))
                    .toEqual([[buildingLaser.id, destination]]);
                expect(editor.selectedLocation()).toBe(destination);
                expect(root.querySelectorAll('.floor-equipment .installed-equipment').length).toBe(1);
                expect(topology.floor()).toBe(2);
                expect(topology.viewMode()).toBe(mode);
                expect(editor.dragging()).toBeNull();
                expect(root.querySelector('.drop-target')).toBeNull();
                expect(root.querySelector('.warehouse-item .equipment-name')?.textContent).toContain(buildingLaser.name);
                editor.undo();
                fixture.detectChanges();
                expect(editor.entity().equipment().length).toBe(0);
                editor.redo();
                fixture.detectChanges();
                expect(editor.entity().equipment().map(mount => mount.location)).toEqual([destination]);
            });
        }

        it('accepts palette equipment dropped into the selected floor equipment card', async () => {
            const { root } = await createTopology();
            const location = editor.selectedLocation();
            const target = root.querySelector('.floor-equipment .inventory-drop')!;
            target.scrollIntoView({ block: 'center', inline: 'nearest' });
            await beginDrag(root);
            const point = moveTo(target);
            try {
                expect(editor.dragTarget()?.location).toBe(location);
                expect(root.querySelector('.floor-equipment .critical-grid.cdk-drop-list-dragging')).not.toBeNull();
            } finally {
                await release(point);
            }
            expect(editor.entity().equipment().map(mount => [mount.equipmentId, mount.location]))
                .toEqual([[buildingLaser.id, location]]);
            expect(root.querySelector('.floor-equipment .uninstall-mount')?.getAttribute('title'))
                .toBe('Uninstall · Move to unallocated equipment');
        });

        for (const mode of ['top', 'pancake'] as const) {
            it(`moves installed equipment from the floor card to another hex in ${mode} view`, async () => {
                const { root, hex } = await createTopology(mode);
                editor.install(buildingLaser, editor.selectedLocation());
                const mount = editor.selectedMount()!;
                editor.updateMount(mount, { facing: 4, turretType: 'sponson' });
                fixture.detectChanges();
                await fixture.whenStable();
                await beginDrag(root, '.floor-equipment .mounted-name');
                const point = moveTo(hex);
                await release(point);
                expect(editor.entity().equipment().length).toBe(1);
                expect(editor.entity().equipment()[0].mountId).toBe(mount.mountId);
                expect(editor.entity().equipment()[0].location).toBe(destination);
                expect(editor.entity().equipment()[0].facing).toBe(4);
                expect(editor.entity().equipment()[0].turretType).toBe('sponson');
                expect(editor.unallocated()).toEqual([]);
                editor.undo();
                expect(editor.entity().equipment()[0].location).toBe(mount.location);
                editor.redo();
                expect(editor.entity().equipment()[0].location).toBe(destination);
            });
        }

        it('shares uninstall, inspection and the temporary tray across topology and loadout', async () => {
            const { root } = await createTopology();
            const location = editor.selectedLocation();
            editor.install(buildingLaser, location);
            const mount = editor.selectedMount()!;
            editor.updateMount(mount, { facing: 5, turretType: 'pintle' });
            fixture.detectChanges();
            const block = root.querySelector<HTMLElement>('.floor-equipment .installed-equipment')!;
            expect(block.querySelector('.critical-ticks')).not.toBeNull();
            expect(block.classList.contains('energy')).toBeTrue();
            block.querySelector<HTMLButtonElement>('.mounted-name')!.click();
            fixture.detectChanges();
            expect(editor.selectedMountId()).toBe(mount.mountId);
            expect(root.querySelector('.installed-inspector')).not.toBeNull();
            block.querySelector<HTMLButtonElement>('.uninstall-mount')!.click();
            fixture.detectChanges();
            expect(editor.unallocated().map(item => item.mountId)).toEqual([mount.mountId]);
            expect(root.querySelector('.floor-equipment .installed-equipment')).toBeNull();
            expect(root.querySelector('.unallocated-equipment .remove-mount')).not.toBeNull();
            editor.panel.set('loadout');
            fixture.detectChanges();
            expect(root.querySelectorAll('.unallocated-panel').length).toBe(1);
            expect(root.querySelector('.unallocated-equipment .unallocated-name')?.textContent).toContain(buildingLaser.name);
            root.querySelector<HTMLButtonElement>('.unallocated-name')!.click();
            fixture.detectChanges();
            root.querySelector<HTMLButtonElement>(`.critical-grid[data-location="${destination}"] .inventory-drop`)!.click();
            fixture.detectChanges();
            expect(editor.unallocated()).toEqual([]);
            expect(editor.entity().equipment()[0].mountId).toBe(mount.mountId);
            expect(editor.entity().equipment()[0].facing).toBe(5);
            expect(editor.entity().equipment()[0].turretType).toBe('pintle');
            expect(editor.entity().equipment()[0].location).toBe(destination);
            editor.panel.set('topology');
            fixture.detectChanges();
            expect(root.querySelectorAll('.floor-equipment .installed-equipment').length).toBe(1);
            expect(root.querySelectorAll('.unallocated-panel').length).toBe(1);
        });

        it('groups building loadout locations by floor', async () => {
            const { root } = await createTopology();
            editor.panel.set('loadout');
            fixture.detectChanges();
            expect([...root.querySelectorAll('.building-floor-title')].map(title => title.textContent?.trim()))
                .toEqual(['Ground floor', 'Floor 1', 'Floor 2']);
            expect([...root.querySelectorAll('.building-grid')].map(grid =>
                [...grid.querySelectorAll('.location-card')].map(card => card.getAttribute('data-location'))))
                .toEqual([0, 1, 2].map(floor => [{ q: 0, r: 0 }, { q: 1, r: 0 }].map(hex => buildingLocationName(hex, floor))));
        });

        for (const kind of ['BuildingEntity', 'Tank'] as const) {
            it(`moves installed ${kind} equipment to an empty loadout location with an empty unallocated tray`, async () => {
                const entity = createConstructionEntity(kind, registry);
                if (entity instanceof StaticEmplacementEntity) {
                    setConstructionBuildingTopology(entity, [{ q: 0, r: 0 }, { q: 1, r: 0 }, { q: 0, r: 1 }]);
                }
                const sourceLocation = kind === 'Tank' ? 'Front' : entity.locationOrder[0];
                const targetLocation = kind === 'Tank' ? 'Right' : entity.locationOrder[1];
                editor.entity.set(entity);
                editor.panel.set('loadout');
                for (let i = 0; i < 10; i++) editor.install(buildingLaser, sourceLocation);
                const mounts = editor.entity().equipment();
                const root = fixture.nativeElement as HTMLElement;
                Object.assign(root.style, { position: 'fixed', inset: '0', width: '100vw', height: '100vh' });
                await renderWarehouse();
                const target = root.querySelector<HTMLButtonElement>(`.critical-grid[data-location="${targetLocation}"] .inventory-drop`)!;
                target.scrollIntoView({ block: 'center', inline: 'nearest' });
                expect(editor.unallocated()).toEqual([]);
                expect(editor.canPlaceSelectedEquipment()).toBeFalse();
                await beginDrag(root, `.critical-grid[data-location="${sourceLocation}"] .mounted-name`);
                const point = moveTo(target);
                try {
                    expect(target.disabled).withContext('A valid drag must enable the empty drop target').toBeFalse();
                    expect(editor.dragTarget()?.location).toBe(targetLocation);
                } finally {
                    await release(point);
                }
                expect(editor.entity().equipment().length).toBe(10);
                expect(editor.entity().equipment().filter(mount => mount.location === targetLocation).map(mount => mount.mountId))
                    .toEqual([mounts[0].mountId]);
                expect(editor.unallocated()).toEqual([]);
            });
        }

        for (const targetKind of ['hex', 'card'] as const) {
            it(`drags equipment into the unallocated tray and back onto a topology ${targetKind}`, async () => {
                const { root } = await createTopology();
                editor.install(buildingLaser, editor.selectedLocation());
                const mount = editor.selectedMount()!;
                editor.updateMount(mount, { facing: 3, turretType: 'sponson' });
                root.querySelector<HTMLElement>('.unallocated-panel summary')!.click();
                fixture.detectChanges();
                await fixture.whenStable();
                const tray = root.querySelector('.unallocated-drop-zone')!;
                tray.scrollIntoView({ block: 'center', inline: 'nearest' });
                await beginDrag(root, '.floor-equipment .mounted-name');
                const uninstallPoint = moveTo(tray);
                try {
                    expect(tray.classList.contains('cdk-drop-list-dragging')).toBeTrue();
                } finally {
                    await release(uninstallPoint);
                }
                expect(editor.unallocated().map(item => item.mountId)).toEqual([mount.mountId]);
                expect(root.querySelector('.floor-equipment .installed-equipment')).toBeNull();
                editor.selectedLocation.set(destination);
                fixture.detectChanges();
                await fixture.whenStable();
                const target = root.querySelector(targetKind === 'hex'
                    ? `.hex-map [data-location="${destination}"]` : '.floor-equipment .inventory-drop')!;
                target.scrollIntoView({ block: 'center', inline: 'nearest' });
                await beginDrag(root, '.unallocated-name');
                await release(moveTo(target));
                expect(editor.unallocated()).toEqual([]);
                expect(editor.entity().equipment().length).toBe(1);
                expect(editor.entity().equipment()[0].mountId).toBe(mount.mountId);
                expect(editor.entity().equipment()[0].location).toBe(destination);
                expect(editor.entity().equipment()[0].facing).toBe(3);
                expect(editor.entity().equipment()[0].turretType).toBe('sponson');
            });
        }

        it('cancels drops released over extension hexes, map controls, background or outside the map', async () => {
            const { root, hex } = await createTopology();
            const stage = root.querySelector<HTMLElement>('.map-stage')!;
            const bounds = stage.getBoundingClientRect();
            const releasePoints = [
                center(root.querySelector('.hex-map .empty polygon')!),
                center(root.querySelector('.map-zoom button')!),
                { x: bounds.left + 3, y: bounds.top + 3 },
                { x: bounds.left - 3, y: bounds.top + 3 },
            ];
            for (const point of releasePoints) {
                await beginDrag(root);
                moveTo(hex);
                expect(editor.dragTarget()?.location).toBe(destination);
                // Mouse release can land somewhere different from the last move event.
                await release(point);
                expect(editor.entity().equipment().length).toBe(0);
                expect(editor.building()!.coordinates().length).toBe(2);
                expect(editor.dragTarget()).toBeNull();
            }
        });

        it('shows the placement rejection and leaves the building unchanged for incompatible equipment', async () => {
            const { root, hex } = await createTopology('top', weapons[0]);
            await beginDrag(root);
            const point = moveTo(hex);
            try {
                expect(hex.classList.contains('drop-rejected')).toBeTrue();
                expect(root.querySelector('.equipment-drop-hint.drop-rejected')?.textContent?.trim()).toBeTruthy();
            } finally {
                await release(point);
            }
            expect(editor.entity().equipment().length).toBe(0);
        });
    });

    it('sorts every palette column in both directions, keeping numeric ties alphabetical and unresolved values last', async () => {
        editor.query.set('Warehouse sort');
        const options = TestBed.inject(OptionsService).options;
        options.update(current => ({ ...current, CBTOptionalRules: { ...current.CBTOptionalRules, extremeRange: false } }));
        await renderWarehouse();
        const root = fixture.nativeElement as HTMLElement;
        const header = (label: string) => root.querySelector<HTMLButtonElement>(`.equipment-columns [aria-label="Sort by ${label}"]`)!;
        expect(editor.filteredEquipment()).toEqual(sortEquipment);
        expect(header('Name').getAttribute('aria-pressed')).toBe('true');
        editor.selectEquipment(sortBeta);
        const count = editor.entity().equipment().length;
        expect(editor.equipmentSlots(sortVariable)).toBe(1); // Slots use the calculated count displayed in the list.
        const columns = [
            { label: 'Name', asc: [sortAlpha, sortBeta, sortGamma, sortVariable], desc: [sortVariable, sortGamma, sortBeta, sortAlpha] },
            { label: 'Slots', asc: [sortVariable, sortBeta, sortGamma, sortAlpha], desc: [sortAlpha, sortBeta, sortGamma, sortVariable] },
            { label: 'Tons', asc: [sortGamma, sortBeta, sortAlpha, sortVariable], desc: [sortAlpha, sortBeta, sortGamma, sortVariable] },
            { label: 'Damage', asc: [sortBeta, sortGamma, sortAlpha, sortVariable], desc: [sortAlpha, sortGamma, sortBeta, sortVariable] },
            { label: 'Range', asc: [sortBeta, sortGamma, sortAlpha, sortVariable], desc: [sortAlpha, sortGamma, sortBeta, sortVariable] },
            { label: 'BV', asc: [sortBeta, sortGamma, sortAlpha, sortVariable], desc: [sortAlpha, sortGamma, sortBeta, sortVariable] },
        ];
        for (const column of columns) {
            const directions = column.label === 'Name' ? ['desc', 'asc'] as const : ['asc', 'desc'] as const;
            for (const direction of directions) {
                header(column.label).click();
                await renderWarehouse();
                expect(editor.filteredEquipment()).withContext(`${column.label} ${direction}`).toEqual(column[direction]);
                expect([...root.querySelectorAll('.warehouse-item .equipment-label')].map(label => label.textContent))
                    .toEqual(column[direction].map(eq => eq.name));
                expect(header(column.label).getAttribute('aria-description')).toBe(`Sorted ${direction === 'asc' ? 'ascending' : 'descending'}`);
                expect(header(column.label).classList.contains('sort-desc')).toBe(direction === 'desc');
                expect(root.querySelectorAll('.equipment-columns .sort-active').length).toBe(1);
            }
        }
        expect(editor.selectedEquipment()).toBe(sortBeta);
        expect(editor.entity().equipment().length).toBe(count);
    });

    it('recalculates targeting-computer palette mass, inspector mass and Tons sorting as weapons are installed and removed', async () => {
        const entity = editor.entity();
        entity.mixedTech.set(true);
        entity.setTonnage(75);
        editor.query.set('Warehouse mass');
        editor.sortEquipment('tons');
        await renderWarehouse();
        const root = fixture.nativeElement as HTMLElement;
        const displayedMasses = () => [...root.querySelectorAll('.warehouse-item .equipment-tons > span')].map(cell => cell.textContent?.trim());
        const inspectorMass = () => root.querySelector('.installed-inspector .equipment-details')!.textContent!.replace(/\s+/g, ' ');
        expect(editor.filteredEquipment()).toEqual([clanTargetingComputer, isTargetingComputer, variableJet]);
        expect(displayedMasses()).toEqual(['0', '0', '1']);
        root.querySelectorAll<HTMLButtonElement>('.warehouse-item .equipment-name')[1].click();
        await renderWarehouse();
        expect(inspectorMass()).toContain('Tonnage:0 t');

        const weapon = new WeaponEquipment({ id: 'Mass test weapon', name: 'Mass test weapon', type: 'weapon', tech,
            flags: ['F_MEK_WEAPON', 'F_ENERGY', 'F_DIRECT_FIRE'], stats: { tonnage: 9, criticalSlots: 1 } });
        const mount = entity.addEquipment({ equipmentId: weapon.id, equipment: weapon,
            allocation: { kind: 'location', location: 'RA' }, rearMounted: false, turretMounted: false, omniPodMounted: false, armored: false });
        const installed = entity.equipment();
        await renderWarehouse();
        expect(editor.filteredEquipment()).toEqual([variableJet, clanTargetingComputer, isTargetingComputer]);
        expect(displayedMasses()).toEqual(['1', '2', '3']);
        expect(inspectorMass()).toContain('Tonnage:3 t');
        expect(entity.equipment()).toBe(installed); // Previewing the catalog must not install candidate mounts.

        entity.removeEquipment(mount);
        await renderWarehouse();
        expect(editor.filteredEquipment()).toEqual([clanTargetingComputer, isTargetingComputer, variableJet]);
        expect(displayedMasses()).toEqual(['0', '0', '1']);
        expect(inspectorMass()).toContain('Tonnage:0 t');
    });

    it('updates variable mass for chassis weight and the selected hybrid-structure location', async () => {
        const entity = editor.entity();
        editor.query.set(variableJet.name);
        entity.setTonnage(75);
        await renderWarehouse();
        const root = fixture.nativeElement as HTMLElement;
        root.querySelector<HTMLButtonElement>('.warehouse-item .equipment-name')!.click();
        await renderWarehouse();
        const paletteMass = () => root.querySelector('.warehouse-item .equipment-tons > span')!.textContent?.trim();
        expect(paletteMass()).toBe('1');
        entity.setTonnage(100);
        await renderWarehouse();
        expect(paletteMass()).toBe('2');
        entity.setStructureAt('RA', new MountedStructure({ tonnage: 55, structure: STANDARD_STRUCTURE_EQUIPMENT }));
        editor.selectedLocation.set('RA');
        await renderWarehouse();
        expect(paletteMass()).toBe('0.5');
        expect(root.querySelector('.installed-inspector .equipment-details')!.textContent!.replace(/\s+/g, ' ')).toContain('Tonnage:0.5 t');
        editor.selectedLocation.set('RT');
        await renderWarehouse();
        expect(paletteMass()).toBe('2');
    });

    it('calculates other variable equipment with default installation sizing and retains unresolved mass', () => {
        const masc = new MiscEquipment({ id: 'Mass test MASC', name: 'Mass test MASC', type: 'misc', tech: { ...tech, base: 'IS' },
            flags: ['F_MEK_EQUIPMENT', 'F_MASC'], stats: { tonnage: 'variable' } });
        const cargo = new MiscEquipment({ id: 'Mass test cargo', name: 'Mass test cargo', type: 'misc', tech,
            flags: ['F_CARGO'], stats: { tonnage: 'variable' } });
        const ladder = new MiscEquipment({ id: 'Mass test ladder', name: 'Mass test ladder', type: 'misc', tech,
            flags: ['F_LADDER'], stats: { tonnage: 'variable' } });
        editor.entity().setTonnage(75);
        expect(editor.equipmentMass(masc)).toBe(4);
        editor.entity().setTonnage(100);
        expect(editor.equipmentMass(masc)).toBe(5);
        expect(editor.equipmentMass(cargo)).toBe(1);
        expect(editor.equipmentMass(ladder)).toBe(0.005);
        expect(editor.equipmentMass(sortVariable)).toBe('Var.');
    });

    it('sorts by the farthest enabled range bracket and updates when extreme range changes', async () => {
        editor.query.set('Warehouse sort');
        const options = TestBed.inject(OptionsService).options;
        options.update(current => ({ ...current, CBTOptionalRules: { ...current.CBTOptionalRules, extremeRange: false } }));
        await renderWarehouse();
        const header = fixture.nativeElement.querySelector('[aria-label="Sort by Range"]') as HTMLButtonElement;
        header.click();
        expect(editor.filteredEquipment()).toEqual([sortBeta, sortGamma, sortAlpha, sortVariable]);
        options.update(current => ({ ...current, CBTOptionalRules: { ...current.CBTOptionalRules, extremeRange: true } }));
        expect(editor.filteredEquipment()).toEqual([sortGamma, sortAlpha, sortBeta, sortVariable]);
        header.click();
        expect(editor.filteredEquipment()).toEqual([sortBeta, sortAlpha, sortGamma, sortVariable]);
    });

    it('sorts the entire virtualized catalog, returns to the first row, and retains sorting after filtering', async () => {
        editor.query.set('Warehouse laser');
        await renderWarehouse();
        const viewport = fixture.debugElement.query(By.directive(CdkVirtualScrollViewport)).componentInstance as CdkVirtualScrollViewport;
        viewport.scrollToIndex(180);
        await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
        await renderWarehouse();
        expect(viewport.measureScrollOffset()).toBeGreaterThan(0);
        (fixture.nativeElement.querySelector('[aria-label="Sort by Name"]') as HTMLButtonElement).click();
        await renderWarehouse();
        expect(viewport.measureScrollOffset()).toBe(0);
        expect(editor.filteredEquipment()).toEqual([...weapons].reverse());
        expect(fixture.nativeElement.querySelector('.warehouse-item .equipment-label')?.textContent).toBe(weapons.at(-1)!.name);
        editor.query.set('Warehouse laser 00');
        await renderWarehouse();
        expect(editor.filteredEquipment()).toEqual(weapons.slice(0, 10).reverse());
        expect(editor.equipmentSort()).toEqual({ column: 'name', direction: 'desc' });
    });

    it('restores a multi-slot palette row after scrolling, filtering and repeated drags outside the equipment list', async () => {
        editor.query.set('Warehouse laser');
        fixture.detectChanges();
        await fixture.whenStable();
        const viewport = fixture.debugElement.query(By.directive(CdkVirtualScrollViewport)).componentInstance as CdkVirtualScrollViewport;
        viewport.checkViewportSize();
        viewport.scrollToIndex(180);
        await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
        fixture.detectChanges();
        await fixture.whenStable();
        editor.query.set(autocannon.name);
        fixture.detectChanges();
        await fixture.whenStable();
        const root = fixture.nativeElement as HTMLElement;
        const count = editor.entity().equipment().length;
        const mouse = (target: EventTarget, type: string, clientX: number, clientY: number) => target.dispatchEvent(new MouseEvent(type, {
            bubbles: true, cancelable: true, view: window, detail: 1, buttons: type === 'mouseup' ? 0 : 1, button: 0, clientX, clientY,
        }));
        for (let attempt = 0; attempt < 2; attempt++) {
            const item = root.querySelector<HTMLElement>('.warehouse-item')!;
            const origin = item.getBoundingClientRect();
            const card = item.querySelector<HTMLElement>('.warehouse-equipment')!;
            const rect = card.getBoundingClientRect();
            const target = card.querySelector<HTMLElement>(attempt === 0 ? '.equipment-bv > span' : '.equipment-label')!;
            const targetRect = target.getBoundingClientRect();
            const x = Math.round(targetRect.left + targetRect.width / 2);
            const y = Math.round(targetRect.top + targetRect.height / 2);
            const grabX = (x - rect.left) / rect.width, grabY = (y - rect.top) / rect.height;
            const endX = origin.right + 80, endY = y + 40;
            target.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button: 0, buttons: 1, clientX: x, clientY: y }));
            mouse(target, 'mousedown', x, y);
            mouse(document, 'mousemove', x + 15, y + 15);
            fixture.detectChanges();
            await fixture.whenStable();
            mouse(document, 'mousemove', endX, endY);
            viewport.checkViewportSize();
            fixture.detectChanges();
            await fixture.whenStable();
            try {
                const preview = document.querySelector<HTMLElement>('.construction-drag-preview.cdk-drag-preview');
                expect(preview?.textContent?.trim()).toBe(autocannon.name);
                expect(preview?.closest('.equipment-list')).toBeNull();
                const previewRect = preview!.getBoundingClientRect();
                expect(previewRect.left).toBeCloseTo(endX - previewRect.width * grabX, 0);
                expect(previewRect.top).toBeCloseTo(endY - previewRect.height * grabY, 0);
                expect(root.querySelector('.warehouse-placeholder')).not.toBeNull();
            } finally {
                mouse(document, 'mouseup', endX, endY);
                await fixture.whenStable();
                fixture.detectChanges();
            }
            expect(editor.dragging()).toBeNull();
            expect(document.querySelector('.cdk-drag-preview')).toBeNull();
            expect(item.style.transform).toBe('');
            expect(root.querySelector('.warehouse-item')).toBe(item);
            expect(item.getBoundingClientRect().left).toBeCloseTo(origin.left, 0);
            expect(item.getBoundingClientRect().top).toBeCloseTo(origin.top, 0);
            expect(editor.entity().equipment().length).toBe(count);
        }
    });

    it('keeps the install button independent from the card drag handle', async () => {
        editor.query.set(autocannon.name);
        await renderWarehouse();
        const root = fixture.nativeElement as HTMLElement;
        const item = root.querySelector<HTMLElement>('.warehouse-item')!;
        const mouse = (target: EventTarget, type: string, x: number, y: number) => target.dispatchEvent(new MouseEvent(type, {
            bubbles: true, cancelable: true, button: 0, buttons: type === 'mouseup' ? 0 : 1, clientX: x, clientY: y,
        }));
        for (const cell of item.querySelectorAll<HTMLElement>('.install-button')) {
            const rect = cell.getBoundingClientRect();
            mouse(cell, 'mousedown', rect.left + 2, rect.top + 2);
            mouse(document, 'mousemove', rect.right + 60, rect.top + 30);
            fixture.detectChanges();
            expect(editor.dragging()).withContext(cell.className).toBeNull();
            expect(document.querySelector('.cdk-drag-preview')).toBeNull();
            mouse(document, 'mouseup', rect.right + 60, rect.top + 30);
        }
        const count = editor.entity().equipment().length;
        item.querySelector<HTMLButtonElement>('.install-button')!.click();
        expect(editor.entity().equipment().length).toBe(count + 1);
        expect(editor.selectedMount()?.equipmentId).toBe(autocannon.id);
    });

    it('shows slots and weight beside the name, with combat stats below and a separate install action', async () => {
        editor.query.set(autocannon.name);
        const options = TestBed.inject(OptionsService).options;
        options.update(current => ({ ...current, CBTOptionalRules: { ...current.CBTOptionalRules, extremeRange: false } }));
        await renderWarehouse();
        const root = fixture.nativeElement as HTMLElement;
        const row = root.querySelector<HTMLElement>('.warehouse-item')!;
        const cells = [...row.querySelectorAll<HTMLElement>('.equipment-number > span:last-child')];
        expect(cells.map(cell => cell.textContent?.trim())).toEqual(['7', '12', '10', '(4) 7/14/21', '123']);
        expect([...row.querySelectorAll('.equipment-number small')].map(label => label.textContent))
            .toEqual(['Dmg', 'Range', 'BV']);
        const card = row.querySelector<HTMLElement>('.warehouse-equipment')!.getBoundingClientRect();
        const name = row.querySelector<HTMLElement>('.equipment-name')!.getBoundingClientRect();
        const stats = row.querySelector<HTMLElement>('.equipment-stats')!.getBoundingClientRect();
        const install = row.querySelector<HTMLElement>('.install-button')!.getBoundingClientRect();
        expect(stats.top).toBeGreaterThanOrEqual(name.bottom);
        expect(cells[0].getBoundingClientRect().left).toBeGreaterThanOrEqual(name.right);
        expect(cells[1].getBoundingClientRect().top).toBeLessThan(name.bottom);
        expect(row.querySelector('.equipment-tons img')?.getAttribute('src')).toBe('/images/weight.svg');
        expect(install.left - card.right).toBeGreaterThanOrEqual(10);
        expect(row.getBoundingClientRect().height).toBe(editor.equipmentRowHeight);
        cells.forEach(cell => expect(cell.getBoundingClientRect().right).toBeLessThanOrEqual(card.right));
        options.update(current => ({ ...current, CBTOptionalRules: { ...current.CBTOptionalRules, extremeRange: true } }));
        fixture.detectChanges();
        expect(row.querySelector('.equipment-range > span')!.textContent).toBe('(4) 7/14/21/28');
        expect(editor.equipmentDamage(tankEquipment)).toBe('—');
        expect(editor.equipmentRange(tankEquipment)).toBe('—');
    });

    it('shows shared tech badges only for mixed designs, incompatible choices or installed tech mismatches', async () => {
        editor.entity().rulesLevel.set(4);
        editor.query.set(experimental.name);
        editor.install(experimental, 'LT');
        fixture.detectChanges();
        await fixture.whenStable();
        const root = fixture.nativeElement as HTMLElement;
        const paletteBadge = () => root.querySelector('.equipment-name tech-base-badge');
        const mountedBadge = () => root.querySelector('[data-location="LT"] .mounted-name tech-base-badge');
        expect(editor.showTechBases()).toBeFalse();
        expect(paletteBadge()).toBeNull();
        expect(mountedBadge()).toBeNull();
        editor.entity().mixedTech.set(true); fixture.detectChanges();
        expect(paletteBadge()?.textContent?.trim()).toBe('IS');
        expect(mountedBadge()?.textContent?.trim()).toBe('IS');
        const title = mountedBadge()!.parentElement!;
        expect(title.querySelector('.equipment-label')?.nextElementSibling).toBe(mountedBadge());
        editor.entity().mixedTech.set(false);
        editor.showIncompatibleEquipment.set(true); fixture.detectChanges();
        expect(paletteBadge()).not.toBeNull();
        editor.showIncompatibleEquipment.set(false);
        editor.entity().mixedTech.set(true);
        editor.install(clan, 'RT');
        const mixedMount = editor.selectedMount()!;
        editor.entity().mixedTech.set(false); fixture.detectChanges();
        expect(editor.validation().messages.some(message => message.code === 'TECH_BASE_MISMATCH')).toBeTrue();
        expect(paletteBadge()).not.toBeNull();
        expect(root.querySelector('[data-location="RT"] tech-base-badge')?.textContent?.trim()).toBe('C');
        editor.entity().removeEquipment(mixedMount); fixture.detectChanges();
        expect(paletteBadge()).toBeNull();
        editor.entity().mixedTech.set(true);
        editor.query.set(autocannon.name); fixture.detectChanges();
        await fixture.whenStable();
        expect(paletteBadge()).toBeNull(); // Technology shared by both bases needs no badge.
    });

    it('identifies the installed system variant without labeling shared systems', async () => {
        editor.entity().mountedEngine.set(new MountedEngine({ type: 'XL', rating: 200, techBase: 'Clan' }));
        fixture.detectChanges();
        await fixture.whenStable();
        const root = fixture.nativeElement as HTMLElement;
        expect(editor.showTechBases()).toBeTrue();
        const engines = [...root.querySelectorAll<HTMLButtonElement>('.system-name[title="Inspect XL Fusion Engine"]')];
        expect(engines.length).toBeGreaterThan(0);
        expect(engines.every(engine => engine.querySelector('tech-base-badge')?.textContent?.trim() === 'C')).toBeTrue();
        expect(root.querySelector('.system-name[title="Inspect Gyro"] tech-base-badge')).toBeNull();
        engines[0].click(); fixture.detectChanges();
        expect(root.querySelector('.installed-inspector h3 tech-base-badge')?.textContent?.trim()).toBe('C');
    });

    for (const mobile of [false, true]) {
        it(`opens palette details in the shared ${mobile ? 'mobile modal' : 'floating inspector'} with equipment-colored frames`, async () => {
            TestBed.inject(LayoutService).windowWidth.set(mobile ? 390 : 1440);
            if (mobile) editor.equipmentDrawerOpen.set(true);
            editor.query.set(autocannon.name);
            await renderWarehouse();
            const root = fixture.nativeElement as HTMLElement;
            const card = root.querySelector<HTMLButtonElement>('.warehouse-equipment')!;
            if (mobile) {
                card.dispatchEvent(new PointerEvent('pointerenter', { pointerType: 'touch', bubbles: true }));
                card.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true }));
                fixture.detectChanges();
                expect(editor.inspectorOpen()).toBeFalse();
            }
            card.click(); fixture.detectChanges();
            await fixture.whenStable();
            const inspector = root.querySelector<HTMLElement>('.installed-inspector')!;
            expect(root.querySelector('.warehouse .equipment-inspector')).toBeNull();
            expect(root.querySelectorAll('.equipment-inspector').length).toBe(1);
            expect(inspector.getAttribute('aria-modal')).toBe(mobile ? 'true' : null);
            expect(inspector.classList.contains('ballistic')).toBeTrue();
            expect(getComputedStyle(inspector).position).toBe('fixed');
            expect(getComputedStyle(inspector).borderTopWidth).toBe('2px');
            expect(getComputedStyle(inspector).borderLeftWidth).toBe('0px');
            expect(getComputedStyle(inspector).backgroundImage).toContain('linear-gradient');
            expect(getComputedStyle(inspector).backgroundImage).toContain(getComputedStyle(inspector).borderTopColor);
            const basic = inspector.querySelector<HTMLElement>('.basic-info')!;
            expect(basic.textContent).toContain('Type: Ballistic');
            expect(basic.textContent).toContain('Damage: 10');
            expect(basic.textContent).toContain('Range: (4) 7/14/21');
            expect(basic.textContent).toContain('Heat: 3');
            expect(basic.textContent).not.toContain('BV:');
            const details = inspector.querySelector<HTMLDetailsElement>('.equipment-details')!;
            expect(details.open).toBeFalse();
            expect([...details.querySelectorAll('.equip-group-title')].map(title => title.textContent?.trim()))
                .toEqual(['General', 'Technology', 'History']);
            expect(details.textContent!.replace(/\s+/g, ' ')).toContain('Common:2500');
            details.querySelector('summary')!.click();
            expect(details.open).toBeTrue();
            expect(inspector.querySelector<HTMLButtonElement>('.inspector-install')!.closest('details')).toBeNull();
            if (mobile) {
                expect(editor.equipmentDrawerOpen()).toBeFalse();
                expect(root.querySelector('.workshop-body')?.hasAttribute('inert')).toBeTrue();
            }
            inspector.querySelector<HTMLButtonElement>('.inspector-install')!.click(); fixture.detectChanges();
            expect(editor.selectedMount()?.equipmentId).toBe(autocannon.id);
            expect(root.querySelectorAll('.equipment-inspector').length).toBe(1);
            root.querySelector<HTMLButtonElement>('.inspector-close')!.click(); fixture.detectChanges();
            expect(editor.inspectorOpen()).toBeFalse();
            expect(root.querySelector('.installed-inspector')).toBeNull();
        });
    }

    it('inspects the whole warehouse card and keeps only the open inspector trigger highlighted', async () => {
        editor.query.set('Warehouse sort');
        await renderWarehouse();
        const root = fixture.nativeElement as HTMLElement;
        const cards = [...root.querySelectorAll<HTMLButtonElement>('.warehouse-equipment')];
        const pointer = (target: HTMLElement, type: string) =>
            target.dispatchEvent(new PointerEvent(type, { pointerType: 'mouse' }));
        for (const card of cards.slice(0, 2)) {
            jasmine.clock().withMock(() => {
                // Entering over the stats enters the card without entering the name.
                pointer(card, 'pointerenter');
                jasmine.clock().tick(300);
            });
            fixture.detectChanges();
            expect(editor.inspector.trigger).toBe(card);
            expect(card.classList.contains('inspector-active')).toBeTrue();
            expect(root.querySelectorAll('.warehouse-equipment.inspector-active').length).toBe(1);
            expect(getComputedStyle(card).outlineStyle).toBe('solid');
            const panel = root.querySelector<HTMLElement>('.installed-inspector')!;
            jasmine.clock().withMock(() => {
                pointer(card, 'pointerleave');
                pointer(panel, 'pointerenter');
                jasmine.clock().tick(600);
            });
            fixture.detectChanges();
            expect(card.classList.contains('inspector-active')).toBeTrue();
        }
        const card = cards[1];
        card.querySelector<HTMLElement>('.equipment-range')!.click();
        fixture.detectChanges();
        expect(editor.inspector.isPinned()).toBeTrue();
        expect(card.classList.contains('inspector-active')).toBeTrue();
        root.querySelector<HTMLButtonElement>('.inspector-close')!.click();
        fixture.detectChanges();
        await fixture.whenStable();
        expect(root.querySelector('.warehouse-equipment.inspector-active')).toBeNull();
        expect(getComputedStyle(card).outlineStyle).toBe('none');
        expect(document.activeElement).toBe(card);
    });

    for (const width of [320, 390]) {
        it(`fits complete equipment cards and the inspector at ${width}px, restoring focus on close`, async () => {
            TestBed.inject(LayoutService).windowWidth.set(width);
            editor.equipmentDrawerOpen.set(true);
            editor.query.set(autocannon.name);
            await renderWarehouse();
            const root = fixture.nativeElement as HTMLElement;
            const frame = document.createElement('iframe');
            Object.assign(frame.style, { width: `${width}px`, height: '844px' });
            document.body.appendChild(frame);
            try {
                const doc = frame.contentDocument!;
                const style = doc.createElement('style');
                style.textContent = [...document.styleSheets].flatMap(sheet => [...sheet.cssRules].map(rule => rule.cssText)).join('\n');
                doc.head.appendChild(style);
                doc.body.style.margin = '0';
                Object.assign(root.style, { width: `${width}px`, height: '844px' });
                doc.body.appendChild(root);
                await renderWarehouse();
                const table = root.querySelector<HTMLElement>('.equipment-table')!;
                const list = root.querySelector<HTMLElement>('.equipment-list')!;
                const card = root.querySelector<HTMLElement>('.warehouse-equipment')!;
                expect(frame.contentWindow!.getComputedStyle(list).overscrollBehaviorX).toBe('auto');
                expect(frame.contentWindow!.getComputedStyle(card).touchAction).toBe('pan-x pan-y');
                expect(table.scrollWidth).toBe(table.clientWidth);
                expect(list.scrollWidth).toBe(list.clientWidth);
                expect(root.querySelector<HTMLElement>('.warehouse-item')!.getBoundingClientRect().height).toBe(editor.equipmentRowHeight);
                const stats = [...card.querySelectorAll<HTMLElement>('.equipment-number')].map(cell => cell.getBoundingClientRect());
                expect(stats[2].top).toBeGreaterThanOrEqual(stats[0].bottom);
                expect(stats[2].top).toBeCloseTo(stats[3].top, 0);
                expect(stats[4].top).toBeCloseTo(stats[3].top, 0);
                stats.forEach(bounds => expect(bounds.right).toBeLessThanOrEqual(card.getBoundingClientRect().right));
                const plus = root.querySelector<HTMLElement>('.install-button')!.getBoundingClientRect();
                expect(plus.right).toBeLessThanOrEqual(table.getBoundingClientRect().right);
                root.querySelector<HTMLButtonElement>('.equipment-name')!.click();
                fixture.detectChanges();
                await fixture.whenStable();
                const panel = root.querySelector<HTMLElement>('.installed-inspector')!;
                const bounds = panel.getBoundingClientRect();
                expect(bounds.left).toBeGreaterThanOrEqual(12);
                expect(bounds.right).toBeLessThanOrEqual(width - 12);
                expect(bounds.top).toBeGreaterThanOrEqual(0);
                expect(bounds.bottom).toBeLessThanOrEqual(844);
                panel.querySelector<HTMLButtonElement>('.inspector-close')!.click();
                fixture.detectChanges();
                await fixture.whenStable();
                expect(doc.activeElement).toBe(root.querySelector('.equipment-toggle'));
            } finally {
                document.body.appendChild(root);
                frame.remove();
            }
        });
    }

    for (const width of [320, 1440]) {
        it(`scrolls the loadout at both edges during dragging at ${width}px and stops after release`, async () => {
            TestBed.inject(LayoutService).windowWidth.set(width);
            editor.equipmentDrawerOpen.set(width === 320);
            editor.query.set(weapons[0].name);
            await renderWarehouse();
            const root = fixture.nativeElement as HTMLElement;
            const frame = document.createElement('iframe');
            Object.assign(frame.style, { width: `${width}px`, height: '640px' });
            document.body.appendChild(frame);
            const doc = frame.contentDocument!;
            const style = doc.createElement('style');
            style.textContent = [...document.styleSheets].flatMap(sheet => [...sheet.cssRules].map(rule => rule.cssText)).join('\n');
            doc.head.appendChild(style);
            doc.body.style.margin = '0';
            Object.assign(root.style, { width: `${width}px`, height: '640px' });
            doc.body.appendChild(root);
            spyOn(document, 'elementFromPoint').and.callFake((x, y) => doc.elementFromPoint(x, y));
            const nextFrame = () => new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
            try {
                await renderWarehouse();
                const shell = root.querySelector<HTMLElement>('.construction-shell')!;
                const scroll = width === 320 ? shell : root.querySelector<HTMLElement>('.construction-workspace')!;
                const header = root.querySelector<HTMLElement>('.workshop-header')!;
                const footer = root.querySelector<HTMLElement>('.workshop-footer')!;
                if (width === 320) {
                    const target = root.querySelector<HTMLElement>('.critical-grid[data-location="LT"] .empty-slot')!;
                    target.scrollIntoView({ block: 'center' });
                    await nextFrame();
                    const card = root.querySelector<HTMLElement>('.warehouse-equipment')!;
                    const rect = card.getBoundingClientRect();
                    const touch = (type: string, x: number, y: number) => {
                        const point = new Touch({ identifier: 1, target: card, clientX: x, clientY: y,
                            pageX: x + window.scrollX, pageY: y + window.scrollY });
                        const event = new TouchEvent(type, { bubbles: true, cancelable: true,
                            touches: type === 'touchend' ? [] : [point], changedTouches: [point] });
                        (type === 'touchstart' ? card : document).dispatchEvent(event);
                        return event;
                    };
                    const x = rect.left + 20, y = rect.top + 10;
                    touch('touchstart', x, y);
                    expect(touch('touchmove', x, y + 20).defaultPrevented).toBeFalse();
                    expect(editor.dragging()).toBeNull();
                    expect(editor.equipmentDrawerActive()).toBeTrue();
                    touch('touchend', x, y + 20);
                    touch('touchstart', x, y);
                    await new Promise(resolve => setTimeout(resolve, 220));
                    expect(touch('touchmove', x, y + 10).defaultPrevented).toBeTrue();
                    fixture.detectChanges();
                    expect(editor.dragging()?.equipmentId).toBe(weapons[0].id);
                    expect(editor.equipmentDrawerActive()).toBeFalse();
                    expect(card.isConnected).toBeTrue(); // CDK temporarily moves the source row outside the list.
                    expect(frame.contentWindow!.getComputedStyle(root.querySelector('.warehouse')!).visibility).toBe('hidden');
                    expect(root.querySelector('.construction-workspace')!.hasAttribute('inert')).toBeFalse();
                    // The source stays alive while the finger crosses onto the revealed loadout.
                    const bounds = target.getBoundingClientRect();
                    const tx = bounds.left + bounds.width / 2, ty = bounds.top + bounds.height / 2;
                    touch('touchmove', tx, ty);
                    fixture.detectChanges();
                    expect(editor.dragTarget()?.location).withContext(`Touch drop at ${tx}, ${ty}`).toBe('LT');
                    expect(target.closest('.critical-grid')!.classList.contains('cdk-drop-list-dragging')).toBeTrue();
                    touch('touchend', tx, ty);
                    await fixture.whenStable();
                    fixture.detectChanges();
                    expect(editor.entity().equipment().some(mount => mount.equipmentId === weapons[0].id && mount.location === 'LT')).toBeTrue();
                    expect(editor.dragging()).toBeNull();
                    expect(editor.equipmentDrawerOpen()).toBeFalse();
                }
                editor.startDrag({ equipmentId: weapons[0].id });
                fixture.detectChanges();
                scroll.scrollTop = 60;
                const bounds = scroll.getBoundingClientRect();
                const x = bounds.left + bounds.width / 2;
                const previous = scroll.scrollTop;
                editor.dragMoved({ pointerPosition: { x, y: Math.min(bounds.bottom, footer.getBoundingClientRect().top) - 5 } });
                await nextFrame(); await nextFrame();
                expect(scroll.scrollTop).toBeGreaterThan(previous);
                const lower = scroll.scrollTop;
                editor.dragMoved({ pointerPosition: { x, y: Math.max(bounds.top, header.getBoundingClientRect().bottom) + 5 } });
                await nextFrame(); await nextFrame();
                expect(scroll.scrollTop).toBeLessThan(lower);
                editor.endDrag();
                const stopped = scroll.scrollTop;
                await nextFrame(); await nextFrame();
                expect(scroll.scrollTop).toBe(stopped);
            } finally {
                editor.endDrag();
                document.body.appendChild(root);
                frame.remove();
            }
        });
    }

    it('shows variable equipment prices and BV without treating them as numbers', async () => {
        const variable = new MiscEquipment({ id: 'Variable equipment', name: 'Variable equipment', type: 'misc',
            stats: { bv: 'variable', cost: 'variable', tonnage: 'variable', criticalSlots: 'variable' } });
        editor.selectEquipment(variable);
        editor.inspector.open(fixture.nativeElement);
        fixture.detectChanges();
        await fixture.whenStable();
        const panel = fixture.nativeElement.querySelector('.equipment-inspector') as HTMLElement;
        expect(panel.querySelector('.basic-info')!.textContent).toContain('Type: Misc');
        expect(panel.querySelector('.basic-info')!.textContent).not.toMatch(/Range:|Damage:|Heat:|Rack Size:/);
        const details = panel.querySelector('.equipment-details')!.textContent!.replace(/\s+/g, ' ');
        expect(details).toContain('BV:Variable');
        expect(details).toContain('Cost:Variable');
    });

    it('docks issues and BV on wide screens and overlays smaller screens with independent scrolling', async () => {
        spyOn(editor, 'validation').and.returnValue({ valid: false, messages: Array.from({ length: 45 }, (_, index) => ({
            category: 'equipment' as const, code: `SIDEBAR_${index}`, severity: 'error' as const, location: 'RA',
            message: `Equipment issue ${index + 1}: this deliberately detailed explanation must wrap inside the issues sidebar.`,
        })) });
        spyOn(editor.entity(), 'battleValue').and.returnValue(1500);
        spyOn(editor.entity(), 'battleValueDetails').and.returnValue(Array.from({ length: 45 }, (_, index) => ({
            type: `Battle Value calculation ${index + 1}`, calculation: '(100 + 200 + 150) × 1.25', total: 562.5,
        })));
        fixture.detectChanges();
        await fixture.whenStable();
        const root = fixture.nativeElement as HTMLElement;
        const frame = document.createElement('iframe');
        frame.style.height = '800px';
        frame.style.border = '0';
        document.body.appendChild(frame);
        try {
            const doc = frame.contentDocument!;
            const style = doc.createElement('style');
            doc.head.appendChild(style);
            doc.body.style.margin = '0';
            doc.body.appendChild(root);
            const refresh = async () => {
                fixture.detectChanges();
                await fixture.whenStable();
                // Include component styles registered when the report first appears; measure final layout, not its slide animation.
                style.textContent = [...document.styleSheets].flatMap(sheet => [...sheet.cssRules].map(rule => rule.cssText)).join('\n')
                    + '\n.construction-details { animation: none !important; }';
            };
            for (const width of [1920, 1850, 1440, 1000, 390]) {
                const docked = width > 1850;
                frame.style.width = `${width}px`;
                Object.assign(root.style, { width: `${width}px`, height: '800px' });
                (TestBed.inject(LayoutService).windowWidth as ReturnType<typeof signal<number>>).set(width);
                editor.closeDetails();
                await refresh();
                const body = root.querySelector<HTMLElement>('.workshop-body')!;
                const workspace = root.querySelector<HTMLElement>('.construction-workspace')!;
                const baseline = body.getBoundingClientRect();
                const workspaceBaseline = workspace.getBoundingClientRect();
                root.querySelector<HTMLButtonElement>('.validation-toggle')!.click();
                await refresh();

                const assertSidebar = () => {
                    const sidebar = root.querySelector<HTMLElement>('.construction-details')!;
                    const sideBounds = sidebar.getBoundingClientRect(), bodyBounds = body.getBoundingClientRect();
                    if (docked) {
                        expect(sideBounds.left).withContext(`${width}px: sidebar right of workspace`).toBeGreaterThanOrEqual(workspace.getBoundingClientRect().right - 1);
                        expect(sideBounds.top).withContext(`${width}px: sidebar uses full body height`).toBeCloseTo(bodyBounds.top, 0);
                        expect(sideBounds.bottom).toBeCloseTo(bodyBounds.bottom, 0);
                        expect(root.querySelector('.details-backdrop')).toBeNull();
                        expect(sidebar.getAttribute('role')).toBeNull();
                    } else {
                        expect(sideBounds.top).withContext(`${width}px: overlay covers the viewport`).toBe(0);
                        expect(sideBounds.bottom).toBe(frame.contentWindow!.innerHeight);
                        expect(sideBounds.right).toBe(frame.contentWindow!.innerWidth);
                        expect(sideBounds.width).toBe(Math.min(420, frame.contentWindow!.innerWidth - 28));
                        expect(workspace.getBoundingClientRect().width).toBe(workspaceBaseline.width);
                        expect(workspace.getBoundingClientRect().left).toBe(workspaceBaseline.left);
                        expect(sidebar.getAttribute('role')).toBe('dialog');
                        expect(root.querySelector('.details-backdrop')).not.toBeNull();
                        expect(sidebar.querySelector('.close-button')?.getBoundingClientRect().width).toBe(40);
                    }
                    expect(workspace.hasAttribute('inert')).toBe(!docked);
                    expect(bodyBounds.top).withContext(`${width}px: no issues strip above editor`).toBeCloseTo(baseline.top, 0);
                    expect(bodyBounds.height).toBeCloseTo(baseline.height, 0);
                    expect(body.hasAttribute('inert')).toBeFalse();
                    expect(root.querySelector('#construction-validation')).toBeNull();
                    return sidebar;
                };
                const assertScroll = (scroll: HTMLElement) => {
                    expect(scroll.clientHeight).toBeGreaterThan(0);
                    expect(scroll.scrollHeight).withContext(`${width}px: long sidebar content scrolls`).toBeGreaterThan(scroll.clientHeight);
                    expect(scroll.getBoundingClientRect().bottom).toBeLessThanOrEqual(root.querySelector('.construction-details')!.getBoundingClientRect().bottom + 1);
                    const workspaceTop = workspace.scrollTop;
                    scroll.scrollTop = 70;
                    expect(scroll.scrollTop).toBeGreaterThan(0);
                    expect(workspace.scrollTop).toBe(workspaceTop);
                };
                const sidebar = assertSidebar();
                assertScroll(sidebar.querySelector<HTMLElement>('.validation-panel')!);
                expect(sidebar.querySelector('construction-breakdown')).toBeNull();
                const columns = [...workspace.querySelectorAll<HTMLElement>('.location-column')];
                expect(columns.length).toBe(width > 1180 ? 5 : 3);
                const outerColumnOffset = width > 1180 ? '72px' : '0px';
                expect(frame.contentWindow!.getComputedStyle(columns[0]).paddingTop).toBe(outerColumnOffset);
                expect(frame.contentWindow!.getComputedStyle(columns.at(-1)!).paddingTop).toBe(outerColumnOffset);
                const cards = [...workspace.querySelectorAll<HTMLElement>('.location-card')];
                if (width >= 1000) {
                    expect(Math.min(...cards.map(card => card.getBoundingClientRect().width)))
                        .withContext(`${width}px: preserve usable location widths`).toBeGreaterThanOrEqual(178);
                }
                if (workspace.scrollWidth > workspace.clientWidth) {
                    expect(frame.contentWindow!.getComputedStyle(workspace).overflowX).toBe('auto');
                    workspace.scrollLeft = workspace.scrollWidth;
                    expect(workspace.scrollLeft).withContext(`${width}px: narrow workspace scrolls instead of clipping`).toBeGreaterThan(0);
                    expect(columns.at(-1)!.getBoundingClientRect().right).toBeLessThanOrEqual(workspace.getBoundingClientRect().right + 1);
                    workspace.scrollLeft = 0;
                }
                const icon = root.querySelector<HTMLButtonElement>('[aria-label="Change unit icon"]')!;
                if (!docked) {
                    icon.focus();
                    expect(doc.activeElement).not.toBe(icon);
                    sidebar.querySelector<HTMLButtonElement>('.close-button')!.click();
                    await refresh();
                }
                workspace.querySelector<HTMLButtonElement>('[data-location="RA"] .location-title')!.click();
                expect(editor.selectedLocation()).toBe('RA');
                expect(icon.disabled).toBeFalse();
                icon.focus();
                expect(doc.activeElement).toBe(icon);
                root.querySelector<HTMLButtonElement>('.bv-total')!.click();
                await refresh();
                const reportSidebar = assertSidebar();
                expect(editor.detailsView()).toBe('bv');
                expect(reportSidebar.querySelector('.validation-panel')).toBeNull();
                expect(reportSidebar.querySelector('construction-breakdown h2')!.textContent).toBe('Battle Value breakdown');
                assertScroll(reportSidebar.querySelector<HTMLElement>('.report-scroll')!);
                expect(body.hasAttribute('inert')).toBeFalse();
                if (!docked) {
                    reportSidebar.querySelector<HTMLButtonElement>('.close-button')!.click();
                    await refresh();
                }
                workspace.querySelector<HTMLButtonElement>('[data-location="LA"] .location-title')!.click();
                expect(editor.selectedLocation()).toBe('LA');
            }
        } finally {
            document.body.appendChild(root);
            frame.remove();
        }
    });

    it('keeps the mobile header visible while scrolling and opens the warehouse from either tab', async () => {
        Object.assign(fixture.nativeElement.style, { width: '375px', height: '640px' });
        (TestBed.inject(LayoutService).windowWidth as ReturnType<typeof signal<number>>).set(375);
        spyOn(editor, 'pendingRepairQuote').and.returnValue({ cost: 12345678, basis: 'Test', spCost: 1250, spBasis: 'Test' });
        spyOn(editor, 'unitCost').and.returnValue(10122000);
        spyOn(editor, 'unitBV').and.returnValue(5000);
        spyOn(editor, 'effectiveBV').and.returnValue(4500);
        spyOn(editor, 'repairBVDelta').and.returnValue(1500);
        fixture.detectChanges();
        await fixture.whenStable();
        const frame = document.createElement('iframe');
        frame.style.width = '375px';
        frame.style.height = '640px';
        document.body.appendChild(frame);
        try {
            // A real narrow document is needed to exercise the mobile media queries.
            const doc = frame.contentDocument!;
            const style = doc.createElement('style');
            style.textContent = [...document.styleSheets].flatMap(sheet => [...sheet.cssRules].map(rule => rule.cssText)).join('\n');
            doc.head.appendChild(style);
            doc.body.style.margin = '0';
            const root = fixture.nativeElement as HTMLElement;
            doc.body.appendChild(root);
            const shell = root.querySelector<HTMLElement>('.construction-shell')!;
            const header = root.querySelector<HTMLElement>('.workshop-header')!;
            const equipment = header.querySelector<HTMLButtonElement>('.equipment-toggle')!;
            const icon = header.querySelector<HTMLElement>('.workshop-icon')!;
            expect(equipment.getBoundingClientRect().right).toBeLessThanOrEqual(icon.getBoundingClientRect().left);
            expect(root.querySelector('.design-summary .equipment-toggle')).toBeNull();
            for (const panel of ['loadout', 'systems'] as const) {
                shell.scrollTop = 0;
                editor.panel.set(panel);
                fixture.detectChanges(); await fixture.whenStable();
                const previewTab = root.querySelector<HTMLElement>('.workshop-header nav button:last-child')!.getBoundingClientRect();
                const totals = root.querySelector<HTMLElement>('.construction-value')!.getBoundingClientRect();
                expect(previewTab.right <= totals.left || previewTab.bottom <= totals.top || previewTab.top >= totals.bottom)
                    .withContext(`Preview tab right ${previewTab.right}; totals left ${totals.left}`).toBeTrue();
                if (panel === 'systems') {
                    const filter = root.querySelector<HTMLButtonElement>('.configuration-filter')!.getBoundingClientRect();
                    const tabs = root.querySelector<HTMLElement>('.workspace-tabs')!.getBoundingClientRect();
                    expect(filter.width).toBeGreaterThan(0);
                    expect(filter.left).toBeGreaterThanOrEqual(tabs.right);
                    expect(filter.right).toBeLessThanOrEqual(375);
                }
                const navigation = root.querySelector<HTMLElement>('.workspace-navigation')!;
                const navigationTop = navigation.getBoundingClientRect().top;
                shell.scrollTop = 400;
                expect(shell.scrollTop).toBeGreaterThan(0);
                expect(header.getBoundingClientRect().top).toBeCloseTo(shell.getBoundingClientRect().top, 0);
                expect(navigation.getBoundingClientRect().top).toBeCloseTo(navigationTop, 0);
                expect(navigation.getBoundingClientRect().bottom).toBeLessThanOrEqual(header.getBoundingClientRect().bottom);
                const scrollTop = shell.scrollTop;
                equipment.click(); fixture.detectChanges(); await fixture.whenStable();
                const drawer = root.querySelector<HTMLElement>('.equipment-drawer')!;
                expect(drawer.getBoundingClientRect().width).toBeGreaterThan(0);
                expect(equipment.getAttribute('aria-expanded')).toBe('true');
                drawer.querySelector<HTMLButtonElement>('[aria-label="Close equipment"]')!.click();
                fixture.detectChanges(); await fixture.whenStable();
                expect(root.querySelector('.equipment-drawer')).toBeNull();
                expect(equipment.getAttribute('aria-expanded')).toBe('false');
                expect(doc.activeElement).toBe(equipment);
                expect(shell.scrollTop).toBe(scrollTop);
            }
            const costLine = root.querySelector<HTMLElement>('.cost-line')!;
            const costBounds = costLine.getBoundingClientRect();
            expect(costBounds.left).toBeGreaterThanOrEqual(0);
            expect(costBounds.right).toBeLessThanOrEqual(375);
            expect(costLine.scrollWidth).toBeLessThanOrEqual(Math.ceil(costBounds.width));
        } finally {
            document.body.appendChild(fixture.nativeElement);
            frame.remove();
        }
    });
});
