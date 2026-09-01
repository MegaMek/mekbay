// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import type { Injector } from '@angular/core';
import { APP_VERSION_STRING } from '../build-meta';
import { GameSystem } from '../models/common.model';
import { CBTForce } from '../models/cbt-force.model';
import {
    hasNonMekRuntime,
    hasMekRuntime,
    type CBTNonMekUnitSnapshot,
    type CBTUnitSnapshot,
} from '../models/cbt-unit-snapshot';
import { DEFAULT_GUNNERY_SKILL, DEFAULT_PILOTING_SKILL } from '../models/crew.model';
import type { UnitSummary } from '../models/unit-summary.model';
import type { ArmorFaceId, LocationId } from '../models/entity/entity-identifiers';
import type { DataService } from '../services/data.service';
import { ForceUnitAdmissionService } from '../services/force-unit-admission.service';
import {
    isCBTForceMember,
    isCBTMekForceMember,
    type CBTForceMember,
    type CBTMekForceMember,
} from '../models/force-member.model';
import type {
    MekRecordSheetCriticalSlot,
    MekRecordSheetCrewPosition,
    MekRecordSheetLocation,
    MekRecordSheetSnapshot,
} from '../models/runtime/mek-record-sheet';
import type {
    NonMekUnitCommand,
} from '../models/runtime/non-mek-unit-instance';
import type { CBTUnitCommand } from '../models/runtime/unit-instance';
import { effectiveEntityPilotingSkill } from '../models/entity/utils/battle-value/skill-facts';
import { uuidv7 } from './uuid.util';

const DEFAULT_ENTITY_ATTRIBUTES: Readonly<Record<string, string>> = Object.freeze({
    offboard: 'false',
    hidden: 'false',
    deployment: '0',
    deploymentZone: '-1',
    deploymentZoneWidth: '3',
    deploymentZoneOffset: '0',
    deploymentZoneAnyNWx: '-1',
    deploymentZoneAnyNWy: '-1',
    deploymentZoneAnySEx: '-1',
    deploymentZoneAnySEy: '-1',
    neverDeployed: 'true',
});

const LOCATION_INDEX_BY_CODE = new Map<string, number>([
    ['HD', 0], ['NOS', 0], ['BODY', 0], ['CT', 1], ['RT', 2], ['LT', 3],
    ['RA', 4], ['LA', 5], ['RL', 6], ['LL', 7], ['CL', 8], ['FRL', 9],
    ['FLL', 10], ['RRL', 11], ['RLL', 12], ['TROOP', 0], ['SI', 0],
]);

const CODE_BY_LOCATION_INDEX = new Map<number, string>([
    [0, 'HD'], [1, 'CT'], [2, 'RT'], [3, 'LT'], [4, 'RA'], [5, 'LA'],
    [6, 'RL'], [7, 'LL'], [8, 'CL'], [9, 'FRL'], [10, 'FLL'], [11, 'RRL'], [12, 'RLL'],
]);

export interface MulParseIssue {
    readonly severity: 'warning' | 'error';
    readonly message: string;
}

export interface MulParseResult {
    readonly force: CBTForce;
    readonly issues: readonly MulParseIssue[];
}

interface ParsedMulCrewMember {
    readonly id: number;
    readonly name: string;
    readonly gunnerySkill: number;
    readonly pilotingSkill: number;
    readonly hits: number;
    readonly ejected: boolean;
}

interface ParsedMulSlot {
    readonly loc: string;
    readonly slot: number;
    readonly type: string;
    readonly shots?: number;
    readonly armorHit?: boolean;
    readonly hit: boolean;
    readonly destroyed: boolean;
}

interface ParsedMulLocation {
    readonly index: number;
    readonly loc: string;
    readonly destroyed: boolean;
    armor?: number | 'Destroyed';
    rearArmor?: number | 'Destroyed';
    internal?: number | 'Destroyed';
    slots: ParsedMulSlot[];
}

