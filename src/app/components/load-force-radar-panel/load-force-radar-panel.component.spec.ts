import { TestBed } from '@angular/core/testing';

import { GameSystem } from '../../models/common.model';
import { LoadForceEntry } from '../../models/load-force-entry.model';
import type { Unit } from '../../models/units.model';
import { DataService, type BucketStatSummary, type MinMaxStatsRange } from '../../services/data.service';
import { LoadForceRadarPanelComponent } from './load-force-radar-panel.component';

type MaxStatsOverride = {
    [Key in keyof MinMaxStatsRange]?: Partial<BucketStatSummary>;
};

function createBucketStatSummary(overrides: Partial<BucketStatSummary> = {}): BucketStatSummary {
    const min = overrides.min ?? 0;
    const max = overrides.max ?? 0;

    return {
        min,
        max,
        average: overrides.average ?? ((min + max) / 2),
        ...overrides,
    };
}

function createMaxStats(overrides: MaxStatsOverride): MinMaxStatsRange {
    const pick = <Key extends keyof MinMaxStatsRange>(key: Key): Partial<BucketStatSummary> | undefined => overrides[key];

    return {
        armor: createBucketStatSummary(pick('armor')),
        internal: createBucketStatSummary(pick('internal')),
        heat: createBucketStatSummary(pick('heat')),
        dissipation: createBucketStatSummary(pick('dissipation')),
        dissipationEfficiency: createBucketStatSummary(pick('dissipationEfficiency')),
        runMP: createBucketStatSummary(pick('runMP')),
        run2MP: createBucketStatSummary(pick('run2MP')),
        umuMP: createBucketStatSummary(pick('umuMP')),
        jumpMP: createBucketStatSummary(pick('jumpMP')),
        alphaNoPhysical: createBucketStatSummary(pick('alphaNoPhysical')),
        alphaNoPhysicalNoOneshots: createBucketStatSummary(pick('alphaNoPhysicalNoOneshots')),
        maxRange: createBucketStatSummary(pick('maxRange')),
        dpt: createBucketStatSummary(pick('dpt')),
        asTmm: createBucketStatSummary(pick('asTmm')),
        asArm: createBucketStatSummary(pick('asArm')),
        asStr: createBucketStatSummary(pick('asStr')),
        asDmgS: createBucketStatSummary(pick('asDmgS')),
        asDmgM: createBucketStatSummary(pick('asDmgM')),
        asDmgL: createBucketStatSummary(pick('asDmgL')),
        dropshipCapacity: createBucketStatSummary(pick('dropshipCapacity')),
        escapePods: createBucketStatSummary(pick('escapePods')),
        lifeBoats: createBucketStatSummary(pick('lifeBoats')),
        gravDecks: createBucketStatSummary(pick('gravDecks')),
        sailIntegrity: createBucketStatSummary(pick('sailIntegrity')),
        kfIntegrity: createBucketStatSummary(pick('kfIntegrity')),
    };
}

function createUnit(overrides: Partial<Unit>): Unit {
    return {
        id: 1,
        name: 'Unit',
        chassis: 'Unit',
        model: 'A',
        year: 3050,
        weightClass: 'Medium',
        tons: 50,
        offSpeedFactor: 0,
        bv: 0,
        pv: 0,
        cost: 0,
        level: 0,
        techBase: 'Inner Sphere',
        techRating: 'D',
        type: 'Mek',
        subtype: 'BattleMek',
        omni: 0,
        engine: 'Fusion',
        engineRating: 250,
        engineHS: 10,
        engineHSType: 'Heat Sink',
        source: [],
        role: 'Brawler',
        armorType: 'Standard',
        structureType: 'Standard',
        armor: 0,
        armorPer: 0,
        internal: 0,
        heat: 0,
        dissipation: 0,
        moveType: 'Biped',
        walk: 0,
        walk2: 0,
        run: 0,
        run2: 0,
        jump: 0,
        jump2: 0,
        umu: 0,
        c3: '',
        dpt: 0,
        comp: [],
        su: 0,
        crewSize: 1,
        quirks: [],
        features: [],
        icon: '',
        sheets: [],
        as: {
            TP: 'BM',
            PV: 0,
            SZ: 2,
            TMM: 0,
            usesOV: false,
            OV: 0,
            MV: '0',
            MVm: { '': 0 },
            usesTh: false,
            Th: 0,
            Arm: 0,
            Str: 0,
            specials: [],
            dmg: {
                dmgS: '0',
                dmgM: '0',
                dmgL: '0',
                dmgE: '0',
            },
            usesE: false,
            usesArcs: false,
        },
        _searchKey: '',
        _displayType: 'Mek',
        _maxRange: 0,
        _dissipationEfficiency: 0,
        _mdSumNoPhysical: 0,
        _mdSumNoPhysicalNoOneshots: 0,
        _nameTags: [],
        _chassisTags: [],
        ...overrides,
    };
}

