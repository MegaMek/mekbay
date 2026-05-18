import { Injector, provideZonelessChangeDetection } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import type { DataService } from '../services/data.service';
import type { UnitInitializerService } from '../services/unit-initializer.service';
import { createEmptyUnit } from '../testing/unit-test-helpers';
import type { ASForce } from './as-force.model';
import { ASForceUnit } from './as-force-unit.model';
import type { Unit } from './units.model';

describe('ASForceUnit ability effects', () => {
    let injector: Injector;

    beforeEach(() => {
        TestBed.configureTestingModule({
            providers: [provideZonelessChangeDetection()],
        });
        injector = TestBed.inject(Injector);
    });

    function createForceUnit(unit: Unit = createTestUnit()): ASForceUnit {
        const force = {
            owned: () => true,
            emitChanged: jasmine.createSpy('emitChanged'),
            groups: () => [],
        } as unknown as ASForce;

        return new ASForceUnit(
            unit,
            force,
            {} as DataService,
            {} as UnitInitializerService,
            injector,
        );
    }

    function createTestUnit(overrides: Parameters<typeof createEmptyUnit>[0] = {}): Unit {
        const { as: asOverrides, ...unitOverrides } = overrides;
        return createEmptyUnit({
            type: 'Mek',
            subtype: 'BattleMek',
            ...unitOverrides,
            as: {
                TP: 'BM',
                SZ: 3,
                PV: 30,
                TMM: 1,
                MVm: { '': 8 },
                Arm: 5,
                Str: 3,
                usesOV: true,
                OV: 1,
                ...asOverrides,
            },
        });
    }

    it('keeps default heat behavior without Hot Dog', () => {
        const forceUnit = createForceUnit();
        forceUnit.getState().heat.set(4);

        expect(forceUnit.shutdownHeatThreshold()).toBe(4);
        expect(forceUnit.heatTrackLevels()).toEqual([0, 1, 2, 3]);
        expect(forceUnit.heatToHitModifier()).toBe(4);
        expect(forceUnit.isShutdown()).toBeTrue();
    });

    it('sets only ground movement to 0 while shutdown', () => {
        const forceUnit = createForceUnit(createTestUnit({
            as: { MVm: { '': 8, a: 10 }, specials: ['TSM'] },
        }));
        forceUnit.setPilotAbilities(['speed_demon']);
        forceUnit.getState().heat.set(4);

        expect(forceUnit.isShutdown()).toBeTrue();
        expect(forceUnit.effectiveMovement()).toEqual({ '': 0, a: 10 });
        expect(forceUnit.movementDisplayValue('', 0)).toEqual({ baseInches: 0 });
    });

    it('preserves aerospace thrust while heat shutdown', () => {
        const forceUnit = createForceUnit(createTestUnit({
            type: 'Aero',
            subtype: 'Aerospace Fighter',
            as: { TP: 'AF', MVm: { a: 4 } },
        }));
        forceUnit.getState().heat.set(4);

        expect(forceUnit.isShutdown()).toBeTrue();
        expect(forceUnit.effectiveMovement()).toEqual({ a: 4 });
    });

    it('applies Hot Dog through generic heat effect APIs', () => {
        const forceUnit = createForceUnit();
        forceUnit.setPilotAbilities(['hot_dog']);
        forceUnit.getState().heat.set(4);

        expect(forceUnit.shutdownHeatThreshold()).toBe(5);
        expect(forceUnit.heatTrackLevels()).toEqual([0, 1, 2, 3, 4]);
        expect(forceUnit.effectiveHeatForPenalties()).toBe(3);
        expect(forceUnit.heatToHitModifier()).toBe(3);
        expect(forceUnit.isShutdown()).toBeFalse();
        expect(forceUnit.effectiveMovement()).toEqual({ '': 2 });
    });

    it('shuts down a Hot Dog unit at heat 5', () => {
        const forceUnit = createForceUnit();
        forceUnit.setPilotAbilities(['hot_dog']);
        forceUnit.getState().heat.set(5);

        expect(forceUnit.isShutdown()).toBeTrue();
    });

    it('applies formation-granted Hot Dog like a manual pilot ability', () => {
        const forceUnit = createForceUnit();
        forceUnit.setFormationAbilities(['hot_dog'], false);
        forceUnit.getState().heat.set(4);

        expect(forceUnit.shutdownHeatThreshold()).toBe(5);
        expect(forceUnit.effectiveHeatForPenalties()).toBe(3);
        expect(forceUnit.isShutdown()).toBeFalse();
    });

    it('uses preview heat for pending Hot Dog shutdown and movement', () => {
        const forceUnit = createForceUnit();
        forceUnit.setPilotAbilities(['hot_dog']);
        forceUnit.getState().heat.set(4);
        forceUnit.setPendingHeat(1);

        expect(forceUnit.previewShutdown()).toBeTrue();
        expect(forceUnit.previewMovement()).toEqual({ '': 0 });
    });

    it('sets preview movement to 0 when pending heat causes shutdown', () => {
        const forceUnit = createForceUnit(createTestUnit({
            as: { MVm: { '': 8, a: 10 } },
        }));
        forceUnit.getState().heat.set(3);
        forceUnit.setPendingHeat(1);

        expect(forceUnit.previewShutdown()).toBeTrue();
        expect(forceUnit.previewMovement()).toEqual({ '': 0, a: 10 });
        expect(forceUnit.previewMovementNoHeat()).toEqual({ '': 8, a: 10 });
    });

    it('preserves current Hot Dog and TSM heat ordering', () => {
        const forceUnit = createForceUnit(createTestUnit({ as: { specials: ['TSM'] } }));
        forceUnit.setPilotAbilities(['hot_dog']);
        forceUnit.getState().heat.set(2);

        expect(forceUnit.effectiveHeatForPenalties()).toBe(1);
        expect(forceUnit.effectiveMovement()).toEqual({ '': 10 });
    });

    it('applies TSM movement through AS special ability effects', () => {
        const forceUnit = createForceUnit(createTestUnit({ as: { specials: ['TSM'] } }));

        forceUnit.getState().heat.set(1);
        expect(forceUnit.effectiveMovement()).toEqual({ '': 10 });

        forceUnit.getState().heat.set(2);
        expect(forceUnit.effectiveMovement()).toEqual({ '': 6 });
    });

    it('shows Speed Demon ground movement and sprint as alternate display values', () => {
        const forceUnit = createForceUnit(createTestUnit({ as: { MVm: { '': 6 } } }));
        forceUnit.setPilotAbilities(['speed_demon']);

        expect(forceUnit.movementDisplayValue('', 6)).toEqual({ baseInches: 6, adjustedInches: 8 });
        expect(forceUnit.movementDisplayValue('', 9, 'sprint')).toEqual({ baseInches: 9, adjustedInches: 13 });
        expect(forceUnit.effectiveTmm()).toEqual({ '': 1 });
    });

    it('shows formation-granted Speed Demon like a manual pilot ability', () => {
        const forceUnit = createForceUnit(createTestUnit({ as: { MVm: { '': 6 } } }));
        forceUnit.setFormationAbilities(['speed_demon'], false);

        expect(forceUnit.movementDisplayValue('', 6)).toEqual({ baseInches: 6, adjustedInches: 8 });
    });

    it('shows Speed Demon aerospace thrust with a point-cost note', () => {
        const forceUnit = createForceUnit(createTestUnit({
            type: 'Aero',
            subtype: 'Aerospace Fighter',
            as: { TP: 'AF', MVm: { a: 4 } },
        }));
        forceUnit.setPilotAbilities(['speed_demon']);

        expect(forceUnit.movementDisplayValue('a', 4)).toEqual({
            baseInches: 4,
            adjustedInches: 5,
        });
    });

    it('does not show Speed Demon movement bonuses while immobilized', () => {
        const forceUnit = createForceUnit(createTestUnit({ as: { MVm: { '': 6 } } }));
        forceUnit.setPilotAbilities(['speed_demon']);
        forceUnit.getState().heat.set(4);

        expect(forceUnit.isImmobilized()).toBeTrue();
        expect(forceUnit.movementDisplayValue('', 6)).toEqual({ baseInches: 6 });
    });

    it('applies Hopper to MP critical hits before movement and TMM calculations', () => {
        const forceUnit = createForceUnit();
        forceUnit.setPilotAbilities(['hopper']);
        forceUnit.getState().crits.set([{ key: 'mp', timestamp: 1 }]);

        expect(forceUnit.effectiveMovement()).toEqual({ '': 8 });
        expect(forceUnit.effectiveTmm()).toEqual({ '': 1 });

        forceUnit.getState().crits.set([{ key: 'mp', timestamp: 1 }, { key: 'mp', timestamp: 2 }]);
        expect(forceUnit.effectiveMovement()).toEqual({ '': 4 });
        expect(forceUnit.effectiveTmm()).toEqual({ '': 0 });
    });

    it('applies Evasive Maneuver to fast combat vehicle motive damage rolls', () => {
        const forceUnit = createForceUnit(createTestUnit({
            type: 'Tank',
            subtype: 'Combat Vehicle',
            as: { TP: 'CV', MVm: { '': 10 } },
        }));
        forceUnit.setPilotAbilities(['evasive_maneuver']);

        expect(forceUnit.criticalHitRollModifier('motiveDamage', 1)).toBe(-1);
    });

    it('does not apply Evasive Maneuver to slower combat vehicles', () => {
        const forceUnit = createForceUnit(createTestUnit({
            type: 'Tank',
            subtype: 'Combat Vehicle',
            as: { TP: 'CV', MVm: { '': 8 } },
        }));
        forceUnit.setPilotAbilities(['evasive_maneuver']);

        expect(forceUnit.criticalHitRollModifier('motiveDamage', 1)).toBe(1);
    });

    it('applies Armored Motive System to motive damage rolls', () => {
        const forceUnit = createForceUnit(createTestUnit({
            type: 'Tank',
            subtype: 'Combat Vehicle',
            as: { TP: 'CV', MVm: { '': 8 }, specials: ['ARS'] },
        }));

        expect(forceUnit.criticalHitRollModifier('motiveDamage', 0)).toBe(-1);
        expect(forceUnit.criticalHitRollModifier('criticalHit', 0)).toBe(0);
    });

    it('applies critical hit roll modifiers from AS special ability effects', () => {
        const forceUnit = createForceUnit(createTestUnit({
            as: { specials: ['CR', 'IRA'] },
        }));

        expect(forceUnit.criticalHitRollModifier('criticalHit', 0)).toBe(-1);
        expect(forceUnit.criticalHitRollModifier('motiveDamage', 0)).toBe(0);
        expect(forceUnit.criticalHitRollResolution('criticalHit', 13)).toBe('engineHit');
        expect(forceUnit.criticalHitRollResolution('criticalHit', 12)).toBeUndefined();
    });

    it('applies Foot Cavalry to conventional foot infantry movement', () => {
        const forceUnit = createForceUnit(createTestUnit({
            type: 'Infantry',
            subtype: 'Conventional Infantry',
            chassis: 'Infantry',
            as: { TP: 'CI', MVm: { f: 2 } },
        }));
        forceUnit.setPilotAbilities(['foot_cavalry']);

        expect(forceUnit.effectiveMovement()).toEqual({ f: 4 });
    });

    it('does not apply Foot Cavalry to beast-mounted infantry', () => {
        const forceUnit = createForceUnit(createTestUnit({
            type: 'Infantry',
            subtype: 'Conventional Infantry',
            chassis: 'Beast Infantry (Camel)',
            as: { TP: 'CI', MVm: { f: 4 } },
        }));
        forceUnit.setPilotAbilities(['foot_cavalry']);

        expect(forceUnit.effectiveMovement()).toEqual({ f: 4 });
    });

    it('applies Light Horseman to beast-mounted infantry movement', () => {
        const forceUnit = createForceUnit(createTestUnit({
            type: 'Infantry',
            subtype: 'Conventional Infantry',
            chassis: 'Beast Infantry (Camel)',
            as: { TP: 'CI', MVm: { f: 4 } },
        }));
        forceUnit.setPilotAbilities(['light_horseman']);

        expect(forceUnit.effectiveMovement()).toEqual({ f: 6 });
    });

    it('applies formation-granted Assault Operations to BattleMech ground movement', () => {
        const forceUnit = createForceUnit(createTestUnit({ as: { TP: 'BM', MVm: { '': 8, j: 8 } } }));
        forceUnit.setFormationAbilities(['assault_operations'], false);

        expect(forceUnit.effectiveMovement()).toEqual({ '': 10, j: 8 });
    });
});