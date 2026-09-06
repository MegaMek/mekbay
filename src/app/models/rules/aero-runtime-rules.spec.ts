// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import { asUnitUuid } from '../../services/unit-catalog/unit-catalog.types';
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
import type { CBTNonMekUnit } from '../runtime/cbt-unit';

import { isAeroEntity } from '../entity/utils/entity-type-guards';
import { type InstanceBaselineRef } from '../runtime/runtime-state';
import { aeroHeatEffects,projectAeroRuntimeRules } from './aero-runtime-rules';
import { systemDamageId } from './system-damage-rules';

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
            type: 'set-pending-heat',
            
            heat: 24,

        }).accepted).toBeTrue();
        expect(runtime.snapshot().heat).toEqual({
            current: 0,
            previous: 0,
            pendingOverride: 24,
            heatsinksOff: 0,
        });
        expect(project(runtime).heat.effects.fireModifier).toBe(0);

        expect(runtime.dispatch({
            type: 'set-heatsinks-off',
            
            heatsinksOff: 2,
        }).accepted).toBeTrue();
        expect(runtime.dispatch({
            type: 'end-phase',
            
        }).accepted).toBeTrue();

        const projection = project(runtime);
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
            type: 'set-internal-damage',
            
            locationId: si.id,
            damage: si.internalPoints,
        });
        expect(bySi.query().destroyed()).toBeTrue();

        for (const damageTrackId of [systemDamageId('engine', 3), systemDamageId('fire-control', 3)]) {
            const runtime = fighter(`unit:aero-${damageTrackId}`);
            runtime.dispatch({
                type: 'damage-track',
                
                damageTrackId,
                amount: 1,
                target: 'committed',
                timestamp: 1,
            });
            expect(runtime.query().destroyed()).withContext(damageTrackId).toBeTrue();
        }
    });

    it('keeps a large craft operational at three engine hits and destroys it at six', () => {
        const entity = new TestDropShipEntity();
        entity.structuralIntegrity.set(8);
        const runtime = aero(entity, 'unit:large-engine');
        for (const stage of [3, 6]) {
            expect(runtime.dispatch({ type: 'damage-track', damageTrackId: systemDamageId('engine', stage),
                amount: 1, target: 'committed', timestamp: stage }).accepted).toBeTrue();
            expect(runtime.query().destroyed()).withContext(`Engine stage ${stage}`).toBe(stage === 6);
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
            expect(project(runtime).heat.tracked)
                .withContext(entity.entityType).toBe(entity.tracksHeat());

            const si = [...runtime.getIndex().locations.values()]
                .find(location => location.code === 'SI')!;
            expect(runtime.dispatch({
                type: 'set-internal-damage',
                
                locationId: si.id,
                damage: si.internalPoints,
            }).accepted).withContext(entity.entityType).toBeTrue();
            expect(runtime.query().destroyed()).withContext(entity.entityType).toBeTrue();
        }
    });
});

const UUID = asUnitUuid('019f6767-0dcb-7bb8-992f-aef08202f5e2');

function fighter(id: string): CBTNonMekUnit {
    const entity = new TestAeroSpaceFighterEntity();
    entity.structuralIntegrity.set(8);
    entity.heatSinkCount.set(10);
    entity.heatSinkType.set('Double');
    return aero(entity, id);
}

function aero(entity: AeroEntity, id: string): CBTNonMekUnit {
    entity.uuid.set(UUID);
    return createNonMekRuntimeForTest(
        id,
        baseline(),
        entity,
        CORE_2026_RULESET,
    );
}

function project(runtime: CBTNonMekUnit) {
    const entity = runtime.getUnit();
    if (!isAeroEntity(entity)) throw new Error('Expected aerospace fixture');
    return projectAeroRuntimeRules(entity, runtime.getIndex(), runtime.snapshot(), runtime.ruleset());
}

function baseline(): InstanceBaselineRef {
    return Object.freeze({
        entity: UUID,
        ruleset: CORE_2026_RULESET,
        initialStateProfile: Object.freeze({
            schemaVersion: 1 as const,
            initializerRevision: 1,
            profileId: 'pristine-non-mek-v1',
        }),
    });
}

import { createNonMekRuntimeForTest } from '../runtime/testing/unit-runtime-owner-fixture';
