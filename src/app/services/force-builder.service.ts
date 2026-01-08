/*
 * Copyright (C) 2025 The MegaMek Team. All Rights Reserved.
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

import { Injectable, signal, effect, computed, Injector, inject, untracked, DestroyRef } from '@angular/core';
import { Router, ActivatedRoute } from '@angular/router';
import { Unit } from '../models/units.model';
import { Force, UnitGroup } from '../models/force.model';
import { ForceUnit } from '../models/force-unit.model';
import { DataService } from './data.service';
import { LayoutService } from './layout.service';
import { ForceNamerUtil } from '../utils/force-namer.util';
import { ConfirmDialogComponent, ConfirmDialogData } from '../components/confirm-dialog/confirm-dialog.component';
import { firstValueFrom } from 'rxjs';
import { RenameForceDialogComponent, RenameForceDialogData } from '../components/rename-force-dialog/rename-force-dialog.component';
import { RenameGroupDialogComponent, RenameGroupDialogData } from '../components/rename-group-dialog/rename-group-dialog.component';
import { UnitInitializerService } from './unit-initializer.service';
import { DialogsService } from './dialogs.service';
import { generateUUID, WsService } from './ws.service';
import { ToastService } from './toast.service';
import { LoggerService } from './logger.service';
import { LoadForceEntry } from '../models/load-force-entry.model';
import { ForceLoadDialogComponent } from '../components/force-load-dialog/force-load-dialog.component';
import { ForcePackDialogComponent } from '../components/force-pack-dialog/force-pack-dialog.component';
import { SerializedForce } from '../models/force-serialization';
import { EditPilotDialogComponent, EditPilotDialogData, EditPilotResult } from '../components/edit-pilot-dialog/edit-pilot-dialog.component';
import { EditASPilotDialogComponent, EditASPilotDialogData, EditASPilotResult } from '../components/edit-as-pilot-dialog/edit-as-pilot-dialog.component';
import { CrewMember } from '../models/crew-member.model';
import { GameSystem } from '../models/common.model';
import { CBTForce } from '../models/cbt-force.model';
import { ASForce } from '../models/as-force.model';
import { ASForceUnit } from '../models/as-force-unit.model';
import { OptionsService } from './options.service';
import { GameService } from './game.service';
import { UrlStateService } from './url-state.service';

/*
 * Author: Drake
 */
@Injectable({
    providedIn: 'root'
})
export class ForceBuilderService {
    logger = inject(LoggerService);
    dataService = inject(DataService);
    layoutService = inject(LayoutService);
    toastService = inject(ToastService);
    wsService = inject(WsService);
    private router = inject(Router);
    private route = inject(ActivatedRoute);
    private dialogsService = inject(DialogsService);
    private unitInitializer = inject(UnitInitializerService);
    private injector = inject(Injector);
    private optionsService = inject(OptionsService);
    private urlStateService = inject(UrlStateService);

    public currentForce = signal<Force | null>(null);
    public selectedUnit = signal<ForceUnit | null>(null);
    private urlStateInitialized = false;
    private forceChangedSubscription: any;
    private conflictDialogRef: any;

    constructor() {
        // Register as a URL state consumer - must call markConsumerReady when done reading URL
        this.urlStateService.registerConsumer('force-builder');
        
        this.loadUnitsFromUrlOnStartup();
        this.updateUrlOnForceChange();
        this.setForce(this.currentForce());
        this.monitorWebSocketConnection();
        inject(DestroyRef).onDestroy(() => {
            // Clean up subscription
            if (this.forceChangedSubscription) {
                this.forceChangedSubscription.unsubscribe();
            }
            if (this.conflictDialogRef) {
                this.conflictDialogRef.close();
                this.conflictDialogRef = undefined;
            }
            // Clean up units in the current force
            this.currentForce()?.units().forEach(unit => unit.destroy());
        });
    }

    get force(): Force | null {
        return this.currentForce();
    }

    forceUnits = computed<ForceUnit[] | undefined>(() => this.currentForce()?.units());
    hasUnits = computed<boolean>(() => {
        const currentForce = this.currentForce();
        if (!currentForce) {
            return false;
        }
        return currentForce.units().length > 0;
    });

    readOnlyForce = computed<boolean>(() => {
        return this.currentForce()?.readOnly() ?? false;
    });

