// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import { computed, effect, inject, Injectable, Injector, signal, untracked } from '@angular/core';

import { ASForce } from '../models/as-force.model';
import { CBTForce } from '../models/cbt-force.model';
import { GameSystem } from '../models/common.model';
import type { Force } from '../models/force.model';
import type { ForceMember } from '../models/force-member.model';
import type { ForceAlignment, ForceSlot } from '../models/force-slot.model';
import { LanceTypeIdentifierUtil } from '../utils/lance-type-identifier.util';
import {
    buildMultiForceQueryParams,
    parseForceUrl,
    type ForceQueryParams,
    type ForceUrlUnitLookupMode,
} from '../utils/force-url.util';
import { DataService } from './data.service';
import { ForcePersistenceService } from './force-persistence.service';
import { DialogsService } from './dialogs.service';
import { ForceOperationService } from './force-operation.service';
import { ForceUnitAdmissionService } from './force-unit-admission.service';
import { LayoutService } from './layout.service';
import { LoggerService } from './logger.service';
import { UrlService } from './url.service';

export interface ForceUrlWorkspace {
    readonly loadedForces: () => readonly ForceSlot[];
    readonly selectedUnit: () => ForceMember | null;
    readonly selectUnit: (unit: ForceMember | null) => void;
    readonly clear: () => Promise<boolean>;
    readonly addLoadedForce: (force: Force, alignment: ForceAlignment, activate: boolean) => boolean;
    readonly getForceSlot: (force: Force) => ForceSlot | undefined;
}

/** Owns force URL parsing, startup restoration, and URL synchronization. */
@Injectable({ providedIn: 'root' })
export class ForceUrlStateService {
    private readonly dataService = inject(DataService);
    private readonly forcePersistence = inject(ForcePersistenceService);
    private readonly dialogsService = inject(DialogsService);
    private readonly layoutService = inject(LayoutService);
    private readonly logger = inject(LoggerService);
    private readonly operations = inject(ForceOperationService);
    private readonly unitAdmission = inject(ForceUnitAdmissionService);
    private readonly urlService = inject(UrlService);
    private readonly injector = inject(Injector);

    private workspace: ForceUrlWorkspace | null = null;
    private readonly synchronizationEnabled = signal(false);
    private startupRequested = false;
    private started = false;

    readonly queryParameters = computed<ForceQueryParams>(() => {
        const operation = this.operations.currentOperation();
        if (operation) {
            return {
                gs: null,
                units: null,
                name: null,
                instance: null,
                operation: operation.operationId,
                factionId: null,
                eraId: null,
            };
        }
        const workspace = this.workspace;
        if (!workspace) {
            return {
                gs: null,
                units: null,
                name: null,
                instance: null,
                operation: null,
                factionId: null,
                eraId: null,
            };
        }
        return { ...buildMultiForceQueryParams(workspace.loadedForces()), operation: null };
    });

    configure(workspace: ForceUrlWorkspace): void {
        if (this.workspace && this.workspace !== workspace) {
            throw new Error('ForceUrlStateService is already configured.');
        }
        this.workspace = workspace;
    }

    start(): void {
        if (this.started) return;
        this.started = true;
        this.requireWorkspace();

        effect(() => {
            const params = this.queryParameters();
            const workspace = this.requireWorkspace();
            const selectedUnit = workspace.selectedUnit();
            const selectedId = selectedUnit?.force?.instanceId() ? selectedUnit.id : null;
            if (!this.synchronizationEnabled()) return;
            this.urlService.setQueryParams({ ...params, sel: selectedId });
        });

        effect(() => {
            if (this.startupRequested || !this.dataService.isDataReady() || this.synchronizationEnabled()) return;
            this.startupRequested = true;
            untracked(() => void this.initializeFromUrl());
        });
    }

    setSynchronizationEnabled(enabled: boolean): void {
        this.synchronizationEnabled.set(enabled);
    }

    clearQuery(): void {
        this.urlService.setQueryParams({
            units: null,
            name: null,
            instance: null,
            operation: null,
            factionId: null,
            eraId: null,
            sel: null,
        });
    }

    async loadForceFromUrlParams(
        params: URLSearchParams,
        mode: 'replace' | 'add' = 'replace',
        alignment: ForceAlignment = 'friendly',
    ): Promise<boolean> {
        const submittedParams = new URLSearchParams(params.toString());
        const workspace = this.requireWorkspace();
        if (mode === 'replace' && !await workspace.clear()) return false;
        return this.loadForceParamsCore(submittedParams, alignment);
    }

    private async initializeFromUrl(): Promise<void> {
        const params = new URLSearchParams(this.urlService.initialParams.toString());
        try {
            const operationId = params.get('operation');
            if (operationId) {
                const loaded = await this.operations.loadOperation(operationId, { skipPrompts: true });
                if (loaded) {
                    this.restoreSelectionFromUrl(params);
                    return;
                }
                this.logger.warn(`Force URL startup: operation "${operationId}" was not found; loading force parameters.`);
            }

            const loadedAny = await this.loadForceParamsCore(params);
            this.restoreSelectionFromUrl(params);

            if (loadedAny) {
                const allNonOwned = this.requireWorkspace().loadedForces().every(slot => !slot.force.owned());
                if (allNonOwned) {
                    this.dialogsService.showNotice(
                        'Reports indicate another commander owns this force. Clone to adopt it for yourself.',
                        'Captured Intel',
                    );
                }
            } else if (params.has('instance')) {
                this.urlService.setQueryParams({ instance: null });
            }
        } finally {
            this.synchronizationEnabled.set(true);
        }
    }

