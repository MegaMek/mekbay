// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import { computed, signal } from '@angular/core';
import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { Dialog, DialogRef } from '@angular/cdk/dialog';
import { By } from '@angular/platform-browser';
import { UnitConstructionComponent } from './unit-construction.component';
import { ConstructionForceService } from './construction-force.service';
import { ConstructionBreakdownComponent } from './components/construction-breakdown.component';
import { STANDARD_ARMOR_EQUIPMENT, STANDARD_STRUCTURE_EQUIPMENT } from '../models/entity/components';
import { createTestEquipmentRegistry } from '../models/entity/testing/test-equipment-registry';
import { parseEntity } from '../models/entity/parse-entity';
import { addTestEquipment, addTestEquipmentWithFlags } from '../models/entity/testing/test-mounted-equipment';
import { WeaponEquipment } from '../models/equipment.model';
import { createConstructionEntity } from './domain/construction-factory';
import { EquipmentCatalogService } from '../services/catalogs/equipment-catalog.service';
import { CustomUnitsService } from '../services/custom-units.service';
import { DataService } from '../services/data.service';
import { DialogsService } from '../services/dialogs.service';
import { LayoutService } from '../services/layout.service';
import { NativeEntityService } from '../services/native-entity.service';
import { UnitSearchIndexService } from '../services/unit-search-index.service';

