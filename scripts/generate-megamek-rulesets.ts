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

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { XMLParser } from 'fast-xml-parser';

const {
    loadOptionalEnvFile,
    resolveMmDataRoot,
} = require('./lib/script-paths.js') as typeof import('./lib/script-paths.js');

type JsonObject = Record<string, unknown>;

interface RulesetRecord {
    factionKey: string;
    parentFactionKey?: string;
    ratingSystem?: string;
    assign?: JsonObject;
    customRanks?: JsonObject;
    defaults?: JsonObject;
    toc?: JsonObject;
    forces: JsonObject[];
    indexes: {
        forceIndexesByEchelon: Record<string, number[]>;
    };
    forceCount: number;
}

const APP_ROOT = path.resolve(__dirname, '..');
const BEAUTIFY_OUTPUT = true;
const JSON_INDENT = 2;
const INLINE_JSON_ARRAY_MAX_ITEMS = 8;
const INLINE_JSON_ARRAY_MAX_LENGTH = 40;

loadOptionalEnvFile(APP_ROOT, { logPrefix: 'MegaMek Rulesets' });

const MM_DATA_ROOT = resolveMmDataRoot(APP_ROOT);
const FORCEGEN_ROOT = path.join(MM_DATA_ROOT, 'data', 'forcegenerator');
const OUTPUT_PATH = path.join(APP_ROOT, 'public', 'assets', 'rulesets.json');

function shouldTreatXmlNodeAsArray(name: string, jpath: unknown): boolean {
    const pathKey = typeof jpath === 'string' ? jpath : '';
    return [
        'ruleset.customRanks.rank',
        'ruleset.defaults.unitType',
        'ruleset.defaults.echelon',
        'ruleset.defaults.rankSystem',
        'ruleset.defaults.rating',
        'ruleset.toc.unitType.option',
        'ruleset.toc.echelon.option',
        'ruleset.toc.rating.option',
        'ruleset.toc.flags.option',
        'ruleset.force',
    ].includes(pathKey)
        || name === 'option'
        || name === 'subforceOption'
        || name === 'subforce'
        || name === 'name'
        || name === 'co'
        || name === 'xo'
        || name === 'ruleGroup'
        || name === 'subforces'
        || name === 'attachedForces';
}

const rulesetXmlParser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: '@_',
    trimValues: true,
    parseTagValue: false,
    parseAttributeValue: false,
    isArray: (name, jpath) => shouldTreatXmlNodeAsArray(name, jpath),
});

const ECHELON_TOKEN_RE = /^([0-9]+|%[A-Z_]+%)([+\-^])?$/;
const CONSTANT_TOKEN_RE = /^%([A-Z_]+)%$/;

const PREDICATE_ATTR_NAMES = new Set([
    'ifUnitType', 'ifWeightClass', 'ifRating', 'ifEschelon',
    'ifFormation', 'ifRole', 'ifMotive', 'ifAugmented',
    'ifDateBetween', 'ifYearBetween', 'ifTopLevel', 'ifName',
    'ifFaction', 'ifFlags', 'ifIndex',
]);

const ASSERTION_ATTR_NAMES = new Set([
    'unitType', 'weightClass', 'rating', 'formation', 'role',
    'motive', 'augmented', 'chassis', 'model', 'variant',
    'name', 'fluffName', 'faction', 'flags',
]);

function parseYear(value: unknown): number | undefined {
    if (value === undefined || value === null || value === '') {
        return undefined;
    }

    const raw = String(value).trim();
    const match = raw.match(/^(\d{4})/);
    return match ? Number.parseInt(match[1], 10) : undefined;
}

function parseDateBetweenAttribute(value: string): { fromYear?: number; toYear?: number } {
    const [fromRaw = '', toRaw = ''] = value.split(',', 2);
    const fromYear = parseYear(fromRaw);
    const toYear = parseYear(toRaw);

    return {
        fromYear,
        toYear,
    };
}

