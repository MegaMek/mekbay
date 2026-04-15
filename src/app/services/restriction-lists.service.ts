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

import { Injectable, computed, inject, signal, effect } from '@angular/core';
import { ASForceUnit } from '../models/as-force-unit.model';
import { CBTForceUnit } from '../models/cbt-force-unit.model';
import { GameSystem } from '../models/common.model';
import type { Force } from '../models/force.model';
import type { RestrictionForceSnapshot, RestrictionListDefinition } from '../models/restriction-lists.model';
import type { Unit } from '../models/units.model';
import { UrlStateService } from './url-state.service';
import { generateUUID } from './ws.service';
import {
    buildRestrictionWarningMessage,
    filterUnitsByRestrictionLists,
    groupRestrictionViolationsByForceUnitId,
    normalizeRestrictionCatalogValues,
    normalizeRestrictionListSlugs,
    serializeRestrictionListSlugsParam,
    validateForceAgainstRestrictionLists,
} from '../utils/restriction-lists.util';

const CUSTOM_RESTRICTION_LISTS_STORAGE_KEY = 'mekbay:custom-restriction-lists';

@Injectable({ providedIn: 'root' })
export class RestrictionListsService {
    private readonly urlStateService = inject(UrlStateService);

    private readonly activeRestrictionSlugsState = signal<string[]>([]);
    private readonly customRestrictionListsState = signal<RestrictionListDefinition[]>(this.loadCustomRestrictionLists());

    readonly activeRestrictionSlugs = this.activeRestrictionSlugsState.asReadonly();
    readonly customRestrictionLists = this.customRestrictionListsState.asReadonly();
    readonly availableRestrictionLists = computed(() => this.sortRestrictionLists(this.customRestrictionListsState()));
    readonly restrictionListsParam = computed(() => serializeRestrictionListSlugsParam(this.activeRestrictionSlugsState()));

    constructor() {
        this.urlStateService.registerConsumer('restriction-lists');
        this.applyParamsFromUrl(this.urlStateService.initialState.params);
        this.urlStateService.markConsumerReady('restriction-lists');

        effect(() => {
            this.urlStateService.setParams({
                rl: this.restrictionListsParam(),
            });
        });
    }

    applyParamsFromUrl(params: URLSearchParams): void {
        this.activeRestrictionSlugsState.set(this.normalizeActiveRestrictionSlugs(params.get('rl')));
    }

    setActiveRestrictionSlugs(slugs: readonly string[]): void {
        this.activeRestrictionSlugsState.set(this.normalizeActiveRestrictionSlugs(slugs));
    }

    clearActiveRestrictions(): void {
        this.activeRestrictionSlugsState.set([]);
    }

    toggleActiveRestrictionSlug(slug: string, active: boolean): void {
        const normalizedSlug = this.normalizeActiveRestrictionSlugs([slug]).at(0);
        if (!normalizedSlug) {
            return;
        }

        const next = new Set(this.activeRestrictionSlugsState());
        if (active) {
            next.add(normalizedSlug);
        } else {
            next.delete(normalizedSlug);
        }

        this.activeRestrictionSlugsState.set(this.normalizeActiveRestrictionSlugs([...next]));
    }

    isRestrictionSlugActive(slug: string): boolean {
        return this.activeRestrictionSlugsState().includes(slug);
    }

    getRestrictionListBySlug(slug: string | null | undefined): RestrictionListDefinition | null {
        if (!slug) {
            return null;
        }

        return this.availableRestrictionLists().find((list) => list.slug === slug) ?? null;
    }

    getActiveRestrictionLists(gameSystem?: GameSystem): RestrictionListDefinition[] {
        return this.availableRestrictionLists()
            .filter((list) => this.activeRestrictionSlugsState().includes(list.slug))
            .filter((list) => gameSystem === undefined || list.gameSystem === gameSystem);
    }

    createCustomRestrictionList(gameSystem: GameSystem = GameSystem.CLASSIC): RestrictionListDefinition {
        const now = new Date().toISOString();
        const list: RestrictionListDefinition = {
            slug: `custom-${generateUUID()}`,
            name: 'New Restriction List',
            description: '',
            updatedAt: now,
            gameSystem,
            catalog: {
                allowClassicUnitTypes: [],
                allowClassicUnitSubtypes: [],
                allowAlphaStrikeUnitTypes: [],
                requireCanon: false,
                forbidQuirks: false,
                forbidAmmoTypes: [],
                forbidArrowIVHoming: false,
            },
            roster: {
                uniqueChassis: false,
            },
            live: gameSystem === GameSystem.CLASSIC
                ? {
                    classic: {
                        crewSkillMin: 0,
                        crewSkillMax: 5,
                        maxGunneryPilotingDelta: 1,
                    },
                }
                : {
                    alphaStrike: {
                        allowManualPilotAbilities: true,
                        allowFormationAbilities: true,
                    },
                },
            notes: [],
        };

        this.saveCustomRestrictionList(list);
        return list;
    }

