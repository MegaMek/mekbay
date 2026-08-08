// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import type { Injector } from '@angular/core';
import type { DataService } from '../services/data.service';
import { DialogsService } from '../services/dialogs.service';
import { LoggerService } from '../services/logger.service';
import type { UnitInitializerService } from '../services/unit-initializer.service';
import { GameSystem } from './common.model';
import { CBTForceUnit } from './cbt-force-unit.model';
import { CBTForce } from './cbt-force.model';
import type { CBTSerializedForce, CBTSerializedUnit } from './force-serialization';

describe('CBTForce pilot transfer', () => {
    function createCrew(
        groundGunnery: number,
        groundPiloting: number,
        asfGunnery = groundGunnery,
        asfPiloting = groundPiloting,
    ) {
        return {
            getName: () => 'Pilot',
            getSkill: (skill: 'gunnery' | 'piloting', asf = false) => {
                if (skill === 'gunnery') return asf ? asfGunnery : groundGunnery;
                return asf ? asfPiloting : groundPiloting;
            },
            setName: jasmine.createSpy('setName'),
            setSkill: jasmine.createSpy('setSkill'),
        };
    }

    function transfer(fromSubtype: string, toUnitData: any, fromCrew: any, toCrew: any): void {
        const fromUnit = {
            getUnit: () => ({ subtype: fromSubtype }),
            getCrewMembers: () => [fromCrew],
            commander: () => true,
        };
        const toUnit = {
            getUnit: () => toUnitData,
            getCrewMembers: () => [toCrew],
            setFormationCommander: jasmine.createSpy('setFormationCommander'),
        };

        (CBTForce.prototype as any).transferPilotData.call({}, fromUnit, toUnit);
    }

    it('preserves custom ASF skills when replacing one LAM with another', () => {
        const sourceCrew = createCrew(4, 5, 2, 3);
        const targetCrew = createCrew(4, 5);

        transfer('Land-Air BattleMek', { type: 'Mek', subtype: 'Land-Air BattleMek' }, sourceCrew, targetCrew);

        expect(targetCrew.setSkill).toHaveBeenCalledWith('gunnery', 2, true);
        expect(targetCrew.setSkill).toHaveBeenCalledWith('piloting', 3, true);
    });

    it('initializes ASF skills from ground skills when replacing a non-LAM with a LAM', () => {
        const sourceCrew = createCrew(6, 7);
        const targetCrew = createCrew(4, 5);

        transfer('BattleMek', { type: 'Mek', subtype: 'Land-Air BattleMek' }, sourceCrew, targetCrew);

        expect(targetCrew.setSkill).toHaveBeenCalledWith('gunnery', 6, true);
        expect(targetCrew.setSkill).toHaveBeenCalledWith('piloting', 7, true);
    });

    it('enforces fixed Piloting on the replacement unit', () => {
        const sourceCrew = createCrew(3, 0);
        const targetCrew = createCrew(4, 5);

        transfer('BattleMek', { type: 'ProtoMek', subtype: 'ProtoMek' }, sourceCrew, targetCrew);

        expect(targetCrew.setSkill).toHaveBeenCalledWith('piloting', 5);
        expect(targetCrew.setSkill).not.toHaveBeenCalledWith('piloting', 0);
    });
});

describe('CBTForce deserialization failures', () => {
    let dialogs: jasmine.SpyObj<DialogsService>;
    let logger: jasmine.SpyObj<LoggerService>;
    let dataService: DataService;
    let injector: Injector;

    function createSerializedUnit(id: string, unit: string): CBTSerializedUnit {
        return {
            id,
            unit,
            state: {
                modified: false,
                destroyed: false,
                crew: [],
                crits: [],
                locations: {},
                heat: { current: 0, previous: 0 },
            },
        };
    }

    function createSerializedForce(unitNames: string[]): CBTSerializedForce {
        return {
            version: 1,
            timestamp: new Date().toISOString(),
            instanceId: 'force-id',
            type: GameSystem.CLASSIC,
            name: 'Partially valid force',
            groups: [{
                id: 'group-id',
                units: unitNames.map((name, index) => createSerializedUnit(`unit-${index}`, name)),
            }],
        };
    }

    function createLoadedUnit(data: CBTSerializedUnit): CBTForceUnit {
        return {
            id: data.id,
            getUnit: () => ({ name: data.unit }),
        } as CBTForceUnit;
    }

    beforeEach(() => {
        dialogs = jasmine.createSpyObj<DialogsService>('DialogsService', ['showError']);
        dialogs.showError.and.resolveTo();
        logger = jasmine.createSpyObj<LoggerService>('LoggerService', ['error']);
        dataService = {
            getUnitByName: () => undefined,
            getFactionById: () => null,
            getEraById: () => null,
        } as unknown as DataService;
        injector = {
            get: (token: unknown) => {
                if (token === DialogsService) return dialogs;
                if (token === LoggerService) return logger;
                throw new Error(`Unexpected injector token: ${String(token)}`);
            },
        } as Injector;
    });

    it('reports and skips a unit that is not found while loading the rest of the force', () => {
        const deserialize = CBTForceUnit.deserialize;
        spyOn(CBTForceUnit, 'deserialize').and.callFake((data, force, service, initializer, unitInjector) => {
            if (data.unit === 'Missing Unit') {
                return deserialize(data, force, service, initializer, unitInjector);
            }
            return createLoadedUnit(data);
        });

        const force = CBTForce.deserialize(
            createSerializedForce(['Valid Unit A', 'Missing Unit', 'Valid Unit B']),
            dataService,
            {} as UnitInitializerService,
            injector,
        );

        expect(force.units().map(unit => unit.getUnit().name)).toEqual(['Valid Unit A', 'Valid Unit B']);
        expect(dialogs.showError).toHaveBeenCalledOnceWith(
            'Unable to load unit "Missing Unit". The unit was skipped.\n\n' +
            'Unit with name "Missing Unit" not found in dataService',
            'Unit Load Error',
        );
    });

    it('reports and skips a unit that throws an arbitrary error while loading the rest of the force', () => {
        spyOn(CBTForceUnit, 'deserialize').and.callFake((data) => {
            if (data.unit === 'Broken Unit') throw new TypeError('Invalid serialized state');
            return createLoadedUnit(data);
        });

        const force = CBTForce.deserialize(
            createSerializedForce(['Valid Unit', 'Broken Unit']),
            dataService,
            {} as UnitInitializerService,
            injector,
        );

        expect(force.units().map(unit => unit.getUnit().name)).toEqual(['Valid Unit']);
        expect(dialogs.showError).toHaveBeenCalledOnceWith(
            'Unable to load unit "Broken Unit". The unit was skipped.\n\nInvalid serialized state',
            'Unit Load Error',
        );
    });
});