type MulCrewType = 'single' | 'tripod' | 'superheavy_tripod' | 'quadvee' | 'dual' | 'command_console';
export function sanitizeMulFilename(name: string | null | undefined): string {
    return (name || 'mekbay-force')
        .trim()
        .replace(/[<>:"/\\|?*\u0000-\u001F]/g, '')
        .replace(/\s+/g, '-')
        .replace(/\.+/g, '.')
        .replace(/-+/g, '-')
        .replace(/^[. -]+|[. -]+$/g, '')
        .slice(0, 80) || 'mekbay-force';
}

export async function serializeForceToMul(force: CBTForce): Promise<string> {
    if (force.gameSystem !== GameSystem.CBT) {
        throw new Error('MUL export is only available for Classic BattleTech forces.');
    }
    const roster = force.queryCanonicalRoster();
    if (roster.kind !== 'available') throw new Error(roster.message);

    const doc = document.implementation.createDocument('', 'unit');
    const root = doc.documentElement;
    setAttributes(root, { version: `mekbay-${APP_VERSION_STRING}` });
    let index = 0;
    for (const rosterMember of roster.snapshot.members) {
        const member = force.getCBTMember(rosterMember.instanceId);
        if (!member) throw new Error(`MUL export requires ready runtime ${rosterMember.instanceId}`);
        const sheet = force.getMekRecordSheetSnapshot(member.id);
        const snapshot = force.getUnitSnapshot(member.id);
        let element: Element | null = null;
        if (sheet && snapshot && hasMekRuntime(snapshot)) {
            element = createMekEntityElement(
                doc,
                sheet,
                snapshot.entity.quirks().map(({ quirk, value }) => ({
                    key: quirk.key,
                    ...(value === undefined ? {} : { value }),
                })),
                rosterMember.commander === true,
                member.id,
                index,
            );
        } else if (snapshot && hasNonMekRuntime(snapshot)) {
            element = createEntityRuntimeElement(
                doc,
                member,
                snapshot,
                rosterMember.commander === true,
                index,
            );
        }
        if (!element) throw new Error(`MUL export cannot project runtime ${member.id}`);
        appendIndented(root, doc, element, '\t');
        root.appendChild(doc.createTextNode('\n'));
        index += 1;
    }
    appendClosingIndent(root, doc, '');
    return `<?xml version="1.0" encoding="UTF-8"?>\n\n${new XMLSerializer().serializeToString(doc)}`;
}

export async function exportForceToMul(force: CBTForce): Promise<void> {
    const content = await serializeForceToMul(force);
    const blob = new Blob([content], { type: 'application/xml;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `${sanitizeMulFilename(force.name)}.mul`;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(url);
}

export async function parseMulForce(
    xmlText: string,
    forceName: string,
    dataService: DataService,
    injector: Injector,
): Promise<MulParseResult> {
    const doc = parseMulDocument(xmlText);
    const issues: MulParseIssue[] = [];
    const unitLookup = createUnitLookup(dataService.getUnits());
    const force = new CBTForce(forceName || 'Imported MUL Force', dataService, injector);
    const admission = injector.get(ForceUnitAdmissionService);
    const group = force.groups()[0] ?? await force.addGroup();

    for (const entity of getMulEntityElements(doc)) {
        const chassis = entity.getAttribute('chassis') ?? '';
        const model = entity.getAttribute('model') ?? '';
        const summary = unitLookup.get(unitLookupKey(chassis, model));
        if (!summary) {
            issues.push({ severity: 'error', message: `Unit "${[chassis, model].filter(Boolean).join(' ')}" was not found.` });
            continue;
        }
        const crew = parseEntityCrew(entity);
        let admitted: CBTForceMember | null = null;
        try {
            const member = await admission.admit({
                force,
                summary,
                group,
                rosterGroupId: group.id,
                gunnerySkill: crew[0]?.gunnerySkill ?? DEFAULT_GUNNERY_SKILL,
                pilotingSkill: crew[0]?.pilotingSkill ?? DEFAULT_PILOTING_SKILL,
                commander: parseBoolean(entity.getAttribute('commander')),
                instanceId: entity.getAttribute('externalId') || undefined,
            });
            if (!isCBTForceMember(member)) throw new Error('MUL admission did not create a canonical CBT unit');
            admitted = member;
            await applyMulCrew(force, member, crew);
            await applyMulLocations(force, member, parseEntityLocations(entity), issues);
        } catch (error) {
            if (admitted) await force.removeCBTMember(admitted.id);
            issues.push({ severity: 'error', message: `Could not import ${summary.name}: ${errorMessage(error)}` });
        }
    }
    if (force.getRuntimeInstanceIds().length === 0) {
        throw new Error(issues.find(issue => issue.severity === 'error')?.message || 'The MUL file did not contain any loadable units.');
    }
    return Object.freeze({ force, issues: Object.freeze(issues.map(issue => Object.freeze(issue))) });
}

function createMekEntityElement(
    doc: XMLDocument,
    sheet: MekRecordSheetSnapshot,
    quirks: readonly { readonly key: string; readonly value?: string }[],
    commander: boolean,
    instanceId: string,
    index: number,
): Element {
    const entity = doc.createElement('entity');
    setAttributes(entity, {
        chassis: sheet.identity.baseChassis,
        model: sheet.identity.model,
        type: sheet.movement.motiveType,
        commander,
        ...DEFAULT_ENTITY_ATTRIBUTES,
        externalId: instanceId,
        quirks: quirks.length === 0 ? undefined : quirks.map(quirk => quirk.value ? `${quirk.key}=${quirk.value}` : quirk.key).join('::'),
    });
    appendIndented(entity, doc, createCrewElement(doc, sheet), '\t\t');
    for (const location of createLocationElements(doc, sheet)) appendIndented(entity, doc, location, '\t\t');
    const game = doc.createElement('Game');
    setAttributes(game, { id: index + 1 });
    appendIndented(entity, doc, game, '\t\t');
    appendClosingIndent(entity, doc, '\t');
    return entity;
}

function createEntityRuntimeElement(
    doc: XMLDocument,
    member: CBTForceMember,
    snapshot: CBTNonMekUnitSnapshot,
    commander: boolean,
    index: number,
): Element {
    if (snapshot.state.components.size > 0 || snapshot.state.ammo.size > 0) {
        throw new Error(
            `MUL export cannot safely map component state for ${member.entity.displayName()} without family slot rules`,
        );
    }
    const quirks = snapshot.entity.quirks();
    const entity = doc.createElement('entity');
    setAttributes(entity, {
        chassis: member.entity.fullChassis(),
        model: member.entity.model(),
        type: snapshot.entity.motiveType(),
        commander,
        ...DEFAULT_ENTITY_ATTRIBUTES,
        externalId: member.id,
        quirks: quirks.length === 0
            ? undefined
            : quirks.map(({ quirk, value }) => value ? `${quirk.key}=${value}` : quirk.key).join('::'),
    });
    appendIndented(entity, doc, createEntityRuntimeCrewElement(doc, member, snapshot), '\t\t');
    for (const location of createNonMekRuntimeLocationElements(doc, snapshot)) {
        appendIndented(entity, doc, location, '\t\t');
    }
    const game = doc.createElement('Game');
    setAttributes(game, { id: index + 1 });
    appendIndented(entity, doc, game, '\t\t');
    appendClosingIndent(entity, doc, '\t');
    return entity;
}

function createEntityRuntimeCrewElement(
    doc: XMLDocument,
    member: CBTForceMember,
    snapshot: CBTNonMekUnitSnapshot,
): Element {
    const assignment = member.force.getUnitCrewAssignment(member.id);
    if (!assignment) throw new Error(`Missing crew assignment for ${member.id}`);
    const positions = assignment.positions.map(position => {
        const state = snapshot.state.crew.get(position.positionId);
        return Object.freeze({
            ...position,
            wounds: state?.wounds ?? 0,
            ejected: state?.ejected ?? false,
        });
    });
    const position = positions[0];
    const pilot = doc.createElement('pilot');
    setAttributes(pilot, {
        size: Math.max(1, positions.length),
        name: position?.name ?? '',
        nick: '',
        gender: 'RANDOMIZE',
        clanperson: snapshot.entity.techBase() === 'Clan',
        gunnery: position?.gunnery ?? DEFAULT_GUNNERY_SKILL,
        piloting: position?.piloting ?? DEFAULT_PILOTING_SKILL,
        hits: position?.wounds || undefined,
        ejected: position?.ejected ?? false,
        externalId: uuidv7(),
        edge: '',
        autoeject: true,
    });
    return pilot;
}

function createNonMekRuntimeLocationElements(
    doc: XMLDocument,
    snapshot: CBTNonMekUnitSnapshot,
): Element[] {
    const destroyed = snapshot.query.destroyed();
    return [...snapshot.index.locations.values()].flatMap((location, index) => {
        const current = snapshot.state.locations.get(location.id);
        if (!destroyed && !current) return [];
        const internalRemaining = destroyed
            ? 0
            : Math.max(0, location.internalPoints - (current?.internalDamage ?? 0));
        const changedArmor = location.armorFaceIds.flatMap(faceId => {
            const face = snapshot.index.armorFaces.get(faceId);
            if (!face) return [];
            const damage = destroyed
                ? face.maximumPoints
                : current?.armorDamage.find(value => value.faceId === faceId)?.damage ?? 0;
            return damage === 0 ? [] : [{ face, remaining: Math.max(0, face.maximumPoints - damage) }];
        });
        const internalChanged = internalRemaining < location.internalPoints;
        if (!internalChanged && changedArmor.length === 0) return [];
        const element = doc.createElement('location');
        setAttributes(element, {
            index,
            isDestroyed: internalRemaining <= 0 || undefined,
        });
        element.appendChild(doc.createTextNode(` ${location.code}`));
        for (const { face, remaining } of changedArmor) {
            const row = doc.createElement('armor');
            setAttributes(row, {
                points: remaining <= 0 ? 'Destroyed' : remaining,
                type: face.face === 'rear' ? 'Rear' : undefined,
            });
            appendIndented(element, doc, row, '\t\t\t');
        }
        if (internalChanged) {
            const row = doc.createElement('armor');
            setAttributes(row, {
                points: internalRemaining <= 0 ? 'Destroyed' : internalRemaining,
                type: 'Internal',
            });
            appendIndented(element, doc, row, '\t\t\t');
        }
        appendClosingIndent(element, doc, '\t\t');
        return [element];
    });
}

function createCrewElement(doc: XMLDocument, sheet: MekRecordSheetSnapshot): Element {
    const crewType = getCrewType(sheet);
    const clanPerson = sheet.identity.techBase === 'Clan';
    if (crewType !== 'single') {
        const element = doc.createElement('crew');
        setAttributes(element, { crewType, ejected: false, edge: '', autoeject: true });
        for (const member of sheet.crew) {
            const row = doc.createElement('crewMember');
            setAttributes(row, {
                slot: member.occurrence,
                name: member.name,
                nick: '',
                gender: 'RANDOMIZE',
                clanperson: clanPerson,
                gunnery: member.gunnery,
                piloting: member.piloting,
                hits: member.state.wounds || undefined,
                ejected: member.state.ejected || undefined,
                externalId: uuidv7(),
            });
            appendIndented(element, doc, row, '\t\t\t');
        }
        appendClosingIndent(element, doc, '\t\t');
        return element;
    }
    const member = sheet.crew[0];
    const element = doc.createElement('pilot');
    setAttributes(element, {
        size: 1,
        name: member?.name ?? '',
        nick: '',
        gender: 'RANDOMIZE',
        clanperson: clanPerson,
        gunnery: member?.gunnery ?? DEFAULT_GUNNERY_SKILL,
        piloting: member?.piloting ?? DEFAULT_PILOTING_SKILL,
        hits: member?.state.wounds || undefined,
        ejected: member?.state.ejected ?? false,
        externalId: uuidv7(),
        edge: '',
        autoeject: true,
    });
    return element;
}

function createLocationElements(doc: XMLDocument, sheet: MekRecordSheetSnapshot): Element[] {
    return [...sheet.locations]
        .sort((a, b) => locationIndex(a.code) - locationIndex(b.code) || a.code.localeCompare(b.code))
        .flatMap(location => {
            const slots = sheet.criticalSlots.filter(slot => slot.locationId === location.locationId && slotHasPersistentState(slot));
            const armor = location.armor.filter(face => face.committedRemaining < face.maximum);
            const internalChanged = location.committedRemainingInternal < location.maximumInternal;
            if (!internalChanged && armor.length === 0 && slots.length === 0) return [];
            const element = doc.createElement('location');
            setAttributes(element, {
                index: locationIndex(location.code),
                isDestroyed: location.committedRemainingInternal <= 0 || undefined,
            });
            element.appendChild(doc.createTextNode(` ${locationName(location.code)}`));
            for (const face of armor) {
                const row = doc.createElement('armor');
                setAttributes(row, {
                    points: face.committedRemaining <= 0 ? 'Destroyed' : face.committedRemaining,
                    type: face.face === 'rear' ? 'Rear' : undefined,
                });
                appendIndented(element, doc, row, '\t\t\t');
            }
            if (internalChanged) {
                const row = doc.createElement('armor');
                setAttributes(row, {
                    points: location.committedRemainingInternal <= 0 ? 'Destroyed' : location.committedRemainingInternal,
                    type: 'Internal',
                });
                appendIndented(element, doc, row, '\t\t\t');
            }
            for (const slot of slots.sort((a, b) => a.slotIndex - b.slotIndex)) {
                const component = slot.components[0];
                const row = doc.createElement('slot');
                setAttributes(row, {
                    index: slot.slotIndex + 1,
                    type: component?.label ?? component?.system ?? 'System',
                    shots: component?.ammo && component.ammo.remaining < component.ammo.capacity
                        ? component.ammo.remaining
                        : undefined,
                    armorHit: slot.armored && slot.committedHits > 0 ? true : undefined,
                    isHit: slot.committedHits >= (slot.armored ? 2 : 1) ? true : undefined,
                    isDestroyed: slot.components.some(value => value.status === 'destroyed') || undefined,
                });
                appendIndented(element, doc, row, '\t\t\t');
            }
            appendClosingIndent(element, doc, '\t\t');
            return [element];
        });
}

async function applyMulCrew(
    force: CBTForce,
    member: CBTForceMember,
    imported: readonly ParsedMulCrewMember[],
): Promise<void> {
    const current = force.getUnitCrewProfile(member.id);
    if (!current) return;
    const entity = force.getUnitSnapshot(member.id)?.entity;
    if (!entity) throw new Error(`Missing Entity for ${member.id}`);
    const byOccurrence = new Map(imported.map(value => [value.id, value] as const));
    const positions = current.positions.map((position, index) => {
        const value = byOccurrence.get(index);
        return value ? {
            ...position,
            name: value.name,
            gunnery: value.gunnerySkill,
            piloting: effectiveEntityPilotingSkill(entity, value.pilotingSkill),
        } : position;
    });
    const replaced = await force.replaceUnitCrewProfile(member.id, positions);
    if (!replaced) throw new Error('The MUL crew could not be applied');
    if (isCBTMekForceMember(member)) {
        const sheet = requiredSheet(force, member);
        for (const position of sheet.crew) {
            const value = byOccurrence.get(position.occurrence);
            if (!value || (value.hits === 0 && !value.ejected)) continue;
            await dispatchMek(force, member, {
                type: 'set-crew-state',
                positionId: position.positionId,
                wounds: Math.max(0, Math.min(6, value.hits)),
                unconscious: false,
                ejected: value.ejected,
            });
        }
        return;
    }
    const snapshot = requiredEntitySnapshot(force, member);
    for (const position of snapshot.index.crewPositions.values()) {
        const value = byOccurrence.get(position.occurrence);
        if (!value || (value.hits === 0 && !value.ejected)) continue;
        await dispatchEntity(force, member, {
            kind: 'set-crew-state',
            positionId: position.id,
            wounds: Math.max(0, Math.min(6, value.hits)),
            unconscious: false,
            ejected: value.ejected,
            killed: false,
            stunned: false,
        });
    }
}

async function applyMulLocations(
    force: CBTForce,
    member: CBTForceMember,
    locations: readonly ParsedMulLocation[],
    issues: MulParseIssue[],
): Promise<void> {
    if (!isCBTMekForceMember(member)) {
        await applyMulEntityLocations(force, member, locations, issues);
        return;
    }
    for (const imported of locations) {
        const sheet = requiredSheet(force, member);
        const location = sheet.locations.find(value => value.code === imported.loc);
        if (!location) {
            issues.push({ severity: 'warning', message: `MUL location ${imported.loc} does not exist on ${sheet.identity.displayName}.` });
            continue;
        }
        await applyRemainingArmor(force, member, location, 'front', imported.destroyed ? 'Destroyed' : imported.armor);
        await applyRemainingArmor(force, member, location, 'rear', imported.destroyed ? 'Destroyed' : imported.rearArmor);
        await applyRemainingInternal(force, member, location, imported.destroyed ? 'Destroyed' : imported.internal);
        for (const importedSlot of imported.slots) {
            const current = requiredSheet(force, member);
            const slot = current.criticalSlots.find(value => value.locationCode === importedSlot.loc && value.slotIndex === importedSlot.slot);
            if (!slot) {
                issues.push({ severity: 'warning', message: `MUL slot ${importedSlot.loc} #${importedSlot.slot + 1} (${importedSlot.type}) did not match a published critical slot on ${current.identity.displayName}.` });
                continue;
            }
            const labels = slot.components.flatMap(value => [value.label, value.system]).filter((value): value is string => !!value);
            if (labels.length > 0 && !labels.includes(importedSlot.type)) {
                issues.push({ severity: 'warning', message: `MUL slot ${importedSlot.loc} #${importedSlot.slot + 1} has type "${importedSlot.type}"; using published component "${labels[0]}".` });
            }
            const desiredHits = importedSlot.armorHit ? (importedSlot.hit ? 2 : 1) : importedSlot.hit ? 1 : 0;
            if (desiredHits > slot.committedHits) {
                await dispatchMek(force, member, {
                    type: 'hit-critical', slotId: slot.slotId, hits: desiredHits - slot.committedHits, target: 'committed',
                });
            }
            const ammo = slot.components.find(value => value.ammo)?.ammo;
            const ammoComponent = slot.components.find(value => value.ammo);
            if (ammo && ammoComponent && importedSlot.shots !== undefined) {
                await dispatchMek(force, member, {
                    type: 'configure-ammo-source',
                    componentId: ammoComponent.componentId,
                    munitionKey: ammo.munitionKey,
                    remaining: Math.max(0, Math.min(ammo.capacity, importedSlot.shots)),
                });
            }
            if (importedSlot.destroyed) {
                for (const component of slot.components.filter(value => value.status !== 'destroyed')) {
                    await dispatchMek(force, member, {
                        type: 'set-component-status',
                        componentId: component.componentId,
                        status: 'destroyed',
                        target: 'committed',
                    });
                }
            }
        }
    }
}

async function applyMulEntityLocations(
    force: CBTForce,
    member: CBTForceMember,
    locations: readonly ParsedMulLocation[],
    issues: MulParseIssue[],
): Promise<void> {
    for (const imported of locations) {
        const snapshot = requiredEntitySnapshot(force, member);
        const location = [...snapshot.index.locations.values()][imported.index];
        if (!location) {
            issues.push({
                severity: 'warning',
                message: `MUL location index ${imported.index} does not exist on ${member.entity.displayName()}.`,
            });
            continue;
        }
        const front = location.armorFaceIds
            .map(id => snapshot.index.armorFaces.get(id))
            .find(face => face?.face === 'front');
        const rear = location.armorFaceIds
            .map(id => snapshot.index.armorFaces.get(id))
            .find(face => face?.face === 'rear');
        const destroyed = imported.destroyed ? 'Destroyed' as const : undefined;
        if (front) {
            await applyEntityRemainingArmor(
                force,
                member,
                front.id,
                front.maximumPoints,
                destroyed ?? imported.armor,
            );
        }
        if (rear) {
            await applyEntityRemainingArmor(
                force,
                member,
                rear.id,
                rear.maximumPoints,
                destroyed ?? imported.rearArmor,
            );
        }
        await applyEntityRemainingInternal(
            force,
            member,
            location.id,
            location.internalPoints,
            destroyed ?? imported.internal,
        );
        if (imported.slots.length > 0) {
            issues.push({
                severity: 'warning',
                message: `MUL critical slots for ${member.entity.displayName()} ${location.code} require family slot rules and were not applied.`,
            });
        }
    }
}

async function applyEntityRemainingArmor(
    force: CBTForce,
    member: CBTForceMember,
    faceId: ArmorFaceId,
    maximum: number,
    remaining: number | 'Destroyed' | undefined,
): Promise<void> {
    if (remaining === undefined) return;
    const desired = remaining === 'Destroyed' ? 0 : Math.max(0, Math.min(maximum, remaining));
    await dispatchEntity(force, member, {
        kind: 'set-armor-damage',
        faceId,
        damage: maximum - desired,
    });
}

async function applyEntityRemainingInternal(
    force: CBTForce,
    member: CBTForceMember,
    locationId: LocationId,
    maximum: number,
    remaining: number | 'Destroyed' | undefined,
): Promise<void> {
    if (remaining === undefined) return;
    const desired = remaining === 'Destroyed' ? 0 : Math.max(0, Math.min(maximum, remaining));
    await dispatchEntity(force, member, {
        kind: 'set-internal-damage',
        locationId,
        damage: maximum - desired,
    });
}

async function applyRemainingArmor(
    force: CBTForce,
    member: CBTMekForceMember,
    location: MekRecordSheetLocation,
    face: 'front' | 'rear',
    remaining: number | 'Destroyed' | undefined,
): Promise<void> {
    if (remaining === undefined) return;
    const target = location.armor.find(value => value.face === face);
    if (!target) return;
    const desired = remaining === 'Destroyed' ? 0 : Math.max(0, Math.min(target.maximum, remaining));
    const amount = target.committedRemaining - desired;
    if (amount > 0) await dispatchMek(force, member, { type: 'damage-armor', faceId: target.faceId, amount, target: 'committed' });
}

async function applyRemainingInternal(
    force: CBTForce,
    member: CBTMekForceMember,
    location: MekRecordSheetLocation,
    remaining: number | 'Destroyed' | undefined,
): Promise<void> {
    if (remaining === undefined) return;
    const desired = remaining === 'Destroyed' ? 0 : Math.max(0, Math.min(location.maximumInternal, remaining));
    const amount = location.committedRemainingInternal - desired;
    if (amount > 0) await dispatchMek(force, member, { type: 'damage-internal', locationId: location.locationId, amount, target: 'committed' });
}

async function dispatchMek(
    force: CBTForce,
    member: CBTMekForceMember,
    command: CBTUnitCommand,
): Promise<void> {
    const snapshot = force.getUnitSnapshot(member.id);
    if (!snapshot || !hasMekRuntime(snapshot)) {
        throw new Error(`Missing canonical runtime ${member.id}`);
    }
    const result = await force.dispatchMekUnitCommand(member.id, {
        ...command,
    } as CBTUnitCommand);
    if (!result.accepted) throw new Error('Cannot import MUL state into a read-only force');
}

async function dispatchEntity(
    force: CBTForce,
    member: CBTForceMember,
    command: NonMekUnitCommand,
): Promise<void> {
    const snapshot = requiredEntitySnapshot(force, member);
    const result = await force.dispatchNonMekUnitCommand(member.id, {
        ...command,
    } as NonMekUnitCommand);
    if (!result.accepted) throw new Error('Cannot import MUL state into a read-only force');
}

function requiredSheet(force: CBTForce, member: CBTMekForceMember): MekRecordSheetSnapshot {
    const sheet = force.getMekRecordSheetSnapshot(member.id);
    if (!sheet) throw new Error(`Missing canonical record-sheet projection ${member.id}`);
    return sheet;
}

function requiredEntitySnapshot(
    force: CBTForce,
    member: CBTForceMember,
): CBTNonMekUnitSnapshot {
    const snapshot = force.getUnitSnapshot(member.id);
    if (!snapshot || !hasNonMekRuntime(snapshot)) {
        throw new Error(`Missing canonical Entity runtime ${member.id}`);
    }
    return snapshot;
}

function slotHasPersistentState(slot: MekRecordSheetCriticalSlot): boolean {
    return slot.committedHits > 0 || slot.components.some(component =>
        component.status !== 'available' || (component.ammo !== undefined && component.ammo.remaining < component.ammo.capacity));
}

function getCrewType(sheet: MekRecordSheetSnapshot): MulCrewType {
    const cockpit = sheet.identity.cockpit.toLowerCase();
    if (cockpit.includes('command console')) return 'command_console';
    if (cockpit.includes('dual')) return 'dual';
    if (sheet.identity.form === 'quadvee') return 'quadvee';
    if (sheet.identity.form === 'tripod') return sheet.identity.massTons >= 100 ? 'superheavy_tripod' : 'tripod';
    return 'single';
}

function parseMulDocument(xmlText: string): XMLDocument {
    const doc = new DOMParser().parseFromString(xmlText, 'application/xml');
    const parserError = doc.querySelector('parsererror');
    if (parserError) throw new Error(parserError.textContent?.trim() || 'Invalid MUL XML file.');
    if (!doc.documentElement || (doc.documentElement.tagName !== 'unit' && doc.documentElement.tagName !== 'record')) {
        throw new Error('Invalid MUL file: missing <unit> or <record> root.');
    }
    return doc;
}

function getMulEntityElements(doc: XMLDocument): Element[] {
    const root = doc.documentElement;
    const rows = root.tagName === 'record'
        ? ['survivors', 'salvage'].flatMap(section => Array.from(root.querySelectorAll(`:scope > ${section} > entity`)))
        : Array.from(root.querySelectorAll(':scope > entity'));
    return rows.filter(entity => entity.getAttribute('chassis') !== 'Pilot');
}

function parseEntityCrew(entity: Element): ParsedMulCrewMember[] {
    const crew = entity.querySelector(':scope > crew');
    const rows = crew
        ? Array.from(crew.querySelectorAll(':scope > crewMember'))
        : [entity.querySelector(':scope > pilot')].filter((value): value is Element => value !== null);
    if (rows.length === 0) return [{ id: 0, name: '', gunnerySkill: 4, pilotingSkill: 5, hits: 0, ejected: false }];
    return rows.map((row, index) => ({
        id: parseNumber(row.getAttribute('slot'), index),
        name: row.getAttribute('name') ?? '',
        gunnerySkill: parseNumber(row.getAttribute('gunnery'), DEFAULT_GUNNERY_SKILL),
        pilotingSkill: parseNumber(row.getAttribute('piloting'), DEFAULT_PILOTING_SKILL),
        hits: parseNumber(row.getAttribute('hits'), 0),
        ejected: parseBoolean(row.getAttribute('ejected')),
    }));
}

function parseEntityLocations(entity: Element): ParsedMulLocation[] {
    return Array.from(entity.querySelectorAll(':scope > location')).map(location => {
        const index = Math.max(0, parseNumber(location.getAttribute('index'), 0));
        const parsed: ParsedMulLocation = {
            index,
            loc: CODE_BY_LOCATION_INDEX.get(index) ?? '',
            destroyed: parseBoolean(location.getAttribute('isDestroyed')),
            slots: [],
        };
        for (const armor of Array.from(location.querySelectorAll(':scope > armor'))) {
            const points = parseArmorPoints(armor.getAttribute('points'));
            if (armor.getAttribute('type') === 'Rear') parsed.rearArmor = points;
            else if (armor.getAttribute('type') === 'Internal') parsed.internal = points;
            else parsed.armor = points;
        }
        parsed.slots = Array.from(location.querySelectorAll(':scope > slot')).map(slot => ({
            loc: parsed.loc,
            slot: Math.max(0, parseNumber(slot.getAttribute('index'), 1) - 1),
            type: slot.getAttribute('type') ?? 'System',
            shots: slot.hasAttribute('shots') ? parseNumber(slot.getAttribute('shots'), 0) : undefined,
            armorHit: slot.hasAttribute('armorHit') ? parseBoolean(slot.getAttribute('armorHit')) : undefined,
            hit: parseBoolean(slot.getAttribute('isHit')),
            destroyed: parseBoolean(slot.getAttribute('isDestroyed')),
        }));
        return parsed;
    });
}

function createUnitLookup(units: readonly UnitSummary[]): Map<string, UnitSummary> {
    const result = new Map<string, UnitSummary>();
    for (const unit of units) {
        for (const key of [unitLookupKey(unit.chassis, unit.model), normalizeUnitLookup(unit.name)]) {
            if (!result.has(key)) result.set(key, unit);
        }
    }
    return result;
}

function unitLookupKey(chassis: string, model: string): string {
    return normalizeUnitLookup(`${chassis} ${model}`.trim());
}

function normalizeUnitLookup(value: string): string {
    return value.trim().replace(/\s+/g, ' ').toLowerCase();
}

function parseArmorPoints(value: string | null): number | 'Destroyed' | undefined {
    if (!value) return undefined;
    if (value.toLowerCase() === 'destroyed') return 'Destroyed';
    const parsed = Number.parseInt(value, 10);
    return Number.isFinite(parsed) ? parsed : undefined;
}

function parseNumber(value: string | null, fallback: number): number {
    const parsed = value === null || value === '' ? Number.NaN : Number.parseInt(value, 10);
    return Number.isFinite(parsed) ? parsed : fallback;
}

function parseBoolean(value: string | null): boolean {
    return value === 'true' || value === '1';
}

function locationIndex(code: string): number {
    return LOCATION_INDEX_BY_CODE.get(code) ?? 0;
}

function locationName(code: string): string {
    return ({ HD: 'Head', CT: 'Center Torso', RT: 'Right Torso', LT: 'Left Torso', RA: 'Right Arm', LA: 'Left Arm', RL: 'Right Leg', LL: 'Left Leg', CL: 'Center Leg', FRL: 'Front Right Leg', FLL: 'Front Left Leg', RRL: 'Rear Right Leg', RLL: 'Rear Left Leg' } as Record<string, string>)[code] ?? code;
}

function setAttributes(element: Element, attributes: Readonly<Record<string, string | number | boolean | null | undefined>>): void {
    for (const [name, value] of Object.entries(attributes)) if (value !== undefined && value !== null) element.setAttribute(name, String(value));
}

function appendIndented(parent: Node, doc: XMLDocument, child: Node, indent: string): void {
    parent.appendChild(doc.createTextNode(`\n${indent}`));
    parent.appendChild(child);
}

function appendClosingIndent(parent: Node, doc: XMLDocument, indent: string): void {
    parent.appendChild(doc.createTextNode(`\n${indent}`));
}

function errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}
