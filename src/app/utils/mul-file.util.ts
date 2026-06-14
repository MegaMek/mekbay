/*
 * Copyright (C) 2026 The MegaMek Team. All Rights Reserved.
 *
 * This file is part of MekBay.
 *
 * MekBay is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License (GPL),
 * version 3 or (at your option) any later version,
 * as published by the Free Software Foundation.
 *
 * MekBay is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty
 * of MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.
 * See the GNU General Public License for more details.
 *
 * A copy of the GPL should have been included with this project;
 * if not, see <https://www.gnu.org/licenses/>.
 *
 * NOTICE: The MegaMek organization is a non-profit group of volunteers
 * creating free software for the BattleTech community.
 *
 * MechWarrior, BattleMech, `Mech and AeroTech are registered trademarks
 * of The Topps Company, Inc. All Rights Reserved.
 *
 * Catalyst Game Labs and the Catalyst Game Labs logo are trademarks of
 * InMediaRes Productions, LLC.
 *
 * MechWarrior Copyright Microsoft Corporation. MegaMek was created under
 * Microsoft's "Game Content Usage Rules"
 * <https://www.xbox.com/en-US/developers/rules> and it is not endorsed by or
 * affiliated with Microsoft.
 */

import type { Injector } from '@angular/core';
import { APP_VERSION_STRING } from '../build-meta';
import { GameSystem } from '../models/common.model';
import { CBTForce } from '../models/cbt-force.model';
import type { CBTForceUnit } from '../models/cbt-force-unit.model';
import { CrewMember, DEFAULT_GUNNERY_SKILL, DEFAULT_PILOTING_SKILL } from '../models/crew-member.model';
import type { DataService } from '../services/data.service';
import type { UnitInitializerService } from '../services/unit-initializer.service';
import { generateUUID } from '../services/ws.service';
import type { CriticalSlot, LocationData } from '../models/force-serialization';
import type { Unit } from '../models/units.model';

const DEFAULT_ENTITY_ATTRIBUTES: Record<string, string> = {
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
};

const LOCATION_INDEX_BY_LOC = new Map<string, number>([
    ['HD', 0],
    ['NOS', 0],
    ['BODY', 0],
    ['CT', 1],
    ['RT', 2],
    ['LT', 3],
    ['RA', 4],
    ['LA', 5],
    ['RL', 6],
    ['LL', 7],
    ['CL', 8],
    ['FRL', 9],
    ['FLL', 10],
    ['RRL', 11],
    ['RLL', 12],
    ['TROOP', 0],
    ['SI', 0],
]);

const LOC_BY_LOCATION_INDEX = new Map<number, string>([
    [0, 'HD'],
    [1, 'CT'],
    [2, 'RT'],
    [3, 'LT'],
    [4, 'RA'],
    [5, 'LA'],
    [6, 'RL'],
    [7, 'LL'],
    [8, 'CL'],
    [9, 'FRL'],
    [10, 'FLL'],
    [11, 'RRL'],
    [12, 'RLL'],
]);

export interface MulParseIssue {
    severity: 'warning' | 'error';
    message: string;
}

export interface MulParseResult {
    force: CBTForce;
    issues: MulParseIssue[];
}

interface ParsedMulCrewMember {
    id: number;
    name: string;
    gunnerySkill: number;
    pilotingSkill: number;
    hits: number;
    state: number;
}

interface ParsedMulSlot {
    loc: string;
    slot: number;
    type: string;
    shots?: number;
    damageTaken?: number;
    armorHit?: boolean;
    hit: boolean;
    destroyed: boolean;
    repairable?: boolean;
}

interface ParsedMulLocation {
    loc: string;
    destroyed: boolean;
    armor?: number | 'Destroyed';
    rearArmor?: number | 'Destroyed';
    internal?: number | 'Destroyed';
    slots: ParsedMulSlot[];
}

type MulCrewType =
    | 'single'
    | 'crew'
    | 'vessel'
    | 'tripod'
    | 'superheavy_tripod'
    | 'quadvee'
    | 'dual'
    | 'command_console'
    | 'infantry_crew'
    | 'building'
    | 'none';

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

