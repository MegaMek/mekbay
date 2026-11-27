// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import { EquipmentFlag } from '../../equipment-flags.type';
import { AmmoEquipment, MiscEquipment } from '../../equipment.model';
import { CORE_2026_GAME_RULES, TW_GAME_RULES } from '../../rules/game-rules';
import { createTestEquipmentRegistry } from '../testing/test-equipment-registry';
import {
    TestBipedMekEntity as BipedMekEntity,
    TestVtolEntity as VtolEntity,
} from '../testing/test-entities';
import { EntityMountedEquipment } from '../types';
import { calculateBattleValueDetails } from './battle-value/factory';

describe('getEquipmentBV', () => {
    let entity: BipedMekEntity;

    beforeEach(() => {
        entity = new BipedMekEntity();
        entity.setTonnage(75);
        entity.originalWalkMP.set(3);
    });

    const cases: Array<[string, EquipmentFlag[], number]> = [
        ['hatchet', ['F_CLUB', 'S_HATCHET'], 22.5],
        ['sword', ['F_CLUB', 'S_SWORD'], 15.525],
        ['lance', ['F_CLUB', 'S_LANCE'], 15],
        ['mace', ['F_CLUB', 'S_MACE'], 19],
        ['retractable blade', ['F_CLUB', 'S_RETRACTABLE_BLADE'], 13.8],
        ['claw', ['F_HAND_WEAPON', 'S_CLAW'], 14.025],
        ['talons', ['F_TALON'], 8],
    ];

    for (const [name, flags, expectedBV] of cases) {
        it(`resolves ${name}`, () => {
            expect(mount(name, 'RA', variableEquipment(name, flags)).getBV(entity)).toBe(expectedBV);
        });
    }

    it('uses installed TSM', () => {
        entity.setEquipment([mount('tsm', 'CT', fixedEquipment('tsm', ['F_TSM']))]);

        expect(mount('hatchet', 'RA', variableEquipment('hatchet', ['F_CLUB', 'S_HATCHET'])).getBV(entity)).toBe(45);
    });

    it('counts distinct torso locations containing spikes for ram plate damage', () => {
        const spikes = fixedEquipment('spikes', ['F_SPIKES']);
        entity.setEquipment([
            mount('left-spikes', 'LT', spikes),
            mount('left-spikes-duplicate', 'LT', spikes),
            mount('right-spikes', 'RT', spikes),
            mount('leg-spikes', 'LL', spikes),
        ]);

        expect(mount('ram-plate', 'CT', variableEquipment('ram plate', ['F_RAM_PLATE'])).getBV(entity)).toBe(22);
    });

    it('uses BV-effective boosted movement for ram plate damage', () => {
        const masc = fixedEquipment('masc', ['F_MASC']);
        entity.setTonnage(50);
        entity.originalWalkMP.set(5);
        entity.setEquipment([
            mount('masc', 'LT', masc),
            mount('supercharger', 'RT', masc),
        ]);

        expect(entity.runMP()).toBe(8);
        expect(entity.maxRunMP()).toBe(13);
        expect(mount('ram-plate', 'CT', variableEquipment('ram plate', ['F_RAM_PLATE'])).getBV(entity)).toBe(35.2);
    });

    for (const catalogBV of [30, 80]) {
        it('prices mounted and armored ammo by ruleset with catalog BV ' + catalogBV, () => {
            const standard = new AmmoEquipment({
                id: 'ISArrowIVAmmo', name: 'IS Arrow IV Ammo', type: 'ammo',
                stats: { bv: 30 }, ammo: { type: 'ARROW_IV', rackSize: 20, shots: 5 },
            });
            const thunder = new AmmoEquipment({
                id: 'ISArrowIVThunder', name: 'IS Arrow IV Thunder Ammo', type: 'ammo',
                stats: { bv: catalogBV, criticalSlots: 1 },
                ammo: { type: 'ARROW_IV', rackSize: 20, shots: 5,
                    baseAmmo: standard.id, munitionType: ['M_FASCAM'] },
            });
            const registry = createTestEquipmentRegistry({ [standard.id]: standard, [thunder.id]: thunder });
            const mek = new BipedMekEntity(registry);
            const bin = mount(thunder.id, 'LT', thunder).clone({ armored: true });
            mek.setEquipment([bin]);

            expect(bin.getBV(mek)).toBe(30);
            for (const [rules, expected] of [
                [CORE_2026_GAME_RULES, 30], [TW_GAME_RULES, 80], [CORE_2026_GAME_RULES, 30],
            ] as const) {
                expect(bin.getBV(mek, rules)).toBe(expected);
                const details = calculateBattleValueDetails(mek, undefined, rules.id).details;
                const armored = details.find(detail => detail.type === 'Defensive Battle Rating')
                    ?.details?.find(detail => detail.type === 'Armored Components');
                expect(armored?.delta).toBe(expected * 0.05);
            }
            expect(thunder.bv).toBe(catalogBV);
        });
    }

    it('passes through fixed BV', () => {
        expect(mount('fixed', 'CT', fixedEquipment('fixed', [], 25)).getBV(entity)).toBe(25);
    });

    it('adds the VTOL mast-mount bonus to eligible rotor equipment', () => {
        const vtol = new VtolEntity();
        const mastMount = mount('mast', 'Rotor', fixedEquipment('mast', ['F_MAST_MOUNT']));
        const ecm = mount('ecm', 'Rotor', fixedEquipment('ecm', ['F_ECM'], 20));
        vtol.setEquipment([mastMount, ecm]);

        expect(ecm.getBV(vtol)).toBe(30);
        expect(ecm.clone({ allocation: { kind: 'location', location: 'Body' } }).getBV(vtol)).toBe(20);
    });

    it('returns zero for variable BV handled by specialized calculators', () => {
        expect(mount('aes', 'RA', variableEquipment('AES', ['F_ACTUATOR_ENHANCEMENT_SYSTEM'])).getBV(entity)).toBe(0);
        expect(mount('armor', 'CT', variableEquipment('modular armor', ['F_MODULAR_ARMOR'])).getBV(entity)).toBe(0);
        expect(mount('mast', 'HD', variableEquipment('mast mount', ['F_MAST_MOUNT'])).getBV(entity)).toBe(0);
    });
});

function variableEquipment(name: string, flags: EquipmentFlag[]): MiscEquipment {
    return new MiscEquipment({ id: name, name, type: 'misc', flags, stats: { bv: 'variable' } });
}

function fixedEquipment(name: string, flags: EquipmentFlag[], bv = 0): MiscEquipment {
    return new MiscEquipment({ id: name, name, type: 'misc', flags, stats: { bv } });
}

function mount(mountId: string, location: string, equipment: AmmoEquipment | MiscEquipment): EntityMountedEquipment {
    return new EntityMountedEquipment({
        mountId,
        equipmentId: equipment.id,
        equipment,
        allocation: { kind: 'location', location },
        rearMounted: false,
        turretMounted: false,
        omniPodMounted: false,
        armored: false,
    });
}