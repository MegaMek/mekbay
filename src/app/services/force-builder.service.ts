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

import { Injectable, signal, effect, computed, OnDestroy, Injector, inject, untracked } from '@angular/core';
import { Router, ActivatedRoute } from '@angular/router';
import { Unit } from '../models/units.model';
import { Force, ForceUnit, UnitGroup } from '../models/force-unit.model';
import { DataService } from './data.service';
import { LayoutService } from './layout.service';
import { ForceNamerUtil } from '../utils/force-namer.util';
import { Dialog } from '@angular/cdk/dialog';
import { ConfirmDialogComponent, ConfirmDialogData } from '../components/confirm-dialog/confirm-dialog.component';
import { firstValueFrom } from 'rxjs';
import { RenameForceDialogComponent, RenameForceDialogData } from '../components/rename-force-dialog/rename-force-dialog.component';
import { RenameGroupDialogComponent, RenameGroupDialogData } from '../components/rename-group-dialog/rename-group-dialog.component';
import { UnitInitializerService } from '../components/svg-viewer/unit-initializer.service';
import { DialogsService } from './dialogs.service';
import { generateUUID } from './ws.service';
import { ToastService } from './toast.service';
import { LoggerService } from './logger.service';

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
    private router = inject(Router);
    private route = inject(ActivatedRoute);
    private dialog = inject(Dialog);
    private dialogsService = inject(DialogsService);
    private unitInitializer = inject(UnitInitializerService);
    private injector = inject(Injector);

    private currentForce = signal<Force>(new Force('My Force', this.dataService, this.unitInitializer, this.injector));
    public selectedUnit = signal<ForceUnit | null>(null);
    private urlStateInitialized = false;
    private forceChangedSubscription: any;

    constructor() {
        this.loadUnitsFromUrlOnStartup();
        this.updateUrlOnForceChange();
        this.setForce(this.currentForce());
    }

    get force(): Force {
        return this.currentForce();
    }

    forceUnits = computed(() => this.currentForce().units());
    hasUnits = computed(() => this.currentForce().units().length > 0);

    readOnlyForce = computed<boolean>(() => {
        return this.force.owned() === false;
    });

    setForce(newForce: Force) {
        // Unsubscribe from previous force
        if (this.forceChangedSubscription) {
            this.forceChangedSubscription.unsubscribe();
        }
        // Clean up old units before setting the new force
        this.currentForce().units().forEach(unit => unit.destroy());

        this.currentForce.set(newForce);

        this.logger.info(`ForceBuilderService: Setting new force with name "${this.force.name}" and instance ID "${this.force.instanceId()}"`);

        // Subscribe to new force's changed event
        this.forceChangedSubscription = this.currentForce().changed.subscribe(() => {
            this.dataService.saveForce(this.force);
            const forceInstanceId = this.force.instanceId();
            this.logger.info(`ForceBuilderService: Auto-saved force with instance ID ${forceInstanceId}`);
        });
    }

    ngOnDestroy() {
        // Clean up subscription to prevent memory leaks
        if (this.forceChangedSubscription) {
            this.forceChangedSubscription.unsubscribe();
        }
        // Clean up units in the current force
        this.currentForce().units().forEach(unit => unit.destroy());
    }

    async promptChangeForceName() {
            const targetForce = this.force;
        const ref = this.dialog.open<string | null>(RenameForceDialogComponent, {
            data: {
                force: targetForce
            } as RenameForceDialogData
        });
        const newName = await firstValueFrom(ref.closed);
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
        const ref = this.dialog.open<string | null>(RenameGroupDialogComponent, {
            data: {
                group: group
            } as RenameGroupDialogData
        });
        const newName = await firstValueFrom(ref.closed);
        
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
        if (this.force.instanceId() || this.force.units().length == 0) {
            return true;
        }
        // We have a force without an instanceId, so we ask the user if they want to save it
        const dialogRef = this.dialog.open<string>(ConfirmDialogComponent, {
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
            this.dataService.saveForce(this.force).catch(err => {
                this.logger.error('Error saving force: ' + err);
            });
        } else if (result === 'no') {
        } else {
            return false; // Exit if user cancels
        }
        return true;
    }

    async loadForce(force: Force) {
        // Prompt to save current force if needed
        const shouldContinue = await this.promptSaveForceIfNeeded();
        if (!shouldContinue) {
            return; // User cancelled, do not load new force
        }
        
        this.urlStateInitialized = false; // Reset URL state initialization
        this.setForce(force);
        this.selectUnit(force.units()[0] || null);
        this.urlStateInitialized = true; // Re-enable URL state initialization

        this.logger.info(`ForceBuilderService: Loaded force with name "${force.name}" and instance ID "${force.instanceId()}"`);
    }

    async createNewForce(name: string = 'New Force'): Promise<boolean> {
        // Prompt to save current force if needed
        const shouldContinue = await this.promptSaveForceIfNeeded();
        if (!shouldContinue) {
            return false; // User cancelled, do not create a new force
        }
        
        this.selectedUnit.set(null);
        const newForce = new Force(name, this.dataService, this.unitInitializer, this.injector);
        
        this.urlStateInitialized = false; // Reset URL state initialization
        this.setForce(newForce);
        this.urlStateInitialized = true; // Re-enable URL state initialization
        
        this.logger.info(`ForceBuilderService: Created new force with name "${name}"`);
        return true;
    }
    
    private updateUrlOnForceChange() {
        effect(() => {
            const queryParameters = this.queryParameters();
            if (!this.urlStateInitialized) {
                return;
            }
            this.router.navigate([], {
                relativeTo: this.route,
                queryParams: {
                    units: queryParameters.units,
                    name: queryParameters.name,
                    instance: this.force.instanceId() || null
                },
                queryParamsHandling: 'merge',
                replaceUrl: true
            });
        });
    }
    
    queryParameters = computed(() => {
        const instanceId = this.force.instanceId();
        const units = this.forceUnits();
        let forceName: string | null = this.force.name;
        if (units.length === 0) {
            forceName = null;
        }
        const unitParams = this.generateUnitParams(units);
        return {
            units: unitParams.length > 0 ? unitParams.join(',') : null,
            name: forceName || null,
            instance: instanceId || null
        };
    });

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
                const params = this.route.snapshot.queryParamMap;
                const instanceParam = params.get('instance');
                const unitsParam = params.get('units');
                const forceNameParam = params.get('name');
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
                            this.selectUnit(loadedInstance.units()[0] || null);
                        }
                        return loadedInstance;
                    });
                }
                if (!loadedInstance) {
                    // If no instance ID or not found, create a new force.
                    if (instanceParam) {

                        //We remove the fail instance ID from the URL
                        this.router.navigate([], {
                            relativeTo: this.route,
                            queryParams: { instance: null },
                            queryParamsHandling: 'merge',
                            replaceUrl: true
                        });
                    }
                    this.force.loading = true;
                    try {
                        if (forceNameParam) {
                            this.force.setName(forceNameParam);
                        }
                        if (unitsParam) {
                            const forceUnits = this.parseUnitsFromUrl(unitsParam);
                            
                            if (forceUnits.length > 0) {
                                this.logger.info(`ForceBuilderService: Loaded ${forceUnits.length} units from URL on startup.`);
                                this.force.setUnits(forceUnits);
                                this.selectUnit(forceUnits[0]);
                                if (this.layoutService.isMobile()) {
                                    this.layoutService.openMenu();
                                }
                            }
                        }
                    } finally {
                        this.force.loading = false;
                    }
                }
                // Mark as initialized so the update effect can start running.
                this.urlStateInitialized = true;
            }
        });
    }

    private parseUnitsFromUrl(unitsParam: string): ForceUnit[] {
        const unitParams = unitsParam.split(',');
        const allUnits = this.dataService.getUnits();
        const unitMap = new Map(allUnits.map(u => [u.name, u]));
        const forceUnits: ForceUnit[] = [];

        for (const unitParam of unitParams) {
            const parts = unitParam.split(':');
            const unitName = parts[0];
            const unit = unitMap.get(unitName);
            
            if (!unit) {
                this.logger.warn(`Unit "${unitName}" not found in dataService`);
                continue;
            }

            const forceUnit = this.force.addUnit(unit);
            
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
                
                // Recalculate BV after setting crew skills
                forceUnit.recalculateBv();
            }
            
            forceUnits.push(forceUnit);
        }

        return forceUnits;
    }

    /**
     * Adds a new unit to the force. The unit is cloned to prevent
     * modifications to the original object, and it's set as the
     * currently selected unit.
     * @param unit The unit to add.
     * @param gunnerySkill Optional gunnery skill to set for the crew
     * @param pilotingSkill Optional piloting skill to set for the crew
     */
    addUnit(unit: Unit, gunnerySkill?: number, pilotingSkill?: number, group?: UnitGroup): ForceUnit | null {
        let newForceUnit;
        try {
            newForceUnit = this.force.addUnit(unit);
        } catch (error) {
            this.toastService.show(error instanceof Error ? error.message : (error as string), 'error');
            return null;
        }
        
        // Set crew skills if provided
        if (gunnerySkill !== undefined || pilotingSkill !== undefined) {
            const crewMembers = newForceUnit.getCrewMembers();
            newForceUnit.disabledSaving = true;
            
            for (const crew of crewMembers) {
                if (gunnerySkill !== undefined) {
                    crew.setSkill('gunnery', gunnerySkill);
                }
                if (pilotingSkill !== undefined) {
                    crew.setSkill('piloting', pilotingSkill);
                }
            }
            
            newForceUnit.disabledSaving = false;
            newForceUnit.recalculateBv();
        }
        
        this.selectUnit(newForceUnit);
        if (this.force.units().length === 1) {
            this.layoutService.openMenu();
        }
        const unitGroup = group ?? this.force.groups().find(group => {
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
        const units = this.forceUnits();
        if (!current || units.length < 2) return null;

        const idx = units.findIndex(u => u.id === current.id);
        if (idx === -1) return null;

        const nextIndex = (idx + 1) % units.length;
        return units[nextIndex] ?? null;
    }

    getPreviousUnit(current: ForceUnit | null): ForceUnit | null {
        const units = this.forceUnits();
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
        if (unitToRemove.modified) {
            const unitName = (unitToRemove.getUnit().chassis + ' ' + unitToRemove.getUnit().model).trim();
            const dialogRef = this.dialog.open<string>(ConfirmDialogComponent, {
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

        const currentUnits = this.forceUnits();
        const idx = currentUnits.findIndex(u => u.id === unitToRemove.id);
        const unitGroup = this.force.groups().find(group => {
            return group.units().some(u => u.id === unitToRemove.id);
        });
        this.force.removeUnit(unitToRemove);
        this.dataService.deleteCanvasDataOfUnit(unitToRemove);

        const updatedUnits = this.forceUnits();
        if (this.selectedUnit()?.id === unitToRemove.id) {
            // Select previous unit if possible, otherwise next, otherwise null
            let newSelected: ForceUnit | null = null;
            if (updatedUnits.length > 0) {
                newSelected = updatedUnits[Math.max(0, idx - 1)] ?? updatedUnits[0];
            }
            this.selectedUnit.set(newSelected);
        }

        // If the last unit was removed and the force had an instanceId, create a new force
        if (updatedUnits.length === 0) {
            const forceInstanceId = this.force.instanceId();
            if (forceInstanceId) {
                this.dataService.deleteForce(forceInstanceId); // Is the last unit, delete the force
            }
            this.createNewForce();
        } else {        
            this.generateForceNameIfNeeded();
            if (unitGroup) {
                this.generateGroupNameIfNeeded(unitGroup);
            }
        }
    }

    public async requestCloneForce() {
        const confirmed = await this.dialogsService.showQuestion(
            'Create a separate, editable copy of this force. The original will remain unchanged. Do you want to proceed?',
            'Clone Force',
            'info');
        if (confirmed === 'yes') {
            this.cloneForce();
        };
    }

    private cloneForce(): Promise<boolean> {
        return new Promise(async (resolve) => {
            // We simply set a new UUID and we save the force as a new instance.
            this.force.loading = true;
            try {
                this.force.instanceId.set(generateUUID());
                this.dataService.saveForce(this.force);
            } finally {
                this.force.loading = false;
            }
            this.toastService.show(`A copy of this force was created and saved. You can now edit the copy without affecting the original.`, 'success');
            resolve(true);
        });
    }

    private generateForceNameIfNeeded() {
        if (!this.force.nameLock) {
            this.force.setName(this.generateForceName(), false);
        }
    }

    public generateGroupNameIfNeeded(group: UnitGroup) {
        if (!group.nameLock && group.units().length > 0) {
            group.setName(this.generateGroupName(group), false);
        }
    }
    public generateForceName(): string {
        return ForceNamerUtil.generateForceName({
            units: this.forceUnits(),
            factions: this.dataService.getFactions(),
            eras: this.dataService.getEras()
        });
    }

    public generateGroupName(group: UnitGroup): string {
        return ForceNamerUtil.generateFormationName({
            units: group.units(),
            allUnits: this.forceUnits(),
            forceName: this.force.name
        });
    }

    public getAllFactionsAvailable(): Map<string, number> | null {
        return ForceNamerUtil.getAvailableFactions(
            this.forceUnits(),
            this.dataService.getFactions(),
            this.dataService.getEras()
        );
    }

    public getAllFormationsAvailable(group: UnitGroup): string[] | null {
        return ForceNamerUtil.getAvailableFormations(
            group.units(),
            this.forceUnits(),
            this.force.name // Pass force name to help with Faction detection, hopefully...
        );
    }

    public async repairAllUnits() {
        const confirmed = await this.dialogsService.showQuestion(
            'Are you sure you want to repair all units? This will reset all damage and status effects on every unit in the force.',
            'Repair All Units',
            'info');
        if (confirmed === 'yes') {
            this.forceUnits().forEach(fu => {
                fu.repairAll();
            });
            return true;
        };
        return false;
    }

    public addGroup(): UnitGroup {
        return this.force.addGroup();
    }

    public removeGroup(group: UnitGroup) {
        this.force.removeGroup(group);
    }

    /**
     * Handles remote updates to the force from the database.
     * This method is called when the WebSocket receives a message
     * indicating that the force has been updated by another client.
     * @param force The updated force instance.
     */
    remoteForceUpdate(force: Force) {
        this.logger.info(`ForceBuilderService: Remote force update received for instance ID ${force.instanceId()}`);
        // this.setForce(force);
        // this.selectUnit(force.units()[0] || null);
        // this.force.emitChanged();
    }
}