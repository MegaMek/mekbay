// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import { inject, Injectable, Injector } from '@angular/core';
import { FormationInfoDialogComponent, type FormationInfoDialogData } from '../components/formation-info-dialog/formation-info-dialog.component';
import type { MultiStateSelection } from '../components/multi-select-dropdown/multi-select-dropdown.component';
import { ASForceUnit } from '../models/as-force-unit.model';
import { GameSystem } from '../models/common.model';
import type { Era } from '../models/eras.model';
import type { Faction } from '../models/factions.model';
import type { Force, UnitGroup } from '../models/force.model';
import { isCBTForceMember } from '../models/force-member.model';
import { MULFACTION_EXTINCT, MULFACTION_MERCENARY } from '../models/mulfactions.model';
import type { UnitSummary } from '../models/unit-summary.model';
import { ForceNamerUtil } from '../utils/force-namer.util';
import { FormationAbilityAssignmentUtil } from '../utils/formation-ability-assignment.util';
import { getPositiveDropdownNamesFromFilter } from '../utils/filter-name-resolution.util';
import { LanceTypeIdentifierUtil } from '../utils/lance-type-identifier.util';
import type { FormationTypeDefinition } from '../utils/formation-type.model';
import { getSelectedPositiveDropdownNames } from '../utils/unit-search-shared.util';
import { DataService } from './data.service';
import { DialogsService } from './dialogs.service';
import { UnitAvailabilitySourceService } from './unit-availability-source.service';
import { UnitSearchFiltersService } from './unit-search-filters.service';

@Injectable({ providedIn: 'root' })
export class ForceFormationService {
    private readonly dataService = inject(DataService);
    private readonly dialogsService = inject(DialogsService);
    private readonly injector = inject(Injector);
    private readonly unitAvailabilitySource = inject(UnitAvailabilitySourceService);

    generateFactionAndForceNameIfNeeded(
        force: Force,
        respectFilter = false,
        additionalSummaries: readonly UnitSummary[] = [],
    ): void {
        if (!force) return;

        if (!force.eraLock && respectFilter) {
            const era = this.pickEraFromFilter();
            if (era && era.id !== force.era()?.id) force.era.set(era);
        }
        if (force.factionLock) return;

        const formation = respectFilter ? this.pickFormationFromFilter(force.gameSystem) : null;
        let faction = formation ? this.pickFactionForFormation(formation) : null;
        faction ??= respectFilter ? this.pickFactionFromFilter() : null;
        if (!faction) {
            const eras = this.dataService.getEras();
            const availabilitySummaries = [
                ...force.members().flatMap(member => {
                    if (!isCBTForceMember(member)) return [member.getSummary()];
                    const identity = member.force.getUnitSourceIdentity(member.id);
                    const summary = identity
                        ? this.dataService.getUnitByIdentity(identity.provider, identity.uuid)
                        : undefined;
                    return summary ? [summary] : [];
                }),
                ...additionalSummaries,
            ];
            faction = ForceNamerUtil.pickBestFaction(
                availabilitySummaries,
                this.dataService.getFactions(),
                eras,
                force.faction(),
                this.unitAvailabilitySource.createForceAvailabilityContextForUnits(
                    availabilitySummaries,
                    eras,
                ),
            );
        }
        if (faction?.id === force.faction()?.id) return;
        force.faction.set(faction);
        force.setName(
            ForceNamerUtil.generateForceNameForFaction(faction, this.dataService.getForceNameWords()),
            false,
        );
    }

    async applyFormationFilterToGroup(group: UnitGroup, respectFilter: boolean): Promise<void> {
        if (!respectFilter || group.formationLock) return;
        const formation = this.pickFormationFromFilter(group.force.gameSystem);
        if (!formation) return;
        group.formationHistory.clear();
        await group.force.updateGroup(group, { formation, formationLock: true });
    }

    async assignFormationIfNeeded(group: UnitGroup): Promise<void> {
        const memberCount = group.formationUnits().length;
        if (memberCount === 0) {
            await group.force.updateGroup(group, { formation: null, formationLock: false });
            return;
        }
        if (group.formationLock) {
            this.reconcileASFormationAssignments(group);
            return;
        }
        const best = LanceTypeIdentifierUtil.getBestMatchForGroup(group);
        if (best?.definition.id !== group.formation()?.id) {
            await group.force.updateGroup(group, { formation: best?.definition ?? null });
            if (best) group.formationHistory.add(best.definition.id);
        }
        this.reconcileASFormationAssignments(group);
    }

