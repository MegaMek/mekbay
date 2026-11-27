// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
import { isDeepStrictEqual } from 'node:util';
import type { VerificationInput } from './unit-verification-io';

type Row = Record<string, any>;
export const NUMERIC_FIELDS: Record<string, number> = {
  weight: 0.000001, loadoutTonnage: 0.00001, bv: 0, cost: 0.01, printedCostWithoutAmmo: 0.01, armor: 0, internal: 0,
  walkMP: 0, runMP: 0, jumpMP: 0, maxWalkMP: 0, maxRunMP: 0, maxJumpMP: 0, heatCapacity: 0, heatGeneration: 0, heatSinks: 0, si: 0,
};

/** Both exporters deliberately preserve manifest order. Reject missing, duplicate, reordered or stale rows. */
export function assertMatchingInput(input: VerificationInput, row: Row | undefined, label: string): void {
  if (!row) throw new Error(`${label}: missing row for ${input.relativePath}`);
  for (const field of ['relativePath', 'contentSha256', 'byteLength', 'uuid', 'inCoreCatalog'] as const) {
    if (row[field] !== input[field]) throw new Error(`${label}: ${field} mismatch for ${input.relativePath}; got ${JSON.stringify(row[field])}`);
  }
  if (row.schemaVersion !== 1) throw new Error(`${label}: unsupported schema version ${row.schemaVersion}`);
}

export function assertExportProvenance(provenance: Row, corpus: Row, label: string): void {
  if (provenance?.manifestSha256 !== corpus.manifestSha256) throw new Error(`${label}: export manifest provenance mismatch`);
  for (const [file, expected] of Object.entries(corpus.dependencies) as [string, Row][]) {
    const actual = provenance.dependencyHashes?.[file];
    if (actual?.contentSha256 !== expected.contentSha256 || actual?.byteLength !== expected.byteLength) {
      throw new Error(`${label}: reference provenance mismatch: ${file}`);
    }
  }
  if (label === 'native') {
    if (provenance.optionsSha256 !== corpus.dependencies['data/mekfiles/UnitVerifierOptions.xml']?.contentSha256) {
      throw new Error('native: verifier option provenance mismatch');
    }
    const expectedOfficial = corpus.dependencies['docs/OfficialUnitList.txt']?.contentSha256 ?? null;
    if ((provenance.officialUnitsSha256 ?? null) !== expectedOfficial) throw new Error('native: canonical-unit reference provenance mismatch');
  }
}

export function loadStatus(row: Row, native: boolean): string {
  if (!['ok', 'parsed'].includes(row.parse?.status)) return row.parse?.status ?? 'missing';
  if (native && row.parse.failedEquipment?.length) return 'parsed-with-failed-equipment';
  if (!native && row.parse.diagnostics?.some((diagnostic: Row) => diagnostic.severity === 'error')) return 'parsed-with-load-errors';
  if (!native && row.parse.diagnostics?.length) return 'parsed-with-load-warnings';
  return 'parsed-clean';
}

export function verifierStatus(row: Row, key: string): string {
  if (!['ok', 'parsed'].includes(row.parse?.status)) return `parse-${row.parse?.status ?? 'missing'}`;
  const result = row[key];
  if (!result) return 'missing';
  if (result.error) return 'error';
  if (result.supported === false) return 'unsupported';
  if (result.supported !== true || typeof result.valid !== 'boolean') return 'incomplete';
  if (result.skip === true) return 'skipped';
  return result.valid ? 'valid' : 'invalid';
}

export function compareNumber(native: Row, mekbay: Row, field: string, tolerance: number) {
  const left = native.calculated?.[field];
  const right = mekbay.calculated?.[field];
  const nativeError = native.calculated?.errors?.[field];
  const mekbayError = mekbay.calculated?.errors?.[field];
  if (nativeError || mekbayError) return { field,
    status: nativeError?.type?.endsWith('UnsupportedOperationException') && !mekbayError ? 'unsupported-field' : 'calculation-error', native: left ?? null,
    mekbay: right ?? null, nativeError: nativeError ?? null, mekbayError: mekbayError ?? null };
  if (typeof left !== 'number' || typeof right !== 'number' || !Number.isFinite(left) || !Number.isFinite(right)) {
    return { field, status: 'unavailable', native: left ?? null, mekbay: right ?? null };
  }
  const delta = right - left;
  const status = Math.abs(delta) <= tolerance ? 'match' : 'mismatch';
  return { field, status, native: left, mekbay: right, delta, tolerance,
    ...(status === 'mismatch' ? numericDifferenceMeaning(native, mekbay, field, left) : {}) };
}