function downloadTextFile(filename: string, content: string, mimeType = 'application/xml'): void {
    const blob = new Blob([content], { type: `${mimeType};charset=utf-8` });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = filename;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(url);
}

function getUnitClanPerson(unit: Unit): boolean {
    return unit.techBase === 'Clan';
}

function getMulVersion(): string {
    return `mekbay-${APP_VERSION_STRING}`;
}

function getLocationIndex(loc: string): number {
    return LOCATION_INDEX_BY_LOC.get(loc) ?? 0;
}

function getLocationName(loc: string): string {
    switch (loc) {
        case 'HD': return 'Head';
        case 'CT': return 'Center Torso';
        case 'RT': return 'Right Torso';
        case 'LT': return 'Left Torso';
        case 'RA': return 'Right Arm';
        case 'LA': return 'Left Arm';
        case 'RL': return 'Right Leg';
        case 'LL': return 'Left Leg';
        case 'CL': return 'Center Leg';
        case 'FRL': return 'Front Right Leg';
        case 'FLL': return 'Front Left Leg';
        case 'RRL': return 'Rear Right Leg';
        case 'RLL': return 'Rear Left Leg';
        case 'TROOP': return 'Troopers';
        case 'SI': return 'Structural Integrity';
        default: return loc;
    }
}

function getArmorLocationKey(loc: string, rear: boolean): string {
    return rear ? `${loc}-rear` : loc;
}

function getRemainingPoints(total: number | undefined, hits: number | undefined): number | null {
    if (total === undefined || total <= 0) {
        return null;
    }
    const remaining = Math.max(0, total - (hits ?? 0));
    return remaining < total ? remaining : null;
}

function formatMulArmor(points: number | null): string | null {
    if (points === null) {
        return null;
    }
    return points <= 0 ? 'Destroyed' : String(points);
}

function getConsumedAmmoFromRemaining(totalAmmo: number | undefined, shots: number | undefined): number | undefined {
    if (totalAmmo === undefined || totalAmmo <= 0 || shots === undefined || shots < 0) {
        return undefined;
    }
    return Math.max(0, totalAmmo - shots);
}

function isModularArmorCrit(crit: CriticalSlot): boolean {
    return crit.eq?.flags?.has('F_MODULAR_ARMOR') === true;
}

function hasArmorHitToSave(crit: CriticalSlot): boolean {
    return crit.armored === true && (crit.hits ?? 0) > 0;
}

function hasSlotHitToSave(crit: CriticalSlot): boolean {
    return crit.armored === true ? (crit.hits ?? 0) >= 2 : (crit.hits ?? 0) > 0;
}

function parseArmorPoints(raw: string | null): number | 'Destroyed' | undefined {
    if (!raw) {
        return undefined;
    }
    if (raw.toLocaleLowerCase() === 'destroyed') {
        return 'Destroyed';
    }
    const value = Number.parseInt(raw, 10);
    return Number.isFinite(value) ? value : undefined;
}

function parseNumber(raw: string | null, fallback: number): number {
    if (raw === null || raw === '') {
        return fallback;
    }
    const value = Number.parseInt(raw, 10);
    return Number.isFinite(value) ? value : fallback;
}

function parseBoolean(raw: string | null): boolean {
    return raw === 'true' || raw === '1';
}

function createUnitLookup(units: readonly Unit[]): Map<string, Unit> {
    const lookup = new Map<string, Unit>();
    for (const unit of units) {
        const displayKey = getUnitLookupKey(unit.chassis, unit.model);
        const nameKey = normalizeUnitLookup(unit.name);
        if (!lookup.has(displayKey)) {
            lookup.set(displayKey, unit);
        }
        if (!lookup.has(nameKey)) {
            lookup.set(nameKey, unit);
        }
    }
    return lookup;
}

function getUnitLookupKey(chassis: string, model: string): string {
    return normalizeUnitLookup(`${chassis} ${model}`.trim());
}

function normalizeUnitLookup(value: string): string {
    return value.trim().replace(/\s+/g, ' ').toLocaleLowerCase();
}

