// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { extname, join, relative, resolve } from 'node:path';

const root = resolve(__dirname, '..');
const app = join(root, 'src', 'app');

function filesBelow(directory: string): string[] {
    return readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
        const path = join(directory, entry.name);
        return entry.isDirectory() ? filesBelow(path) : extname(path) === '.ts' ? [path] : [];
    });
}

function source(path: string): string {
    return readFileSync(path, 'utf8');
}

function display(path: string): string {
    return relative(root, path).replaceAll('\\', '/');
}

const deletedPaths = [
    'src/app/models/runtime/mek-publication-context.ts',
    'src/app/models/runtime/combat-transaction-v2.ts',
    'src/app/models/runtime/combat-transaction-v2.spec.ts',
    'src/app/models/runtime/component-interaction-authority.ts',
    'src/app/models/runtime/mek-c3-network-v2.ts',
    'src/app/models/runtime/mek-damage-lifecycle-runtime.ts',
    'src/app/models/runtime/mek-heat-recovery-capability-v2.ts',
    'src/app/models/runtime/mek-mechanics-recovery-capability-v2.ts',
    'src/app/models/runtime/unit-runtime-port.ts',
    'src/app/models/runtime/mek-crew-profile.ts',
    'src/app/models/cbt-force-unit.model.ts',
    'src/app/models/cbt-force-unit-state.model.ts',
    'src/app/models/cbt-force-api.ts',
    'src/app/utils/java-string-compat.ts',
    'src/app/services/entity-editor-session.service.ts',
    'src/app/services/mek-editor-workspace.service.ts',
    'src/app/services/force-member-query.ts',
    'src/app/services/force-member-projection.service.ts',
    'src/app/models/rules/vehicle-motive-hit.util.ts',
    'src/app/models/runtime/entity-unit-instance.ts',
    'src/app/models/runtime/ready-entity-unit.ts',
    'src/app/models/runtime/ready-classic-unit.ts',
    'src/app/models/runtime/ready-non-mek-unit.ts',
    'src/app/models/runtime/ready-unit-factory.ts',
    'src/app/models/runtime/mek-interaction-command-token.ts',
    'src/app/models/runtime/classic-unit-runtime.ts',
    'src/app/models/runtime/c3-operational-network.ts',
    'src/app/models/runtime/entity-runtime-index.ts',
    'src/app/models/runtime/component-bap.ts',
    'src/app/models/force-unit-state.model.ts',
    'src/app/services/as-force-unit-loading.service.ts',
    'src/app/components/force-loading-overlay/force-loading-overlay.component.ts',
    'scripts/audit-v1-force-corpus.ts',
];
for (const path of deletedPaths) {
    assert.equal(existsSync(join(root, path)), false, `${path} must stay deleted`);
}

const requiredCompatibilityAndOraclePaths = [
    'scripts/compare-entity-output.ts',
    'scripts/compare-unit-output.ts',
    'scripts/verify-entity-roundtrip.ts',
    'src/app/models/runtime/legacy-force-v1-converter.ts',
];
for (const path of requiredCompatibilityAndOraclePaths) {
    assert.equal(existsSync(join(root, path)), true, `${path} is a required compatibility/oracle surface`);
}

const production = filesBelow(app).filter(path => !path.endsWith('.spec.ts'));
const facadeFiles = production.filter(path =>
    /(?:^|[-_.])facade(?:[-_.]|$)/iu.test(display(path)));
assert.deepEqual(facadeFiles.map(display), [], 'facade files must stay deleted');

