// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import { inject, Injectable } from '@angular/core';
import { LoadOperationEntry, type OperationForceInfo, type SerializedOperation } from '../models/operation.model';
import { uuidv7 } from '../utils/uuid.util';
import { DbService } from './db.service';
import { LoggerService } from './logger.service';
import { FORCE_PERSISTENCE_REVISION, WsService, type WsMessage } from './ws.service';

type WsDataResponse<T> = WsMessage & { readonly data?: T };
type RemoteOperationEntry = Readonly<Pick<
    LoadOperationEntry,
    'operationId' | 'name' | 'note' | 'timestamp' | 'owned' | 'forces'
>>;
type RemoteOperationVerification = Readonly<{
    operationId: string;
    exists: boolean;
    owned: boolean;
}>;
type RemoteForceInfo = Readonly<
    Omit<OperationForceInfo, 'alignment' | 'timestamp' | 'forceTimestamp'>
    & { timestamp?: string | number }
>;

@Injectable({ providedIn: 'root' })
export class OperationStorageService {
    private readonly dbService = inject(DbService);
    private readonly wsService = inject(WsService);
    private readonly logger = inject(LoggerService);

    private async canUseCloud(): Promise<boolean> {
        if (!navigator.onLine) return false;
        try {
            await this.wsService.waitForWebSocket();
        } catch {
            return false;
        }
        return this.wsService.getWebSocket()?.readyState === WebSocket.OPEN;
    }

    /**
     * Save an operation locally and to the cloud.
     */
    public async saveOperation(op: SerializedOperation): Promise<void> {
        await this.dbService.saveOperation(op);
        this.saveOperationCloud(op);
    }

    /**
     * Retrieve a single operation by ID.
     * Fetches from both local storage and cloud in parallel, then keeps
     * whichever is newer (mirroring `getForce()` behaviour).
     * Returns a LoadOperationEntry enriched with force metadata, or null if not found.
     */
    public async getOperation(operationId: string): Promise<LoadOperationEntry | null> {
        const localPromise = this.getOperationLocal(operationId);
        let cloudEntry: LoadOperationEntry | null = null;
        let triedCloud = false;

        try {
            const ws = await this.canUseCloud();
            if (ws) {
                try {
                    cloudEntry = await this.getOperationCloud(operationId);
                    triedCloud = true;
                } catch {
                    cloudEntry = null;
                }
            }
        } catch {
            // cloud unavailable
        }

        const localEntry = await localPromise;

        // Pick the best result
        let result: LoadOperationEntry | null;
        if (localEntry && cloudEntry) {
            result = cloudEntry.timestamp > localEntry.timestamp ? cloudEntry : localEntry;
            result.owned = cloudEntry.owned;
        } else if (!triedCloud && localEntry) {
            result = localEntry;
        } else {
            result = cloudEntry || localEntry || null;
        }

        if (result) {
            result.localTimestamp = localEntry?.timestamp ?? 0;
            result.cloudTimestamp = triedCloud ? (cloudEntry?.timestamp ?? 0) : 0;

            // Push to cloud when we reached it and local is newer (or cloud is missing)
            if (triedCloud && result.localTimestamp > result.cloudTimestamp) {
                const serialized = await this.dbService.getOperation(operationId);
                if (serialized) {
                    this.saveOperationCloud(serialized);
                }
            }
        }

        return result;
    }

    /**
     * Retrieve a single operation from local IndexedDB.
     * No force enrichment — callers that load the operation will fetch
     * the actual forces via `getForce()` immediately after.
     */
    private async getOperationLocal(operationId: string): Promise<LoadOperationEntry | null> {
        const serialized = await this.dbService.getOperation(operationId);
        if (!serialized) return null;

        return new LoadOperationEntry({
            operationId: serialized.operationId,
            name: serialized.name || '',
            note: serialized.note || '',
            timestamp: serialized.timestamp,
            forces: serialized.forces.map(ref => ({
                instanceId: ref.instanceId,
                alignment: ref.alignment,
                timestamp: ref.timestamp,
                exists: false,
            })),
            local: true,
        });
    }