function parseEchelonToken(raw: string): JsonObject {
    const token = raw.trim();
    const match = token.match(ECHELON_TOKEN_RE);
    if (!match) {
        return { echelon: normalizeConstantToken(token) };
    }

    const result: JsonObject = { echelon: normalizeConstantToken(match[1]) };
    if (match[2] === '^') {
        result.augmented = true;
    } else if (match[2] === '+') {
        result.modifier = 'R';
    } else if (match[2] === '-') {
        result.modifier = 'US';
    }
    return result;
}

function isEchelonList(text: string): boolean {
    const tokens = text.split(',');
    return tokens.length > 0 && tokens.every((token) => ECHELON_TOKEN_RE.test(token.trim()));
}

function normalizeConstantToken(value: string): string {
    const match = value.trim().match(CONSTANT_TOKEN_RE);
    return match ? match[1] : value.trim();
}

function splitDelimitedValues(value: string, delimiter = ','): string[] {
    return value.split(delimiter).map((entry) => entry.trim()).filter(Boolean);
}

function parseBooleanToken(value: string): boolean | undefined {
    const normalized = value.trim().toLowerCase();
    if (['1', 'true', 'yes'].includes(normalized)) {
        return true;
    }
    if (['0', 'false', 'no'].includes(normalized)) {
        return false;
    }
    return undefined;
}

function parseCodeLabelToken(raw: string): JsonObject {
    const [codePart, ...labelParts] = raw.split(':');
    const code = normalizeConstantToken(codePart);
    const label = labelParts.join(':').trim();
    return label ? { code, label } : { code };
}

function parseCodeLabelList(value: string): JsonObject[] {
    return splitDelimitedValues(value).map((entry) => parseCodeLabelToken(entry));
}

function parseStringList(value: string): string[] {
    return splitDelimitedValues(value).map((entry) => normalizeConstantToken(entry));
}

function parseEchelonList(value: string): JsonObject[] {
    return splitDelimitedValues(value).map((entry) => parseEchelonToken(entry));
}

function parseSingleEchelon(value: string): JsonObject | string {
    const parsed = parseEchelonList(value);
    return parsed.length === 1 ? parsed[0] : value.trim();
}

function mergeNormalizedContent(target: JsonObject, content: unknown): void {
    if (content === undefined) {
        return;
    }

    if (content && typeof content === 'object' && !Array.isArray(content)) {
        Object.assign(target, content as JsonObject);
        return;
    }

    target.value = content;
}

function normalizeRulesetScalar(raw: string, pathSegments: string[]): unknown {
    const nodeName = pathSegments[pathSegments.length - 1] || '';
    const parentName = pathSegments[pathSegments.length - 2] || '';
    const trimmed = raw.trim();

    if (trimmed === '') {
        if ([
            'option', 'subforce', 'name', 'co', 'xo', 'unitType', 'echelon',
            'rankSystem', 'rating', 'weightClass', 'formation', 'role',
            'motive', 'flags', 'chassis', 'variant', 'changeEschelon', 'rank',
        ].includes(nodeName)) {
            return {};
        }
        return '';
    }

    if (nodeName === 'asParent') {
        return true;
    }

    if (nodeName === 'asFaction') {
        return normalizeConstantToken(trimmed);
    }

    if (nodeName === 'base') {
        return normalizeConstantToken(trimmed);
    }

    if (nodeName === 'rank') {
        return parseCodeLabelToken(trimmed);
    }

    if (nodeName === 'co' || nodeName === 'xo') {
        return { rank: normalizeConstantToken(trimmed) };
    }

    if (nodeName === 'name') {
        return { name: trimmed };
    }

    if (nodeName === 'subforce') {
        return { echelon: parseSingleEchelon(trimmed) };
    }

    if (nodeName === 'unitType' || (nodeName === 'option' && parentName === 'unitType')) {
        return { unitTypes: parseStringList(trimmed) };
    }

    if (nodeName === 'echelon' || (nodeName === 'option' && parentName === 'echelon')) {
        return { echelons: parseEchelonList(trimmed) };
    }

    if (nodeName === 'rankSystem') {
        return { rankSystems: parseStringList(trimmed) };
    }

    if (nodeName === 'rating' || (nodeName === 'option' && parentName === 'rating')) {
        return { ratings: parseCodeLabelList(trimmed) };
    }

    if (nodeName === 'weightClass' || (nodeName === 'option' && parentName === 'weightClass')) {
        return { weightClasses: parseStringList(trimmed) };
    }

    if (nodeName === 'formation' || (nodeName === 'option' && parentName === 'formation')) {
        return { formations: parseStringList(trimmed) };
    }

    if (nodeName === 'role' || (nodeName === 'option' && parentName === 'role')) {
        return { roles: parseStringList(trimmed) };
    }

    if (nodeName === 'motive' || (nodeName === 'option' && parentName === 'motive')) {
        return { motives: parseStringList(trimmed) };
    }

    if (nodeName === 'flags' || (nodeName === 'option' && parentName === 'flags')) {
        return { flags: parseStringList(trimmed) };
    }

    if (nodeName === 'chassis' || (nodeName === 'option' && parentName === 'chassis')) {
        return { chassis: parseStringList(trimmed) };
    }

    if (nodeName === 'variant' || (nodeName === 'option' && parentName === 'variant')) {
        return { variants: parseStringList(trimmed) };
    }

    if (nodeName === 'changeEschelon' || (nodeName === 'option' && parentName === 'changeEschelon')) {
        const echelons = parseEchelonList(trimmed);
        return echelons.length === 1 ? { echelon: echelons[0] } : { echelons };
    }

    if (isEchelonList(trimmed)) {
        const echelons = parseEchelonList(trimmed);
        return echelons.length === 1 ? { echelon: echelons[0] } : { echelons };
    }

    return normalizeConstantToken(trimmed);
}

