// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import type { ASSpecialAbility } from '../models/as-abilities.model';
import type { AbilitySelection, ASForceUnit } from '../models/as-force-unit.model';
import { COMMAND_ABILITIES } from '../models/command-abilities.model';
import { formatRulesReference, GameSystem } from '../models/common.model';
import type { UnitGroup } from '../models/force.model';
import {
    formatSummaryMovement,
    getAbilityDetails,
    PILOT_ABILITIES,
    type ASCustomPilotAbility,
} from '../models/pilot-abilities.model';
import type { AsAbilityLookupService, ParsedAbility } from '../services/as-ability-lookup.service';
import {
    FormationAbilityAssignmentUtil,
    type FormationAssignmentPreview,
    type FormationEffectPreview,
    type FormationSharedPoolPreview,
} from './formation-ability-assignment.util';
import { resolveFormationGameSystemText, type FormationWideAbility } from './formation-type.model';

export interface ASPrintFormationApplication {
    abilityNames: string[];
    application: string;
    currentAssignments: string[];
}

export interface ASPrintFormationReference {
    groupName: string;
    formationName: string;
    description: string;
    effectDescription: string | null;
    rulesReferences: string[];
    valid: boolean;
    applications: ASPrintFormationApplication[];
}

export interface ASPrintAbilityReference {
    key: string;
    name: string;
    kind: 'Pilot ability' | 'Command ability' | 'Formation-wide ability' | 'Custom ability' | 'Unknown ability';
    description: string[];
    rulesReferences: string[];
    availableFrom: string[];
    pilotUnits: string[];
    formationUnits: string[];
}

export interface ASPrintSpecialReference {
    key: string;
    name: string;
    notations: string[];
    unitNames: string[];
    description: string[];
    rulesReference: string | null;
}

export interface ASPrintRulesReferenceData {
    formations: ASPrintFormationReference[];
    abilities: ASPrintAbilityReference[];
    specials: ASPrintSpecialReference[];
}

type AbilityLookup = Pick<AsAbilityLookupService, 'parseAbility'>;
type FormationPreviewResolver = (group: UnitGroup<ASForceUnit>) => FormationAssignmentPreview;

interface MutableAbilityReference extends Omit<ASPrintAbilityReference, 'availableFrom' | 'pilotUnits' | 'formationUnits'> {
    availableFrom: Set<string>;
    pilotUnitIds: Set<string>;
    formationUnitIds: Set<string>;
}

interface MutableSpecialReference extends Omit<ASPrintSpecialReference, 'notations' | 'unitNames'> {
    notations: Set<string>;
    unitIds: Set<string>;
}

const PILOT_ABILITIES_BY_ID = new Map(PILOT_ABILITIES.map(ability => [ability.id, ability]));
const COMMAND_ABILITIES_BY_ID = new Map(COMMAND_ABILITIES.map(ability => [ability.id, ability]));

