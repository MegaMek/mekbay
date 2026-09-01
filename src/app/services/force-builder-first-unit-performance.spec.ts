// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';

import { GameSystem } from '../models/common.model';
import type { Era } from '../models/eras.model';
import type { Faction } from '../models/factions.model';
import type { Force } from '../models/force.model';
import { CBTForce } from '../models/cbt-force.model';
import type { ForceUnit } from '../models/force-unit.model';
import { CBTForceMember, type ForceMember } from '../models/force-member.model';
import type { AvailabilitySource } from '../models/options.model';
import { createEmptyForceNameWords } from '../models/force-name-words.model';
import { createEmptyUnit, createTestMekEntity } from '../testing/unit-test-helpers';
import { DataService } from './data.service';
import { ForceWorkspaceCommandsService } from './force-workspace-commands.service';
import { ForceFormationService } from './force-formation.service';
import { OptionsService } from './options.service';
import { UnitAvailabilitySourceService } from './unit-availability-source.service';

describe('ForceWorkspaceCommandsService first-unit work bounds', () => {
    afterEach(() => TestBed.resetTestingModule());

    it('adds a first unit without enumerating the full MUL faction membership', async () => {
        const unit = createEmptyUnit({
            id: 10_001,
            name: 'Atlas AS7-D',
            chassis: 'Atlas',
            model: 'AS7-D',
            type: 'Mek',
            year: 3025,
        });
        const membership = new Set(Array.from({ length: 10_001 }, (_, index) => index + 1));
        let iteratedMemberships = 0;
        const originalIterator = membership[Symbol.iterator].bind(membership);
        membership[Symbol.iterator] = function* (): SetIterator<number> {
            for (const unitId of originalIterator()) {
                iteratedMemberships++;
                yield unitId;
            }
        };
        const era = {
            id: 100,
            name: 'Succession Wars',
            units: membership,
            years: { from: 2780, to: 3049 },
        } as Era;
        const faction = {
            id: 42,
            name: 'Federated Suns',
            group: 'Inner Sphere',
            img: '',
            eras: { [era.id]: membership },
        } as Faction;
        const optionsServiceMock = {
            options: signal<{ availabilitySource: AvailabilitySource }>({ availabilitySource: 'mul' }),
        };
        TestBed.configureTestingModule({
            providers: [
                UnitAvailabilitySourceService,
                { provide: DataService, useValue: {} },
                { provide: OptionsService, useValue: optionsServiceMock },
            ],
        });

        const groupUnits = signal<ForceUnit[]>([]);
        const forceUnits: ForceUnit[] = [];
        const group = { units: groupUnits };
        const force = {
            gameSystem: GameSystem.CBT,
            faction: signal<Faction | null>(null),
            factionLock: false,
            era: signal<Era | null>(null),
            eraLock: false,
            members: () => forceUnits,
            groups: () => [group],
            addUnit: (summary: typeof unit) => {
                const forceUnit = {
                    id: 'first-unit',
                    force,
                    getSummary: () => summary,
                    getGroup: () => group,
                } as unknown as ForceUnit;
                forceUnits.push(forceUnit);
                groupUnits.set([forceUnit]);
                return forceUnit;
            },
            setName: jasmine.createSpy('setName'),
            getUnitSourceIdentity: () => ({ provider: unit.provider, uuid: unit.uuid }),
            getRosterGroupId: () => 'group-1',
            queryCanonicalRoster: () => ({
                kind: 'available',
                snapshot: {
                    members: [{ instanceId: 'first-unit' }],
                },
            }),
        } as unknown as Force;
        Object.setPrototypeOf(force, CBTForce.prototype);
        const service = Object.create(ForceWorkspaceCommandsService.prototype) as any;
        const selectedUnit = signal<ForceMember | null>(null);
        const workspace = {
            smartCurrentForce: () => null,
            selectedUnit,
            selectUnit: (member: ForceMember | null) => selectedUnit.set(member),
        };
        service.workspace = workspace;
        service.builder = {
            createNewForce: jasmine.createSpy('createNewForce').and.resolveTo(force),
        };
        service.layoutService = { openMenu: jasmine.createSpy('openMenu') };
        const requestClosePanels = jasmine.createSpy('requestClosePanels');
        service.toastService = { showToast: jasmine.createSpy('showToast') };
        service.logger = {
            info: jasmine.createSpy('info'),
            error: jasmine.createSpy('error'),
        };
        service.injector = { get: () => ({ requestClosePanels }) };
        service.dataService = {
            getEras: () => [era],
            getFactions: () => [faction],
            getForceNameWords: () => createEmptyForceNameWords(),
            getUnitByIdentity: () => unit,
        };
        service.unitAvailabilitySource = TestBed.inject(UnitAvailabilitySourceService);
        const admitted = new CBTForceMember(
            'first-unit' as any,
            force as any,
            createTestMekEntity({
                uuid: unit.uuid,
                chassis: unit.chassis,
                model: unit.model,
                year: unit.year,
            }),
        );
        service.unitAdmission = {
            admit: jasmine.createSpy('admit').and.callFake(async () => {
                forceUnits.push(admitted as unknown as ForceUnit);
                groupUnits.set([admitted as unknown as ForceUnit]);
                return admitted;
            }),
        };
        const formations = Object.create(ForceFormationService.prototype) as any;
        formations.dataService = service.dataService;
        formations.injector = service.injector;
        formations.unitAvailabilitySource = service.unitAvailabilitySource;
        formations.reconcileASFormationAssignments = jasmine.createSpy('reconcileASFormationAssignments');
        service.formations = formations;

        const created = await service.addUnit(unit, undefined, undefined, undefined, GameSystem.CBT);

        expect(created).toBe(admitted);
        expect(service.builder.createNewForce).toHaveBeenCalledOnceWith('', GameSystem.CBT);
        expect(selectedUnit()).toBe(created);
        expect(force.faction()).toBe(faction);
        expect(iteratedMemberships).toBe(0);
        expect(requestClosePanels)
            .toHaveBeenCalledOnceWith({ exitExpandedView: true });
    });
});
