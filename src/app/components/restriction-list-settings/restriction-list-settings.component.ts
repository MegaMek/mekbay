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

import { ChangeDetectionStrategy, Component, computed, effect, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { GameSystem } from '../../models/common.model';
import type { AmmoType } from '../../models/equipment.model';
import type { RestrictionListDefinition } from '../../models/restriction-lists.model';
import { DataService } from '../../services/data.service';
import { DialogsService } from '../../services/dialogs.service';
import { GameService } from '../../services/game.service';
import { RestrictionListsService } from '../../services/restriction-lists.service';
import { ToastService } from '../../services/toast.service';
import { AS_TYPE_DISPLAY_NAMES } from '../../services/unit-search-filters.model';
import { normalizeRestrictionCatalogValues } from '../../utils/restriction-lists.util';

interface RestrictionListEditorDraft {
    slug: string;
    name: string;
    description: string;
    gameSystem: GameSystem;
    classicUnitTypes: string[];
    classicUnitSubtypes: string[];
    alphaStrikeUnitTypes: string[];
    requireCanon: boolean;
    forbidQuirks: boolean;
    forbidAmmoTypes: AmmoType[];
    forbidArrowIVHoming: boolean;
    minUnits: string;
    maxUnits: string;
    uniqueChassis: boolean;
    jumpRuleEnabled: boolean;
    jumpMinimum: string;
    jumpMaxUnits: string;
    crewSkillMin: string;
    crewSkillMax: string;
    maxGunneryPilotingDelta: string;
    allowManualPilotAbilities: boolean;
    allowFormationAbilities: boolean;
    notesText: string;
}

type CatalogPillField = 'classicUnitTypes' | 'classicUnitSubtypes' | 'alphaStrikeUnitTypes';

const FALLBACK_CLASSIC_TYPE_OPTIONS = [
    'Aero',
    'Handheld Weapon',
    'Infantry',
    'Mek',
    'Naval',
    'ProtoMek',
    'Tank',
    'VTOL',
] as const;

const AMMO_TYPE_OPTIONS: ReadonlyArray<{ value: AmmoType; label: string }> = [
    { value: 'ARROW_IV', label: 'Arrow IV' },
];

function normalizeCatalogInputValue(value: string): string {
    return value.trim().replace(/\s+/g, ' ');
}

function sortCatalogValues(values: readonly string[]): string[] {
    return [...values].sort((left, right) => left.localeCompare(right, undefined, { sensitivity: 'base' }));
}

function resolveSuggestedCatalogValue(value: string, suggestions: readonly string[]): string {
    const normalized = normalizeCatalogInputValue(value).toLowerCase();
    return suggestions.find((suggestion) => suggestion.toLowerCase() === normalized) ?? normalizeCatalogInputValue(value);
}

function resolveAlphaStrikeTypeValue(value: string): string {
    const normalized = normalizeCatalogInputValue(value).toLowerCase();
    for (const [code, label] of Object.entries(AS_TYPE_DISPLAY_NAMES)) {
        if (code.toLowerCase() === normalized || label.toLowerCase() === normalized) {
            return code;
        }
    }

    return normalizeCatalogInputValue(value).toUpperCase();
}

function formatAlphaStrikeTypeValue(value: string): string {
    const code = value.toUpperCase();
    const displayName = AS_TYPE_DISPLAY_NAMES[code];
    return displayName ? `${code} - ${displayName}` : value;
}

function stringifyNumber(value: number | undefined): string {
    return value === undefined ? '' : `${value}`;
}

function parseInteger(value: string, minimum: number): number | undefined {
    const trimmed = value.trim();
    if (!trimmed) {
        return undefined;
    }

    const parsed = Number.parseInt(trimmed, 10);
    if (!Number.isFinite(parsed) || parsed < minimum) {
        return undefined;
    }

    return parsed;
}

function normalizeNotes(notesText: string): string[] {
    return notesText
        .split(/\r?\n/)
        .map((note) => note.trim())
        .filter((note) => note.length > 0);
}

function createDraftFromDefinition(list: RestrictionListDefinition): RestrictionListEditorDraft {
    return {
        slug: list.slug,
        name: list.name,
        description: list.description ?? '',
        gameSystem: list.gameSystem,
        classicUnitTypes: [...(list.catalog?.allowClassicUnitTypes ?? [])],
        classicUnitSubtypes: [...(list.catalog?.allowClassicUnitSubtypes ?? [])],
        alphaStrikeUnitTypes: [...(list.catalog?.allowAlphaStrikeUnitTypes ?? [])],
        requireCanon: list.catalog?.requireCanon === true,
        forbidQuirks: list.catalog?.forbidQuirks === true,
        forbidAmmoTypes: [...(list.catalog?.forbidAmmoTypes ?? [])],
        forbidArrowIVHoming: list.catalog?.forbidArrowIVHoming === true,
        minUnits: stringifyNumber(list.roster?.minUnits),
        maxUnits: stringifyNumber(list.roster?.maxUnits),
        uniqueChassis: list.roster?.uniqueChassis === true,
        jumpRuleEnabled: !!list.roster?.maxUnitsWithJumpAtLeast,
        jumpMinimum: stringifyNumber(list.roster?.maxUnitsWithJumpAtLeast?.minimumJump),
        jumpMaxUnits: stringifyNumber(list.roster?.maxUnitsWithJumpAtLeast?.maxUnits),
        crewSkillMin: stringifyNumber(list.live?.classic?.crewSkillMin),
        crewSkillMax: stringifyNumber(list.live?.classic?.crewSkillMax),
        maxGunneryPilotingDelta: stringifyNumber(list.live?.classic?.maxGunneryPilotingDelta),
        allowManualPilotAbilities: list.live?.alphaStrike?.allowManualPilotAbilities !== false,
        allowFormationAbilities: list.live?.alphaStrike?.allowFormationAbilities !== false,
        notesText: (list.notes ?? []).join('\n'),
    };
}

function buildDefinitionFromDraft(draft: RestrictionListEditorDraft, updatedAt: string): RestrictionListDefinition {
    const minUnits = parseInteger(draft.minUnits, 1);
    const maxUnits = parseInteger(draft.maxUnits, 1);
    const jumpMinimum = parseInteger(draft.jumpMinimum, 0);
    const jumpMaxUnits = parseInteger(draft.jumpMaxUnits, 1);
    const crewSkillMin = parseInteger(draft.crewSkillMin, 0);
    const crewSkillMax = parseInteger(draft.crewSkillMax, 0);
    const maxGunneryPilotingDelta = parseInteger(draft.maxGunneryPilotingDelta, 0);

    return {
        slug: draft.slug,
        name: draft.name.trim() || 'New Restriction List',
        description: draft.description.trim(),
        updatedAt,
        gameSystem: draft.gameSystem,
        catalog: {
            allowClassicUnitTypes: normalizeRestrictionCatalogValues(draft.classicUnitTypes),
            allowClassicUnitSubtypes: normalizeRestrictionCatalogValues(draft.classicUnitSubtypes),
            allowAlphaStrikeUnitTypes: normalizeRestrictionCatalogValues(draft.alphaStrikeUnitTypes),
            requireCanon: draft.requireCanon,
            forbidQuirks: draft.forbidQuirks,
            forbidAmmoTypes: [...draft.forbidAmmoTypes],
            forbidArrowIVHoming: draft.forbidArrowIVHoming,
        },
        roster: {
            minUnits,
            maxUnits,
            uniqueChassis: draft.uniqueChassis,
            maxUnitsWithJumpAtLeast: draft.jumpRuleEnabled && jumpMinimum !== undefined && jumpMaxUnits !== undefined
                ? {
                    minimumJump: jumpMinimum,
                    maxUnits: jumpMaxUnits,
                }
                : undefined,
        },
        live: draft.gameSystem === GameSystem.CLASSIC
            ? {
                classic: {
                    crewSkillMin,
                    crewSkillMax,
                    maxGunneryPilotingDelta,
                },
            }
            : {
                alphaStrike: {
                    allowManualPilotAbilities: draft.allowManualPilotAbilities,
                    allowFormationAbilities: draft.allowFormationAbilities,
                },
            },
        notes: normalizeNotes(draft.notesText),
    };
}

function normalizeDefinition(list: RestrictionListDefinition): RestrictionListDefinition {
    return buildDefinitionFromDraft(createDraftFromDefinition(list), list.updatedAt);
}

@Component({
    selector: 'restriction-list-settings',
    standalone: true,
    imports: [CommonModule, FormsModule],
    templateUrl: './restriction-list-settings.component.html',
    styleUrls: ['./restriction-list-settings.component.scss'],
    changeDetection: ChangeDetectionStrategy.OnPush,
})
export class RestrictionListSettingsComponent {
    private readonly dataService = inject(DataService);
    private readonly restrictionListsService = inject(RestrictionListsService);
    private readonly dialogsService = inject(DialogsService);
    private readonly gameService = inject(GameService);
    private readonly toastService = inject(ToastService);

    readonly ammoTypeOptions = AMMO_TYPE_OPTIONS;
    readonly gameSystem = GameSystem;
    readonly availableRestrictionLists = this.restrictionListsService.availableRestrictionLists;
    readonly activeRestrictionCount = computed(() => this.restrictionListsService.getActiveRestrictionLists().length);
    readonly selectedSlug = signal<string | null>(null);
    readonly draft = signal<RestrictionListEditorDraft | null>(null);
    readonly classicTypeInput = signal('');
    readonly classicSubtypeInput = signal('');
    readonly alphaStrikeTypeInput = signal('');
    readonly classicTypeSuggestions = computed(() => {
        this.dataService.searchCorpusVersion();

        return sortCatalogValues(normalizeRestrictionCatalogValues([
            ...FALLBACK_CLASSIC_TYPE_OPTIONS,
            ...this.dataService.getUnits().map((unit) => unit.type),
        ]));
    });
    readonly classicSubtypeSuggestions = computed(() => {
        this.dataService.searchCorpusVersion();
        return sortCatalogValues(normalizeRestrictionCatalogValues(this.dataService.getUnits().map((unit) => unit.subtype)));
    });
    readonly alphaStrikeTypeSuggestions = computed(() => {
        this.dataService.searchCorpusVersion();

        return sortCatalogValues(normalizeRestrictionCatalogValues([
            ...Object.keys(AS_TYPE_DISPLAY_NAMES),
            ...this.dataService.getUnits().map((unit) => unit.as?.TP ?? ''),
        ])).map((value) => ({
            value,
            label: AS_TYPE_DISPLAY_NAMES[value.toUpperCase()] ?? value,
        }));
    });
    readonly selectedRestrictionList = computed(() => this.restrictionListsService.getRestrictionListBySlug(this.selectedSlug()));
    readonly hasDraftChanges = computed(() => {
        const draft = this.draft();
        const selected = this.selectedRestrictionList();
        if (!draft || !selected) {
            return false;
        }

        return JSON.stringify(buildDefinitionFromDraft(draft, selected.updatedAt)) !== JSON.stringify(normalizeDefinition(selected));
    });

    constructor() {
        effect(() => {
            const lists = this.availableRestrictionLists();
            const selectedSlug = this.selectedSlug();
            if (lists.length === 0) {
                this.selectedSlug.set(null);
                this.draft.set(null);
                return;
            }

            if (!selectedSlug || !lists.some((list) => list.slug === selectedSlug)) {
                this.setSelectedList(lists[0].slug);
            }
        });
    }

    async onSelectList(slug: string): Promise<void> {
        if (slug === this.selectedSlug()) {
            return;
        }

        if (!await this.confirmDiscardChanges()) {
            return;
        }

        this.setSelectedList(slug);
    }

    async createNewList(): Promise<void> {
        if (!await this.confirmDiscardChanges()) {
            return;
        }

        const list = this.restrictionListsService.createCustomRestrictionList(this.gameService.currentGameSystem());
        this.setSelectedList(list.slug);
        this.toastService.showToast('Created a new custom restriction list.', 'success');
    }

    duplicateSelectedList(): void {
        const selected = this.selectedRestrictionList();
        if (!selected) {
            return;
        }

        const duplicate = this.restrictionListsService.duplicateRestrictionList(selected.slug);
        if (!duplicate) {
            return;
        }

        this.setSelectedList(duplicate.slug);
        this.toastService.showToast(`Duplicated ${selected.name}.`, 'success');
    }

    async deleteSelectedList(): Promise<void> {
        const selected = this.selectedRestrictionList();
        if (!selected) {
            return;
        }

        const confirmed = await this.dialogsService.requestConfirmation(
            `Delete \"${selected.name}\"? This only removes the local custom copy from this browser.`,
            'Delete Restriction List',
            'danger',
        );
        if (!confirmed) {
            return;
        }

        const lists = this.availableRestrictionLists();
        const selectedIndex = lists.findIndex((list) => list.slug === selected.slug);
        this.restrictionListsService.deleteCustomRestrictionList(selected.slug);

        const nextLists = this.availableRestrictionLists();
        const fallback = nextLists[selectedIndex] ?? nextLists[selectedIndex - 1] ?? nextLists[0] ?? null;
        this.setSelectedList(fallback?.slug ?? null);
        this.toastService.showToast(`Deleted ${selected.name}.`, 'success');
    }

    saveSelectedList(): void {
        const draft = this.draft();
        const selected = this.selectedRestrictionList();
        if (!draft || !selected) {
            return;
        }

        const next = buildDefinitionFromDraft(draft, new Date().toISOString());
        this.restrictionListsService.saveCustomRestrictionList(next);
        this.setSelectedList(next.slug);
        this.toastService.showToast(`Saved ${next.name}.`, 'success');
    }

    resetSelectedList(): void {
        const selected = this.selectedRestrictionList();
        if (!selected) {
            return;
        }

        this.setSelectedList(selected.slug);
    }

    clearActiveRestrictions(): void {
        this.restrictionListsService.clearActiveRestrictions();
    }

    isRestrictionActive(slug: string): boolean {
        return this.restrictionListsService.isRestrictionSlugActive(slug);
    }

    toggleRestrictionActive(slug: string, active: boolean): void {
        this.restrictionListsService.toggleActiveRestrictionSlug(slug, active);
    }

    updateName(value: string): void {
        this.patchDraft({ name: value });
    }

    updateDescription(value: string): void {
        this.patchDraft({ description: value });
    }

    updateGameSystem(value: string): void {
        this.patchDraft({
            gameSystem: value === GameSystem.ALPHA_STRIKE ? GameSystem.ALPHA_STRIKE : GameSystem.CLASSIC,
        });
    }

    updateRequireCanon(value: boolean): void {
        this.patchDraft({ requireCanon: value });
    }

    updateForbidQuirks(value: boolean): void {
        this.patchDraft({ forbidQuirks: value });
    }

    updateForbidArrowIVHoming(value: boolean): void {
        this.patchDraft({ forbidArrowIVHoming: value });
    }

    updateMinUnits(value: string): void {
        this.patchDraft({ minUnits: value });
    }

    updateMaxUnits(value: string): void {
        this.patchDraft({ maxUnits: value });
    }

    updateUniqueChassis(value: boolean): void {
        this.patchDraft({ uniqueChassis: value });
    }

    updateJumpRuleEnabled(value: boolean): void {
        this.patchDraft({ jumpRuleEnabled: value });
    }

    updateJumpMinimum(value: string): void {
        this.patchDraft({ jumpMinimum: value });
    }

    updateJumpMaxUnits(value: string): void {
        this.patchDraft({ jumpMaxUnits: value });
    }

    updateCrewSkillMin(value: string): void {
        this.patchDraft({ crewSkillMin: value });
    }

    updateCrewSkillMax(value: string): void {
        this.patchDraft({ crewSkillMax: value });
    }

    updateMaxGunneryPilotingDelta(value: string): void {
        this.patchDraft({ maxGunneryPilotingDelta: value });
    }

    updateAllowManualPilotAbilities(value: boolean): void {
        this.patchDraft({ allowManualPilotAbilities: value });
    }

    updateAllowFormationAbilities(value: boolean): void {
        this.patchDraft({ allowFormationAbilities: value });
    }

    updateNotesText(value: string): void {
        this.patchDraft({ notesText: value });
    }

    updateClassicTypeInput(value: string): void {
        this.classicTypeInput.set(value);
    }

    updateClassicSubtypeInput(value: string): void {
        this.classicSubtypeInput.set(value);
    }

    updateAlphaStrikeTypeInput(value: string): void {
        this.alphaStrikeTypeInput.set(value);
    }

    onCatalogPillKeydown(event: KeyboardEvent, field: CatalogPillField): void {
        if (event.key !== 'Enter' && event.key !== ',') {
            return;
        }

        event.preventDefault();

        switch (field) {
            case 'classicUnitTypes':
                this.addClassicUnitType();
                break;
            case 'classicUnitSubtypes':
                this.addClassicUnitSubtype();
                break;
            case 'alphaStrikeUnitTypes':
                this.addAlphaStrikeUnitType();
                break;
        }
    }

    addClassicUnitType(): void {
        this.addCatalogPill('classicUnitTypes', this.classicTypeInput(), this.classicTypeSuggestions());
        this.classicTypeInput.set('');
    }

    removeClassicUnitType(value: string): void {
        this.removeCatalogPill('classicUnitTypes', value);
    }

    addClassicUnitSubtype(): void {
        this.addCatalogPill('classicUnitSubtypes', this.classicSubtypeInput(), this.classicSubtypeSuggestions());
        this.classicSubtypeInput.set('');
    }

    removeClassicUnitSubtype(value: string): void {
        this.removeCatalogPill('classicUnitSubtypes', value);
    }

    addAlphaStrikeUnitType(): void {
        this.addCatalogPill('alphaStrikeUnitTypes', this.alphaStrikeTypeInput(), this.alphaStrikeTypeSuggestions().map((option) => option.value), resolveAlphaStrikeTypeValue);
        this.alphaStrikeTypeInput.set('');
    }

    removeAlphaStrikeUnitType(value: string): void {
        this.removeCatalogPill('alphaStrikeUnitTypes', value);
    }

    toggleAmmoType(ammoType: AmmoType, checked: boolean): void {
        const draft = this.draft();
        if (!draft) {
            return;
        }

        const nextAmmoTypes = checked
            ? [...draft.forbidAmmoTypes, ammoType]
            : draft.forbidAmmoTypes.filter((entry) => entry !== ammoType);

        this.patchDraft({ forbidAmmoTypes: [...new Set(nextAmmoTypes)] });
    }

    formatGameSystem(gameSystem: GameSystem): string {
        return gameSystem === GameSystem.CLASSIC ? 'Classic' : 'Alpha Strike';
    }

    formatAlphaStrikeType(value: string): string {
        return formatAlphaStrikeTypeValue(value);
    }

    private setSelectedList(slug: string | null): void {
        const list = this.restrictionListsService.getRestrictionListBySlug(slug);
        this.selectedSlug.set(list?.slug ?? null);
        this.draft.set(list ? createDraftFromDefinition(list) : null);
        this.clearCatalogInputs();
    }

    private patchDraft(patch: Partial<RestrictionListEditorDraft>): void {
        const draft = this.draft();
        if (!draft) {
            return;
        }

        this.draft.set({
            ...draft,
            ...patch,
        });
    }

    private addCatalogPill(
        field: CatalogPillField,
        rawValue: string,
        suggestions: readonly string[],
        resolver: (value: string) => string = (value) => resolveSuggestedCatalogValue(value, suggestions),
    ): void {
        const draft = this.draft();
        const normalizedInput = normalizeCatalogInputValue(rawValue);
        if (!draft || !normalizedInput) {
            return;
        }

        const nextValues = normalizeRestrictionCatalogValues([
            ...draft[field],
            resolver(normalizedInput),
        ]);

        this.patchDraft({ [field]: nextValues } as Partial<RestrictionListEditorDraft>);
    }

    private removeCatalogPill(field: CatalogPillField, value: string): void {
        const draft = this.draft();
        if (!draft) {
            return;
        }

        const normalizedValue = normalizeCatalogInputValue(value).toLowerCase();
        this.patchDraft({
            [field]: draft[field].filter((entry) => normalizeCatalogInputValue(entry).toLowerCase() !== normalizedValue),
        } as Partial<RestrictionListEditorDraft>);
    }

    private clearCatalogInputs(): void {
        this.classicTypeInput.set('');
        this.classicSubtypeInput.set('');
        this.alphaStrikeTypeInput.set('');
    }

    private async confirmDiscardChanges(): Promise<boolean> {
        if (!this.hasDraftChanges()) {
            return true;
        }

        return this.dialogsService.requestConfirmation(
            'Discard the unsaved changes for this restriction list?',
            'Discard Changes',
            'warning',
        );
    }
}