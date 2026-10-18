// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import { TestBipedMekEntity, TestTripodMekEntity } from '../../../models/entity/testing/test-entities';
import { addTestEquipment, addTestEquipmentWithFlags } from '../../../models/entity/testing/test-mounted-equipment';
import { AmmoEquipment, ArmorEquipment, MiscEquipment, WeaponEquipment } from '../../../models/equipment.model';
import { MountedArmor } from '../../../models/entity/components/armor';
import { RecordSheetSvgGenerator } from '../record-sheet-svg-generator';

describe('Mek printed equipment and movement alternatives', () => {
    for (const Entity of [TestBipedMekEntity, TestTripodMekEntity]) {
        it(`prints shield-limited walking and running MP by ruleset for ${Entity.name}`, async () => {
            const entity = new Entity();
            entity.setTonnage(55);
            entity.originalWalkMP.set(2);
            addTestEquipmentWithFlags(entity, ['F_SHIELD', 'S_SHIELD_MEDIUM'], { location: 'RA' });
            addTestEquipmentWithFlags(entity, ['F_SHIELD', 'S_SHIELD_MEDIUM'], { location: 'LA' });

            for (const ruleset of ['core-2026', 'total-warfare'] as const) {
                const svg = await RecordSheetSvgGenerator.generate(entity, { ruleset });
                expect(svg.querySelector('#mpWalk')?.textContent).withContext(ruleset)
                    .toBe(ruleset === 'core-2026' ? '1' : '0');
                expect(svg.querySelector('#mpRun')?.textContent).withContext(ruleset)
                    .toBe(ruleset === 'core-2026' ? '2' : '0');
            }
        });
    }

    for (const ruleset of ['core-2026', 'total-warfare'] as const) {
        it(`${ruleset}: marks armored slots and single-slot autocannon extra-hit boxes`, async () => {
            const entity = new TestBipedMekEntity();
            entity.setTonnage(50);
            for (const [location, armored] of [['LA', false], ['RA', true]] as const) {
                addTestEquipment(entity, new WeaponEquipment({
                    id: 'AC2', name: 'AC/2', type: 'weapon', flags: ['F_AC'],
                    weapon: { heat: 1, damage: 2, ranges: [8, 16, 24] },
                }), { armored, allocation: { kind: 'location', location,
                    placements: [{ location, slotIndex: 8 }] } });
                addTestEquipment(entity, new WeaponEquipment({
                    id: 'AC5', name: 'AC/5', type: 'weapon', flags: ['F_AC'],
                    weapon: { heat: 1, damage: 5, ranges: [6, 12, 18] },
                }), { armored, allocation: { kind: 'location', location,
                    placements: [4, 5, 6, 7].map(slotIndex => ({ location, slotIndex })) } });
            }
            const svg = await RecordSheetSvgGenerator.generate(entity, { ruleset });
            document.body.append(svg);
            try {
                expect(svg.querySelectorAll('.extraHitPip').length).toBe(ruleset === 'core-2026' ? 2 : 0);
                expect(svg.querySelectorAll('.armoredLocPip').length).toBe(5);
                for (const location of ['LA', 'RA']) {
                    const slot = svg.querySelector(`.critSlot[data-loc="${location}"][slot="8"]`)!;
                    const text = slot.querySelector<SVGTextElement>('text')!;
                    const armor = slot.querySelector<SVGCircleElement>('.armoredLocPip');
                    const extra = slot.querySelector<SVGRectElement>('.extraHitPip');
                    expect(text.textContent).toBe('AC/2');
                    if (location === 'RA') {
                        expect(armor!.tagName).toBe('circle');
                    } else {
                        expect(armor).toBeNull();
                    }
                    if (ruleset === 'core-2026') {
                        expect(extra!.tagName).toBe('rect');
                        expect(getComputedStyle(extra!).display).not.toBe('none');
                    }
                }
                expect(svg.querySelectorAll('.critical-equipment-bracket').length).toBe(2);
                expect(svg.querySelector('.critSlot[data-loc="RA"][slot="4"] .extraHitPip')).toBeNull();
            } finally {
                svg.remove();
            }
        });
    }

    it('brackets an AC/20 across both six-slot blocks without bracketing systems or non-hittable equipment', async () => {
        const entity = new TestBipedMekEntity();
        entity.setTonnage(50);
        addTestEquipment(entity, new WeaponEquipment({
            id: 'AC20', name: 'AC/20', type: 'weapon',
            weapon: { heat: 7, damage: 20, ranges: [3, 6, 9] },
        }), { allocation: { kind: 'location', location: 'RT',
            placements: Array.from({ length: 10 }, (_, slotIndex) => ({ location: 'RT', slotIndex })) } });
        addTestEquipment(entity, new MiscEquipment({
            id: 'Non-hittable equipment', name: 'Non-hittable equipment', type: 'misc', stats: { hittable: false },
        }), { allocation: { kind: 'location', location: 'LT',
            placements: [0, 1].map(slotIndex => ({ location: 'LT', slotIndex })) } });

        const svg = await RecordSheetSvgGenerator.generate(entity, { ruleset: 'total-warfare' });
        const brackets = [...svg.querySelectorAll<SVGPathElement>('.critical-equipment-bracket')];
        expect(brackets.length).toBe(1);
        expect(brackets[0].parentElement?.getAttribute('data-loc')).toBe('RT');
        expect(brackets[0].getAttribute('pointer-events')).toBe('none');
        expect(brackets[0].getAttribute('fill')).toBe('none');
        document.body.appendChild(svg);
        try {
            for (const state of ['detached', 'flooded']) {
                brackets[0].parentElement!.classList.add(state);
                expect(getComputedStyle(brackets[0]).fill).withContext(state).toBe('none');
                brackets[0].parentElement!.classList.remove(state);
            }
        } finally {
            svg.remove();
        }
    });

    it('keeps adjacent copies of an LRM 15 in separate brackets', async () => {
        const entity = new TestBipedMekEntity();
        entity.setTonnage(65);
        const weapon = new WeaponEquipment({
            id: 'LRM15', name: 'LRM 15', type: 'weapon',
            weapon: { heat: 5, damage: 1, ranges: [7, 14, 21] },
        });
        for (const start of [0, 3]) {
            addTestEquipment(entity, weapon, { allocation: { kind: 'location', location: 'LT',
                placements: [start, start + 1, start + 2].map(slotIndex => ({ location: 'LT', slotIndex })) } });
        }
        const svg = await RecordSheetSvgGenerator.generate(entity, { ruleset: 'total-warfare' });
        expect(svg.querySelectorAll('.critical-equipment-bracket').length).toBe(2);
        expect(svg.querySelectorAll('.critGroup[data-loc="LT"] .critical-equipment-bracket').length).toBe(2);
    });

    it('splits brackets at empty slots and location boundaries', async () => {
        const entity = new TestBipedMekEntity();
        entity.setTonnage(75);
        addTestEquipment(entity, new WeaponEquipment({
            id: 'Split Weapon', name: 'Split Weapon', type: 'weapon',
            weapon: { heat: 5, damage: 10, ranges: [3, 6, 9] },
        }), { allocation: { kind: 'location', location: 'LT', placements: [
            ...[0, 1, 3, 4, 6].map(slotIndex => ({ location: 'LT', slotIndex })),
            ...[4, 5].map(slotIndex => ({ location: 'LA', slotIndex })),
        ] } });
        const svg = await RecordSheetSvgGenerator.generate(entity, { ruleset: 'total-warfare' });
        expect(svg.querySelectorAll('.critical-equipment-bracket').length).toBe(3);
        expect(svg.querySelectorAll('.critGroup[data-loc="LT"] .critical-equipment-bracket').length).toBe(2);
        expect(svg.querySelectorAll('.critGroup[data-loc="LA"] .critical-equipment-bracket').length).toBe(1);
    });

    it('sums one superheavy ammo per slot and gives mixed munitions their own lines', async () => {
        const entity = new TestBipedMekEntity();
        entity.setTonnage(150);
        const ammo = (name: string, shots: number): AmmoEquipment => new AmmoEquipment({
            id: name, name: `${name} Ammo`, type: 'ammo', ammo: { type: 'AC_LBX', shots },
        });
        const place = (equipment: AmmoEquipment, location: string, slots: readonly number[]): void => {
            addTestEquipment(entity, equipment, { allocation: { kind: 'location', location,
                placements: slots.map(slotIndex => ({ location, slotIndex })) } });
        };
        place(ammo('Gauss', 8), 'RA', [6]);
        place(ammo('Gauss', 8), 'RA', [6]);
        place(ammo('LB 10-X AC', 10), 'RA', [7]);
        place(ammo('LB 10-X Cluster', 10), 'RA', [7]);

        const svg = await RecordSheetSvgGenerator.generate(entity, { ruleset: 'total-warfare' });
        const label = (location: string, slot: number) =>
            svg.querySelector<SVGTextElement>(`.critSlot[data-loc="${location}"][slot="${slot}"] text`)!;

        expect(label('RA', 6).textContent).toBe('Ammo (Gauss) 16');
        expect(label('RA', 6).querySelector('tspan')).toBeNull();
        const mixed = [...label('RA', 7).querySelectorAll('tspan')];
        expect(mixed.map(line => line.textContent)).toEqual(['Ammo (LB 10-X AC) 10', 'Ammo (LB 10-X Cluster) 10']);
        const raRows = svg.querySelectorAll('.critGroup[data-loc="RA"] > .critRow');
        expect(raRows[7].querySelectorAll(':scope > text').length).toBe(1);
        const rolls = [...svg.querySelectorAll('.critical-roll-range[data-mekbay-roll-loc="RA"]')];
        expect(rolls.map(roll => roll.textContent)).toEqual(['1-3', '4-6']);
    });

    it('identifies primitive construction and the BAR of commercial armor', async () => {
        const entity = new TestBipedMekEntity();
        entity.setTonnage(60);
        entity.cockpitType.set('Primitive');
        entity.setUniformArmor(new MountedArmor({ armor: new ArmorEquipment({
            id: 'Commercial', name: 'Commercial', type: 'armor', armor: { type: 'COMMERCIAL', bar: 5 },
        }) }));
        const svg = await RecordSheetSvgGenerator.generate(entity, { ruleset: 'total-warfare' });
        expect(svg.textContent).toContain('PRIMITIVE BATTLEMECH RECORD SHEET');
        expect(svg.querySelector('#armorType')?.textContent).toBe('Commercial, BAR: 5');
    });

    it('identifies special patchwork material at the affected location', async () => {
        const entity = new TestBipedMekEntity();
        entity.setTonnage(80);
        entity.setArmorAt('LA', new MountedArmor({ armor: new ArmorEquipment({
            id: 'Reactive', name: 'Reactive', type: 'armor', armor: { type: 'REACTIVE' },
        }) }));
        const svg = await RecordSheetSvgGenerator.generate(entity, { ruleset: 'total-warfare' });
        expect(svg.querySelector('#armorType')?.textContent).toBe('Patchwork');
        expect(svg.querySelector('.diagram-material-name[data-loc="LA"]')?.textContent).toBe('Reactive');
        expect(svg.querySelector('.diagram-material-name[data-loc="RA"]')).toBeNull();
    });

    it('prints a linked capacitor profile while retaining the uncharged PPC row and its ranges', async () => {
        const entity = new TestBipedMekEntity();
        entity.setTonnage(70);
        const weapon = addTestEquipment(entity, new WeaponEquipment({
            id: 'ERPPC', name: 'ER PPC', type: 'weapon', flags: ['F_PPC', 'F_PPC_CAPACITOR_COMPATIBLE'],
            weapon: { heat: 15, damage: 10, ranges: [7, 14, 23] },
        }), { location: 'Left Arm' });
        const capacitor = addTestEquipment(entity, new MiscEquipment({
            id: 'PPC Capacitor', name: 'PPC Capacitor', type: 'misc', flags: ['F_WEAPON_ENHANCEMENT', 'F_PPC_CAPACITOR'],
        }), { location: 'Left Arm' });
        entity.linkEquipment(capacitor, weapon);
        const svg = await RecordSheetSvgGenerator.generate(entity, { ruleset: 'total-warfare' });
        const linked = svg.querySelector(`.inventoryEntry.linked[data-mekbay-component-ids="${capacitor.mountId}"]`)!;
        const row = linked.parentElement!;
        expect(linked.querySelector('.name')?.textContent).toBe('PPC Capacitor');
        expect(row.querySelector('.alternativeMode')).toBeNull();
        expect(row.querySelector(':scope > .damage')?.textContent).toContain('10');
        expect(row.querySelector(':scope > .range_long')?.textContent).toBe('23');
        expect(linked.querySelector('.heat')?.textContent).toBe('20');
        expect(linked.querySelector('.damage')?.textContent).toContain('15');
        expect(linked.querySelector('.damage')?.textContent).toContain('X');
    });

    it('names each linked weapon enhancement under its weapon and prints insulated heat', async () => {
        const entity = new TestBipedMekEntity();
        entity.setTonnage(70);
        const lrm = addTestEquipment(entity, new WeaponEquipment({
            id: 'ISLRM15', name: 'LRM 15', type: 'weapon', flags: ['F_ARTEMIS_COMPATIBLE'],
            weapon: { heat: 5, damage: 1, ranges: [7, 14, 21], minRange: 6, ammoType: 'LRM' },
        }), { location: 'Left Torso' });
        const laser = addTestEquipment(entity, new WeaponEquipment({
            id: 'ISLargeLaser', name: 'Large Laser', type: 'weapon', flags: ['F_LASER', 'F_DIRECT_FIRE', 'F_ENERGY'],
            weapon: { heat: 8, damage: 8, ranges: [5, 10, 15] },
        }), { location: 'Right Arm' });
        addTestEquipment(entity, new WeaponEquipment({
            id: 'ISMediumLaser', name: 'Medium Laser', type: 'weapon', flags: ['F_LASER', 'F_DIRECT_FIRE', 'F_ENERGY'],
            weapon: { heat: 3, damage: 5, ranges: [3, 6, 9] },
        }), { location: 'Left Arm' });
        entity.linkEquipment(addTestEquipment(entity, new MiscEquipment({
            id: 'ISArtemisIV', name: 'Artemis IV FCS', type: 'misc', flags: ['F_WEAPON_ENHANCEMENT', 'F_ARTEMIS'],
        }), { location: 'Left Torso' }), lrm);
        entity.linkEquipment(addTestEquipment(entity, new MiscEquipment({
            id: 'ISLaserInsulator', name: 'Laser Insulator', type: 'misc', flags: ['F_WEAPON_ENHANCEMENT', 'F_LASER_INSULATOR'],
        }), { location: 'Right Arm' }), laser);
        const svg = await RecordSheetSvgGenerator.generate(entity, { ruleset: 'total-warfare' });
        const rows = new Map([...svg.querySelectorAll('.inventoryEntry')].map(row =>
            [row.querySelector(':scope > .name')?.textContent, row] as const));
        const linked = (name: string) => rows.get(name)?.querySelector(':scope > .inventoryEntry.linked');
        expect(linked('LRM 15')?.querySelector('.name')?.textContent).toBe('Artemis IV FCS');
        expect(linked('LRM 15')?.querySelector('.heat')?.textContent).toBe('—');
        expect(linked('Large Laser')?.querySelector('.name')?.textContent).toBe('Laser Insulator');
        expect(rows.get('Large Laser')?.querySelector(':scope > .heat')?.textContent).toBe('7');
        expect(linked('Medium Laser')).toBeNull();
    });

    it('prints TSM movement and physical damage alternatives from existing entity projections', async () => {
        const entity = new TestBipedMekEntity();
        entity.setTonnage(70);
        entity.originalWalkMP.set(5);
        addTestEquipmentWithFlags(entity, 'F_TSM');
        const svg = await RecordSheetSvgGenerator.generate(entity, { ruleset: 'total-warfare' });
        expect(svg.querySelector('#mpWalk')?.textContent).toBe('5 [6]');
        expect(svg.querySelector('#mpRun')?.textContent).toBe('8 [9]');
        const kick = [...svg.querySelectorAll('.inventoryEntry')].find(row => row.querySelector('.name')?.textContent === 'Kick');
        expect(kick?.querySelector('.damage')?.textContent).toBe('14 [28]');
    });
});
