// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import { CORE_2026_RULESET } from '../cbt-ruleset.model';
import type { AeroEntity } from '../entity/entities/aero/aero-entity';
import {
    TestAeroSpaceFighterEntity,
    TestDropShipEntity,
    TestJumpShipEntity,
    TestSmallCraftEntity,
    TestSpaceStationEntity,
    TestWarShipEntity,
} from '../entity/testing/test-entities';
import { asUnitUuid, MM_DATA_UNIT_PROVIDER_ID } from '../../services/unit-catalog/unit-catalog.types';
import { NonMekUnitInstance } from '../runtime/non-mek-unit-instance';
import { asUnitInstanceId, type InstanceBaselineRef } from '../runtime/runtime-state';
import { nonMekDamageTrackId } from './non-mek-damage-track-rules';
import { aeroHeatEffects } from './aero-runtime-rules';

describe('Aero runtime rules', () => {
    it('ports the production aerospace heat scale', () => {
        expect(aeroHeatEffects(7)).toEqual({ fireModifier: 0, randomMovementTarget: 5 });
        expect(aeroHeatEffects(8)).toEqual({ fireModifier: 1, randomMovementTarget: 5 });
        expect(aeroHeatEffects(24)).toEqual({
            fireModifier: 4,
            randomMovementTarget: 8,
            shutdownTarget: 8,
            ammoExplosionTarget: 6,
            pilotDamageTarget: 6,
        });
        expect(aeroHeatEffects(30)).toEqual({
            fireModifier: 4,
            randomMovementTarget: 10,
            shutdownTarget: 100,
            ammoExplosionTarget: 8,
            pilotDamageTarget: 9,
        });
    });

    it('commits preview heat and applies the named fire modifier and disabled sinks', () => {
        const runtime = fighter('unit:aero-heat');
        expect(runtime.dispatch({
            kind: 'set-heat',
            expectedRevision: runtime.revision(),
            heat: 24,
            target: 'pending',
        }).accepted).toBeTrue();
        expect(runtime.snapshot().heat).toEqual({
            current: 0,
            previous: 0,
            pendingOverride: 24,
            heatsinksOff: 0,
        });
        expect(runtime.aeroRules()!.heat.effects.fireModifier).toBe(0);

        expect(runtime.dispatch({
            kind: 'set-heatsinks-off',
            expectedRevision: runtime.revision(),
            heatsinksOff: 2,
        }).accepted).toBeTrue();
        expect(runtime.dispatch({
            kind: 'end-phase',
            expectedRevision: runtime.revision(),
        }).accepted).toBeTrue();

        const projection = runtime.aeroRules()!;
        expect(runtime.snapshot().heat).toEqual({
            current: 24,
            previous: 0,
            heatsinksOff: 2,
        });
        expect(projection.heat.dissipation).toBe(16);
        expect(projection.modifiers.ranged).toEqual([{
            label: 'Heat - Fire Modifier',
            modifier: 4,
            weakened: true,
            kind: 'heat',
        }]);
        expect(projection.modifiers.physical).toEqual([]);
    });

    it('derives destruction from SI, the third engine hit, or the third FCS hit', () => {
        const bySi = fighter('unit:aero-si');
        const si = [...bySi.getIndex().locations.values()].find(location => location.code === 'SI')!;
        bySi.dispatch({
            kind: 'set-internal-damage',
            expectedRevision: bySi.revision(),
            locationId: si.id,
            damage: si.internalPoints,
        });
        expect(bySi.destroyed()).toBeTrue();

        for (const sheetId of ['engine_hit_3', 'fcs_hit_3']) {
            const runtime = fighter(`unit:aero-${sheetId}`);
            runtime.dispatch({
                kind: 'damage-track',
                expectedRevision: runtime.revision(),
                damageTrackId: nonMekDamageTrackId(sheetId),
                amount: 1,
                target: 'committed',
                timestamp: 1,
            });
            expect(runtime.destroyed()).withContext(sheetId).toBeTrue();
        }
    });

    it('uses the same direct rules owner across fighters and every large-craft family', () => {
        const families = [
            new TestAeroSpaceFighterEntity(),
            new TestSmallCraftEntity(),
            new TestDropShipEntity(),
            new TestJumpShipEntity(),
            new TestWarShipEntity(),
            new TestSpaceStationEntity(),
        ];
        for (const [index, entity] of families.entries()) {
            entity.structuralIntegrity.set(4);
            entity.heatSinkCount.set(10);
            const runtime = aero(entity, `unit:aero-family-${index}`);
            expect(runtime.aeroRules()!.heat.tracked)
                .withContext(entity.entityType).toBe(entity.tracksHeat());

            const si = [...runtime.getIndex().locations.values()]
                .find(location => location.code === 'SI')!;
            expect(runtime.dispatch({
                kind: 'set-internal-damage',
                expectedRevision: runtime.revision(),
                locationId: si.id,
                damage: si.internalPoints,
            }).accepted).withContext(entity.entityType).toBeTrue();
            expect(runtime.destroyed()).withContext(entity.entityType).toBeTrue();
        }
    });
});

const UUID = asUnitUuid('019f6767-0dcb-7bb8-992f-aef08202f5e2');

function fighter(id: string): NonMekUnitInstance {
    const entity = new TestAeroSpaceFighterEntity();
    entity.structuralIntegrity.set(8);
    entity.heatSinkCount.set(10);
    entity.heatSinkType.set('Double');
    return aero(entity, id);
}

function aero(entity: AeroEntity, id: string): NonMekUnitInstance {
    entity.uuid.set(UUID);
    return new NonMekUnitInstance(
        asUnitInstanceId(id),
        baseline(),
        entity,
        CORE_2026_RULESET,
    );
}

function baseline(): InstanceBaselineRef {
    return Object.freeze({
        entity: Object.freeze({
            origin: 'megamek' as const,
            provider: MM_DATA_UNIT_PROVIDER_ID,
            uuid: UUID,
            sourceFormat: 'blk' as const,
        }),
        ruleset: CORE_2026_RULESET,
        initialStateProfile: Object.freeze({
            schemaVersion: 1 as const,
            initializerRevision: 1,
            profileId: 'pristine-non-mek-v1',
        }),
    });
}
