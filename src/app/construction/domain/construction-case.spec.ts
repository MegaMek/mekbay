// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import { AmmoEquipment, MiscEquipment, WeaponEquipment } from '../../models/equipment.model';
import { MountedStructure, STANDARD_STRUCTURE_EQUIPMENT } from '../../models/entity/components';
import { MekEntity } from '../../models/entity/entities';
import { addTestEquipment } from '../../models/entity/testing/test-mounted-equipment';
import { createTestEquipmentRegistry } from '../../models/entity/testing/test-equipment-registry';
import { calculateMountedEquipmentCostBreakdown } from '../../models/entity/utils/cost/equipment-total';
import { encodeNativeEntity } from '../../models/entity/write-entity';
import { parseEntity } from '../../models/entity/parse-entity';
import { createConstructionEntity } from './construction-factory';
import { getConstructionFields } from './construction-fields';
import { getConstructionLocations } from './construction-rules';

const ammo = new AmmoEquipment({ id: 'CASE Test Ammo', name: 'CASE Test Ammo', type: 'ammo',
    stats: { explosive: true, criticalSlots: 1, tonnage: 1 }, ammo: { shots: 10 } });
const caseII = new MiscEquipment({ id: 'CLCASEII', name: 'CASE II', type: 'misc',
    flags: ['F_CASE_II'], stats: { criticalSlots: 1, tonnage: .5, cost: 175000 } });
const registry = createTestEquipmentRegistry({ [ammo.id]: ammo, [caseII.id]: caseII,
    [STANDARD_STRUCTURE_EQUIPMENT.id]: STANDARD_STRUCTURE_EQUIPMENT });