function setAttributes(element: Element, attributes: Record<string, string | number | boolean | null | undefined>): void {
    for (const [name, value] of Object.entries(attributes)) {
        if (value === undefined || value === null) {
            continue;
        }
        element.setAttribute(name, String(value));
    }
}

function appendIndented(parent: Node, doc: XMLDocument, child: Node, indent: string): void {
    parent.appendChild(doc.createTextNode(`\n${indent}`));
    parent.appendChild(child);
}

function appendClosingIndent(parent: Node, doc: XMLDocument, indent: string): void {
    parent.appendChild(doc.createTextNode(`\n${indent}`));
}

function createCrewElement(doc: XMLDocument, unit: CBTForceUnit): Element {
    const baseUnit = unit.getUnit();
    const crew = unit.getCrewMembers();
    const crewType = getCrewType(baseUnit);
    const clanPerson = getUnitClanPerson(baseUnit);
    if (crewType !== 'single') {
        const crewElement = doc.createElement('crew');
        setAttributes(crewElement, {
            crewType,
            ejected: false,
            edge: '',
            autoeject: true,
        });
        const expectedCrewSlots = getExpectedCrewSlots(crewType);
        for (const crewMember of crew.filter(member => member.getId() < expectedCrewSlots)) {
            const crewMemberElement = doc.createElement('crewMember');
            setAttributes(crewMemberElement, {
                slot: crewMember.getId(),
                name: crewMember.getName(),
                nick: '',
                gender: 'RANDOMIZE',
                clanperson: clanPerson,
                gunnery: crewMember.getSkill('gunnery'),
                piloting: crewMember.getSkill('piloting'),
                externalId: generateUUID(),
            });
            appendIndented(crewElement, doc, crewMemberElement, '\t\t\t');
        }
        appendClosingIndent(crewElement, doc, '\t\t');
        return crewElement;
    }

    const pilot = crew[0];
    const pilotElement = doc.createElement('pilot');
    setAttributes(pilotElement, {
        size: 1,
        name: pilot?.getName() ?? '',
        nick: '',
        gender: 'RANDOMIZE',
        clanperson: clanPerson,
        gunnery: pilot?.getSkill('gunnery') ?? DEFAULT_GUNNERY_SKILL,
        piloting: pilot?.getSkill('piloting') ?? DEFAULT_PILOTING_SKILL,
        externalId: generateUUID(),
        ejected: false,
        edge: '',
        autoeject: true,
    });
    return pilotElement;
}

function getCrewType(unit: Unit): MulCrewType {
    const type = String(unit.type).toLocaleLowerCase();
    const subtype = String(unit.subtype).toLocaleLowerCase();
    const features = unit.features.map(feature => feature.toLocaleLowerCase());
    const components = unit.comp.map(component => `${component.id} ${component.n}`.toLocaleLowerCase());

    if (unit.crewSize <= 0 || unit.type === 'Handheld Weapon' || subtype === 'handheld weapon') {
        return 'none';
    }
    if (type.includes('building') || subtype.includes('building')) {
        return 'building';
    }
    if (features.some(feature => feature.includes('command console'))
        || components.some(component => component.includes('command console'))) {
        return 'command_console';
    }
    if (subtype.includes('quadvee')) {
        return 'quadvee';
    }
    if (unit.moveType === 'Tripod' || subtype.includes('tripod')) {
        if (unit.tons >= 100) {
            return 'superheavy_tripod';
        }
        return 'tripod';
    }
    if (features.some(feature => feature.includes('dual cockpit'))
        || components.some(component => component.includes('dual cockpit'))) {
        return 'dual';
    }
    if (unit.type === 'Infantry') {
        return 'infantry_crew';
    }
    if (subtype.includes('dropship') || subtype.includes('small craft') || subtype.includes('jumpship')
        || subtype.includes('warship') || subtype.includes('space station')) {
        return 'vessel';
    }
    if (unit.type === 'Tank' || unit.type === 'VTOL' || unit.type === 'Naval'
        || subtype.includes('support vehicle') || subtype.includes('combat vehicle')
        || subtype.includes('hovercraft') || subtype.includes('submarine') || subtype.includes('naval vessel')) {
        return 'crew';
    }
    if (unit.crewSize === 2) {
        return 'dual';
    }
    return 'single';
}

