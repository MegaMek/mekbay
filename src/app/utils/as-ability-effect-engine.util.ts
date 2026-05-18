import { AS_ABILITY_EFFECT_REGISTRY } from '../models/as-ability-effect-registry';
import type {
    ASAbilityCriticalHitContext,
    ASAbilityCriticalHitRollResolution,
    ASAbilityCriticalHitRollResultContext,
    ASAbilityEffectContext,
    ASAbilityEffectDefinition,
    ASAbilityEffectRef,
    ASAbilityRollModifierComment,
    ASAbilityMovementContext,
    ASAbilityMovementDisplayContext,
    ASMovementDisplayValue,
} from '../models/as-ability-effects.model';

export function asAbilityEffectRefKey(ref: ASAbilityEffectRef): string {
    return `${ref.source}:${ref.id}`;
}

const effectRegistry = new Map(
    AS_ABILITY_EFFECT_REGISTRY.map((effect) => [asAbilityEffectRefKey(effect.ref), effect])
);

export function hasRegisteredASAbilityEffect(ref: ASAbilityEffectRef): boolean {
    return effectRegistry.has(asAbilityEffectRefKey(ref));
}

export function resolveASAbilityEffects(refs: readonly ASAbilityEffectRef[]): ASAbilityEffectDefinition[] {
    const seen = new Set<string>();
    const effects: ASAbilityEffectDefinition[] = [];

    for (const ref of refs) {
        const key = asAbilityEffectRefKey(ref);
        if (seen.has(key)) {
            continue;
        }
        seen.add(key);

        const effect = effectRegistry.get(key);
        if (effect) {
            effects.push(effect);
        }
    }

    return effects.sort((left, right) => left.priority - right.priority);
}

export function applyHeatForPenaltiesEffects(
    effects: readonly ASAbilityEffectDefinition[],
    heat: number,
    context: ASAbilityEffectContext,
): number {
    return effects.reduce((currentHeat, effect) => {
        return effect.heat?.adjustHeatForPenalties?.(currentHeat, context) ?? currentHeat;
    }, heat);
}

export function applyShutdownThresholdEffects(
    effects: readonly ASAbilityEffectDefinition[],
    threshold: number,
    context: ASAbilityEffectContext,
): number {
    return effects.reduce((currentThreshold, effect) => {
        return effect.heat?.adjustShutdownThreshold?.(currentThreshold, context) ?? currentThreshold;
    }, threshold);
}

export function applyHeatTrackMaxEffects(
    effects: readonly ASAbilityEffectDefinition[],
    maxHeatLevel: number,
    context: ASAbilityEffectContext,
): number {
    return effects.reduce((currentMax, effect) => {
        return effect.heat?.adjustHeatTrackMax?.(currentMax, context) ?? currentMax;
    }, maxHeatLevel);
}

export function applyMovementInchesEffects(
    effects: readonly ASAbilityEffectDefinition[],
    inches: number,
    context: ASAbilityMovementContext,
): number {
    return effects.reduce((currentInches, effect) => {
        return effect.movement?.adjustMovementInches?.(currentInches, context) ?? currentInches;
    }, inches);
}

export function applyMovementDisplayEffects(
    effects: readonly ASAbilityEffectDefinition[],
    display: ASMovementDisplayValue,
    context: ASAbilityMovementDisplayContext,
): ASMovementDisplayValue {
    return effects.reduce((currentDisplay, effect) => {
        return effect.movement?.adjustMovementDisplay?.(currentDisplay, context) ?? currentDisplay;
    }, display);
}

export function applyCriticalHitCountEffects(
    effects: readonly ASAbilityEffectDefinition[],
    hits: number,
    context: ASAbilityCriticalHitContext,
): number {
    return effects.reduce((currentHits, effect) => {
        return effect.criticalHits?.adjustHitCount?.(currentHits, context) ?? currentHits;
    }, hits);
}

export function applyCriticalHitRollModifierEffects(
    effects: readonly ASAbilityEffectDefinition[],
    modifier: number,
    context: ASAbilityCriticalHitContext,
): number {
    return effects.reduce((currentModifier, effect) => {
        return effect.criticalHits?.adjustRollModifier?.(currentModifier, context) ?? currentModifier;
    }, modifier);
}

export function collectCriticalHitRollModifierCommentsEffects(
    effects: readonly ASAbilityEffectDefinition[],
    modifier: number,
    context: ASAbilityCriticalHitContext,
): ASAbilityRollModifierComment[] {
    const comments: ASAbilityRollModifierComment[] = [];
    let currentModifier = modifier;

    for (const effect of effects) {
        const nextModifier = effect.criticalHits?.adjustRollModifier?.(currentModifier, context) ?? currentModifier;
        const modifierDelta = nextModifier - currentModifier;
        if (modifierDelta !== 0) {
            const comment = effect.criticalHits?.describeRollModifier?.(modifierDelta, context);
            if (comment) {
                comments.push({ modifier: modifierDelta, comment });
            }
        }
        currentModifier = nextModifier;
    }

    return comments;
}

export function resolveCriticalHitRollResultEffects(
    effects: readonly ASAbilityEffectDefinition[],
    context: ASAbilityCriticalHitRollResultContext,
): ASAbilityCriticalHitRollResolution | undefined {
    for (const effect of effects) {
        const resolution = effect.criticalHits?.resolveRollResult?.(context);
        if (resolution) {
            return resolution;
        }
    }
    return undefined;
}