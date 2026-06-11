import { GameSystem } from '../models/common.model';
import type { CBTForce } from '../models/cbt-force.model';
import { CBTForceUnit } from '../models/cbt-force-unit.model';
import type { CrewMember } from '../models/crew-member.model';
import type { CriticalSlot } from '../models/force-serialization';
import type { Unit } from '../models/units.model';
import { createEmptyUnit } from '../testing/unit-test-helpers';
import { parseMulForce, sanitizeMulFilename, serializeForceToMul } from './mul-file.util';

function createSerializedAmmoUnit() {
    return createEmptyUnit({
        name: 'BMKingCrab_KGC0000',
        chassis: 'King Crab',
        model: 'KGC-0000',
        armor: 160,
        internal: 80,
        moveType: 'Biped',
        comp: [
            { id: 'IS Ammo AC/20', q: 1, q2: 5, n: 'AC/20 Ammo', t: 'X', p: 2, l: 'RT' },
            { id: 'IS Ammo AC/20', q: 1, q2: 10, n: 'AC/20 Ammo', t: 'X', p: 2, l: 'RT' },
            { id: 'IS Ammo LRM-15', q: 1, q2: 8, n: 'LRM 15 Ammo', t: 'X', p: 3, l: 'LT' },
            { id: 'IS Ammo AC/20', q: 1, q2: 5, n: 'AC/20 Ammo', t: 'X', p: 3, l: 'LT' },
        ],
    });
}

function createSerializedArmorUnit() {
    return createEmptyUnit({
        name: 'BMAtlas_AS7RS',
        chassis: 'Atlas',
        model: 'AS7-RS',
        armor: 160,
        internal: 80,
        moveType: 'Biped',
        comp: [
            { id: 'ISModularArmor', q: 1, n: 'Modular Armor', t: 'S', p: 2, l: 'RT' },
            { id: 'IS Large Laser', q: 1, n: 'Large Laser', t: 'E', p: 2, l: 'RT' },
        ],
    });
}

function createFakeCrewMember(id = 0): CrewMember {
    return {
        getId: () => id,
        getName: () => id === 0 ? '' : `Crew ${id}`,
        getSkill: (skillType: 'gunnery' | 'piloting') => skillType === 'gunnery' ? 4 : 5,
        serialize: () => ({ id, name: id === 0 ? '' : `Crew ${id}`, gunnerySkill: 4, pilotingSkill: 5, hits: 0, state: 0 }),
    } as CrewMember;
}

function createFakeForceUnit(unit = createSerializedAmmoUnit(), critSlots: CriticalSlot[] = [{
    id: 'IS Ammo AC/20@RT#4',
    name: 'IS Ammo AC/20',
    loc: 'RT',
    slot: 4,
    totalAmmo: 5,
    consumed: 1,
}], crewMembers: CrewMember[] = [createFakeCrewMember()], locationDamage: Record<string, any> = {}, loadedLocations = {
    armor: new Map<string, { loc: string; rear: boolean; points?: number }>(),
    internal: new Map<string, { loc: string; points?: number }>(),
}): CBTForceUnit {
    return {
        id: 'unit-1',
        load: async () => undefined,
        getUnit: () => unit,
        getCrewMembers: () => crewMembers,
        commander: () => false,
        getLocations: () => locationDamage,
        getCritSlots: () => critSlots,
        locations: loadedLocations,
    } as unknown as CBTForceUnit;
}

function createFakeClassicForce(unit: CBTForceUnit): CBTForce {
    return {
        gameSystem: GameSystem.CLASSIC,
        name: 'Ammo Test',
        units: () => [unit],
    } as unknown as CBTForce;
}

async function getSerializedMulEntity(unit: Unit, crewSlots: number): Promise<Element> {
    const crewMembers = Array.from({ length: crewSlots }, (_, index) => createFakeCrewMember(index));
    const xml = await serializeForceToMul(createFakeClassicForce(createFakeForceUnit(unit, [], crewMembers)));
    const doc = new DOMParser().parseFromString(xml, 'application/xml');
    return doc.querySelector('entity') as Element;
}

