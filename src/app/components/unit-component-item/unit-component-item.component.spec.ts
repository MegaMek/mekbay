// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import { inputBinding, signal } from '@angular/core';
import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { Dialog } from '@angular/cdk/dialog';
import { OverlayContainer } from '@angular/cdk/overlay';
import { WeaponEquipment } from '../../models/equipment.model';
import { DataService } from '../../services/data.service';
import { FloatingOverlayService } from '../../services/floating-overlay.service';
import { LayoutService } from '../../services/layout.service';
import { OptionsService } from '../../services/options.service';
import { createEmptyUnit } from '../../testing/unit-test-helpers';
import type { UnitConditionComponent } from '../../utils/unit-component-metadata-builder';
import { UnitComponentItemComponent } from './unit-component-item.component';

describe('unit component inspectors', () => {
    const equipment = new WeaponEquipment({ id: 'Inspector laser', name: 'Inspector laser', type: 'weapon',
        flags: ['F_ENERGY'], stats: { tonnage: 5, criticalSlots: 2, bv: 100, cost: 50000 },
        weapon: { damage: 8, heat: 5, ranges: [5, 10, 15, 20] },
        tech: { base: 'IS', level: 'Standard', advancement: { is: {
            prototype: '2500', production: '2510', common: '2520', extinct: '2800', reintroduced: '3000',
        } } },
    });
    const unit = createEmptyUnit({ type: 'Mek', techBase: 'Inner Sphere' });
    const comp: UnitConditionComponent = { id: equipment.id, eq: equipment, q: 1, n: equipment.name, t: 'E', p: 0, l: 'RA', r: '5/10/15', d: '8' };
    let phone: ReturnType<typeof signal<boolean>>;
    let fixture: ComponentFixture<UnitComponentItemComponent>;
    let container: HTMLElement;
    let service: FloatingOverlayService;
    const pointer = (target: HTMLElement, type: string, pointerType: string) =>
        target.dispatchEvent(new PointerEvent(type, { pointerType, bubbles: true }));
    const escape = (target: HTMLElement) => target.dispatchEvent(new KeyboardEvent('keydown', {
        key: 'Escape', code: 'Escape', keyCode: 27, bubbles: true, cancelable: true,
    }));

    beforeEach(() => {
        phone = signal(false);
        TestBed.configureTestingModule({
            imports: [UnitComponentItemComponent],
            providers: [
                { provide: LayoutService, useValue: { isPhone: phone } },
                { provide: DataService, useValue: { findEquipment: () => equipment } },
                { provide: OptionsService, useValue: { options: () => ({ CBTRules: 'core-2026' }) } },
            ],
        });
        fixture = TestBed.createComponent(UnitComponentItemComponent);
        fixture.componentRef.setInput('unit', unit);
        fixture.componentRef.setInput('comp', comp);
        fixture.detectChanges();
        container = TestBed.inject(OverlayContainer).getContainerElement();
        service = TestBed.inject(FloatingOverlayService);
    });

    afterEach(() => {
        service.destroy();
        TestBed.inject(Dialog).closeAll();
    });

    const trigger = () => fixture.nativeElement.querySelector('.component') as HTMLElement;
    const modal = () => container.querySelector<HTMLElement>('[role="dialog"][aria-modal="true"]');
    async function render(): Promise<void> {
        fixture.detectChanges();
        await fixture.whenStable();
    }

    it('ignores phone hover from every pointer type, then opens a focused modal on tap that stays open while scrolling', async () => {
        phone.set(true);
        await render();
        for (const type of ['touch', 'pen', 'mouse']) pointer(trigger(), 'pointerenter', type);
        await render();
        expect(container.querySelector('floating-comp-info')).toBeNull();
        trigger().click();
        await render();
        const dialog = modal()!;
        expect(dialog).not.toBeNull();
        expect(dialog.getAttribute('aria-label')).toBe(`Component inspector: ${equipment.name}`);
        expect(container.querySelector('.cdk-overlay-backdrop')).not.toBeNull();
        const panel = dialog.querySelector<HTMLElement>('.floating-comp-info')!;
        expect(panel.classList.contains('framed-borders')).toBeTrue();
        expect(panel.classList.contains('energy')).toBeTrue();
        const close = dialog.querySelector<HTMLButtonElement>('.inspector-close')!;
        expect(document.activeElement).toBe(close);
        pointer(trigger(), 'pointerleave', 'mouse');
        service.hideWithDelay(0);
        panel.dispatchEvent(new Event('scroll'));
        panel.dispatchEvent(new WheelEvent('wheel', { bubbles: true }));
        await render();
        expect(modal()).toBe(dialog);
        close.click();
        await render();
        expect(modal()).toBeNull();
        expect(document.activeElement).toBe(trigger());
    });

    it('uses the same phone modal for compact cards and text entries without enabling passive additional entries', async () => {
        phone.set(true);
        for (const style of ['small', 'tiny', 'text']) {
            fixture.componentRef.setInput('displayStyle', style);
            await render();
            pointer(trigger(), 'pointerenter', 'mouse');
            await render();
            expect(modal()).withContext(style).toBeNull();
            trigger().dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
            await render();
            expect(modal()).withContext(style).not.toBeNull();
            container.querySelector<HTMLElement>('.cdk-overlay-backdrop')!.click();
            await render();
            expect(modal()).toBeNull();
        }
        fixture.componentRef.setInput('displayStyle', 'additional');
        await render();
        pointer(trigger(), 'pointerenter', 'mouse');
        trigger().click();
        await render();
        expect(container.querySelector('floating-comp-info')).toBeNull();
        expect(trigger().hasAttribute('tabindex')).toBeFalse();
    });

    it('keeps mouse hover and click floating on larger screens and ignores touch or pen entry', async () => {
        for (const type of ['touch', 'pen']) pointer(trigger(), 'pointerenter', type);
        await render();
        expect(container.querySelector('floating-comp-info')).toBeNull();
        pointer(trigger(), 'pointerenter', 'mouse');
        await render();
        expect(container.querySelector('.floating-comp-overlay-panel .floating-comp-info')).not.toBeNull();
        expect(modal()).toBeNull();
        expect(container.querySelector('.inspector-close')).toBeNull();
        service.hide();
        trigger().click();
        await render();
        expect(container.querySelector('.floating-comp-overlay-panel .floating-comp-info')).not.toBeNull();
        window.dispatchEvent(new Event('scroll'));
        await render();
        expect(container.querySelector('floating-comp-info')).toBeNull();
    });

    it('closes an existing hover panel when the viewport becomes a phone', async () => {
        pointer(trigger(), 'pointerenter', 'mouse');
        await render();
        expect(container.querySelector('floating-comp-info')).not.toBeNull();
        phone.set(true);
        await render();
        expect(container.querySelector('floating-comp-info')).toBeNull();
        trigger().click();
        await render();
        expect(modal()).not.toBeNull();
    });

    it('closes only the component inspector with Escape when opened inside a unit dialog', async () => {
        phone.set(true);
        const dialogs = TestBed.inject(Dialog);
        const parent = dialogs.open(UnitComponentItemComponent, {
            ariaLabel: 'Unit details',
            bindings: [inputBinding('unit', () => unit), inputBinding('comp', () => comp)],
        });
        await render();
        const card = container.querySelector<HTMLElement>('[aria-label="Unit details"] .component')!;
        card.click();
        await render();
        expect(dialogs.openDialogs.length).toBe(2);
        escape(modal()!);
        await render();
        expect(modal()).toBeNull();
        expect(dialogs.openDialogs).toEqual([parent]);
        expect(document.activeElement).toBe(card);
    });

    it('fits a short phone viewport and scrolls long equipment details inside the modal', async () => {
        phone.set(true);
        trigger().click();
        await render();
        const frame = document.createElement('iframe');
        Object.assign(frame.style, { width: '390px', height: '400px', border: '0' });
        document.body.appendChild(frame);
        const originalParent = container.parentElement!;
        try {
            const doc = frame.contentDocument!;
            const style = doc.createElement('style');
            style.textContent = [...document.styleSheets].flatMap(sheet => [...sheet.cssRules].map(rule => rule.cssText)).join('\n');
            doc.head.appendChild(style);
            doc.body.style.margin = '0';
            doc.body.appendChild(container);
            const panel = modal()!.querySelector<HTMLElement>('.floating-comp-info')!;
            const bounds = panel.getBoundingClientRect();
            expect(bounds.left).toBeGreaterThanOrEqual(12);
            expect(bounds.right).toBeLessThanOrEqual(378);
            expect(bounds.top).toBeGreaterThanOrEqual(12);
            expect(bounds.bottom).toBeLessThanOrEqual(388);
            expect(panel.scrollHeight).toBeGreaterThan(panel.clientHeight);
            expect(panel.scrollWidth).toBeLessThanOrEqual(panel.clientWidth);
            expect(getComputedStyle(panel).overflowY).toBe('auto');
        } finally {
            originalParent.appendChild(container);
            frame.remove();
        }
    });
});