function normalizeRulesetAttributeValue(attrName: string, attrValue: string): unknown {
    switch (attrName) {
        case 'ifUnitType':
        case 'unitType':
        case 'ifFormation':
        case 'ifRole':
        case 'ifMotive':
        case 'ifName':
        case 'ifFaction':
        case 'ifFlags':
        case 'ifIndex':
            return splitDelimitedValues(attrValue, '|');
        case 'ifWeightClass':
            return splitDelimitedValues(attrValue, '|');
        case 'ifRating':
            return splitDelimitedValues(attrValue, '|');
        case 'ifEschelon':
            return splitDelimitedValues(attrValue, '|').map((entry) => parseEchelonToken(entry));
        case 'weightClass':
            return splitDelimitedValues(attrValue);
        case 'rating':
            return splitDelimitedValues(attrValue);
        case 'formation':
            return splitDelimitedValues(attrValue);
        case 'role':
            return splitDelimitedValues(attrValue);
        case 'motive':
            return splitDelimitedValues(attrValue);
        case 'flags':
            return splitDelimitedValues(attrValue);
        case 'augmented':
        case 'ifAugmented':
        case 'ifTopLevel': {
            const parsed = parseBooleanToken(attrValue);
            return parsed === undefined ? attrValue : parsed;
        }
        case 'echelon':
            return parseSingleEchelon(attrValue);
        case 'weight':
        case 'num':
        case 'position':
            return Number.parseInt(attrValue, 10);
        default:
            return normalizeConstantToken(attrValue);
    }
}

function mapPredicateAttrName(attrName: string): string {
    switch (attrName) {
        case 'ifUnitType':
            return 'unitTypes';
        case 'ifWeightClass':
            return 'weightClasses';
        case 'ifRating':
            return 'ratings';
        case 'ifEschelon':
            return 'echelons';
        case 'ifFormation':
            return 'formations';
        case 'ifRole':
            return 'roles';
        case 'ifMotive':
            return 'motives';
        case 'ifAugmented':
            return 'augmented';
        case 'ifTopLevel':
            return 'topLevel';
        case 'ifName':
            return 'names';
        case 'ifFaction':
            return 'factions';
        case 'ifFlags':
            return 'flags';
        case 'ifIndex':
            return 'indexes';
        default:
            return attrName;
    }
}

