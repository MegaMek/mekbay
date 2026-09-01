// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import { inject, Injectable } from '@angular/core';
import {
    type LoadedOrganization,
    LoadOrganizationEntry,
    type SerializedOrganization,
} from '../models/organization.model';
import { DbService } from './db.service';
import { FORCE_PERSISTENCE_REVISION, WsService, type WsMessage } from './ws.service';

type WsDataResponse<T> = WsMessage & { readonly data?: T };
type RemoteOrganizationEntry = Readonly<Pick<
    LoadOrganizationEntry,
    'organizationId' | 'name' | 'timestamp' | 'factionId' | 'forceCount' | 'groupCount' | 'owned'
>>;

@Injectable({ providedIn: 'root' })
export class OrganizationStorageService {
    private readonly dbService = inject(DbService);
    private readonly wsService = inject(WsService);

    private async canUseCloud(): Promise<boolean> {
        if (!navigator.onLine) return false;
        try {
            await this.wsService.waitForWebSocket();
        } catch {
            return false;
        }
        return this.wsService.getWebSocket()?.readyState === WebSocket.OPEN;
    }

    public async saveOrganization(org: SerializedOrganization): Promise<void> {
        await this.dbService.saveOrganization(org);
        this.saveOrganizationCloud(org);
    }

    public async deleteOrganization(organizationId: string): Promise<void> {
        await this.dbService.deleteOrganization(organizationId);
        const ws = await this.canUseCloud();
        if (ws) {
            this.wsService.send({
                action: 'delOrganization',
                organizationId,
            });
        }
    }

    public async listOrganizations(): Promise<LoadOrganizationEntry[]> {
        const [localOrgs, cloudOrgs] = await Promise.all([
            this.listOrganizationsLocal(),
            this.listOrganizationsCloud(),
        ]);

        const orgMap = new Map<string, LoadOrganizationEntry>();

        for (const org of localOrgs) {
            org.local = true;
            orgMap.set(org.organizationId, org);
        }

        for (const cloudOrg of cloudOrgs) {
            const existing = orgMap.get(cloudOrg.organizationId);
            cloudOrg.cloud = true;
            if (existing) {
                cloudOrg.local = true;
            }
            orgMap.set(cloudOrg.organizationId, cloudOrg);
        }

        // Push local-only orgs to cloud
        const localOnly = Array.from(orgMap.values()).filter(o => o.local && !o.cloud);
        if (localOnly.length > 0) {
            for (const entry of localOnly) {
                const serialized = await this.dbService.getOrganization(entry.organizationId);
                if (serialized) this.saveOrganizationCloud(serialized);
            }
        }

        // Save cloud orgs locally for offline access
        for (const cloudOrg of cloudOrgs) {
            const localEntry = localOrgs.find(l => l.organizationId === cloudOrg.organizationId);
            if (!localEntry || cloudOrg.timestamp > localEntry.timestamp) {
                // Fetch full org from cloud and save locally
                this.syncOrganizationFromCloud(cloudOrg.organizationId);
            }
        }

        return Array.from(orgMap.values()).sort((a, b) => b.timestamp - a.timestamp);
    }

    public async getOrganization(organizationId: string): Promise<LoadedOrganization | null> {
        const localPromise = this.dbService.getOrganization(organizationId);
        let cloudOrg: LoadedOrganization | null = null;

        try {
            const ws = await this.canUseCloud();
            if (ws) {
                const response = await this.wsService.sendAndWaitForResponse<WsDataResponse<LoadedOrganization | null>>({
                    action: 'getOrganization',
                    forcePersistenceRevision: FORCE_PERSISTENCE_REVISION,
                    organizationId,
                });
                cloudOrg = response?.data ?? null;
            }
        } catch {
            // cloud unavailable
        }

        const localOrg = await localPromise;

        if (localOrg && cloudOrg) {
            return cloudOrg.timestamp > localOrg.timestamp ? cloudOrg : localOrg;
        }
        return cloudOrg || localOrg || null;
    }

    /**
     * Find all locally-stored organizations that contain a specific force instanceId.
     */
    public async findOrganizationsForForce(instanceId: string): Promise<LoadOrganizationEntry[]> {
        const serialized = await this.dbService.listOrganizations();
        return serialized
            .filter(org => org.forces.some(f => f.instanceId === instanceId))
            .map(org => new LoadOrganizationEntry({
                organizationId: org.organizationId,
                name: org.name,
                timestamp: org.timestamp,
                factionId: org.factionId,
                forceCount: org.forces.length,
                groupCount: org.groups.length,
                local: true,
            }));
    }

    private async listOrganizationsLocal(): Promise<LoadOrganizationEntry[]> {
        const serialized = await this.dbService.listOrganizations();
        return serialized.map(org => new LoadOrganizationEntry({
            organizationId: org.organizationId,
            name: org.name,
            timestamp: org.timestamp,
            factionId: org.factionId,
            forceCount: org.forces.length,
            groupCount: org.groups.length,
            local: true,
        }));
    }

    private async listOrganizationsCloud(): Promise<LoadOrganizationEntry[]> {
        const ws = await this.canUseCloud();
        if (!ws) return [];

        const response = await this.wsService.sendAndWaitForResponse<WsDataResponse<RemoteOrganizationEntry[]>>({
            action: 'listOrganizations',
            forcePersistenceRevision: FORCE_PERSISTENCE_REVISION,
        });
        return (response?.data ?? []).map(raw => new LoadOrganizationEntry({
            organizationId: raw.organizationId,
            name: raw.name,
            timestamp: raw.timestamp,
            factionId: raw.factionId,
            forceCount: raw.forceCount,
            groupCount: raw.groupCount,
            cloud: true,
            owned: raw.owned ?? true,
        }));
    }

    private async saveOrganizationCloud(org: SerializedOrganization): Promise<void> {
        const ws = await this.canUseCloud();
        if (!ws) return;
        this.wsService.send({
            action: 'saveOrganization',
            forcePersistenceRevision: FORCE_PERSISTENCE_REVISION,
            data: org,
        });
    }

    private async syncOrganizationFromCloud(organizationId: string): Promise<void> {
        try {
            const ws = await this.canUseCloud();
            if (!ws) return;
            const response = await this.wsService.sendAndWaitForResponse<WsDataResponse<LoadedOrganization | null>>({
                action: 'getOrganization',
                forcePersistenceRevision: FORCE_PERSISTENCE_REVISION,
                organizationId,
            });
            if (response?.data) {
                const { owned: _owned, ...serialized } = response.data;
                await this.dbService.saveOrganization(serialized);
            }
        } catch {
            // Silently fail — will retry on next list
        }
    }}
