// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

/**
 * Semantic names for the compact V2 force-storage wire.
 *
 * Keep these maps as vocabulary only: the owning codecs still validate all
 * untrusted values. Literal wire fixtures intentionally do not use them so
 * tests continue to prove the exact serialized shape.
 */

export const FORCE_PAYLOAD_FIELD = {
    alphaStrike: 'a',
    classicBattleTech: 'cbt',
} as const;

export const AS_FORCE_FIELD = {
    networks: 'n',
} as const;

export const AS_STATE_FIELD = {
    formationAbilities: 'f',
    c3Position: 'c3',
    modified: 'm',
    conditions: 'c',
    heat: 'h',
    armor: 'a',
    internal: 'i',
    criticals: 'r',
    physicalCriticals: 'q',
    consumed: 'u',
    exhausted: 'e',
} as const;

export const AS_NETWORK_FIELD = {
    instanceId: 'i',
    type: 'y',
    color: 'c',
    peerIds: 'p',
    masterId: 'm',
    masterComponentIndex: 'x',
    members: 'r',
} as const;

export const CBT_FORCE_FIELD = {
    revision: 'r',
    history: 'h',
    encounter: 'e',
} as const;

export const CBT_HISTORY_FIELD = {
    unitIds: 'u',
    turns: 't',
} as const;

export const CBT_HISTORY_TURN_FIELD = {
    turnNumber: 'n',
    phases: 'p',
} as const;

/** Compact replacement for verbose history mutation-target strings. */
export const CBT_HISTORY_MUTATION_TARGET_CODE = {
    committed: 0,
    pending: 1,
} as const;

export const CBT_ENCOUNTER_NETWORK_INDEX = {
    instanceId: 0,
    type: 1,
    color: 2,
    endpoints: 3,
} as const;

export const CBT_ENCOUNTER_ENDPOINT_INDEX = {
    unit: 0,
    componentId: 1,
    role: 2,
} as const;

export const CBT_UNIT_FAMILY = {
    mek: 'm',
    nonMekEntity: 'e',
} as const;

export const CBT_UNIT_FIELD = {
    family: 'k',
    entityType: 't',
    deployment: 'd',
    stateRevision: 'r',
    locationState: 'l',
    locationConditions: 'n',
    slotState: 's',
    componentState: 'c',
    damageTrackState: 'q',
    ammoState: 'a',
    heat: 'z',
    ruleChecks: 'rC',
    movementPsr: 'm',
    equipmentRowOrder: 'y',
    conditions: 'o',
    c3Position: 'c3',
    mekTurn: 't',
    nonMekTurn: 'v',
    pendingCombat: 'p',
} as const;

export const CBT_EQUIPMENT_ROW_ORDER_FIELD = {
    ranged: 'r',
    physical: 'p',
} as const;

export const CBT_DEPLOYMENT_METADATA_FIELD = {
    id: 'i',
    initialHeat: 'h',
} as const;

export const CBT_COMPONENT_STATE_FIELD = {
    status: 's',
    mode: 'm',
    jammed: 'j',
    escalatingFailure: 'e',
    ppcCapacitor: 'p',
    bombastLaser: 'b',
    c3EmergencyMaster: 'c',
    gaussPower: 'g',
    shieldDamage: 'h',
    modularArmorDamage: 'r',
} as const;

export const CBT_PPC_CAPACITOR_FIELD = {
    weaponId: 'w',
    chargeState: 'c',
    firedThisTurn: 'f',
} as const;

export const CBT_BOMBAST_LASER_FIELD = {
    chargeState: 'c',
    firedThisTurn: 'f',
} as const;

export const CBT_C3_EMERGENCY_MASTER_FIELD = {
    mode: 'm',
    operatingTurns: 't',
} as const;

export const CBT_HEAT_FIELD = {
    current: 'c',
    previous: 'p',
    pendingOverride: 'o',
    heatsinksOff: 's',
} as const;

export const CBT_MOVEMENT_FIELD = {
    movement: 'm',
    action: 'a',
    standAttempts: 's',
    carefulStand: 'c',
    damageThisPhase: 'd',
    checks: 'k',
    automaticFalls: 'f',
} as const;

export const CBT_MOVEMENT_DECLARATION_INDEX = {
    mode: 0,
    distance: 1,
    boosterComponentIds: 2,
} as const;

export const CBT_MOVEMENT_SOURCE_FIELD = {
    sourceKind: 's',
    triggerKind: 't',
    witness: 'w',
    criticalSlotIds: 'c',
    locationIds: 'l',
    baseTarget: 'b',
    triggerModifier: 'm',
} as const;

export const CBT_TURN_FIELD = {
    turnCounter: 'n',
    airborne: 'a',
    cover: 'c',
    weaponsHeat: 'w',
    acknowledgedHeatSources: 'h',
    heatDissipationConsumed: 'd',
    spotting: 's',
    phaseStateChanged: 'e',
    endTurnCheckpoint: 'p',
    pendingFallConsequences: 'f',
    pendingCriticalEvents: 'q',
} as const;

export const CBT_PENDING_COMBAT_FIELD = {
    locationDamage: 'l',
    locationConditions: 'n',
    slotHits: 's',
    componentStatus: 'c',
    shieldDamage: 'h',
    modularArmorDamage: 'm',
} as const;

export const CBT_NON_MEK_PENDING_COMBAT_FIELD = {
    internalDamage: 'l',
    armorDamage: 'a',
    componentStatus: 'c',
    damageTrackHits: 'q',
} as const;
