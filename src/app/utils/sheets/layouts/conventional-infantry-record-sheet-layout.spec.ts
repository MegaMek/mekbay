// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import { TestInfantryEntity } from '../../../models/entity/testing/test-entities';
import { addTestEquipment } from '../../../models/entity/testing/test-mounted-equipment';
import { AmmoEquipment, MiscEquipment, WeaponEquipment, type InfantryWeaponEquipment } from '../../../models/equipment.model';
import { RecordSheetSvgGenerator } from '../record-sheet-svg-generator';

describe('conventional infantry sheet presentation', () => {
    it('uses the armor kit divisor and prints capped-primary burst notes and capable anti-Mek skill', async () => {
        const entity = infantry();
        entity.primaryWeapon.set(new WeaponEquipment({ id: 'Mauser', name: 'Mauser', type: 'weapon',
            infantry: { damage: 0.8, range: 3 } }) as InfantryWeaponEquipment);
        addTestEquipment(entity, new MiscEquipment({ id: 'Clan Armor Kit', name: 'Clan Armor Kit', type: 'misc',
            flags: ['F_ARMOR_KIT'], misc: { damageDivisor: 2 } }), { location: 'Infantry' });
        const svg = await RecordSheetSvgGenerator.generate(entity, { format: 'letter' });
        const text = svg.textContent!;
        expect(text).toContain('Damage Divisor:2.0');
        expect([...svg.querySelectorAll('text')].map(node => node.textContent).join(' '))
            .toContain('+1D6 damage vs. conventional infantry.');
        expect(svg.querySelector('#pilotingSkill0')?.textContent).toBe('8');
        expect(svg.querySelector('.infantry-masthead-icon')?.getAttribute('href')).toBe('#mekbay-infantry-masthead-art');
        expect(svg.querySelector('#mekbay-infantry-masthead-art image')).not.toBeNull();
    });

    it('renders default-crew BV while leaving the neutral entity BV unchanged', async () => {
        const entity = infantry();
        const neutralBV = entity.battleValue();
        const svg = await RecordSheetSvgGenerator.generate(entity, { format: 'compact' });
        expect(svg.querySelector('#pilotingSkill0')?.textContent).toBe('8');
        expect(svg.querySelector('#bv')?.textContent).toBe(String(Math.round(neutralBV * 0.85)));
        expect(entity.battleValue()).toBe(neutralBV);
    });

    it('uses the primary weapon for combat notes when multiple secondary weapons are TAG', async () => {
        const entity = infantry();
        entity.primaryWeapon.set(new WeaponEquipment({ id: 'Needler', name: 'Needler', type: 'weapon',
            flags: ['F_INF_BURST', 'F_INF_NONPENETRATING'],
            infantry: { damage: 0.1, range: 1 } }) as InfantryWeaponEquipment);
        const tag = new WeaponEquipment({ id: 'Infantry TAG', name: 'Infantry TAG', type: 'weapon',
            flags: ['F_TAG'], infantry: { damage: 0, range: 3 } }) as InfantryWeaponEquipment;
        entity.secondaryWeapon.set(tag);
        entity.secondaryCount.set(2);
        const svg = await RecordSheetSvgGenerator.generate(entity, { format: 'compact' });
        const text = [...svg.querySelectorAll('text')].map(node => node.textContent).join(' ');
        expect(text).toContain('+1D6 damage vs. conventional infantry.');
        expect(text).toContain('Can only damage conventional infantry units.');
        expect(entity.rangeWeapon()).toBe(tag);
    });

    it('positions jump movement before ground movement while retaining live movement IDs', async () => {
        const entity = infantry();
        entity.motiveType.set('Jump');
        const svg = await RecordSheetSvgGenerator.generate(entity, { format: 'compact' });
        const jump = svg.querySelector('#mpJump')!;
        const walk = svg.querySelector('#mpWalk')!;
        expect(Number(jump.getAttribute('y'))).toBeLessThan(Number(walk.getAttribute('y')));
        expect(jump.nextElementSibling?.nextElementSibling?.textContent).toBe('Jump');
        expect(walk.nextElementSibling?.nextElementSibling?.textContent).toBe('Ground');
    });

    it('prints augmentation display names and reduces dense notes without compressing their last line', async () => {
        const entity = infantry();
        entity.spaceSuit.set(true);
        entity.specializations.set(new Set(['mountain-troops', 'marines']));
        entity.augmentations.set(['dermal_armor', 'tsm_implant', 'artificial_pain_shunt', 'pl_flight']);
        const svg = await RecordSheetSvgGenerator.generate(entity, { format: 'compact' });
        const lines = [...svg.querySelectorAll<SVGTextElement>('.infantry-notes text')];
        const notes = lines.map(line => line.textContent).join(' ');
        expect(notes).toContain('Can operate in vacuum.');
        expect(notes).toContain('Unit is immune to the effects of Thin Atmosphere.');
        expect(notes).toContain('Cybernetically enhanced: Myomer Implants (Dermal Armor), '
            + 'Myomer Implants (Triple Strength), Artificial Pain Shunt, Prosthetic Wings, Powered Flight');
        expect(Number(lines[0].getAttribute('font-size'))).toBeLessThan(7.2);
        expect(Number(lines[0].getAttribute('font-size'))).toBeGreaterThanOrEqual(5);
        expect(lines.every(line => !line.hasAttribute('textLength'))).toBeTrue();
    });

    it('prints field-gun quantity, ranges, real ammunition and crew below the infantry range table', async () => {
        const entity = infantry();
        entity.motiveType.set('Tracked');
        entity.encumberingArmor.set(true);
        entity.armorDivisor.set(2);
        addTestEquipment(entity, new WeaponEquipment({ id: 'Arrow IV', name: 'Arrow IV', type: 'weapon',
            flags: ['F_ARTILLERY'], stats: { tonnage: 15 },
            weapon: { rackSize: 20, ammoType: 'ARROW_IV', ranges: [1, 2, 8] } }), { location: 'Field Guns' });
        addTestEquipment(entity, new AmmoEquipment({ id: 'Arrow IV Ammo', name: 'Arrow IV Ammo', type: 'ammo',
            ammo: { type: 'ARROW_IV', shots: 5 } }), { location: 'Field Guns' });
        const svg = await RecordSheetSvgGenerator.generate(entity, { format: 'compact' });
        const values = ['qty', 'type', 'dmg', 'min_range', 'short', 'med', 'long', 'ammo', 'crew']
            .map(id => svg.querySelector(`#field_gun_${id}`)?.textContent);
        expect(values).toEqual(['1', 'Arrow IV', '20 [AE,S,F]', '—', '1', '2', '8', '5', '15']);
        expect(svg.textContent).toContain('Mechanized Tracked');
        expect(svg.textContent).toContain('Damage Divisor:2.0E');
        expect(svg.querySelector('#pilotingSkill0')?.textContent).toBe('—');
    });
});

function infantry(): TestInfantryEntity {
    const entity = new TestInfantryEntity();
    entity.squadSize.set(5);
    entity.squadCount.set(1);
    entity.originalWalkMP.set(1);
    return entity;
}