describe('construction automatic Clan CASE', () => {
    it('tracks explosive locations and opt-outs without creating mounts or consuming slots', () => {
        const entity = createConstructionEntity('Biped', registry);
        getConstructionFields(entity).find(field => field.id === 'techBase')!.set('Clan');
        const mount = addTestEquipment(entity, ammo, { allocation: { kind: 'location', location: 'RT', placements: [{ location: 'RT', slotIndex: 4 }] } });
        const slots = () => getConstructionLocations(entity).find(location => location.id === 'RT')!.slots;
        const before = slots();
        expect(entity.automaticClanCaseLocations()).toEqual(new Set(['RT']));
        expect(calculateMountedEquipmentCostBreakdown(entity).total).toBe(50000);
        entity.setClanCaseOptOutLocations(new Set(['RT']));
        expect(entity.automaticClanCaseLocations().size).toBe(0);
        expect(entity.locationHasCaseProtection('RT')).toBeFalse();
        expect(calculateMountedEquipmentCostBreakdown(entity).total).toBe(0);
        expect(slots()).toEqual(before);
        expect(entity.equipment()).toEqual([mount]);
        entity.setClanCaseOptOutLocations(new Set());
        expect(entity.automaticClanCaseLocations()).toEqual(new Set(['RT']));
        entity.removeEquipment(mount);
        expect(entity.automaticClanCaseLocations().size).toBe(0);
    });

    it('uses Clan internal structure on a mixed chassis and preserves that choice through MTF', () => {
        const entity = createConstructionEntity('Biped', registry);
        entity.mixedTech.set(true);
        addTestEquipment(entity, ammo, { allocation: { kind: 'location', location: 'RT', placements: [{ location: 'RT', slotIndex: 4 }] } });
        expect(entity.automaticClanCaseLocations().size).toBe(0);
        entity.setUniformStructure(new MountedStructure({ structure: STANDARD_STRUCTURE_EQUIPMENT,
            tonnage: entity.tonnage(), techBase: 'Clan' }));
        expect(entity.automaticClanCaseLocations()).toEqual(new Set(['RT']));
        expect(calculateMountedEquipmentCostBreakdown(entity).total).toBe(50000);
        const restored = parseEntity(encodeNativeEntity(entity), 'mixed.mtf', registry).entity;
        expect(restored.techBase()).toBe('IS');
        expect(restored.automaticClanCaseLocations()).toEqual(new Set(['RT']));
        entity.techBase.set('Clan');
        entity.setUniformStructure(new MountedStructure({ structure: STANDARD_STRUCTURE_EQUIPMENT,
            tonnage: entity.tonnage(), techBase: 'IS' }));
        expect(entity.automaticClanCaseLocations().size).toBe(0);
        expect(calculateMountedEquipmentCostBreakdown(entity).total).toBe(0);
    });

    it('resolves hybrid structure technology per location', () => {
        const entity = createConstructionEntity('Biped', registry) as MekEntity;
        entity.mixedTech.set(true);
        for (const location of ['RT', 'LT']) addTestEquipment(entity, ammo, { location });
        entity.enableHybridStructure();
        entity.setStructureAt('RT', new MountedStructure({ structure: STANDARD_STRUCTURE_EQUIPMENT,
            tonnage: entity.tonnage(), techBase: 'Clan' }));
        expect(entity.automaticClanCaseLocations()).toEqual(new Set(['RT']));
        expect(entity.implicitClanCaseLocations()).toEqual(new Set(['RT']));
    });

    it('keeps installed protection independent of the automatic opt-out', () => {
        const entity = createConstructionEntity('Biped', registry);
        getConstructionFields(entity).find(field => field.id === 'techBase')!.set('Clan');
        addTestEquipment(entity, ammo, { location: 'RT' });
        const manual = addTestEquipment(entity, caseII, { location: 'RT' });
        expect(entity.automaticClanCaseLocations().size).toBe(0);
        entity.setClanCaseOptOutLocations(new Set(['RT']));
        expect(entity.equipment()).toContain(manual);
        entity.removeEquipment(manual);
        expect(entity.automaticClanCaseLocations().size).toBe(0);
        entity.setClanCaseOptOutLocations(new Set());
        expect(entity.automaticClanCaseLocations()).toEqual(new Set(['RT']));
    });

    for (const kind of ['Biped', 'Tank', 'Aero'] as const) {
        it(`preserves ${kind} opt-outs through the native codec`, () => {
            const entity = createConstructionEntity(kind, registry);
            entity.techBase.set('Clan');
            const location = kind === 'Biped' ? 'RT' : kind === 'Tank' ? 'Body' : 'Nose';
            entity.setClanCaseOptOutLocations(new Set([location]));
            const source = encodeNativeEntity(entity);
            const restored = parseEntity(source, kind === 'Biped' ? 'case.mtf' : 'case.blk', registry).entity;
            expect(restored.clanCaseOptOutLocations()).toEqual(new Set([location]));
            expect(encodeNativeEntity(restored)).toContain('clancaseoptedoutlocs');
        });
    }

    it('preserves valid BLK opt-outs while diagnosing an unknown location', () => {
        const entity = createConstructionEntity('Tank', registry);
        entity.setClanCaseOptOutLocations(new Set(['Body']));
        const source = encodeNativeEntity(entity).replace('</clancaseoptedoutlocs>', 'Unknown facing\n</clancaseoptedoutlocs>');
        const result = parseEntity(source, 'case.blk', registry);
        expect(result.entity.clanCaseOptOutLocations()).toEqual(new Set(['Body']));
        expect(result.diagnostics.some(issue => issue.message.includes('Unknown CASE opt-out location'))).toBeTrue();
    });

    it('excludes ProtoMeks and non-explosive primitive autocannons', () => {
        const proto = createConstructionEntity('ProtoMek', registry);
        proto.techBase.set('Clan');
        addTestEquipment(proto, ammo, { location: 'Torso' });
        expect(proto.automaticClanCaseLocations().size).toBe(0);
        const mek = createConstructionEntity('Biped', registry);
        getConstructionFields(mek).find(field => field.id === 'techBase')!.set('Clan');
        expect(mek.supportsAutomaticClanCaseAt('RT')).toBeTrue();
        addTestEquipment(mek, new WeaponEquipment({ id: 'Primitive AC', name: 'Primitive AC', type: 'weapon',
            weapon: { ammoType: 'AC_PRIMITIVE' }, stats: { explosive: true } }), { location: 'RT' });
        expect(mek.automaticClanCaseLocations().size).toBe(0);
    });
});
