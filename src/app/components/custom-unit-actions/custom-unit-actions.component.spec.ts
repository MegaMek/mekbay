// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
import { provideZonelessChangeDetection, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { CustomUnitActionsComponent } from './custom-unit-actions.component';
import { CustomUnitSyncService } from '../../services/custom-unit-sync.service';
import { ConstructionForceService } from '../../construction/construction-force.service';
import { ToastService } from '../../services/toast.service';
import { createEmptyUnit } from '../../testing/unit-test-helpers';
import { createDirectMekRuntimeFixture } from '../../models/runtime/testing/direct-mek-runtime-fixture';
import type { SavedCustomUnit } from '../../models/custom-unit.model';
import type { CBTForceMember } from '../../models/force-member.model';

describe('custom unit details actions', () => {
    it('shows Unsubscribe for a subscription and restores Subscribe after removing it', async () => {
        const unit = createEmptyUnit({ isCustom: true });
        const records = signal<SavedCustomUnit[]>([{ uuid: unit.uuid, owned: false, subscribed: true } as SavedCustomUnit]);
        const unsubscribe = jasmine.createSpy('unsubscribe').and.callFake(async () => records.set([]));
        TestBed.configureTestingModule({ providers: [provideZonelessChangeDetection(),
            { provide: CustomUnitSyncService, useValue: { library: { records, isOwned: () => false }, unsubscribe } },
            { provide: ConstructionForceService, useValue: {} }, { provide: ToastService, useValue: { showToast: () => {} } },
        ] });
        const fixture = TestBed.createComponent(CustomUnitActionsComponent);
        fixture.componentRef.setInput('unit', unit); fixture.detectChanges();
        expect(fixture.nativeElement.textContent).toContain('Unsubscribe');
        await fixture.componentInstance.toggleSubscription(); fixture.detectChanges();
        expect(unsubscribe).toHaveBeenCalledOnceWith(unit.uuid);
        expect(fixture.nativeElement.textContent).toContain('Subscribe');
        expect(fixture.nativeElement.textContent).not.toContain('Unsubscribe');
    });
    it('shows an update badge, blocks damage, and requires the force owner to recheck repairs on update', async () => {
        const runtime = createDirectMekRuntimeFixture();
        const revision = signal(0);
        const records = signal([{ uuid: runtime.identity, hash: 'b'.repeat(27), owned: false, subscribed: true, source: 'new source', format: 'mtf' } as SavedCustomUnit]);
        const member = { id: runtime.instance.instanceId, entity: runtime.entity,
            mekRecordSheetSnapshot: () => { revision(); return null; }, nonMekRecordSheetSnapshot: () => null,
            force: { readOnly: () => false, getUnitSnapshot: () => ({ ...runtime.instance.captureRuntime(), entity: runtime.entity,
                nativeSource: { sourceHash: 'a'.repeat(27) } }) },
        } as unknown as CBTForceMember;
        const apply = jasmine.createSpy('apply').and.resolveTo(member);
        TestBed.configureTestingModule({ providers: [provideZonelessChangeDetection(),
            { provide: CustomUnitSyncService, useValue: { library: { records, isOwned: () => false,
                hasUpdate: () => true, parseDraft: () => runtime.entity } } },
            { provide: ConstructionForceService, useValue: { captureOrigins: () => new Map(), applySavedConstruction: apply } },
            { provide: ToastService, useValue: { showToast: () => {} } },
        ] });
        const fixture = TestBed.createComponent(CustomUnitActionsComponent);
        fixture.componentRef.setInput('unit', createEmptyUnit({ uuid: runtime.identity, isCustom: true }));
        fixture.componentRef.setInput('member', member); fixture.detectChanges();
        expect(fixture.nativeElement.textContent).toContain('Update available');
        expect(fixture.componentInstance.canUpdate()).toBeTrue();
        const face = [...runtime.index.armorFaces.values()].find(f => f.maximumPoints > 0)!;
        runtime.instance.dispatch({ type: 'damage-armor', faceId: face.id, amount: 1, target: 'committed' }); revision.update(v => v + 1);
        fixture.detectChanges();
        expect(fixture.componentInstance.canUpdate()).toBeFalse();
        await fixture.componentInstance.update(); expect(apply).not.toHaveBeenCalled();
        runtime.instance.dispatch({ type: 'repair-armor', faceId: face.id, amount: 1, target: 'committed' }); revision.update(v => v + 1);
        await fixture.componentInstance.update();
        expect(apply).toHaveBeenCalledOnceWith(member, records()[0], runtime.entity, new Map(), undefined, true);
    });
});