function getExpectedCrewSlots(crewType: MulCrewType): number {
    switch (crewType) {
        case 'tripod':
        case 'quadvee':
        case 'dual':
        case 'command_console':
            return 2;
        case 'superheavy_tripod':
            return 3;
        case 'none':
            return 0;
        default:
            return 1;
    }
}

function createLocationElements(doc: XMLDocument, unit: CBTForceUnit): Element[] {
    const elements: Element[] = [];
    const baseUnit = unit.getUnit();
    const locations = unit.getLocations();
    const crits = unit.getCritSlots();
    const groupedCrits = new Map<string, CriticalSlot[]>();
    for (const crit of crits) {
        if (!crit.loc || crit.slot === undefined) {
            continue;
        }
        const meaningful = !!crit.destroyed || (crit.hits ?? 0) > 0 || (crit.consumed ?? 0) > 0;
        if (!meaningful) {
            continue;
        }
        const locCrits = groupedCrits.get(crit.loc) ?? [];
        locCrits.push(crit);
        groupedCrits.set(crit.loc, locCrits);
    }

    const locs = new Set<string>();
    for (const key of Object.keys(locations)) {
        locs.add(key.replace(/-rear$/, ''));
    }
    for (const loc of groupedCrits.keys()) {
        locs.add(loc);
    }

    for (const loc of Array.from(locs).sort((a, b) => getLocationIndex(a) - getLocationIndex(b) || a.localeCompare(b))) {
        const locationElement = doc.createElement('location');
        setAttributes(locationElement, { index: getLocationIndex(loc) });
        locationElement.appendChild(doc.createTextNode(` ${getLocationName(loc)}`));
        const armorInfo = unit.locations?.armor.get(loc);
        const rearArmorInfo = unit.locations?.armor.get(`${loc}-rear`);
        const internalInfo = unit.locations?.internal.get(loc);
        const armorPoints = formatMulArmor(getRemainingPoints(armorInfo?.points, locations[getArmorLocationKey(loc, false)]?.armor));
        const rearArmorPoints = formatMulArmor(getRemainingPoints(rearArmorInfo?.points, locations[getArmorLocationKey(loc, true)]?.armor));
        const internalPoints = formatMulArmor(getRemainingPoints(internalInfo?.points, locations[loc]?.internal));

        if (internalPoints === 'Destroyed') {
            setAttributes(locationElement, { isDestroyed: true });
        }

        if (armorPoints !== null) {
            const armorElement = doc.createElement('armor');
            setAttributes(armorElement, { points: armorPoints });
            appendIndented(locationElement, doc, armorElement, '\t\t\t');
        }
        if (rearArmorPoints !== null) {
            const armorElement = doc.createElement('armor');
            setAttributes(armorElement, { points: rearArmorPoints, type: 'Rear' });
            appendIndented(locationElement, doc, armorElement, '\t\t\t');
        }
        if (internalPoints !== null) {
            const armorElement = doc.createElement('armor');
            setAttributes(armorElement, { points: internalPoints, type: 'Internal' });
            appendIndented(locationElement, doc, armorElement, '\t\t\t');
        }

        for (const crit of (groupedCrits.get(loc) ?? []).sort((a, b) => (a.slot ?? 0) - (b.slot ?? 0))) {
            const type = crit.originalName || crit.name || 'System';
            const slotElement = doc.createElement('slot');
            setAttributes(slotElement, {
                index: (crit.slot ?? 0) + 1,
                type,
            });
            if (crit.totalAmmo !== undefined) {
                const remainingAmmo = Math.max(0, crit.totalAmmo - (crit.consumed ?? 0));
                setAttributes(slotElement, { shots: remainingAmmo });
            }
            if (isModularArmorCrit(crit) && (crit.consumed ?? 0) > 0) {
                setAttributes(slotElement, { damageTaken: Math.max(0, crit.consumed ?? 0) });
            }
            if (hasArmorHitToSave(crit)) {
                setAttributes(slotElement, { armorHit: true });
            }
            if (hasSlotHitToSave(crit)) {
                setAttributes(slotElement, { isHit: true });
            }
            if (crit.destroyed) {
                setAttributes(slotElement, { isDestroyed: true });
            }
            appendIndented(locationElement, doc, slotElement, '\t\t\t');
        }

        if (locationElement.childElementCount === 0) {
            continue;
        }

        appendClosingIndent(locationElement, doc, '\t\t');
        elements.push(locationElement);
    }

    return elements;
}

