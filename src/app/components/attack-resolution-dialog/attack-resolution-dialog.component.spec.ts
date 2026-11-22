// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import { DIALOG_DATA, DialogRef } from '@angular/cdk/dialog';
import { TestBed } from '@angular/core/testing';
import type { CBTRuleset } from '../../models/cbt-ruleset.model';
import type { ComponentId } from '../../models/entity/entity-identifiers';
import type { WeaponAttackProfile } from '../../models/rules/weapon-attack-resolution';
import {
    AttackResolutionDialogComponent,
    type AttackResolution,
    type AttackResolutionDialogData,
} from './attack-resolution-dialog.component';

const LASER = 'mount:medium-laser' as ComponentId;

const INSULATED_LASER: WeaponAttackProfile = Object.freeze({
    componentId: LASER,
    name: 'Medium Laser',
    targetNumber: 8,
    damagePerHit: 5,
    projectiles: 1,
    allHit: false,
    groupSize: 5,
    types: Object.freeze([]),
    partialCover: false,
    jamRoll: null,
    table: 'standard',
    insulated: true,
});

function createAttackDialog(profiles: readonly WeaponAttackProfile[], ruleset: CBTRuleset) {
    const close = jasmine.createSpy('close');
    const data: AttackResolutionDialogData = {
        attacker: 'Attacker',
        targets: [{
            targetId: 'target', name: 'Target', letter: 'A', color: '#fff', arc: 'front',
            defender: null, delivery: { toForce: 'force', toUnit: 'target' }, ruleset, profiles,
        }],
    };
    TestBed.configureTestingModule({
        imports: [AttackResolutionDialogComponent],
        providers: [{ provide: DialogRef, useValue: { close } }, { provide: DIALOG_DATA, useValue: data }],
    });
    return {
        dialog: TestBed.createComponent(AttackResolutionDialogComponent).componentInstance,
        result: () => close.calls.mostRecent().args[0] as AttackResolution,
    };
}

/** TO:AUE p. 134: an insulated laser's to-hit roll of 2 calls for a 2D6 roll, a critical hit on 8 or more. */
describe('AttackResolutionDialogComponent laser insulator', () => {
    /** Sets the to-hit roll, notes whether the report then offers the insulator roll, sets that and closes */
    function resolve(toHit: number, insulator: number): Readonly<{ offered: boolean; resolution: AttackResolution }> {
        const { dialog, result } = createAttackDialog([INSULATED_LASER], 'core-2026');
        dialog['setRoll'](0, { weapon: 0, roll: 'to-hit', total: toHit });
        const offered = dialog['targets']()[0].weapons[0].insulator !== undefined;
        dialog['setRoll'](0, { weapon: 0, roll: 'insulator', total: insulator });
        dialog['close']();
        return { offered, resolution: result() };
    }

    it('damages the laser on 8 or more after a to-hit roll of 2', () => {
        const { offered, resolution } = resolve(2, 8);
        expect(offered).toBeTrue();
        expect(resolution.insulatorFailed).toEqual([LASER]);
    });

    it('spares the laser below 8', () => {
        expect(resolve(2, 7).resolution.insulatorFailed).toEqual([]);
    });

    it('rolls nothing after any other to-hit roll', () => {
        const { offered, resolution } = resolve(3, 12);
        expect(offered).toBeFalse();
        expect(resolution.insulatorFailed).toEqual([]);
    });
});

describe('AttackResolutionDialogComponent PPC capacitor burnout', () => {
    const ppc: WeaponAttackProfile = {
        componentId: 'mount:ppc' as ComponentId, name: 'PPC', targetNumber: 2, damagePerHit: 15, projectiles: 1,
        allHit: false, groupSize: 15, types: ['DE'], partialCover: false, jamRoll: null, table: 'standard',
        capacitorBurnoutOnTwo: true,
    };

    it('records a burnout on closing and leaves the target without a hit to receive', () => {
        const { dialog, result } = createAttackDialog([ppc], 'total-warfare');
        dialog['setRoll'](0, { weapon: 0, roll: 'to-hit', total: 2 });
        expect(dialog['targets']()[0].weapons[0]).toEqual(jasmine.objectContaining({
            hit: false, capacitorBurnout: true, groups: [],
        }));
        expect(dialog['deliverable']()).toEqual([]);
        dialog['close']();
        expect(result().burnedOutPpcs).toEqual([ppc.componentId!]);
        expect(result().deliveries).toEqual([]);
    });

    it('sends only the other shot when the PPC burns out', () => {
        const { dialog, result } = createAttackDialog([ppc, INSULATED_LASER], 'total-warfare');
        dialog['setRoll'](0, { weapon: 0, roll: 'to-hit', total: 2 });
        dialog['setRoll'](0, { weapon: 1, roll: 'to-hit', total: 8 });
        dialog['send']();
        expect(result().burnedOutPpcs).toEqual([ppc.componentId!]);
        expect(result().deliveries[0].weapons.map(weapon => weapon.name)).toEqual(['Medium Laser']);
    });

    it('settles the final PPC roll after the player corrects the dice', () => {
        const { dialog, result } = createAttackDialog([ppc], 'total-warfare');
        dialog['setRoll'](0, { weapon: 0, roll: 'to-hit', total: 2 });
        dialog['setRoll'](0, { weapon: 0, roll: 'to-hit', total: 3 });
        dialog['send']();
        expect(result().burnedOutPpcs).toEqual([]);
        expect(result().deliveries[0].weapons.map(weapon => weapon.name)).toEqual(['PPC']);
    });
});
