// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import { TestBipedMekEntity } from '../../../models/entity/testing/test-entities';
import { addTestEquipment, addTestEquipmentWithFlags } from '../../../models/entity/testing/test-mounted-equipment';
import { AmmoEquipment, ArmorEquipment, MiscEquipment, WeaponEquipment } from '../../../models/equipment.model';
import { MountedArmor } from '../../../models/entity/components/armor';
import { RecordSheetSvgGenerator } from '../record-sheet-svg-generator';

describe('Mek printed equipment and movement alternatives', () => {
    for (const ruleset of ['core-2026', 'total-warfare'] as const) {
        it(`${ruleset}: places armor before names and single-slot autocannon squares after names`, async () => {
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
                    const textBox = text.getBBox();
                    const armor = slot.querySelector<SVGCircleElement>('.armoredLocPip');
                    const extra = slot.querySelector<SVGRectElement>('.extraHitPip');
                    expect(text.textContent).toBe('AC/2');
                    if (location === 'RA') {
                        expect(armor!.tagName).toBe('circle');
                        const box = armor!.getBBox();
                        expect(box.x).toBe(0);
                        expect(Number(text.getAttribute('x')) - (box.x + box.width)).toBeCloseTo(1.4, 2);
                    } else {
                        expect(armor).toBeNull();
                        expect(Number(text.getAttribute('x'))).toBe(0);
                    }
                    if (ruleset === 'core-2026') {
                        expect(extra!.tagName).toBe('rect');
                        expect(getComputedStyle(extra!).display).not.toBe('none');
                        const box = extra!.getBBox();
                        expect(box.width).toBeCloseTo(5.6, 2);
                        expect(box.height).toBeCloseTo(box.width, 2);
                        expect(box.x).toBeGreaterThan(textBox.x + textBox.width);
                        expect(box.x - (Number(text.getAttribute('x')) + text.getComputedTextLength())).toBeCloseTo(1.4, 1);
                        expect(box.y + box.height - Number(text.getAttribute('y'))).toBeCloseTo(0.2, 2);
                        if (armor) expect(box.y).toBeCloseTo(armor.getBBox().y, 2);
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
        expect(brackets[0].getAttribute('d')).toBe('M 263.34 171.262 h -1.88 v 83.428 h 1.88');
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

    it('sums one superheavy ammo per slot and gives mixed munitions their own lines, pushing later rows down', async () => {
        const entity = new TestBipedMekEntity();
        entity.setTonnage(150);
        const ammo = (name: string, shots: number): AmmoEquipment => new AmmoEquipment({
            id: name, name: `${name} Ammo`, type: 'ammo', ammo: { type: 'AC_LBX', shots },
        });
        const place = (equipment: AmmoEquipment | WeaponEquipment, location: string, slots: readonly number[]): void => {
            addTestEquipment(entity, equipment, { allocation: { kind: 'location', location,
                placements: slots.map(slotIndex => ({ location, slotIndex })) } });
        };
        place(ammo('Gauss', 8), 'RA', [6]);
        place(ammo('Gauss', 8), 'RA', [6]);
        place(ammo('LB 10-X AC', 10), 'RA', [7]);
        place(ammo('LB 10-X Cluster', 10), 'RA', [7]);
        place(new WeaponEquipment({
            id: 'Gauss Rifle', name: 'Gauss Rifle', type: 'weapon',
            weapon: { heat: 1, damage: 15, ranges: [7, 15, 22] },
        }), 'RA', [9, 10]);
        for (const slotIndex of [10, 11]) {
            place(ammo('LB 10-X AC', 10), 'CT', [slotIndex]);
            place(ammo('LB 10-X Cluster', 10), 'CT', [slotIndex]);
        }

        const svg = await RecordSheetSvgGenerator.generate(entity, { ruleset: 'total-warfare' });
        const column = (location: string) => {
            const group = svg.querySelector<SVGGElement>(`.critGroup[data-loc="${location}"]`)!;
            const rows = [...group.querySelectorAll<SVGGElement>(':scope > .critRow')];
            const baselines = rows.map(row => Number(row.querySelector(':scope > text')!.getAttribute('y')));
            const shift = (index: number): number =>
                Number(/translate\(0 ([-\d.]+)\)/u.exec(rows[index].getAttribute('transform') ?? '')?.[1] ?? 0);
            return { group, rows, baselines, step: baselines[1] - baselines[0], shift };
        };
        const label = (location: string, slot: number) =>
            svg.querySelector<SVGTextElement>(`.critSlot[data-loc="${location}"][slot="${slot}"] text`)!;

        const ra = column('RA');
        expect(label('RA', 6).textContent).toBe('Ammo (Gauss) 16');
        expect(label('RA', 6).querySelector('tspan')).toBeNull();
        const mixed = [...label('RA', 7).querySelectorAll('tspan')];
        expect(mixed.map(line => line.textContent)).toEqual(['Ammo (LB 10-X AC) 10', 'Ammo (LB 10-X Cluster) 10']);
        expect(Number(mixed[1].getAttribute('dy'))).toBeCloseTo(ra.step, 3);
        expect(ra.rows[7].querySelectorAll(':scope > text').length).toBe(1);
        expect(ra.rows.slice(0, 8).every(row => !row.hasAttribute('transform'))).toBeTrue();
        for (let index = 8; index < 12; index++) expect(ra.shift(index)).toBeCloseTo(ra.step, 3);
        expect(ra.group.querySelector('.critical-equipment-bracket')!.getAttribute('transform'))
            .toBe(`matrix(1 0 0 1 0 ${Number(ra.step.toFixed(3))})`);
        const rolls = [...svg.querySelectorAll('.critical-roll-range[data-mekbay-roll-loc="RA"]')];
        expect(rolls.map(roll => roll.textContent)).toEqual(['1-3', '4-6']);
        expect(rolls[0].hasAttribute('transform')).toBeFalse();
        expect(rolls[1].getAttribute('transform')).toBe(`translate(0 ${Number((ra.step / 2).toFixed(3))})`);
        expect(svg.querySelector('.critGroup[data-loc="LA"] .critRow[transform]')).toBeNull();

        // The center torso has almost no room above the engine-hit box, so its rows tighten instead.
        const ct = column('CT');
        const slack = Number(ct.group.getAttribute('data-mekbay-row-slack'));
        const lastLine = ct.baselines[11] + ct.shift(11) + Number(label('CT', 11).querySelectorAll('tspan')[1].getAttribute('dy'));
        expect(lastLine).toBeLessThanOrEqual(ct.baselines[11] + slack + 0.01);
        expect(ct.baselines[1] + ct.shift(1) - ct.baselines[0]).toBeLessThan(ct.step);
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
        const capacitor = addTestEquipmentWithFlags(entity, 'F_PPC_CAPACITOR', { location: 'Left Arm' });
        entity.linkEquipment(capacitor, weapon);
        const svg = await RecordSheetSvgGenerator.generate(entity, { ruleset: 'total-warfare' });
        const mode = svg.querySelector('[data-mekbay-mode="w/Capacitor"]')!;
        const row = mode.parentElement!;
        expect(mode.classList.contains('equipmentProfile')).toBeTrue();
        expect(row.querySelector('.alternativeMode')).toBeNull();
        expect(row.querySelector(':scope > .damage')?.textContent).toContain('10');
        expect(row.querySelector(':scope > .range_long')?.textContent).toBe('23');
        expect(mode.querySelector('.heat')?.textContent).toBe('20');
        expect(mode.querySelector('.damage')?.textContent).toContain('15');
        expect(mode.querySelector('.damage')?.textContent).toContain('X');
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