    /**
     * Delete an operation locally and from the cloud.
     */
    public async deleteOperation(operationId: string): Promise<void> {
        await this.dbService.deleteOperation(operationId);
        const ws = await this.canUseCloud();
        if (ws) {
            this.wsService.send({
                action: 'delOperation',
                operationId,
            });
        }
    }

    /**
     * List operations, merging local and cloud.
     * Cloud entries include joined force metadata; local entries are enriched
     * with locally available force data.
     *
     * After merging:
     * - Cloud operations are saved locally for offline access.
     * - Local-only operations are verified against the cloud to detect
     *   ownership conflicts (e.g. user changed accounts). If a conflict is
     *   found, the local operation gets a new operationId and is saved to cloud.
     */
    public async listOperations(): Promise<LoadOperationEntry[]> {
        const [localOps, cloudOps] = await Promise.all([
            this.listOperationsLocal(),
            this.listOperationsCloud(),
        ]);

        // Merge: cloud wins for same operationId, but keep local-only entries
        const opMap = new Map<string, LoadOperationEntry>();

        for (const op of localOps) {
            op.local = true;
            opMap.set(op.operationId, op);
        }

        const cloudOnlyOps: LoadOperationEntry[] = [];
        for (const cloudOp of cloudOps) {
            const existing = opMap.get(cloudOp.operationId);
            cloudOp.cloud = true;
            if (existing) {
                cloudOp.local = true;
                // Merge: use cloud's enriched force data but update with any
                // locally-fresher force info
                this.mergeOperationForceInfo(cloudOp, existing);
            } else {
                cloudOnlyOps.push(cloudOp);
            }
            opMap.set(cloudOp.operationId, cloudOp);
        }

        // Save cloud operations locally for offline access and to sync name/note changes.
        // Fire-and-forget to avoid blocking the UI.
        this.saveCloudOperationsLocally(cloudOps);

        // Identify local-only operations (not found on cloud) and verify them
        const localOnlyOps = Array.from(opMap.values()).filter(op => op.local && !op.cloud);
        if (localOnlyOps.length > 0) {
            // Fire-and-forget: verify ownership in the background
            this.verifyLocalOnlyOperations(localOnlyOps, opMap);
        }

        return Array.from(opMap.values()).sort((a, b) => b.timestamp - a.timestamp);
    }

    /**
     * Save cloud operations to local IndexedDB for offline access.
     * Uses the cloud data (which may have updated name/note) and writes them locally.
     */
    private async saveCloudOperationsLocally(cloudOps: LoadOperationEntry[]): Promise<void> {
        for (const op of cloudOps) {
            try {
                const serialized: SerializedOperation = {
                    operationId: op.operationId,
                    name: op.name,
                    note: op.note,
                    timestamp: op.timestamp,
                    forces: op.forces.map(f => ({
                        instanceId: f.instanceId,
                        alignment: f.alignment,
                        timestamp: f.timestamp,
                    })),
                };
                await this.dbService.saveOperation(serialized);
            } catch (err) {
                this.logger.error(`Failed to save cloud operation locally: ${err}`);
            }
        }
    }

    /**
     * Verify local-only operations against the cloud to detect ownership conflicts.
     * If a local operation exists on the cloud but isn't owned by us, we re-ID it
     * locally and save the new copy to the cloud immediately.
     * If it doesn't exist on the cloud, we leave it alone (user may have deleted it
     * from another device).
     *
     * Sends requests in chunks of VERIFY_OPS_CHUNK_SIZE to stay within the server limit.
     */
    private static readonly VERIFY_OPS_CHUNK_SIZE = 100;

    private async verifyLocalOnlyOperations(
        localOnlyOps: LoadOperationEntry[],
        opMap: Map<string, LoadOperationEntry>,
    ): Promise<void> {
        const ws = await this.canUseCloud();
        if (!ws) return;

        const allIds = localOnlyOps.map(op => op.operationId);

        try {
            // Process in chunks to respect server-side cap
            for (let i = 0; i < allIds.length; i += OperationStorageService.VERIFY_OPS_CHUNK_SIZE) {
                const chunk = allIds.slice(i, i + OperationStorageService.VERIFY_OPS_CHUNK_SIZE);
                const response = await this.wsService.sendAndWaitForResponse<WsDataResponse<RemoteOperationVerification[]>>({
                    action: 'verifyOperations',
                    operationIds: chunk,
                });
                await this.processVerifyResults(response?.data ?? [], localOnlyOps, opMap);
            }
        } catch (err) {
            this.logger.error(`Failed to verify local-only operations: ${err}`);
        }
    }

