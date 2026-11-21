// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import { DIALOG_DATA, DialogRef } from '@angular/cdk/dialog';
import { TestBed } from '@angular/core/testing';
import type { ComponentId } from '../../models/entity/entity-identifiers';
import type { WeaponAttackProfile } from '../../models/rules/weapon-attack-resolution';
import type { AttackReportWeapon } from '../attack-report/attack-report.component';
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

/** TO:AUE p. 134: an insulated laser's to-hit roll of 2 calls for a 2D6 roll, a critical hit on 8 or more. */
describe('AttackResolutionDialogComponent laser insulator', () => {
    /** Sets the to-hit roll, notes whether the report then offers the insulator roll, sets that and closes */
    function resolve(toHit: number, insulator: number): Readonly<{ offered: boolean; resolution: AttackResolution }> {
        const close = jasmine.createSpy('close');
        const data: AttackResolutionDialogData = {
            attacker: 'Attacker',
            targets: [{
                targetId: 'target', name: 'Target', letter: 'A', color: '#fff', arc: 'front',
                defender: null, delivery: null, ruleset: 'core-2026', profiles: [INSULATED_LASER],
            }],
        };
        TestBed.configureTestingModule({
            imports: [AttackResolutionDialogComponent],
            providers: [{ provide: DialogRef, useValue: { close } }, { provide: DIALOG_DATA, useValue: data }],
        });
        const dialog = TestBed.createComponent(AttackResolutionDialogComponent).componentInstance as unknown as {
            setRoll(target: number, edit: Readonly<{ weapon: number; roll: string; total: number }>): void;
            targets(): readonly Readonly<{ weapons: readonly AttackReportWeapon[] }>[];
            close(): void;
        };
        dialog.setRoll(0, { weapon: 0, roll: 'to-hit', total: toHit });
        const offered = dialog.targets()[0].weapons[0].insulator !== undefined;
        dialog.setRoll(0, { weapon: 0, roll: 'insulator', total: insulator });
        dialog.close();
        return { offered, resolution: close.calls.mostRecent().args[0] as AttackResolution };
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