export function collectASPrintRulesReferenceData(
    groups: UnitGroup<ASForceUnit>[],
    abilityLookup: AbilityLookup,
    useHex: boolean,
    previewResolver: FormationPreviewResolver = group => FormationAbilityAssignmentUtil.previewGroupFormationAssignments(group),
): ASPrintRulesReferenceData {
    const unitNames = collectUnitNames(groups);
    const abilities = new Map<string, MutableAbilityReference>();
    const specials = new Map<string, MutableSpecialReference>();
    const formations: ASPrintFormationReference[] = [];

    for (const group of groups) {
        const formation = group.activeFormation();
        if (formation) {
            const preview = previewResolver(group);
            const groupName = group.groupDisplayName();
            const formationName = group.formationDisplayName() ?? formation.name;
            const formationContext = groupName === formationName
                ? formationName
                : `${groupName} — ${formationName}`;
            const applications: ASPrintFormationApplication[] = [];

            for (const effect of preview.effectPreviews) {
                const application = describeFormationEffectApplication(effect);
                const abilityNames = effect.descriptor.abilityIds.map(abilityId => {
                    const entry = ensureRegisteredAbility(abilities, abilityId, useHex);
                    entry.availableFrom.add(`${formationContext}: ${application}`);
                    return entry.name;
                });

                const assignments = collectEffectAssignments(effect, abilities, unitNames, useHex);
                applications.push({
                    abilityNames,
                    application,
                    currentAssignments: assignments.length > 0
                        ? assignments
                        : [],
                });
            }

            for (const pool of preview.sharedPoolPreviews) {
                const application = describeSharedPoolApplication(pool);
                const abilityNames = pool.descriptor.abilityIds.map(abilityId => {
                    const entry = ensureRegisteredAbility(abilities, abilityId, useHex);
                    entry.availableFrom.add(`${formationContext}: ${application}`);
                    return entry.name;
                });
                applications.push({
                    abilityNames,
                    application,
                    currentAssignments: ['Shared by the formation; not assigned to individual units.'],
                });
            }

            for (const descriptor of preview.formationWideAbilities) {
                const entry = ensureFormationWideAbility(abilities, descriptor.ability, useHex);
                const application = 'Applies formation-wide to every eligible member.';
                entry.availableFrom.add(`${formationContext}: ${application}`);
                applications.push({
                    abilityNames: [entry.name],
                    application,
                    currentAssignments: ['Active across the formation.'],
                });
            }

            const effectDescription = resolveFormationGameSystemText(
                formation.effectDescription,
                GameSystem.ALPHA_STRIKE,
            );
            formations.push({
                groupName,
                formationName,
                description: formation.description,
                effectDescription: effectDescription
                    ? formatPrintMovementText(effectDescription, useHex)
                    : null,
                rulesReferences: (formation.rulesRef ?? []).map(formatRulesReference),
                valid: group.hasValidFormation(),
                applications,
            });
        }

        for (const unit of group.units()) {
            collectUnitAbilities(unit, abilities, useHex);
            collectUnitSpecials(unit, abilityLookup, specials);
        }
    }

    return {
        formations,
        abilities: [...abilities.values()]
            .map(entry => freezeAbilityReference(entry, unitNames))
            .sort((left, right) => left.name.localeCompare(right.name)),
        specials: [...specials.values()]
            .map(entry => freezeSpecialReference(entry, unitNames))
            .sort((left, right) => left.name.localeCompare(right.name)),
    };
}

export function createASPrintRulesReferencePage(
    groups: UnitGroup<ASForceUnit>[],
    abilityLookup: AbilityLookup,
    useHex: boolean,
    forceName: string = '',
): HTMLElement {
    return renderASPrintRulesReferencePage(
        collectASPrintRulesReferenceData(groups, abilityLookup, useHex),
        forceName,
    );
}