    setForce(newForce: Force | null) {
        // Unsubscribe from previous force
        this.selectedUnit.set(null);
        if (this.forceChangedSubscription) {
            this.forceChangedSubscription.unsubscribe();
        }
        const currentForce = this.currentForce();
        const currentForceInstanceId = currentForce?.instanceId();
        if (currentForceInstanceId) {
            this.wsService.unsubscribeFromForceUpdates(currentForceInstanceId);
        }
        // Clean up old units before setting the new force
        currentForce?.units().forEach(unit => unit.destroy());
        this.currentForce.set(newForce);
        if (!newForce) {
            return;
        }
        const instanceId = newForce.instanceId();
        this.logger.info(`ForceBuilderService: Setting new force with name "${newForce.name}"${instanceId ? ` and instance ID ${instanceId}` : ''}"`);
        if (instanceId) {
            this.wsService.subscribeToForceUpdates(instanceId, (serializedForce: SerializedForce) => {
                if (serializedForce.instanceId !== newForce.instanceId()) {
                    this.logger.warn(`Received force update for instance ID ${serializedForce.instanceId}, but current force has instance ID ${newForce.instanceId()}. Ignoring update.`);
                    return;
                }
                this.replaceForceInPlace(serializedForce);
            });
        }
        // Subscribe to new force's changed event
        this.forceChangedSubscription = newForce.changed.subscribe(() => {
            this.dataService.saveForce(newForce);
            const forceInstanceId = newForce.instanceId();
            this.logger.info(`ForceBuilderService: Auto-saved force with instance ID ${forceInstanceId}`);
        });
    }
    
    private async replaceForceInPlace(serializedForce: SerializedForce) {
        const currentForce = this.currentForce();
        if (!currentForce) {
            return;
        }
        try {
            this.urlStateInitialized = false; // Reset URL state initialization
            const selectedUnitId = this.selectedUnit()?.id;
            const selectedIndex = currentForce.units().findIndex(u => u.id === selectedUnitId);
            currentForce.update(serializedForce);
            this.dataService.saveSerializedForceToLocalStorage(serializedForce);
            // Restore selected unit if possible
            const newSelectedUnit = currentForce.units().find(u => u.id === selectedUnitId);
            this.selectUnit(newSelectedUnit || currentForce.units()[selectedIndex] || currentForce.units()[0] || null);
        } finally {
            this.urlStateInitialized = true; // Re-enable URL state initialization
        }
    }

    async loadForce(force: Force): Promise<boolean> {
        // Prompt to save current force if needed
        const shouldContinue = await this.promptSaveForceIfNeeded();
        if (!shouldContinue) {
            return false; // User cancelled, do not load new force
        }

        this.urlStateInitialized = false; // Reset URL state initialization
        try {
            this.setForce(force);
            this.selectUnit(force.units()[0] || null);
        } finally {
            this.urlStateInitialized = true; // Re-enable URL state initialization
        }
        return true;
    }

    async removeForce(name: string = 'New Force') {
        // Prompt to save current force if needed
        const shouldContinue = await this.promptSaveForceIfNeeded();
        if (!shouldContinue) {
            return false; // User cancelled, do not load new force
        }
        this.setForce(null);
        this.clearForceUrlParams();
        this.logger.info('ForceBuilderService: Current force removed.');
        return true;
    }

    private clearForceUrlParams() {
        const urlTree = this.router.parseUrl(this.router.url);
        const currentPath = urlTree.root.children['primary']?.segments.map(s => s.path).join('/') || '';
        this.router.navigate([currentPath], {
            queryParams: {
                units: null,
                name: null,
                instance: null
            },
            queryParamsHandling: 'merge',
            replaceUrl: true
        });
    }

    async createNewForce(name: string = 'New Force'): Promise<Force | null> {
        // Lazy inject GameService to avoid circular dependency
        const gameService = this.injector.get(GameService);
        const gameSystem = gameService.currentGameSystem();
        let newForce: Force | null = null;
        if (gameSystem === GameSystem.ALPHA_STRIKE) {
            newForce = new ASForce(name, this.dataService, this.unitInitializer, this.injector);
        } else {
            newForce = new CBTForce(name, this.dataService, this.unitInitializer, this.injector);
        }
        if (newForce && !await this.loadForce(newForce)) {
            return null;
        }
        return newForce;
    }

    /**
     * Adds a new unit to the force. The unit is cloned to prevent
     * modifications to the original object, and it's set as the
     * currently selected unit.
     * @param unit The unit to add.
     * @param gunnerySkill Optional gunnery skill to set for the crew
     * @param pilotingSkill Optional piloting skill to set for the crew
     */
    async addUnit(unit: Unit, gunnerySkill?: number, pilotingSkill?: number, group?: UnitGroup): Promise<ForceUnit | null> {
        let currentForce = this.currentForce();
        if (!currentForce) {
            currentForce = await this.createNewForce();
            if (!currentForce) {
                return null;
            }
        }
        let newForceUnit;
        try {
            newForceUnit = currentForce.addUnit(unit);
        } catch (error) {
            this.toastService.show(error instanceof Error ? error.message : (error as string), 'error');
            return null;
        }

        // Set crew skills if provided
        if (gunnerySkill !== undefined || pilotingSkill !== undefined) {
            const crewMembers = newForceUnit.getCrewMembers();
            newForceUnit.disabledSaving = true;
            if (unit.type === 'ProtoMek') {
                // ProtoMeks have a fixed Piloting skill of 5
                pilotingSkill = 5;
            }
            for (const crew of crewMembers) {
                if (gunnerySkill !== undefined) {
                    crew.setSkill('gunnery', gunnerySkill);
                }
                if (pilotingSkill !== undefined) {
                    crew.setSkill('piloting', pilotingSkill);
                }
            }

            newForceUnit.disabledSaving = false;
        }

        this.selectUnit(newForceUnit);
        if (currentForce.units().length === 1) {
            this.layoutService.openMenu();
        }
        const unitGroup = group ?? currentForce.groups().find(group => {
            return group.units().some(u => u.id === newForceUnit.id);
        });
        this.generateForceNameIfNeeded();
        if (unitGroup) {
            this.generateGroupNameIfNeeded(unitGroup);
        }
        return newForceUnit;
    }

