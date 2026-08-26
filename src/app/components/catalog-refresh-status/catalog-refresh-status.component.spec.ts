// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import { provideZonelessChangeDetection } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { CatalogRefreshStatusComponent } from './catalog-refresh-status.component';
import { LoggerService } from '../../services/logger.service';

describe('CatalogRefreshStatusComponent', () => {
    let logger: jasmine.SpyObj<Pick<LoggerService, 'info' | 'warn'>>;

    beforeEach(async () => {
        logger = jasmine.createSpyObj('LoggerService', ['info', 'warn']);
        await TestBed.configureTestingModule({
            imports: [CatalogRefreshStatusComponent],
            providers: [
                provideZonelessChangeDetection(),
                { provide: LoggerService, useValue: logger },
            ],
        }).compileComponents();
    });

    it('exposes exact determinate phase progress to assistive technology', () => {
        const fixture = TestBed.createComponent(CatalogRefreshStatusComponent);
        fixture.componentRef.setInput('view', {
            kind: 'progress',
            mode: 'determinate',
            title: 'Using saved catalogs; updating in the background…',
            detail: '25 of 100 unit summaries updated',
            completed: 25,
            total: 100,
            percent: 25,
            ariaValueText: '25 of 100 unit summaries updated',
        });
        fixture.detectChanges();

        const host = fixture.nativeElement as HTMLElement;
        const status = host.querySelector('[role="status"]');
        expect(status?.getAttribute('aria-live')).toBe('polite');
        expect(status?.getAttribute('aria-busy')).toBe('true');
        const progress = host.querySelector('[role="progressbar"]');
        expect(progress?.getAttribute('aria-valuenow')).toBe('25');
        expect(progress?.getAttribute('aria-valuetext')).toBe('25 of 100 unit summaries updated');
        expect(logger.info).toHaveBeenCalledOnceWith(
            '[Loading] Using saved catalogs; updating in the background…: 25 of 100 unit summaries updated',
        );
    });

    it('labels follower work as indeterminate without inventing a value', () => {
        const fixture = TestBed.createComponent(CatalogRefreshStatusComponent);
        fixture.componentRef.setInput('view', {
            kind: 'progress',
            mode: 'indeterminate',
            title: 'Using saved catalogs; another tab is updating them…',
            detail: 'This tab will switch after the shared complete bundle is committed.',
        });
        fixture.detectChanges();

        const progress = (fixture.nativeElement as HTMLElement).querySelector('[role="progressbar"]');
        expect(progress?.getAttribute('aria-label')).toContain('another tab');
        expect(progress?.getAttribute('aria-valuemin')).toBe('0');
        expect(progress?.getAttribute('aria-valuemax')).toBe('100');
        expect(progress?.hasAttribute('aria-valuenow')).toBeFalse();
    });

    it('logs summary extraction only when it starts and finishes', () => {
        const fixture = TestBed.createComponent(CatalogRefreshStatusComponent);
        spyOn(Date, 'now').and.returnValues(1_000, 1_275);
        fixture.componentRef.setInput('view', {
            kind: 'progress',
            mode: 'indeterminate',
            title: 'Updating catalogs…',
            detail: 'Reading prebuilt unit summaries: Preparing to read the summaries embedded in the core archive.',
        });
        fixture.detectChanges();
        fixture.componentRef.setInput('view', {
            kind: 'progress',
            mode: 'determinate',
            title: 'Updating catalogs…',
            detail: 'Reading prebuilt unit summaries: 64 of 128 unit summaries read',
            completed: 64,
            total: 128,
            percent: 50,
            ariaValueText: '64 of 128 unit summaries read',
        });
        fixture.detectChanges();
        fixture.componentRef.setInput('view', {
            kind: 'progress',
            mode: 'determinate',
            title: 'Updating catalogs…',
            detail: 'Reading prebuilt unit summaries: 128 of 128 unit summaries read',
            completed: 128,
            total: 128,
            percent: 100,
            ariaValueText: '128 of 128 unit summaries read',
        });
        fixture.detectChanges();

        expect(logger.info.calls.allArgs()).toEqual([
            ['[Loading] Reading prebuilt unit summaries started.'],
            ['[Loading] Reading prebuilt unit summaries finished in 275 ms (128 unit summaries read).'],
        ]);
    });

    it('renders a retained-catalog warning as status without a false progress bar', () => {
        const fixture = TestBed.createComponent(CatalogRefreshStatusComponent);
        fixture.componentRef.setInput('view', {
            kind: 'notice',
            tone: 'warning',
            title: 'Catalog refresh failed; saved data remains active',
            detail: 'The last complete verified catalog is still available.',
        });
        fixture.detectChanges();

        const host = fixture.nativeElement as HTMLElement;
        const status = host.querySelector('.warning[role="status"]');
        expect(status).not.toBeNull();
        expect(status?.getAttribute('aria-live')).toBe('polite');
        expect(status?.getAttribute('aria-busy')).toBe('false');
        expect(host.querySelector('[role="progressbar"]')).toBeNull();
        expect(logger.warn).toHaveBeenCalledOnceWith(
            '[Loading] Catalog refresh failed; saved data remains active: The last complete verified catalog is still available.',
        );
    });
});