export function renderASPrintRulesReferencePage(
    data: ASPrintRulesReferenceData,
    forceName: string = '',
): HTMLElement {
    const page = document.createElement('div');
    page.className = 'as-rules-reference';

    const header = appendTextElement(page, 'div', 'as-reference-header', 'Formation & Ability Reference');
    if (forceName) {
        appendTextElement(header, 'span', 'as-reference-force-name', forceName);
    }

    const formationsSection = createSection(page, 'Formations');
    if (data.formations.length === 0) {
        appendTextElement(formationsSection, 'p', 'as-reference-empty', 'No active formations.');
    }
    for (const formation of data.formations) {
        const card = document.createElement('article');
        card.className = 'as-reference-formation';
        formationsSection.appendChild(card);

        const title = appendTextElement(card, 'h3', 'as-reference-entry-title', formation.formationName);
        if (formation.groupName !== formation.formationName) {
            appendTextElement(title, 'span', 'as-reference-context-label', formation.groupName);
        }
        if (!formation.valid) {
            appendTextElement(title, 'span', 'as-reference-warning', 'Invalid formation');
        }

        appendTextElement(card, 'p', 'as-reference-description', formation.description);
        if (formation.effectDescription) {
            const effect = document.createElement('div');
            effect.className = 'as-reference-effect';
            card.appendChild(effect);
            appendTextElement(effect, 'strong', 'as-reference-label', 'Effect');
            appendTextElement(effect, 'p', 'as-reference-description', formation.effectDescription);
        }

        for (const application of formation.applications) {
            const applicationElement = document.createElement('div');
            applicationElement.className = 'as-reference-application';
            card.appendChild(applicationElement);
            appendTextElement(
                applicationElement,
                'strong',
                'as-reference-application-name',
                application.abilityNames.join(', '),
            );
            appendTextElement(applicationElement, 'span', 'as-reference-application-rule', application.application);
            appendTextElement(
                applicationElement,
                'span',
                'as-reference-current-assignment',
                application.currentAssignments.join(' '),
            );
        }

        appendRulesReferences(card, formation.rulesReferences);
    }

    const abilitiesSection = createSection(page, 'Formation & Pilot Abilities');
    const abilitiesList = document.createElement('div');
    abilitiesList.className = 'as-reference-entry-list';
    abilitiesSection.appendChild(abilitiesList);
    if (data.abilities.length === 0) {
        appendTextElement(abilitiesList, 'p', 'as-reference-empty', 'No formation or pilot abilities are in use or available.');
    }
    for (const ability of data.abilities) {
        const entry = createReferenceEntry(abilitiesList, ability.name, ability.kind);
        appendUsageContext(entry, 'Formation' + (ability.availableFrom.length > 1 ? 's' : ''), ability.availableFrom);
        appendUsageContext(entry, 'Unit' + (ability.pilotUnits.length > 1 ? 's' : ''), ability.pilotUnits);
        appendUsageContext(entry, 'Formation assignment', ability.formationUnits);
        appendDescriptionLines(entry, ability.description);
        appendRulesReferences(entry, ability.rulesReferences);
    }

    const specialsSection = createSection(page, 'Unit Specials');
    specialsSection.classList.add('as-reference-specials-section');
    const specialsList = document.createElement('div');
    specialsList.className = 'as-reference-entry-list';
    specialsSection.appendChild(specialsList);
    if (data.specials.length === 0) {
        appendTextElement(specialsList, 'p', 'as-reference-empty', 'No unit specials.');
    }
    for (const special of data.specials) {
        const entry = createReferenceEntry(specialsList, special.name, '');
        appendUsageContext(entry, 'Card notation', special.notations);
        appendUsageContext(entry, 'Unit'+ (special.unitNames.length > 1 ? 's' : ''), special.unitNames);
        appendDescriptionLines(entry, special.description);
        if (special.rulesReference) {
            appendRulesReferences(entry, [special.rulesReference]);
        }
    }

    return page;
}

