// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import { CONSTRUCTION_UNIT_TYPES, createConstructionEntity } from '../../construction/domain/construction-factory';
import { setConstructionArmor } from '../../construction/domain/construction-rules';
import { asUnitUuid, makeUnitFileName } from '../../services/unit-catalog/unit-catalog.types';
import type { BaseEntity } from '../entity/base-entity';
import { MekEntity } from '../entity/entities/mek/mek-entity';
import { parseEntity } from '../entity/parse-entity';
import { createTestEquipmentRegistry } from '../entity/testing/test-equipment-registry';
import { matchNativeMounts } from '../entity/utils/native-mount-correspondence';
import { encodeNativeEntity } from '../entity/write-entity';
import type { NativeUnitSourceHandle } from '../native-unit-source-handle';
import { createMekUnit, restoreMekUnit } from './cbt-mek-unit';
import { createNonMekUnit, restoreNonMekUnit } from './cbt-non-mek-unit';
import { isCBTMekUnit, isCBTNonMekUnit } from './cbt-unit';
import { prepareConstructionRefit } from './unit-construction-refit';
import { createDirectMekRuntimeFixture } from './testing/direct-mek-runtime-fixture';

const CUSTOM = asUnitUuid('019f6767-0dcb-7bb8-992f-000000000045');
const CORE = asUnitUuid('019f6767-0dcb-7bb8-992f-000000000044');
const SCENARIO = { id: 'construction-test', ruleset: 'core-2026' as const };
const OPTIONS = { initializerRevision: 1, profileId: 'pristine', deployment: { id: 'test' }, scenario: SCENARIO };

function detach(entity: BaseEntity): BaseEntity {
    const format = entity instanceof MekEntity ? 'mtf' : 'blk';
    const result = parseEntity(encodeNativeEntity(entity), `construction.${format}`, entity.getEquipmentRegistry()).entity;
    result.uuid.set(CUSTOM);
    return result;
}

function source(entity: BaseEntity): NativeUnitSourceHandle {
    const format = entity instanceof MekEntity ? 'mtf' : 'blk';
    return { file: makeUnitFileName(entity.uuid(), format), format,
        bytes: new TextEncoder().encode(encodeNativeEntity(entity)).buffer as ArrayBuffer };
}

