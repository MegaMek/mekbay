// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import { CBTForce } from './cbt-force.model';

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