export function getASPrintRulesReferenceStyles(): string {
    return `
        .as-rules-reference {
            color: #000;
            box-sizing: border-box;
            padding: 0.18in 0.08in 0.12in;
            font-family: sans-serif;
            font-size: 8pt;
            line-height: 1.28;
        }

        .as-reference-header {
            display: flex;
            align-items: baseline;
            justify-content: space-between;
            gap: 0.12in;
            padding: 0 0.04in 0.08in;
            border-bottom: 2px solid #333;
            font-size: 14pt;
            font-weight: 700;
        }

        .as-reference-force-name {
            font-size: 10pt;
            font-weight: 600;
            color: #000;
        }

        .as-reference-section {
            margin-top: 0.12in;
        }

        .as-reference-specials-section {
            page-break-before: always;
            break-before: page;
        }

        .as-reference-section-title {
            margin: 0 0 0.06in;
            padding-bottom: 0.025in;
            border-bottom: 1px solid #777;
            font-size: 10pt;
            text-transform: uppercase;
            letter-spacing: 0.02em;
        }

        .as-reference-formation,
        .as-reference-entry {
            break-inside: avoid;
            page-break-inside: avoid;
        }

        .as-reference-formation {
            margin-bottom: 0.08in;
            padding: 0.06in 0.07in;
            border-left: 3px solid #444;
        }

        .as-reference-entry-list {
            column-count: 2;
            column-gap: 0.14in;
        }

        .as-reference-entry {
            display: inline-block;
            width: 100%;
            margin: 0 0 0.07in;
            padding: 0.045in 0.055in;
            border-left: 2px solid #999;
            box-sizing: border-box;
        }

        .as-reference-entry-title {
            display: flex;
            align-items: baseline;
            flex-wrap: wrap;
            gap: 0.05in;
            margin: 0 0 0.025in;
            font-size: 9pt;
        }

        .as-reference-context-label,
        .as-reference-kind {
            font-size: 7pt;
            font-weight: 400;
            color: #000;
        }

        .as-reference-warning {
            margin-left: auto;
            color: #000;
            font-size: 7pt;
            font-weight: 700;
        }

        .as-reference-description {
            margin: 0.02in 0;
        }

        .as-reference-effect {
            margin-top: 0.04in;
        }

        .as-reference-label {
            text-transform: uppercase;
            font-size: 6.8pt;
            letter-spacing: 0.03em;
        }

        .as-reference-application {
            display: grid;
            grid-template-columns: minmax(1.1in, 0.35fr) 1fr;
            column-gap: 0.06in;
            margin-top: 0.04in;
            padding-top: 0.035in;
            border-top: 1px solid #ccc;
        }

        .as-reference-application-name {
            grid-row: 1 / span 2;
        }

        .as-reference-application-rule,
        .as-reference-current-assignment {
            color: #000;
        }

        .as-reference-current-assignment {
            margin-top: 0.015in;
            font-style: italic;
        }

        .as-reference-usage {
            margin: 0.015in 0;
            color: #000;
            font-size: 7.2pt;
        }

        .as-reference-usage-label {
            font-weight: 700;
        }

        .as-reference-rules {
            margin-top: 0.025in;
            color: #666;
            font-size: 6.8pt;
            font-style: italic;
        }

        .as-reference-empty {
            margin: 0.04in 0;
            color: #666;
            font-style: italic;
        }
    `;
}

function collectUnitNames(groups: UnitGroup<ASForceUnit>[]): Map<string, string> {
    const unitNames = new Map<string, string>();

    for (const group of groups) {
        for (const unit of group.units()) {
            const unitData = unit.getUnit();
            const baseName = [unitData.chassis, unitData.model].filter(Boolean).join(' ') || unitData.name || unit.id;
            unitNames.set(unit.id, baseName);
        }
    }

    return unitNames;
}

function collectUnitAbilities(
    unit: ASForceUnit,
    abilities: Map<string, MutableAbilityReference>,
    useHex: boolean,
): void {
    for (const selection of unit.manualPilotAbilities()) {
        const entry = ensureSelectedAbility(abilities, selection, useHex);
        entry.pilotUnitIds.add(unit.id);
    }

    for (const abilityId of unit.formationAbilities()) {
        const entry = ensureRegisteredAbility(abilities, abilityId, useHex);
        entry.formationUnitIds.add(unit.id);
    }
}

function collectUnitSpecials(
    unit: ASForceUnit,
    abilityLookup: AbilityLookup,
    specials: Map<string, MutableSpecialReference>,
): void {
    for (const specialText of unit.getUnit().as.specials ?? []) {
        collectParsedSpecial(abilityLookup.parseAbility(specialText), unit.id, specials);
    }
}

function collectParsedSpecial(
    parsed: ParsedAbility,
    unitId: string,
    specials: Map<string, MutableSpecialReference>,
): void {
    if (parsed.ability) {
        const entry = ensureKnownSpecial(specials, parsed.ability);
        entry.notations.add(parsed.originalText);
        entry.unitIds.add(unitId);
    } else if (!parsed.subAbilities?.length) {
        const normalizedText = parsed.originalText.trim().replace(/\s+/g, ' ').toUpperCase();
        const key = `unknown:${normalizedText}`;
        let entry = specials.get(key);
        if (!entry) {
            entry = {
                key,
                name: parsed.originalText,
                notations: new Set(),
                unitIds: new Set(),
                description: ['No special ability description is available.'],
                rulesReference: null,
            };
            specials.set(key, entry);
        }
        entry.notations.add(parsed.originalText);
        entry.unitIds.add(unitId);
    }

    for (const subAbility of parsed.subAbilities ?? []) {
        collectParsedSpecial(subAbility, unitId, specials);
    }
}

