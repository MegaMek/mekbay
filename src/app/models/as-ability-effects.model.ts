import type { Unit } from './units.model';

export type ASAbilityEffectSourceKind = 'pilot' | 'command' | 'asSpecial';

export type ASAbilityEffectScope =
    | 'unit'
    | 'attack'
    | 'movement'
    | 'scenario'
    | 'force'
    | 'manual';

export type ASAbilityEffectMode = 'committed' | 'preview' | 'previewNoHeat';

export interface ASAbilityEffectRef {
    readonly source: ASAbilityEffectSourceKind;
    readonly id: string;
}

export interface ASAbilityEffectContext {
    readonly mode: ASAbilityEffectMode;
    readonly unit: Unit;
    readonly abilityRefs: readonly ASAbilityEffectRef[];
}

export interface ASAbilityHeatHooks {
    readonly adjustHeatForPenalties?: (heat: number, context: ASAbilityEffectContext) => number;
    readonly adjustShutdownThreshold?: (threshold: number, context: ASAbilityEffectContext) => number;
    readonly adjustHeatTrackMax?: (maxHeatLevel: number, context: ASAbilityEffectContext) => number;
}

export interface ASAbilityMovementContext extends ASAbilityEffectContext {
    readonly movementMode: string;
    readonly heat: number;
    readonly isAerospace: boolean;
    readonly isVehicle: boolean;
    readonly isImmobilized: boolean;
}

export type ASMovementDisplayKind = 'movement' | 'sprint';

export interface ASMovementDisplayValue {
    readonly baseInches: number;
    readonly adjustedInches?: number;
    readonly note?: string;
}

export interface ASAbilityMovementDisplayContext extends ASAbilityEffectContext {
    readonly movementMode: string;
    readonly displayKind: ASMovementDisplayKind;
    readonly isAerospace: boolean;
    readonly isVehicle: boolean;
    readonly isImmobilized: boolean;
}

export interface ASAbilityMovementHooks {
    readonly adjustMovementInches?: (inches: number, context: ASAbilityMovementContext) => number;
    readonly adjustMovementDisplay?: (
        display: ASMovementDisplayValue,
        context: ASAbilityMovementDisplayContext,
    ) => ASMovementDisplayValue;
}

export interface ASAbilityCriticalHitContext extends ASAbilityEffectContext {
    readonly key: string;
}

export interface ASAbilityCriticalHitHooks {
    readonly adjustHitCount?: (hits: number, context: ASAbilityCriticalHitContext) => number;
}

export interface ASAbilityEffectDefinition {
    readonly ref: ASAbilityEffectRef;
    readonly scope: ASAbilityEffectScope;
    readonly priority: number;
    readonly heat?: ASAbilityHeatHooks;
    readonly movement?: ASAbilityMovementHooks;
    readonly criticalHits?: ASAbilityCriticalHitHooks;
    readonly manualNote?: string;
}