function createEntityElement(doc: XMLDocument, forceUnit: CBTForceUnit, index: number): Element {
    const unit = forceUnit.getUnit();
    const entityElement = doc.createElement('entity');
    setAttributes(entityElement, {
        chassis: unit.chassis,
        model: unit.model,
        type: unit.moveType,
        commander: forceUnit.commander(),
        ...DEFAULT_ENTITY_ATTRIBUTES,
        externalId: forceUnit.id,
        quirks: unit.quirks.length > 0 ? unit.quirks.join('::') : undefined,
    });

    appendIndented(entityElement, doc, createCrewElement(doc, forceUnit), '\t\t');
    const locationElements = createLocationElements(doc, forceUnit);
    if (locationElements.length > 0) {
        entityElement.appendChild(doc.createTextNode('\n\t\tThe first slot in a location is at index="1".'));
        for (const locationElement of locationElements) {
            appendIndented(entityElement, doc, locationElement, '\t\t');
        }
    }

    const gameElement = doc.createElement('Game');
    setAttributes(gameElement, { id: index + 1 });
    appendIndented(entityElement, doc, gameElement, '\t\t');
    appendClosingIndent(entityElement, doc, '\t');
    return entityElement;
}

export async function serializeForceToMul(force: CBTForce): Promise<string> {
    if (force.gameSystem !== GameSystem.CLASSIC) {
        throw new Error('MUL export is only available for Classic BattleTech forces.');
    }

    for (const unit of force.units()) {
        await unit.load();
    }

    const doc = document.implementation.createDocument('', 'unit');
    const root = doc.documentElement;
    setAttributes(root, { version: getMulVersion() });

    force.units().forEach((forceUnit, index) => {
        appendIndented(root, doc, createEntityElement(doc, forceUnit, index), '\t');
        root.appendChild(doc.createTextNode('\n'));
    });
    appendClosingIndent(root, doc, '');

    return `<?xml version="1.0" encoding="UTF-8"?>\n\n${new XMLSerializer().serializeToString(doc)}`;
}

export async function exportForceToMul(force: CBTForce): Promise<void> {
    const xml = await serializeForceToMul(force);
    downloadTextFile(`${sanitizeMulFilename(force.name)}.mul`, xml);
}

function parseMulDocument(xmlText: string): XMLDocument {
    const parser = new DOMParser();
    const doc = parser.parseFromString(xmlText, 'application/xml');
    const parserError = doc.querySelector('parsererror');
    if (parserError) {
        throw new Error(parserError.textContent?.trim() || 'Invalid MUL XML file.');
    }

    const root = doc.documentElement;
    if (!root || (root.tagName !== 'unit' && root.tagName !== 'record')) {
        throw new Error('Invalid MUL file: missing <unit> or <record> root.');
    }
    return doc;
}

function getMulEntityElements(doc: XMLDocument): Element[] {
    const root = doc.documentElement;
    const entities = root.tagName === 'record'
        ? ['survivors', 'salvage'].flatMap(section => Array.from(root.querySelectorAll(`:scope > ${section} > entity`)))
        : Array.from(root.querySelectorAll(':scope > entity'));
    return entities.filter(entity => entity.getAttribute('chassis') !== 'Pilot');
}