function ensureKnownSpecial(
    specials: Map<string, MutableSpecialReference>,
    ability: ASSpecialAbility,
): MutableSpecialReference {
    const tags = (Array.isArray(ability.tag) ? ability.tag : [ability.tag]).join('|');
    const key = `known:${ability.name}:${tags}`;
    let entry = specials.get(key);
    if (!entry) {
        entry = {
            key,
            name: ability.name,
            notations: new Set(),
            unitIds: new Set(),
            description: [...(ability.notes ?? []), ...ability.summary],
            rulesReference: ability.rulesPage ? `${ability.rulesBook}, page ${ability.rulesPage}` : null,
        };
        specials.set(key, entry);
    }
    return entry;
}

function ensureSelectedAbility(
    abilities: Map<string, MutableAbilityReference>,
    selection: AbilitySelection,
    useHex: boolean,
): MutableAbilityReference {
    return typeof selection === 'string'
        ? ensureRegisteredAbility(abilities, selection, useHex)
        : ensureCustomAbility(abilities, selection);
}

function ensureRegisteredAbility(
    abilities: Map<string, MutableAbilityReference>,
    abilityId: string,
    useHex: boolean,
): MutableAbilityReference {
    const pilotAbility = PILOT_ABILITIES_BY_ID.get(abilityId);
    if (pilotAbility) {
        const key = `pilot:${abilityId}`;
        let entry = abilities.get(key);
        if (!entry) {
            const details = getAbilityDetails(pilotAbility, GameSystem.ALPHA_STRIKE);
            const description = details.description?.length ? details.description : details.summary;
            entry = createMutableAbilityReference({
                key,
                name: pilotAbility.name,
                kind: 'Pilot ability',
                description: formatPrintMovementLines(description, useHex),
                rulesReferences: (details.rulesRef ?? []).map(formatRulesReference),
            });
            abilities.set(key, entry);
        }
        return entry;
    }

    const commandAbility = COMMAND_ABILITIES_BY_ID.get(abilityId);
    if (commandAbility) {
        const key = `command:${abilityId}`;
        let entry = abilities.get(key);
        if (!entry) {
            const alphaStrikeSummary = commandAbility.summary
                .filter(line => !line.trimStart().startsWith('TW:'))
                .map(line => line.replace(/^\s*AS:\s*/, ''));
            entry = createMutableAbilityReference({
                key,
                name: commandAbility.name,
                kind: 'Command ability',
                description: formatPrintMovementLines(
                    alphaStrikeSummary.length > 0 ? alphaStrikeSummary : commandAbility.summary,
                    useHex,
                ),
                rulesReferences: commandAbility.rulesRef.map(formatRulesReference),
            });
            abilities.set(key, entry);
        }
        return entry;
    }

    const key = `unknown:${abilityId}`;
    let entry = abilities.get(key);
    if (!entry) {
        entry = createMutableAbilityReference({
            key,
            name: abilityId,
            kind: 'Unknown ability',
            description: ['No ability description is available.'],
            rulesReferences: [],
        });
        abilities.set(key, entry);
    }
    return entry;
}

function ensureCustomAbility(
    abilities: Map<string, MutableAbilityReference>,
    ability: ASCustomPilotAbility,
): MutableAbilityReference {
    const key = `custom:${ability.name.trim().toLocaleLowerCase()}:${ability.summary.trim().toLocaleLowerCase()}`;
    let entry = abilities.get(key);
    if (!entry) {
        entry = createMutableAbilityReference({
            key,
            name: ability.name,
            kind: 'Custom ability',
            description: [ability.summary],
            rulesReferences: [],
        });
        abilities.set(key, entry);
    }
    return entry;
}