/** Explain unlike quantities without changing the raw mismatch into a passing comparison. */
function numericDifferenceMeaning(native: Row, mekbay: Row, field: string, left: number) {
  const family = mekbay.identity?.entityType;
  if (field === 'bv' && native.flags?.useManualBV === true && left === native.flags.manualBV
    && mekbay.flags?.manualBV === native.flags.manualBV) {
    return { disposition: 'source-override-policy', reason: 'Native Entity returns the authored manual BV; MekBay retains that source value but its entity calculator returns computed BV. Display/override policy needs evaluation.' };
  }
  if (field === 'heatGeneration' && mekbay.calculated.heatGeneration === -1 && mekbay.flags?.tracksHeat === false) {
    return { disposition: 'different-quantity', reason: 'MekBay returns -1 when this entity does not track heat; native UnitUtil still sums maximum equipment heat. This does not assert that equipment generates no heat.' };
  }
  if (field === 'internal' && left === 0
    && ['Aero', 'ConvFighter', 'FixedWingSupport', 'SmallCraft', 'DropShip', 'JumpShip', 'WarShip', 'SpaceStation'].includes(family)
    && mekbay.calculated.internal === mekbay.calculated.si && native.calculated.si === mekbay.calculated.si) {
    return { disposition: 'different-quantity', reason: 'Native total original internal excludes aerospace SI; MekBay totalInternal contains SI. SI is compared separately.' };
  }
  if (field === 'heatCapacity' && left === 999
    && ['BuildingEntity', 'BattleArmor', 'ConvFighter', 'FixedWingSupport', 'HandheldWeapon', 'Infantry', 'ProtoMek',
      'Tank', 'SupportTank', 'VTOL', 'Naval', 'LargeSupportTank', 'SupportVTOL', 'SupportNaval'].includes(family)) {
    return { disposition: 'different-quantity', reason: 'Native Entity/ConvFighter DOES_NOT_TRACK_HEAT sentinel (999), not installed cooling or tracked heat dissipation.' };
  }
  if (field === 'heatSinks' && ['ConvFighter', 'FixedWingSupport'].includes(family)) {
    return { disposition: 'different-quantity', reason: 'Native verifier reports heat-neutral cooling requirement (zero for small support); MekBay reports installed heatSinkCount.' };
  }
  return { disposition: 'needs-evaluation' };
}

function composition(graph: Row): [string, number][] {
  const counts = new Map<string, number>();
  for (const mount of graph.equipment) counts.set(mount.internalName ?? '<unresolved>', (counts.get(mount.internalName ?? '<unresolved>') ?? 0) + 1);
  return [...counts.entries()].sort(([left], [right]) => left.localeCompare(right));
}

/** Compare equipment occupying physical Mek slots; never sort critical slots or substitute a name match for position. */
function mekEquipmentCriticals(native: Row, mekbay: Row) {
  const differences = [];
  for (const location of native.graph.locations) {
    const target = mekbay.graph.locations.find((item: Row) => item.abbreviation === location.abbr);
    if (!target) { differences.push({ location: location.abbr, reason: 'location-missing' }); continue; }
    for (let slot = 0; slot < Math.max(location.criticals.length, target.criticalSlots?.length ?? 0); slot++) {
      const left = location.criticals[slot];
      const right = target.criticalSlots?.[slot];
      // Native has only 6 physical head/leg slots on some designs; ignore absent/empty slots only.
      const nativeNames = [left?.mountIndex, left?.mount2Index].filter(index => typeof index === 'number')
        .map(index => native.graph.equipment[index]?.internalName ?? `<missing mount ${index}>`);
      const mekbayNames = (right?.equipmentIndices ?? []).map((index: number) => mekbay.graph.equipment[index]?.internalName ?? `<missing mount ${index}>`);
      if (!isDeepStrictEqual(nativeNames, mekbayNames)) differences.push({ location: location.abbr, slot,
        native: nativeNames, mekbay: mekbayNames });
    }
  }
  return { status: differences.length ? 'mismatch' : 'match', differences,
    scope: 'Ordered equipment occupancy only; system labels/actuators/armoring require separate checks.' };
}

