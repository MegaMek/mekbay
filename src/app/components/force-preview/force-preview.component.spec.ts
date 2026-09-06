// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import { Injector, provideZonelessChangeDetection, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { ASForce } from '../../models/as-force.model';
import type { DataService } from '../../services/data.service';
import { OptionsService } from '../../services/options.service';
import { ForcePreviewComponent } from './force-preview.component';

describe('ForcePreviewComponent reserves', () => {
    it('updates the count from the live personnel roster and hides empty reserves', () => {
        TestBed.configureTestingModule({
            imports: [ForcePreviewComponent],
            providers: [
                provideZonelessChangeDetection(),
                { provide: OptionsService, useValue: { options: signal({ unitDisplayName: 'chassisModel' }) } },
            ],
        });
        const force = new ASForce('Reserves', {} as DataService, TestBed.inject(Injector));
        const fixture = TestBed.createComponent(ForcePreviewComponent);
        fixture.componentRef.setInput('force', force);
        fixture.detectChanges();
        expect(fixture.nativeElement.querySelector('force-reserves-preview')).toBeNull();

        const first = force.addUnassignedPerson({ name: 'Alex' })!;
        const second = force.addUnassignedPerson({ name: 'Morgan' })!;
        fixture.detectChanges();
        const count = fixture.nativeElement.querySelector('.reserve-count') as HTMLElement;
        expect(count.textContent?.trim()).toBe('2');
        expect(count.getAttribute('aria-label')).toBe('2 people in reserve');
        expect(fixture.nativeElement.textContent).not.toContain('Alex');
        expect(fixture.nativeElement.querySelectorAll('.unit-square').length).toBe(0);

        force.deletePerson(first.id);
        force.deletePerson(second.id);
        fixture.detectChanges();
        expect(fixture.nativeElement.querySelector('force-reserves-preview')).toBeNull();
    });
});
