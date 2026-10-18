// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import { asUnitUuid } from '../services/unit-catalog/unit-catalog.types';
import { CORE_2026_RULESET } from './cbt-ruleset.model';
import { CBTForceC3 } from './cbt-force-c3';
import { TestTankEntity } from './entity/testing/test-entities';
import { addTestEquipmentWithFlags } from './entity/testing/test-mounted-equipment';
import type { ComponentId } from './entity/entity-identifiers';
import type { CBTUnit } from './runtime/cbt-unit';
import { asEncounterNetworkId, type EncounterNetwork } from './runtime/encounter-runtime';
import { createDirectElectronicSuiteRuntimeFixture } from './runtime/testing/direct-mek-runtime-fixture';
import { createNonMekRuntimeForTest } from './runtime/testing/unit-runtime-owner-fixture';
import { componentIdForMount } from './runtime/unit-runtime-index';

interface NovaFixture {
    readonly unit: CBTUnit;
    readonly componentId: ComponentId;
}

const novaFixtures: Readonly<Record<string, (instanceId: string) => NovaFixture>> = {
    Mek: instanceId => {
        const fixture = createDirectElectronicSuiteRuntimeFixture(CORE_2026_RULESET, instanceId);
        const componentId = fixture.equipmentComponent('Test Nova CEWS').id;
        // This fixture also has ECM suites; select Nova before exercising its power lifecycle.
        fixture.instance.dispatch({ type: 'set-component-mode', componentId, mode: 'enabling' });
        fixture.instance.dispatch({ type: 'end-turn', policy: 'manual' });
        return { unit: fixture.instance, componentId };
    },
    vehicle: instanceId => {
        const entity = new TestTankEntity();
        const uuid = asUnitUuid('019f6767-0dcb-7bb8-992f-aef08202f5e1');
        entity.uuid.set(uuid);
        const mount = addTestEquipmentWithFlags(entity, ['F_NOVA', 'F_ECM', 'F_BAP']);
        const unit = createNonMekRuntimeForTest(instanceId, {
            entity: uuid,
            ruleset: CORE_2026_RULESET,
            initialStateProfile: { schemaVersion: 1, initializerRevision: 1, profileId: 'pristine-non-mek-v1' },
        }, entity, CORE_2026_RULESET);
        return { unit, componentId: componentIdForMount(mount) };
    },
};

describe('CBTForceC3 Nova power', () => {
    for (const [family, createFixture] of Object.entries(novaFixtures)) {
        it(`follows settled ${family} Nova power without changing intactness or configured links`, () => {
            const first = createFixture(`unit:${family}:first`);
            const second = createFixture(`unit:${family}:second`);
            const units = new Map([first, second].map(({ unit }) => [unit.instanceId, unit]));
            const c3 = new CBTForceC3(() => units);
            const networks: readonly EncounterNetwork[] = [{
                id: asEncounterNetworkId(`network:${family}:nova`),
                networkType: 'nova',
                color: '#ff0000',
                endpoints: [first, second].map(({ unit, componentId }) => ({
                    instanceId: unit.instanceId, componentId, role: 'peer',
                })),
            }];
            const { unit, componentId } = first;
            expect(c3.state(unit.instanceId, networks)).toBe('operational');

            expect(unit.dispatch({ type: 'set-component-mode', componentId, mode: 'disabling' }).changed).toBeTrue();
            expect(c3.state(unit.instanceId, networks)).toBe('operational');
            expect(unit.dispatch({ type: 'end-turn', policy: 'manual' }).accepted).toBeTrue();
            expect(unit.query().componentMode(componentId)).toBe('disabled');
            expect(c3.isEndpointOperational(unit.instanceId, componentId)).toBeFalse();
            expect(c3.state(unit.instanceId, networks)).toBe('degraded');
            expect(c3.state(second.unit.instanceId, networks)).toBe('degraded');
            expect(c3.isEndpointIntact(unit.instanceId, componentId)).toBeTrue();
            expect(c3.effectiveNetworks(networks)).toBe(networks);

            expect(unit.dispatch({ type: 'set-component-mode', componentId, mode: 'enabling' }).changed).toBeTrue();
            expect(c3.state(unit.instanceId, networks)).toBe('degraded');
            expect(unit.dispatch({ type: 'end-turn', policy: 'manual' }).accepted).toBeTrue();
            expect(unit.query().componentMode(componentId)).toBe('enabled');
            expect(c3.state(unit.instanceId, networks)).toBe('operational');
            expect(c3.state(second.unit.instanceId, networks)).toBe('operational');
        });
    }
});