const forbidden = /\b(?:PublishedEntity|PublishedMek|EntityBlueprint|immutablePublication|canonicalJson|assertNoDuplicateJsonKeys|javaCaseFoldKey|convertLegacyV1|movementPsrRecovery|movementHeatFallback|discard-mek-movement-psr-recovery|ForceMemberProjectionService|queryForceMembers|queryForceGroupMembers|cbtForceV2State|V2UnitRuntimePort|UnitRuntimePort|MekDamageLifecycleRuntime|InMemoryCombatTransactionCoordinatorV2|CBTForceUnit)\b|entity\/blueprint/u;
const offenders = production.filter(path => forbidden.test(source(path)));
assert.deepEqual(
    offenders.map(display),
    [],
    'production must not recreate the discarded published/blueprint/canonicalization layers',
);

const readyUnit = source(join(app, 'models', 'runtime', 'cbt-mek-unit.ts'));
assert.match(readyUnit, /private readonly entity: MekEntity;/u);
assert.match(readyUnit, /public getUnit\(\): MekEntity\s*\{\s*return this\.entity;/u);

const unitInstance = source(join(app, 'models', 'runtime', 'unit-instance.ts'));
assert.match(unitInstance, /readonly entity: MekEntity;/u);
assert.match(unitInstance, /#state: MekUnitRuntimeState;/u);
assert.doesNotMatch(unitInstance, /MountedEquipment|SVGElement|querySelector|document\./u);
assert.doesNotMatch(unitInstance, /legacy|Legacy|migrateLegacy|recovery evidence/u);

const baseline = source(join(app, 'models', 'runtime', 'runtime-state.ts'));
assert.match(baseline, /readonly entity: UnitUuid;/u);
assert.doesNotMatch(baseline, /readonly published:/u);

const force = source(join(app, 'models', 'force.model.ts'));
assert.doesNotMatch(force, /cbtForceV2State/u);
assert.match(force, /public readonly members = computed<ForceMember\[\]>/u);
assert.doesNotMatch(
    force,
    /deserializeForceUnit|sanitizeForceData|populateFromGroupedSerialized|public static deserialize/u,
    'the shared Force model must not expose deserialization dispatch or compatibility hooks',
);
assert.doesNotMatch(
    force,
    /createForceUnit|prepareCreatedForceUnit|createCompatibleUnit|transferPilotData|flushPendingChanges|cancelPendingChanges|getDeferredUnitDescriptors|public clone\(\)|public setUnits\(|public loadAll\(/u,
    'Alpha Strike construction and obsolete lifecycle APIs must not leak into the shared Force model',
);

const forceUnit = source(join(app, 'models', 'force-unit.model.ts'));
assert.match(forceUnit, /export interface ForceUnit/u);
assert.doesNotMatch(
    forceUnit,
    /abstract class ForceUnit|\bisLoaded\b|\bload\(\)|static deserialize|must be implemented by subclass|\bdestroy\(|isComputedCondition|hasComputedCondition|phaseTrigger|\bsetC3Position\(|applyC3PositionFromOwnerTransaction/u,
    'the shared ForceUnit contract must not recreate obsolete inheritance, deferred loading, deserialization, lifecycle, computed-condition, or standalone C3 seams',
);
assert.match(forceUnit, /export const applyForceUnitOwnerC3Position = Symbol/u);
assert.match(force, /setC3ConfigurationIfOwnerRevisionCurrent\([\s\S]*ForceOwnerRevisionFence/u);
assert.doesNotMatch(force, /setC3ConfigurationIfWholeOwnerAuthorityCurrent/u);

const asForce = source(join(app, 'models', 'as-force.model.ts'));
assert.match(asForce, /private populateFromSerialized\(data: ASSerializedForce\): readonly string\[\]/u);
assert.doesNotMatch(
    asForce,
    /deserializeForceUnit|sanitizeForceData|populateFromGroupedSerialized|deferredUnitDescriptors|addDeferredUnitDescriptor|getDeferredUnitDescriptors/u,
    'Alpha Strike must not retain a non-persisted deferred-unit sidecar',
);

const cbtForce = source(join(app, 'models', 'cbt-force.model.ts'));
const cbtUnitStore = source(join(app, 'models', 'cbt-unit-store.ts'));
const cbtC3 = source(join(app, 'models', 'cbt-force-c3.ts'));
const memberRegistry = source(join(app, 'models', 'runtime', 'cbt-force-member-registry.ts'));
const runtimeJournal = source(join(app, 'models', 'runtime', 'cbt-force-runtime-journal.ts'));
assert.match(cbtUnitStore, /interface CBTUnitStoreState\s*\{\s*readonly envelope: SerializedCBTForceV2;/u);
assert.match(cbtForce, /private readonly unitStore = new CBTUnitStore\(\);/u);
assert.match(cbtForce, /private readonly memberRegistry = new CBTForceMemberRegistry/u);
assert.match(cbtForce, /private readonly runtimeJournal = new CBTForceRuntimeJournal/u);
assert.match(cbtForce, /return this\.unitStore\.envelope\(\);/u);
assert.doesNotMatch(cbtForce, /CBTForceUnitStore|memberProjection|runtimeCommands/u);
assert.match(cbtForce, /export class CBTForce extends Force<never>/u);
assert.doesNotMatch(
    cbtForce,
    /createForceUnit|transferPilotData|removeEmptyGroups/u,
    'Classic must not implement Alpha Strike-only operations with throwing or empty overrides',
);
assert.doesNotMatch(
    cbtForce,
    /deserializeForceUnit|sanitizeForceData|populateFromGroupedSerialized|getDeferredUnitDescriptors/u,
    'current Classic forces must not expose grouped-force deserialization hooks',
);
assert.match(cbtForce, /replaceC3EncounterNetworksIfOwnerRevisionCurrent\([\s\S]*ForceOwnerRevisionFence/u);
assert.doesNotMatch(cbtForce, /public replaceC3EncounterNetworks\(/u);
assert.match(cbtForce, /public getRuntimeInstanceIds\(\): readonly string\[\]/u);
assert.match(cbtForce, /public async admitRetainedUnit\(/u);
assert.doesNotMatch(
    cbtForce,
    /\b(?:getMekRuntimeInstanceIds|updateMekGroup|reorderMekGroup|removeMekGroup|admitRetainedMekV2)\b/u,
);
assert.doesNotMatch(cbtForce, /CBT_SERIALIZED_FORCE_SCHEMA|Sanitizer\.sanitize/u);
assert.ok(cbtForce.split(/\r?\n/u).length < 2600, 'CBTForce must not regrow into a 5000-line god class');
assert.ok(cbtUnitStore.split(/\r?\n/u).length < 1700, 'CBTUnitStore must remain focused');
assert.match(cbtC3, /export class CBTForceC3/u);
assert.match(memberRegistry, /no BV result/u);
assert.match(runtimeJournal, /Sole owner of session-only checkpoints/u);
assert.doesNotMatch(runtimeJournal, /encounter|Encounter/u, 'C3 topology must stay outside runtime undo');
assert.doesNotMatch(
    [cbtForce, cbtUnitStore, cbtC3, memberRegistry].join('\n'),
    /UnitBattleValueCacheEntry|TagBattleValueCache|WeakMap/u,
    'force BV must not grow cache entries or object-key caches',
);
assert.doesNotMatch(
    cbtForce,
    /groups:\s*_legacyGroups|c3Networks:\s*_legacyNetworks/u,
    'the current Classic writer must not strip V1 topology after serialization',
);
assert.doesNotMatch(
    [cbtForce, cbtUnitStore].join('\n'),
    /MekHeatCommand|MekHeatInteraction|HeatCommandToken|dispatchHeatCommand|heatInteractions/u,
    'the disconnected heat-command facade and its token DTOs must not return',
);

const readyClassic = source(join(app, 'models', 'runtime', 'cbt-unit.ts'));
assert.match(readyClassic, /export interface CBTUnit/u);
assert.doesNotMatch(readyClassic, /endTurn\([^)]*MekHeatAutomationPolicyV2/u);
const readyMek = source(join(app, 'models', 'runtime', 'cbt-mek-unit.ts'));
const readyNonMek = source(join(app, 'models', 'runtime', 'cbt-non-mek-unit.ts'));
assert.match(readyMek, /class CBTMekUnit implements CBTUnit/u);
assert.match(readyNonMek, /class CBTNonMekUnit implements CBTUnit/u);
const nonMekRuntime = source(join(app, 'models', 'runtime', 'non-mek-unit-instance.ts'));
assert.match(nonMekRuntime, /NonMekEntityType = Exclude<EntityType, 'Mek'>/u);
assert.match(nonMekRuntime, /export class NonMekUnitInstance/u);
assert.match(nonMekRuntime, /private readonly entity: BaseEntity/u);
assert.match(nonMekRuntime, /this\.entity\.battleValueFor\(this\.stateView\(\), this\.ruleset\)/u);
assert.doesNotMatch(nonMekRuntime, /ForceUnit|Facade|Published/u);

const directCatalogModeReaders = production
    .filter(path => /\b(?:equipment|weapon)\.modes\b/u.test(source(path)))
    .map(display)
    .sort();
assert.deepEqual(
    directCatalogModeReaders,
    [
        'src/app/models/rapid-fire-autocannon-mode.model.ts',
        'src/app/models/stealth-equipment.model.ts',
    ],
    'catalog modes are inert metadata and may only be interpreted by explicit behavior owners',
);
assert.doesNotMatch(
    source(join(app, 'models', 'equipment.model.ts')),
    /\bhasMode\(/u,
    'Equipment must not expose a generic catalog-mode behavior API',
);

const unitSnapshot = source(join(app, 'models', 'cbt-unit-snapshot.ts'));
const classicRuntime = source(join(app, 'models', 'runtime', 'cbt-unit-runtime.ts'));
assert.match(unitSnapshot, /export interface CBTUnitSnapshot/u);
assert.doesNotMatch(unitSnapshot, /export interface CBTMekUnitSnapshot|CBTEntityUnitSnapshot|readonly kind:/u);
assert.match(unitSnapshot, /entity: BaseEntity/u);
assert.match(unitSnapshot, /Critical slots and critical-hit state[\s\S]*hasMekRuntime/u);
assert.doesNotMatch(classicRuntime, /CriticalSlotId|readonly slots:|readonly destroyed:/u);
assert.match(nonMekRuntime, /readonly explicitlyDestroyed: boolean/u);
assert.doesNotMatch(nonMekRuntime, /readonly slots:|readonly criticalHits:/u);

const forceBv = source(join(app, 'models', 'cbt-force-battle-value.ts'));
assert.match(cbtC3, /projectOperationalC3Networks\(/u);
assert.doesNotMatch(
    forceBv,
    /projectOperationalC3Networks\(/u,
    'force BV must not duplicate C3 endpoint eligibility outside the tax calculator',
);
assert.match(forceBv, /new C3TaxCalculator\(/u);
assert.match(forceBv, /isC3EndpointOperational:[\s\S]*isIntact\(/u);
assert.match(forceBv, /adjustEntityBattleValueForSkills\(/u);
assert.doesNotMatch(
    forceBv,
    /BVCalculatorUtil|calculateAdjustedBV\(\s*row\.summary/u,
    'admitted-unit BV skill rules must use the loaded Entity, never UnitSummary',
);

const motiveModes = source(join(app, 'models', 'motiveModes.model.ts'));
const equipmentRuntimeController = source(join(
    app,
    'components',
    'equipment-dialog',
    'equipment-dialog-runtime.controller.ts',
));
const turnSummary = source(join(
    app,
    'components',
    'page-viewer',
    'overlay',
    'page-turn-summary-panel.component.ts',
));
const turnTrackerControls = source(join(
    app,
    'components',
    'page-viewer',
    'overlay',
    'turn-tracker-controls.ts',
));
const turnSummaryTemplate = source(join(
    app,
    'components',
    'page-viewer',
    'overlay',
    'page-turn-summary-panel.component.html',
));
const tacticalView = source(join(app, 'components', 'tactical-view', 'tactical-view.component.ts'));
const tacticalViewTemplate = source(join(app, 'components', 'tactical-view', 'tactical-view.component.html'));
const tacticalTurnTracker = source(join(
    app,
    'components',
    'tactical-view',
    'tactical-turn-tracker.component.ts',
));
const tacticalTurnTrackerTemplate = source(join(
    app,
    'components',
    'tactical-view',
    'tactical-turn-tracker.component.html',
));
const crewTransfer = source(join(app, 'services', 'force-crew-transfer.service.ts'));
assert.doesNotMatch(motiveModes, /unit-summary\.model|\bUnitSummary\b/u);
assert.doesNotMatch(
    [equipmentRuntimeController, turnTrackerControls].join('\n'),
    /(?:canChangeAirborneGround|getMotiveModeLabel|getMotiveModesByUnit)\([^\n]*\.summary/u,
    'admitted-unit movement choices and labels must use loaded Entity facts',
);
assert.doesNotMatch(
    crewTransfer,
    /getEffectivePilotingSkill|\.summary/u,
    'Classic crew transfer must derive fixed skill rules from the loaded Entity',
);
assert.doesNotMatch(
    turnSummaryTemplate,
    /move-allowance|moveModeAllowance/u,
    'the record-sheet turn summary must not present Tactical View movement allowances',
);
assert.match(tacticalTurnTrackerTemplate, /move-allowance/u);
assert.match(tacticalTurnTrackerTemplate, /moveModeAllowance\(mode\)/u);
assert.match(turnTrackerControls, /export abstract class TurnTrackerControls/u);
assert.match(turnSummary, /PageTurnSummaryPanelComponent extends TurnTrackerControls/u);
assert.match(tacticalTurnTracker, /TacticalTurnTrackerComponent extends TurnTrackerControls/u);
assert.doesNotMatch(tacticalView, /PageTurnSummaryPanelComponent/u);
assert.doesNotMatch(tacticalViewTemplate, /page-turn-summary-panel|\[embedded\]/u);
assert.match(tacticalViewTemplate, /<tactical-turn-tracker/u);

const commandSession = source(join(app, 'models', 'runtime', 'runtime-command-session.ts'));
assert.match(commandSession, /interface RuntimeCommandCheckpoint\s*\{\s*readonly units:/u);
assert.doesNotMatch(commandSession, /encounter/u);

const forceSerialization = source(join(app, 'models', 'force-serialization.ts'));
assert.doesNotMatch(
    forceSerialization,
    /CBTSerialized|CBT_SERIALIZED|SerializedLegacyCriticalSlotV1|SerializedTurnState/u,
    'grouped Classic deserialization must stay out of the current force serialization model',
);

assert.doesNotMatch(
    forceSerialization,
    /ViewportTransform|conditionIsActive|conditionsHasActive|conditionsHasCommittedActive|committedConditionData/u,
    'force serialization must not retain unrelated UI types or unused condition helpers',
);
assert.doesNotMatch(
    forceSerialization,
    /export const (?:FORCE_TAG_MAX_(?:LENGTH|COUNT)|AS_(?:CRITICAL_HIT|CUSTOM_PILOT_ABILITY|SERIALIZED_GROUP)_SCHEMA)/u,
    'implementation details must not be exported solely for tests',
);

const forceMember = source(join(app, 'models', 'force-member.model.ts'));
const cbtMemberClass = forceMember.slice(
    forceMember.indexOf('export class CBTForceMember'),
    forceMember.indexOf('/** A real family narrowing'),
);
assert.match(forceMember, /export class CBTForceMember/u);
assert.match(forceMember, /readonly kind: 'cbt'/u);
assert.match(forceMember, /readonly entity: BaseEntity/u);
assert.match(forceMember, /export type ForceMember = ASForceUnit \| CBTForceMember;/u);
assert.doesNotMatch(forceMember, /readonly kind: 'cbt-mek'/u);
assert.doesNotMatch(
    cbtMemberClass,
    /\b(?:readonly summary|getSummary\(\))/u,
    'loaded Classic members must retain Entity, never UnitSummary',
);
assert.doesNotMatch(
    memberRegistry,
    /unit-summary\.model|\bUnitSummary\b|getSummary\(/u,
    'the Classic member registry must build members only from admitted runtime Entity owners',
);

const orgFacts = source(join(app, 'utils', 'org', 'org-facts.util.ts'));
const orgSolver = source(join(app, 'utils', 'org', 'org-solver.util.ts'));
const orgNamer = source(join(app, 'utils', 'org', 'org-namer.util.ts'));
const orgUnit = source(join(app, 'utils', 'org', 'org-unit.util.ts'));
assert.doesNotMatch(
    [orgFacts, orgSolver].join('\n'),
    /\bUnitSummary\b/u,
    'organization rules must consume neutral structural facts, not catalog rows',
);
assert.match(orgNamer, /formationUnits\(\)\.map\(orgUnitFromFormationUnit\)/u);
assert.doesNotMatch(orgNamer, /formationUnits\(\)[\s\S]{0,100}getSummary\(/u);
assert.match(orgUnit, /const entity = unit\.getFormationEntity\?\.\(\);[\s\S]{0,80}if \(entity\) return orgUnitFromEntity\(entity\);/u);
assert.match(orgUnit, /convertEntityToAlphaStrike\(entity\)/u);
assert.doesNotMatch(orgUnit, /as UnitSummary|satisfies UnitSummary/u);

const forcePreview = source(join(app, 'models', 'force-preview.model.ts'));
assert.match(forcePreview, /Force preview requires normalized current persistence/u);
assert.doesNotMatch(
    forcePreview,
    /CBTSerialized(?:Unit|State|Group|Force)|CBT_SERIALIZED_FORCE_SCHEMA|LiveClassic|gunnerySkill\(|pilotingSkill\(/u,
);

const database = source(join(app, 'services', 'db.service.ts'));
const forcePersistence = source(join(app, 'services', 'force-persistence.service.ts'));
assert.doesNotMatch(database, /createLoadForceEntryFromPersistedForce/u);
assert.doesNotMatch(forcePersistence, /createLoadForceEntryFromPersistedForce|deserializePersistedForce/u);
assert.match(database, /deleteForce\(instanceId: string, unitIds: readonly string\[\] = \[\]\)/u);
assert.doesNotMatch(
    database,
    /deleteForceCanvasData\(instanceId|force\.groups[\s\S]{0,200}deleteCanvasData/u,
    'IndexedDB must not decode V1 force topology',
);

const mul = source(join(app, 'utils', 'mul-file.util.ts'));
assert.match(mul, /isCBTForceMember/u);
assert.match(mul, /getUnitSnapshot/u);
assert.match(mul, /dispatchNonMekUnitCommand/u);
assert.match(mul, /snapshot\.query\.destroyed\(\)/u);
assert.doesNotMatch(mul, /canonical CBT Mek/u);

const summaryModel = source(join(app, 'models', 'unit-summary.model.ts'));
const summaryBuilder = source(join(app, 'utils', 'unit-summary-builder.ts'));
assert.doesNotMatch(summaryModel, /runtime-family-not-implemented|entity-load-errors/u);
assert.doesNotMatch(summaryBuilder, /runtime-family-not-implemented|catalogSummary/u);

const handlers = filesBelow(join(app, 'equipment-handlers'))
    .filter(path => !path.endsWith('.spec.ts'));
const handlerOffenders = handlers.filter(path =>
    /MountedEquipment|CBTForceUnit|TurnState|Published|Facade|UnitRuntimePort/u.test(source(path)));
assert.deepEqual(
    handlerOffenders.map(display),
    [],
    'equipment handlers must use direct Entity/component facts and CBTUnitInstance',
);

function importersOf(moduleName: string): string[] {
    const escaped = moduleName.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
    const pattern = new RegExp(`from\\s+['\"][^'\"]*${escaped}['\"]`, 'u');
    return production.filter(path => pattern.test(source(path))).map(display).sort();
}

assert.deepEqual(
    importersOf('legacy-force-v1-converter'),
    ['src/app/services/force-persistence.service.ts'],
    'the force persistence boundary must be the only production caller of V1 conversion',
);
assert.deepEqual(
    importersOf('state-restorer'),
    ['src/app/models/runtime/legacy-force-v1-converter.ts'],
    'legacy state restoration must stay behind the V1 converter',
);
assert.deepEqual(
    importersOf('legacy-restoration-sidecar'),
    [],
    'legacy conversion diagnostics must not become durable V2 state',
);
assert.deepEqual(
    importersOf('mek-movement-psr-restoration-v1'),
    ['src/app/models/runtime/state-restorer.ts'],
    'legacy movement restoration must stay inside legacy state restoration',
);
assert.deepEqual(
    importersOf('legacy-mek-turn-state-v1'),
    ['src/app/models/runtime/mek-movement-psr-restoration-v1.ts'],
    'the V1 turn decoder must stay inside the V1 movement converter',
);

const directV1ForceSurface = production
    .filter(path => /CBTSerialized|CBT_SERIALIZED|convertPersistedForceV1|version\s*===?\s*1/u.test(source(path)))
    .map(display)
    .sort();
assert.deepEqual(
    directV1ForceSurface,
    [
        'src/app/models/runtime/force-storage-codec.ts',
        'src/app/models/runtime/legacy-force-v1-converter.ts',
        'src/app/services/force-persistence.service.ts',
    ],
    'V1 force handling must stay inside storage ingress, conversion, and force persistence',
);

const storageCodec = source(join(app, 'models', 'runtime', 'force-storage-codec.ts'));
assert.match(storageCodec, /force\.version === 1[\s\S]{0,100}return Object\.freeze/u);
assert.doesNotMatch(storageCodec, /CBTSerialized|CBT_SERIALIZED|convertPersistedForceV1/u);
const nonMekPersistence = source(join(app, 'models', 'runtime', 'non-mek-unit-persistence.ts'));
assert.match(
    nonMekPersistence,
    /isNonMekEntityType\(value: EntityType\): value is NonMekEntityType\s*\{\s*return value !== 'Mek';/u,
    'the domain non-Mek guard must narrow EntityType; unknown validation belongs at ingress',
);
const dataService = source(join(app, 'services', 'data.service.ts'));
assert.doesNotMatch(
    dataService,
    /narrow structural test doubles|destroyDetachedForce/u,
    'production persistence must not contain test-double exemptions or fake detached-unit cleanup',
);
assert.doesNotMatch(
    dataService,
    /hasPendingCloudSaves|getUnitSummaryByIdentity|getMegaMekFactions\(|getMegaMekRulesets\(|getMegaMekAvailabilityRecords|refreshSearchCorpus|whenUnitCatalogSettled|getDeferredUnitDescriptors/u,
    'DataService must not expose unused or test-only convenience facades',
);
assert.doesNotMatch(
    dataService,
    /createLoadForceEntryFromPersistedForce|normalizePersistedForce|convertPersistedForceV1/u,
    'catalog data must not own force persistence or migration',
);
assert.match(forcePersistence, /normalizePersistedForce[\s\S]*convertPersistedForceV1/u);
assert.match(database, /if \(force\.version !== 2\)[\s\S]*Only V2 force records may be saved/u);

console.log('Convergence architecture guard passed: Entity + rules + sparse runtime is the only live Classic authority.');