    /**
     * Process verify results for a single chunk and handle conflicts.
     */
    private async processVerifyResults(
        results: Array<{ operationId: string; exists: boolean; owned: boolean }>,
        localOnlyOps: LoadOperationEntry[],
        opMap: Map<string, LoadOperationEntry>,
    ): Promise<void> {
        for (const result of results) {
            const { operationId, exists, owned } = result;

            if (exists && !owned) {
                // Conflict: the operationId is owned by another user.
                // Generate a new operationId, update local, and save to cloud.
                const conflictOp = localOnlyOps.find(op => op.operationId === operationId);
                if (!conflictOp) continue;

                const newOperationId = uuidv7();
                this.logger.warn(
                    `Operation "${conflictOp.name}" (${operationId}) is owned by another account. ` +
                    `Re-assigning to new ID: ${newOperationId}`
                );

                // Delete old local entry
                await this.dbService.deleteOperation(operationId);

                // Build the serialized operation with the new ID
                const serialized: SerializedOperation = {
                    operationId: newOperationId,
                    name: conflictOp.name,
                    note: conflictOp.note,
                    timestamp: conflictOp.timestamp,
                    forces: conflictOp.forces.map(f => ({
                        instanceId: f.instanceId,
                        alignment: f.alignment,
                        timestamp: f.timestamp,
                    })),
                };

                // Save locally with new ID
                await this.dbService.saveOperation(serialized);
                // Save to cloud with new ID
                await this.saveOperationCloud(serialized);

                // Update the opMap entry so callers see the new ID
                opMap.delete(operationId);
                conflictOp.operationId = newOperationId;
                conflictOp.cloud = true;
                opMap.set(newOperationId, conflictOp);
            }
            // If !exists: the operation was deleted elsewhere, leave it local-only.
            // It will be pushed to cloud if the user explicitly loads it.
        }
    }

    /**
     * Merge local force metadata into a cloud-enriched operation entry.
     * If local has newer timestamps for any force, update the entry.
     */
    private mergeOperationForceInfo(target: LoadOperationEntry, localEntry: LoadOperationEntry): void {
        for (const localForce of localEntry.forces) {
            const cloudForce = target.forces.find(f => f.instanceId === localForce.instanceId);
            if (!cloudForce) {
                // Force exists locally but not in cloud response — add it
                target.forces.push(localForce);
            } else {
                // If local force info is more recent, prefer it
                const localTs = localForce.forceTimestamp ? new Date(localForce.forceTimestamp).getTime() : 0;
                const cloudTs = cloudForce.forceTimestamp ? new Date(cloudForce.forceTimestamp).getTime() : 0;
                if (localTs > cloudTs) {
                    cloudForce.name = localForce.name ?? cloudForce.name;
                    cloudForce.type = localForce.type ?? cloudForce.type;
                    cloudForce.factionId = localForce.factionId ?? cloudForce.factionId;
                    cloudForce.eraId = localForce.eraId ?? cloudForce.eraId;
                    cloudForce.bv = localForce.bv ?? cloudForce.bv;
                    cloudForce.pv = localForce.pv ?? cloudForce.pv;
                    cloudForce.forceTimestamp = localForce.forceTimestamp;
                }
                // Mark force as existing if either source has it
                if (localForce.exists) cloudForce.exists = true;
            }
        }
    }