function mekSystemsAndArmoring(native: Row, mekbay: Row) {
  // MegaMek's raw system table abbreviates exactly these actuator identities.
  const nativeActuators: Record<string, string> = {
    'Upper Arm': 'Upper Arm Actuator', 'Lower Arm': 'Lower Arm Actuator', Hand: 'Hand Actuator',
    'Upper Leg': 'Upper Leg Actuator', 'Lower Leg': 'Lower Leg Actuator', Foot: 'Foot Actuator',
  };
  const differences = [];
  let unavailable = false;
  for (const location of native.graph.locations) {
    const target = mekbay.graph.locations.find((item: Row) => item.abbreviation === location.abbr);
    if (!target) { differences.push({ location: location.abbr, reason: 'location-missing' }); continue; }
    for (let slot = 0; slot < Math.max(location.criticals.length, target.criticalSlots?.length ?? 0); slot++) {
      const left = location.criticals[slot], right = target.criticalSlots?.[slot];
      if (left?.type === 0 && typeof left.systemRawName !== 'string') { unavailable = true; continue; }
      if (left && typeof left.armored !== 'boolean') { unavailable = true; continue; }
      const nativeSlot = { system: left?.type === 0 ? nativeActuators[left.systemRawName] ?? left.systemRawName : null, armored: left?.armored ?? false };
      const mekbaySlot = { system: right?.type === 'system' ? right.system : null, armored: right?.armored ?? false };
      if (!isDeepStrictEqual(nativeSlot, mekbaySlot)) differences.push({ location: location.abbr, slot,
        native: nativeSlot, mekbay: mekbaySlot });
    }
  }
  return { status: differences.length ? 'mismatch' : unavailable ? 'unavailable' : 'match', differences,
    scope: 'Ordered system identity with six explicit native actuator aliases, and physical-slot armoring. Raw labels remain in exports.' };
}

/** The controller's critical position identifies an MGA even when two identical arrays share a location. */
function mgaMembership(row: Row, native: boolean, mek: boolean) {
  const graph = row.graph;
  const key = (index: number) => {
    const mount = graph.equipment[index];
    if (!mount) return `<missing mount ${index}>`;
    const slots: string[] = [];
    for (const location of mek ? graph.locations : []) {
      const criticals = native ? location.criticals : location.criticalSlots;
      for (const [slot, critical] of (criticals ?? []).entries()) {
        if (native ? critical?.mountIndex === index || critical?.mount2Index === index : critical?.equipmentIndices?.includes(index)) {
          slots.push(`${native ? location.abbr : location.abbreviation}:${slot}`);
        }
      }
    }
    const location = native ? graph.locations.find((item: Row) => item.index === mount.location)?.name : mount.location;
    // Native non-Meks expose pseudo-critical indices; MekBay stores ordered location mounts.
    // Preserve identity among repeated guns without pretending those are physical Mek slots.
    const ordinal = graph.equipment.slice(0, index).filter((item: Row) => item.internalName === mount.internalName
      && item.location === mount.location).length;
    return `${mount.internalName}@${slots.length ? slots.join(',') : `${location ?? 'None'}:${ordinal}`}`;
  };
  const controllers = graph.equipment.filter((mount: Row) => mount.isMachineGunArray === true);
  return controllers.map((mount: Row) => {
    const bay = native ? null : graph.bays.find((item: Row) => item.kind === 'machine-gun-array' && item.controllerIndex === mount.index);
    const indices = native ? mount.bayWeaponIndices ?? [] : bay?.weaponIndices ?? [];
    return { controller: key(mount.index), members: indices.map(key) };
  });
}