function mapAssertionAttrName(attrName: string): string {
    switch (attrName) {
        case 'unitType':
            return 'unitTypes';
        case 'weightClass':
            return 'weightClasses';
        case 'rating':
            return 'ratings';
        case 'formation':
            return 'formations';
        case 'role':
            return 'roles';
        case 'motive':
            return 'motives';
        case 'flags':
            return 'flags';
        default:
            return attrName;
    }
}

function mapRulesetChildKey(key: string, pathSegments: string[]): string {
    if (key === 'force' && pathSegments.length === 1 && pathSegments[0] === 'ruleset') {
        return 'forces';
    }
    if (key === 'option') {
        return 'options';
    }
    if (key === 'subforce') {
        return 'subforces';
    }
    if (key === 'subforceOption') {
        return 'subforceOptions';
    }
    return key;
}

function normalizeRulesetNode(value: unknown, pathSegments: string[] = []): unknown {
    if (value === undefined || value === null) {
        return undefined;
    }

    if (Array.isArray(value)) {
        return value.map((entry) => normalizeRulesetNode(entry, pathSegments));
    }

    if (typeof value !== 'object') {
        return normalizeRulesetScalar(String(value), pathSegments);
    }

    const source = value as Record<string, unknown>;
    const normalized: JsonObject = {};
    const when: JsonObject = {};
    const assign: JsonObject = {};

    for (const [key, entry] of Object.entries(source)) {
        if (key === '#text') {
            mergeNormalizedContent(normalized, normalizeRulesetScalar(String(entry), pathSegments));
            continue;
        }

        if (key.startsWith('@_')) {
            const attrName = key.slice(2);
            const attrValue = entry === undefined || entry === null ? '' : String(entry);

            if (attrName === 'ifDateBetween' || attrName === 'ifYearBetween') {
                const { fromYear, toYear } = parseDateBetweenAttribute(attrValue);
                if (fromYear !== undefined) {
                    when.fromYear = fromYear;
                }
                if (toYear !== undefined) {
                    when.toYear = toYear;
                }
                continue;
            }

            if (attrName === 'xmlns:xsi' || attrName === 'xsi:noNamespaceSchemaLocation') {
                continue;
            }

            if (PREDICATE_ATTR_NAMES.has(attrName)) {
                when[mapPredicateAttrName(attrName)] = normalizeRulesetAttributeValue(attrName, attrValue);
                continue;
            }

            if (ASSERTION_ATTR_NAMES.has(attrName)) {
                assign[mapAssertionAttrName(attrName)] = normalizeRulesetAttributeValue(attrName, attrValue);
                continue;
            }

            switch (attrName) {
                case 'echelon':
                    normalized.echelon = normalizeRulesetAttributeValue(attrName, attrValue);
                    break;
                case 'eschName':
                    normalized.echelonName = attrValue;
                    break;
                case 'weight':
                case 'num':
                case 'position':
                    normalized[attrName] = normalizeRulesetAttributeValue(attrName, attrValue);
                    break;
                case 'title':
                case 'generate':
                case 'faction':
                case 'ratingSystem':
                    if (attrValue !== '') {
                        normalized[attrName] = attrValue;
                    }
                    break;
                default:
                    normalized[attrName] = normalizeRulesetAttributeValue(attrName, attrValue);
                    break;
            }
            continue;
        }

        const child = normalizeRulesetNode(entry, [...pathSegments, key]);
        if (child !== undefined) {
            normalized[mapRulesetChildKey(key, pathSegments)] = child;
        }
    }

    if (Object.keys(when).length > 0) {
        normalized.when = when;
    }

    if (Object.keys(assign).length > 0) {
        normalized.assign = assign;
    }

    return normalized;
}

function isLegacyRulesetEchelonToken(value: unknown): value is JsonObject & { echelon: string } {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        return false;
    }

    const keys = Object.keys(value as JsonObject);
    return 'echelon' in (value as JsonObject)
        && keys.every((key) => ['echelon', 'modifier', 'augmented'].includes(key));
}

function mapRulesetExportKey(key: string): string {
    switch (key) {
        case 'faction':
            return 'factionKey';
        case 'num':
            return 'count';
        case 'asFaction':
            return 'asFactionKey';
        case 'asParent':
            return 'useParentFaction';
        default:
            return key;
    }
}

