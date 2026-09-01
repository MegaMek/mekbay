// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import type { CBTForceUnit } from '../models/cbt-force-unit.model';
import type { PickerChoice } from '../components/picker/picker.interface';
import { AmmoEquipment, MiscEquipment, WeaponEquipment, type Equipment } from '../models/equipment.model';
import { EMPTY_EQUIPMENT_REGISTRY } from '../models/equipment-lookup';
import type { EquipmentFlag } from '../models/equipment-flags.type';
import type { CriticalSlot } from '../models/force-serialization';
import { MountedEquipment, MountedWeapon } from '../models/mounted-equipment.model';
import { CORE_2026_GAME_RULES, TW_GAME_RULES, type CBTGameRules } from '../models/rules/game-rules';
import type { WeaponType } from '../models/weapon-types.model';
import type { ArmorType } from '../models/entity/types';
import {
    BOMBAST_LASER_CHARGED_STATE,
    BOMBAST_LASER_CHARGE_STATE_KEY,
    BombastLaserHandler,
} from '../equipment-handlers/bombast-laser.handler';
import {
    PPC_CAPACITOR_CHARGED_STATE,
    PPC_CAPACITOR_STATE_KEY,
    PpcCapacitorHandler,
} from '../equipment-handlers/ppc-capacitor.handler';
import {
    GAUSS_POWER_STATE_KEY,
    GAUSS_POWERED_DOWN_STATE,
    GAUSS_POWERING_DOWN_STATE,
    GAUSS_POWERING_UP_STATE,
    isGaussPoweredDown,
} from './gauss-power-state.util';
import type { InventoryControlRules } from './inventory-control.util';
import type { MekStructureKind } from './mek-structure-damage.util';
import {
    createHandlerQueryContext,
    EquipmentInteractionRegistry,
    type EquipmentInteractionHandler,
    type HandlerCommandContext,
} from '../services/equipment-interaction-registry.service';
import {
    applyMekBlowOff,
    applyMekCriticalRoll,
    applyMekCriticalSlotHit,
    canApplyMekCriticalHitToSlot,
    getMekExplosionProtection,
    getRollableMekCriticalSlots,
    hasRollableMekCriticalSlot,
    mekCriticalChanceCanBlowOff,
    mekCriticalChanceModifiers,
    mekCriticalRollDiceCount,
    mekCriticalRollForSlot,
    mekCriticalRollLocation,
    mekCriticalSlotIndexForRoll,
    randomValidMekCriticalRoll,
    previewMekCriticalRoll,
    previewMekCriticalSlotHit,
    resolveMekCriticalChance,
} from './mek-critical-hit.util';

