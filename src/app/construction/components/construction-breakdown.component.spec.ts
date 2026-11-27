// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
import { TestBed } from '@angular/core/testing';
import type { ConstructionBreakdownData } from '../domain/construction-breakdowns';
import { ConstructionBreakdownComponent } from './construction-breakdown.component';

describe('construction breakdown presentation', () => {
    function create(data: ConstructionBreakdownData) {
        const fixture = TestBed.createComponent(ConstructionBreakdownComponent);
        fixture.componentRef.setInput('data', data);
        fixture.detectChanges();
        return fixture;
    }

    it('updates its report from new input and emits close without a dialog dependency', () => {
        const fixture = create({ title: 'Weight breakdown', unit: 't', total: 50.125,
            rows: [{ label: 'Equipment' }, { label: 'Laser', value: 1, depth: 1 }, { label: 'Rounding', value: 0 }] });
        const root = fixture.nativeElement as HTMLElement;
        const rows = root.querySelectorAll('tbody tr');
        expect(root.querySelector('.report-total')!.textContent).toContain('50.125');
        expect(rows[0].querySelector('td:last-child')!.textContent).toBe('');
        expect(rows[1].querySelector('th')!.style.paddingLeft).toBe('26px');
        expect(rows[2].querySelector('td:last-child')!.textContent).toBe('0');
        fixture.componentRef.setInput('data', { title: 'Battle Value breakdown', unit: 'BV', total: 1020,
            rows: [{ label: 'Offensive BV', calculation: '200 × 1.1', value: 220 }] } satisfies ConstructionBreakdownData);
        fixture.detectChanges();
        expect(root.querySelector('h2')!.textContent).toBe('Battle Value breakdown');
        expect(root.querySelector('.report-total')!.textContent).toContain('1,020');
        expect(root.querySelectorAll('tbody tr').length).toBe(1);
        expect(root.querySelector('tbody')!.textContent).toContain('200 × 1.1');
        const closed = jasmine.createSpy('closed');
        fixture.componentInstance.closed.subscribe(closed);
        root.querySelector<HTMLButtonElement>('[aria-label="Close breakdown"]')!.click();
        expect(closed).toHaveBeenCalledTimes(1);
    });

    it('wraps calculations and scrolls rows within a narrow sidebar', () => {
        const fixture = create({ title: 'Construction cost breakdown', unit: 'C-Bills', total: 1234567.89,
            rows: Array.from({ length: 30 }, (_, index) => ({ label: `Equipment subtotal ${index + 1}`,
                calculation: '(200000+150000+90000)×1.375', value: 1234567.89 })) });
        const root = fixture.nativeElement as HTMLElement;
        root.style.width = '360px';
        root.style.height = '240px';
        const scroll = root.querySelector<HTMLElement>('.report-scroll')!;
        const header = root.querySelector<HTMLElement>('header')!;
        expect(scroll.clientHeight).toBeGreaterThan(0);
        expect(scroll.scrollHeight).toBeGreaterThan(scroll.clientHeight);
        expect(scroll.scrollWidth).toBeLessThanOrEqual(scroll.clientWidth + 1);
        expect(scroll.getBoundingClientRect().bottom).toBeLessThanOrEqual(root.getBoundingClientRect().bottom + 1);
        expect(header.getBoundingClientRect().bottom).toBeLessThanOrEqual(scroll.getBoundingClientRect().top + 1);
    });
});