function finalizeRulesetExportValue(value: unknown): unknown {
    if (value === undefined || value === null) {
        return undefined;
    }

    if (Array.isArray(value)) {
        return value
            .map((entry) => finalizeRulesetExportValue(entry))
            .filter((entry) => entry !== undefined);
    }

    if (isLegacyRulesetEchelonToken(value)) {
        return {
            code: String(value.echelon),
            ...(value.modifier === undefined ? {} : { modifier: value.modifier }),
            ...(value.augmented === undefined ? {} : { augmented: value.augmented }),
        };
    }

    if (typeof value !== 'object') {
        return value;
    }

    const source = value as JsonObject;
    const normalized: JsonObject = {};

    for (const [key, entry] of Object.entries(source)) {
        if (key === 'parent' || key === 'ratingSystem') {
            continue;
        }

        const nextValue = finalizeRulesetExportValue(entry);
        if (nextValue === undefined) {
            continue;
        }

        normalized[mapRulesetExportKey(key)] = key === 'asParent'
            ? Boolean(nextValue)
            : nextValue;
    }

    return normalized;
}

function buildRulesetIndexes(forces: JsonObject[]): { forceIndexesByEchelon: Record<string, number[]> } {
    const forceIndexesByEchelon: Record<string, number[]> = {};

    forces.forEach((force, index) => {
        const echelon = force.echelon;
        if (!echelon || typeof echelon !== 'object' || Array.isArray(echelon)) {
            return;
        }

        const code = typeof (echelon as JsonObject).code === 'string'
            ? String((echelon as JsonObject).code)
            : '';
        if (!code) {
            return;
        }

        const bucket = forceIndexesByEchelon[code] ?? [];
        bucket.push(index);
        forceIndexesByEchelon[code] = bucket;
    });

    return { forceIndexesByEchelon };
}

function readText(filePath: string): string {
    return fs.readFileSync(filePath, 'utf8');
}

function listFiles(dirPath: string, extension: string): string[] {
    return fs.readdirSync(dirPath)
        .filter((name) => name.toLowerCase().endsWith(extension.toLowerCase()))
        .sort((left, right) => left.localeCompare(right));
}

function loadRulesets(dirPath: string): RulesetRecord[] {
    const result: RulesetRecord[] = [];
    for (const fileName of listFiles(dirPath, '.xml')) {
        if (fileName.toLowerCase() === 'formationrulesetschema.xsd') {
            continue;
        }

        const filePath = path.join(dirPath, fileName);
        const parsed = rulesetXmlParser.parse(readText(filePath)) as { ruleset?: Record<string, unknown> };
        const rawRuleset = parsed.ruleset;
        if (!rawRuleset) {
            continue;
        }

        const normalizedDocument = normalizeRulesetNode(rawRuleset, ['ruleset']);
        if (!normalizedDocument || typeof normalizedDocument !== 'object' || Array.isArray(normalizedDocument)) {
            throw new Error(`Failed to normalize ruleset ${fileName}`);
        }

        const document = finalizeRulesetExportValue(normalizedDocument) as JsonObject;
        const forces = Array.isArray(document.forces)
            ? document.forces.filter((entry): entry is JsonObject => !!entry && typeof entry === 'object' && !Array.isArray(entry))
            : [];

        const factionKey = String(rawRuleset['@_faction'] || fileName.replace(/\.xml$/i, ''));
        result.push({
            factionKey,
            parentFactionKey: rawRuleset['@_parent'] === undefined ? undefined : String(rawRuleset['@_parent']),
            ratingSystem: rawRuleset['@_ratingSystem'] === undefined ? undefined : String(rawRuleset['@_ratingSystem']),
            assign: document.assign && typeof document.assign === 'object' && !Array.isArray(document.assign)
                ? document.assign as JsonObject
                : undefined,
            customRanks: document.customRanks && typeof document.customRanks === 'object' && !Array.isArray(document.customRanks)
                ? document.customRanks as JsonObject
                : undefined,
            defaults: document.defaults && typeof document.defaults === 'object' && !Array.isArray(document.defaults)
                ? document.defaults as JsonObject
                : undefined,
            toc: document.toc && typeof document.toc === 'object' && !Array.isArray(document.toc)
                ? document.toc as JsonObject
                : undefined,
            forces,
            indexes: buildRulesetIndexes(forces),
            forceCount: forces.length,
        });
    }

    return result.sort((left, right) => left.factionKey.localeCompare(right.factionKey, undefined, { numeric: true }));
}