describe('Mek critical-hit workflow', () => {
    it('resolves the standard critical chance table including location blow-off', () => {
        expect(resolveMekCriticalChance(7, true, false)).toEqual({ kind: 'none' });
        expect(resolveMekCriticalChance(8, true, false)).toEqual({ kind: 'critical-hits', count: 1 });
        expect(resolveMekCriticalChance(10, true, false)).toEqual({ kind: 'critical-hits', count: 2 });
        expect(resolveMekCriticalChance(12, true, false)).toEqual({ kind: 'blown-off' });
        expect(resolveMekCriticalChance(12, false, false)).toEqual({ kind: 'critical-hits', count: 3 });
        expect(resolveMekCriticalChance(13, false, true)).toEqual({ kind: 'critical-hits', count: 3 });
        expect(resolveMekCriticalChance(14, false, true)).toEqual({ kind: 'critical-hits', count: 4 });
        expect(resolveMekCriticalChance(14, true, true)).toEqual({ kind: 'blown-off' });
    });

    it('allows blow-off results only for a head or limb location', () => {
        for (const location of ['HD', 'LA', 'RA', 'LL', 'RL', 'CL', 'FLL', 'FRL', 'RLL', 'RRL']) {
            expect(mekCriticalChanceCanBlowOff(location)).withContext(location).toBeTrue();
        }
        for (const location of ['CT', 'LT', 'RT', 'UNKNOWN']) {
            expect(mekCriticalChanceCanBlowOff(location)).withContext(location).toBeFalse();
        }
    });

    it('uses one die for head and legs and the two-die critical-slot chart elsewhere', () => {
        expect(mekCriticalRollDiceCount('HD')).toBe(1);
        expect(mekCriticalRollDiceCount('LL')).toBe(1);
        expect(mekCriticalRollDiceCount('LA')).toBe(2);
        expect(mekCriticalSlotIndexForRoll('LL', [6])).toBe(5);
        expect(mekCriticalSlotIndexForRoll('LA', [1, 1])).toBe(0);
        expect(mekCriticalSlotIndexForRoll('LA', [3, 6])).toBe(5);
        expect(mekCriticalSlotIndexForRoll('LA', [4, 1])).toBe(6);
        expect(mekCriticalSlotIndexForRoll('LT', [6, 6])).toBe(11);
        expect(mekCriticalRollForSlot('LL', 5)).toEqual([6]);
        expect(mekCriticalRollForSlot('LT', 0)).toEqual([1, 1]);
        expect(mekCriticalRollForSlot('LT', 8)).toEqual([4, 3]);
    });

    it('treats torso and arm dice as section and position selectors, never as a sum', () => {
        for (const sectionDie of [1, 2, 3]) {
            for (let positionDie = 1; positionDie <= 6; positionDie++) {
                expect(mekCriticalSlotIndexForRoll('LT', [sectionDie, positionDie]))
                    .withContext(`upper section: ${sectionDie}/${positionDie}`)
                    .toBe(positionDie - 1);
            }
        }
        for (const sectionDie of [4, 5, 6]) {
            for (let positionDie = 1; positionDie <= 6; positionDie++) {
                expect(mekCriticalSlotIndexForRoll('LT', [sectionDie, positionDie]))
                    .withContext(`lower section: ${sectionDie}/${positionDie}`)
                    .toBe(positionDie + 5);
            }
        }
    });

    it('selects the table section before choosing a valid position within it', () => {
        const slots: CriticalSlot[] = [
            { id: 'first-id', name: 'First', loc: 'LT', slot: 1 },
            { id: 'second-id', name: 'Second', loc: 'LT', slot: 8 },
        ];
        const { unit } = criticalUnit(CORE_2026_GAME_RULES, slots);
        const firstRandom = randomSequence(0, 0.999);
        const secondRandom = randomSequence(0.999, 0);

        expect(randomValidMekCriticalRoll(unit, 'LT', firstRandom)).toEqual([1, 2]);
        expect(randomValidMekCriticalRoll(unit, 'LT', secondRandom)).toEqual([6, 3]);
    });

    it('keeps a 50/50 section chance when six valid slots oppose one valid slot', () => {
        const slots: CriticalSlot[] = Array.from({ length: 7 }, (_, slot) => ({
            id: `slot-${slot}`,
            name: `Slot ${slot + 1}`,
            loc: 'LT',
            slot,
        }));
        const { unit } = criticalUnit(CORE_2026_GAME_RULES, slots);

        expect(randomValidMekCriticalRoll(unit, 'LT', randomSequence(0.499999, 0.999999)))
            .toEqual([3, 6]);
        expect(randomValidMekCriticalRoll(unit, 'LT', randomSequence(0.5, 0)))
            .toEqual([4, 1]);
    });

    it('uses the only section that still contains a valid slot', () => {
        const slots: CriticalSlot[] = [
            { id: 'lower-only', name: 'Lower only', loc: 'LT', slot: 6 },
        ];
        const { unit } = criticalUnit(CORE_2026_GAME_RULES, slots);

        expect(randomValidMekCriticalRoll(unit, 'LT', randomSequence(0, 0))).toEqual([4, 1]);
        expect(randomValidMekCriticalRoll(unit, 'LT', randomSequence(0.999999, 0))).toEqual([6, 1]);
    });

    it('excludes unavailable slots while keeping component armor that absorbed one hit rollable', () => {
        const unhittable = document.createElementNS('http://www.w3.org/2000/svg', 'g');
        unhittable.setAttribute('hittable', '0');
        const slots: CriticalSlot[] = [
            { id: 'partial', name: 'Partial', loc: 'LL', slot: 0, armored: true, hits: 1 },
            { id: 'pending-hit', name: 'Pending hit', loc: 'LL', slot: 1, pendingHits: 1 },
            { id: 'pending-destroy', name: 'Pending destroy', loc: 'LL', slot: 2, destroying: 1 },
            { id: 'destroyed', name: 'Destroyed', loc: 'LL', slot: 3, destroyed: 1 },
            { id: 'unhittable', name: 'Unhittable', loc: 'LL', slot: 4, el: unhittable },
            { id: 'valid-id', name: 'Valid name', loc: 'LL', slot: 5 },
        ];
        const { unit } = criticalUnit(CORE_2026_GAME_RULES, slots);

        expect(hasRollableMekCriticalSlot(unit, 'LL')).toBeTrue();
        expect(getRollableMekCriticalSlots(unit, 'LL').map(slot => slot.id))
            .toEqual(['partial', 'valid-id']);
        expect(previewMekCriticalRoll(unit, 'LL', [5])).toBeNull();
        expect(applyMekCriticalRoll(unit, 'LL', [5], true)).toBeNull();
        expect(randomValidMekCriticalRoll(unit, 'LL', () => 0)).toEqual([1]);
        expect(randomValidMekCriticalRoll(unit, 'LL', () => 0.999)).toEqual([6]);
        slots[5].hits = 1;
        expect(hasRollableMekCriticalSlot(unit, 'LL')).toBeTrue();
        expect(randomValidMekCriticalRoll(unit, 'LL', () => 0)).toEqual([1]);
        slots[0].hits = 2;
        slots[0].destroying = Date.now();
        expect(hasRollableMekCriticalSlot(unit, 'LL')).toBeFalse();
        expect(randomValidMekCriticalRoll(unit, 'LL', () => 0)).toBeNull();
    });

    it('lets an intact armored shoulder or hip absorb a limb blow-off result', () => {
        for (const [location, equipment] of [['LA', 'Shoulder'], ['FLL', 'Hip']] as const) {
            const slot: CriticalSlot = {
                id: `${equipment}@${location}`,
                name: equipment,
                loc: location,
                slot: 0,
                armored: true,
                hits: 0,
            };
            const { unit } = criticalUnit(CORE_2026_GAME_RULES, [slot]);
            const setLocationCondition = spyOn(unit, 'setLocationCondition');

            expect(applyMekBlowOff(unit, location, true)).toEqual({ kind: 'absorbed', equipment });
            expect(slot.hits).toBe(1);
            expect(setLocationCondition).not.toHaveBeenCalled();

            expect(applyMekBlowOff(unit, location, true)).toEqual({ kind: 'blown-off' });
            expect(setLocationCondition).toHaveBeenCalledOnceWith(location, 'blown-off', true, true);
        }
    });

    it('preserves an exploding ammo bin count and applies the Core damage cap with transfer', () => {
        const fixture = explodingAmmoUnit(CORE_2026_GAME_RULES);

        const outcome = applyMekCriticalRoll(fixture.unit, 'LT', [1, 1], true);

        expect(outcome?.applied).toBeTrue();
        expect(outcome?.equipment).toBe('AC/10 Ammo');
        expect(outcome?.explosion?.rawDamage).toBe(100);
        expect(outcome?.explosion?.pilotHits).toBe(1);
        expect(fixture.slot.consumed).toBe(0);
        expect(fixture.internalHits.get('LT')).toBe(12);
        expect(fixture.internalHits.get('CT')).toBe(8);
        expect(fixture.armorHits.get('CT-rear')).toBe(12);
        expect(fixture.pilotHits()).toBe(1);
    });

    it('reports the total crew hits applied by an internal explosion', () => {
        const fixture = explodingAmmoUnit(CORE_2026_GAME_RULES);
        const applyCrewHits = spyOn(fixture.unit, 'applyInternalExplosionCrewHits').and.returnValue(3);

        const outcome = applyMekCriticalRoll(fixture.unit, 'LT', [1, 1], true);

        expect(applyCrewHits).toHaveBeenCalledOnceWith(1, undefined);
        expect(outcome?.explosion?.pilotHits).toBe(3);
    });

    it('previews explosion damage and CASE transfer without mutating the unit', () => {
        const fixture = explodingAmmoUnit(CORE_2026_GAME_RULES);

        const preview = previewMekCriticalRoll(fixture.unit, 'LT', [1, 1]);

        expect(preview?.explosion).toEqual(jasmine.objectContaining({
            timing: 'immediate',
            equipment: 'AC/10 Ammo',
            rawDamage: 100,
            pilotHits: 1,
            locations: [
                { location: 'LT', internalDamage: 12, armorDamage: 0, armorRear: true, protection: 'none' },
                { location: 'CT', internalDamage: 8, armorDamage: 12, armorRear: true, protection: 'none' },
            ],
        }));
        expect(fixture.slot.hits).toBe(0);
        expect(fixture.slot.consumed).toBe(0);
        expect(fixture.internalHits.size).toBe(0);
        expect(fixture.armorHits.size).toBe(0);
        expect(fixture.pilotHits()).toBe(0);
    });

    it('includes a linked automatic critical in the explosion preview', () => {
        const fixture = riscPulseModuleUnit();

        const preview = previewMekCriticalRoll(fixture.unit, 'LT', [1, 2]);

        expect(preview?.explosion?.automaticCriticalEquipment).toBe('Medium Laser');
        expect(fixture.moduleSlot.hits ?? 0).toBe(0);
        expect(fixture.laserSlot.hits ?? 0).toBe(0);

        const outcome = applyMekCriticalRoll(fixture.unit, 'LT', [1, 2], true);

        expect(outcome?.explosion?.automaticCritical).toEqual(jasmine.objectContaining({
            equipment: 'Medium Laser',
            location: 'LT',
            slotNumber: 1,
        }));
        expect(fixture.moduleSlot.hits).toBe(1);
        expect(fixture.laserSlot.hits).toBe(1);
    });

    it('applies a rejected ammo critical without consuming ammo or resolving its explosion', () => {
        const fixture = explodingAmmoUnit(CORE_2026_GAME_RULES);

        const outcome = applyMekCriticalRoll(
            fixture.unit,
            'LT',
            [1, 1],
            true,
            { applyExplosion: false },
        );

        expect(outcome?.applied).toBeTrue();
        expect(outcome?.explosion).toBeUndefined();
        expect(fixture.slot.hits).toBe(1);
        expect(fixture.slot.consumed).toBe(0);
        expect(fixture.internalHits.size).toBe(0);
        expect(fixture.armorHits.size).toBe(0);
        expect(fixture.pilotHits()).toBe(0);
    });

    it('uses the same explosion path for a manually selected critical slot', () => {
        const fixture = explodingAmmoUnit(CORE_2026_GAME_RULES);

        const outcome = applyMekCriticalSlotHit(fixture.unit, fixture.slot, true);

        expect(outcome?.explosion?.rawDamage).toBe(100);
        expect(fixture.slot.consumed).toBe(0);
        expect(fixture.internalHits.get('LT')).toBe(12);
        expect(fixture.internalHits.get('CT')).toBe(8);
        expect(fixture.armorHits.get('CT-rear')).toBe(12);
        expect(fixture.pilotHits()).toBe(1);
    });

    it('detects explosive slots but preserves the normal roll for a destroyed location', () => {
        const explosive = explodingAmmoUnit(CORE_2026_GAME_RULES);
        explosive.slot.destroying = Date.now();
        const inertSlot: CriticalSlot = {
            id: 'heat-sink@LT',
            name: 'Heat Sink',
            loc: 'LT',
            slot: 1,
            destroying: Date.now(),
            eq: new MiscEquipment({ id: 'HeatSink', name: 'Heat Sink', type: 'misc' }),
        };
        explosive.slots.push(inertSlot);

        expect(hasRollableMekCriticalSlot(explosive.unit, 'LT', { transfer: false })).toBeFalse();
        expect(hasRollableMekCriticalSlot(explosive.unit, 'LT', {
            transfer: false,
            explosiveSlotsOnly: true,
        })).toBeTrue();
        expect(randomValidMekCriticalRoll(
            explosive.unit,
            'LT',
            () => 0,
            { transfer: false, explosiveSlotsOnly: true },
        )).toEqual([1, 1]);
        expect(previewMekCriticalSlotHit(
            explosive.unit,
            explosive.slot,
            { explosiveSlotsOnly: true },
        )?.explosion?.rawDamage).toBe(100);
        expect(randomValidMekCriticalRoll(
            explosive.unit,
            'LT',
            randomSequence(0, 0.2),
            { transfer: false, explosiveSlotsOnly: true },
        )).toEqual([1, 2]);
        expect(previewMekCriticalRoll(
            explosive.unit,
            'LT',
            [1, 2],
            { transfer: false, explosiveSlotsOnly: true },
        )).toEqual({
            applied: false,
            slotNumber: 2,
            equipment: 'Heat Sink',
            armoredAbsorption: false,
            reason: 'non-explosive',
        });
        expect(applyMekCriticalRoll(
            explosive.unit,
            'LT',
            [1, 2],
            true,
            { transfer: false, explosiveSlotsOnly: true },
        )).toEqual({
            applied: false,
            slotNumber: 2,
            equipment: 'Heat Sink',
            armoredAbsorption: false,
            reason: 'non-explosive',
        });
        expect(inertSlot.hits ?? 0).toBe(0);

        const onlyInertSlot: CriticalSlot = {
            id: 'heat-sink@LT',
            name: 'Heat Sink',
            loc: 'LT',
            slot: 0,
            destroying: Date.now(),
            eq: new MiscEquipment({ id: 'HeatSink', name: 'Heat Sink', type: 'misc' }),
        };
        const inert = criticalUnit(CORE_2026_GAME_RULES, [onlyInertSlot]);
        expect(hasRollableMekCriticalSlot(inert.unit, 'LT', {
            transfer: false,
            explosiveSlotsOnly: true,
        })).toBeFalse();
    });

    it('marks two composite structure pips per point of explosion damage after the Core cap', () => {
        const { unit, internalHits, armorHits } = explodingAmmoUnit(CORE_2026_GAME_RULES, 'composite');

        const outcome = applyMekCriticalRoll(unit, 'LT', [1, 1], true);

        expect(outcome?.explosion?.rawDamage).toBe(100);
        expect(internalHits.get('LT')).toBe(12);
        expect(internalHits.get('CT')).toBe(28);
        expect(armorHits.get('CT-rear')).toBe(12);
    });

    it('shares the final odd Core composite pip across an un-CASED explosion transfer', () => {
        const fixture = explodingAmmoUnit(CORE_2026_GAME_RULES, 'composite');
        fixture.internalHits.set('LT', 1);

        const outcome = applyMekCriticalRoll(fixture.unit, 'LT', [1, 1], true);

        expect(outcome?.explosion?.locations.map(location => ({
            location: location.location,
            internalDamage: location.internalDamage,
            sharedCompositePip: location.sharedCompositePip,
        }))).toEqual([
            { location: 'LT', internalDamage: 11, sharedCompositePip: undefined },
            { location: 'CT', internalDamage: 29, sharedCompositePip: true },
        ]);
        expect(fixture.internalHits.get('LT')).toBe(12);
        expect(fixture.internalHits.get('CT')).toBe(29);
    });

    it('uses TW damage and transfers all uncased explosion overflow', () => {
        const fixture = explodingAmmoUnit(TW_GAME_RULES);

        const outcome = applyMekCriticalRoll(fixture.unit, 'LT', [1, 1], true);

        expect(outcome?.explosion?.rawDamage).toBe(100);
        expect(outcome?.explosion?.pilotHits).toBe(2);
        expect(fixture.internalHits.get('LT')).toBe(12);
        expect(fixture.internalHits.get('CT')).toBe(31);
        expect(fixture.pilotHits()).toBe(2);
    });

    it('applies composite structure damage before TW explosion transfer', () => {
        const { unit, internalHits } = explodingWeaponUnit(
            TW_GAME_RULES,
            ['F_GAUSS'],
            'Gauss Rifle',
            'composite',
        );

        const outcome = applyMekCriticalRoll(unit, 'LT', [1, 1], true);

        expect(outcome?.explosion?.rawDamage).toBe(15);
        expect(internalHits.get('LT')).toBe(12);
        expect(internalHits.get('CT')).toBe(18);
    });

    it('resolves TW CASE II against printed Hardened Armor points', () => {
        const fixture = explodingWeaponUnit(TW_GAME_RULES);
        fixture.unit.getCritSlots().forEach(slot => { slot.loc = 'LA'; });
        const caseII = new MiscEquipment({
            id: 'ISCASEII',
            name: 'CASE II',
            type: 'misc',
            flags: ['F_CASE_II'],
        });
        fixture.unit.getCritSlots().push({
            id: 'caseii@LA',
            name: caseII.name,
            loc: 'LA',
            slot: 5,
            eq: caseII,
        });
        const getArmorPoints = fixture.unit.getArmorPoints;
        spyOn(fixture.unit, 'getArmorTypeAt').and.callFake(location =>
            location === 'LA' ? 'HARDENED' : 'STANDARD');
        spyOn(fixture.unit, 'getArmorPoints').and.callFake((location, rear) =>
            location === 'LA' && !rear ? 18 : getArmorPoints(location, rear));

        const outcome = applyMekCriticalRoll(fixture.unit, 'LA', [1, 1], true);

        expect(outcome?.explosion?.locations[0]).toEqual(jasmine.objectContaining({
            location: 'LA',
            internalDamage: 1,
            armorDamage: 10,
            protection: 'case-ii',
        }));
        expect(fixture.armorHits.get('LA')).toBe(10);
    });

    it('drops the odd composite remainder instead of transferring fractional explosion damage', () => {
        const fixture = explodingWeaponUnit(TW_GAME_RULES, ['F_GAUSS'], 'Gauss Rifle', 'composite');
        fixture.internalHits.set('LT', 1);

        const outcome = applyMekCriticalRoll(fixture.unit, 'LT', [1, 1], true);

        expect(outcome?.explosion?.locations.map(location => ({
            location: location.location,
            internalDamage: location.internalDamage,
        }))).toEqual([
            { location: 'LT', internalDamage: 11 },
            { location: 'CT', internalDamage: 18 },
        ]);
        expect(fixture.internalHits.get('LT')).toBe(12);
        expect(fixture.internalHits.get('CT')).toBe(18);
    });

    it('lets a legal armored component absorb one hit and take the next critical', () => {
        const equipment = new MiscEquipment({
            id: 'ArmoredComponent',
            name: 'Armored Component',
            type: 'misc',
        });
        const slot: CriticalSlot = {
            id: 'armored@LT',
            name: equipment.name,
            loc: 'LT',
            slot: 0,
            armored: true,
            eq: equipment,
        };
        const entry = new MountedEquipment({
            owner: null as unknown as CBTForceUnit,
            id: 'armored-component',
            name: equipment.name,
            equipment,
            critSlots: [slot],
        });
        const { unit } = criticalUnit(CORE_2026_GAME_RULES, [slot], [entry]);
        entry.owner = unit;

        const firstHit = applyMekCriticalRoll(unit, 'LT', [1, 1], true);

        expect(firstHit?.armoredAbsorption).toBeTrue();
        expect(firstHit?.explosion).toBeUndefined();
        expect(slot.hits).toBe(1);
        expect(hasRollableMekCriticalSlot(unit, 'LT')).toBeTrue();

        const secondHit = applyMekCriticalRoll(unit, 'LT', [1, 1], true);

        expect(secondHit?.applied).toBeTrue();
        expect(secondHit?.armoredAbsorption).toBeFalse();
        expect(secondHit?.explosion).toBeUndefined();
        expect(slot.hits).toBe(2);
        expect(hasRollableMekCriticalSlot(unit, 'LT')).toBeFalse();
    });

    it('repeats an unarmored slot only when the threshold exceeds one and the mount has one slot', () => {
        const core = autocannonUnit(CORE_2026_GAME_RULES, 1);

        expect(applyMekCriticalRoll(core.unit, 'LT', [1, 1], true)?.applied).toBeTrue();
        expect(hasRollableMekCriticalSlot(core.unit, 'LT')).toBeTrue();
        expect(applyMekCriticalRoll(core.unit, 'LT', [1, 1], true)?.applied).toBeTrue();
        expect(core.slots[0].hits).toBe(2);
        expect(hasRollableMekCriticalSlot(core.unit, 'LT')).toBeFalse();

        const tw = autocannonUnit(TW_GAME_RULES, 1);
        expect(applyMekCriticalRoll(tw.unit, 'LT', [1, 1], true)?.applied).toBeTrue();
        expect(hasRollableMekCriticalSlot(tw.unit, 'LT')).toBeFalse();

        const multiSlot = autocannonUnit(CORE_2026_GAME_RULES, 2);
        expect(applyMekCriticalRoll(multiSlot.unit, 'LT', [1, 1], true)?.applied).toBeTrue();
        expect(canApplyMekCriticalHitToSlot(multiSlot.unit, multiSlot.slots[0])).toBeFalse();
        expect(canApplyMekCriticalHitToSlot(multiSlot.unit, multiSlot.slots[1])).toBeTrue();
    });

    it('requires armor plus two component hits to destroy an armored one-slot Core AC/2', () => {
        const { unit, slots } = autocannonUnit(CORE_2026_GAME_RULES, 1, true);

        const armorHit = applyMekCriticalRoll(unit, 'LT', [1, 1], true);
        expect(armorHit?.armoredAbsorption).toBeTrue();
        expect(slots[0].hits).toBe(1);
        expect(hasRollableMekCriticalSlot(unit, 'LT')).toBeTrue();

        const firstComponentHit = applyMekCriticalRoll(unit, 'LT', [1, 1], true);
        expect(firstComponentHit?.armoredAbsorption).toBeFalse();
        expect(slots[0].hits).toBe(2);
        expect(hasRollableMekCriticalSlot(unit, 'LT')).toBeTrue();

        const secondComponentHit = applyMekCriticalRoll(unit, 'LT', [1, 1], true);
        expect(secondComponentHit?.applied).toBeTrue();
        expect(slots[0].hits).toBe(3);
        expect(hasRollableMekCriticalSlot(unit, 'LT')).toBeFalse();
    });

    it('transfers only when the original location had no applicable slot at phase start', () => {
        const leftArm: CriticalSlot = {
            id: 'spent@LA', name: 'Spent component', loc: 'LA', slot: 0, hits: 1, destroyed: 1,
        };
        const leftTorso: CriticalSlot = { id: 'target@LT', name: 'Target component', loc: 'LT', slot: 0 };
        const priorPhase = criticalUnit(CORE_2026_GAME_RULES, [leftArm, leftTorso]);

        expect(mekCriticalRollLocation(priorPhase.unit, 'LA')).toBe('LT');
        expect(applyMekCriticalRoll(priorPhase.unit, 'LA', [1, 1], true)?.equipment)
            .toBe('Target component');

        const pendingArm: CriticalSlot = {
            id: 'pending@LA', name: 'Pending component', loc: 'LA', slot: 0,
            hits: 1, destroying: Date.now(),
        };
        const currentPhase = criticalUnit(CORE_2026_GAME_RULES, [pendingArm, { ...leftTorso }]);
        expect(mekCriticalRollLocation(currentPhase.unit, 'LA')).toBe('LA');
        expect(hasRollableMekCriticalSlot(currentPhase.unit, 'LA')).toBeFalse();
    });

    it('applies ruleset and armor critical-chance modifiers', () => {
        const core = criticalUnit(
            CORE_2026_GAME_RULES,
            [],
            [],
            'reinforced',
            undefined,
            {},
            { armorType: 'HARDENED' },
        );
        expect(mekCriticalChanceModifiers(core.unit, 'LT')).toEqual([
            { label: 'Reinforced structure', value: -1 },
            {
                label: 'Hardened armor in damaged facing',
                value: -2,
                optional: true,
                enabled: true,
            },
        ]);

        const tw = criticalUnit(
            TW_GAME_RULES,
            [],
            [],
            'reinforced',
            undefined,
            {},
            { armorType: 'HARDENED', subtype: 'Industrial Mek' },
        );
        expect(mekCriticalChanceModifiers(tw.unit, 'LT')).toEqual([
            { label: 'Reinforced structure', value: -1 },
            { label: 'IndustrialMech', value: 2 },
            {
                label: 'Hardened armor in damaged facing',
                value: -2,
                optional: true,
                enabled: true,
            },
        ]);
        expect(mekCriticalChanceModifiers(tw.unit, 'LT', { hardenedArmorApplies: true })).toContain(
            { label: 'Hardened armor in damaged facing', value: -2 },
        );
        expect(mekCriticalChanceModifiers(tw.unit, 'LT', { hardenedArmorApplies: false })
            .some(modifier => modifier.label.includes('Hardened'))).toBeFalse();

        const primitiveIndustrial = criticalUnit(
            TW_GAME_RULES,
            [],
            [],
            null,
            undefined,
            {},
            {
                subtype: 'Industrial Mek',
                features: ['Primitive Industrial Cockpit'],
            },
        );
        expect(mekCriticalChanceModifiers(primitiveIndustrial.unit, 'LT')).toEqual([
            { label: 'IndustrialMech', value: 2 },
            { label: 'Primitive/RetroTech Mek', value: 2 },
        ]);
    });

    it('applies the Core CASE II modifier only to explosion-triggered critical chances', () => {
        const core = criticalUnit(CORE_2026_GAME_RULES, []);
        const tw = criticalUnit(TW_GAME_RULES, []);

        expect(mekCriticalChanceModifiers(core.unit, 'LT')).toEqual([]);
        expect(mekCriticalChanceModifiers(core.unit, 'LT', {
            explosionProtection: 'case-ii',
        })).toEqual([
            { label: 'CASE II internal explosion', value: -1 },
        ]);
        expect(mekCriticalChanceModifiers(tw.unit, 'LT', {
            explosionProtection: 'case-ii',
        })).toEqual([]);
    });

    it('uses ruleset-specific damage for an intrinsically explosive weapon', () => {
        const core = explodingWeaponUnit(CORE_2026_GAME_RULES, [], 'Explosive Weapon');
        const tw = explodingWeaponUnit(TW_GAME_RULES, [], 'Explosive Weapon');

        const coreOutcome = applyMekCriticalRoll(core.unit, 'LT', [1, 1], true);
        const twOutcome = applyMekCriticalRoll(tw.unit, 'LT', [1, 1], true);

        expect(coreOutcome?.equipment).toBe('Explosive Weapon');
        expect(coreOutcome?.explosion?.rawDamage).toBe(8);
        expect(core.internalHits.get('LT')).toBe(8);
        expect(twOutcome?.explosion?.rawDamage).toBe(15);
        expect(tw.internalHits.get('LT')).toBe(12);
        expect(tw.internalHits.get('CT')).toBe(3);
    });

    it('does not explode a powered-down Gauss weapon', () => {
        const gauss = explodingWeaponUnit(TW_GAME_RULES);
        gauss.entry.states.set(GAUSS_POWER_STATE_KEY, GAUSS_POWERED_DOWN_STATE);

        const outcome = applyMekCriticalRoll(gauss.unit, 'LT', [1, 1], true);

        expect(outcome?.applied).toBeTrue();
        expect(outcome?.equipment).toBe('Gauss Rifle');
        expect(outcome?.explosion).toBeUndefined();
        expect(gauss.internalHits.size).toBe(0);
    });

    it('uses the effective Gauss state while a power transition is pending', () => {
        const poweringDown = explodingWeaponUnit(TW_GAME_RULES);
        poweringDown.entry.states.set(GAUSS_POWER_STATE_KEY, GAUSS_POWERING_DOWN_STATE);
        const poweringDownOutcome = applyMekCriticalRoll(poweringDown.unit, 'LT', [1, 1], true);

        expect(poweringDownOutcome?.explosion?.rawDamage).toBe(15);

        const poweringUp = explodingWeaponUnit(TW_GAME_RULES);
        poweringUp.entry.states.set(GAUSS_POWER_STATE_KEY, GAUSS_POWERING_UP_STATE);
        const poweringUpOutcome = applyMekCriticalRoll(poweringUp.unit, 'LT', [1, 1], true);

        expect(poweringUpOutcome?.explosion).toBeUndefined();
        expect(poweringUp.internalHits.size).toBe(0);
    });

    it('ignores ordinary autocannon explosive metadata in both rulesets', () => {
        const core = autocannonUnit(CORE_2026_GAME_RULES);
        applyMekCriticalRoll(core.unit, 'LT', [1, 1], true);
        const coreSecondHit = applyMekCriticalRoll(core.unit, 'LT', [1, 2], true);

        expect(coreSecondHit?.applied).toBeTrue();
        expect(coreSecondHit?.explosion).toBeUndefined();
        expect(core.internalHits.size).toBe(0);

        const tw = autocannonUnit(TW_GAME_RULES);
        const twHit = applyMekCriticalRoll(tw.unit, 'LT', [1, 1], true);

        expect(twHit?.explosion).toBeUndefined();
        expect(tw.internalHits.size).toBe(0);
    });

    it('trusts effective X for weapon explosion eligibility', () => {
        const launcher = nonExplosiveWeaponWithXUnit();

        const outcome = applyMekCriticalRoll(launcher.unit, 'LT', [1, 1], true);

        expect(outcome?.explosion?.rawDamage).toBe(5);
        expect(launcher.internalHits.get('LT')).toBe(5);
    });

    for (const [rules, expectedDamage, roll] of [
        [CORE_2026_GAME_RULES, 6, [1, 1]],
        [TW_GAME_RULES, 10, [1, 3]],
    ] as const) {
        it(`delays a charged PPC/capacitor explosion under ${rules.id} rules`, () => {
            const ppc = chargedPpcUnit(rules);

            const outcome = applyMekCriticalRoll(ppc.unit, 'LT', roll, false, {
                pilotDamageGroup: 'phase-closed:combat:weapon-phase',
            });

            expect(outcome?.pendingExplosion).toEqual({
                equipment: 'Light PPC + PPC Capacitor',
                rawDamage: expectedDamage,
            });
            expect(outcome?.explosion).toBeUndefined();
            expect(ppc.internalHits.size).toBe(0);

            ppc.handler.beforeEquipmentStateCommit(ppc.weapon);

            expect(ppc.internalHits.get('LT')).toBe(expectedDamage);
            expect(ppc.pilotDamageGroups).toEqual(['phase-closed:combat:weapon-phase']);
            expect(ppc.slots.every(slot => slot.destroying !== undefined)).toBeTrue();
            expect(ppc.capacitor.states.has(PPC_CAPACITOR_STATE_KEY)).toBeFalse();
        });
    }

    it('does not queue a delayed component explosion when automation rejects it', () => {
        const ppc = chargedPpcUnit(CORE_2026_GAME_RULES);

        const outcome = applyMekCriticalRoll(
            ppc.unit,
            'LT',
            [1, 1],
            false,
            { applyExplosion: false },
        );
        ppc.handler.beforeEquipmentStateCommit(ppc.weapon);

        expect(outcome?.pendingExplosion).toBeUndefined();
        expect(outcome?.explosion).toBeUndefined();
        expect(ppc.internalHits.size).toBe(0);
        expect(ppc.slots[0].destroying).toBeDefined();
        expect(ppc.slots.slice(1).every(slot => slot.destroying === undefined)).toBeTrue();
    });

    it('cancels a pending PPC/capacitor explosion when the PPC fires in that phase', () => {
        const ppc = chargedPpcUnit(CORE_2026_GAME_RULES);

        const outcome = applyMekCriticalRoll(ppc.unit, 'LT', [1, 1], false);
        ppc.handler.afterInventoryControlFire(ppc.weapon);
        ppc.handler.beforeEquipmentStateCommit(ppc.weapon);

        expect(outcome?.pendingExplosion?.rawDamage).toBe(6);
        expect(ppc.internalHits.size).toBe(0);
        expect(ppc.slots[0].destroying).toBeDefined();
        expect(ppc.slots.slice(1).every(slot => slot.destroying === undefined)).toBeTrue();
    });

    it('cancels a pending PPC/capacitor explosion when the charge is manually discharged', () => {
        const ppc = chargedPpcUnit(CORE_2026_GAME_RULES);

        const outcome = applyMekCriticalRoll(ppc.unit, 'LT', [1, 1], false);
        discharge(ppc.handler, ppc.weapon);
        ppc.handler.beforeEquipmentStateCommit(ppc.weapon);

        expect(outcome?.pendingExplosion).toBeDefined();
        expect(ppc.internalHits.size).toBe(0);
        expect(ppc.slots[0].destroying).toBeDefined();
        expect(ppc.slots.slice(1).every(slot => slot.destroying === undefined)).toBeTrue();
        expect(ppc.capacitor.states.has(PPC_CAPACITOR_STATE_KEY)).toBeFalse();
    });

    it('delays a charged Bombast Laser explosion until phase commit', () => {
        const bombast = chargedBombastUnit();

        const outcome = applyMekCriticalRoll(bombast.unit, 'LT', [1, 1], false);

        expect(outcome?.pendingExplosion).toEqual({ equipment: 'Bombast Laser', rawDamage: 12 });
        expect(bombast.internalHits.size).toBe(0);

        bombast.handler.beforeEquipmentStateCommit(bombast.weapon);

        expect(bombast.internalHits.get('LT')).toBe(12);
        expect(bombast.weapon.states.has(BOMBAST_LASER_CHARGE_STATE_KEY)).toBeFalse();
    });

    it('cancels a pending Bombast Laser explosion when it fires in that phase', () => {
        const bombast = chargedBombastUnit();

        applyMekCriticalRoll(bombast.unit, 'LT', [1, 1], false);
        bombast.handler.afterInventoryControlFire(bombast.weapon);
        bombast.handler.beforeEquipmentStateCommit(bombast.weapon);

        expect(bombast.internalHits.size).toBe(0);
        expect(bombast.slots[0].destroying).toBeDefined();
        expect(bombast.slots.slice(1).every(slot => slot.destroying === undefined)).toBeTrue();
    });

    it('cancels a pending Bombast Laser explosion when the charge is manually discharged', () => {
        const bombast = chargedBombastUnit();

        const outcome = applyMekCriticalRoll(bombast.unit, 'LT', [1, 1], false);
        discharge(bombast.handler, bombast.weapon);
        bombast.handler.beforeEquipmentStateCommit(bombast.weapon);

        expect(outcome?.pendingExplosion).toBeDefined();
        expect(bombast.internalHits.size).toBe(0);
        expect(bombast.slots[0].destroying).toBeDefined();
        expect(bombast.slots.slice(1).every(slot => slot.destroying === undefined)).toBeTrue();
        expect(bombast.weapon.states.has(BOMBAST_LASER_CHARGE_STATE_KEY)).toBeFalse();
    });

    it('resolves a charged component explosion immediately when phases are not tracked', () => {
        const bombast = chargedBombastUnit();

        const outcome = applyMekCriticalRoll(bombast.unit, 'LT', [1, 1], true);

        expect(outcome?.pendingExplosion).toBeUndefined();
        expect(outcome?.explosion?.rawDamage).toBe(12);
        expect(bombast.internalHits.get('LT')).toBe(12);
        expect(bombast.weapon.states.has(BOMBAST_LASER_CHARGE_STATE_KEY)).toBeFalse();
    });

    it('does not consume a guided hit when the rolled slot is empty', () => {
        const { unit } = explodingAmmoUnit(CORE_2026_GAME_RULES);

        const outcome = applyMekCriticalRoll(unit, 'LT', [1, 2], true);

        expect(outcome).toEqual({
            applied: false,
            slotNumber: 2,
            equipment: null,
            armoredAbsorption: false,
            reason: 'empty',
        });
    });

    it('detects operational CASE and gives CASE II precedence', () => {
        const caseEquipment = new MiscEquipment({
            id: 'ISCASE',
            name: 'CASE',
            type: 'misc',
            flags: ['F_CASE'],
        });
        const caseIIEquipment = new MiscEquipment({
            id: 'ISCASEII',
            name: 'CASE II',
            type: 'misc',
            flags: ['F_CASE_II'],
        });
        const caseSlot: CriticalSlot = { id: 'case@LT', name: 'CASE', loc: 'LT', slot: 5, eq: caseEquipment };
        const caseIISlot: CriticalSlot = { id: 'caseii@LT', name: 'CASE II', loc: 'LT', slot: 6, eq: caseIIEquipment };
        const { unit } = criticalUnit(CORE_2026_GAME_RULES, [caseSlot, caseIISlot]);

        expect(getMekExplosionProtection(unit, 'LT')).toBe('case-ii');
        caseIISlot.destroyed = 1;
        expect(getMekExplosionProtection(unit, 'LT')).toBe('case');
        caseSlot.destroying = 1;
        expect(getMekExplosionProtection(unit, 'LT')).toBe('case');
        caseSlot.destroyed = 1;
        expect(getMekExplosionProtection(unit, 'LT')).toBe('none');
    });

    it('tags internal damage from an explosion with the protection that resolved it', () => {
        const caseIIEquipment = new MiscEquipment({
            id: 'ISCASEII',
            name: 'CASE II',
            type: 'misc',
            flags: ['F_CASE_II'],
        });
        const fixture = explodingWeaponUnit(CORE_2026_GAME_RULES);
        fixture.unit.getCritSlots().push({
            id: 'caseii@LT',
            name: 'CASE II',
            loc: 'LT',
            slot: 5,
            eq: caseIIEquipment,
        });
        const addInternalHits = spyOn(fixture.unit, 'addInternalHits').and.callThrough();

        applyMekCriticalRoll(fixture.unit, 'LT', [1, 1], true);

        expect(addInternalHits).toHaveBeenCalledOnceWith(
            'LT',
            1,
            true,
            { explosionProtection: 'case-ii', armorDamagedBySameHit: true },
        );
    });
});

