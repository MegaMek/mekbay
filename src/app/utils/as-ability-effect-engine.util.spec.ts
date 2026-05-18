import { createEmptyUnit } from '../testing/unit-test-helpers';
import type { ASAbilityEffectContext, ASAbilityEffectRef } from '../models/as-ability-effects.model';
import {
    applyCriticalHitCountEffects,
    applyCriticalHitRollModifierEffects,
    applyHeatForPenaltiesEffects,
    applyHeatTrackMaxEffects,
    applyMovementDisplayEffects,
    applyMovementInchesEffects,
    applyShutdownThresholdEffects,
    hasRegisteredASAbilityEffect,
    resolveCriticalHitRollResultEffects,
    resolveASAbilityEffects,
} from './as-ability-effect-engine.util';

describe('AS ability effect engine', () => {
    const unit = createEmptyUnit({ as: { TP: 'BM' } });

    function createContext(refs: readonly ASAbilityEffectRef[], contextUnit = unit): ASAbilityEffectContext {
        return {
            mode: 'committed',
            unit: contextUnit,
            abilityRefs: refs,
        };
    }

    it('skips unknown ability refs without changing heat values', () => {
        const refs: ASAbilityEffectRef[] = [{ source: 'pilot', id: 'unknown_ability' }];
        const context = createContext(refs);
        const effects = resolveASAbilityEffects(refs);

        expect(effects).toEqual([]);
        expect(applyHeatForPenaltiesEffects(effects, 3, context)).toBe(3);
        expect(applyShutdownThresholdEffects(effects, 4, context)).toBe(4);
        expect(applyHeatTrackMaxEffects(effects, 3, context)).toBe(3);
    });

    it('resolves Hot Dog as a pilot heat effect', () => {
        const ref: ASAbilityEffectRef = { source: 'pilot', id: 'hot_dog' };
        const context = createContext([ref]);
        const effects = resolveASAbilityEffects([ref]);

        expect(hasRegisteredASAbilityEffect(ref)).toBeTrue();
        expect(effects.length).toBe(1);
        expect(applyHeatForPenaltiesEffects(effects, 4, context)).toBe(3);
        expect(applyShutdownThresholdEffects(effects, 4, context)).toBe(5);
        expect(applyHeatTrackMaxEffects(effects, 3, context)).toBe(4);
    });

    it('deduplicates repeated refs before applying effects', () => {
        const ref: ASAbilityEffectRef = { source: 'pilot', id: 'hot_dog' };
        const context = createContext([ref, ref]);
        const effects = resolveASAbilityEffects([ref, ref]);

        expect(effects.length).toBe(1);
        expect(applyHeatForPenaltiesEffects(effects, 4, context)).toBe(3);
        expect(applyShutdownThresholdEffects(effects, 4, context)).toBe(5);
    });

    it('applies Speed Demon as a movement display effect', () => {
        const ref: ASAbilityEffectRef = { source: 'pilot', id: 'speed_demon' };
        const context = createContext([ref]);
        const effects = resolveASAbilityEffects([ref]);

        expect(applyMovementDisplayEffects(effects, { baseInches: 6 }, {
            ...context,
            movementMode: '',
            displayKind: 'movement',
            isAerospace: false,
            isVehicle: false,
            isImmobilized: false,
        })).toEqual({ baseInches: 6, adjustedInches: 8 });

        expect(applyMovementDisplayEffects(effects, { baseInches: 4 }, {
            ...context,
            movementMode: 'a',
            displayKind: 'movement',
            isAerospace: true,
            isVehicle: false,
            isImmobilized: false,
        })).toEqual({ baseInches: 4, adjustedInches: 5 });
    });

    it('suppresses Speed Demon display bonuses when immobilized', () => {
        const ref: ASAbilityEffectRef = { source: 'pilot', id: 'speed_demon' };
        const context = createContext([ref]);
        const effects = resolveASAbilityEffects([ref]);

        expect(applyMovementDisplayEffects(effects, { baseInches: 6 }, {
            ...context,
            movementMode: '',
            displayKind: 'movement',
            isAerospace: false,
            isVehicle: false,
            isImmobilized: true,
        })).toEqual({ baseInches: 6 });
    });

    it('applies TSM as a ground movement value effect', () => {
        const ref: ASAbilityEffectRef = { source: 'asSpecial', id: 'TSM' };
        const context = createContext([ref]);
        const effects = resolveASAbilityEffects([ref]);

        expect(applyMovementInchesEffects(effects, -2, {
            ...context,
            movementMode: '',
            heat: 1,
            isAerospace: false,
            isVehicle: false,
            isImmobilized: false,
        })).toBe(2);

        expect(applyMovementInchesEffects(effects, 4, {
            ...context,
            movementMode: 'j',
            heat: 1,
            isAerospace: false,
            isVehicle: false,
            isImmobilized: false,
        })).toBe(4);
    });

    it('applies Hopper to the first MP critical hit count', () => {
        const ref: ASAbilityEffectRef = { source: 'pilot', id: 'hopper' };
        const context = createContext([ref]);
        const effects = resolveASAbilityEffects([ref]);

        expect(applyCriticalHitCountEffects(effects, 2, { ...context, key: 'mp' })).toBe(1);
        expect(applyCriticalHitCountEffects(effects, 2, { ...context, key: 'weapons' })).toBe(2);
    });

    it('applies Evasive Maneuver to fast combat vehicle motive damage rolls', () => {
        const ref: ASAbilityEffectRef = { source: 'pilot', id: 'evasive_maneuver' };
        const context = createContext([ref], createEmptyUnit({ as: { TP: 'CV', MVm: { '': 10 } } }));
        const effects = resolveASAbilityEffects([ref]);

        expect(applyCriticalHitRollModifierEffects(effects, 1, { ...context, key: 'motiveDamage' })).toBe(-1);
        expect(applyCriticalHitRollModifierEffects(effects, 1, { ...context, key: 'criticalHit' })).toBe(1);
    });

    it('does not apply Evasive Maneuver below 10 Move', () => {
        const ref: ASAbilityEffectRef = { source: 'pilot', id: 'evasive_maneuver' };
        const context = createContext([ref], createEmptyUnit({ as: { TP: 'CV', MVm: { '': 8 } } }));
        const effects = resolveASAbilityEffects([ref]);

        expect(applyCriticalHitRollModifierEffects(effects, 1, { ...context, key: 'motiveDamage' })).toBe(1);
    });

    it('applies Armored Motive System to motive damage rolls', () => {
        const ref: ASAbilityEffectRef = { source: 'asSpecial', id: 'ARS' };
        const context = createContext([ref]);
        const effects = resolveASAbilityEffects([ref]);

        expect(applyCriticalHitRollModifierEffects(effects, 0, { ...context, key: 'motiveDamage' })).toBe(-1);
        expect(applyCriticalHitRollModifierEffects(effects, 0, { ...context, key: 'criticalHit' })).toBe(0);
    });

    it('applies Critical Resistant to critical hit rolls', () => {
        const ref: ASAbilityEffectRef = { source: 'asSpecial', id: 'CR' };
        const context = createContext([ref]);
        const effects = resolveASAbilityEffects([ref]);

        expect(applyCriticalHitRollModifierEffects(effects, 0, { ...context, key: 'criticalHit' })).toBe(-2);
        expect(applyCriticalHitRollModifierEffects(effects, 0, { ...context, key: 'motiveDamage' })).toBe(0);
    });

    it('applies Impact Resistant Armor to critical hit rolls above the table', () => {
        const ref: ASAbilityEffectRef = { source: 'asSpecial', id: 'IRA' };
        const context = createContext([ref]);
        const effects = resolveASAbilityEffects([ref]);

        expect(applyCriticalHitRollModifierEffects(effects, 0, { ...context, key: 'criticalHit' })).toBe(1);
        expect(resolveCriticalHitRollResultEffects(effects, { ...context, key: 'criticalHit', roll: 13 })).toBe('engineHit');
        expect(resolveCriticalHitRollResultEffects(effects, { ...context, key: 'criticalHit', roll: 12 })).toBeUndefined();
        expect(resolveCriticalHitRollResultEffects(effects, { ...context, key: 'motiveDamage', roll: 13 })).toBeUndefined();
    });

    it('applies infantry cavalry movement bonuses only to eligible units', () => {
        const footRef: ASAbilityEffectRef = { source: 'pilot', id: 'foot_cavalry' };
        const lightRef: ASAbilityEffectRef = { source: 'pilot', id: 'light_horseman' };
        const footContext = createContext([footRef], createEmptyUnit({ as: { TP: 'CI', MVm: { f: 2 } } }));
        const beastContext = createContext([lightRef], createEmptyUnit({ chassis: 'Beast Infantry (Camel)', as: { TP: 'CI', MVm: { f: 4 } } }));

        expect(applyMovementInchesEffects(resolveASAbilityEffects([footRef]), 2, {
            ...footContext,
            movementMode: 'f',
            heat: 0,
            isAerospace: false,
            isVehicle: false,
            isImmobilized: false,
        })).toBe(4);
        expect(applyMovementInchesEffects(resolveASAbilityEffects([footRef]), 4, {
            ...beastContext,
            movementMode: 'f',
            heat: 0,
            isAerospace: false,
            isVehicle: false,
            isImmobilized: false,
        })).toBe(4);
        expect(applyMovementInchesEffects(resolveASAbilityEffects([lightRef]), 4, {
            ...beastContext,
            movementMode: 'f',
            heat: 0,
            isAerospace: false,
            isVehicle: false,
            isImmobilized: false,
        })).toBe(6);
    });

    it('applies Assault Operations to BattleMech ground movement', () => {
        const ref: ASAbilityEffectRef = { source: 'command', id: 'assault_operations' };
        const context = createContext([ref], createEmptyUnit({ as: { TP: 'BM', MVm: { '': 8 } } }));
        const effects = resolveASAbilityEffects([ref]);

        expect(applyMovementInchesEffects(effects, 8, {
            ...context,
            movementMode: '',
            heat: 0,
            isAerospace: false,
            isVehicle: false,
            isImmobilized: false,
        })).toBe(10);
        expect(applyMovementInchesEffects(effects, 8, {
            ...context,
            movementMode: 'j',
            heat: 0,
            isAerospace: false,
            isVehicle: false,
            isImmobilized: false,
        })).toBe(8);
    });
});