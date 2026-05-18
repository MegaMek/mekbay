import { createEmptyUnit } from '../testing/unit-test-helpers';
import type { ASAbilityEffectContext, ASAbilityEffectRef } from '../models/as-ability-effects.model';
import {
    applyCriticalHitCountEffects,
    applyHeatForPenaltiesEffects,
    applyHeatTrackMaxEffects,
    applyMovementDisplayEffects,
    applyMovementInchesEffects,
    applyShutdownThresholdEffects,
    hasRegisteredASAbilityEffect,
    resolveASAbilityEffects,
} from './as-ability-effect-engine.util';

describe('AS ability effect engine', () => {
    const unit = createEmptyUnit({ as: { TP: 'BM' } });

    function createContext(refs: readonly ASAbilityEffectRef[]): ASAbilityEffectContext {
        return {
            mode: 'committed',
            unit,
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
        })).toEqual({ baseInches: 4, adjustedInches: 5, note: '+1 points' });
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
});