describe('Unit construction runtime refit', () => {
    it('retains Mek armor, internal, component, critical, ammunition and crew damage across native ID reordering', async () => {
        const fixture = createDirectMekRuntimeFixture();
        const original = fixture.instance;
        const weapon = fixture.equipmentComponent('Test AC');
        const ammo = fixture.equipmentComponent('Test Ammo');
        const slot = [...fixture.index.slots.values()].find(slot => slot.componentIds.includes(weapon.id))!;
        const face = [...fixture.index.armorFaces.values()].find(face => face.maximumPoints >= 5)!;
        const location = fixture.index.locations.get(face.locationId)!;
        const crew = [...fixture.index.crewPositions.keys()][0];
        expect(original.dispatch({ type: 'damage-armor', faceId: face.id, amount: 3, target: 'committed' }).changed).toBeTrue();
        expect(original.dispatch({ type: 'damage-internal', locationId: location.id, amount: 1, target: 'pending' }).changed).toBeTrue();
        expect(original.dispatch({ type: 'hit-critical', slotId: slot.id, hits: 1, target: 'committed' }).changed).toBeTrue();
        expect(original.dispatch({ type: 'spend-ammo', componentId: ammo.id, amount: 2 }).changed).toBeTrue();
        expect(original.dispatch({ type: 'set-crew-state', positionId: crew, wounds: 1, unconscious: false, ejected: false }).changed).toBeTrue();
        const before = original.serialize();
        const draft = detach(fixture.entity);
        const origins = matchNativeMounts(fixture.entity, draft);
        const refit = await prepareConstructionRefit(original, draft, source(draft), origins, SCENARIO);
        const next = refit.unit;
        expect(next.uuid).toBe(CUSTOM);
        expect(next.instanceId).toBe(original.instanceId);
        expect(next.query().remainingArmor(face.id)).toBe(original.query().remainingArmor(face.id));
        expect(next.query().remainingInternal(location.id, 'preview')).toBe(original.query().remainingInternal(location.id, 'preview'));
        expect(next.query().remainingAmmo(refit.componentIds.get(ammo.id)!)).toBe(original.query().remainingAmmo(ammo.id));
        expect(next.query().componentStatus(refit.componentIds.get(weapon.id)!)).toBe(original.query().componentStatus(weapon.id));
        expect(next.query().crewState(crew).wounds).toBe(1);
        expect(original.serialize()).toEqual(before);
        if (!isCBTMekUnit(next)) throw new Error('Expected Mek runtime');
        const restored = await restoreMekUnit(next.serialize(), next.getUnit(), CUSTOM, OPTIONS, next.getNativeSource());
        expect(restored.serialize()).toEqual(next.serialize());
    });

    it('new equipment is pristine even when the native writer reuses a destroyed mount’s ID and slot', async () => {
        const fixture = createDirectMekRuntimeFixture();
        const original = fixture.instance;
        const weapon = fixture.equipmentComponent('Test AC');
        const slot = [...fixture.index.slots.values()].find(slot => slot.componentIds.includes(weapon.id))!;
        original.dispatch({ type: 'hit-critical', slotId: slot.id, hits: 1, target: 'committed' });
        original.dispatch({ type: 'set-component-status', componentId: weapon.id, status: 'destroyed', target: 'committed' });
        const draft = detach(fixture.entity);
        const origins = new Map(matchNativeMounts(fixture.entity, draft));
        const replacement = [...origins].find(([, originalId]) => originalId === weapon.mount.mountId)![0];
        origins.delete(replacement);
        const next = (await prepareConstructionRefit(original, draft, source(draft), origins, SCENARIO)).unit;
        const newWeapon = [...next.getIndex().components.values()].find(component => component.mount?.mountId === replacement)!;
        expect(next.query().componentStatus(newWeapon.id)).toBe('available');
        if (!isCBTMekUnit(next)) throw new Error('Expected Mek runtime');
        expect(next.snapshot().slots.size).toBe(0);
        expect(original.query().componentStatus(weapon.id)).toBe('destroyed');
    });

    it('clamps lowered armor and removes empty pending deltas without repairing the source', async () => {
        const fixture = createDirectMekRuntimeFixture();
        const face = [...fixture.index.armorFaces.values()].find(face => face.face === 'front' && face.maximumPoints >= 5)!;
        fixture.instance.dispatch({ type: 'damage-armor', faceId: face.id, amount: 3, target: 'committed' });
        fixture.instance.dispatch({ type: 'damage-armor', faceId: face.id, amount: 1, target: 'pending' });
        const draft = detach(fixture.entity);
        setConstructionArmor(draft, fixture.index.locations.get(face.locationId)!.code, 2);
        const next = (await prepareConstructionRefit(fixture.instance, draft, source(draft), matchNativeMounts(fixture.entity, draft), SCENARIO)).unit;
        expect(next.query().remainingArmor(face.id, 'preview')).toBe(0);
        expect(next.snapshot().pendingCombat.armorDamage.size).toBe(0);
        expect(fixture.instance.query().remainingArmor(face.id)).toBe(face.maximumPoints - 3);
    });

    it('moving retained equipment out of a destroyed location does not repair that equipment', async () => {
        const fixture = createDirectMekRuntimeFixture();
        const weapon = fixture.equipmentComponent('Test AC');
        const location = [...fixture.index.locations.values()].find(location => location.code === weapon.mount.location)!;
        fixture.instance.dispatch({ type: 'damage-internal', locationId: location.id,
            amount: location.internalPoints, target: 'committed' });
        expect(fixture.instance.query().componentStatus(weapon.id)).toBe('destroyed');
        const draft = detach(fixture.entity);
        const origins = matchNativeMounts(fixture.entity, draft);
        const moving = draft.equipment().find(mount => origins.get(mount.mountId) === weapon.mount.mountId)!;
        draft.moveEquipment(moving, 'LL', [{ location: 'LL', slotIndex: 4 }]);
        const prepared = await prepareConstructionRefit(fixture.instance, draft, source(draft), origins, SCENARIO);
        expect(prepared.unit.query().componentStatus(prepared.componentIds.get(weapon.id)!)).toBe('destroyed');
    });

    for (const kind of CONSTRUCTION_UNIT_TYPES) {
        it(`retains sparse damage and native source through a ${kind.label} refit`, async () => {
            // Force admission always starts with a parsed native design, not an in-progress factory draft.
            const entity = detach(createConstructionEntity(kind.id, createTestEquipmentRegistry()));
            entity.uuid.set(CORE);
            const original = entity instanceof MekEntity
                ? await createMekUnit({ uuid: CORE, instanceId: `unit:refit:${kind.id}` }, entity, CORE, OPTIONS, source(entity))
                : createNonMekUnit(entity, { uuid: CORE, instanceId: `unit:refit:${kind.id}`, deployment: OPTIONS.deployment,
                    scenario: SCENARIO, initialStateProfileId: 'pristine' }, source(entity));
            const face = [...original.getIndex().armorFaces.values()].find(face => face.maximumPoints > 1);
            if (face) original.dispatch({ type: 'damage-armor', faceId: face.id, amount: 1, target: 'committed' });
            const location = [...original.getIndex().locations.values()].find(location => location.internalPoints > 0);
            if (location) expect(original.dispatch({ type: 'damage-internal', locationId: location.id,
                amount: 1, target: 'pending' }).changed).toBeTrue();
            const draft = detach(entity);
            draft.model.set('Refitted');
            const next = (await prepareConstructionRefit(original, draft, source(draft), matchNativeMounts(entity, draft), SCENARIO)).unit;
            expect(next.uuid).toBe(CUSTOM);
            expect(next.instanceId).toBe(original.instanceId);
            expect(next.getUnit().model()).toBe('Refitted');
            expect(next.getNativeSource()!.bytes.byteLength).toBeGreaterThan(0);
            if (face) expect(next.query().remainingArmor(face.id)).toBe(original.query().remainingArmor(face.id));
            if (location) expect(next.query().remainingInternal(location.id, 'preview')).toBe(original.query().remainingInternal(location.id, 'preview'));
            const restored = isCBTMekUnit(next)
                ? await restoreMekUnit(next.serialize(), next.getUnit(), CUSTOM, OPTIONS, next.getNativeSource())
                : isCBTNonMekUnit(next) ? restoreNonMekUnit(next.serialize(), next.getUnit(), CUSTOM, SCENARIO, next.getNativeSource())
                : next;
            expect(restored.serialize()).toEqual(next.serialize());
        });
    }
});
