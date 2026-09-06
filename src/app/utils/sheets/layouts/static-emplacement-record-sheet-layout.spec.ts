// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import { EquipmentRegistry } from '../../../models/equipment-lookup';
import { AmmoEquipment, ArmorEquipment, WeaponEquipment } from '../../../models/equipment.model';
import { StaticEmplacementEntity } from '../../../models/entity/entities/misc/static-emplacement-entity';
import { parseEntity } from '../../../models/entity/parse-entity';
import { addTestEquipment } from '../../../models/entity/testing/test-mounted-equipment';
import { RecordSheetSvgGenerator } from '../record-sheet-svg-generator';
import { resolveRecordSheetLayout } from './record-sheet-layout-resolver';
import { StaticEmplacementRecordSheetLayout } from './static-emplacement-record-sheet-layout';

describe('StaticEmplacementRecordSheetLayout', () => {
    const armor = new ArmorEquipment({ id: 'Standard Armor', name: 'Standard', type: 'armor',
        armor: { type: 'STANDARD' }, tech: { base: 'All' } });
    const laser = new WeaponEquipment({ id: 'Large Laser', name: 'Large Laser', type: 'weapon',
        weapon: { damage: 8, heat: 8, ranges: [5, 10, 15] } });
    const registry = new EquipmentRegistry({ [armor.id]: armor, [laser.id]: laser });

    function parseStatic(kind: 'BuildingEntity' | 'GunEmplacement', construction = ''): StaticEmplacementEntity {
        return parseEntity(`
<UnitType>
${kind}
</UnitType>
<Name>
${kind === 'BuildingEntity' ? 'Assault Air Defense Missile Emplacement' : 'Calliope Turret'}
</Name>
<Model>
(3075)
</Model>
<year>
3075
</year>
<type>
IS Level 3
</type>
${construction}
<${kind === 'BuildingEntity' ? 'Level 0 0.0,0.0,0.0' : 'GUNS'} Equipment>
Large Laser
Unresolved Searchlight
</${kind === 'BuildingEntity' ? 'Level 0 0.0,0.0,0.0' : 'GUNS'} Equipment>
`, 'static.blk', registry).entity as StaticEmplacementEntity;
    }

    it('routes both parsed static families to one full-page owner', () => {
        for (const kind of ['BuildingEntity', 'GunEmplacement'] as const) {
            const entity = parseStatic(kind);
            const layout = resolveRecordSheetLayout(entity);
            expect(layout instanceof StaticEmplacementRecordSheetLayout).toBeTrue();
            expect(layout.id).toBe('static-emplacement');
            expect(layout.profile(entity).compact).toBeFalse();
        }
    });

    it('renders parsed building construction and real armor/CF with dynamic location contracts', async () => {
        const entity = parseStatic('BuildingEntity', `
<armor>
150
</armor>
<cf>
150
</cf>
<building_class>
3
</building_class>
<building_type>
4
</building_type>
<height>
1
</height>
<coords>
0.0,0.0,0.0
</coords>`);
        const svg = await RecordSheetSvgGenerator.generate(entity);

        expect(svg.dataset['mekbayLayout']).toBe('static-emplacement');
        expect(svg.dataset['mekbayDesignSource']).toBe('native');
        expect(svg.textContent).toContain('Hardened');
        expect(svg.textContent).toContain('Gun Emplacement');
        expect(svg.textContent).toContain('1 level');
        expect(svg.textContent).toContain('0.0,0.0,0.0');
        expect(svg.querySelectorAll('.pip.armor[data-loc="Level 0 0.0,0.0,0.0"]').length).toBe(150);
        expect(svg.querySelectorAll('.pip.structure[data-loc="Level 0 0.0,0.0,0.0"]').length).toBe(150);
        expect(svg.querySelector('.unitLocation.structure')?.getAttribute('data-loc')).toBe('Level 0 0.0,0.0,0.0');
        expect(svg.querySelector('[data-mekbay-paperdoll-view], .vehicle-paperdoll, .mek-paperdolls, image, #crewName0')).toBeNull();
    });

    it('preserves turret inventory, weapon ranges and crew without inventing missing protection', async () => {
        const entity = parseStatic('GunEmplacement', '<turret>\n1\n</turret>');
        const svg = await RecordSheetSvgGenerator.generate(entity);

        expect(svg.textContent).toContain('Armor and construction factor are not specified.');
        expect(svg.querySelectorAll('.pip.armor, .pip.structure, .unitLocation').length).toBe(0);
        const rows = [...svg.querySelectorAll('.inventoryEntry')];
        expect(rows.length).toBe(2);
        expect(rows[0].getAttribute('data-mekbay-component-ids')).toBe(entity.equipment()[0].mountId);
        expect(rows[0].querySelector('.range_long')?.textContent).toBe('15');
        expect(rows[0].querySelector('.lngButton')).not.toBeNull();
        expect(rows[1].textContent).toContain('Unresolved Searchlight');
        expect(svg.querySelector('#crewName0')).not.toBeNull();
        expect(svg.querySelector('#gunnerySkill0')).not.toBeNull();
        expect(svg.querySelector('#pilotingSkill0, .vehicle-paperdoll')).toBeNull();
    });

    it('retains every mount and ammunition capacity in a large emplacement inventory', async () => {
        const entity = parseStatic('GunEmplacement');
        const ammo = new AmmoEquipment({ id: 'LRM 5 Ammo', name: 'LRM 5 Ammo', type: 'ammo',
            ammo: { type: 'LRM', shots: 24, rackSize: 5 } });
        for (let index = 0; index < 34; index++) {
            addTestEquipment(entity, ammo, { location: 'Guns', shotsCount: 24 });
        }
        const svg = await RecordSheetSvgGenerator.generate(entity);
        const rows = [...svg.querySelectorAll<SVGElement>('.inventoryEntry')];

        expect(rows.length).toBe(36);
        expect(rows.every(row => row.getAttribute('display') !== 'none')).toBeTrue();
        expect(rows.flatMap(row => row.getAttribute('data-mekbay-component-ids')?.split(' ') ?? []))
            .toEqual(entity.equipment().map(mount => mount.mountId));
        expect(svg.querySelector('#ammoProfile')?.textContent).toContain('816');
        const ids = [...svg.querySelectorAll('[id]')].map(element => element.id);
        expect(new Set(ids).size).toBe(ids.length);
    });

    it('distinguishes an explicit zero construction value from an unspecified value', async () => {
        const entity = parseStatic('BuildingEntity', '<armor>\n0\n</armor>\n<cf>\n0\n</cf>');
        const svg = await RecordSheetSvgGenerator.generate(entity);

        expect(svg.getElementById('textArmor_Level 0 0.0,0.0,0.0')?.textContent).toBe('0');
        expect(svg.getElementById('textIS_Level 0 0.0,0.0,0.0')?.textContent).toBe('0');
        expect(svg.textContent).not.toContain('not specified');
        expect(svg.querySelectorAll('.pip.armor, .pip.structure, .unitLocation').length).toBe(0);
    });

    it('uses actual Letter and A4 page dimensions for the same native design', async () => {
        const entity = parseStatic('BuildingEntity');
        const letter = await RecordSheetSvgGenerator.generate(entity, { format: 'letter' });
        const a4 = await RecordSheetSvgGenerator.generate(entity, { format: 'a4' });

        expect(letter.getAttribute('viewBox')).toBe('0 0 612 792');
        expect(a4.getAttribute('viewBox')).toBe('0 0 595.276 841.89');
        expect(letter.querySelectorAll('.inventoryEntry').length).toBe(a4.querySelectorAll('.inventoryEntry').length);
        expect(a4.querySelector('[data-mekbay-compact]')).toBeNull();
    });
});
