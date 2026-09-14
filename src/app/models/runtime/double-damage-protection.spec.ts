// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import type { CBTRuleset } from '../cbt-ruleset.model';
import { MountedArmor, MountedStructure } from '../entity/components';
import { mekLocationId } from '../entity/mek-entity-conventions';
import { STRUCTURE_TYPE } from '../entity/types';
import { ArmorEquipment, StructureEquipment } from '../equipment.model';
import { createMekHeatContextV2 } from './mek-heat-state-v2';
import { createMekMechanicsContextV2 } from './mek-mechanics-context-v2';
import { resolveMekFallArmorDamage, resolveMekStructureDamage } from './mek-fall-rules';
import { buildMekRuntimeIndex } from './mek-runtime-index';
import { restoreSerializedCBTUnitV2, serializeCBTUnitStateV2 } from './runtime-state-codec-v2';
import { createDirectMekRuntimeFixture } from './testing/direct-mek-runtime-fixture';
import { createMekRuntimeForTest } from './testing/unit-runtime-owner-fixture';
import { initializeUnitState } from './unit-state-initializer';

function fixture(ruleset: CBTRuleset) {
    const { entity, identity } = createDirectMekRuntimeFixture(ruleset);
    entity.setArmorAt('CT', new MountedArmor({ armor: new ArmorEquipment({
        id: 'Hardened Armor', name: 'Hardened', type: 'armor',
        flags: ['F_HARDENED_ARMOR'], armor: { type: 'HARDENED' },
    }) }));
    entity.setStructureAt('CT', new MountedStructure({ tonnage: entity.tonnage(), structure: new StructureEquipment({
        id: 'Reinforced Structure', name: 'Reinforced', type: 'structure',
        flags: ['F_REINFORCED'], structure: { typeId: STRUCTURE_TYPE.REINFORCED },
    }) }));
    const index = buildMekRuntimeIndex(entity);
    const scenario = { id: 'megamek' };
    const initialized = initializeUnitState(entity, index, identity, {
        initializerRevision: 1, profileId: 'pristine', deployment: { id: 'default' }, scenario: { ...scenario, ruleset },
    });
    const heat = createMekHeatContextV2(entity, index, ruleset, scenario);
    const mechanics = createMekMechanicsContextV2(entity, index, ruleset, scenario);
    const instance = createMekRuntimeForTest('double-damage', initialized.baselineRef, entity, index,
        ruleset, initialized.state, initialized.deployment.crewAssignment, heat, mechanics);
    const location = index.locations.get(mekLocationId('CT')!)!;
    const front = index.armorFaces.get(location.armorFaceIds[0])!;
    return { entity, index, initialized, instance, location, front };
}

describe('double-damage protection', () => {
    for (const ruleset of ['core-2026', 'total-warfare'] as const) {
        it(`doubles only the installed material's runtime capacity in ${ruleset}`, () => {
            const { entity, index, location, front } = fixture(ruleset);
            expect(location.internalPoints).toBe(entity.structureValues().get('CT')! * 2);
            expect(front.maximumPoints).toBe(entity.armorValues().get('CT')!.front * 2);
            const rear = index.armorFaces.get(location.armorFaceIds[1])!;
            expect(rear.maximumPoints).toBe(entity.armorValues().get('CT')!.rear * 2);
            const ordinary = index.locations.get(mekLocationId('LT')!)!;
            expect(ordinary.internalPoints).toBe(entity.structureValues().get('LT')!);
            expect(index.armorFaces.get(ordinary.armorFaceIds[0])!.maximumPoints)
                .toBe(entity.armorValues().get('LT')!.front);
        });

        it(`requires both halves before counting a lost pip or destroying a location in ${ruleset}`, () => {
            const { entity, instance, location, front } = fixture(ruleset);
            const pristineBv = instance.query().mekBattleValue();
            expect(pristineBv.kind).toBe('complete');
            for (const amount of [1, 1]) {
                expect(instance.dispatch({ type: 'damage-armor', faceId: front.id, amount, target: 'committed' }).accepted).toBeTrue();
                expect(instance.dispatch({ type: 'damage-internal', locationId: location.id, amount, target: 'committed' }).accepted).toBeTrue();
                const remaining = instance.query().remainingInternal(location.id);
                if (remaining === location.internalPoints - 1) {
                    expect(instance.query().mekMovementPsrState().damageThisPhase).toBe(0);
                    expect(instance.query().mekBattleValue()).toEqual(pristineBv);
                } else {
                    expect(instance.query().mekMovementPsrState().damageThisPhase).toBe(2);
                }
            }
            const constructionPoints = entity.structureValues().get('CT')!;
            expect(instance.dispatch({ type: 'damage-internal', locationId: location.id,
                amount: constructionPoints - 2, target: 'committed' }).accepted).toBeTrue();
            expect(instance.query().destroyed()).toBeFalse();
            expect(instance.query().remainingInternal(location.id)).toBe(constructionPoints);
            expect(instance.dispatch({ type: 'damage-internal', locationId: location.id,
                amount: constructionPoints - 1, target: 'committed' }).accepted).toBeTrue();
            expect(instance.query().destroyed()).toBeFalse();
            expect(instance.dispatch({ type: 'damage-internal', locationId: location.id,
                amount: 1, target: 'committed' }).accepted).toBeTrue();
            expect(instance.query().destroyed()).toBeTrue();
        });

        it(`preserves odd half-pip damage, pending repair and save/load in ${ruleset}`, async () => {
            const { entity, index, initialized, instance, location, front } = fixture(ruleset);
            const damage = location.internalPoints - 1;
            expect(instance.dispatch({ type: 'damage-internal', locationId: location.id, amount: damage, target: 'committed' }).accepted).toBeTrue();
            expect(instance.dispatch({ type: 'damage-armor', faceId: front.id, amount: 1, target: 'committed' }).accepted).toBeTrue();
            expect(instance.dispatch({ type: 'repair-internal', locationId: location.id, amount: 1, target: 'pending' }).accepted).toBeTrue();
            expect(instance.query().remainingInternal(location.id, 'preview')).toBe(2);
            expect(instance.query().remainingInternal(location.id, 'committed')).toBe(1);
            const saved = serializeCBTUnitStateV2({ entity, index, instanceId: instance.instanceId,
                baselineRef: instance.baselineRef, state: instance.snapshot(),
                deployment: { schemaVersion: 2, values: initialized.deployment } });
            const restored = await restoreSerializedCBTUnitV2(JSON.parse(JSON.stringify(saved)), entity, index, initialized);
            expect(restored.state.locations.get(location.id)!.internalDamage).toBe(damage);
            expect(restored.state.pendingCombat.locationInternalDamage.get(location.id)).toBe(-1);
            expect(restored.state.locations.get(location.id)!.armorDamage[0].damage).toBe(1);
            expect(instance.dispatch({ type: 'commit-pending' }).accepted).toBeTrue();
            expect(instance.query().remainingInternal(location.id, 'committed')).toBe(2);
        });
    }

    it('uses the last half-pip before transferring overflow damage', () => {
        expect(resolveMekStructureDamage(3, 1, 'reinforced')).toEqual({ internalDamage: 1, overflowDamage: 2 });
        expect(resolveMekStructureDamage(3, 4, 'reinforced')).toEqual({ internalDamage: 3, overflowDamage: 0 });
        expect(resolveMekFallArmorDamage('core-2026', 3, 1, 'HARDENED'))
            .toEqual({ armorDamage: 1, remainingDamage: 2, appliedDamage: 1 });
    });
});
