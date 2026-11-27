// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
import { AmmoEquipment, MiscEquipment, WeaponEquipment } from '../../models/equipment.model';
import { createTestEquipmentRegistry } from '../../models/entity/testing/test-equipment-registry';
import { addTestEquipment } from '../../models/entity/testing/test-mounted-equipment';
import { parseEntity } from '../../models/entity/parse-entity';
import { encodeNativeEntity, nativeEntityFormat } from '../../models/entity/write-entity';
import { createConstructionEntity } from './construction-factory';
import { reconcileConstructionEquipmentRelationships } from './construction-relationships';
import { reorderConstructionEquipment } from './construction-rules';

const laser = new WeaponEquipment({ id: 'Test Laser', name: 'Test Laser', type: 'weapon', flags: ['F_LASER', 'F_RISC_LASER_PULSE_COMPATIBLE'],
    stats: { criticalSlots: 1 }, weapon: { ammoType: 'NA' } });
const insulator = new MiscEquipment({ id: 'Test Insulator', name: 'Test Insulator', type: 'misc', flags: ['F_LASER_INSULATOR'],
    stats: { criticalSlots: 1 } });
const registry = createTestEquipmentRegistry({ [laser.id]: laser, [insulator.id]: insulator });

describe('construction native equipment relationships', () => {
    it('clears an old DWP ammo link after the weapon loses its attachment flag', () => {
        const entity = createConstructionEntity('BattleArmor', createTestEquipmentRegistry());
        const gun = new WeaponEquipment({ id: 'Test MG', name: 'Test MG', type: 'weapon', weapon: { ammoType: 'MG', rackSize: 2 } });
        const ammunition = new AmmoEquipment({ id: 'Test MG Ammo', name: 'Test MG Ammo', type: 'ammo', ammo: { type: 'MG', rackSize: 2 } });
        const source = addTestEquipment(entity, gun, { location: 'Squad', isDWP: true });
        const target = addTestEquipment(entity, ammunition, { location: 'Squad', isDWP: true });
        entity.linkEquipment(source, target);
        source.isDWP = false;
        reconcileConstructionEquipmentRelationships(entity);
        expect(entity.getLinkedMount(source)).toBeUndefined();
        expect(entity.getLinkingMounts(target)).toEqual([]);
    });

    it('relinks a BLK enhancement after installation/removal without changing mount identities', () => {
        const entity = createConstructionEntity('Tank', registry);
        const first = addTestEquipment(entity, laser, { location: 'Front' });
        const second = addTestEquipment(entity, laser, { location: 'Front' });
        const enhancement = addTestEquipment(entity, insulator, { location: 'Front' });
        const inventory = entity.equipment();
        entity.linkEquipment(enhancement, first);

        reconcileConstructionEquipmentRelationships(entity);
        expect(entity.getLinkedMount(enhancement)).toBe(second);
        expect(entity.equipment()).toEqual(inventory);
        expect(entity.equipment()[0]).toBe(first);

        entity.removeEquipment(second);
        reconcileConstructionEquipmentRelationships(entity);
        expect(entity.getLinkedMount(enhancement)).toBe(first);
    });

    it('uses physical Mek slot order when it differs from installation order', () => {
        const entity = createConstructionEntity('Biped', registry);
        const installAt = (equipment: WeaponEquipment | MiscEquipment, slotIndex: number) => addTestEquipment(entity, equipment,
            { allocation: { kind: 'location', location: 'RT', placements: [{ location: 'RT', slotIndex }] } });
        const first = installAt(laser, 0);
        const second = installAt(laser, 2);
        const enhancement = installAt(insulator, 1);
        // Loading reads a Mek location's rows too: the insulator takes the laser in the row above it.
        entity.reconcileEquipmentRelationships();
        expect(entity.getLinkedMount(enhancement)).toBe(first);

        reconcileConstructionEquipmentRelationships(entity);
        expect(entity.getLinkedMount(enhancement)).toBe(first);
        expect(entity.equipment()).toEqual([first, second, enhancement]);
        expect(first.placements).toEqual([{ location: 'RT', slotIndex: 0 }]);
    });

    for (const chassis of ['Biped', 'Tank'] as const) {
        for (const moduleFirst of [false, true]) {
            it(`round-trips a laser with three attachments in ${chassis} native order, module first ${moduleFirst}`, () => {
                const pulse = new MiscEquipment({ id: 'Test module', name: 'Test module', type: 'misc',
                    flags: ['F_WEAPON_ENHANCEMENT', 'F_RISC_LASER_PULSE_MODULE'], stats: { criticalSlots: 1 } });
                const equipment = createTestEquipmentRegistry({ [laser.id]: laser, [insulator.id]: insulator, [pulse.id]: pulse });
                const entity = createConstructionEntity(chassis, equipment);
                const location = chassis === 'Biped' ? 'RT' : 'Front';
                const attachments = moduleFirst ? [pulse, insulator, insulator] : [insulator, insulator, pulse];
                const mounts = [laser, ...attachments].map((item, slotIndex) => addTestEquipment(entity, item, {
                    allocation: { kind: 'location', location, placements: [{ location, slotIndex }] },
                }));
                reconcileConstructionEquipmentRelationships(entity);
                expect(entity.getLinkingMounts(mounts[0])).toEqual(mounts.slice(1));
                const parsed = parseEntity(encodeNativeEntity(entity), `unit.${nativeEntityFormat(entity)}`, equipment).entity;
                const weapon = parsed.equipment().find(m => m.equipment === laser)!;
                expect(parsed.getLinkingMounts(weapon).map(m => m.equipment)).toEqual(attachments);

                const other = addTestEquipment(entity, laser, { location });
                const secondModule = addTestEquipment(entity, pulse, { location });
                expect(entity.canLinkEquipment(secondModule, mounts[0])).toBeFalse();
                expect(() => entity.linkEquipment(secondModule, mounts[0])).toThrow();
                expect(() => entity.linkEquipment(secondModule, other)).not.toThrow();
                entity.removeEquipment(mounts[2]);
                expect(entity.getLinkingMounts(mounts[0])).toEqual([mounts[1], mounts[3]]);
                entity.moveEquipment(mounts[0], chassis === 'Biped' ? 'LT' : 'Rear');
                expect(entity.getLinkedMount(mounts[1])).toBeUndefined();
                expect(entity.getLinkedMount(mounts[3])).toBeUndefined();
                expect(entity.getLinkedMount(secondModule)).toBe(other);
            });
        }
    }

    it('gives a pulse module listed after another laser\'s insulator to that laser', () => {
        // An enhancement follows the nearest laser above it that can take it, whatever else that laser carries.
        const small = new WeaponEquipment({ id: 'Small Laser', name: 'Small Laser', type: 'weapon', flags: ['F_LASER', 'F_RISC_LASER_PULSE_COMPATIBLE'],
            stats: { criticalSlots: 1 }, weapon: { ammoType: 'NA' } });
        const pulse = new MiscEquipment({ id: 'Test module', name: 'Test module', type: 'misc',
            flags: ['F_WEAPON_ENHANCEMENT', 'F_RISC_LASER_PULSE_MODULE'], stats: { criticalSlots: 1 } });
        const equipment = createTestEquipmentRegistry({ [laser.id]: laser, [small.id]: small, [insulator.id]: insulator, [pulse.id]: pulse });
        const entity = createConstructionEntity('Biped', equipment);
        const [medium, smallLaser, insulated, module] = [laser, small, insulator, pulse].map((item, slotIndex) =>
            addTestEquipment(entity, item, { allocation: { kind: 'location', location: 'RT', placements: [{ location: 'RT', slotIndex }] } }));
        reconcileConstructionEquipmentRelationships(entity);
        expect(entity.getLinkedMount(insulated)).toBe(smallLaser);
        expect(entity.getLinkedMount(module)).toBe(smallLaser);
        expect(entity.getLinkingMounts(medium)).toEqual([]);

        const parsed = parseEntity(encodeNativeEntity(entity), 'unit.mtf', equipment).entity;
        const linkedTo = (item: MiscEquipment) => parsed.getLinkedMount(parsed.equipment().find(m => m.equipment === item)!)?.equipment;
        expect(linkedTo(insulator)).toBe(small);
        expect(linkedTo(pulse)).toBe(small);
    });

    it('moves an enhancement to the laser above it when the location changes', () => {
        const small = new WeaponEquipment({ id: 'Small Laser', name: 'Small Laser', type: 'weapon', flags: ['F_LASER', 'F_RISC_LASER_PULSE_COMPATIBLE'],
            stats: { criticalSlots: 1 }, weapon: { ammoType: 'NA' } });
        const pulse = new MiscEquipment({ id: 'Test module', name: 'Test module', type: 'misc',
            flags: ['F_WEAPON_ENHANCEMENT', 'F_RISC_LASER_PULSE_MODULE'], stats: { criticalSlots: 1 } });
        const entity = createConstructionEntity('Biped', createTestEquipmentRegistry({ [laser.id]: laser, [small.id]: small, [pulse.id]: pulse }));
        const [medium, module, smallLaser] = [laser, pulse, small].map((item, slotIndex) => addTestEquipment(entity, item,
            { allocation: { kind: 'location', location: 'RT', placements: [{ location: 'RT', slotIndex }] } }));
        reconcileConstructionEquipmentRelationships(entity);
        expect(entity.getLinkedMount(module)).toBe(medium);
        reorderConstructionEquipment(entity, 'RT', module.mountId);
        reconcileConstructionEquipmentRelationships(entity);
        expect(entity.getLinkedMount(entity.equipment().find(mount => mount.mountId === module.mountId)!)?.mountId).toBe(smallLaser.mountId);
    });

  it('projects native battle-armor AP attachments onto existing editor mounts', () => {
        const ap = new MiscEquipment({ id: 'Test AP Mount', name: 'Test AP Mount', type: 'misc', flags: ['F_AP_MOUNT'] });
        const rifle = new WeaponEquipment({ id: 'Test Infantry Rifle', name: 'Test Infantry Rifle', type: 'weapon', flags: ['F_INFANTRY'], infantry: {} });
        const baRegistry = createTestEquipmentRegistry({ [ap.id]: ap, [rifle.id]: rifle });
        const entity = createConstructionEntity('BattleArmor', baRegistry);
        const attachment = addTestEquipment(entity, ap, { location: 'Squad', baMountLocation: 'Body' });
        const weapon = addTestEquipment(entity, rifle, { location: 'Squad', baMountLocation: 'Body', isAPM: true });

        reconcileConstructionEquipmentRelationships(entity);
        expect(entity.getLinkedMount(attachment)).toBe(weapon);
        expect(entity.getLinkingMounts(weapon)).toEqual([attachment]);
        expect(entity.equipment()).toEqual([attachment, weapon]);
    });
});
