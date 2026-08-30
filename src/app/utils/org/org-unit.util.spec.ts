// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import { createEmptyUnit, createTestMekEntity } from '../../testing/unit-test-helpers';
import { compileUnitFacts } from './org-facts.util';
import { orgUnitFromEntity, orgUnitFromFormationUnit } from './org-unit.util';

describe('organization unit facts boundary', () => {
    it('compiles loaded Classic facts from Entity without creating a catalog projection', () => {
        const entity = createTestMekEntity({
            uuid: '019f6767-0dcb-7bb8-992f-aef08202f5e9',
            chassis: 'Atlas',
            model: 'AS7-D',
            omni: 1,
        });

        const unit = orgUnitFromEntity(entity);
        const facts = compileUnitFacts(unit);

        expect(unit.name).toBe('Atlas AS7-D');
        expect(unit.uuid).toBe(entity.uuid());
        expect(unit.type).toBe('Mek');
        expect(unit.as.TP).toBe('BM');
        expect(facts.classKey).toBe('BM:omni');
        expect('provider' in unit).toBeFalse();
        expect('comp' in unit).toBeFalse();
    });

    it('gives Entity authority when a formation adapter also exposes a lying summary', () => {
        const entity = createTestMekEntity({ chassis: 'Entity Atlas', model: 'Prime' });
        const summary = createEmptyUnit({
            name: 'Summary Impostor',
            type: 'ProtoMek',
            entityType: 'ProtoMek',
            as: { TP: 'PM' },
        });

        const unit = orgUnitFromFormationUnit({
            force: { faction: () => null },
            getFormationEntity: () => entity,
            getFormationSummary: () => summary,
        });

        expect(unit.name).toBe('Entity Atlas Prime');
        expect(unit.type).toBe('Mek');
        expect(unit.as.TP).toBe('BM');
    });
});
