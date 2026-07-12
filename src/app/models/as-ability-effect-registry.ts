import { isAerospaceMovementMode } from '../utils/as-common.util';
import type { ASAbilityEffectDefinition } from './as-ability-effects.model';
import type { Unit } from './units.model';


function isBeastMountedInfantry(unit: Unit): boolean {
    if (unit.as.TP !== 'CI') {
        return false;
    }
    return unit.chassis.includes('Beast Infantry');
}

function isFootInfantry(unit: Unit): boolean {
    return unit.as.TP === 'CI' && !isBeastMountedInfantry(unit);
}

export const AS_ABILITY_EFFECT_REGISTRY: readonly ASAbilityEffectDefinition[] = [
    {
        ref: { source: 'pilot', id: 'evasive_maneuver' },
        priority: 100,
        criticalHits: {
            adjustRollModifier: (modifier, context) => {
                if (context.key !== 'motiveDamage' || context.unit.as.TP !== 'CV') {
                    return modifier;
                }

                const baseMove = Math.max(
                    0,
                    ...Object.entries(context.unit.as.MVm ?? {})
                        .filter(([mode]) => !isAerospaceMovementMode(mode))
                        .map(([, inches]) => typeof inches === 'number' ? inches : 0),
                );

                return baseMove >= 10 ? modifier - 2 : modifier;
            },
            describeRollModifier: () => 'Evasive Maneuver reduces motive damage rolls for fast combat vehicles.',
        },
    },
    {
        ref: { source: 'pilot', id: 'hot_dog' },
        priority: 100,
        heat: {
            adjustHeatForPenalties: (heat) => Math.max(0, heat - 1),
            adjustShutdownThreshold: (threshold) => threshold + 1,
            adjustHeatTrackMax: (maxHeatLevel) => Math.max(maxHeatLevel, 4),
        },
    },
    {
        ref: { source: 'pilot', id: 'hopper' },
        priority: 100,
        criticalHits: {
            adjustHitCount: (hits, context) => context.key === 'mp' ? Math.max(0, hits - 1) : hits,
        },
    },
    {
        ref: { source: 'pilot', id: 'foot_cavalry' },
        priority: 100,
        movement: {
            adjustMovementInches: (inches, context) => {
                if (context.movementMode !== 'f' || inches <= 0 || !isFootInfantry(context.unit)) {
                    return inches;
                }
                return inches + 2;
            },
        },
    },
    {
        ref: { source: 'pilot', id: 'light_horseman' },
        priority: 100,
        movement: {
            adjustMovementInches: (inches, context) => {
                if (inches <= 0 || !isBeastMountedInfantry(context.unit)) {
                    return inches;
                }
                return inches + 2;
            },
        },
    },
    {
        ref: { source: 'pilot', id: 'speed_demon' },
        priority: 100,
        movement: {
            adjustMovementDisplay: (display, context) => {
                if (context.isImmobilized || display.baseInches <= 0) {
                    return display;
                }

                if (context.isAerospace) {
                    return {
                        ...display,
                        adjustedInches: display.baseInches + 1
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
        ref: { source: 'special', id: 'ARS' },
        priority: 100,
        criticalHits: {
            adjustRollModifier: (modifier, context) => context.key === 'motiveDamage' ? modifier - 1 : modifier,
            describeRollModifier: () => 'Armored Motive System reduces motive damage rolls.',
        },
    },
    {
        ref: { source: 'special', id: 'CR' },
        priority: 100,
        criticalHits: {
            adjustRollModifier: (modifier, context) => context.key === 'criticalHit' ? modifier - 2 : modifier,
            describeRollModifier: () => 'Critical Resistant reduces critical hit rolls.',
        },
    },
    {
        ref: { source: 'special', id: 'IRA' },
        priority: 100,
        criticalHits: {
            adjustRollModifier: (modifier, context) => context.key === 'criticalHit' ? modifier + 1 : modifier,
            describeRollModifier: () => 'Impact Resistant Armor increases critical hit rolls.',
            resolveRollResult: (context) => {
                if (context.key !== 'criticalHit' || context.roll <= 12) {
                    return undefined;
                }
                return 'engineHit';
            },
        },
    },
    {
        ref: { source: 'special', id: 'TSM' },
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
    {
        ref: { source: 'command', id: 'assault_operations' },
        priority: 100,
        movement: {
            adjustMovementInches: (inches, context) => {
                if (context.movementMode !== '' || inches <= 0 || context.unit.as.TP !== 'BM') {
                    return inches;
                }
                return inches + 2;
            },
        },
    },
];