export async function parseMulForce(
    xmlText: string,
    forceName: string,
    dataService: DataService,
    unitInitializer: UnitInitializerService,
    injector: Injector,
): Promise<MulParseResult> {
    const doc = parseMulDocument(xmlText);
    const issues: MulParseIssue[] = [];
    const unitLookup = createUnitLookup(dataService.getUnits());
    const force = new CBTForce(forceName || 'Imported MUL Force', dataService, unitInitializer, injector);
    const entities = getMulEntityElements(doc);

    force.loading = true;
    try {
        for (const entity of entities) {
            const chassis = entity.getAttribute('chassis') ?? '';
            const model = entity.getAttribute('model') ?? '';
            const unit = unitLookup.get(getUnitLookupKey(chassis, model));
            if (!unit) {
                issues.push({ severity: 'error', message: `Unit "${[chassis, model].filter(Boolean).join(' ')}" was not found.` });
                continue;
            }

            const forceUnit = force.addUnit(unit);
            forceUnit.id = entity.getAttribute('externalId') || forceUnit.id;
            await forceUnit.load();
            const disabledSaving = forceUnit.disabledSaving;
            const parsedLocations = parseEntityLocations(entity);
            forceUnit.disabledSaving = true;
            try {
                forceUnit.setFormationCommander(parseBoolean(entity.getAttribute('commander')), false);
                applyMulCrewToUnit(forceUnit, parseEntityCrew(entity));
                applyMulSlotsToCritSlots(forceUnit, parsedLocations, issues);
                forceUnit.setLocations(createLocationsFromMul(forceUnit, parsedLocations), true);
                forceUnit.svgService?.forceRepaint(); // Force SVG update to reflect changes
            } finally {
                forceUnit.disabledSaving = disabledSaving;
            }
        }
    } finally {
        force.loading = false;
    }
    if (force.units().length === 0) {
        throw new Error(issues.find(issue => issue.severity === 'error')?.message || 'The MUL file did not contain any loadable units.');
    }
    return {
        force,
        issues,
    };
}

function parseEntityCrew(entity: Element): ParsedMulCrewMember[] {
    const crewElement = entity.querySelector(':scope > crew');
    if (crewElement) {
        const members = Array.from(crewElement.querySelectorAll(':scope > crewMember'));
        return members.map((member, index) => ({
            id: parseNumber(member.getAttribute('slot'), index),
            name: member.getAttribute('name') ?? '',
            gunnerySkill: parseNumber(member.getAttribute('gunnery'), DEFAULT_GUNNERY_SKILL),
            pilotingSkill: parseNumber(member.getAttribute('piloting'), DEFAULT_PILOTING_SKILL),
            hits: parseNumber(member.getAttribute('hits'), 0),
            state: parseBoolean(member.getAttribute('ejected')) ? 1 : 0,
        }));
    }

    const pilot = entity.querySelector(':scope > pilot');
    if (!pilot) {
        return [{ id: 0, name: '', gunnerySkill: DEFAULT_GUNNERY_SKILL, pilotingSkill: DEFAULT_PILOTING_SKILL, hits: 0, state: 0 }];
    }

    return [{
        id: 0,
        name: pilot.getAttribute('name') ?? '',
        gunnerySkill: parseNumber(pilot.getAttribute('gunnery'), DEFAULT_GUNNERY_SKILL),
        pilotingSkill: parseNumber(pilot.getAttribute('piloting'), DEFAULT_PILOTING_SKILL),
        hits: parseNumber(pilot.getAttribute('hits'), 0),
        state: parseBoolean(pilot.getAttribute('ejected')) ? 1 : 0,
    }];
}

function parseEntityLocations(entity: Element): ParsedMulLocation[] {
    return Array.from(entity.querySelectorAll(':scope > location')).map(location => {
        const loc = LOC_BY_LOCATION_INDEX.get(parseNumber(location.getAttribute('index'), 0)) ?? '';
        const parsed: ParsedMulLocation = { loc, destroyed: parseBoolean(location.getAttribute('isDestroyed')), slots: [] };
        for (const armor of Array.from(location.querySelectorAll(':scope > armor'))) {
            const type = armor.getAttribute('type');
            const points = parseArmorPoints(armor.getAttribute('points'));
            if (type === 'Rear') {
                parsed.rearArmor = points;
            } else if (type === 'Internal') {
                parsed.internal = points;
            } else {
                parsed.armor = points;
            }
        }
        parsed.slots = Array.from(location.querySelectorAll(':scope > slot')).map(slot => ({
            loc,
            slot: Math.max(0, parseNumber(slot.getAttribute('index'), 1) - 1),
            type: slot.getAttribute('type') ?? 'System',
            shots: slot.hasAttribute('shots') ? parseNumber(slot.getAttribute('shots'), 0) : undefined,
            damageTaken: slot.hasAttribute('damageTaken') ? parseNumber(slot.getAttribute('damageTaken'), 0) : undefined,
            armorHit: slot.hasAttribute('armorHit') ? parseBoolean(slot.getAttribute('armorHit')) : undefined,
            hit: parseBoolean(slot.getAttribute('isHit')),
            destroyed: parseBoolean(slot.getAttribute('isDestroyed')),
            repairable: slot.hasAttribute('isRepairable') ? parseBoolean(slot.getAttribute('isRepairable')) : undefined,
        }));
        return parsed;
    }).filter(location => location.loc);
}