function ensureFormationWideAbility(
    abilities: Map<string, MutableAbilityReference>,
    ability: FormationWideAbility,
    useHex: boolean,
): MutableAbilityReference {
    const key = `formation:${ability.id}`;
    let entry = abilities.get(key);
    if (!entry) {
        entry = createMutableAbilityReference({
            key,
            name: ability.name,
            kind: 'Formation-wide ability',
            description: formatPrintMovementLines(ability.summary, useHex),
            rulesReferences: (ability.rulesRef ?? []).map(formatRulesReference),
        });
        abilities.set(key, entry);
    }
    return entry;
}

function createMutableAbilityReference(
    data: Omit<MutableAbilityReference, 'availableFrom' | 'pilotUnitIds' | 'formationUnitIds'>,
): MutableAbilityReference {
    return {
        ...data,
        availableFrom: new Set(),
        pilotUnitIds: new Set(),
        formationUnitIds: new Set(),
    };
}

function collectEffectAssignments(
    effect: FormationEffectPreview,
    abilities: Map<string, MutableAbilityReference>,
    unitNames: ReadonlyMap<string, string>,
    useHex: boolean,
): string[] {
    const unitIdsByAbility = new Map<string, string[]>();

    effect.assignedByUnitId.forEach((abilityIds, unitId) => {
        for (const abilityId of abilityIds) {
            const entry = ensureRegisteredAbility(abilities, abilityId, useHex);
            entry.formationUnitIds.add(unitId);
            const unitIds = unitIdsByAbility.get(abilityId) ?? [];
            unitIds.push(unitId);
            unitIdsByAbility.set(abilityId, unitIds);
        }
    });

    return [...unitIdsByAbility.entries()].map(([abilityId, unitIds]) => {
        const abilityName = ensureRegisteredAbility(abilities, abilityId, useHex).name;
        const names = unitIds.map(unitId => unitNames.get(unitId) ?? unitId);
        return `${abilityName}: ${names.join(', ')}.`;
    });
}

function describeFormationEffectApplication(effect: FormationEffectPreview): string {
    const group = effect.descriptor.group;
    const parts: string[] = [];

    switch (group.selection) {
        case 'choose-one':
            parts.push('Choose one listed ability for every recipient');
            break;
        case 'choose-each':
            parts.push('Each recipient chooses independently from the listed abilities');
            break;
        case 'all':
            parts.push('Every listed ability is granted together');
            break;
    }

    switch (group.distribution) {
        case 'all':
            parts.push('all eligible units receive it');
            break;
        case 'half-round-down':
            parts.push(`up to half the eligible units (${effect.recipientLimit ?? 0}, rounded down)`);
            break;
        case 'half-round-up':
            parts.push(`up to half the eligible units (${effect.recipientLimit ?? 0}, rounded up)`);
            break;
        case 'percent-75':
            parts.push(`75% of the eligible units (${effect.recipientLimit ?? 0})`);
            break;
        case 'up-to-50-percent':
            parts.push(`up to 50% of the eligible units (${effect.recipientLimit ?? 0})`);
            break;
        case 'fixed':
            parts.push(`up to ${group.count ?? effect.recipientLimit ?? 0} units`);
            break;
        case 'fixed-pairs':
            parts.push(`${group.count ?? 0} identical pairs`);
            break;
        case 'conditional':
            parts.push(group.condition ?? 'units meeting the stated condition');
            break;
        case 'remainder':
            parts.push('remaining eligible units not covered by an earlier effect');
            break;
        case 'role-filtered':
            parts.push(`all eligible ${group.roleFilter ?? 'matching'} role units`);
            break;
        case 'commander':
            parts.push('the designated commander only');
            break;
    }

    parts.push(group.perTurn ? 'assignments may change each turn' : 'assignments apply for the scenario');
    if (group.excludeCommander) {
        parts.push('the commander is excluded');
    }
    return `${parts.join('; ')}.`;
}

