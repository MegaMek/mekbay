import { Injector } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { CBTForce } from '../cbt-force.model';
import { CBTForceUnit } from '../cbt-force-unit.model';
import { DEAD_CREW_HIT_THRESHOLD, type CrewMemberState } from '../crew-member.model';
import type { LocationData } from '../force-serialization';
import type { Unit } from '../units.model';
import { DataService } from '../../services/data.service';
import { UnitInitializerService } from '../../services/unit-initializer.service';
import { createEmptyUnit } from '../../testing/unit-test-helpers';
import { MekRules } from './mek-rules';

class TestCBTForce extends CBTForce {
    override emitChanged(): void {
    }
}

let dataService: jasmine.SpyObj<DataService>;
let unitInitializer: UnitInitializerService;
let injector: Injector;

function createRulesHarness(options: {
    crewStates?: Exclude<CrewMemberState, 'dead'>[];
    crewHits?: number[];
    committedDestroyedLocations?: string[];
    internalLocations?: string[];
    shutdown?: boolean;
    walk?: number;
    run?: number;
    jump?: number;
    umu?: number;
} = {}): MekRules {
    return createForceUnitHarness(options).rules as MekRules;
}

function createCommittedLocationState(committedDestroyedLocations: string[] = []): Record<string, LocationData> {
    return committedDestroyedLocations.reduce<Record<string, LocationData>>((state, loc) => {
        state[loc] = { internal: 1 };
        return state;
    }, {});
}

function createForceUnitHarness(options: {
    crewStates?: Exclude<CrewMemberState, 'dead'>[];
    crewHits?: number[];
    committedDestroyedLocations?: string[];
    internalLocations?: string[];
    shutdown?: boolean;
    walk?: number;
    run?: number;
    jump?: number;
    umu?: number;
} = {}): CBTForceUnit {
    const crewStates = options.crewStates ?? ['healthy'];
    const crewHits = options.crewHits ?? [];
    const baseUnit = createEmptyUnit({
        type: 'Mek',
        subtype: 'BattleMek',
        crewSize: Math.max(crewStates.length, crewHits.length),
        walk: options.walk ?? 5,
        run: options.run ?? 8,
        jump: options.jump ?? 4,
        umu: options.umu ?? 2,
    });

    dataService.getUnitByName.and.callFake((name: string): Unit | undefined => name === baseUnit.name ? baseUnit : undefined);
    const force = new TestCBTForce('Test Force', dataService, unitInitializer, injector);
    const forceUnit = new CBTForceUnit(baseUnit, force, dataService, unitInitializer, injector);
    const internalLocations = options.internalLocations ?? ['LL', 'RL'];
    forceUnit.locations = {
        internal: new Map(internalLocations.map(loc => [loc, { loc, points: 1 }])),
        armor: new Map(internalLocations.map(loc => [loc, { loc, rear: false, points: 1 }])),
    };

    forceUnit.setLocations(createCommittedLocationState(options.committedDestroyedLocations), true);
    crewStates.forEach((state, index) => forceUnit.getCrewMember(index).setState(state));
    crewHits.forEach((hits, index) => forceUnit.getCrewMember(index).setHits(hits));
    if (options.shutdown) {
        forceUnit.setCondition('shutdown', true);
    }
    forceUnit.isLoaded.set(true);

    return forceUnit;
}

describe('MekRules', () => {
    beforeEach(() => {
        dataService = jasmine.createSpyObj<DataService>('DataService', ['getUnitByName']);
        TestBed.configureTestingModule({
            providers: [
                UnitInitializerService,
                { provide: DataService, useValue: dataService },
            ],
        });

        unitInitializer = TestBed.inject(UnitInitializerService);
        injector = TestBed.inject(Injector);
    });

    it('keeps Mek immobile false by default when crew are functional', () => {
        const rules = createRulesHarness();

        expect(rules.hasComputedCondition('immobile')).toBeFalse();
        expect(rules.hasComputedCondition('abandoned')).toBeFalse();
    });

    it('marks Meks abandoned when every crew member is dead or ejected', () => {
        const rules = createRulesHarness({ crewStates: ['healthy', 'ejected'], crewHits: [DEAD_CREW_HIT_THRESHOLD] });

        expect(rules.hasComputedCondition('abandoned')).toBeTrue();
    });

    it('does not mark Meks abandoned while any crew member is alive in the unit', () => {
        const rules = createRulesHarness({ crewStates: ['healthy', 'unconscious'], crewHits: [DEAD_CREW_HIT_THRESHOLD] });

        expect(rules.hasComputedCondition('abandoned')).toBeFalse();
    });

    it('marks shutdown Meks immobile', () => {
        const rules = createRulesHarness({ shutdown: true });

        expect(rules.hasComputedCondition('immobile')).toBeTrue();
    });

    it('marks Meks immobile when all leg limbs are destroyed or missing', () => {
        const forceUnit = createForceUnitHarness({
            internalLocations: ['LL', 'RA', 'RT'],
            committedDestroyedLocations: ['LL'],
        });

        expect(forceUnit.isInternalLocCommittedDestroyed('RA')).toBeFalse();
        expect(forceUnit.rules.hasComputedCondition('immobile')).toBeFalse();

        forceUnit.setLocations(createCommittedLocationState(['LL', 'RT']), true);

        expect(forceUnit.isInternalLocCommittedDestroyed('RA')).toBeTrue();
        expect(forceUnit.rules.hasComputedCondition('immobile')).toBeTrue();
    });
});