function isJsonInlinePrimitive(value: unknown): value is string | number | boolean | null {
    return value === null
        || typeof value === 'string'
        || typeof value === 'number'
        || typeof value === 'boolean';
}

function tryFormatInlineJsonArray(value: unknown[]): string | undefined {
    if (value.length === 0) {
        return '[]';
    }

    if (value.length > INLINE_JSON_ARRAY_MAX_ITEMS || !value.every((entry) => isJsonInlinePrimitive(entry))) {
        return undefined;
    }

    const rendered = `[${value.map((entry) => JSON.stringify(entry)).join(',')}]`;
    return rendered.length <= INLINE_JSON_ARRAY_MAX_LENGTH ? rendered : undefined;
}

function formatJsonValue(value: unknown, indentLevel = 0): string | undefined {
    if (value && typeof value === 'object' && typeof (value as { toJSON?: () => unknown }).toJSON === 'function') {
        return formatJsonValue((value as { toJSON: () => unknown }).toJSON(), indentLevel);
    }

    if (Array.isArray(value)) {
        const inlineArray = tryFormatInlineJsonArray(value);
        if (inlineArray !== undefined) {
            return inlineArray;
        }

        if (value.length === 0) {
            return '[]';
        }

        const currentIndent = ' '.repeat(indentLevel * JSON_INDENT);
        const nextIndent = ' '.repeat((indentLevel + 1) * JSON_INDENT);
        const renderedItems = value.map((entry) => `${nextIndent}${formatJsonValue(entry, indentLevel + 1) ?? 'null'}`);
        return `[` + os.EOL
            + renderedItems.join(`,${os.EOL}`)
            + os.EOL
            + `${currentIndent}]`;
    }

    if (value && typeof value === 'object') {
        const entries = Object.entries(value as Record<string, unknown>)
            .map(([key, entryValue]) => [key, formatJsonValue(entryValue, indentLevel + 1)] as const)
            .filter(([, renderedValue]) => renderedValue !== undefined);

        if (entries.length === 0) {
            return '{}';
        }

        const currentIndent = ' '.repeat(indentLevel * JSON_INDENT);
        const nextIndent = ' '.repeat((indentLevel + 1) * JSON_INDENT);
        const renderedEntries = entries.map(
            ([key, renderedValue]) => `${nextIndent}${JSON.stringify(key)}: ${renderedValue}`,
        );
        return `{` + os.EOL
            + renderedEntries.join(`,${os.EOL}`)
            + os.EOL
            + `${currentIndent}}`;
    }

    return JSON.stringify(value);
}

function writeJsonFile(filePath: string, data: unknown): void {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    const contents = BEAUTIFY_OUTPUT
        ? formatJsonValue(data) ?? ''
        : JSON.stringify(data);
    fs.writeFileSync(filePath, contents + os.EOL, 'utf8');
}

function run(): void {
    const forceGeneratorRulesDir = path.join(FORCEGEN_ROOT, 'faction_rules');

    if (!fs.existsSync(MM_DATA_ROOT)) {
        throw new Error(`MM_DATA_PATH does not exist: ${MM_DATA_ROOT}`);
    }

    if (!fs.existsSync(forceGeneratorRulesDir)) {
        throw new Error(`MegaMek force generator rules directory not found: ${forceGeneratorRulesDir}`);
    }

    const rulesets = loadRulesets(forceGeneratorRulesDir);
    writeJsonFile(OUTPUT_PATH, rulesets);

    console.log(`[MegaMek Rulesets] Generated ${OUTPUT_PATH} with ${rulesets.length} rulesets.`);
}

run();