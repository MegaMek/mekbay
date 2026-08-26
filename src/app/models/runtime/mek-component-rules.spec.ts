// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import { WeaponEquipment } from '../equipment.model';
import { asCommandId, asStateRevision } from './runtime-state';
import { projectMekEquipmentComponents } from './equipment-panel';
import {
    mekComponentModes,
} from './mek-component-rules';
import { FLAMER_DAMAGE_MODE, FLAMER_HEAT_MODE } from '../flamer-mode.model';
import { createDirectMekRuntimeFixture } from './testing/direct-mek-runtime-fixture';

describe('direct Mek component rules', () => {
    it('offers flamer modes only in Total Warfare and projects the active Heat label', () => {
        const core = flamerFixture('core-2026');
        expect(mekComponentModes(core.entity, core.index, core.componentId, 'core-2026').modes)
            .toEqual([]);

        const tw = flamerFixture('total-warfare');
        expect(mekComponentModes(tw.entity, tw.index, tw.componentId, 'total-warfare')).toEqual({
            modes: [FLAMER_DAMAGE_MODE, FLAMER_HEAT_MODE],
            defaultMode: FLAMER_DAMAGE_MODE,
        });

        expect(tw.instance.dispatch({
            type: 'set-component-mode',
            commandId: asCommandId('flamer:heat'),
            expectedRevision: asStateRevision(0),
            componentId: tw.componentId,
            mode: FLAMER_HEAT_MODE,
        }).accepted).toBeTrue();
        const row = projectMekEquipmentComponents(
            tw.entity,
            tw.index,
            'total-warfare',
            tw.instance.query(),
        ).find(candidate => candidate.componentId === tw.componentId);
        expect(row?.label).toBe('Medium Laser (Heat)');
    });
});

function flamerFixture(ruleset: 'core-2026' | 'total-warfare') {
    const fixture = createDirectMekRuntimeFixture(ruleset, `unit:flamer:${ruleset}`);
    const component = fixture.equipmentComponent('ISMediumLaser');
    const equipment = component.mount.equipment;
    if (!(equipment instanceof WeaponEquipment)) throw new Error('Fixture laser is not a weapon');
    equipment.flags.add('F_FLAMER');
    return { ...fixture, componentId: component.id };
}
