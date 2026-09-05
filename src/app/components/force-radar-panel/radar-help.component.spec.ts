// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import { OverlayContainer } from '@angular/cdk/overlay';
import { TestBed } from '@angular/core/testing';
import { RadarHelpComponent } from './radar-help.component';

describe('RadarHelpComponent', () => {
    function setup() {
        const fixture = TestBed.createComponent(RadarHelpComponent);
        fixture.detectChanges();
        const container = TestBed.inject(OverlayContainer).getContainerElement();
        const button = fixture.nativeElement.querySelector('button') as HTMLButtonElement;
        return { fixture, container, button };
    }

    it('opens a visual guide on click and restores focus on dismissal', async () => {
        const { fixture, container, button } = setup();
        expect(button.getAttribute('aria-expanded')).toBe('false');
        expect(container.querySelector('[role="dialog"]')).toBeNull();
        button.focus();
        button.click();
        fixture.detectChanges();
        await fixture.whenStable();
        const dialog = container.querySelector('[role="dialog"]') as HTMLElement;
        expect(button.getAttribute('aria-expanded')).toBe('true');
        expect(dialog.querySelectorAll('svg').length).toBe(3);
        expect(dialog.textContent).toContain('Catalog average');
        expect(dialog.textContent).toContain('Stays fixed when hovering');
        expect(dialog.textContent).toContain('one matching unit, not the force');
        expect(dialog.textContent).toContain('P95 reference');
        expect(dialog.scrollWidth).toBeLessThanOrEqual(dialog.clientWidth);
        expect(document.activeElement).toBe(dialog.querySelector('header'));
        dialog.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
        fixture.detectChanges();
        expect(container.querySelector('[role="dialog"]')).toBeNull();
        expect(button.getAttribute('aria-expanded')).toBe('false');
        expect(document.activeElement).toBe(button);
    });

    it('dismisses with Escape without bubbling to the containing dialog', async () => {
        const { fixture, container, button } = setup();
        button.click();
        fixture.detectChanges();
        await fixture.whenStable();
        const escaped = jasmine.createSpy('escaped');
        container.addEventListener('keydown', escaped);
        try {
            container.querySelector('[role="dialog"]')!.dispatchEvent(new KeyboardEvent('keydown', {
                key: 'Escape', bubbles: true, cancelable: true,
            }));
            fixture.detectChanges();
            expect(container.querySelector('[role="dialog"]')).toBeNull();
            expect(escaped).not.toHaveBeenCalled();
        } finally {
            container.removeEventListener('keydown', escaped);
        }
    });

    it('dismisses on an outside click and cleans up when the radar is removed', () => {
        const { fixture, container, button } = setup();
        button.click();
        fixture.detectChanges();
        (container.querySelector('.cdk-overlay-backdrop') as HTMLElement).click();
        fixture.detectChanges();
        expect(fixture.componentInstance.open()).toBeFalse();
        expect(container.querySelector('[role="dialog"]')).toBeNull();
        button.click();
        fixture.detectChanges();
        expect(container.querySelector('[role="dialog"]')).not.toBeNull();
        fixture.destroy();
        expect(container.querySelector('[role="dialog"]')).toBeNull();
    });
});
