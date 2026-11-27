// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import { MountedArmor } from '../entity/components/armor';
import { MountedStructure } from '../entity/components';
import { STRUCTURE_TYPE } from '../entity/types';
import { ArmorEquipment, StructureEquipment } from '../equipment.model';
import { infernoEffect } from '../rules/inferno-rules';
import type { BaseEntity } from '../entity/base-entity';
import { TestAeroSpaceFighterEntity, TestProtoMekEntity, TestQuadMekEntity, TestTankEntity, TestVtolEntity, TestTripodMekEntity } from '../entity/testing/test-entities';
import { createNonMekUnit } from './cbt-non-mek-unit';
import { queryNonMekRuntime } from './non-mek-unit-instance';
import { projectNonMekRecordSheet } from './non-mek-record-sheet';
import { asUnitUuid } from '../../services/unit-catalog/unit-catalog.types';
import type { NonMekRecordSheetSnapshot } from './non-mek-record-sheet';
import type { CBTForceMember } from '../force-member.model';
import type { MekHitArc } from '../../utils/record-sheet-reference-table';
import { aimedShotLocations, attackDamageLedger, attackDamagePreview, modularArmorAt, readAttackHitLocation, readAttackThermalEffects, rollFloatingCriticals, weaponHitLocation } from './attack-hit-location';
import { createDirectMekRuntimeFixture, createDirectModularArmorRuntimeFixture } from './testing/direct-mek-runtime-fixture';