    duplicateRestrictionList(sourceSlug: string): RestrictionListDefinition | null {
        const source = this.getRestrictionListBySlug(sourceSlug);
        if (!source) {
            return null;
        }

        const duplicate: RestrictionListDefinition = {
            ...source,
            slug: `custom-${generateUUID()}`,
            name: `${source.name} Copy`,
            updatedAt: new Date().toISOString(),
        };

        this.saveCustomRestrictionList(duplicate);
        return duplicate;
    }

    saveCustomRestrictionList(list: RestrictionListDefinition): void {
        const normalized = this.normalizeCustomRestrictionList(list);
        const nextLists = [...this.customRestrictionListsState()];
        const existingIndex = nextLists.findIndex((entry) => entry.slug === normalized.slug);
        if (existingIndex >= 0) {
            nextLists.splice(existingIndex, 1, normalized);
        } else {
            nextLists.push(normalized);
        }

        const sorted = this.sortRestrictionLists(nextLists);
        this.customRestrictionListsState.set(sorted);
        this.persistCustomRestrictionLists(sorted);
    }

    deleteCustomRestrictionList(slug: string): void {
        const nextLists = this.customRestrictionListsState().filter((list) => list.slug !== slug);
        if (nextLists.length === this.customRestrictionListsState().length) {
            return;
        }

        this.customRestrictionListsState.set(nextLists);
        this.persistCustomRestrictionLists(nextLists);
        this.activeRestrictionSlugsState.set(this.activeRestrictionSlugsState().filter((entry) => entry !== slug));
    }

    filterUnits(units: readonly Unit[], gameSystem: GameSystem): Unit[] {
        return filterUnitsByRestrictionLists(units, this.getActiveRestrictionLists(gameSystem));
    }

    getForceValidation(force: Force) {
        return validateForceAgainstRestrictionLists(this.buildForceSnapshot(force), this.getActiveRestrictionLists(force.gameSystem));
    }

    getForceWarningMessage(force: Force): string | null {
        return buildRestrictionWarningMessage(this.getForceValidation(force));
    }

    getForceUnitViolationMap(force: Force) {
        return groupRestrictionViolationsByForceUnitId(this.getForceValidation(force));
    }

    private sortRestrictionLists(lists: readonly RestrictionListDefinition[]): RestrictionListDefinition[] {
        return [...lists].sort((left, right) => left.name.localeCompare(right.name, undefined, { sensitivity: 'base' }));
    }

    private normalizeActiveRestrictionSlugs(slugsOrParam: readonly string[] | string | null): string[] {
        const slugs = Array.isArray(slugsOrParam)
            ? normalizeRestrictionListSlugs(slugsOrParam)
            : normalizeRestrictionListSlugs((typeof slugsOrParam === 'string' ? slugsOrParam : '').split(','));
        const availableSlugs = new Set(this.availableRestrictionLists().map((list) => list.slug));

        return slugs.filter((slug) => availableSlugs.has(slug));
    }

    private loadCustomRestrictionLists(): RestrictionListDefinition[] {
        if (typeof localStorage === 'undefined') {
            return [];
        }

        try {
            const raw = localStorage.getItem(CUSTOM_RESTRICTION_LISTS_STORAGE_KEY);
            if (!raw) {
                return [];
            }

            const parsed = JSON.parse(raw);
            if (!Array.isArray(parsed)) {
                return [];
            }

            return parsed
                .map((value) => this.normalizeCustomRestrictionList(value))
                .filter((value): value is RestrictionListDefinition => !!value);
        } catch {
            return [];
        }
    }

    private persistCustomRestrictionLists(lists: readonly RestrictionListDefinition[]): void {
        if (typeof localStorage === 'undefined') {
            return;
        }

        localStorage.setItem(CUSTOM_RESTRICTION_LISTS_STORAGE_KEY, JSON.stringify(lists));
    }

