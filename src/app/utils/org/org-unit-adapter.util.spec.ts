// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import { createEmptyUnit, createTestMekEntity } from '../../testing/unit-test-helpers';
import { compileUnitFacts } from './org-facts.util';
import { orgUnitFromEntity, orgUnitFromFormationUnit, orgUnitFromSummary } from './org-unit-adapter.util';
import { convertEntityToAlphaStrike } from '../../models/entity/utils/alpha-strike/alpha-strike-converter';
import { TestBattleArmorEntity } from '../../models/entity/testing/test-entities';
import { addTestEquipmentWithFlags } from '../../models/entity/testing/test-mounted-equipment';

describe('organization unit facts boundary', () => {
    it('compiles loaded CBT facts from Entity without creating a catalog projection', () => {
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
        expect('bv' in unit).toBeFalse();
        expect('PV' in unit.as).toBeFalse();
        expect('bv' in facts.scalars).toBeFalse();
        expect('pv' in facts.scalars).toBeFalse();
    });

    it('keeps structural Alpha Strike facts identical without calculating battle value', () => {
        const entity = createTestMekEntity({ chassis: 'Structural facts', omni: 1 });
        const expected = convertEntityToAlphaStrike(entity);
        const battleValue = spyOn(entity, 'battleValue').and.throwError('Organization must not calculate BV');
        const unit = orgUnitFromEntity(entity);
        compileUnitFacts(unit);
        expect(unit.as.TP).toBe(expected.TP);
        expect(unit.as.MVm).toEqual(expected.MVm);
        expect(unit.transportSpecials.includes('MEC')).toBe(expected.specials.includes('MEC'));
        expect(unit.transportSpecials.includes('XMEC')).toBe(expected.specials.includes('XMEC'));
        expect(battleValue).not.toHaveBeenCalled();
    });

    it('preserves Battle Armor transport classification, including magnetic-clamp precedence', () => {
        for (const magneticClamps of [false, true]) {
            const entity = new TestBattleArmorEntity();
            addTestEquipmentWithFlags(entity, 'F_BASIC_MANIPULATOR');
            if (magneticClamps) addTestEquipmentWithFlags(entity, 'F_MAGNETIC_CLAMP');
            const expected = convertEntityToAlphaStrike(entity);
            const unit = orgUnitFromEntity(entity);
            const facts = compileUnitFacts(unit);

            expect(unit.as.TP).toBe(expected.TP);
            expect(unit.as.MVm).toEqual(expected.MVm);
            expect(unit.transportSpecials).toEqual([magneticClamps ? 'XMEC' : 'MEC']);
            expect('specials' in unit.as).toBeFalse();
            expect(facts.scalars.hasMEC).toBe(!magneticClamps);
            expect(facts.scalars.hasXMEC).toBe(magneticClamps);
        }
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

    it('uses available summaries directly for catalog and Alpha Strike units', () => {
        const summary = createEmptyUnit({
            type: 'Infantry', subtype: 'Battle Armor', as: { TP: 'BA', specials: ['MEC', 'ECM'] },
        });
        const unit = orgUnitFromFormationUnit({
            force: { faction: () => null }, getFormationSummary: () => summary,
        });
        expect(orgUnitFromSummary(summary)).toBe(summary);
        expect(unit).toBe(summary);
        expect(compileUnitFacts(unit).scalars.hasMEC).toBeTrue();
    });
});
