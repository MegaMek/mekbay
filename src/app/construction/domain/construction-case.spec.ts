// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import { AmmoEquipment, MiscEquipment, StructureEquipment, WeaponEquipment, type ArmorEquipment } from '../../models/equipment.model';
import { MountedStructure, STANDARD_STRUCTURE_EQUIPMENT } from '../../models/entity/components';
import { MekEntity } from '../../models/entity/entities';
import { addTestEquipment } from '../../models/entity/testing/test-mounted-equipment';
import { createTestEquipmentRegistry } from '../../models/entity/testing/test-equipment-registry';
import { calculateMountedEquipmentCostBreakdown } from '../../models/entity/utils/cost/equipment-total';
import { encodeNativeEntity } from '../../models/entity/write-entity';
import { parseEntity } from '../../models/entity/parse-entity';
import { createConstructionEntity } from './construction-factory';
import { getConstructionFields } from './construction-fields';
import {
    applyConstructionSpreadPlacements,
    constructionSpreadAllocation,
    constructionSpreadMovePlacements,
    getConstructionLocations,
    installConstructionEquipment,
    planConstructionCaseInstallation,
    removeConstructionEquipment,
    setConstructionArmorMaterial,
    setConstructionCase,
    setConstructionStructure,
    validateConstruction,
} from './construction-rules';
import type { EquipmentRegistry } from '../../models/equipment-lookup';
import { caseEquipmentKind } from '../../models/case-equipment.model';
import { buildEquipmentRegistry } from '../../services/catalogs/equipment-catalog-builder';

const ammo = new AmmoEquipment({ id: 'CASE Test Ammo', name: 'CASE Test Ammo', type: 'ammo',
    stats: { explosive: true, criticalSlots: 1, tonnage: 1 }, ammo: { shots: 10 } });
const caseII = new MiscEquipment({ id: 'CLCASEII', name: 'CASE II', type: 'misc',
    flags: ['F_CASE_II'], stats: { criticalSlots: 1, tonnage: .5, cost: 175000 } });
const clanCase = new MiscEquipment({ id: 'CLCASE', name: 'CASE', type: 'misc',
    flags: ['F_CASE'], stats: { criticalSlots: 0, tonnage: 0, cost: 50000 } });