function explodingAmmoUnit(gameRules: CBTGameRules, structureKind: MekStructureKind | null = null) {
    const ammo = new AmmoEquipment({
        id: 'TestAC10Ammo',
        name: 'AC/10 Ammo',
        type: 'ammo',
        stats: { explosive: true },
        ammo: { type: 'AC', rackSize: 10, shots: 10, damagePerShot: 1 },
    });
    const slot: CriticalSlot = {
        id: 'ammo@LT',
        name: ammo.name,
        loc: 'LT',
        slot: 0,
        totalAmmo: 10,
        consumed: 0,
        hits: 0,
        eq: ammo,
    };
    const slots = [slot];
    return { ...criticalUnit(gameRules, slots, [], structureKind), slot, slots };
}

function riscPulseModuleUnit() {
    const laserEquipment = new WeaponEquipment({
        id: 'MediumLaser',
        name: 'Medium Laser',
        type: 'weapon',
        flags: ['F_ENERGY', 'F_LASER'],
        weapon: { damage: 5 },
    });
    const moduleEquipment = new MiscEquipment({
        id: 'RISCLaserPulseModule',
        name: 'RISC Laser Pulse Module',
        type: 'misc',
        flags: ['F_WEAPON_ENHANCEMENT', 'F_RISC_LASER_PULSE_MODULE'],
        stats: { explosive: true },
    });
    const laserSlot: CriticalSlot = {
        id: 'laser@LT',
        name: laserEquipment.name,
        loc: 'LT',
        slot: 0,
        eq: laserEquipment,
    };
    const moduleSlot: CriticalSlot = {
        id: 'module@LT',
        name: moduleEquipment.name,
        loc: 'LT',
        slot: 1,
        eq: moduleEquipment,
    };
    const laser = new MountedWeapon({
        owner: null as unknown as CBTForceUnit,
        id: 'laser',
        name: laserEquipment.name,
        equipment: laserEquipment,
        critSlots: [laserSlot],
    });
    const module = new MountedEquipment({
        owner: null as unknown as CBTForceUnit,
        id: 'module',
        name: moduleEquipment.name,
        equipment: moduleEquipment,
        critSlots: [moduleSlot],
        parent: laser,
    });
    const fixture = criticalUnit(TW_GAME_RULES, [laserSlot, moduleSlot], [laser, module]);
    laser.owner = fixture.unit;
    module.owner = fixture.unit;
    return { ...fixture, laserSlot, moduleSlot };
}