export function compareVerificationRows(native: Row, mekbay: Row) {
  const parsed = ['ok', 'parsed'].includes(native.parse?.status) && ['ok', 'parsed'].includes(mekbay.parse?.status);
  const values = parsed ? Object.entries(NUMERIC_FIELDS).map(([field, tolerance]) => compareNumber(native, mekbay, field, tolerance)) : [];
  const identities = parsed ? ['chassis', 'model', 'year', 'techBase', 'mixedTech'].map(field => ({ field,
    status: native.identity?.[field] == null || mekbay.identity?.[field] == null ? 'unavailable'
      : isDeepStrictEqual(native.identity[field], mekbay.identity[field]) ? 'match' : 'mismatch',
    native: native.identity?.[field] ?? null, mekbay: mekbay.identity?.[field] ?? null })) : [];
  const graph: Row = { status: 'unavailable' };
  if (parsed && native.graph && mekbay.graph) {
    const left = composition(native.graph), right = composition(mekbay.graph);
    graph.status = 'exported';
    graph.equipmentComposition = { status: isDeepStrictEqual(left, right) ? 'match' : 'difference',
      // Different implicit engine sinks and synthetic bay mounts can be intentional: this is a review signal.
      ...(isDeepStrictEqual(left, right) ? {} : { native: left, mekbay: right }),
      scope: 'Internal-name multiplicities; differences need classification of implicit/synthetic equipment.' };
    graph.mekEquipmentCriticals = mekbay.identity.entityType === 'Mek'
      ? mekEquipmentCriticals(native, mekbay) : { status: 'not-applicable' };
    graph.mekSystemsAndArmoring = mekbay.identity.entityType === 'Mek'
      ? mekSystemsAndArmoring(native, mekbay) : { status: 'not-applicable' };
    const nativeHasFlags = native.graph.equipment.every((mount: Row) => typeof mount.isMachineGunArray === 'boolean');
    const mekbayHasFlags = mekbay.graph.equipment.every((mount: Row) => typeof mount.isMachineGunArray === 'boolean');
    if (nativeHasFlags && mekbayHasFlags) {
      const mek = mekbay.identity.entityType === 'Mek';
      const nativeArrays = mgaMembership(native, true, mek), mekbayArrays = mgaMembership(mekbay, false, mek);
      graph.machineGunArrays = { status: isDeepStrictEqual(nativeArrays, mekbayArrays) ? 'match' : 'mismatch',
        native: nativeArrays, mekbay: mekbayArrays };
    } else graph.machineGunArrays = { status: 'unavailable' };
  }
  const rulesetBv = parsed ? compareNumber(
    { calculated: { bv: mekbay.calculated?.bv, errors: { bv: mekbay.calculated?.errors?.bv } } },
    { calculated: { bv: mekbay.calculated?.bvCore2026, errors: { bv: mekbay.calculated?.errors?.bvCore2026 } } }, 'bv', 0) : null;
  return {
    relativePath: native.relativePath, uuid: native.uuid, inCoreCatalog: native.inCoreCatalog,
    family: mekbay.identity?.entityType ?? native.identity?.class?.split('.').at(-1) ?? 'unparsed',
    parse: { native: native.parse, mekbay: mekbay.parse },
    loadStatus: { native: loadStatus(native, true), mekbay: loadStatus(mekbay, false) },
    validation: { megamek: verifierStatus(native, 'megamek'), megameklab: verifierStatus(native, 'megameklab'), mekbay: verifierStatus(mekbay, 'mekbay') },
    messages: { megamek: native.megamek?.messages ?? null, megameklab: native.megameklab?.messages ?? null,
      megameklabUI: native.megameklab?.validateUnitMessages ?? null, mekbay: mekbay.mekbay?.messages ?? null },
    nativeFlags: native.flags ?? null, values, identities, graph,
    coreVsTW: rulesetBv ? { status: rulesetBv.status, totalWarfare: rulesetBv.native, core2026: rulesetBv.mekbay,
      delta: 'delta' in rulesetBv ? rulesetBv.delta : null, source: 'MekBay explicit ruleset calculations' } : null,
  };
}
