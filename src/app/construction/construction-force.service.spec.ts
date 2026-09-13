// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import { provideZonelessChangeDetection } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import type { CBTForce } from '../models/cbt-force.model';
import type { SavedCustomUnit } from '../models/custom-unit.model';
import { parseEntity } from '../models/entity/parse-entity';
import { encodeNativeEntity } from '../models/entity/write-entity';
import { CBTForceMember } from '../models/force-member.model';
import { createDirectMekRuntimeFixture } from '../models/runtime/testing/direct-mek-runtime-fixture';
import { CustomUnitsService } from '../services/custom-units.service';
import { asUnitUuid } from '../services/unit-catalog/unit-catalog.types';
import { ConstructionForceService } from './construction-force.service';

describe('ConstructionForceService', () => {
    function fixture() {
        const fixture = createDirectMekRuntimeFixture();
        const parseDraft = (source: string) => parseEntity(source, 'refit.mtf', fixture.equipment).entity;
        TestBed.configureTestingModule({ providers: [provideZonelessChangeDetection(),
            { provide: CustomUnitsService, useValue: { parseDraft } }] });
        const service = TestBed.inject(ConstructionForceService);
        const applyConstruction = jasmine.createSpy('applyConstruction').and.callFake(async member => member);
        const force = { readOnly: () => false, applyConstruction,
            getMekRecordSheetSnapshot: () => null,
            getUnitSnapshot: () => ({ entity: fixture.entity, ruleset: fixture.instance.ruleset(), ...fixture.instance.captureRuntime() }),
        } as unknown as CBTForce;
        const member = new CBTForceMember(fixture.instance.instanceId, force, fixture.entity);
        const draft = parseDraft(encodeNativeEntity(fixture.entity));
        return { ...fixture, service, member, draft, parseDraft, applyConstruction };
    }

    it('projects preview armor, internal and partial critical damage while new equipment stays pristine', () => {
        const f = fixture();
        const origins = new Map(f.service.captureOrigins(f.member, f.draft));
        const weapon = f.equipmentComponent('Test AC');
        const targetMount = [...origins].find(([, origin]) => origin === weapon.mount.mountId)![0];
        const face = [...f.index.armorFaces.values()].find(face => face.face === 'front' && face.maximumPoints >= 5)!;
        const location = f.index.locations.get(face.locationId)!;
        const slot = [...f.index.slots.values()].find(slot => slot.componentIds.includes(weapon.id))!;
        f.instance.dispatch({ type: 'damage-armor', faceId: face.id, amount: 3, target: 'pending' });
        f.instance.dispatch({ type: 'damage-internal', locationId: location.id, amount: 1, target: 'pending' });
        f.instance.dispatch({ type: 'hit-critical', slotId: slot.id, hits: 1, target: 'committed' });
        let damage = f.service.damage(f.member, f.draft, origins);
        expect(damage.armorDamage(location.code)).toBe(3);
        expect(damage.internalDamage(location.code)).toBe(1);
        expect(damage.mountHits(targetMount)).toBe(1);
        expect(damage.mountStatus(targetMount)).toBe(f.instance.query().componentStatus(weapon.id, 'preview'));
        origins.delete(targetMount);
        damage = f.service.damage(f.member, f.draft, origins);
        expect(damage.mountHits(targetMount)).toBe(0);
        expect(damage.mountStatus(targetMount)).toBe('available');
    });

    it('rekeys only retained origins across native undo replay', () => {
        const f = fixture();
        const origins = new Map(f.service.captureOrigins(f.member, f.draft));
        const missing = [...origins.keys()][0];
        origins.delete(missing);
        const restored = f.parseDraft(encodeNativeEntity(f.draft));
        const remapped = f.service.remapOrigins(f.draft, restored, origins);
        expect(remapped.size).toBe(origins.size);
        expect([...remapped.values()].sort()).toEqual([...origins.values()].sort());
    });

    it('applies the saved source snapshot and UUID with a native source hash, independent of later draft edits', async () => {
        const f = fixture();
        const origins = f.service.captureOrigins(f.member, f.draft);
        const saved: SavedCustomUnit = { schemaVersion: 1, uuid: asUnitUuid('019f6767-0dcb-7bb8-992f-000000000066'),
            originalUnitUuid: f.identity, createdAt: 1, updatedAt: 1, format: 'mtf', source: encodeNativeEntity(f.draft) };
        const model = f.draft.model();
        f.draft.model.set('A later change');
        await f.service.applySavedConstruction(f.member, saved, f.draft, origins);
        const [member, { entity: applied, source: native, origins: mapped }] = f.applyConstruction.calls.mostRecent().args;
        expect(member).toBe(f.member);
        expect(applied.uuid()).toBe(saved.uuid);
        expect(applied.model()).toBe(model);
        expect(new TextDecoder().decode(native.bytes)).toBe(saved.source);
        expect(native.sourceHashCanary.length).toBe(4);
        expect(native.sourceHash.length).toBe(27);
        expect(mapped.size).toBe(origins.size);
        expect(f.entity.uuid()).toBe(f.identity);
    });
});