function applyMulCrewToUnit(unit: CBTForceUnit, crew: readonly ParsedMulCrewMember[]): void {
    for (const member of crew) {
        const existing = unit.getCrewMember(member.id);
        if (existing) {
            existing.update(member);
            unit.setCrewMember(member.id, existing);
            continue;
        }
        unit.setCrewMember(member.id, CrewMember.deserialize(member, unit));
    }
}

function applyMulSlotsToCritSlots(
    unit: CBTForceUnit,
    parsedLocations: readonly ParsedMulLocation[],
    issues: MulParseIssue[],
): void {
    const crits = [...unit.getCritSlots()];
    const now = Date.now();
    let changed = false;

    for (const parsedLocation of parsedLocations) {
        for (const slot of parsedLocation.slots) {
            const crit = crits.find(candidate => candidate.loc === slot.loc && candidate.slot === slot.slot);
            if (!crit) {
                issues.push({
                    severity: 'warning',
                    message: `MUL slot ${slot.loc} #${slot.slot + 1} (${slot.type}) did not match a critical slot on ${unit.getUnit().chassis} ${unit.getUnit().model}.`,
                });
                continue;
            }

            warnOnMulSlotTypeMismatch(unit, slot, crit, issues);
            changed = applyMulSlotToCritSlot(crit, slot, now) || changed;
        }
    }

    if (changed) {
        unit.setCritSlots(crits, true);
    }
}

function warnOnMulSlotTypeMismatch(
    unit: CBTForceUnit,
    slot: ParsedMulSlot,
    crit: CriticalSlot,
    issues: MulParseIssue[],
): void {
    const candidates = [crit.name, crit.originalName, crit.eq?.id]
        .filter((value): value is string => typeof value === 'string' && value.length > 0);
    if (candidates.length === 0 || candidates.includes(slot.type)) {
        return;
    }
    issues.push({
        severity: 'warning',
        message: `MUL slot ${slot.loc} #${slot.slot + 1} has type "${slot.type}", but ${unit.getUnit().chassis} ${unit.getUnit().model} has "${candidates[0]}" there. Using the catalog critical slot.`,
    });
}

function applyMulSlotToCritSlot(crit: CriticalSlot, slot: ParsedMulSlot, timestamp: number): boolean {
    let changed = false;

    if (slot.armorHit) {
        changed = setCriticalSlotValue(crit, 'armored', true) || changed;
        changed = setCriticalSlotValue(crit, 'hits', slot.hit ? 2 : 1) || changed;
    } else if (slot.hit) {
        changed = setCriticalSlotValue(crit, 'hits', 1) || changed;
    }
    if (slot.destroyed) {
        changed = setCriticalSlotValue(crit, 'destroyed', timestamp) || changed;
    }

    if (isModularArmorCrit(crit)) {
        changed = setCriticalSlotValue(crit, 'consumed', Math.max(0, slot.damageTaken ?? 0)) || changed;
        return changed;
    }

    const totalAmmo = getCriticalSlotTotalAmmo(crit);
    const consumed = getConsumedAmmoFromRemaining(totalAmmo, slot.shots);
    if (totalAmmo !== undefined) {
        changed = setCriticalSlotValue(crit, 'totalAmmo', totalAmmo) || changed;
    }
    if (consumed !== undefined) {
        changed = setCriticalSlotValue(crit, 'consumed', consumed) || changed;
    }
    return changed;
}

