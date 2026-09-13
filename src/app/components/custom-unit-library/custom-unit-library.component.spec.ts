// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
import { provideZonelessChangeDetection, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { CustomUnitLibraryComponent } from './custom-unit-library.component';
import { CustomUnitSyncService } from '../../services/custom-unit-sync.service';
import { DataService } from '../../services/data.service';
import { UnitNameService } from '../../services/unit-name.service';
import { DialogsService } from '../../services/dialogs.service';
import { ToastService } from '../../services/toast.service';
import { asUnitUuid } from '../../services/unit-catalog/unit-catalog.types';
import type { SavedCustomUnit } from '../../models/custom-unit.model';

describe('custom unit libraries in Options', () => {
    const own = { uuid: asUnitUuid('019f6767-0dcb-7bb8-992f-000000000001'), owned: true } as SavedCustomUnit;
    const subscribed = { uuid: asUnitUuid('019f6767-0dcb-7bb8-992f-000000000002'), owned: false, subscribed: true } as SavedCustomUnit;
    let remove: jasmine.Spy, unsubscribe: jasmine.Spy, confirm: jasmine.Spy;
    beforeEach(() => {
        remove = jasmine.createSpy('delete').and.resolveTo();
        unsubscribe = jasmine.createSpy('unsubscribe').and.resolveTo();
        confirm = jasmine.createSpy('confirm').and.resolveTo(false);
        TestBed.configureTestingModule({ providers: [provideZonelessChangeDetection(),
            { provide: CustomUnitSyncService, useValue: { sync: async () => {}, syncing: signal(false), error: signal(''),
                conflicts: signal(new Set()),
                subscriberCounts: signal(new Map([[own.uuid, 42]])), library: { records: signal([own, subscribed]), delete: remove }, unsubscribe } },
            { provide: DataService, useValue: { getUnitByUuid: (uuid: string) => ({ name: uuid === own.uuid ? 'Owned Atlas' : 'Shared Jenner' }), refreshCustomUnits: async () => {} } },
            { provide: UnitNameService, useValue: { name: (unit: { name: string }) => unit.name } },
            { provide: DialogsService, useValue: { requestConfirmation: confirm } },
            { provide: ToastService, useValue: { showToast: () => {} } },
        ] });
    });
    it('lists owned designs and subscriber counts, and respects a declined deletion', async () => {
        const fixture = TestBed.createComponent(CustomUnitLibraryComponent); fixture.detectChanges();
        expect(fixture.nativeElement.textContent).toContain('Owned Atlas');
        expect(fixture.nativeElement.textContent).toContain('42 subscribers');
        expect(fixture.nativeElement.textContent).not.toContain('Shared Jenner');
        await fixture.componentInstance.remove(own);
        expect(remove).not.toHaveBeenCalled();
        confirm.and.resolveTo(true);
        await fixture.componentInstance.remove(own);
        expect(remove).toHaveBeenCalledOnceWith(own.uuid);
    });
    it('lists subscriptions with an unsubscribe action', async () => {
        const fixture = TestBed.createComponent(CustomUnitLibraryComponent);
        fixture.componentRef.setInput('owned', false); fixture.detectChanges();
        expect(fixture.nativeElement.textContent).toContain('Shared Jenner');
        expect(fixture.nativeElement.textContent).not.toContain('Owned Atlas');
        expect(fixture.nativeElement.textContent).toContain('Unsubscribe');
        await fixture.componentInstance.remove(subscribed);
        expect(unsubscribe).toHaveBeenCalledOnceWith(subscribed.uuid);
        expect(remove).not.toHaveBeenCalled();
    });
});
