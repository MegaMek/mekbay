// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import { MiscEquipment } from './equipment.model';
import { jumpJetKind } from './jump-equipment.model';

describe('jump equipment', () => {
    function jumpJet(flags: ConstructorParameters<typeof MiscEquipment>[0]['flags']): MiscEquipment {
        return new MiscEquipment({ id: 'jump-jet', name: 'Jump Jet', type: 'misc', flags });
    }

    it('distinguishes primitive prototype jets from prototype improved jets', () => {
        expect(jumpJetKind(jumpJet(['F_JUMP_JET']))).toBe('standard');
        expect(jumpJetKind(jumpJet(['F_JUMP_JET', 'S_PROTOTYPE']))).toBe('standard');
        expect(jumpJetKind(jumpJet(['F_JUMP_JET', 'S_IMPROVED']))).toBe('improved');
        expect(jumpJetKind(jumpJet(['F_JUMP_JET', 'S_IMPROVED', 'S_PROTOTYPE'])))
            .toBe('prototype-improved');
    });
});