const registry = createTestEquipmentRegistry({ [ammo.id]: ammo, [caseII.id]: caseII, [clanCase.id]: clanCase,
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

    it('keeps explicit Clan CASE on a Clan chassis with IS structure through MTF', () => {
        const entity = createConstructionEntity('Biped', registry);
        entity.techBase.set('Clan');
        entity.mixedTech.set(true);
        entity.setUniformStructure(new MountedStructure({ structure: STANDARD_STRUCTURE_EQUIPMENT,
            tonnage: entity.tonnage(), techBase: 'IS' }));
        addTestEquipment(entity, ammo, { location: 'RT' });
        addTestEquipment(entity, clanCase, { location: 'RT' });
        expect(entity.automaticClanCaseLocations().size).toBe(0);
        const source = encodeNativeEntity(entity);
        expect(source).toContain('nocrit:CLCASE:RT');
        const restored = parseEntity(source, 'mixed-clan.mtf', registry).entity;
        expect(restored.techBase()).toBe('Clan');
        expect(restored.locationHasCaseProtection('RT')).toBeTrue();
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

/** CASE placement on a Mek, against the real equipment catalog (TechManual p. 297). */
describe('construction CASE installation with the real equipment catalog', () => {
    let catalog: EquipmentRegistry;

    beforeAll(async () => {
        catalog = buildEquipmentRegistry(await (await fetch('/online-assets/static/equipment.json')).json());
    });

    /** A Mek with an explosive Gauss Rifle in the right torso. */
    function gaussMek(techBase: 'IS' | 'Clan', year = 3151): MekEntity {
        const entity = createConstructionEntity('Biped', catalog) as MekEntity;
        const field = (id: string) => getConstructionFields(entity).find(candidate => candidate.id === id)!;
        field('year').set(year);
        field('techBase').set(techBase);
        installConstructionEquipment(entity, catalog.equipment[gaussId(techBase)], 'RT');
        return entity;
    }
    const gaussId = (techBase: 'IS' | 'Clan') => techBase === 'IS' ? 'ISGaussRifle' : 'CLGaussRifle';
    const protection = (entity: MekEntity) =>
        entity.getEquipmentAtLocation('RT').filter(mount => caseEquipmentKind(mount.equipment));
    const caseWarning = (entity: MekEntity) => validateConstruction(entity).messages
        .filter(message => message.code === 'CASE_WITHOUT_EXPLOSIVES').map(message => [message.severity, message.location]);

    const installCase = (entity: MekEntity, id: string) => setConstructionCase(entity, 'RT', catalog.equipment[id], false);
    /** Medium lasers in every free slot of `locations`. */
    function fill(entity: MekEntity, locations?: readonly string[]): void {
        for (const location of getConstructionLocations(entity).filter(candidate => !locations || locations.includes(candidate.id))) {
            for (const _slot of location.slots.filter(slot => !slot.mount && !slot.system)) {
                installConstructionEquipment(entity, catalog.equipment['Medium Laser'], location.id);
            }
        }
    }

    /** Endo Steel moved into every free right-torso slot. */
    function fillTorsoWithEndoSteel(entity: MekEntity) {
        const material = Object.values(catalog.equipment).find(equipment => equipment instanceof StructureEquipment
            && equipment.hasFlag('F_ENDO_STEEL') && equipment.techBase === entity.techBase()
            && !equipment.hasFlag('F_PROTOTYPE')) as StructureEquipment;
        setConstructionStructure(entity, material);
        let mount = entity.equipment().find(candidate => candidate.equipmentId === material.id)!;
        while (constructionSpreadAllocation(entity, mount)!.locations.find(target => target.id === 'RT')!.free) {
            const source = mount.placements!.find(placement => placement.location !== 'RT')!.location;
            mount = applyConstructionSpreadPlacements(entity, mount,
                constructionSpreadMovePlacements(entity, mount, source, 'RT', 1));
        }
        return () => entity.equipment().find(candidate => candidate.equipmentId === material.id)!;
    }

    for (const [techBase, id, tonnage] of [['IS', 'ISCASE', 0.5], ['IS', 'ISCASEII', 1], ['Clan', 'CLCASEII', 0.5]] as const) {
        it(`puts ${id} in one torso slot, keeps it through MTF and warns only while the torso holds no explosives`, () => {
            const entity = gaussMek(techBase);
            expect(installCase(entity, id)).toBeTrue();
            const [mount] = protection(entity);
            expect(mount.equipmentId).toBe(id);
            expect(mount.placements?.map(placement => placement.location)).toEqual(['RT']);
            expect(mount.getTonnage(entity)).toBe(tonnage);
            const restored = parseEntity(encodeNativeEntity(entity), 'case.mtf', catalog).entity;
            expect(restored.getEquipmentAtLocation('RT').filter(candidate => caseEquipmentKind(candidate.equipment))
                .map(candidate => candidate.equipmentId)).toEqual([id]);
            expect(restored.automaticClanCaseLocations().has('RT')).toBeFalse();

            const gauss = entity.equipment().find(candidate => candidate.equipmentId === gaussId(techBase))!;
            expect(caseWarning(entity)).toEqual([]);
            removeConstructionEquipment(entity, gauss);
            expect(caseWarning(entity)).toEqual([['warning', 'RT']]);
            expect(validateConstruction(entity).valid).toBeTrue();
        });

        it(`makes room for ${id} by moving one Endo Steel slot out of a full torso`, () => {
            const entity = gaussMek(techBase);
            const endo = fillTorsoWithEndoSteel(entity);
            const placements = endo().placements!;
            const inTorso = placements.filter(placement => placement.location === 'RT').length;
            // Planning moves nothing: the editor plans every choice it shows.
            const before = encodeNativeEntity(entity);
            expect(planConstructionCaseInstallation(entity, catalog.equipment[id], 'RT')?.length).toBe(1);
            expect(encodeNativeEntity(entity)).toBe(before);

            expect(installCase(entity, id)).toBeTrue();
            expect(protection(entity).map(mount => mount.equipmentId)).toEqual([id]);
            expect(endo().placements!.length).toBe(placements.length);
            expect(endo().placements!.filter(placement => placement.location === 'RT').length).toBe(inTorso - 1);
            expect(validateConstruction(entity).messages.filter(message => message.category === 'crit')).toEqual([]);
        });
    }

    it('plans no CASE while no moved slot would have anywhere to go, until a slot frees', () => {
        const entity = gaussMek('IS');
        fillTorsoWithEndoSteel(entity);
        fill(entity);
        expect(planConstructionCaseInstallation(entity, catalog.equipment['ISCASE'], 'RT')).toBeNull();
        expect(planConstructionCaseInstallation(entity, catalog.equipment['ISCASEII'], 'RT')).toBeNull();
        // Setting a CASE that cannot fit changes nothing.
        const before = encodeNativeEntity(entity);
        expect(setConstructionCase(entity, 'RT', catalog.equipment['ISCASE'], false)).toBeFalse();
        expect(encodeNativeEntity(entity)).toBe(before);
        removeConstructionEquipment(entity, entity.equipment()
            .find(mount => mount.location === 'LT' && mount.equipmentId === 'Medium Laser')!);
        expect(planConstructionCaseInstallation(entity, catalog.equipment['ISCASE'], 'RT')?.length).toBe(1);
    });

    it('replaces CASE in its own slot even when the whole Mek is full', () => {
        const entity = gaussMek('IS');
        expect(installCase(entity, 'ISCASE')).toBeTrue();
        fill(entity);
        expect(installCase(entity, 'ISCASEII')).toBeTrue();
        expect(protection(entity).map(mount => mount.equipmentId)).toEqual(['ISCASEII']);
    });

    for (const prescribed of [false, true]) {
        it(`moves no ${prescribed ? 'prescribed spread system' : 'ordinary equipment'} out of a full torso for CASE`, () => {
            const entity = gaussMek('IS');
            if (prescribed) setConstructionArmorMaterial(entity, catalog.equipment['IS Stealth'] as ArmorEquipment);
            fill(entity, ['RT']);
            expect(planConstructionCaseInstallation(entity, catalog.equipment['ISCASE'], 'RT')).toBeNull();
            expect(planConstructionCaseInstallation(entity, catalog.equipment['ISCASEII'], 'RT')).toBeNull();
        });
    }

    it('plans no CASE below the rules level it needs', () => {
        const entity = gaussMek('IS', 2954);
        const rulesLevel = getConstructionFields(entity).find(field => field.id === 'rulesLevel')!;
        rulesLevel.set(1);
        expect(planConstructionCaseInstallation(entity, catalog.equipment['ISCASE'], 'RT')).toBeNull();
        rulesLevel.set(2);
        expect(planConstructionCaseInstallation(entity, catalog.equipment['ISCASE'], 'RT')).not.toBeNull();
    });

    it('takes no slot for a manually installed Clan CASE and warns while it protects no explosives', () => {
        const entity = gaussMek('Clan');
        removeConstructionEquipment(entity, entity.equipment().find(mount => mount.equipmentId === 'CLGaussRifle')!);
        const occupied = () => getConstructionLocations(entity).find(location => location.id === 'RT')!
            .slots.filter(slot => slot.mount || slot.system).length;
        const before = occupied();

        const mount = installConstructionEquipment(entity, catalog.equipment['CLCASE'], 'RT');

        expect(mount.getNumCriticalSlots(entity)).toBe(0);
        expect(occupied()).toBe(before);
        expect(caseWarning(entity)).toEqual([['warning', 'RT']]);
        expect(validateConstruction(entity).valid).toBeTrue();
    });
});