function describeSharedPoolApplication(pool: FormationSharedPoolPreview): string {
    const details: string[] = ['Shared formation pool'];
    if (pool.resolvedLevel !== null) {
        details.push(`level ${pool.resolvedLevel}`);
    }
    if (pool.totalUsesPerScenario !== null) {
        details.push(`${pool.totalUsesPerScenario} total uses per scenario`);
    }
    if (pool.maxUsesPerUnitPerScenario !== null) {
        details.push(`up to ${pool.maxUsesPerUnitPerScenario} uses per unit per scenario`);
    }
    if (pool.stacksWithIndividualAbility) {
        details.push('stacks with an individually selected ability');
    }
    return `${details.join('; ')}.`;
}

function freezeAbilityReference(
    entry: MutableAbilityReference,
    unitNames: ReadonlyMap<string, string>,
): ASPrintAbilityReference {
    return {
        key: entry.key,
        name: entry.name,
        kind: entry.kind,
        description: [...entry.description],
        rulesReferences: [...entry.rulesReferences],
        availableFrom: [...entry.availableFrom].sort(),
        pilotUnits: resolveUnitNames(entry.pilotUnitIds, unitNames),
        formationUnits: resolveUnitNames(entry.formationUnitIds, unitNames),
    };
}

function freezeSpecialReference(
    entry: MutableSpecialReference,
    unitNames: ReadonlyMap<string, string>,
): ASPrintSpecialReference {
    return {
        key: entry.key,
        name: entry.name,
        notations: [...entry.notations].filter(Boolean).sort(),
        unitNames: resolveUnitNames(entry.unitIds, unitNames),
        description: [...entry.description],
        rulesReference: entry.rulesReference,
    };
}

function resolveUnitNames(unitIds: Iterable<string>, unitNames: ReadonlyMap<string, string>): string[] {
    const resolvedNames = [...unitIds].map(unitId => unitNames.get(unitId) ?? unitId);
    return [...new Set(resolvedNames)].sort((left, right) => left.localeCompare(right));
}

function formatPrintMovementLines(lines: string[], useHex: boolean): string[] {
    return lines.map(line => formatPrintMovementText(line, useHex));
}

function formatPrintMovementText(text: string, useHex: boolean): string {
    const formatted = formatSummaryMovement(text, useHex);
    return formatted.replace(/<[^>]+>/g, '');
}

function createSection(parent: HTMLElement, title: string): HTMLElement {
    const section = document.createElement('section');
    section.className = 'as-reference-section';
    parent.appendChild(section);
    appendTextElement(section, 'h2', 'as-reference-section-title', title);
    return section;
}

function createReferenceEntry(parent: HTMLElement, title: string, kind: string): HTMLElement {
    const entry = document.createElement('article');
    entry.className = 'as-reference-entry';
    parent.appendChild(entry);
    const heading = appendTextElement(entry, 'h3', 'as-reference-entry-title', title);
    appendTextElement(heading, 'span', 'as-reference-kind', kind);
    return entry;
}

function appendUsageContext(parent: HTMLElement, label: string, values: string[]): void {
    if (values.length === 0) return;
    const context = document.createElement('div');
    context.className = 'as-reference-usage';
    parent.appendChild(context);
    appendTextElement(context, 'span', 'as-reference-usage-label', `${label}: `);
    context.appendChild(document.createTextNode(values.join('; ')));
}

function appendDescriptionLines(parent: HTMLElement, lines: string[]): void {
    for (const line of lines) {
        appendTextElement(parent, 'p', 'as-reference-description', line);
    }
}

function appendRulesReferences(parent: HTMLElement, references: string[]): void {
    if (references.length === 0) return;
    appendTextElement(parent, 'div', 'as-reference-rules', references.join(' · '));
}

function appendTextElement<K extends keyof HTMLElementTagNameMap>(
    parent: HTMLElement,
    tagName: K,
    className: string,
    text: string,
): HTMLElementTagNameMap[K] {
    const element = document.createElement(tagName);
    element.className = className;
    element.textContent = text;
    parent.appendChild(element);
    return element;
}