describe('readAttackHitLocation', () => {
    const mek = { entity: createDirectMekRuntimeFixture().entity, force: { getUnitSnapshot: () => null } } as unknown as CBTForceMember;

    it('reads the roll on the struck Mek\'s table, marking rear torso hits', () => {
        expect(readAttackHitLocation(mek, 'front', [3, 3], 1)).toEqual(jasmine.objectContaining({
            kind: 'mek', location: 'RT', label: 'Right Torso', rear: false,
        }));
        expect(readAttackHitLocation(mek, 'rear', [3, 4], 1)?.label).toBe('Center Torso (rear)');
    });

    it('floats a 2 from a missed aim exactly once, even when the second roll is also 2', () => {
        const random = spyOn(Math, 'random').and.returnValue(0);
        const groups = [{ location: [3, 3] as const, aux: 1 }];
        const aim = { location: 'LA', roll: [1], rerolls: [[1, 1] as const] };
        const [group] = rollFloatingCriticals(mek, 'right', { aim }, groups);
        expect(weaponHitLocation(mek, 'right', { aim }, group)).toEqual(jasmine.objectContaining({
            location: 'RT', throughArmorCritical: true, floatingCritical: true,
        }));
        expect(rollFloatingCriticals(mek, 'right', { aim }, [group])).toEqual([group]);
        expect(random).toHaveBeenCalledTimes(2);
    });

    it('does not float a successful aim or a 2 on the swarm table', () => {
        const random = spyOn(Math, 'random').and.throwError('No floating hit-location roll is due');
        const groups = [{ location: [1, 1] as const, aux: 1 }];
        expect(rollFloatingCriticals(mek, 'front', { aim: { location: 'LA', roll: [3, 4] } }, groups)).toEqual(groups);
        expect(rollFloatingCriticals(mek, 'front', { table: 'swarm' }, groups)).toEqual(groups);
        expect(random).not.toHaveBeenCalled();
    });

    it('rerolls covered quad legs for a target being played on a paper sheet', () => {
        const random = spyOn(Math, 'random').and.returnValues(0, 0.2, 0.9, 0.9);
        const groups = [{ location: [1, 1] as const, aux: 1 }];
        expect(rollFloatingCriticals(null, 'front', { partialCover: true }, groups, 'vehicle')).toEqual(groups);
        expect(rollFloatingCriticals(null, 'front', { partialCover: true }, groups, 'mek-quad')[0])
            .toEqual(jasmine.objectContaining({ location: [1, 1], floating: [6, 6] }));
        expect(random).toHaveBeenCalledTimes(4);
    });

    it('reads the hit location roll of every inferno missile (Xotl, Core forum ruling, 19 Oct 2026)', () => {
        const groups = [{ location: [3, 3] as const, aux: 1, damage: 0 }];
        const weapon = { name: 'Inferno', targetNumber: 5, toHit: [3, 3] as const, types: [], inferno: true as const, groups };
        expect(readAttackThermalEffects(mek, 'front', [weapon]).inferno).toEqual([
            jasmine.objectContaining({ location: jasmine.objectContaining({ location: 'RT' }) }),
        ]);
    });

    it('gives each 2-point group of a flamer platoon its share of the heat where it strikes (TW p. 215)', () => {
        const groups = [{ location: [2, 3] as const, aux: 1, damage: 0 }, { location: [3, 4] as const, aux: 1, damage: 0 }];
        const platoon = { name: 'Flamer Platoon', types: [], targetNumber: 7, toHit: [4, 4] as const, heat: 4,
            partialCover: true as const, groups };
        // The first group strikes the right leg in partial cover and loses its heat; the second reaches the center torso.
        expect(readAttackThermalEffects(mek, 'front', [platoon]).heat).toBe(2);
    });

    for (const ruleset of ['core-2026', 'total-warfare'] as const) {
        it(`reads heat-dissipating armor as each hit strikes, before its own damage, under ${ruleset}`, () => {
            const { entity, index, instance } = createDirectMekRuntimeFixture(ruleset);
            entity.setUniformArmor(new MountedArmor({ armor: new ArmorEquipment({
                id: 'Test HD armor', name: 'Heat-Dissipating', type: 'armor', armor: { type: 'HEAT_DISSIPATING' },
            }) }));
            const unit = { entity, force: { getUnitSnapshot: () => ({ entity, index, query: instance.query(), ruleset }) } } as unknown as CBTForceMember;
            const weapon = { name: 'Plasma', types: ['H' as const], targetNumber: 5, toHit: [3, 4] as const, heat: 5,
                groups: [{ location: [3, 3] as const, aux: 1, damage: 10 }] };
            const core = ruleset === 'core-2026';
            // The first hit meets the torso's armor before its own damage (Core p. 201): Core p. 202 negates its heat,
            // TW (IO:AE p. 81) halves it. Core halves the plasma's 10 damage, which bares the 20-ton torso, so the second
            // hit meets no armor there; under TW the first destroys the torso and the second transfers to the armored
            // center torso.
            expect(readAttackThermalEffects(unit, 'front', [weapon, weapon]).heat).toBe(core ? 0 + 5 : 2 + 2);
            // Two flamers in one BA attack meet armor one after the other, just like separately fired weapons.
            expect(readAttackThermalEffects(unit, 'front', [{ ...weapon, heat: 10, heatPerGroup: 5,
                groups: [...weapon.groups, ...weapon.groups] }]).heat).toBe(core ? 5 : 4);
            // The rear torso is already bare.
            expect(readAttackThermalEffects(unit, 'rear', [weapon]).heat).toBe(5);
            const missiles = readAttackThermalEffects(unit, 'front', [{ ...weapon, inferno: true }]).inferno;
            expect(infernoEffect(entity, missiles)).toEqual({ kind: 'heat', heat: core ? 0 : 1 });
            // Heat without a location meets the armor of every location (TW) or any of it (Core) as it strikes.
            instance.dispatch({ type: 'add-outside-heat', amount: 5, target: 'pending' });
            expect(instance.snapshot().pendingCombat.outsideHeat).toBe(core ? undefined : 2);
            const result = instance.query().heatProjection();
            expect(result.kind === 'supported'
                ? result.projection.committedSources.find(source => source.id === 'outside-heat')?.value ?? 0 : undefined)
                .toBe(core ? 0 : 2);
        });

        it(`follows a hit on a missing arm into the torso before the next heat hit under ${ruleset}`, () => {
            const { entity, index, instance } = createDirectMekRuntimeFixture(ruleset);
            entity.setUniformArmor(new MountedArmor({ armor: new ArmorEquipment({
                id: 'Test HD armor', name: 'Heat-Dissipating', type: 'armor', armor: { type: 'HEAT_DISSIPATING' },
            }) }));
            const unit = { entity, force: { getUnitSnapshot: () => ({ entity, index, query: instance.query(), ruleset }) } } as unknown as CBTForceMember;
            const section = (code: string) => [...index.locations.values()].find(row => row.code === code)!;
            const front = (code: string) => section(code).armorFaceIds.find(faceId => index.armorFaces.get(faceId)!.face === 'front')!;
            instance.dispatch({ type: 'damage-armor', faceId: front('RA'), amount: instance.query().remainingArmor(front('RA'), 'preview'), target: 'pending' });
            instance.dispatch({ type: 'damage-internal', locationId: section('RA').id,
                amount: instance.query().remainingInternal(section('RA').id, 'preview'), target: 'pending' });
            // [2, 2] strikes the missing right arm, so its damage strips the right torso that [3, 3] strikes next.
            const laser = { name: 'Laser', types: ['DE' as const], targetNumber: 5, toHit: [3, 4] as const,
                groups: [{ location: [2, 2] as const, aux: 1, damage: instance.query().remainingArmor(front('RT'), 'preview') }] };
            const plasma = { name: 'Plasma', types: ['H' as const], targetNumber: 5, toHit: [3, 4] as const, heat: 5,
                groups: [{ location: [3, 3] as const, aux: 1, damage: 0 }] };
            expect(readAttackThermalEffects(unit, 'front', [plasma]).heat).toBe(ruleset === 'core-2026' ? 0 : 2);
            // The stripped right torso protects nothing (Core p. 201, IO:AE p. 81).
            expect(readAttackThermalEffects(unit, 'front', [laser, plasma]).heat).toBe(5);
        });

        it(`passes heat on an arm lost with its side torso to the center torso under ${ruleset}`, () => {
            const { entity, index, instance } = createDirectMekRuntimeFixture(ruleset);
            entity.setArmorAt('RA', new MountedArmor({ armor: new ArmorEquipment({
                id: 'Test HD armor', name: 'Heat-Dissipating', type: 'armor', armor: { type: 'HEAT_DISSIPATING' },
            }) }));
            const unit = { entity, force: { getUnitSnapshot: () => ({ entity, index, query: instance.query(), ruleset }) } } as unknown as CBTForceMember;
            const section = (code: string) => [...index.locations.values()].find(row => row.code === code)!;
            const front = section('RT').armorFaceIds.find(faceId => index.armorFaces.get(faceId)!.face === 'front')!;
            const torso = instance.query().remainingArmor(front, 'preview') + instance.query().remainingInternal(section('RT').id, 'preview');
            // [3, 3] destroys the right torso, so the arm struck by [2, 2] is gone and its heat reaches the bare-armored center torso.
            const laser = { name: 'Laser', types: ['DE' as const], targetNumber: 5, toHit: [3, 4] as const,
                groups: [{ location: [3, 3] as const, aux: 1, damage: torso }] };
            const plasma = { name: 'Plasma', types: ['H' as const], targetNumber: 5, toHit: [3, 4] as const, heat: 5,
                groups: [{ location: [2, 2] as const, aux: 1, damage: 0 }] };
            expect(readAttackThermalEffects(unit, 'front', [plasma]).heat).toBe(ruleset === 'core-2026' ? 0 : 2);
            expect(readAttackThermalEffects(unit, 'front', [laser, plasma]).heat).toBe(5);
        });

        it(`shares the last composite pip with the bare composite torso behind it under ${ruleset}`, () => {
            const { entity, index, instance } = createDirectMekRuntimeFixture(ruleset);
            const composite = new StructureEquipment({ id: 'Test composite', name: 'Composite', type: 'structure',
                flags: ['F_COMPOSITE'], structure: { typeId: STRUCTURE_TYPE.COMPOSITE } });
            for (const code of ['RA', 'RT'] as const) {
                entity.setStructureAt(code, new MountedStructure({ tonnage: entity.tonnage(), structure: composite }));
            }
            entity.setArmorAt('CT', new MountedArmor({ armor: new ArmorEquipment({
                id: 'Test HD armor', name: 'Heat-Dissipating', type: 'armor', armor: { type: 'HEAT_DISSIPATING' },
            }) }));
            const unit = { entity, force: { getUnitSnapshot: () => ({ entity, index, query: instance.query(), ruleset }) } } as unknown as CBTForceMember;
            const section = (code: string) => [...index.locations.values()].find(row => row.code === code)!;
            const front = (code: string) => section(code).armorFaceIds.find(faceId => index.armorFaces.get(faceId)!.face === 'front')!;
            for (const code of ['RA', 'RT']) {
                instance.dispatch({ type: 'damage-armor', faceId: front(code), amount: instance.query().remainingArmor(front(code), 'preview'), target: 'pending' });
                instance.dispatch({ type: 'damage-internal', locationId: section(code).id,
                    amount: instance.query().remainingInternal(section(code).id, 'preview') - 1, target: 'pending' });
            }
            // Core p. 205: one point on the arm's last pip also takes the torso's, so the plasma meets the armored center torso.
            const laser = { name: 'Laser', types: ['DE' as const], targetNumber: 5, toHit: [3, 4] as const,
                groups: [{ location: [2, 2] as const, aux: 1, damage: 1 }] };
            const plasma = { name: 'Plasma', types: ['H' as const], targetNumber: 5, toHit: [3, 4] as const, heat: 5,
                groups: [{ location: [3, 3] as const, aux: 1, damage: 0 }] };
            expect(readAttackThermalEffects(unit, 'front', [laser, plasma]).heat).toBe(ruleset === 'core-2026' ? 0 : 5);
        });

        it(`keeps damage from a destroyed head out of the center torso under ${ruleset}`, () => {
            // TW and Core, Transferring Damage: damage from a destroyed head or center torso does not transfer.
            const { entity, index, instance } = createDirectMekRuntimeFixture(ruleset);
            const unit = { entity, force: { getUnitSnapshot: () => ({ entity, index, query: instance.query(), ruleset }) } } as unknown as CBTForceMember;
            const section = (code: string) => [...index.locations.values()].find(row => row.code === code)!;
            const face = (code: string) => section(code).armorFaceIds.find(faceId => index.armorFaces.get(faceId)!.face === 'front')!;
            const head = instance.query().remainingArmor(face('HD'), 'preview') + instance.query().remainingInternal(section('HD').id, 'preview');
            const ledger = attackDamageLedger();
            attackDamagePreview(unit, ruleset, undefined, ledger)(
                { kind: 'mek', label: 'Head', location: 'HD', rear: false, throughArmorCritical: false }, head + 2, { kind: 'weapon', types: ['DE'] });
            expect(ledger.internal.get(section('HD').id)).toBe(0);
            expect(ledger.armor.has(face('CT'))).toBeFalse();
        });
    }

    for (const ruleset of ['core-2026', 'total-warfare'] as const) {
        it(`halves a plasma rifle's heat on a laser-reflective aerospace fighter under ${ruleset}`, () => {
            const entity = new TestAeroSpaceFighterEntity();
            entity.uuid.set(asUnitUuid('019f6767-0dcb-7bb8-992f-aef08202f5e9'));
            entity.setUniformArmor(new MountedArmor({ armor: new ArmorEquipment({
                id: 'Test reflective armor', name: 'Laser Reflective', type: 'armor', armor: { type: 'REFLECTIVE' },
            }) }));
            for (const location of entity.armorLocations) entity.setArmorValue(location, 'front', 10);
            const unit = createNonMekUnit(entity, { instanceId: 'unit:reflective-fighter', uuid: entity.uuid(),
                deployment: { id: 'default' }, scenario: { id: 'megamek', ruleset }, initialStateProfileId: 'pristine-non-mek' });
            const query = queryNonMekRuntime(unit.mechanics(), unit.snapshot());
            const sheet = projectNonMekRecordSheet(entity, unit.getIndex(), unit.snapshot(), ruleset, query, 0, 0);
            const fighter = { entity, nonMekRecordSheetSnapshot: () => sheet,
                force: { getUnitSnapshot: () => ({ entity, index: unit.getIndex(), query, ruleset }) } } as unknown as CBTForceMember;
            const plasma = { name: 'Plasma Rifle', types: ['DE' as const, 'H' as const], targetNumber: 5, toHit: [3, 4] as const, heat: 5,
                groups: [{ location: [3, 4] as const, aux: 1, damage: 0 }] };
            // TO:AUE p. 93 halves it under TW; Core p. 202 removed the heat effect.
            expect(readAttackThermalEffects(fighter, 'front', [plasma]).heat).toBe(ruleset === 'core-2026' ? 5 : 2);
            // A machine gun earlier in the volley strips the last reflective pip, so the rifle's heat arrives whole.
            const struck = readAttackHitLocation(fighter, 'front', [3, 4], 1);
            if (struck?.kind !== 'non-mek') throw new Error('The fighter fixture has no struck location');
            const face = unit.getIndex().locations.get(struck.locationId)!.armorFaceIds[0];
            const machineGun = { name: 'Machine Gun', types: ['DB' as const], targetNumber: 5, toHit: [3, 4] as const,
                groups: [{ location: [3, 4] as const, aux: 1, damage: query.remainingArmor(face, 'preview') }] };
            expect(readAttackThermalEffects(fighter, 'front', [machineGun, plasma]).heat).toBe(5);
        });
    }

    it('previews a TW rifle after a tandem-charge missile strips torso armor through a ProtoMech arm lost earlier in the volley', () => {
        const entity = new TestProtoMekEntity();
        entity.uuid.set(asUnitUuid('019f6767-0dcb-7bb8-992f-aef08202f5e9'));
        entity.setTonnage(5);
        entity.setArmorValue('Torso', 'front', 3);
        const ruleset = 'total-warfare';
        const unit = createNonMekUnit(entity, { instanceId: 'unit:proto-transfer', uuid: entity.uuid(),
            deployment: { id: 'default' }, scenario: { id: 'megamek', ruleset }, initialStateProfileId: 'pristine-non-mek' });
        const index = unit.getIndex();
        const query = unit.query();
        const sheet = projectNonMekRecordSheet(entity, index, unit.snapshot(), ruleset, query, 0, 0);
        const member = { entity, nonMekRecordSheetSnapshot: () => sheet,
            force: { getUnitSnapshot: () => ({ entity, index, query, ruleset }) } } as unknown as CBTForceMember;
        const arm = readAttackHitLocation(member, 'front', [5, 5], 1);
        const torso = readAttackHitLocation(member, 'front', [3, 4], 1);
        if (arm?.kind !== 'non-mek' || torso?.kind !== 'non-mek') throw new Error('Missing ProtoMech locations');
        const armPoints = query.remainingInternal(arm.locationId);
        const tandem = { kind: 'weapon', types: ['M'], ammo: 'tandem-charge' } as const;
        const rifle = { kind: 'weapon', types: ['DB'], rifle: true } as const;
        const deal = attackDamagePreview(member, ruleset);
        expect(attackDamagePreview(member, ruleset)(torso, 5, rifle)).toBe(2);
        // The first hit destroys the arm and takes one torso armor point. The missile reaches the last two.
        deal(arm, armPoints + 1, { kind: 'weapon', types: ['DE'] });
        deal(arm, 2, tandem);
        expect(deal(torso, 5, rifle)).toBe(5);
    });

    it('reads an inferno against the armor where it strikes, before later hits', () => {
        const { entity, index, instance } = createDirectMekRuntimeFixture('core-2026');
        // Core pp. 201-202: heat-dissipating armor negates outside heat while the struck location has armor.
        entity.setArmorAt('RA', new MountedArmor({ armor: new ArmorEquipment({
            id: 'Test HD armor', name: 'Heat-Dissipating', type: 'armor', armor: { type: 'HEAT_DISSIPATING' },
        }) }));
        const unit = { entity, force: { getUnitSnapshot: () => ({ entity, index, query: instance.query(), ruleset: 'core-2026' }) } } as unknown as CBTForceMember;
        const arm = [...index.locations.values()].find(row => row.code === 'RA')!;
        const front = arm.armorFaceIds.find(faceId => index.armorFaces.get(faceId)!.face === 'front')!;
        const inferno = { name: 'Inferno', types: ['M' as const, 'H' as const], targetNumber: 5, toHit: [3, 3] as const,
            inferno: true as const, groups: [{ location: [2, 2] as const, aux: 1, damage: 0 }] };
        const laser = { name: 'Laser', types: ['DE' as const], targetNumber: 5, toHit: [3, 4] as const,
            groups: [{ location: [2, 2] as const, aux: 1, damage: instance.query().remainingArmor(front, 'preview') }] };
        // A laser after the inferno bares the arm too late; one before it leaves no heat-dissipating armor to meet.
        const rightArm = jasmine.objectContaining({ location: 'RA' });
        expect(readAttackThermalEffects(unit, 'front', [inferno, laser]).inferno).toEqual([{ location: rightArm, heat: 0 }]);
        expect(readAttackThermalEffects(unit, 'front', [laser, inferno]).inferno).toEqual([{ location: rightArm }]);
    });

    it('takes a hit on modular armor before the location armor, as applying the damage does', () => {
        const { entity, index, instance } = createDirectModularArmorRuntimeFixture('core-2026');
        const snapshot = { entity, index, query: instance.query(), ruleset: 'core-2026' };
        const unit = { entity, force: { getUnitSnapshot: () => snapshot } } as unknown as CBTForceMember;
        const torso = [...index.locations.values()].find(row => row.code === 'RT')!;
        const front = torso.armorFaceIds.find(faceId => index.armorFaces.get(faceId)!.face === 'front')!;
        const modular = modularArmorAt(snapshot as never, torso.id, 'preview');
        expect(modular).toBeGreaterThan(2);
        const ledger = attackDamageLedger();
        attackDamagePreview(unit, 'core-2026', undefined, ledger)(
            { kind: 'mek', label: 'Right Torso', location: 'RT', rear: false, throughArmorCritical: false }, 2, { kind: 'weapon', types: ['DB'] });
        expect(ledger.modular.get(torso.id)).toBe(modular - 2);
        expect(ledger.armor.get(front) ?? instance.query().remainingArmor(front, 'preview')).toBe(instance.query().remainingArmor(front, 'preview'));
    });

    for (const ruleset of ['core-2026', 'total-warfare'] as const) {
        it(`reduces outside heat by the heat-dissipating armor where it strikes, as it strikes, under ${ruleset}`, () => {
            // Special armor acts while the location struck has armor at the time a hit is applied (Core p. 201). Core
            // p. 202 negates the heat, TW (IO:AE p. 81) halves it; heat without a hit location meets the armor of every
            // location under TW and any of it under Core. The Heat Phase adds the turn's heat within the cap of 15.
            const { entity, index, instance } = createDirectMekRuntimeFixture(ruleset);
            entity.setUniformArmor(new MountedArmor({ armor: new ArmorEquipment({
                id: 'Test HD armor', name: 'Heat-Dissipating', type: 'armor', armor: { type: 'HEAT_DISSIPATING' },
            }) }));
            const outside = () => {
                const result = instance.query().heatProjection();
                return result.kind === 'supported'
                    ? result.projection.committedSources.find(source => source.id === 'outside-heat')?.value ?? 0 : 0;
            };
            const strip = (code: string) => {
                for (const faceId of [...index.locations.values()].find(row => row.code === code)!.armorFaceIds) {
                    instance.dispatch({ type: 'damage-armor', faceId, amount: instance.query().remainingArmor(faceId, 'preview'),
                        target: 'committed' });
                }
            };
            const core = ruleset === 'core-2026';
            // Heat without a hit location, then a plasma rifle on the right arm, while all the armor stands.
            instance.dispatch({ type: 'add-outside-heat', amount: 6, target: 'committed' });
            instance.dispatch({ type: 'add-outside-heat', amount: 5, target: 'committed', location: { code: 'RA', rear: false },
                source: { kind: 'weapon', types: ['DE', 'H'] } });
            expect(outside()).toBe(core ? 0 : 3 + 2);
            // Stripping the arm later changes nothing: the heat met the armor when it struck.
            strip('RA');
            expect(outside()).toBe(core ? 0 : 5);
            // Heat on the bare arm arrives whole; on the armored center torso it is still reduced.
            instance.dispatch({ type: 'add-outside-heat', amount: 6, target: 'committed', location: { code: 'RA', rear: false } });
            instance.dispatch({ type: 'add-outside-heat', amount: 6, target: 'committed', location: { code: 'CT', rear: false } });
            expect(outside()).toBe(core ? 6 : 5 + 6 + 3);
            // With no armor left, heat without a location arrives whole too, within the cap.
            for (const code of ['HD', 'CT', 'LT', 'RT', 'LA', 'LL', 'RL']) strip(code);
            instance.dispatch({ type: 'add-outside-heat', amount: 6, target: 'committed' });
            expect(outside()).toBe(core ? 12 : 15);
        });
    }

    it('sends leg hits on a Mek in partial cover into the cover', () => {
        // Front table, 5: right leg.
        expect(readAttackHitLocation(mek, 'front', [2, 3], 1)).toEqual(jasmine.objectContaining({ kind: 'mek', location: 'RL' }));
        expect(readAttackHitLocation(mek, 'front', [2, 3], 1, true)).toEqual({ kind: 'miss', label: 'Cover' });
        expect(readAttackHitLocation(mek, 'front', [3, 3], 1, true)).toEqual(jasmine.objectContaining({ location: 'RT' }));
    });

    it('strikes the location an aimed shot names when its roll says so, and reads the table otherwise', () => {
        // The table roll alone is the right torso.
        const read = (roll: readonly number[], arc: MekHitArc = 'front', location = 'LA') =>
            readAttackHitLocation(mek, arc, [3, 3], 1, false, 'standard', { location, roll });
        // Total Warfare: 6, 7 or 8 on 2D6. Core: 4+ on 1D6.
        expect(read([3, 4])).toEqual(jasmine.objectContaining({ location: 'LA', label: 'Left Arm', throughArmorCritical: false }));
        expect(read([4, 5])).toEqual(jasmine.objectContaining({ location: 'RT' }));
        expect(read([4])).toEqual(jasmine.objectContaining({ location: 'LA' }));
        expect(read([3])).toEqual(jasmine.objectContaining({ location: 'RT' }));
        // From behind, an aimed torso takes the hit on its rear armor.
        expect(read([6], 'rear', 'CT')).toEqual(jasmine.objectContaining({ location: 'CT', rear: true, label: 'Center Torso (rear)' }));
        // A location the unit does not have is read on the table.
        expect(read([6], 'front', 'FLL')).toEqual(jasmine.objectContaining({ location: 'RT' }));
    });

    it('rerolls a leg result of an aimed shot at a Mek in partial cover', () => {
        const read = (rerolls: readonly (readonly [number, number])[]) =>
            readAttackHitLocation(mek, 'front', [2, 3], 1, false, 'standard', { location: 'LA', roll: [1], rerolls });
        // 5 and 9 are the legs; 6 is the right torso.
        expect(read([[4, 5], [3, 3], [1, 1]])).toEqual(jasmine.objectContaining({ location: 'RT', label: 'Right Torso (leg rerolled)' }));
        // Every roll made ahead a leg: the shot strikes the location it named.
        expect(read([[4, 5], [2, 3]])).toEqual(jasmine.objectContaining({ location: 'LA' }));
    });

    it('reports automatic rotor destruction only for a Mek physical against a flying VTOL', () => {
        const entity = new TestVtolEntity();
        let airborne = true;
        const snapshot = { locations: entity.damageLocations().map((loc, index) => ({
            ...loc, locationId: 'loc:' + index, previewRemainingInternal: 1, armor: [],
        })) } as unknown as NonMekRecordSheetSnapshot;
        const member = { entity, force: { getUnitSnapshot: () => ({ state: { turn: { airborne } } }) },
            nonMekRecordSheetSnapshot: () => snapshot } as unknown as CBTForceMember;
        const group = { location: [3, 4] as const, aux: 1 };
        expect(weaponHitLocation(member, 'front', { mekPhysical: true }, group))
            .toEqual(jasmine.objectContaining({ label: 'Rotor destroyed', effects: ['rotor-destroyed'] }));
        expect(weaponHitLocation(member, 'front', {}, group)?.label).not.toBe('Rotor destroyed');
        airborne = false;
        expect(weaponHitLocation(member, 'front', { mekPhysical: true }, group)?.label).not.toBe('Rotor destroyed');
    });

    it('lets an aimed shot name the vehicle locations its direction can strike, without their table effects', () => {
        const entity = new TestTankEntity();
        entity.hasTurret.set(true);
        const snapshot = { locations: entity.damageLocations().map((location, index) => ({
            ...location, locationId: `location:${index}`, sheetCode: location.sheetCode, previewRemainingInternal: 3,
            armor: [{ face: 'front', previewRemaining: 10 + index }],
        })) } as unknown as NonMekRecordSheetSnapshot;
        const tank = { entity, nonMekRecordSheetSnapshot: () => snapshot } as unknown as CBTForceMember;

        expect(aimedShotLocations(tank, 'front').map(location => location.code).sort()).toEqual(['FR', 'LS', 'RS', 'TU']);
        expect(aimedShotLocations(tank, 'left').map(location => location.code).sort()).toEqual(['FR', 'LS', 'RR', 'TU']);
        expect(aimedShotLocations(tank, 'rear').map(location => location.code).sort()).toEqual(['LS', 'RR', 'RS', 'TU']);
        // Roll 3 on the front table is a front hit with motive damage; the aimed turret hit carries none.
        expect(readAttackHitLocation(tank, 'front', [1, 2], 1, false, 'standard', { location: 'TU', roll: [3, 4] }))
            .toEqual(jasmine.objectContaining({ kind: 'non-mek', label: 'TU', effects: [] }));
        // The far side cannot be named: the shot is read on the table.
        expect(readAttackHitLocation(tank, 'front', [1, 2], 1, false, 'standard', { location: 'RR', roll: [3, 4] }))
            .toEqual(jasmine.objectContaining({ kind: 'non-mek', label: 'FR · motive' }));
    });

    it('reads swarm damage on the Swarm Attacks Hit Location Table, whatever side the attack is recorded from', () => {
        // 4: rear right torso on a biped; rear center torso on a four-legged Mek.
        for (const arc of ['front', 'left'] as const) {
            expect(readAttackHitLocation(mek, arc, [2, 2], 1, false, 'swarm')).toEqual(jasmine.objectContaining({
                location: 'RT', rear: true, label: 'Right Torso (rear)',
            }));
        }
        const quad = { entity: new TestQuadMekEntity() } as unknown as CBTForceMember;
        expect(readAttackHitLocation(quad, 'front', [2, 2], 1, false, 'swarm')).toEqual(jasmine.objectContaining({
            location: 'CT', rear: true,
        }));
    });

    it('reads punch and kick rolls on the 1D6 tables of the ruleset', () => {
        const entity = createDirectMekRuntimeFixture().entity;
        const member = (ruleset: string) => ({ entity, id: 'mek', force: { getUnitSnapshot: () => ({ ruleset }) } }) as unknown as CBTForceMember;
        // Punch from the front, 1: Total Warfare's left arm, Core's right arm.
        expect(readAttackHitLocation(member('total-warfare'), 'front', [1], 1, false, 'punch')?.label).toBe('Left Arm');
        expect(readAttackHitLocation(member('core-2026'), 'front', [1], 1, false, 'punch')?.label).toBe('Right Arm');
        expect(readAttackHitLocation(member('core-2026'), 'rear', [2], 1, false, 'punch')).toEqual(jasmine.objectContaining({
            location: 'RT', rear: true, label: 'Right Torso (rear)',
        }));
        for (const die of [1, 2, 3, 4, 5, 6]) {
            expect(readAttackHitLocation(member('core-2026'), 'front', [die], 1, true, 'kick'))
                .toEqual({ kind: 'miss', label: 'Cover' });
            expect(readAttackHitLocation(member('core-2026'), 'front', [die], 1, false, 'kick')?.kind).toBe('mek');
        }
        expect(readAttackHitLocation(member('total-warfare'), 'right', [1], 1, false, 'kick')).toEqual(jasmine.objectContaining({
            location: 'RL', rear: false,
        }));
    });

    const memberOf = (entity: BaseEntity, ruleset: string) =>
        ({ entity, id: 'mek', force: { getUnitSnapshot: () => ({ ruleset }) } }) as unknown as CBTForceMember;
    const physicalHit = (entity: BaseEntity, ruleset: string, arc: MekHitArc, roll: number, table: 'punch' | 'kick') => {
        const hit = readAttackHitLocation(memberOf(entity, ruleset), arc, [roll], 1, false, table);
        return hit?.kind === 'mek' ? hit.location : null;
    };

    it('strikes the quad leg locations, with Core mirroring the front/rear punch column', () => {
        const quad = new TestQuadMekEntity();
        // Punch from the front, 1: Total Warfare p.145 left front leg, Core p.239 right front leg.
        expect(readAttackHitLocation(memberOf(quad, 'total-warfare'), 'front', [1], 1, false, 'punch')).toEqual(jasmine.objectContaining({
            location: 'FLL', label: 'Left Front Leg',
        }));
        expect(physicalHit(quad, 'core-2026', 'front', 1, 'punch')).toBe('FRL');
        expect(physicalHit(quad, 'core-2026', 'rear', 5, 'punch')).toBe('RLL');
        expect(physicalHit(quad, 'core-2026', 'front', 4, 'punch')).toBe('LT');
        expect(readAttackHitLocation(memberOf(quad, 'core-2026'), 'front', [1], 1, true, 'punch'))
            .toEqual({ kind: 'miss', label: 'Cover' });
        expect(readAttackHitLocation(memberOf(quad, 'core-2026'), 'front', [4], 1, true, 'punch')?.kind).toBe('mek');
        // Kicks are the same in both books.
        expect(physicalHit(quad, 'core-2026', 'rear', 2, 'kick')).toBe('RRL');
        expect(physicalHit(quad, 'total-warfare', 'left', 6, 'kick')).toBe('RLL');
    });

    it('rolls a tripod kick for the leg it strikes, and punches it on the biped table of its ruleset', () => {
        const tripod = new TestTripodMekEntity();
        // Core Appendix A: 1D6, +1 from the left, -1 from the right; 0-2 right, 3-4 center, 5-7 left leg.
        expect(physicalHit(tripod, 'core-2026', 'front', 2, 'kick')).toBe('RL');
        expect(physicalHit(tripod, 'core-2026', 'left', 2, 'kick')).toBe('CL');
        expect(physicalHit(tripod, 'total-warfare', 'right', 5, 'kick')).toBe('CL');
        expect(physicalHit(tripod, 'total-warfare', 'left', 4, 'kick')).toBe('LL');
        expect(physicalHit(tripod, 'total-warfare', 'front', 1, 'punch')).toBe('LA');
        expect(physicalHit(tripod, 'core-2026', 'front', 1, 'punch')).toBe('RA');
    });
});