    private normalizeCustomRestrictionList(value: unknown): RestrictionListDefinition {
        const list = value as Partial<RestrictionListDefinition> | null | undefined;
        const now = new Date().toISOString();
        const slug = typeof list?.slug === 'string' && list.slug.trim().length > 0
            ? list.slug.trim().toLowerCase()
            : `custom-${generateUUID()}`;
        const gameSystem = list?.gameSystem === GameSystem.ALPHA_STRIKE ? GameSystem.ALPHA_STRIKE : GameSystem.CLASSIC;
        const legacyAllowUnitTypes = normalizeRestrictionCatalogValues((list?.catalog as { allowUnitTypes?: readonly string[] } | undefined)?.allowUnitTypes);

        return {
            slug,
            name: typeof list?.name === 'string' && list.name.trim().length > 0 ? list.name.trim() : 'New Restriction List',
            description: typeof list?.description === 'string' ? list.description.trim() : '',
            updatedAt: typeof list?.updatedAt === 'string' && list.updatedAt.trim().length > 0 ? list.updatedAt : now,
            gameSystem,
            catalog: {
                allowClassicUnitTypes: normalizeRestrictionCatalogValues(list?.catalog?.allowClassicUnitTypes ?? (gameSystem === GameSystem.CLASSIC ? legacyAllowUnitTypes : [])),
                allowClassicUnitSubtypes: normalizeRestrictionCatalogValues(list?.catalog?.allowClassicUnitSubtypes),
                allowAlphaStrikeUnitTypes: normalizeRestrictionCatalogValues(list?.catalog?.allowAlphaStrikeUnitTypes),
                requireCanon: list?.catalog?.requireCanon === true,
                forbidQuirks: list?.catalog?.forbidQuirks === true,
                forbidAmmoTypes: list?.catalog?.forbidAmmoTypes?.filter(Boolean) ?? [],
                forbidArrowIVHoming: list?.catalog?.forbidArrowIVHoming === true,
            },
            roster: {
                minUnits: typeof list?.roster?.minUnits === 'number' ? list.roster.minUnits : undefined,
                maxUnits: typeof list?.roster?.maxUnits === 'number' ? list.roster.maxUnits : undefined,
                uniqueChassis: list?.roster?.uniqueChassis === true,
                maxUnitsWithJumpAtLeast: list?.roster?.maxUnitsWithJumpAtLeast
                    ? {
                        minimumJump: list.roster.maxUnitsWithJumpAtLeast.minimumJump,
                        maxUnits: list.roster.maxUnitsWithJumpAtLeast.maxUnits,
                    }
                    : undefined,
            },
            live: gameSystem === GameSystem.CLASSIC
                ? {
                    classic: {
                        crewSkillMin: typeof list?.live?.classic?.crewSkillMin === 'number' ? list.live.classic.crewSkillMin : undefined,
                        crewSkillMax: typeof list?.live?.classic?.crewSkillMax === 'number' ? list.live.classic.crewSkillMax : undefined,
                        maxGunneryPilotingDelta: typeof list?.live?.classic?.maxGunneryPilotingDelta === 'number'
                            ? list.live.classic.maxGunneryPilotingDelta
                            : undefined,
                    },
                }
                : {
                    alphaStrike: {
                        allowManualPilotAbilities: list?.live?.alphaStrike?.allowManualPilotAbilities !== false,
                        allowFormationAbilities: list?.live?.alphaStrike?.allowFormationAbilities !== false,
                    },
                },
            notes: Array.isArray(list?.notes)
                ? list.notes.map((note) => `${note}`.trim()).filter((note) => note.length > 0)
                : [],
        };
    }

    private buildForceSnapshot(force: Force): RestrictionForceSnapshot {
        return {
            name: force.displayName(),
            gameSystem: force.gameSystem,
            units: force.units().map((forceUnit) => {
                const unit = forceUnit.getUnit();
                if (forceUnit instanceof CBTForceUnit) {
                    const crewMembers = forceUnit.getCrewMembers().map((crewMember, index) => ({
                        label: crewMember.getName() || `Crew ${index + 1}`,
                        gunnery: crewMember.getSkill('gunnery'),
                        piloting: crewMember.getSkill('piloting'),
                    }));

                    return {
                        forceUnitId: forceUnit.id,
                        displayName: forceUnit.getDisplayName(),
                        unit,
                        classicCrewSkills: crewMembers,
                    };
                }

                if (forceUnit instanceof ASForceUnit) {
                    return {
                        forceUnitId: forceUnit.id,
                        displayName: forceUnit.getDisplayName(),
                        unit,
                        manualAbilityCount: forceUnit.manualPilotAbilities().length,
                        formationAbilityCount: forceUnit.formationAbilities().length,
                    };
                }

                return {
                    forceUnitId: forceUnit.id,
                    displayName: forceUnit.getDisplayName(),
                    unit,
                };
            }),
        };
    }
}