function explodingWeaponUnit(
    gameRules: CBTGameRules,
    flags: EquipmentFlag[] = ['F_GAUSS'],
    name = 'Gauss Rifle',
    structureKind: MekStructureKind | null = null,
): {
    readonly unit: CBTForceUnit;
    readonly entry: MountedEquipment;
    readonly internalHits: Map<string, number>;
    readonly armorHits: Map<string, number>;
} {
    const weapon = new WeaponEquipment({
        id: 'TestGauss',
        name,
        type: 'weapon',
        flags,
        stats: { explosive: true, criticalSlots: 4 },
        weapon: { explosionDamage: 15 },
    });
    const slots: CriticalSlot[] = Array.from({ length: 4 }, (_, slot) => ({
        id: 'gauss@LT',
        name: weapon.id,
        loc: 'LT',
        slot,
        hits: 0,
        eq: weapon,
    }));
    const entry = new MountedWeapon({
        owner: null as unknown as CBTForceUnit,
        id: 'test-weapon',
        name: weapon.name,
        equipment: weapon,
        critSlots: slots,
        states: new Map(),
    });
    const harness = criticalUnit(gameRules, slots, [entry], structureKind);
    entry.owner = harness.unit;
    return { ...harness, entry };
}

function autocannonUnit(gameRules: CBTGameRules, slotCount = 2, armored = false) {
    const equipment = new WeaponEquipment({
        id: 'Autocannon/2',
        name: 'AC/2',
        type: 'weapon',
        flags: ['F_AC'],
        stats: { explosive: true, criticalSlots: slotCount },
        weapon: { ammoType: 'AC', damage: 2, explosionDamage: 2 },
    });
    const slots: CriticalSlot[] = Array.from({ length: slotCount }, (_, slot) => ({
        id: `${equipment.id}@LT#${slot}`,
        name: equipment.name,
        loc: 'LT',
        slot,
        armored,
        eq: equipment,
    }));
    const entry = new MountedWeapon({
        owner: null as unknown as CBTForceUnit,
        id: equipment.id,
        name: equipment.name,
        equipment,
        critSlots: slots,
    });
    const fixture = criticalUnit(gameRules, slots, [entry]);
    entry.owner = fixture.unit;
    return { ...fixture, entry, slots };
}

