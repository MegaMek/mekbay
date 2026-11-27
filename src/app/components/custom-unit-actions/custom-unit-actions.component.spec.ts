// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
import { provideZonelessChangeDetection, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { CustomUnitActionsComponent } from './custom-unit-actions.component';
import { CustomUnitSyncService } from '../../services/custom-unit-sync.service';
import { ToastService } from '../../services/toast.service';
import { createEmptyUnit } from '../../testing/unit-test-helpers';
import type { SavedCustomUnit } from '../../models/custom-unit.model';

describe('custom unit details actions', () => {
    it('shows Unsubscribe for a subscription and restores Subscribe after removing it', async () => {
        const unit = createEmptyUnit({ isCustom: true });
        const records = signal<SavedCustomUnit[]>([{ uuid: unit.uuid, owned: false, subscribed: true, ownerId: 'public-owner' } as SavedCustomUnit]);
        const unsubscribe = jasmine.createSpy('unsubscribe').and.callFake(async () => records.set([]));
        TestBed.configureTestingModule({ providers: [provideZonelessChangeDetection(),
            { provide: CustomUnitSyncService, useValue: { library: { records, isOwned: () => false }, unsubscribe } },
            { provide: ToastService, useValue: { showToast: () => {} } },
        ] });
        const fixture = TestBed.createComponent(CustomUnitActionsComponent);
        fixture.componentRef.setInput('unit', unit); fixture.detectChanges();
        expect(fixture.nativeElement.textContent).toContain('Unsubscribe');
        await fixture.componentInstance.toggleSubscription(); fixture.detectChanges();
        expect(unsubscribe).toHaveBeenCalledOnceWith(unit.uuid);
        expect(fixture.nativeElement.textContent).toContain('Subscribe');
        expect(fixture.nativeElement.textContent).not.toContain('Unsubscribe');
    });
});