    private async listOperationsLocal(): Promise<LoadOperationEntry[]> {
        const serialized = await this.dbService.listOperations();
        const entries: LoadOperationEntry[] = [];

        for (const op of serialized) {
            const forces: OperationForceInfo[] = [];
            for (const ref of op.forces) {
                // Try to enrich with local force metadata
                const localForce = await this.dbService.getForce(ref.instanceId);
                forces.push({
                    instanceId: ref.instanceId,
                    alignment: ref.alignment,
                    timestamp: ref.timestamp,
                    name: localForce?.name,
                    type: localForce?.type,
                    factionId: localForce?.factionId,
                    eraId: localForce?.eraId,
                    bv: localForce?.bv,
                    pv: localForce?.pv,
                    forceTimestamp: localForce?.timestamp,
                    exists: !!localForce,
                });
            }
            entries.push(new LoadOperationEntry({
                operationId: op.operationId,
                name: op.name || '',
                note: op.note || '',
                timestamp: op.timestamp,
                forces,
                local: true,
            }));
        }
        return entries;
    }

    private async listOperationsCloud(): Promise<LoadOperationEntry[]> {
        const ws = await this.canUseCloud();
        if (!ws) return [];

        const response = await this.wsService.sendAndWaitForResponse<WsDataResponse<RemoteOperationEntry[]>>({
            action: 'listOperations',
            forcePersistenceRevision: FORCE_PERSISTENCE_REVISION,
        });
        return (response?.data ?? []).map(raw => new LoadOperationEntry({
            operationId: raw.operationId,
            name: raw.name,
            note: raw.note,
            timestamp: raw.timestamp,
            owned: raw.owned ?? true,
            forces: raw.forces.map(force => ({ ...force })),
            cloud: true,
        }));
    }

    private async getOperationCloud(operationId: string): Promise<LoadOperationEntry | null> {
        const ws = await this.canUseCloud();
        if (!ws) return null;

        const response = await this.wsService.sendAndWaitForResponse<WsDataResponse<RemoteOperationEntry | null>>({
            action: 'getOperation',
            forcePersistenceRevision: FORCE_PERSISTENCE_REVISION,
            operationId,
        });
        const raw = response?.data;
        return raw ? new LoadOperationEntry({
            operationId: raw.operationId,
            name: raw.name,
            note: raw.note,
            timestamp: raw.timestamp,
            owned: raw.owned ?? false,
            forces: raw.forces.map(force => ({ ...force, exists: force.exists ?? false })),
            cloud: true,
        }) : null;
    }

    private async saveOperationCloud(op: SerializedOperation): Promise<void> {
        const ws = await this.canUseCloud();
        if (!ws) return;
        this.wsService.send({
            action: 'saveOperation',
            forcePersistenceRevision: FORCE_PERSISTENCE_REVISION,
            data: op,
        });
    }

    /**
     * Bulk-fetch basic force metadata from the cloud for a list of instanceIds.
     * Returns enrichment data (name, type, bv, pv, timestamp) for each found force.
     * Sends requests in chunks of 100 to stay within the server limit.
     */
    private static readonly FORCE_INFO_CHUNK_SIZE = 100;

    public async getForceInfoBulk(instanceIds: string[]): Promise<Map<string, OperationForceInfo>> {
        const result = new Map<string, OperationForceInfo>();
        const ws = await this.canUseCloud();
        if (!ws || instanceIds.length === 0) return result;

        try {
            for (let i = 0; i < instanceIds.length; i += OperationStorageService.FORCE_INFO_CHUNK_SIZE) {
                const chunk = instanceIds.slice(i, i + OperationStorageService.FORCE_INFO_CHUNK_SIZE);
                const response = await this.wsService.sendAndWaitForResponse<WsDataResponse<RemoteForceInfo[]>>({
                    action: 'getForceInfoBulk',
                    forcePersistenceRevision: FORCE_PERSISTENCE_REVISION,
                    instanceIds: chunk,
                });
                for (const entry of response?.data ?? []) {
                    result.set(entry.instanceId, {
                        instanceId: entry.instanceId,
                        alignment: 'friendly', // placeholder, caller should override
                        timestamp: '',          // placeholder, caller should override
                        name: entry.name,
                        type: entry.type,
                        factionId: entry.factionId,
                        eraId: entry.eraId,
                        bv: entry.bv,
                        pv: entry.pv,
                        forceTimestamp: typeof entry.timestamp === 'number'
                            ? new Date(entry.timestamp).toISOString()
                            : entry.timestamp,
                        exists: true,
                    });
                }
            }
        } catch (err) {
            this.logger.error(`Failed to fetch force info bulk: ${err}`);
        }

        return result;
    }

}