    /**
     * Sets the provided unit as the currently selected one.
     * @param unit The unit to select.
     */
    selectUnit(unit: ForceUnit) {
        this.selectedUnit.set(unit);
    }

    getNextUnit(current: ForceUnit | null): ForceUnit | null {
        const currentForce = this.currentForce();
        if (!currentForce) {
            return null;
        }
        const units = currentForce.units();
        if (!current || units.length < 2) return null;

        const idx = units.findIndex(u => u.id === current.id);
        if (idx === -1) return null;

        const nextIndex = (idx + 1) % units.length;
        return units[nextIndex] ?? null;
    }

    getPreviousUnit(current: ForceUnit | null): ForceUnit | null {
        const currentForce = this.currentForce();
        if (!currentForce) {
            return null;
        }
        const units = currentForce.units();
        if (!current || units.length < 2) return null;

        const idx = units.findIndex(u => u.id === current.id);
        if (idx === -1) return null;

        const prevIndex = (idx - 1 + units.length) % units.length;
        return units[prevIndex] ?? null;
    }

    /**
     * Selects the next unit in the force list.
     */
    selectNextUnit() {
        const nextUnit = this.getNextUnit(this.selectedUnit());
        if (nextUnit) {
            this.selectUnit(nextUnit);
        }
    }

    /**
     * Selects the previous unit in the force list.
     */
    selectPreviousUnit() {
        const prevUnit = this.getPreviousUnit(this.selectedUnit());
        if (prevUnit) {
            this.selectUnit(prevUnit);
        }
    }

    /**
     * Removes a unit from the force. If the removed unit was selected,
     * it selects the previous unit in the list.
     * @param unitToRemove The unit to remove.
     */
    async removeUnit(unitToRemove: ForceUnit) {
        const currentForce = this.currentForce();
        if (!currentForce) {
            return;
        }
        if (unitToRemove.modified) {
            const unitName = (unitToRemove.getUnit().chassis + ' ' + unitToRemove.getUnit().model).trim();
            const dialogRef = this.dialogsService.createDialog<string>(ConfirmDialogComponent, {
                panelClass: 'danger',
                data: <ConfirmDialogData<string>>{
                    title: `Delete Unit`,
                    message: `Removing will discard all marks on the sheet and permanently remove the unit "${unitName}" from the force.`,
                    buttons: [
                        { label: 'DELETE', value: 'delete', class: 'danger' },
                        { label: 'NO', value: 'cancel' }
                    ]
                }
            });
            const result = await firstValueFrom(dialogRef.closed);

            if (result !== 'delete') {
                return;
            }
        }

        const currentUnits = currentForce.units();
        const idx = currentUnits.findIndex(u => u.id === unitToRemove.id);
        const unitGroup = currentForce.groups().find(group => {
            return group.units().some(u => u.id === unitToRemove.id);
        });
        currentForce.removeUnit(unitToRemove);
        this.dataService.deleteCanvasDataOfUnit(unitToRemove);

        const updatedUnits = currentForce.units();
        if (this.selectedUnit()?.id === unitToRemove.id) {
            // Select previous unit if possible, otherwise next, otherwise null
            let newSelected: ForceUnit | null = null;
            if (updatedUnits.length > 0) {
                newSelected = updatedUnits[Math.max(0, idx - 1)] ?? updatedUnits[0];
            }
            this.selectedUnit.set(newSelected);
        }

        // If the last unit was removed and the force had an instanceId, remove the current force
        if (updatedUnits.length === 0) {
            const forceInstanceId = currentForce.instanceId();
            if (forceInstanceId) {
                this.dataService.deleteForce(forceInstanceId); // Is the last unit, delete the force
            }
            this.setForce(null);
            this.selectedUnit.set(null);
        } else {
            this.generateForceNameIfNeeded();
            if (unitGroup) {
                this.generateGroupNameIfNeeded(unitGroup);
            }
        }
    }

