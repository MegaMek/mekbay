// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import type { EquipmentFlag } from '../../../equipment-flags.type';
import { MiscEquipment } from '../../../equipment.model';
import { MountedEngine, MountedStructure, STANDARD_STRUCTURE_EQUIPMENT } from '../../components';
import { TestBipedMekEntity } from '../../testing/test-entities';
import { addTestEquipment } from '../../testing/test-mounted-equipment';
import { calculateMekCostReport } from './meks';

describe('Mek cost', () => {
    it('prices the gyro by the tons its engine rating sets (TM pp. 50, 278)', () => {
        // A FrankenMek keeps its 245 engine on a 50-ton chassis: Walking MP 4, but a 3-ton gyro.
        const entity = new TestBipedMekEntity();
        entity.setTonnage(50);
        entity.configureEngine(new MountedEngine({ type: 'Fusion', rating: 245, techBase: 'IS' }));
        entity.originalWalkMP.set(4);
        const gyro = () => calculateMekCostReport(entity, []).steps.find(step => step.type === 'Gyro')?.amount;
        expect(gyro()).toBe(900000);
        // Each type costs per ton of its own weight: an XL gyro weighs half as much, 1.5 tons at 750,000 each.
        entity.gyroType.set('XL');
        expect(gyro()).toBe(1125000);
    });

    it('prices primitive prototype jump jets by the Jump MP they give, other jets by their count', () => {
        // Four jets in a 50-ton donor torso of a 100-ton FrankenMek give 1 Jump MP (CO p. 213).
        const jumpJetCost = (flags: readonly EquipmentFlag[]) => {
            const entity = new TestBipedMekEntity();
            entity.setTonnage(100);
            entity.originalWalkMP.set(4);
            entity.setStructureAt('CT', new MountedStructure({ tonnage: 100, structure: STANDARD_STRUCTURE_EQUIPMENT }));
            entity.setStructureAt('LT', new MountedStructure({ tonnage: 50, structure: STANDARD_STRUCTURE_EQUIPMENT }));
            const jet = new MiscEquipment({
                id: 'Test Jump Jet', name: 'Jump Jet', type: 'misc', stats: { tonnage: 'variable' },
                flags: ['F_JUMP_JET', ...flags],
            });
            for (let count = 0; count < 4; count++) addTestEquipment(entity, jet, { location: 'LT' });
            return calculateMekCostReport(entity, []).steps.find(step => step.type === 'Jump Jets')?.amount;
        };
        // IO:AE p. 181: tonnage x 200 x Jump MP squared.
        expect(jumpJetCost(['S_PROTOTYPE'])).toBe(100 * 200 * 1 ** 2);
        // TM p. 278: 200 x (number of jump jets) squared x tonnage.
        expect(jumpJetCost(['S_STANDARD'])).toBe(100 * 200 * 4 ** 2);
    });
});
