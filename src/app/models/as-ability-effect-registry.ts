import type { ASAbilityEffectDefinition } from './as-ability-effects.model';

export const AS_ABILITY_EFFECT_REGISTRY: readonly ASAbilityEffectDefinition[] = [
    {
        ref: { source: 'pilot', id: 'hot_dog' },
        scope: 'unit',
        priority: 100,
        heat: {
            adjustHeatForPenalties: (heat) => Math.max(0, heat - 1),
            adjustShutdownThreshold: (threshold) => threshold + 1,
            adjustHeatTrackMax: (maxHeatLevel) => Math.max(maxHeatLevel, 4),
        },
    },
    {
        ref: { source: 'pilot', id: 'hopper' },
        scope: 'unit',
        priority: 100,
        criticalHits: {
            adjustHitCount: (hits, context) => context.key === 'mp' ? Math.max(0, hits - 1) : hits,
        },
    },
    {
        ref: { source: 'pilot', id: 'speed_demon' },
        scope: 'movement',
        priority: 100,
        movement: {
            adjustMovementDisplay: (display, context) => {
                if (context.isImmobilized || display.baseInches <= 0) {
                    return display;
                }

                if (context.isAerospace) {
                    return {
                        ...display,
                        adjustedInches: display.baseInches + 1,
                        note: '+1 points',
                    };
                }

                const bonus = context.displayKind === 'sprint' ? 4 : 2;
                return {
                    ...display,
                    adjustedInches: display.baseInches + bonus,
                };
            },
        },
    },
    {
        ref: { source: 'asSpecial', id: 'TSM' },
        scope: 'movement',
        priority: 100,
        movement: {
            adjustMovementInches: (inches, context) => {
                if (context.movementMode !== '' || context.heat < 1) {
                    return inches;
                }
                return inches + (context.heat === 1 ? 4 : 2);
            },
        },
    },
];