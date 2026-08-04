import type { CBTForceUnit } from './cbt-force-unit.model';
import { CrewMember } from './crew-member.model';

describe('CrewMember serialization', () => {
    function createCrew(unitSubtype: string): CrewMember {
        const unit = {
            getUnit: () => ({ subtype: unitSubtype }),
            rules: { isCrewCockpitDestroyed: () => false },
            setCrewMember: jasmine.createSpy('setCrewMember'),
            setModified: jasmine.createSpy('setModified'),
        } as unknown as CBTForceUnit;
        const crew = new CrewMember(0, unit);
        crew.setName('Pilot');
        crew.setSkill('gunnery', 6);
        crew.setSkill('piloting', 7);
        return crew;
    }

    it('omits aerospace skills for non-LAM units', () => {
        const serialized = createCrew('BattleMek').serialize();

        expect(serialized.asfGunnerySkill).toBeUndefined();
        expect(serialized.asfPilotingSkill).toBeUndefined();
    });

    it('includes effective aerospace skills for LAM units', () => {
        const crew = createCrew('Land-Air BattleMek');
        crew.setSkill('gunnery', 2, true);
        crew.setSkill('piloting', 3, true);

        const serialized = crew.serialize();

        expect(serialized.asfGunnerySkill).toBe(2);
        expect(serialized.asfPilotingSkill).toBe(3);
    });
});