describe('LoadForceRadarPanelComponent', () => {
    let subtypeMaxStats = new Map<string, MinMaxStatsRange>();
    let asTypeMaxStats = new Map<string, MinMaxStatsRange>();

    beforeEach(() => {
        subtypeMaxStats = new Map<string, MinMaxStatsRange>([
            ['BattleMek', createMaxStats({
                armor: { min: 10, max: 50 },
                internal: { min: 5, max: 12 },
                alphaNoPhysicalNoOneshots: { min: 4, max: 20 },
                dpt: { min: 3, max: 15 },
                run2MP: { min: 2, max: 9 },
                jumpMP: { min: 1, max: 7 },
            })],
            ['Industrial Mek', createMaxStats({
                armor: { min: 30, max: 95 },
                internal: { min: 18, max: 40 },
                alphaNoPhysicalNoOneshots: { min: 12, max: 60 },
                dpt: { min: 8, max: 28 },
                run2MP: { min: 8, max: 20 },
                jumpMP: { min: 4, max: 20 },
            })],
            ['Aerospace Fighter', createMaxStats({
                armor: { min: 18, max: 35 },
                internal: { min: 6, max: 11 },
                alphaNoPhysicalNoOneshots: { min: 6, max: 14 },
                dpt: { min: 4, max: 10 },
                run2MP: { min: 8, max: 12 },
                jumpMP: { min: 0, max: 0 },
            })],
        ]);
        asTypeMaxStats = new Map<string, MinMaxStatsRange>([
            ['BM', createMaxStats({
                asTmm: { min: 1, max: 4 },
                asArm: { min: 2, max: 5 },
                asStr: { min: 1, max: 4 },
                asDmgS: { min: 1, max: 4 },
                asDmgM: { min: 1, max: 3 },
                asDmgL: { min: 0, max: 2 },
            })],
            ['AF', createMaxStats({
                asTmm: { min: 2, max: 5 },
                asArm: { min: 1, max: 3 },
                asStr: { min: 1, max: 2 },
                asDmgS: { min: 1, max: 2 },
                asDmgM: { min: 2, max: 4 },
                asDmgL: { min: 3, max: 5 },
            })],
            ['PM', createMaxStats({
                asTmm: { min: 4, max: 6 },
                asArm: { min: 5, max: 8 },
                asStr: { min: 4, max: 6 },
                asDmgS: { min: 4, max: 6 },
                asDmgM: { min: 4, max: 6 },
                asDmgL: { min: 4, max: 6 },
            })],
        ]);

        TestBed.configureTestingModule({
            imports: [LoadForceRadarPanelComponent],
            providers: [
                {
                    provide: DataService,
                    useValue: {
                        getUnitSubtypeMaxStats: (subtype: string) => subtypeMaxStats.get(subtype) ?? createMaxStats({}),
                        getASUnitTypeMaxStats: (asUnitType: string) => asTypeMaxStats.get(asUnitType) ?? createMaxStats({}),
                    },
                },
            ],
        });
    });

    it('aggregates classic radar stats using global subtype maxima', () => {
        const fixture = TestBed.createComponent(LoadForceRadarPanelComponent);
        const mekA = createUnit({
            id: 1,
            name: 'Mek A',
            armor: 30,
            internal: 10,
            _mdSumNoPhysical: 8,
            _mdSumNoPhysicalNoOneshots: 9,
            dpt: 7,
            run2: 5,
            jump: 3,
        });
        const mekB = createUnit({
            id: 2,
            name: 'Mek B',
            armor: 15,
            internal: 5,
            _mdSumNoPhysical: 4,
            _mdSumNoPhysicalNoOneshots: 5,
            dpt: 3,
            run2: 2,
            jump: 2,
        });
        const aero = createUnit({
            id: 3,
            name: 'Aero B',
            type: 'Aero',
            subtype: 'Aerospace Fighter',
            moveType: 'Aerodyne',
            armor: 20,
            internal: 8,
            _mdSumNoPhysical: 12,
            _mdSumNoPhysicalNoOneshots: 13,
            dpt: 9,
            run2: 10,
            jump: 0,
        });

        fixture.componentRef.setInput('force', new LoadForceEntry({
            groups: [{
                units: [
                    { unit: mekA, destroyed: false },
                    { unit: mekB, destroyed: false },
                    { unit: aero, destroyed: false },
                ],
            }],
        }));
        fixture.detectChanges();

        const axes = fixture.componentInstance.chartAxes();
        const getAxis = (key: string) => axes.find((axis) => axis.key === key);

        expect(getAxis('mobility')).toEqual(jasmine.objectContaining({ value: 17, min: 11, max: 28 }));
        expect(getAxis('endurance')).toEqual(jasmine.objectContaining({ value: 88, min: 54, max: 170 }));
        expect(getAxis('firepower')).toEqual(jasmine.objectContaining({ value: 24, min: 14, max: 54 }));
        expect(getAxis('dpt')).toEqual(jasmine.objectContaining({ value: 19, min: 10, max: 40 }));
        expect(getAxis('mobility')?.ratio).toBeCloseTo(6 / 17, 6);
        expect(getAxis('endurance')?.ratio).toBeCloseTo(34 / 116, 6);
        expect(getAxis('firepower')?.ratio).toBeCloseTo(0.25, 6);
        expect(getAxis('dpt')?.ratio).toBeCloseTo(0.3, 6);
    });

    it('maps aggregated bucket averages to the midpoint ring', () => {
        const fixture = TestBed.createComponent(LoadForceRadarPanelComponent);
        const averageMekA = createUnit({
            id: 31,
            name: 'Average Mek A',
            dpt: 7,
        });
        const averageMekB = createUnit({
            id: 32,
            name: 'Average Mek B',
            dpt: 7,
        });

        subtypeMaxStats.set('BattleMek', createMaxStats({
            armor: { min: 10, max: 50 },
            internal: { min: 5, max: 12 },
            alphaNoPhysicalNoOneshots: { min: 4, max: 20 },
            dpt: { min: 3, average: 7, max: 15 },
            run2MP: { min: 2, max: 9 },
            jumpMP: { min: 1, max: 7 },
        }));

        fixture.componentRef.setInput('force', new LoadForceEntry({
            groups: [{
                units: [
                    { unit: averageMekA, destroyed: false },
                    { unit: averageMekB, destroyed: false },
                ],
            }],
        }));
        fixture.detectChanges();

        const dptAxis = fixture.componentInstance.chartAxes().find((axis) => axis.key === 'dpt');

        expect(dptAxis).toEqual(jasmine.objectContaining({
            value: 14,
            min: 6,
            average: 14,
            max: 30,
        }));
        expect(dptAxis?.ratio).toBeCloseTo(0.5, 6);
    });

    it('overlays hovered classic unit stats using that unit subtype range', () => {
        const fixture = TestBed.createComponent(LoadForceRadarPanelComponent);
        const mekA = createUnit({
            id: 7,
            name: 'Hover Mek',
            armor: 30,
            internal: 10,
            _mdSumNoPhysical: 8,
            _mdSumNoPhysicalNoOneshots: 9,
            dpt: 7,
            run2: 5,
            jump: 3,
        });
        const aero = createUnit({
            id: 8,
            name: 'Other Aero',
            type: 'Aero',
            subtype: 'Aerospace Fighter',
            moveType: 'Aerodyne',
            armor: 20,
            internal: 8,
            _mdSumNoPhysical: 12,
            _mdSumNoPhysicalNoOneshots: 13,
            dpt: 9,
            run2: 10,
            jump: 0,
        });

        fixture.componentRef.setInput('force', new LoadForceEntry({
            groups: [{
                units: [
                    { unit: mekA, destroyed: false },
                    { unit: aero, destroyed: false },
                ],
            }],
        }));
        fixture.componentRef.setInput('hoveredUnit', mekA);
        fixture.detectChanges();

        const axes = fixture.componentInstance.hoveredUnitAxes();
        const getAxis = (key: string) => axes.find((axis) => axis.key === key);

        expect(getAxis('mobility')).toEqual(jasmine.objectContaining({ value: 5, min: 2, max: 9 }));
        expect(getAxis('endurance')).toEqual(jasmine.objectContaining({ value: 40, min: 15, max: 62 }));
        expect(getAxis('firepower')).toEqual(jasmine.objectContaining({ value: 8, min: 4, max: 20 }));
        expect(getAxis('dpt')).toEqual(jasmine.objectContaining({ value: 7, min: 3, max: 15 }));
        expect(getAxis('mobility')?.ratio).toBeCloseTo(3 / 7, 6);
        expect(getAxis('endurance')?.ratio).toBeCloseTo(25 / 47, 6);
        expect(getAxis('firepower')?.ratio).toBeCloseTo(0.25, 6);
        expect(getAxis('dpt')?.ratio).toBeCloseTo(1 / 3, 6);
        expect(fixture.nativeElement.querySelectorAll('.radar-hover-node').length).toBe(4);
        const classicHoveredLabels = Array.from(fixture.nativeElement.querySelectorAll('.radar-label-value-hover')) as SVGTextElement[];

        expect(classicHoveredLabels.map((element) => element.textContent?.trim())).toEqual([
            '5/9',
            '40/62',
            '8/20',
            '7/15',
        ]);
    });

    it('uses the lower global subtype ceiling when jump and run are tied for a unit', () => {
        const fixture = TestBed.createComponent(LoadForceRadarPanelComponent);
        const tiedMobilityMek = createUnit({
            id: 4,
            name: 'Tie Mek',
            run2: 6,
            jump: 6,
        });
        fixture.componentRef.setInput('force', new LoadForceEntry({
            groups: [{
                units: [{ unit: tiedMobilityMek, destroyed: false }],
            }],
        }));
        fixture.detectChanges();

        const mobilityAxis = fixture.componentInstance.chartAxes().find((axis) => axis.key === 'mobility');

        expect(mobilityAxis).toEqual(jasmine.objectContaining({ value: 6, min: 1, max: 7 }));
        expect(mobilityAxis?.ratio).toBeCloseTo(5 / 6, 6);
    });

    it('aggregates Alpha Strike radar stats from global as.TP maxima', () => {
        const fixture = TestBed.createComponent(LoadForceRadarPanelComponent);

        const asMek = createUnit({
            id: 5,
            name: 'AS Mek',
            as: {
                TP: 'BM',
                PV: 34,
                SZ: 3,
                TMM: 2,
                usesOV: false,
                OV: 0,
                MV: '8j',
                MVm: { '': 8, j: 12 },
                usesTh: false,
                Th: 0,
                Arm: 4,
                Str: 3,
                specials: ['ECM', 'CASE'],
                dmg: {
                    dmgS: '3',
                    dmgM: '2',
                    dmgL: '1',
                    dmgE: '0',
                },
                usesE: false,
                usesArcs: false,
            },
        });
        const asAero = createUnit({
            id: 6,
            name: 'AS Aero',
            type: 'Aero',
            subtype: 'Aerospace Fighter',
            moveType: 'Aerodyne',
            as: {
                TP: 'AF',
                PV: 29,
                SZ: 2,
                TMM: 3,
                usesOV: false,
                OV: 0,
                MV: '16a',
                MVm: { a: 16 },
                usesTh: false,
                Th: 0,
                Arm: 2,
                Str: 1,
                specials: ['BOMB'],
                dmg: {
                    dmgS: '2',
                    dmgM: '3',
                    dmgL: '4',
                    dmgE: '0',
                },
                usesE: false,
                usesArcs: false,
            },
        });
        fixture.componentRef.setInput('force', new LoadForceEntry({
            type: GameSystem.ALPHA_STRIKE,
            groups: [{
                units: [
                    { unit: asMek, destroyed: false },
                    { unit: asAero, destroyed: false },
                ],
            }],
        }));
        fixture.detectChanges();

        const axes = fixture.componentInstance.chartAxes();
        const getAxis = (key: string) => axes.find((axis) => axis.key === key);

        expect(getAxis('mobility')).toEqual(jasmine.objectContaining({ value: 5, min: 3, max: 9 }));
        expect(getAxis('endurance')).toEqual(jasmine.objectContaining({ value: 10, min: 5, max: 14 }));
        expect(getAxis('shortRangeDamage')).toEqual(jasmine.objectContaining({ value: 5, min: 2, max: 6 }));
        expect(getAxis('mediumRangeDamage')).toEqual(jasmine.objectContaining({ value: 5, min: 3, max: 7 }));
        expect(getAxis('longRangeDamage')).toEqual(jasmine.objectContaining({ value: 5, min: 3, max: 7 }));
        expect(getAxis('mobility')?.ratio).toBeCloseTo(1 / 3, 6);
        expect(getAxis('endurance')?.ratio).toBeCloseTo(5 / 9, 6);
        expect(getAxis('shortRangeDamage')?.ratio).toBeCloseTo(0.75, 6);
        expect(getAxis('mediumRangeDamage')?.ratio).toBeCloseTo(0.5, 6);
        expect(getAxis('longRangeDamage')?.ratio).toBeCloseTo(0.5, 6);
    });

    it('overlays hovered Alpha Strike unit stats using that unit as.TP range', () => {
        const fixture = TestBed.createComponent(LoadForceRadarPanelComponent);

        const asMek = createUnit({
            id: 9,
            name: 'AS Hover Mek',
            as: {
                TP: 'BM',
                PV: 34,
                SZ: 3,
                TMM: 2,
                usesOV: false,
                OV: 0,
                MV: '8j',
                MVm: { '': 8, j: 12 },
                usesTh: false,
                Th: 0,
                Arm: 4,
                Str: 3,
                specials: ['ECM', 'CASE'],
                dmg: {
                    dmgS: '3',
                    dmgM: '2',
                    dmgL: '1',
                    dmgE: '0',
                },
                usesE: false,
                usesArcs: false,
            },
        });
        const asAero = createUnit({
            id: 10,
            name: 'AS Hover Aero',
            type: 'Aero',
            subtype: 'Aerospace Fighter',
            moveType: 'Aerodyne',
            as: {
                TP: 'AF',
                PV: 29,
                SZ: 2,
                TMM: 3,
                usesOV: false,
                OV: 0,
                MV: '16a',
                MVm: { a: 16 },
                usesTh: false,
                Th: 0,
                Arm: 2,
                Str: 1,
                specials: ['BOMB'],
                dmg: {
                    dmgS: '2',
                    dmgM: '3',
                    dmgL: '4',
                    dmgE: '0',
                },
                usesE: false,
                usesArcs: false,
            },
        });

        fixture.componentRef.setInput('force', new LoadForceEntry({
            type: GameSystem.ALPHA_STRIKE,
            groups: [{
                units: [
                    { unit: asMek, destroyed: false },
                    { unit: asAero, destroyed: false },
                ],
            }],
        }));
        fixture.componentRef.setInput('hoveredUnit', asAero);
        fixture.detectChanges();

        const axes = fixture.componentInstance.hoveredUnitAxes();
        const getAxis = (key: string) => axes.find((axis) => axis.key === key);

        expect(getAxis('mobility')).toEqual(jasmine.objectContaining({ value: 3, min: 2, max: 5 }));
        expect(getAxis('endurance')).toEqual(jasmine.objectContaining({ value: 3, min: 2, max: 5 }));
        expect(getAxis('shortRangeDamage')).toEqual(jasmine.objectContaining({ value: 2, min: 1, max: 2 }));
        expect(getAxis('mediumRangeDamage')).toEqual(jasmine.objectContaining({ value: 3, min: 2, max: 4 }));
        expect(getAxis('longRangeDamage')).toEqual(jasmine.objectContaining({ value: 4, min: 3, max: 5 }));
        expect(getAxis('mobility')?.ratio).toBeCloseTo(1 / 3, 6);
        expect(getAxis('endurance')?.ratio).toBeCloseTo(1 / 3, 6);
        expect(getAxis('shortRangeDamage')?.ratio).toBeCloseTo(1, 6);
        expect(getAxis('mediumRangeDamage')?.ratio).toBeCloseTo(0.5, 6);
        expect(getAxis('longRangeDamage')?.ratio).toBeCloseTo(0.5, 6);
        expect(fixture.nativeElement.querySelectorAll('.radar-hover-node').length).toBe(5);
        const alphaStrikeHoveredLabels = Array.from(fixture.nativeElement.querySelectorAll('.radar-label-value-hover')) as SVGTextElement[];

        expect(alphaStrikeHoveredLabels.map((element) => element.textContent?.trim())).toEqual([
            '3/5',
            '3/5',
            '2/2',
            '3/4',
            '4/5',
        ]);
    });

    it('maps hovered unit bucket averages to the midpoint ring', () => {
        const fixture = TestBed.createComponent(LoadForceRadarPanelComponent);
        const averageMek = createUnit({
            id: 33,
            name: 'Average Hover Mek',
            dpt: 7,
        });

        subtypeMaxStats.set('BattleMek', createMaxStats({
            armor: { min: 10, max: 50 },
            internal: { min: 5, max: 12 },
            alphaNoPhysicalNoOneshots: { min: 4, max: 20 },
            dpt: { min: 3, average: 7, max: 15 },
            run2MP: { min: 2, max: 9 },
            jumpMP: { min: 1, max: 7 },
        }));

        fixture.componentRef.setInput('force', new LoadForceEntry({
            groups: [{
                units: [{ unit: averageMek, destroyed: false }],
            }],
        }));
        fixture.componentRef.setInput('hoveredUnit', averageMek);
        fixture.detectChanges();

        const dptAxis = fixture.componentInstance.hoveredUnitAxes().find((axis) => axis.key === 'dpt');

        expect(dptAxis).toEqual(jasmine.objectContaining({
            value: 7,
            min: 3,
            average: 7,
            max: 15,
        }));
        expect(dptAxis?.ratio).toBeCloseTo(0.5, 6);
    });

    it('shows the empty state when the force has no resolvable units', () => {
        const fixture = TestBed.createComponent(LoadForceRadarPanelComponent);

        fixture.componentRef.setInput('force', new LoadForceEntry({
            groups: [{
                units: [{ unit: undefined, destroyed: false }],
            }],
        }));
        fixture.detectChanges();

        expect(fixture.componentInstance.hasUnits()).toBeFalse();
        expect(fixture.nativeElement.textContent).toContain('No units to chart.');
    });
});