function getCriticalSlotTotalAmmo(crit: CriticalSlot): number | undefined {
    if (crit.totalAmmo !== undefined && crit.totalAmmo > 0) {
        return crit.totalAmmo;
    }
    const totalAmmo = parseNumber(crit.el?.getAttribute('totalAmmo') ?? null, 0);
    return totalAmmo > 0 ? totalAmmo : undefined;
}

function setCriticalSlotValue<K extends keyof CriticalSlot>(crit: CriticalSlot, key: K, value: CriticalSlot[K]): boolean {
    if (crit[key] === value) {
        return false;
    }
    crit[key] = value;
    return true;
}

function createLocationsFromMul(
    forceUnit: CBTForceUnit,
    parsedLocations: readonly ParsedMulLocation[]
): Record<string, LocationData> {
    const locations: Record<string, LocationData> = {};
    for (const parsedLocation of parsedLocations) {
        if (parsedLocation.destroyed) {
            applyLocationDamage(locations, parsedLocation.loc, false, 'Destroyed', forceUnit);
            applyLocationDamage(locations, parsedLocation.loc, true, 'Destroyed', forceUnit);
            applyInternalDamage(locations, parsedLocation.loc, 'Destroyed', forceUnit);
        }
        applyLocationDamage(locations, parsedLocation.loc, false, parsedLocation.armor, forceUnit);
        applyLocationDamage(locations, parsedLocation.loc, true, parsedLocation.rearArmor, forceUnit);
        applyInternalDamage(locations, parsedLocation.loc, parsedLocation.internal, forceUnit);
    }
    return locations;
}

function applyLocationDamage(
    locations: Record<string, LocationData>,
    loc: string,
    rear: boolean,
    remainingPoints: number | 'Destroyed' | undefined,
    forceUnit: CBTForceUnit,
): void {
    if (remainingPoints === undefined) {
        return;
    }
    const key = getArmorLocationKey(loc, rear);
    const total = getBaseArmorPoints(forceUnit, loc, rear);
    const damage = remainingPoints === 'Destroyed' ? Math.max(total, 1) : Math.max(0, total - remainingPoints);
    if (damage <= 0) {
        return;
    }
    locations[key] = { ...(locations[key] ?? {}), armor: damage };
}

function applyInternalDamage(
    locations: Record<string, LocationData>,
    loc: string,
    remainingPoints: number | 'Destroyed' | undefined,
    forceUnit: CBTForceUnit,
): void {
    if (remainingPoints === undefined) {
        return;
    }
    const total = getBaseInternalPoints(forceUnit, loc);
    const damage = remainingPoints === 'Destroyed' ? Math.max(total, 1) : Math.max(0, total - remainingPoints);
    if (damage <= 0) {
        return;
    }
    locations[loc] = { ...(locations[loc] ?? {}), internal: damage };
}

function getBaseArmorPoints(forceUnit: CBTForceUnit, loc: string, rear: boolean): number {
    const locKey = getArmorLocationKey(loc, rear);
    const loadedTotal = forceUnit?.locations?.armor.get(locKey)?.points;
    if (loadedTotal !== undefined) {
        return loadedTotal;
    }
    if (rear) {
        return 0;
    }
    const unit = forceUnit.getUnit();
    if (loc === 'TROOP') {
        return unit.squads && unit.squadSize ? unit.squads * unit.squadSize : unit.internal;
    }
    return Math.max(0, Math.round(unit.armor / Math.max(1, getApproximateLocationCount(unit))));
}

function getBaseInternalPoints(forceUnit: CBTForceUnit, loc: string): number {
    const loadedTotal = forceUnit?.locations?.internal.get(loc)?.points;
    if (loadedTotal !== undefined) {
        return loadedTotal;
    }
    const unit = forceUnit.getUnit();
    if (loc === 'TROOP') {
        return unit.squads && unit.squadSize ? unit.squads * unit.squadSize : unit.internal;
    }
    return Math.max(0, Math.round(unit.internal / Math.max(1, getApproximateLocationCount(unit))));
}

function getApproximateLocationCount(unit: Unit): number {
    switch (unit.moveType) {
        case 'Biped':
            return 8;
        case 'Tripod':
            return 9;
        case 'Quad':
            return 11;
        default:
            return 5;
    }
}