    public async requestCloneForce() {
        const confirmed = await this.dialogsService.requestConfirmation(
            'Create a separate, editable copy of this force. The original will remain unchanged. Do you want to proceed?',
            'Clone Force',
            'info');
        if (confirmed) {
            this.cloneForce();
        };
    }

    private cloneForce(): Promise<boolean> {
        return new Promise(async (resolve) => {
            // We simply set a new UUID and we save the force as a new instance.
            const currentForce = this.currentForce();
            if (!currentForce) {
                resolve(false);
                return;
            }
            currentForce.loading = true;
            try {
                currentForce.instanceId.set(generateUUID());
                this.dataService.saveForce(currentForce);
            } finally {
                currentForce.loading = false;
            }
            this.toastService.show(`A copy of this force was created and saved. You can now edit the copy without affecting the original.`, 'success');
            resolve(true);
        });
    }

    private generateForceNameIfNeeded() {
        const currentForce = this.currentForce();
        if (!currentForce) {
            return;
        }
        if (!currentForce.nameLock) {
            currentForce.setName(this.generateForceName(), false);
        }
    }

    public generateGroupNameIfNeeded(group: UnitGroup) {
        if (!group.nameLock && group.units().length > 0) {
            group.setName(this.generateGroupName(group), false);
        }
    }
    public generateForceName(): string {
        const currentForce = this.currentForce();
        if (!currentForce) {
            return '';
        }
        return ForceNamerUtil.generateForceName({
            units: currentForce.units(),
            factions: this.dataService.getFactions(),
            eras: this.dataService.getEras()
        });
    }

    public generateGroupName(group: UnitGroup): string {
        const currentForce = this.currentForce();
        if (!currentForce) {
            return '';
        }
        return ForceNamerUtil.generateFormationName({
            units: group.units(),
            allUnits: currentForce.units(),
            forceName: currentForce.name
        });
    }

    public getAllFactionsAvailable(): Map<string, number> | null {
        const currentForce = this.currentForce();
        if (!currentForce) {
            return null;
        }
        return ForceNamerUtil.getAvailableFactions(
            currentForce.units(),
            this.dataService.getFactions(),
            this.dataService.getEras()
        );
    }

    public getAllFormationsAvailable(group: UnitGroup): string[] | null {
        const currentForce = this.currentForce();
        if (!currentForce) {
            return null;
        }
        return ForceNamerUtil.getAvailableFormations(
            group.units(),
            currentForce.units(),
            currentForce.name // Pass force name to help with Faction detection, hopefully...
        );
    }

    public async repairAllUnits() {
        const currentForce = this.currentForce();
        if (!currentForce) {
            return false;
        }
        const confirmed = await this.dialogsService.requestConfirmation(
            'Are you sure you want to repair all units? This will reset all damage and status effects on every unit in the force.',
            'Repair All Units',
            'info');
        if (confirmed) {
            currentForce.units().forEach(fu => {
                fu.repairAll();
            });
            return true;
        };
        return false;
    }

    public addGroup(): UnitGroup {
        const currentForce = this.currentForce();
        if (!currentForce) {
            throw new Error('No current force to add a group to.');
        }
        return currentForce.addGroup();
    }

    public removeGroup(group: UnitGroup) {
        const currentForce = this.currentForce();
        if (!currentForce) {
            return;
        }
        currentForce.removeGroup(group);
    }

    /* ----------------------------------------
     * Remote conflict detection and resolution
     */

    private monitorWebSocketConnection() {
        // Monitor WebSocket connection state changes
        effect(async () => {
            const isConnected = this.wsService.wsConnected();
            if (isConnected) {
                // WebSocket just came online
                untracked(async () => { // Avoid triggering effect re-entrance
                    await this.checkForCloudConflict();
                });
            }
        });
    }

    private async checkForCloudConflict(): Promise<void> {
        const currentForce = this.currentForce();
        if (!currentForce) return;
        const instanceId = currentForce.instanceId();

        // Only check if we have a saved force with an instance ID
        if (!instanceId) return;
        this.logger.info('Checking for cloud conflict for force with instance ID ' + instanceId);

        try {
            // Fetch the cloud version. If the local is owned, we fetch only owned versions too.
            const cloudForce = await this.dataService.getForce(instanceId, currentForce.owned());
            if (!cloudForce) return; // No cloud version exists
            // Compare timestamps
            const localTimestamp = currentForce.timestamp ? new Date(currentForce.timestamp).getTime() : 0;
            const cloudTimestamp = cloudForce.timestamp ? new Date(cloudForce.timestamp).getTime() : 0;

            if (cloudTimestamp > localTimestamp) {
                this.logger.warn('Conflict detected between local and cloud force versions.');
                // If the local force is not owned, automatically load the cloud version
                if (!currentForce.owned()) {
                    this.logger.info(`ForceBuilderService: Force with instance ID ${instanceId} downloading cloud version.`);
                    this.urlStateInitialized = false; // Reset URL state initialization
                    try {
                        this.setForce(cloudForce);
                        this.selectUnit(cloudForce.units()[0] || null);
                    } finally {
                        this.urlStateInitialized = true; // Re-enable URL state initialization
                    }
                    this.toastService.show('Cloud version loaded successfully', 'success');
                    return;
                }
                // Cloud version is newer - show conflict dialog
                await this.handleCloudConflict(cloudForce, localTimestamp, cloudTimestamp);
            }
        } catch (error) {
            this.logger.error(`Error checking for cloud conflict: ${error}`);
        }
    }

