// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import { computed, DestroyRef, effect, inject, Injectable, Injector, signal, untracked } from '@angular/core';

import { ForceLoadingOverlayComponent, type ForceLoadingOverlayData } from '../components/force-loading-overlay/force-loading-overlay.component';
import { ASForce } from '../models/as-force.model';
import { CBTForce } from '../models/cbt-force.model';
import { GameSystem } from '../models/common.model';
import type { Force } from '../models/force.model';
import type { ForceLoadingProgress } from '../models/force-loading-progress.model';
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
    private readonly destroyRef = inject(DestroyRef);

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
            if (this.startupRequested || this.synchronizationEnabled()) return;
            // Force links must block interaction while the catalog is preparing too.
            if (!this.hasInitialForceRequest() && !this.dataService.isDataReady()) return;
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

    private hasInitialForceRequest(): boolean {
        return ['operation', 'instance', 'units', 'mul_ids'].some(key => this.urlService.initialParams.get(key));
    }

    private async initializeFromUrl(): Promise<void> {
        const params = new URLSearchParams(this.urlService.initialParams.toString());
        const message = signal('Preparing force data…');
        const forces = signal<readonly ForceLoadingProgress[]>([]);
        const reportForceProgress = (progress: ForceLoadingProgress): void => {
            forces.update(entries => entries.some(entry => entry.instanceId === progress.instanceId)
                ? entries.map(entry => entry.instanceId === progress.instanceId ? { ...entry, ...progress } : entry)
                : [...entries, progress]);
        };
        const loadingDialog = this.hasInitialForceRequest()
            ? this.dialogsService.createDialog(ForceLoadingOverlayComponent, {
                data: { message, forces } satisfies ForceLoadingOverlayData,
                ariaLabel: 'Loading forces',
                disableClose: true,
                closeOnNavigation: false,
                hasBackdrop: true,
                autoFocus: 'dialog',
                panelClass: 'force-loading-overlay-panel',
            })
            : null;
        const unregisterCleanup = this.destroyRef.onDestroy(() => loadingDialog?.close());
        try {
            if (loadingDialog) await this.dataService.requireApplicationCatalogReady();
            message.set('Loading forces and units…');
            const operationId = params.get('operation');
            if (operationId) {
                const loaded = await this.operations.loadOperation(operationId, {
                    skipPrompts: true, onForceProgress: reportForceProgress,
                });
                if (loaded) {
                    this.restoreSelectionFromUrl(params);
                    return;
                }
                this.logger.warn(`Force URL startup: operation "${operationId}" was not found; loading force parameters.`);
            }

            const loadedAny = await this.loadForceParamsCore(params, message.set, reportForceProgress);
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
        } catch (error) {
            this.logger.error(`Force URL startup failed: ${String(error)}`);
            void this.dialogsService.showError('The forces in this link could not be loaded. Please try opening the link again.', 'Force Loading Failed');
        } finally {
            unregisterCleanup();
            loadingDialog?.close();
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
        reportProgress: (message: string) => void,
        reportForceProgress: (progress: ForceLoadingProgress) => void,
        defaultAlignment: ForceAlignment = 'friendly',
    ): Promise<boolean> {
        const workspace = this.requireWorkspace();
        let loadedAny = false;
        const isFirst = workspace.loadedForces().length === 0;

        const instanceParam = params.get('instance');
        if (instanceParam) {
            const entries = instanceParam.split(',').map(entry => entry.trim()).filter(Boolean);
            for (const entry of entries) {
                reportForceProgress({ instanceId: entry.replace(/^enemy:/, ''), status: 'pending' });
            }
            for (const [index, entry] of entries.entries()) {
                const enemy = entry.startsWith('enemy:');
                const alignment: ForceAlignment = enemy ? 'enemy' : defaultAlignment;
                const instanceId = enemy ? entry.substring('enemy:'.length) : entry;
                if (workspace.loadedForces().some(slot => slot.force.instanceId() === instanceId)) {
                    reportForceProgress({ instanceId, status: 'loaded' });
                    continue;
                }

                reportProgress(`Loading force ${index + 1} of ${entries.length}…`);
                reportForceProgress({ instanceId, status: 'loading' });
                const force = await this.forcePersistence.getForce(instanceId, false, {
                    showLoading: false,
                    onMetadata: metadata => reportForceProgress({ ...metadata, status: 'loading' }),
                });
                if (!force) {
                    reportForceProgress({ instanceId, status: 'failed' });
                    this.logger.warn(`Force URL startup: instance "${instanceId}" was not found.`);
                    continue;
                }
                const added = workspace.addLoadedForce(force, alignment, !loadedAny && isFirst);
                reportForceProgress({ instanceId, status: added ? 'loaded' : 'failed' });
                if (added) {
                    loadedAny = true;
                }
            }
        }

        const unitsParam = params.get('units');
        const mulIdsParam = params.get('mul_ids');
        const inlineUnitsParam = unitsParam || mulIdsParam;
        const lookupMode: ForceUrlUnitLookupMode = unitsParam ? 'identifier' : 'mulId';
        if (inlineUnitsParam) {
            reportProgress(params.get('name') ? `Loading ${params.get('name')}…` : 'Loading shared units…');
            const force = this.createInlineForce(params);
            const inlineProgress = {
                instanceId: 'inline',
                name: force.displayName(),
                factionId: force.faction()?.id,
                eraId: force.era()?.id,
            };
            reportForceProgress({ ...inlineProgress, status: 'loading' });
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
                reportForceProgress({ ...inlineProgress, status: added ? 'loaded' : 'failed' });
                if (added) {
                    loadedAny = true;
                }
            } else {
                reportForceProgress({ ...inlineProgress, status: 'failed' });
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