function createFakeDataService(units: Unit[]) {
    return {
        getUnits: () => units,
    } as any;
}

function mockLoadedCritSlots(getCritSlots: (unit: CBTForceUnit) => CriticalSlot[]): void {
    spyOn(CBTForceUnit.prototype, 'load').and.callFake(async function (this: CBTForceUnit) {
        this.locations = {
            armor: new Map([
                ['RT', { loc: 'RT', rear: false, points: 40 }],
                ['LT', { loc: 'LT', rear: false, points: 40 }],
            ]),
            internal: new Map([
                ['RT', { loc: 'RT', points: 20 }],
                ['LT', { loc: 'LT', points: 20 }],
            ]),
        };
        this.setCritSlots(getCritSlots(this), true);
        this.isLoaded.set(true);
    });
}

describe('MUL file utilities', () => {
    it('sanitizes force names for MUL filenames', () => {
        expect(sanitizeMulFilename(' Wolf\'s Dragoons: Alpha/Bravo? ')).toBe('Wolf\'s-Dragoons-AlphaBravo');
        expect(sanitizeMulFilename('   ')).toBe('mekbay-force');
    });

    it('writes every MegaMek CrewType token that can be represented by MekBay unit metadata', async () => {
        const cases: { expected: string; slots: number; overrides: Partial<Unit> }[] = [
            { expected: 'single', slots: 1, overrides: { type: 'Mek', subtype: 'BattleMek', moveType: 'Biped', crewSize: 1 } },
            { expected: 'crew', slots: 1, overrides: { type: 'Tank', subtype: 'Combat Vehicle', moveType: 'Tracked', crewSize: 1 } },
            { expected: 'vessel', slots: 1, overrides: { type: 'Aero', subtype: 'Spheroid DropShip', moveType: 'Spheroid', crewSize: 1 } },
            { expected: 'tripod', slots: 2, overrides: { type: 'Mek', subtype: 'Tripod BattleMek', moveType: 'Tripod', tons: 75, crewSize: 2 } },
            { expected: 'superheavy_tripod', slots: 3, overrides: { type: 'Mek', subtype: 'Tripod BattleMek', moveType: 'Tripod', tons: 100, crewSize: 3 } },
            { expected: 'quadvee', slots: 2, overrides: { type: 'Mek', subtype: 'QuadVee BattleMek', moveType: 'Quad', crewSize: 2 } },
            { expected: 'dual', slots: 2, overrides: { type: 'Mek', subtype: 'BattleMek', moveType: 'Biped', features: ['Dual Cockpit'], crewSize: 2 } },
            { expected: 'command_console', slots: 2, overrides: { type: 'Mek', subtype: 'BattleMek', moveType: 'Biped', features: ['Command Console'], crewSize: 2 } },
            { expected: 'infantry_crew', slots: 1, overrides: { type: 'Infantry', subtype: 'Conventional Infantry', moveType: 'Leg', crewSize: 1 } },
            { expected: 'none', slots: 0, overrides: { type: 'Handheld Weapon', subtype: 'Handheld Weapon', moveType: 'None', crewSize: 0 } },
        ];

        for (const crewTypeCase of cases) {
            const entity = await getSerializedMulEntity(createEmptyUnit({
                name: `CrewType_${crewTypeCase.expected}`,
                chassis: 'Crew Type',
                model: crewTypeCase.expected,
                ...crewTypeCase.overrides,
            }), crewTypeCase.slots);
            const pilot = entity.querySelector(':scope > pilot');
            const crew = entity.querySelector(':scope > crew');

            if (crewTypeCase.expected === 'single') {
                expect(pilot).withContext(crewTypeCase.expected).not.toBeNull();
                expect(crew).withContext(crewTypeCase.expected).toBeNull();
                continue;
            }

            expect(pilot).withContext(crewTypeCase.expected).toBeNull();
            expect(crew?.getAttribute('crewType')).withContext(crewTypeCase.expected).toBe(crewTypeCase.expected);
            expect(Array.from(crew?.querySelectorAll(':scope > crewMember') ?? []).map(member => Number(member.getAttribute('slot'))))
                .withContext(crewTypeCase.expected)
                .toEqual(Array.from({ length: crewTypeCase.slots }, (_, index) => index));
        }
    });

    it('imports a MUL as a Classic force after loading unit data', async () => {
        const atlas = createEmptyUnit({
            name: 'BMAtlas_AS7RS',
            chassis: 'Atlas',
            model: 'AS7-RS',
            armor: 160,
            internal: 80,
            moveType: 'Biped',
            techBase: 'Inner Sphere',
            comp: [
                { id: 'Incomplete Export Component', q: 1, n: 'Incomplete Export Component', t: 'C', p: 0 } as any,
                { id: 'IS Ammo AC/10', q: 1, q2: 10, n: 'AC/10 Ammo', t: 'X', p: 2, l: 'RT' },
            ],
            quirks: ['command_mech'],
        });
        mockLoadedCritSlots(() => [{
            id: 'IS Ammo AC/10@RT#4',
            name: 'IS Ammo AC/10',
            loc: 'RT',
            slot: 4,
            totalAmmo: 10,
        }]);
        const xml = `<?xml version="1.0" encoding="UTF-8"?>
<unit version="0.51.01">
    <entity chassis="Atlas" model="AS7-RS" type="Biped" commander="true" externalId="unit-1">
        <pilot size="1" name="Kayla" nick="" gender="FEMALE" clanperson="false" gunnery="3" piloting="4" externalId="pilot-1" ejected="false" autoeject="true"/>
        <location index="2"> Right Torso
            <armor points="Destroyed"/>
            <armor points="8" type="Internal"/>
            <slot index="5" type="IS Ammo AC/10" shots="4" isHit="true" isDestroyed="true"/>
        </location>
        <Game id="1"/>
    </entity>
</unit>`;

        const { force, issues } = await parseMulForce(xml, 'Imported Atlas', createFakeDataService([atlas]), {} as any, {} as any);
        const unit = force.units()[0];
        const crit = unit.getCritSlot('RT', 4);

        expect(issues).toEqual([]);
        expect(force.gameSystem).toBe(GameSystem.CLASSIC);
        expect(force.name).toBe('Imported Atlas');
        expect(unit.id).toBe('unit-1');
        expect(unit.getUnit().name).toBe('BMAtlas_AS7RS');
        expect(unit.commander()).toBeTrue();
        expect(unit.getCrewMember(0)).toEqual(jasmine.objectContaining({ name: 'Kayla' }));
        expect(unit.getCrewMember(0).getSkill('gunnery')).toBe(3);
        expect(unit.getCrewMember(0).getSkill('piloting')).toBe(4);
        expect(unit.getLocations()['RT'].armor).toBe(40);
        expect(unit.getLocations()['RT'].internal).toBe(12);
        expect(crit).toEqual(jasmine.objectContaining({
            name: 'IS Ammo AC/10',
            loc: 'RT',
            slot: 4,
            hits: 1,
            totalAmmo: 10,
            consumed: 6,
        }));
        expect(crit?.destroyed).toEqual(jasmine.any(Number));
    });

    it('imports destroyed locations as fully damaged armor and internals', async () => {
        const atlas = createEmptyUnit({
            name: 'BMAtlas_AS7RS',
            chassis: 'Atlas',
            model: 'AS7-RS',
            armor: 160,
            internal: 80,
            moveType: 'Biped',
            techBase: 'Inner Sphere',
        });
        mockLoadedCritSlots(() => []);
        const xml = `<?xml version="1.0" encoding="UTF-8"?>
<unit version="0.51.01">
    <entity chassis="Atlas" model="AS7-RS" type="Biped" commander="false" externalId="unit-1">
        <pilot size="1" name="" gunnery="4" piloting="5"/>
        <location index="3" isDestroyed="true" /> Left Torso
        <Game id="1"/>
    </entity>
</unit>`;

        const { force } = await parseMulForce(xml, 'Destroyed LT', createFakeDataService([atlas]), {} as any, {} as any);
        const locations = force.units()[0].getLocations();

        expect(locations['LT'].armor).toBe(40);
        expect(locations['LT'].internal).toBe(20);
    });

    it('writes destroyed locations when internals are fully damaged', async () => {
        const unit = createSerializedArmorUnit();
        const savedXml = await serializeForceToMul(createFakeClassicForce(createFakeForceUnit(unit, [], [createFakeCrewMember()], {
            LT: { armor: 40, internal: 20 },
        }, {
            armor: new Map([
                ['LT', { loc: 'LT', rear: false, points: 40 }],
            ]),
            internal: new Map([
                ['LT', { loc: 'LT', points: 20 }],
            ]),
        })));

        expect(savedXml).toContain('<location index="3" isDestroyed="true"> Left Torso');
        expect(savedXml).toContain('<armor points="Destroyed"/>');
        expect(savedXml).toContain('<armor points="Destroyed" type="Internal"/>');
    });

    it('reports unknown MUL units instead of creating unresolved force entries', async () => {
        const xml = `<?xml version="1.0" encoding="UTF-8"?>
<unit version="0.51.01">
    <entity chassis="Unknown" model="UNK-1" type="Biped" commander="false" externalId="unit-1">
        <pilot size="1" name="" gunnery="4" piloting="5"/>
        <Game id="1"/>
    </entity>
</unit>`;

        await expectAsync(parseMulForce(xml, 'Unknown', createFakeDataService([]), {} as any, {} as any)).toBeRejectedWithError(/not found/);
    });

    it('applies repeated MUL ammo slots by exact location slot', async () => {
        const unit = createSerializedAmmoUnit();
        mockLoadedCritSlots(() => [
            { id: 'IS Ammo AC/20@RT#4', name: 'IS Ammo AC/20', loc: 'RT', slot: 4, totalAmmo: 5 },
            { id: 'IS Ammo AC/20@RT#5', name: 'IS Ammo AC/20', loc: 'RT', slot: 5, totalAmmo: 10 },
            { id: 'IS Ammo AC/20@RT#6', name: 'IS Ammo AC/20', loc: 'RT', slot: 6, totalAmmo: 5 },
        ]);
        const xml = `<?xml version="1.0" encoding="UTF-8"?>
<unit version="0.51.01">
    <entity chassis="King Crab" model="KGC-0000" type="Biped" commander="false" externalId="unit-1">
        <pilot size="1" name="" gunnery="4" piloting="5"/>
        <location index="2"> Right Torso
            <slot index="5" type="IS Ammo AC/20" shots="4"/>
            <slot index="6" type="IS Ammo AC/20" shots="8"/>
            <slot index="7" type="IS Ammo AC/20" shots="3"/>
        </location>
        <Game id="1"/>
    </entity>
</unit>`;

        const { force } = await parseMulForce(xml, 'Round Robin', createFakeDataService([unit]), {} as any, {} as any);
        const crits = force.units()[0].getCritSlots();

        expect(crits.map(crit => crit.totalAmmo)).toEqual([5, 10, 5]);
        expect(crits.map(crit => crit.consumed)).toEqual([1, 2, 2]);
    });

    it('loads MUL ammo shots into consumed ammo and saves the same remaining count', async () => {
        const unit = createSerializedAmmoUnit();
        const xml = `<?xml version="1.0" encoding="UTF-8"?>
<unit version="0.51.01">
    <entity chassis="King Crab" model="KGC-0000" type="Biped" commander="false" externalId="unit-1">
        <pilot size="1" name="" gunnery="4" piloting="5"/>
        <location index="2"> Right Torso
            <slot index="5" type="IS Ammo AC/20" shots="1"/>
        </location>
        <location index="3"> Left Torso
            <slot index="6" type="IS Ammo LRM-15" shots="5"/>
            <slot index="7" type="IS Ammo AC/20" shots="3"/>
        </location>
        <Game id="1"/>
    </entity>
</unit>`;

        const parsedCrits: CriticalSlot[] = [
            { id: 'IS Ammo AC/20@RT#4', name: 'IS Ammo AC/20', loc: 'RT', slot: 4, totalAmmo: 5, consumed: 4 },
            { id: 'IS Ammo LRM-15@LT#5', name: 'IS Ammo LRM-15', loc: 'LT', slot: 5, totalAmmo: 8, consumed: 3 },
            { id: 'IS Ammo AC/20@LT#6', name: 'IS Ammo AC/20', loc: 'LT', slot: 6, totalAmmo: 5, consumed: 2 },
        ];

        const savedXml = await serializeForceToMul(createFakeClassicForce(createFakeForceUnit(unit, parsedCrits)));

        expect(savedXml).toContain('<slot index="5" type="IS Ammo AC/20" shots="1"/>');
        expect(savedXml).toContain('<slot index="6" type="IS Ammo LRM-15" shots="5"/>');
        expect(savedXml).toContain('<slot index="7" type="IS Ammo AC/20" shots="3"/>');
    });

    it('round-trips stripped armored slots without collapsing one armor hit into ordinary slot damage', async () => {
        const unit = createSerializedArmorUnit();
        const xml = `<?xml version="1.0" encoding="UTF-8"?>
<unit version="0.51.01">
    <entity chassis="Atlas" model="AS7-RS" type="Biped" commander="false" externalId="unit-1">
        <pilot size="1" name="" gunnery="4" piloting="5"/>
        <location index="2"> Right Torso
            <slot index="6" type="IS Large Laser" armorHit="true" isDestroyed="false"/>
        </location>
        <Game id="1"/>
    </entity>
</unit>`;

        const savedXml = await serializeForceToMul(createFakeClassicForce(createFakeForceUnit(unit, [{
            id: 'IS Large Laser@RT#5',
            name: 'IS Large Laser',
            loc: 'RT',
            slot: 5,
            armored: true,
            hits: 1,
        }])));

        expect(savedXml).toContain('<slot index="6" type="IS Large Laser" armorHit="true"/>');
        expect(savedXml).not.toContain('type="IS Large Laser" armorHit="true" isHit="true"');
    });

    it('round-trips modular armor damage points through damageTaken', async () => {
        const unit = createSerializedArmorUnit();
        const xml = `<?xml version="1.0" encoding="UTF-8"?>
<unit version="0.51.01">
    <entity chassis="Atlas" model="AS7-RS" type="Biped" commander="false" externalId="unit-1">
        <pilot size="1" name="" gunnery="4" piloting="5"/>
        <location index="2"> Right Torso
            <slot index="5" type="ISModularArmor" damageTaken="7" isDestroyed="false"/>
        </location>
        <Game id="1"/>
    </entity>
</unit>`;

        const savedXml = await serializeForceToMul(createFakeClassicForce(createFakeForceUnit(unit, [{
            id: 'ISModularArmor@RT#4',
            name: 'ISModularArmor',
            loc: 'RT',
            slot: 4,
            consumed: 7,
            eq: { flags: new Set(['F_MODULAR_ARMOR']) },
        } as CriticalSlot])));

        expect(savedXml).toContain('<slot index="5" type="ISModularArmor" damageTaken="7"/>');
    });
});
