// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
import { provideZonelessChangeDetection, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { CustomUnitUpdateComponent } from './custom-unit-update.component';
import { CustomUnitSyncService } from '../../services/custom-unit-sync.service';
import { ConstructionForceService } from '../../construction/construction-force.service';
import { DataService } from '../../services/data.service';
import { ToastService } from '../../services/toast.service';
import { PlayerNamesService } from '../../services/player-names.service';
import { createEmptyUnit } from '../../testing/unit-test-helpers';
import { createDirectMekRuntimeFixture } from '../../models/runtime/testing/direct-mek-runtime-fixture';
import type { SavedCustomUnit } from '../../models/custom-unit.model';
import type { CBTForceMember } from '../../models/force-member.model';

describe('custom unit design update line', () => {
    it('says who saved the newer design and its BV, blocks a damaged unit, and applies the update once repaired', async () => {
        const runtime = createDirectMekRuntimeFixture();
        const revision = signal(0);
        const records = signal([{ uuid: runtime.identity, hash: 'b'.repeat(27), owned: false, subscribed: true,
            ownerId: 'public-owner', updatedAt: Date.UTC(2026, 10, 16, 12), source: 'new source', format: 'mtf' } as SavedCustomUnit]);
        const member = { id: runtime.instance.instanceId, entity: runtime.entity,
            mekRecordSheetSnapshot: () => { revision(); return null; }, nonMekRecordSheetSnapshot: () => null,
            force: { readOnly: () => false, getUnitSnapshot: () => ({ ...runtime.instance.captureRuntime(), entity: runtime.entity,
                nativeSource: { sourceHash: 'a'.repeat(27) } }) },
        } as unknown as CBTForceMember;
        const apply = jasmine.createSpy('apply').and.resolveTo(member);
        TestBed.configureTestingModule({ providers: [provideZonelessChangeDetection(),
            { provide: CustomUnitSyncService, useValue: { library: { records, hasUpdate: () => true, parseDraft: () => runtime.entity } } },
            { provide: ConstructionForceService, useValue: { captureOrigins: () => new Map(), applySavedConstruction: apply } },
            { provide: DataService, useValue: { getUnitByUuid: () => ({ bv: 1903 }) } },
            { provide: ToastService, useValue: { showToast: () => {} } },
            { provide: PlayerNamesService, useValue: { label: () => '@Specter' } },
        ] });
        const fixture = TestBed.createComponent(CustomUnitUpdateComponent);
        fixture.componentRef.setInput('unit', createEmptyUnit({ uuid: runtime.identity, isCustom: true, bv: 1906 }));
        fixture.componentRef.setInput('member', member); fixture.detectChanges();
        const text = () => fixture.nativeElement.textContent.replace(/\s+/g, ' ');
        expect(text()).toContain('A newer version of this design was saved by @Specter on');
        expect(text()).toContain('(BV 1,906 → 1,903).');
        expect(text()).not.toContain('Repair this unit');

        const face = [...runtime.index.armorFaces.values()].find(f => f.maximumPoints > 0)!;
        runtime.instance.dispatch({ type: 'damage-armor', faceId: face.id, amount: 1, target: 'committed' }); revision.update(v => v + 1);
        fixture.detectChanges();
        expect(text()).toContain('Repair this unit and finish its pending changes to update it.');
        expect((fixture.nativeElement.querySelector('button') as HTMLButtonElement).disabled).toBeTrue();
        await fixture.componentInstance.update(); expect(apply).not.toHaveBeenCalled();

        runtime.instance.dispatch({ type: 'repair-armor', faceId: face.id, amount: 1, target: 'committed' }); revision.update(v => v + 1);
        await fixture.componentInstance.update();
        expect(apply).toHaveBeenCalledOnceWith(member, records()[0], runtime.entity, new Map(), undefined, true);
    });
});
