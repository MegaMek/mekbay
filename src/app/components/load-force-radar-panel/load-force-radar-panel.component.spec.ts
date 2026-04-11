import { TestBed } from '@angular/core/testing';

import { GameSystem } from '../../models/common.model';
import { LoadForceEntry } from '../../models/load-force-entry.model';
import type { Unit } from '../../models/units.model';
import { DataService, type MinMaxStatsRange } from '../../services/data.service';
import { LoadForceRadarPanelComponent } from './load-force-radar-panel.component';

function createMaxStats(overrides: Partial<MinMaxStatsRange>): MinMaxStatsRange {
    return {
        armor: [0, 0],
        internal: [0, 0],
        heat: [0, 0],
        dissipation: [0, 0],
        dissipationEfficiency: [0, 0],
        runMP: [0, 0],
        run2MP: [0, 0],
        umuMP: [0, 0],
        jumpMP: [0, 0],
        alphaNoPhysical: [0, 0],
        alphaNoPhysicalNoOneshots: [0, 0],
        maxRange: [0, 0],
        dpt: [0, 0],
        asTmm: [0, 0],
        asArm: [0, 0],
        asStr: [0, 0],
        asDmgS: [0, 0],
        asDmgM: [0, 0],
        asDmgL: [0, 0],
        dropshipCapacity: [0, 0],
        escapePods: [0, 0],
        lifeBoats: [0, 0],
        sailIntegrity: [0, 0],
        kfIntegrity: [0, 0],
        ...overrides,
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
    beforeEach(() => {
        const maxStatsByType = new Map<string, MinMaxStatsRange>([
            ['Mek', createMaxStats({
                armor: [0, 60],
                internal: [0, 20],
                alphaNoPhysicalNoOneshots: [0, 25],
                dpt: [0, 20],
                run2MP: [0, 12],
                jumpMP: [0, 8],
                asTmm: [0, 4],
                asArm: [0, 7],
                asStr: [0, 5],
                asDmgS: [0, 4],
                asDmgM: [0, 3],
                asDmgL: [0, 2],
            })],
            ['Aero', createMaxStats({
                armor: [0, 40],
                internal: [0, 12],
                alphaNoPhysicalNoOneshots: [0, 18],
                dpt: [0, 14],
                run2MP: [0, 20],
                jumpMP: [0, 2],
                asTmm: [0, 5],
                asArm: [0, 4],
                asStr: [0, 3],
                asDmgS: [0, 3],
                asDmgM: [0, 4],
                asDmgL: [0, 5],
            })],
        ]);

        TestBed.configureTestingModule({
            imports: [LoadForceRadarPanelComponent],
            providers: [
                {
                    provide: DataService,
                    useValue: {
                        getUnitTypeMaxStats: (type: string) => maxStatsByType.get(type) ?? createMaxStats({}),
                    },
                },
            ],
        });
    });

    it('aggregates stat totals and per-type maxima across the provided force', () => {
        const fixture = TestBed.createComponent(LoadForceRadarPanelComponent);
        const mekA = createUnit({
            id: 1,
            name: 'Mek A',
            armor: 30,
            internal: 10,
            _mdSumNoPhysical: 8,
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

        expect(getAxis('armor')).toEqual(jasmine.objectContaining({ value: 65, max: 160 }));
        expect(getAxis('internal')).toEqual(jasmine.objectContaining({ value: 23, max: 52 }));
        expect(getAxis('firepower')).toEqual(jasmine.objectContaining({ value: 24, max: 68 }));
        expect(getAxis('dpt')).toEqual(jasmine.objectContaining({ value: 19, max: 54 }));
        expect(getAxis('mobility')).toEqual(jasmine.objectContaining({ value: 17, max: 40 }));
    });

    it('uses the lower reference ceiling when jump and run are tied for a unit', () => {
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

        expect(mobilityAxis).toEqual(jasmine.objectContaining({ value: 6, max: 8 }));
    });

    it('aggregates Alpha Strike radar stats from AlphaStrikeUnitStats and their matching maxima', () => {
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

        expect(getAxis('mobility')).toEqual(jasmine.objectContaining({ value: 5, max: 9 }));
        expect(getAxis('endurance')).toEqual(jasmine.objectContaining({ value: 10, max: 19 }));
        expect(getAxis('shortRangeDamage')).toEqual(jasmine.objectContaining({ value: 5, max: 7 }));
        expect(getAxis('mediumRangeDamage')).toEqual(jasmine.objectContaining({ value: 5, max: 7 }));
        expect(getAxis('longRangeDamage')).toEqual(jasmine.objectContaining({ value: 5, max: 7 }));
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