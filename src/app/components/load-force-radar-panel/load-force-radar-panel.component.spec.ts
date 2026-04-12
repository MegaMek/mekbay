import { TestBed } from '@angular/core/testing';

import { GameSystem } from '../../models/common.model';
import { LoadForceEntry } from '../../models/load-force-entry.model';
import type { Unit } from '../../models/units.model';
import { LoadForceRadarPanelComponent } from './load-force-radar-panel.component';

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
        TestBed.configureTestingModule({
            imports: [LoadForceRadarPanelComponent],
        });
    });

    it('aggregates stat totals and per-subtype maxima across the provided reference units', () => {
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
        const eligibleMek = createUnit({
            id: 4,
            name: 'Eligible BattleMek',
            armor: 50,
            internal: 12,
            _mdSumNoPhysicalNoOneshots: 20,
            dpt: 15,
            run2: 7,
            jump: 1,
        });
        const industrialMek = createUnit({
            id: 5,
            name: 'Industrial Mek',
            subtype: 'Industrial Mek',
            armor: 95,
            internal: 40,
            _mdSumNoPhysicalNoOneshots: 60,
            dpt: 28,
            run2: 16,
            jump: 10,
        });
        const eligibleAero = createUnit({
            id: 6,
            name: 'Eligible Aero',
            type: 'Aero',
            subtype: 'Aerospace Fighter',
            moveType: 'Aerodyne',
            armor: 35,
            internal: 11,
            _mdSumNoPhysicalNoOneshots: 14,
            dpt: 10,
            run2: 12,
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
        fixture.componentRef.setInput('referenceUnits', [mekA, mekB, aero, eligibleMek, industrialMek, eligibleAero]);
        fixture.detectChanges();

        const axes = fixture.componentInstance.chartAxes();
        const getAxis = (key: string) => axes.find((axis) => axis.key === key);

        expect(getAxis('armor')).toEqual(jasmine.objectContaining({ value: 65, max: 135 }));
        expect(getAxis('internal')).toEqual(jasmine.objectContaining({ value: 23, max: 35 }));
        expect(getAxis('firepower')).toEqual(jasmine.objectContaining({ value: 24, max: 54 }));
        expect(getAxis('dpt')).toEqual(jasmine.objectContaining({ value: 19, max: 40 }));
        expect(getAxis('mobility')).toEqual(jasmine.objectContaining({ value: 17, max: 22 }));
    });

    it('uses the lower reference ceiling when jump and run are tied for a unit', () => {
        const fixture = TestBed.createComponent(LoadForceRadarPanelComponent);
        const tiedMobilityMek = createUnit({
            id: 4,
            name: 'Tie Mek',
            run2: 6,
            jump: 6,
        });
        const fastRunner = createUnit({
            id: 5,
            name: 'Fast Runner',
            run2: 9,
            jump: 2,
        });
        const highJumper = createUnit({
            id: 6,
            name: 'High Jumper',
            run2: 4,
            jump: 7,
        });
        const industrialTieMek = createUnit({
            id: 7,
            name: 'Industrial Tie Mek',
            subtype: 'Industrial Mek',
            run2: 20,
            jump: 20,
        });

        fixture.componentRef.setInput('force', new LoadForceEntry({
            groups: [{
                units: [{ unit: tiedMobilityMek, destroyed: false }],
            }],
        }));
        fixture.componentRef.setInput('referenceUnits', [tiedMobilityMek, fastRunner, highJumper, industrialTieMek]);
        fixture.detectChanges();

        const mobilityAxis = fixture.componentInstance.chartAxes().find((axis) => axis.key === 'mobility');

        expect(mobilityAxis).toEqual(jasmine.objectContaining({ value: 6, max: 7 }));
    });

    it('aggregates Alpha Strike radar stats from the provided as.TP reference buckets', () => {
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
        const eligibleAsMek = createUnit({
            id: 7,
            name: 'Eligible AS Mek',
            as: {
                TP: 'BM',
                PV: 36,
                SZ: 3,
                TMM: 4,
                usesOV: false,
                OV: 0,
                MV: '10j',
                MVm: { '': 10, j: 14 },
                usesTh: false,
                Th: 0,
                Arm: 5,
                Str: 4,
                specials: ['TAG'],
                dmg: {
                    dmgS: '4',
                    dmgM: '3',
                    dmgL: '2',
                    dmgE: '0',
                },
                usesE: false,
                usesArcs: false,
            },
        });
        const protoBucketOutlier = createUnit({
            id: 8,
            name: 'Proto Bucket Outlier',
            type: 'Mek',
            subtype: 'BattleMek',
            as: {
                TP: 'PM',
                PV: 20,
                SZ: 1,
                TMM: 6,
                usesOV: false,
                OV: 0,
                MV: '12j',
                MVm: { '': 12, j: 18 },
                usesTh: false,
                Th: 0,
                Arm: 8,
                Str: 6,
                specials: [],
                dmg: {
                    dmgS: '6',
                    dmgM: '6',
                    dmgL: '6',
                    dmgE: '0',
                },
                usesE: false,
                usesArcs: false,
            },
        });
        const eligibleAsAero = createUnit({
            id: 9,
            name: 'Eligible AS Aero',
            type: 'Aero',
            subtype: 'Aerospace Fighter',
            moveType: 'Aerodyne',
            as: {
                TP: 'AF',
                PV: 31,
                SZ: 2,
                TMM: 5,
                usesOV: false,
                OV: 0,
                MV: '18a',
                MVm: { a: 18 },
                usesTh: false,
                Th: 0,
                Arm: 3,
                Str: 2,
                specials: ['BOMB'],
                dmg: {
                    dmgS: '2',
                    dmgM: '4',
                    dmgL: '5',
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
        fixture.componentRef.setInput('referenceUnits', [asMek, asAero, eligibleAsMek, protoBucketOutlier, eligibleAsAero]);
        fixture.detectChanges();

        const axes = fixture.componentInstance.chartAxes();
        const getAxis = (key: string) => axes.find((axis) => axis.key === key);

        expect(getAxis('mobility')).toEqual(jasmine.objectContaining({ value: 5, max: 9 }));
        expect(getAxis('endurance')).toEqual(jasmine.objectContaining({ value: 10, max: 14 }));
        expect(getAxis('shortRangeDamage')).toEqual(jasmine.objectContaining({ value: 5, max: 6 }));
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