function nonExplosiveWeaponWithXUnit() {
    const equipment = new WeaponEquipment({
        id: 'Test Launcher',
        name: 'Test Launcher',
        type: 'weapon',
        stats: { criticalSlots: 1 },
        weapon: { damage: 5, explosionDamage: 5 },
    });
    const slot: CriticalSlot = {
        id: `${equipment.id}@LT#0`,
        name: equipment.name,
        loc: 'LT',
        slot: 0,
        eq: equipment,
    };
    const entry = new MountedWeapon({
        owner: null as unknown as CBTForceUnit,
        id: equipment.id,
        name: equipment.name,
        equipment,
        critSlots: [slot],
    });
    const fixture = criticalUnit(
        TW_GAME_RULES,
        [slot],
        [entry],
        null,
        () => new Set<WeaponType>(['X']),
    );
    entry.owner = fixture.unit;
    return fixture;
}

function chargedPpcUnit(gameRules: CBTGameRules) {
    const handler = new PpcCapacitorHandler();
    const ppcEquipment = new WeaponEquipment({
        id: 'ISLightPPC',
        name: 'Light PPC',
        type: 'weapon',
        flags: ['F_PPC', 'F_PPC_CAPACITOR_COMPATIBLE', 'F_DIRECT_FIRE', 'F_ENERGY'],
        weapon: { damage: 5 },
    });
    const capacitorEquipment = new MiscEquipment({
        id: 'ISPPC Capacitor',
        name: 'PPC Capacitor',
        type: 'misc',
        flags: ['F_WEAPON_ENHANCEMENT', 'F_PPC_CAPACITOR'],
    });
    const weaponSlots: CriticalSlot[] = [0, 1].map(slot => ({
        id: `${ppcEquipment.id}@LT#${slot}`,
        name: ppcEquipment.name,
        loc: 'LT',
        slot,
        eq: ppcEquipment,
    }));
    const capacitorSlots: CriticalSlot[] = [{
        id: `${capacitorEquipment.id}@LT#2`,
        name: capacitorEquipment.name,
        loc: 'LT',
        slot: 2,
        eq: capacitorEquipment,
    }];
    const slots = [...weaponSlots, ...capacitorSlots];
    let weapon!: MountedWeapon;
    const capacitor = new MountedEquipment({
        owner: null as unknown as CBTForceUnit,
        id: 'capacitor',
        name: capacitorEquipment.id,
        equipment: capacitorEquipment,
        critSlots: capacitorSlots,
        states: new Map([[PPC_CAPACITOR_STATE_KEY, PPC_CAPACITOR_CHARGED_STATE]]),
    });
    weapon = new MountedWeapon({
        owner: null as unknown as CBTForceUnit,
        id: 'ppc',
        name: ppcEquipment.id,
        equipment: ppcEquipment,
        critSlots: weaponSlots,
    });
    weapon.setLinkedEquipment([capacitor]);
    const fixture = criticalUnit(
        gameRules,
        slots,
        [weapon, capacitor],
        null,
        entry => {
            const types = new Set(entry.getWeaponTypes());
            if (entry === weapon) types.add('X');
            return types;
        },
        {
            applyDamageEffects: (_entry, damage) => ({
                ...damage,
                values: damage.values.map(value => value + 5),
                maximum: damage.maximum + 5,
            }),
        },
        {},
        [handler],
    );
    weapon.owner = fixture.unit;
    capacitor.owner = fixture.unit;
    installImmediateCommitHook(fixture.unit, () => handler.beforeEquipmentStateCommit(weapon));
    return {
        ...fixture,
        weapon,
        capacitor,
        slots,
        handler,
    };
}

