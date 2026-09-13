// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import { TestBipedMekEntity, TestTankEntity } from '../entity/testing/test-entities';
import { createTestEquipmentRegistry } from '../entity/testing/test-equipment-registry';
import { AmmoEquipment } from '../equipment.model';
import { createMekUnit } from './cbt-mek-unit';
import { createNonMekUnit } from './cbt-non-mek-unit';
import { constructionRuntimeBattleValue, constructionRuntimeSource, prepareConstructionRuntime } from './construction-runtime';
import { createDirectMekRuntimeFixture } from './testing/direct-mek-runtime-fixture';
import { encodeNativeEntity } from '../entity/write-entity';
import { parseEntity } from '../entity/parse-entity';
import { matchNativeMounts } from '../entity/utils/native-mount-correspondence';

const standard = new AmmoEquipment({ id: 'Ammo_AC_10', name: 'AC/10 Ammo', type: 'ammo',
    ammo: { type: 'AC', rackSize: 10, shots: 10 } });
const precision = new AmmoEquipment({ id: 'Ammo_AC_10_Precision', name: 'AC/10 Precision Ammo', type: 'ammo',
    ammo: { type: 'AC', rackSize: 10, shots: 5, munitionType: ['M_PRECISION'] } });
const scenario = { id: 'construction-runtime-test', ruleset: 'core-2026' as const };

describe('construction effective Battle Value', () => {
    it('prices repairs against the edited loadout without touching the force', async () => {
        const f = createDirectMekRuntimeFixture();
        const face = [...f.index.armorFaces.values()].find(face => face.maximumPoints >= 5)!;
        f.instance.dispatch({ type: 'damage-armor', faceId: face.id, amount: 5, target: 'committed' });
        const source = constructionRuntimeSource(f.instance);
        const draft = parseEntity(encodeNativeEntity(f.entity), 'draft.mtf', f.equipment).entity;
        const origins = matchNativeMounts(f.entity, draft);
        const weapon = draft.equipment().find(mount => mount.equipment?.id === f.equipmentComponent('Test AC').mount.equipmentId)!;
        draft.removeEquipment(weapon);
        const value = await constructionRuntimeBattleValue(f.instance, draft, origins, [{ type: 'repair-all' }],
            { id: 'megamek', ruleset: f.instance.ruleset() });
        expect(value.effective).toBe(draft.battleValue());
        expect(value.beforeRepairs).not.toBeNull();
        expect(value.beforeRepairs!).toBeLessThan(value.effective!);
        expect(value.effective).toBeLessThan(f.entity.battleValue());
        expect(constructionRuntimeSource(f.instance)).toBe(source);
    });
});

for (const family of ['mek', 'vehicle'] as const) {
    describe(`${family} construction runtime draft`, () => {
        async function fixture() {
            const registry = createTestEquipmentRegistry({ [standard.id]: standard, [precision.id]: precision });
            const entity = family === 'mek' ? new TestBipedMekEntity(registry) : new TestTankEntity(registry);
            entity.setTonnage(55);
            const mount = entity.addEquipment({ equipment: standard, equipmentId: standard.id,
                allocation: { kind: 'location', location: family === 'mek' ? 'LT' : 'Front' },
                shotsCount: 10, rearMounted: false, turretMounted: false, omniPodMounted: false, armored: false });
            const options = { initializerRevision: 1, profileId: 'pristine', deployment: { id: 'test' }, scenario };
            const unit = entity instanceof TestBipedMekEntity
                ? await createMekUnit({ uuid: entity.uuid(), instanceId: `unit:construction:${family}` }, entity, entity.uuid(), options)
                : createNonMekUnit(entity, { uuid: entity.uuid(), instanceId: `unit:construction:${family}`,
                    deployment: options.deployment, scenario, initialStateProfileId: 'pristine' });
            const component = [...unit.getIndex().components.values()].find(component => component.mount?.mountId === mount.mountId)!;
            return { unit, entity, component };
        }

        it('stages ammo selection and quantities without changing the entity or original runtime', async () => {
            const { unit, entity, component } = await fixture();
            const original = constructionRuntimeSource(unit);
            const candidate = await prepareConstructionRuntime(unit, [{ type: 'configure-ammo-source',
                componentId: component.id, munitionKey: precision.id, remaining: 3 }], scenario);
            expect(candidate.query().ammoEquipment(component.id)).toBe(precision);
            expect(candidate.query().remainingAmmo(component.id)).toBe(3);
            expect(candidate.uuid).toBe(unit.uuid);
            expect(candidate.getUnit()).toBe(entity);
            expect(entity.equipment()[0].equipment).toBe(standard);
            expect(constructionRuntimeSource(unit)).toBe(original);
            expect(constructionRuntimeSource(candidate)).not.toBe(original);
        });

        it('treats a restored ammo loadout as unchanged even after its revision advances', async () => {
            const { unit, component } = await fixture();
            const candidate = await prepareConstructionRuntime(unit, [
                { type: 'configure-ammo-source', componentId: component.id, munitionKey: precision.id, remaining: 3 },
                { type: 'configure-ammo-source', componentId: component.id, munitionKey: standard.id, remaining: 10 },
            ], scenario);
            expect(candidate.revision()).toBeGreaterThan(unit.revision());
            expect(constructionRuntimeSource(candidate)).toBe(constructionRuntimeSource(unit));
        });

        it('does not mark an already pristine repair as a gameplay change', async () => {
            const { unit } = await fixture();
            const repaired = await prepareConstructionRuntime(unit, [{ type: 'repair-all' }], scenario);
            expect(constructionRuntimeSource(repaired)).toBe(constructionRuntimeSource(unit));
        });
    });
}
