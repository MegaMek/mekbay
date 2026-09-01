// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import { Injector } from '@angular/core';

import { ASForce } from '../models/as-force.model';
import { ASForceUnit } from '../models/as-force-unit.model';
import type { CBTForce } from '../models/cbt-force.model';
import { asCrewPositionId } from '../models/entity/entity-identifiers';
import { CBTForceMember } from '../models/force-member.model';
import type { CrewAssignment } from '../models/runtime/crew-assignment';
import { createEmptyUnit, createTestMekEntity } from '../testing/unit-test-helpers';
import { AsAbilityLookupService } from './as-ability-lookup.service';
import type { DataService } from './data.service';
import { ForceCrewTransferService } from './force-crew-transfer.service';
import { GameSystem } from '../models/common.model';

describe('ForceCrewTransferService cross-system conversion', () => {
    const service = new ForceCrewTransferService();

    it('maps AS name to the first CBT crew member and skill to every gunnery value', async () => {
        const source = createAlphaStrikeUnit();
        source.setPilotName('Morgan Kell');
        source.setPilotSkill(2);
        source.setFormationCommander(true);

        const profile = crewProfile([
            { name: '', gunnery: 4, piloting: 5 },
            { name: '', gunnery: 4, piloting: 5 },
            { name: '', gunnery: 4, piloting: 5 },
        ]);
        const force = jasmine.createSpyObj<CBTForce>(
            'CBTForce',
            ['getUnitCrewProfile', 'replaceUnitCrewProfile'],
        );
        force.getUnitCrewProfile.and.returnValue(profile);
        force.replaceUnitCrewProfile.and.resolveTo(profile);
        const target = new CBTForceMember(
            'cbt-target',
            force,
            createTestMekEntity(),
        );

        await service.transferCrossSystem(
            source,
            target,
            GameSystem.AS,
            GameSystem.CBT,
        );

        expect(force.replaceUnitCrewProfile).toHaveBeenCalledOnceWith(target.id, [
            { ...profile.positions[0], name: 'Morgan Kell', gunnery: 2 },
            { ...profile.positions[1], gunnery: 2 },
            { ...profile.positions[2], gunnery: 2 },
        ]);
    });

    it('maps the first CBT crew name and gunnery to AS without copying piloting', async () => {
        const profile = crewProfile([
            { name: 'Natasha Kerensky', gunnery: 1, piloting: 2 },
            { name: 'Second crew member', gunnery: 3, piloting: 4 },
        ]);
        const force = jasmine.createSpyObj<CBTForce>(
            'CBTForce',
            ['getUnitCrewProfile', 'isUnitCommander'],
        );
        force.getUnitCrewProfile.and.returnValue(profile);
        force.isUnitCommander.and.returnValue(true);
        const source = new CBTForceMember(
            'cbt-source',
            force,
            createTestMekEntity(),
        );
        const target = createAlphaStrikeUnit();

        await service.transferCrossSystem(
            source,
            target,
            GameSystem.CBT,
            GameSystem.AS,
        );

        expect(target.alias()).toBe('Natasha Kerensky');
        expect(target.pilotSkill()).toBe(1);
        expect(target.commander()).toBeTrue();
    });
});

function createAlphaStrikeUnit(): ASForceUnit {
    const injector = Injector.create({
        providers: [{ provide: AsAbilityLookupService, useValue: {} }],
    });
    const dataService = {} as DataService;
    const force = new ASForce('Test force', dataService, injector);
    return force.addUnit(createEmptyUnit({
        type: 'Mek',
        subtype: 'BattleMek',
        as: { TP: 'BM', PV: 20 },
    }));
}

function crewProfile(
    positions: readonly Readonly<{
        name: string;
        gunnery: number;
        piloting: number;
    }>[],
): CrewAssignment {
    return {
        schemaVersion: 1,
        positions: positions.map((position, index) => ({
            positionId: asCrewPositionId(`crew-${index}`),
            role: '',
            ...position,
        })),
    };
}