    private restoreSelectionFromUrl(params: URLSearchParams): void {
        const selectedId = params.get('sel');
        if (!selectedId) return;
        const workspace = this.requireWorkspace();
        for (const slot of workspace.loadedForces()) {
            const unit = slot.force.members().find(member => member.id === selectedId);
            if (unit) {
                workspace.selectUnit(unit);
                return;
            }
        }
    }

    private async loadForceParamsCore(
        params: URLSearchParams,
        defaultAlignment: ForceAlignment = 'friendly',
    ): Promise<boolean> {
        const workspace = this.requireWorkspace();
        let loadedAny = false;
        const isFirst = workspace.loadedForces().length === 0;

        const instanceParam = params.get('instance');
        if (instanceParam) {
            const entries = instanceParam.split(',').map(entry => entry.trim()).filter(Boolean);
            for (const entry of entries) {
                const enemy = entry.startsWith('enemy:');
                const alignment: ForceAlignment = enemy ? 'enemy' : defaultAlignment;
                const instanceId = enemy ? entry.substring('enemy:'.length) : entry;
                if (workspace.loadedForces().some(slot => slot.force.instanceId() === instanceId)) continue;

                const force = await this.forcePersistence.getForce(instanceId);
                if (!force) {
                    this.logger.warn(`Force URL startup: instance "${instanceId}" was not found.`);
                    continue;
                }
                const added = workspace.addLoadedForce(force, alignment, !loadedAny && isFirst);
                if (added) {
                    loadedAny = true;
                }
            }
        }

        const unitsParam = params.get('units');
        const mulIdsParam = params.get('mul_ids');
        const inlineUnitsParam = unitsParam || mulIdsParam;
        const lookupMode: ForceUrlUnitLookupMode = unitsParam ? 'name' : 'mulId';
        if (inlineUnitsParam) {
            const force = this.createInlineForce(params);
            force.loading = true;
            try {
                const admitted = await this.parseUnitsFromUrl(force, inlineUnitsParam, lookupMode);
                if (admitted.length > 0) {
                    this.logger.info(`Force URL startup: loaded ${admitted.length} units.`);
                    if (this.layoutService.isMobile()) this.layoutService.openMenu();
                }
            } finally {
                force.loading = false;
            }

            if (force.members().length > 0) {
                const added = workspace.addLoadedForce(force, defaultAlignment, !loadedAny && isFirst);
                if (added) {
                    loadedAny = true;
                }
            }
        }

        return loadedAny;
    }

    private createInlineForce(params: URLSearchParams): Force {
        const name = params.get('name') ?? '';
        const gameSystem = params.get('gs') ?? GameSystem.CBT;
        const force: Force = gameSystem === GameSystem.AS
            ? new ASForce(name, this.dataService, this.injector)
            : new CBTForce(name, this.dataService, this.injector);

        const factionId = Number.parseInt(params.get('factionId') ?? '', 10);
        if (Number.isInteger(factionId)) {
            const faction = this.dataService.getFactionById(factionId) ?? null;
            force.faction.set(faction);
            force.factionLock = faction !== null;
        }
        const eraId = Number.parseInt(params.get('eraId') ?? '', 10);
        if (Number.isInteger(eraId)) {
            const era = this.dataService.getEraById(eraId) ?? null;
            force.era.set(era);
            force.eraLock = era !== null;
        }
        return force;
    }

    private async parseUnitsFromUrl(
        force: Force,
        unitsParam: string,
        lookupMode: ForceUrlUnitLookupMode,
    ): Promise<ForceMember[]> {
        const admitted: ForceMember[] = [];
        for (const parsedGroup of parseForceUrl(unitsParam, this.dataService.getUnits(), this.logger, lookupMode)) {
            const group = await force.addGroup(parsedGroup.name || undefined);
            if (parsedGroup.formationId) {
                const formation = LanceTypeIdentifierUtil.getDefinitionById(parsedGroup.formationId, force.gameSystem);
                if (formation) {
                    await force.updateGroup(group, { formation, formationLock: true });
                }
            }
            for (const unit of parsedGroup.units) {
                try {
                    admitted.push(await this.unitAdmission.admit({
                        force,
                        group,
                        summary: unit.summary,
                        ...(unit.gunnerySkill === undefined ? {} : { gunnerySkill: unit.gunnerySkill }),
                        ...(unit.pilotingSkill === undefined ? {} : { pilotingSkill: unit.pilotingSkill }),
                    }));
                } catch (error) {
                    this.logger.warn(`Force URL startup: unit "${unit.summary.name}" was deferred: ${error}`);
                }
            }
            if (force.membersInGroup(group).length === 0) {
                await force.removeGroup(group);
            }
        }
        return admitted;
    }

    private requireWorkspace(): ForceUrlWorkspace {
        if (!this.workspace) throw new Error('ForceUrlStateService has not been configured.');
        return this.workspace;
    }
}