    private async handleCloudConflict(cloudForce: Force, localTimestamp: number, cloudTimestamp: number): Promise<void> {
        const formatDate = (timestamp: number) => {
            if (!timestamp) return 'Unknown';
            return new Date(timestamp).toLocaleString();
        };
        if (this.conflictDialogRef) {
            // Conflict dialog is already open, we replace it
            this.conflictDialogRef.close();
            this.conflictDialogRef = undefined;
        }
        this.conflictDialogRef = this.dialogsService.createDialog<string>(ConfirmDialogComponent, {
            panelClass: 'info',
            disableClose: true,
            data: <ConfirmDialogData<string>>{
                title: 'Sync Conflict Detected',
                message: `While you were offline, this force was modified on another device. The cloud version is newer than your current version. (${formatDate(cloudTimestamp)} > ${formatDate(localTimestamp)})`,
                buttons: [
                    { label: 'LOAD CLOUD', value: 'cloud', class: 'primary' },
                    { label: 'KEEP LOCAL', value: 'local' },
                    { label: 'CLONE LOCAL', value: 'cloneLocal' }
                ]
            }
        });

        const result = await firstValueFrom(this.conflictDialogRef.closed);
        const currentForce = this.currentForce();
        if (!currentForce) {
            return;
        }
        if (result === 'cloud') {
            // Load the cloud version
            await this.loadForce(cloudForce);
            await this.dataService.saveForce(currentForce, true);
            this.toastService.show('Cloud version loaded successfully', 'success');
        } else if (result === 'local') {
            // Keep local version and overwrite cloud
            currentForce.timestamp = new Date().toISOString();
            await this.dataService.saveForce(currentForce);
            this.toastService.show('Local version kept and synced to cloud', 'success');
        } else if (result === 'cloneLocal') {
            // clone local version as a new force
            currentForce.instanceId.set(generateUUID());
            currentForce.timestamp = new Date().toISOString();
            currentForce.setName(currentForce.name + ' (Cloned)', false);
            this.toastService.show('Local version has been cloned', 'success');
        }
        // else: dialog was closed without selection, do nothing. If they interact, it will overwrite the cloud.
    }


    /* ----------------------------------------
     * URL State Management
     */

    private updateUrlOnForceChange() {
        effect(() => {
            const queryParameters = this.queryParameters();
            if (!this.urlStateInitialized) {
                return;
            }
            this.router.navigate([], {
                relativeTo: this.route,
                queryParams: {
                    gs: queryParameters.gs,
                    units: queryParameters.units,
                    name: queryParameters.name,
                    instance: queryParameters.instance
                },
                queryParamsHandling: 'merge',
                replaceUrl: true
            });
        });
    }

    queryParameters = computed(() => {
        const currentForce = this.currentForce();
        if (!currentForce) {
            return { units: null, name: null, instance: null };
        }
        const instanceId = currentForce.instanceId();
        const groups = currentForce.groups() || [];
        const units = currentForce.units() || [];
        let forceName: string | undefined = currentForce?.name;
        if (units.length === 0) {
            forceName = undefined;
        }
        const groupParams = this.generateGroupParams(groups);
        const gs = currentForce?.gameSystem;
        return {
            gs: gs,
            units: groupParams.length > 0 ? groupParams.join('|') : null,
            name: forceName || null,
            instance: instanceId || null
        };
    });

    /**
     * Generates URL parameters for all groups in the force.
     * Format: groupName~unit1,unit2|groupName2~unit3,unit4
     * If a group has default name and no nameLock, the name is omitted.
     */
    private generateGroupParams(groups: UnitGroup[]): string[] {
        return groups.filter(g => g.units().length > 0).map(group => {
            const unitParams = this.generateUnitParams(group.units());
            const groupName = group.nameLock ? group.name() : '';
            // Format: groupName~unit1,unit2 (name is optional)
            const prefix = groupName ? `${encodeURIComponent(groupName)}~` : '';
            return prefix + unitParams.join(',');
        });
    }

