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
    formatVersion: 'v',
    groups: 'g',
    networks: 'n',
} as const;

export const AS_GROUP_FIELD = {
    instanceId: 'i',
    name: 'n',
    color: 'c',
    formationId: 'f',
    formationLock: 'l',
    formationTargetGroupId: 't',
    units: 'u',
} as const;

export const AS_UNIT_FIELD = {
    instanceId: 'i',
    catalogUuid: 'u',
    sourceHashCanary: 'h',
    alias: 'a',
    updatedTimestamp: 't',
    skill: 's',
    abilities: 'b',
    formationAbilities: 'f',
    commander: 'c',
    c3Position: 'c3',
    state: 'x',
} as const;

export const AS_STATE_FIELD = {
    modified: 'm',
    destroyed: 'd',
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
    formatVersion: 'v',
    revision: 'r',
    units: 'u',
    groups: 'g',
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
    instanceId: 'i',
    catalogUuid: 'e',
    sourceHashCanary: 'h',
    deployment: 'd',
    stateRevision: 'r',
    destroyed: 'x',
    locationState: 'l',
    locationConditions: 'n',
    slotState: 's',
    componentState: 'c',
    damageTrackState: 'q',
    ammoState: 'a',
    crewState: 'w',
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

export const CBT_ROSTER_GROUP_METADATA_FIELD = {
    name: 'n',
    color: 'c',
    formationId: 'f',
    targetGroupIndex: 't',
    formationLock: 'l',
} as const;

export const FORCE_LIST_ENTRY_INDEX = {
    revision: 0,
    instanceId: 1,
    timestamp: 2,
    system: 3,
    name: 4,
    groups: 5,
    metadata: 6,
} as const;

export const FORCE_LIST_FORMAT_VERSION = 2;

export const FORCE_LIST_SYSTEM_CODE = {
    classicBattleTech: 0,
    alphaStrike: 1,
} as const;

export const FORCE_LIST_METADATA_FIELD = {
    note: 'n',
    tags: 't',
    factionId: 'f',
    eraId: 'e',
    battleValue: 'b',
    pointValue: 'p',
    owned: 'o',
} as const;

export const FORCE_LIST_GROUP_INDEX = {
    units: 0,
    metadata: 1,
} as const;

export const FORCE_LIST_GROUP_METADATA_FIELD = {
    name: 'n',
    formationId: 'f',
} as const;

export const FORCE_LIST_UNIT_INDEX = {
    catalogUuid: 0,
    metadata: 1,
} as const;

export const FORCE_LIST_UNIT_METADATA_FIELD = {
    alias: 'a',
    alphaStrikeSkill: 's',
    gunnery: 'g',
    piloting: 'p',
    commander: 'c',
    destroyed: 'd',
} as const;
