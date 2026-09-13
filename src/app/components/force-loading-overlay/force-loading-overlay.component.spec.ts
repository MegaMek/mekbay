// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { DIALOG_DATA } from '@angular/cdk/dialog';
import type { ForceLoadingProgress } from '../../models/force-loading-progress.model';
import { DataService } from '../../services/data.service';
import { ForceLoadingOverlayComponent } from './force-loading-overlay.component';

describe('ForceLoadingOverlayComponent', () => {
    it('shows each force with its faction icon, era, and current loading status', () => {
        const forces = signal<readonly ForceLoadingProgress[]>([
            { instanceId: 'one', name: 'Mercenary Knights', factionId: 1, eraId: 2, status: 'loaded' },
            { instanceId: 'two', name: 'Mercenary Knights', status: 'loading' },
        ]);
        TestBed.configureTestingModule({
            imports: [ForceLoadingOverlayComponent],
            providers: [
                { provide: DIALOG_DATA, useValue: { forces, message: signal('Loading force 2 of 2…') } },
                { provide: DataService, useValue: {
                    getFactionById: () => ({ name: 'Mercenary', img: '/images/github.svg' }),
                    getEraById: () => ({ name: 'Succession Wars' }),
                } },
            ],
        });
        const fixture = TestBed.createComponent(ForceLoadingOverlayComponent);
        fixture.detectChanges();
        const rows = fixture.nativeElement.querySelectorAll('[role="listitem"]') as NodeListOf<HTMLElement>;
        expect(rows.length).toBe(2);
        expect(rows[0].textContent).toContain('Mercenary Knights');
        expect(rows[0].textContent).toContain('Succession Wars');
        expect(rows[0].textContent).toContain('Ready');
        expect(rows[0].querySelector('img')?.getAttribute('src')).toBe('/images/github.svg');
        expect(rows[0].querySelector('img')?.alt).toBe('Mercenary');
        expect(rows[1].textContent).toContain('Loading…');

        forces.update(entries => entries.map(entry => ({ ...entry, status: 'loaded' })));
        fixture.detectChanges();
        expect(rows[1].textContent).toContain('Ready');
    });
});