function chargedBombastUnit() {
    const handler = new BombastLaserHandler();
    const equipment = new WeaponEquipment({
        id: 'ISBombastLaser',
        name: 'Bombast Laser',
        type: 'weapon',
        flags: ['F_BOMBAST_LASER', 'F_DIRECT_FIRE', 'F_ENERGY', 'F_LASER'],
        stats: { criticalSlots: 6 },
        weapon: { damage: 12 },
    });
    const slots: CriticalSlot[] = Array.from({ length: 6 }, (_, slot) => ({
        id: `${equipment.id}@LT#${slot}`,
        name: equipment.name,
        loc: 'LT',
        slot,
        eq: equipment,
    }));
    let weapon!: MountedWeapon;
    weapon = new MountedWeapon({
        owner: null as unknown as CBTForceUnit,
        id: equipment.id,
        name: equipment.id,
        equipment,
        critSlots: slots,
        states: new Map([[BOMBAST_LASER_CHARGE_STATE_KEY, BOMBAST_LASER_CHARGED_STATE]]),
    });
    const fixture = criticalUnit(
        CORE_2026_GAME_RULES,
        slots,
        [weapon],
        null,
        entry => {
            const types = new Set(entry.getWeaponTypes());
            if (entry === weapon) types.add('X');
            return types;
        },
        {},
        {},
        [handler],
    );
    weapon.owner = fixture.unit;
    installImmediateCommitHook(fixture.unit, () => handler.beforeEquipmentStateCommit(weapon));
    return { ...fixture, weapon, slots, handler };
}