    /**
     * Generates URL parameters for units within a group.
     * Format: unitName:gunnery:piloting
     */
    private generateUnitParams(units: ForceUnit[]): string[] {
        return units.map(fu => {
            const unit = fu.getUnit();
            const crewMembers = fu.getCrewMembers();

            let unitParam = unit.name;

            // Add crew skills
            if (crewMembers.length > 0) {
                const crewSkills: string[] = [];

                for (const crew of crewMembers) {
                    const gunnery = crew.getSkill('gunnery');
                    const piloting = crew.getSkill('piloting');
                    crewSkills.push(`${gunnery}`, `${piloting}`);
                }

                if (crewSkills.length > 0) {
                    unitParam += ':' + crewSkills.join(':');
                }
            }

            return unitParam;
        });
    }

    private loadUnitsFromUrlOnStartup() {
        effect(async () => {
            const isDataReady = this.dataService.isDataReady();
            // This effect runs when data is ready, but we only execute the logic once.
            if (isDataReady && !this.urlStateInitialized) {
                // Use UrlStateService to get initial URL params (captured before any routing effects)
                const instanceParam = this.urlStateService.getInitialParam('instance');
                let loadedInstance = null;
                if (instanceParam) {
                    // Try to find an existing force with this instance ID in the storage.
                    loadedInstance = await untracked(async () => {
                        const loadedInstance = await this.dataService.getForce(instanceParam);
                        if (loadedInstance) {
                            if (!loadedInstance.owned()) {
                                this.dialogsService.showNotice('Reports indicate another commander owns this force. Clone to adopt it for yourself.', 'Captured Intel');
                            }
                            this.setForce(loadedInstance);
                            this.selectUnit(loadedInstance.units()[0]);
                        }
                        return loadedInstance;
                    });
                }
                if (!loadedInstance) {
                    // If no instance ID or not found, create a new force.
                    if (instanceParam) {
                        //We remove the failed instance ID from the URL
                        this.router.navigate([], {
                            relativeTo: this.route,
                            queryParams: { instance: null },
                            queryParamsHandling: 'merge',
                            replaceUrl: true
                        });
                    }
                    const unitsParam = this.urlStateService.getInitialParam('units');
                    const forceNameParam = this.urlStateService.getInitialParam('name');
                    const gameSystemParam = this.urlStateService.getInitialParam('gs') ?? GameSystem.CLASSIC;
                    let newForce: Force;
                    if (gameSystemParam === GameSystem.ALPHA_STRIKE) {
                        newForce = new ASForce('New Force', this.dataService, this.unitInitializer, this.injector);
                    } else {
                        newForce = new CBTForce('New Force', this.dataService, this.unitInitializer, this.injector);
                    }
                    newForce.loading = true;
                    try {
                        if (forceNameParam) {
                            newForce.setName(forceNameParam);
                        }
                        if (unitsParam) {
                            // parseUnitsFromUrl now handles group creation internally
                            // and adds units directly to the force
                            const forceUnits = this.parseUnitsFromUrl(newForce, unitsParam);

                            if (forceUnits.length > 0) {
                                this.logger.info(`ForceBuilderService: Loaded ${forceUnits.length} units from URL on startup.`);
                                // Remove empty groups that may have been created during parsing
                                newForce.removeEmptyGroups();
                                if (this.layoutService.isMobile()) {
                                    this.layoutService.openMenu();
                                }
                            }
                        }
                    } finally {
                        newForce.loading = false;
                    }
                    if (newForce.units().length > 0) {
                        this.setForce(newForce);
                        this.selectUnit(newForce.units()[0]);
                    }
                }
                // Mark as initialized so the update effect can start running.
                this.urlStateInitialized = true;
                // Signal that we're done reading URL state
                this.urlStateService.markConsumerReady('force-builder');
            }
        });
    }

    /**
     * Parses units from URL parameter with group support.
     * New format: groupName~unit1,unit2|groupName2~unit3,unit4
     * Legacy format (backward compatible): unit1,unit2,unit3
     */
    private parseUnitsFromUrl(force: Force, unitsParam: string): ForceUnit[] {
        const allUnits = this.dataService.getUnits();
        const unitMap = new Map(allUnits.map(u => [u.name, u]));
        const allForceUnits: ForceUnit[] = [];

        // Check if it's the new group format (contains '|' or '~')
        const hasGroups = unitsParam.includes('|') || unitsParam.includes('~');

        if (hasGroups) {
            // New format with groups
            const groupParams = unitsParam.split('|');
            for (const groupParam of groupParams) {
                if (!groupParam.trim()) continue;

                let groupName: string | null = null;
                let unitsStr: string;

                // Check if group has a name (format: groupName~units)
                if (groupParam.includes('~')) {
                    const [namePart, unitsPart] = groupParam.split('~', 2);
                    groupName = decodeURIComponent(namePart);
                    unitsStr = unitsPart || '';
                } else {
                    unitsStr = groupParam;
                }

                // Create or get group
                const group = force.addGroup(groupName || 'Group');
                if (groupName) {
                    group.nameLock = true;
                }

                // Parse units for this group
                const groupUnits = this.parseUnitParams(force, unitsStr, unitMap, group);
                allForceUnits.push(...groupUnits);
            }
        } else {
            // Legacy format without groups - all units in default group
            const groupUnits = this.parseUnitParams(force, unitsParam, unitMap);
            allForceUnits.push(...groupUnits);
        }

        return allForceUnits;
    }

