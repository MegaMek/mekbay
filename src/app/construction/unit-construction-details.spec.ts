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
                const close = button('Close construction issues');
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