function installImmediateCommitHook(unit: CBTForceUnit, beforeCommit: () => void): void {
    const applyHit = unit.applyHitToCritSlot.bind(unit);
    unit.applyHitToCritSlot = (slot, damage = 1, consolidateImmediately = false) => {
        applyHit(slot, damage, false);
        if (consolidateImmediately) beforeCommit();
    };
}

function discharge(
    handler: PpcCapacitorHandler | BombastLaserHandler,
    equipment: MountedEquipment,
): void {
    handler.handleSelection(
        equipment,
        { value: 'discharged' } as PickerChoice,
        {
            toastService: jasmine.createSpyObj('ToastService', ['showToast']),
        } as HandlerCommandContext,
    );
}

function randomSequence(...values: number[]): () => number {
    let index = 0;
    return () => values[index++] ?? 0;
}

function criticalUnit(
    gameRules: CBTGameRules,
    slots: CriticalSlot[],
    inventory: MountedEquipment[] = [],
    structureKind: MekStructureKind | null = null,
    effectiveWeaponTypes?: (entry: MountedWeapon) => ReadonlySet<WeaponType>,
    inventoryControlRules: InventoryControlRules = {},
    unitData: {
        readonly armorType?: ArmorType;
        readonly features?: readonly string[];
        readonly subtype?: 'BattleMek' | 'Industrial Mek' | 'Quad Industrial Mek';
    } = {},
    handlers: readonly EquipmentInteractionHandler[] = [],
): {
    readonly unit: CBTForceUnit;
    readonly internalHits: Map<string, number>;
    readonly armorHits: Map<string, number>;
    readonly pilotHits: () => number;
    readonly pilotDamageGroups: readonly string[];
} {
    const internalPoints = new Map<string, number>([
        ['LA', 10], ['LL', 15], ['LT', 12], ['CT', 31],
    ]);
    const armorPoints = new Map<string, number>([
        ['LA', 16], ['LL', 21], ['LT', 16], ['CT', 31],
        ['LT-rear', 10], ['CT-rear', 12],
    ]);
    const internalHits = new Map<string, number>();
    const armorHits = new Map<string, number>();
    let crewHits = 0;
    const pilotDamageGroups: string[] = [];
    const interactionRegistry = new EquipmentInteractionRegistry();
    for (const handler of handlers) interactionRegistry.register(handler);
    const handlerQueryContext = createHandlerQueryContext(EMPTY_EQUIPMENT_REGISTRY);
    const unit = {
        gameRules,
        rules: {
            mountedCriticalDamageDestructionThreshold: (equipment: Equipment | null) =>
                gameRules.id === 'core2026' && equipment?.hasFlag('F_AC') ? 2 : 1,
        },
        locations: { internal: internalPoints },
        getCritSlots: () => slots,
        getCritSlot: (location: string, index: number) =>
            slots.find(candidate => candidate.loc === location && candidate.slot === index) ?? null,
        getInventory: () => inventory,
        getEquipmentStatus: () => 'available',
        isEquipmentOperational: () => true,
        getEffectiveWeaponTypes: (entry: MountedWeapon) => effectiveWeaponTypes?.(entry) ?? (() => {
            const types = new Set(entry.getWeaponTypes());
            if (entry.equipment.hasFlag('F_GAUSS') && isGaussPoweredDown(entry)) types.delete('X');
            return types;
        })(),
        getCriticalDelayedExplosion: (entry: MountedEquipment, context: Parameters<
            EquipmentInteractionRegistry['getCriticalDelayedExplosion']
        >[1]) => interactionRegistry.getCriticalDelayedExplosion(entry, context, handlerQueryContext),
        getInventoryControlSelectedAmmo: () => null,
        getEquipmentRegistry: () => EMPTY_EQUIPMENT_REGISTRY,
        getInventoryControlRules: () => inventoryControlRules,
        setInventoryEntry: (entry: MountedEquipment) => {
            const index = inventory.findIndex(candidate => candidate.id === entry.id);
            if (index === -1) inventory.push(entry);
            else inventory[index] = entry;
        },
        setCritSlots: (next: CriticalSlot[]) => slots.splice(0, slots.length, ...next),
        findCurrentCriticalSlot: (snapshot: CriticalSlot) =>
            slots.find(candidate => candidate.loc === snapshot.loc && candidate.slot === snapshot.slot) ?? null,
        getUnit: () => ({
            comp: [],
            structureType: structureKind,
            armorType: unitData.armorType ?? 'STANDARD',
            features: unitData.features ?? [],
            subtype: unitData.subtype ?? 'BattleMek',
        }),
        getStructureKindAt: () => structureKind ?? 'standard',
        getArmorTypeAt: () => unitData.armorType ?? 'STANDARD',
        getCrewMember: () => ({
            getHits: () => crewHits,
            setHits: (hits: number) => { crewHits = hits; },
        }),
        applyInternalExplosionCrewHits: (hits: number, group?: string) => {
            crewHits += hits;
            if (group) pilotDamageGroups.push(group);
            return hits;
        },
        setLocationCondition: () => undefined,
        applyHitToCritSlot: (critical: CriticalSlot) => {
            critical.hits = (critical.hits ?? 0) + 1;
            critical.destroying = critical.hits >= (critical.armored ? 2 : 1) ? Date.now() : undefined;
        },
        getInternalPoints: (location: string) => internalPoints.get(location) ?? 0,
        getInternalHits: (location: string) => internalHits.get(location) ?? 0,
        addInternalHits: (location: string, damage: number) =>
            internalHits.set(location, (internalHits.get(location) ?? 0) + damage),
        getArmorPoints: (location: string, rear: boolean) => armorPoints.get(`${location}${rear ? '-rear' : ''}`) ?? 0,
        getArmorHits: (location: string, rear: boolean) => armorHits.get(`${location}${rear ? '-rear' : ''}`) ?? 0,
        addArmorHits: (location: string, damage: number, rear: boolean) => {
            const key = `${location}${rear ? '-rear' : ''}`;
            armorHits.set(key, (armorHits.get(key) ?? 0) + damage);
        },
    } as unknown as CBTForceUnit;

    return {
        unit,
        internalHits,
        armorHits,
        pilotHits: () => crewHits,
        pilotDamageGroups,
    };
}