    /**
     * Parses individual unit parameters from a comma-separated string.
     * Format: unitName:gunnery:piloting,unitName2:gunnery:piloting
     */
    private parseUnitParams(force: Force, unitsStr: string, unitMap: Map<string, Unit>, group?: UnitGroup): ForceUnit[] {
        if (!unitsStr.trim()) return [];

        const unitParams = unitsStr.split(',');
        const forceUnits: ForceUnit[] = [];

        for (const unitParam of unitParams) {
            if (!unitParam.trim()) continue;

            const parts = unitParam.split(':');
            const unitName = parts[0];
            const unit = unitMap.get(unitName);

            if (!unit) {
                this.logger.warn(`Unit "${unitName}" not found in dataService`);
                continue;
            }

            const forceUnit = force.addUnit(unit);

            // Move unit to the specified group if provided
            if (group) {
                // Remove from default group and add to specified group
                const defaultGroup = force.groups().find(g => g.units().some(u => u.id === forceUnit.id));
                if (defaultGroup && defaultGroup.id !== group.id) {
                    defaultGroup.units.set(defaultGroup.units().filter(u => u.id !== forceUnit.id));
                    group.units.set([...group.units(), forceUnit]);
                }
            }

            // Parse crew skills if present
            if (parts.length > 1) {
                const crewSkills = parts.slice(1);
                const crewMembers = forceUnit.getCrewMembers();

                // Process crew skills in pairs (gunnery, piloting)
                for (let i = 0; i < crewSkills.length && i < crewMembers.length * 2; i += 2) {
                    const crewIndex = Math.floor(i / 2);
                    const gunnery = parseInt(crewSkills[i]);
                    const piloting = parseInt(crewSkills[i + 1]);

                    if (!isNaN(gunnery) && !isNaN(piloting) && crewMembers[crewIndex]) {
                        // Temporarily disable saving during initialization
                        forceUnit.disabledSaving = true;
                        crewMembers[crewIndex].setSkill('gunnery', gunnery);
                        crewMembers[crewIndex].setSkill('piloting', piloting);
                        forceUnit.disabledSaving = false;
                    }
                }
            }

            forceUnits.push(forceUnit);
        }

        return forceUnits;
    }


    /* ----------------------------------------
     * Force Load and Pack Dialogs
     */

    async showLoadForceDialog(): Promise<void> {
        const ref = this.dialogsService.createDialog(ForceLoadDialogComponent);
        ref.componentInstance?.load.subscribe(async (force) => {
            if (force instanceof LoadForceEntry) {
                const requestedForce = await this.dataService.getForce(force.instanceId, true);
                if (!requestedForce) {
                    this.toastService.show('Failed to load force.', 'error');
                    return;
                }
                this.loadForce(requestedForce);
            } else {
                if (force && force.units && force.units.length > 0) {
                    await this.createNewForce();
                    const group = this.addGroup();
                    for (const unit of force.units) {
                        if (!unit?.unit) continue;
                        this.addUnit(unit.unit, undefined, undefined, group);
                    }
                }
            }
            ref.close();
        });
    }

    showForcePackDialog(): void {
        const ref = this.dialogsService.createDialog(ForcePackDialogComponent);
        ref.componentInstance?.add.subscribe(async (units) => {
            if (units) {
                const group = this.addGroup();
                for (const entry of units) {
                    if (!entry?.unit) continue;
                    this.addUnit(entry.unit, undefined, undefined, group);
                }
            }
            ref.close();
        });
    }

    async promptChangeForceName() {
        const targetForce = this.currentForce();
        if (!targetForce) {
            return;
        }
        const dialogRef = this.dialogsService.createDialog<string | null>(RenameForceDialogComponent, {
            data: {
                force: targetForce
            } as RenameForceDialogData
        });
        const newName = await firstValueFrom(dialogRef.closed);
        if (newName !== null && newName !== undefined) {
            if (newName === '') {
                targetForce.nameLock = false; // Unlock name if empty
                targetForce.setName(this.generateForceName());
            } else {
                targetForce.nameLock = true; // Lock name after manual change
                targetForce.setName(newName.trim());
            }
        }
    }

    async promptChangeGroupName(group: UnitGroup) {
        const dialogRef = this.dialogsService.createDialog<string | null>(RenameGroupDialogComponent, {
            data: {
                group: group
            } as RenameGroupDialogData
        });
        const newName = await firstValueFrom(dialogRef.closed);

        if (newName !== null && newName !== undefined) {
            if (newName === '') {
                group.nameLock = false; // Unlock name if empty
                group.setName(this.generateGroupName(group));
            } else {
                group.nameLock = true; // Lock name after manual change
                group.setName(newName.trim());
            }
        }
    }