    reconcileASFormationAssignments(group: UnitGroup | null | undefined): void {
        if (!group || group.force.gameSystem !== GameSystem.AS) return;
        FormationAbilityAssignmentUtil.reconcileGroupFormationAssignments(group as UnitGroup<ASForceUnit>);
    }

    showFormationInfo(group: UnitGroup): void {
        const targetForce = group.force;
        const formation = group.activeFormation();
        if (!targetForce || !formation) return;
        this.dialogsService.createDialog(FormationInfoDialogComponent, {
            data: {
                formation,
                gameSystem: targetForce.gameSystem,
                formationDisplayName: group.formationDisplayName(),
                unitCount: group.formationUnits().length,
                isValid: group.hasValidFormation(),
                requirementsFiltered: group.isFormationRequirementsFiltered(),
                requirementsFilterCompositionName: group.formationRequirementsFilterCompositionName(),
                requirementsFilterNotice: group.formationRequirementsFilterNotice(),
            } as FormationInfoDialogData,
        });
    }

    private pickEraFromFilter(): Era | null {
        try {
            const eraFilter = this.injector.get(UnitSearchFiltersService).effectiveFilterState()['era'];
            if (!eraFilter?.interactedWith || !eraFilter.value) return null;
            const selectedEraNames = getSelectedPositiveDropdownNames(eraFilter.value);
            return selectedEraNames.length > 0
                ? this.dataService.getEraByName(selectedEraNames[0]) ?? null
                : null;
        } catch {
            return null;
        }
    }

    private pickFactionFromFilter(): Faction | null {
        try {
            const factionFilter = this.injector.get(UnitSearchFiltersService).effectiveFilterState()['faction'];
            if (!factionFilter?.interactedWith || !factionFilter.value) return null;
            const positiveFactions = getPositiveDropdownNamesFromFilter(
                factionFilter.value as MultiStateSelection,
                this.dataService.getFactions().map(faction => faction.name),
                factionFilter.wildcardPatterns,
            );
            const candidates = positiveFactions
                .map(name => this.dataService.getFactionByName(name))
                .filter((faction): faction is Faction => !!faction && faction.id !== MULFACTION_EXTINCT);
            return candidates.length > 0
                ? candidates[Math.floor(Math.random() * candidates.length)] ?? null
                : this.dataService.getFactionById(MULFACTION_MERCENARY) ?? null;
        } catch {
            return null;
        }
    }

    private pickFormationFromFilter(gameSystem: GameSystem): FormationTypeDefinition | null {
        try {
            return this.injector.get(UnitSearchFiltersService).getActiveFormationTargetDefinition(gameSystem);
        } catch {
            return null;
        }
    }

    private pickFactionForFormation(formation: FormationTypeDefinition): Faction | null {
        const exclusiveFactionNames = formation.exclusiveFaction ?? [];
        if (exclusiveFactionNames.length === 0) return null;
        return this.dataService.getFactions()
            .filter(faction => faction.id !== MULFACTION_EXTINCT
                && this.factionMatchesFormation(faction, exclusiveFactionNames))
            .sort((left, right) => {
                const order = this.getFormationFactionOrderIndex(left, exclusiveFactionNames)
                    - this.getFormationFactionOrderIndex(right, exclusiveFactionNames);
                return order !== 0 ? order : left.name.localeCompare(right.name);
            })[0] ?? null;
    }

    private factionMatchesFormation(faction: Faction, exclusiveFactionNames: readonly string[]): boolean {
        const factionName = faction.name.toLocaleLowerCase();
        return exclusiveFactionNames.some(name => factionName.includes(name.toLocaleLowerCase()));
    }

    private getFormationFactionOrderIndex(faction: Faction, exclusiveFactionNames: readonly string[]): number {
        const factionName = faction.name.toLocaleLowerCase();
        const index = exclusiveFactionNames.findIndex(name => factionName.includes(name.toLocaleLowerCase()));
        return index >= 0 ? index : Number.MAX_SAFE_INTEGER;
    }
}