describe('responsive construction details', () => {
    const registry = createTestEquipmentRegistry({
        [STANDARD_ARMOR_EQUIPMENT.id]: STANDARD_ARMOR_EQUIPMENT,
        [STANDARD_STRUCTURE_EQUIPMENT.id]: STANDARD_STRUCTURE_EQUIPMENT,
    });
    const reports = [
        { kind: 'weight', trigger: 'Show weight breakdown', title: 'Weight breakdown' },
        { kind: 'bv', trigger: 'Show pristine Battle Value breakdown', title: 'Battle Value breakdown' },
        { kind: 'cost', trigger: 'Show C-Bill cost breakdown', title: 'Construction cost breakdown' },
    ] as const;
    let fixture: ComponentFixture<UnitConstructionComponent>;
    let editor: UnitConstructionComponent;
    let width: ReturnType<typeof signal<number>>;
    let createDialog: jasmine.Spy;
    let dialogRef: { close: jasmine.Spy };

    beforeEach(() => {
        width = signal(1920);
        createDialog = jasmine.createSpy('createDialog');
        dialogRef = { close: jasmine.createSpy('close') };
        TestBed.configureTestingModule({ providers: [
            { provide: DialogRef, useValue: dialogRef },
            { provide: Dialog, useValue: { openDialogs: [dialogRef] } },
            { provide: LayoutService, useValue: { windowWidth: width } },
            { provide: EquipmentCatalogService, useValue: { getEquipmentRegistry: () => registry } },
            { provide: CustomUnitsService, useValue: {
                summaries: signal([]), parseDraft: (source: string, format: string) => parseEntity(source, `draft.${format}`, registry).entity,
            } },
            { provide: DataService, useValue: { getUnitByUuid: () => undefined, searchCorpusVersion: signal(0) } },
            { provide: DialogsService, useValue: { createDialog } },
            { provide: NativeEntityService, useValue: {} },
            { provide: UnitSearchIndexService, useValue: new UnitSearchIndexService() },
            { provide: ConstructionForceService, useValue: { damage: () => null } },
        ] });
        fixture = TestBed.createComponent(UnitConstructionComponent);
        editor = fixture.componentInstance;
        Object.assign(fixture.nativeElement.style, { width: '1920px', height: '1000px' });
    });

    const root = () => fixture.nativeElement as HTMLElement;
    const sidebar = () => root().querySelector<HTMLElement>('#construction-details');
    const button = (label: string) => root().querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`)!;
    const report = () => fixture.debugElement.query(By.directive(ConstructionBreakdownComponent))?.componentInstance as ConstructionBreakdownComponent | undefined;
    const render = async () => { fixture.detectChanges(); await fixture.whenStable(); fixture.detectChanges(); };
    const clickIssue = async (code: string, mountId?: string) => {
        root().querySelector<HTMLButtonElement>('.validation-toggle')!.click(); await render();
        const index = editor.validation().messages.findIndex(message => message.code === code && (!mountId || message.mountId === mountId));
        expect(index).withContext(code).toBeGreaterThanOrEqual(0);
        sidebar()!.querySelectorAll<HTMLButtonElement>('.validation-panel button')[index].click();
        await render();
    };

    for (const pixels of [1920, 390]) {
        it(`navigates from an issue to the chassis input and transfers focus at ${pixels}px`, async () => {
            width.set(pixels);
            editor.entity().chassis.set('');
            editor.panel.set('fluff');
            await render();
            const scroll = spyOn(HTMLElement.prototype, 'scrollIntoView');
            await clickIssue('CHASSIS_REQUIRED');
            const target = root().querySelector('[data-field-id="chassis"]')!;
            expect(editor.panel()).toBe('systems');
            expect(sidebar()).toBeNull();
            expect(root().querySelector('.construction-workspace')?.hasAttribute('inert')).toBeFalse();
            expect(document.activeElement).toBe(target.querySelector('input'));
            expect(scroll.calls.mostRecent().object).toBe(target);
        });

        it(`navigates an Artemis coverage issue to the uncovered launcher at ${pixels}px`, async () => {
            width.set(pixels);
            const entity = createConstructionEntity('Tank', registry);
            const launcher = new WeaponEquipment({ id: 'Test LRM', name: 'Test LRM', type: 'weapon',
                stats: { tonnage: 1 }, flags: ['F_ARTEMIS_COMPATIBLE'], weapon: { ammoType: 'LRM' } });
            const covered = addTestEquipment(entity, launcher, { location: 'Front' });
            const uncovered = addTestEquipment(entity, launcher, { location: 'Rear' });
            const artemis = addTestEquipmentWithFlags(entity, 'F_ARTEMIS', { location: 'Front' });
            entity.linkEquipment(artemis, covered);
            editor.entity.set(entity);
            editor.panel.set('systems');
            await render();
            const scroll = spyOn(HTMLElement.prototype, 'scrollIntoView');
            await clickIssue('ARTEMIS_COVERAGE', uncovered.mountId);
            const target = root().querySelector(`[data-mount-id="${uncovered.mountId}"]`)!;
            expect(editor.panel()).toBe('loadout');
            expect(editor.selectedLocation()).toBe('Rear');
            expect(sidebar()).toBeNull();
            expect(target.contains(document.activeElement)).toBeTrue();
            expect(scroll.calls.mostRecent().object).toBe(target);
            const warning = () => target.querySelector('.equipment-warning-icon');
            expect(warning()?.previousElementSibling?.classList.contains('equipment-label')).toBeTrue();
            expect(warning()?.getAttribute('aria-label')).toContain('one Artemis system for every compatible weapon');
            expect(warning()?.querySelector('title')?.textContent ?? '').toBe(warning()?.getAttribute('aria-label') ?? '');
            expect(root().querySelector(`[data-mount-id="${covered.mountId}"] .equipment-warning-icon`)?.getAttribute('aria-label') ?? '').not.toContain('Artemis');
            const missingSystem = addTestEquipmentWithFlags(entity, 'F_ARTEMIS', { location: 'Rear' });
            entity.linkEquipment(missingSystem, uncovered);
            await render();
            expect(warning()?.getAttribute('aria-label') ?? '').not.toContain('Artemis');
        });
    }

    it('keeps duplicate unallocated equipment issues distinct and expands the tray for the chosen mount', async () => {
        const equipment = new WeaponEquipment({ id: 'Unallocated laser', name: 'Unallocated laser', type: 'weapon', stats: { tonnage: 1 } });
        addTestEquipment(editor.entity(), equipment, { allocation: { kind: 'unallocated' } });
        const second = addTestEquipment(editor.entity(), equipment, { allocation: { kind: 'unallocated' } });
        await render();
        editor.unallocatedOpen.set(false);
        editor.panel.set('systems');
        await render();
        expect(editor.validation().messages.filter(message => message.code === 'UNALLOCATED_EQUIPMENT').length).toBe(2);
        await clickIssue('UNALLOCATED_EQUIPMENT', second.mountId);
        expect(editor.panel()).toBe('loadout');
        expect(root().querySelector<HTMLDetailsElement>('.unallocated-panel')!.open).toBeTrue();
        expect(document.activeElement).toBe(root().querySelector(`[data-mount-id="${second.mountId}"] .unallocated-name`));
        expect(root().querySelector(`[data-mount-id="${second.mountId}"] .equipment-warning-icon`)?.getAttribute('aria-label'))
            .toContain('has not been assigned a location');
    });

    it('reveals the OEM year control when its issue is clicked', async () => {
        editor.entity().originalBuildYear.set(editor.entity().year() + 1);
        editor.oemYearExpanded.set(false);
        await render();
        await clickIssue('OEM_YEAR_AFTER_INTRODUCTION');
        expect(editor.oemYearVisible()).toBeTrue();
        expect(document.activeElement).toBe(root().querySelector('#construction-oem-year'));
    });

    it('opens the weight breakdown for a design-wide overweight issue', async () => {
        addTestEquipment(editor.entity(), new WeaponEquipment({ id: 'Heavy test weapon', name: 'Heavy test weapon', type: 'weapon', stats: { tonnage: 1000 } }),
            { allocation: { kind: 'unallocated' } });
        await render();
        await clickIssue('OVERWEIGHT');
        expect(editor.detailsView()).toBe('weight');
        expect(report()?.data().title).toBe('Weight breakdown');
        expect(sidebar()!.contains(document.activeElement)).toBeTrue();
    });

    it('switches to the loadout and focuses the affected armor location', async () => {
        await render();
        editor.panel.set('systems');
        editor.navigateToIssue({ code: 'INVALID_ARMOR_VALUE', category: 'armor', severity: 'error', message: 'Invalid armor', location: 'LA' });
        await render();
        expect(editor.panel()).toBe('loadout');
        expect(editor.selectedLocation()).toBe('LA');
        expect(document.activeElement).toBe(root().querySelector('.location-card[data-location="LA"] construction-armor-control input'));
    });

    it('switches reports and issues inside one sidebar and toggles the active view closed without desktop dialogs', async () => {
        await render();
        expect(sidebar()).toBeNull();
        expect(editor.breakdown()).toBeNull();
        for (const item of reports) {
            button(item.trigger).click(); await render();
            expect(editor.detailsView()).toBe(item.kind);
            expect(root().querySelectorAll('#construction-details').length).toBe(1);
            expect(root().querySelectorAll('construction-breakdown').length).toBe(1);
            expect(sidebar()?.querySelector('h2')?.textContent).toBe(item.title);
            expect(button(item.trigger).getAttribute('aria-expanded')).toBe('true');
            expect(button(item.trigger).getAttribute('aria-controls')).toBe('construction-details');
            expect(root().querySelector('#construction-validation')).toBeNull();
        }
        root().querySelector<HTMLButtonElement>('.validation-toggle')!.click(); await render();
        expect(editor.detailsView()).toBe('issues');
        expect(editor.breakdown()).toBeNull();
        expect(sidebar()?.querySelectorAll('.validation-panel').length).toBe(1);
        expect(report()).toBeUndefined();
        root().querySelector<HTMLButtonElement>('.validation-toggle')!.click(); await render();
        expect(editor.detailsView()).toBeNull();
        expect(sidebar()).toBeNull();
        expect(createDialog).not.toHaveBeenCalled();
    });

    for (const item of reports) {
        it(`updates the open ${item.kind} report after armor edits, undo and redo`, async () => {
            await render();
            button(item.trigger).click(); await render();
            const before = report()!.data();
            const visibleBefore = sidebar()!.querySelector('.report-total')!.textContent;
            editor.setArmor('RA', 'front', 12); await render();
            const after = report()!.data();
            expect(editor.entity().getArmorValue('RA')).toBe(12);
            expect(after.total).toBeGreaterThan(before.total);
            expect(after.rows).not.toEqual(before.rows);
            expect(sidebar()!.querySelector('.report-total')!.textContent).not.toBe(visibleBefore);
            expect(editor.detailsView()).toBe(item.kind);
            editor.undo(); await render();
            expect(editor.entity().getArmorValue('RA')).toBe(0);
            expect(report()!.data().total).toBeCloseTo(before.total, 6);
            expect(sidebar()!.querySelector('.report-total')!.textContent).toBe(visibleBefore);
            editor.redo(); await render();
            expect(report()!.data().total).toBeCloseTo(after.total, 6);
            expect(editor.detailsView()).toBe(item.kind);
            expect(createDialog).not.toHaveBeenCalled();
        });
    }

    it('replaces unavailable calculations with a recoverable message instead of retaining a stale report', async () => {
        const entity = editor.entity();
        const details = entity.battleValueDetails;
        const total = entity.battleValue;
        const state = signal<'valid' | 'throws' | 'nonfinite'>('valid');
        spyOn(entity, 'battleValueDetails').and.callFake(computed(() => {
            if (state() === 'throws') throw new Error('Incomplete configuration');
            return details();
        }));
        spyOn(entity, 'battleValue').and.callFake(computed(() => state() === 'nonfinite' ? NaN : total()));
        await render();
        button('Show pristine Battle Value breakdown').click(); await render();
        const before = report()!.data().total;
        for (const unavailable of ['throws', 'nonfinite'] as const) {
            state.set(unavailable); await render();
            expect(report()).toBeUndefined();
            expect(sidebar()!.querySelector('.details-unavailable')).not.toBeNull();
            expect(editor.detailsView()).toBe('bv');
            state.set('valid'); await render();
            expect(sidebar()!.querySelector('.details-unavailable')).toBeNull();
            expect(report()!.data().total).toBe(before);
        }
        expect(createDialog).not.toHaveBeenCalled();
    });

    it('updates an open issues list as the design changes and restores it on undo', async () => {
        await render();
        root().querySelector<HTMLButtonElement>('.validation-toggle')!.click(); await render();
        const requiredName = 'Enter a chassis name.';
        expect(sidebar()!.textContent).not.toContain(requiredName);
        editor.setField(editor.fields().find(field => field.id === 'chassis')!, ''); await render();
        expect(sidebar()!.textContent).toContain(requiredName);
        expect(editor.validation().messages.some(message => message.code === 'CHASSIS_REQUIRED')).toBeTrue();
        editor.undo(); await render();
        expect(sidebar()!.textContent).not.toContain(requiredName);
        expect(editor.detailsView()).toBe('issues');
        expect(createDialog).not.toHaveBeenCalled();
    });

    it('keeps the active issues list when resizing between the docked panel and overlay', async () => {
        await render();
        root().querySelector<HTMLButtonElement>('.validation-toggle')!.click(); await render();
        const panel = sidebar();
        expect(root().querySelector('.workshop-body.details-open')).not.toBeNull();
        expect(root().querySelector('.details-backdrop')).toBeNull();
        for (const pixels of [1850, 1440, 900, 390]) {
            width.set(pixels); await render();
            expect(sidebar()).toBe(panel);
            expect(sidebar()?.getAttribute('role')).toBe('dialog');
            expect(sidebar()?.getAttribute('aria-modal')).toBe('true');
            expect(root().querySelector('.details-backdrop')).not.toBeNull();
            expect(root().querySelector('.workshop-body.details-open')).toBeNull();
            expect(root().querySelector('#construction-validation')).toBeNull();
            expect(root().querySelectorAll('.validation-panel').length).toBe(1);
            expect(root().querySelector('.validation-toggle')?.getAttribute('aria-controls')).toBe('construction-details');
        }
        width.set(1851); await render();
        expect(editor.detailsView()).toBe('issues');
        expect(sidebar()).toBe(panel);
        expect(sidebar()?.getAttribute('role')).toBeNull();
        expect(sidebar()?.getAttribute('aria-modal')).toBeNull();
        expect(root().querySelector('.details-backdrop')).toBeNull();
        expect(root().querySelector('.workshop-body.details-open')).not.toBeNull();
        expect(root().querySelector('.construction-workspace')?.hasAttribute('inert')).toBeFalse();
    });

    it('shows reports in the same offcanvas panel on mobile', async () => {
        width.set(900); await render();
        for (const item of reports) {
            button(item.trigger).click(); await render();
            expect(editor.detailsView()).toBe(item.kind);
            expect(sidebar()?.querySelector('h2')?.textContent).toBe(item.title);
            expect(sidebar()?.getAttribute('role')).toBe('dialog');
            expect(sidebar()?.getAttribute('aria-label')).toBe(item.title);
            expect(button(item.trigger).getAttribute('aria-expanded')).toBe('true');
            button('Close breakdown').click(); await render();
        }
        expect(createDialog).not.toHaveBeenCalled();
        expect(dialogRef.close).not.toHaveBeenCalled();
    });

    for (const pixels of [1440, 390]) {
        it(`overlays without reflow and restores focus after dismissal at ${pixels}px`, async () => {
            width.set(pixels);
            root().style.width = `${Math.min(pixels, window.innerWidth)}px`;
            await render();
            const trigger = root().querySelector<HTMLButtonElement>('.validation-toggle')!;
            const workspace = root().querySelector<HTMLElement>('.construction-workspace')!;
            const before = workspace.getBoundingClientRect();
            const columns = editor.locationColumns();
            for (const dismiss of ['close', 'backdrop', 'escape']) {
                trigger.focus({ preventScroll: true }); trigger.click(); await render();
                const close = button('Close construction checks');
                expect(document.activeElement).toBe(close);
                expect(close.classList.contains('close-button')).toBeTrue();
                expect(close.getBoundingClientRect().width).toBe(40);
                expect(getComputedStyle(sidebar()!).position).toBe('fixed');
                expect(workspace.getBoundingClientRect().width).toBe(before.width);
                expect(workspace.getBoundingClientRect().left).toBe(before.left);
                expect(editor.locationColumns()).toBe(columns);
                for (const selector of ['.workshop-header', '.workshop-sidebar', '.construction-workspace', '.workshop-footer']) {
                    expect(root().querySelector(selector)?.hasAttribute('inert')).withContext(selector).toBeTrue();
                }
                trigger.focus();
                expect(document.activeElement).toBe(close);
                if (dismiss === 'close') close.click();
                else if (dismiss === 'backdrop') root().querySelector<HTMLElement>('.details-backdrop')!.click();
                else close.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
                await render();
                expect(sidebar()).toBeNull();
                expect(root().querySelector('.details-backdrop')).toBeNull();
                expect(document.activeElement).toBe(trigger);
                expect(workspace.hasAttribute('inert')).toBeFalse();
                expect(root().querySelector('.construction-shell.drawer-open')).toBeNull();
            }
            expect(dialogRef.close).not.toHaveBeenCalled();
        });
    }

    it('returns focus to the report trigger when its close button or Escape closes the sidebar', async () => {
        await render();
        const trigger = button('Show pristine Battle Value breakdown');
        trigger.click(); await render();
        const close = button('Close breakdown');
        close.focus(); close.click(); await render();
        expect(sidebar()).toBeNull();
        expect(document.activeElement).toBe(trigger);
        trigger.click(); await render();
        button('Close breakdown').focus();
        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
        await render();
        expect(sidebar()).toBeNull();
        expect(document.activeElement).toBe(trigger);
        expect(dialogRef.close).not.toHaveBeenCalled();
    });
});