    async promptSaveForceIfNeeded() {
        const currentForce = this.currentForce();
        if (!currentForce) {
            return true;
        }
        if (currentForce.instanceId() || currentForce.units().length == 0) {
            return true;
        }
        // We have a force without an instanceId, so we ask the user if they want to save it
        const dialogRef = this.dialogsService.createDialog<string>(ConfirmDialogComponent, {
            data: <ConfirmDialogData<string>>{
                title: 'Unsaved Force',
                message: 'You have an unsaved force. Do you want to save it before proceeding?',
                buttons: [
                    { label: 'YES', value: 'yes' },
                    { label: 'NO', value: 'no', class: 'danger' },
                    { label: 'CANCEL', value: 'cancel' }
                ]
            }
        });
        const result = await firstValueFrom(dialogRef.closed);

        if (result === 'yes') {
            this.dataService.saveForce(currentForce).catch(err => {
                this.logger.error('Error saving force: ' + err);
            });
        } else if (result === 'no') {
        } else {
            return false; // Exit if user cancels
        }
        return true;
    }


    public async editPilotOfUnit(unit: ForceUnit, pilot?: CrewMember): Promise<void> {
        if (unit.readOnly()) return;
        const baseUnit = unit.getUnit();
        if (!baseUnit) return;

        // Handle Alpha Strike units
        if (unit instanceof ASForceUnit) {
            await this.editASPilot(unit);
            return;
        }

        // Handle Classic BattleTech units
        if (!pilot) {
            const crewMembers = unit.getCrewMembers();
            if (crewMembers.length === 0) {
                this.toastService.show('This unit has no crew to edit.', 'error');
                return;
            }
            pilot = crewMembers[0];
        }
        const disablePiloting = baseUnit.type === 'ProtoMek';
        let labelPiloting;
        if (baseUnit.type === 'Infantry') {
            labelPiloting = 'Anti-Mech';
        } else if (baseUnit.type === 'Naval' || baseUnit.type === 'Tank' || baseUnit.type === 'VTOL') {
            labelPiloting = 'Driving';
        } else {
            labelPiloting = 'Piloting';
        }
        const ref = this.dialogsService.createDialog<EditPilotResult | null, EditPilotDialogComponent, EditPilotDialogData>(
            EditPilotDialogComponent,
            {
                data: {
                    name: pilot.getName(),
                    gunnery: pilot.getSkill('gunnery'),
                    piloting: pilot.getSkill('piloting'),
                    labelGunnery: `Gunnery Skill`,
                    labelPiloting: `${labelPiloting} Skill`,
                    disablePiloting: disablePiloting,
                }
            }
        );

        const result = await firstValueFrom(ref.closed);
        if (!result) return;

        if (result.name !== undefined && result.name !== pilot.getName()) {
            pilot.setName(result.name);
        }
        if (result.gunnery !== undefined) {
            pilot.setSkill('gunnery', result.gunnery);
        }
        if (result.piloting !== undefined) {
            pilot.setSkill('piloting', result.piloting);
        }
    };

    /**
     * Opens the edit dialog for an Alpha Strike unit's pilot.
     */
    private async editASPilot(unit: ASForceUnit): Promise<void> {
        const ref = this.dialogsService.createDialog<EditASPilotResult | null, EditASPilotDialogComponent, EditASPilotDialogData>(
            EditASPilotDialogComponent,
            {
                data: {
                    name: unit.alias() || '',
                    skill: unit.pilotSkill(),
                    abilities: unit.pilotAbilities(),
                }
            }
        );

        const result = await firstValueFrom(ref.closed);
        if (!result) return;

        if (result.name !== undefined) {
            const newName = result.name.trim() || undefined;
            if (newName !== unit.alias()) {
                unit.setPilotName(newName);
            }
        }
        if (result.skill !== undefined && result.skill !== unit.pilotSkill()) {
            unit.setPilotSkill(result.skill);
        }
        if (result.abilities !== undefined) {
            const currentAbilities = unit.pilotAbilities();
            const abilitiesChanged = result.abilities.length !== currentAbilities.length ||
                result.abilities.some((a, i) => {
                    const current = currentAbilities[i];
                    // Both are strings (standard abilities)
                    if (typeof a === 'string' && typeof current === 'string') {
                        return a !== current;
                    }
                    // Both are objects (custom abilities)
                    if (typeof a === 'object' && typeof current === 'object') {
                        return a.name !== current.name || a.cost !== current.cost || a.summary !== current.summary;
                    }
                    // Different types
                    return true;
                });
            if (abilitiesChanged) {
                unit.setPilotAbilities(result.abilities);
            }
        }
    }

}