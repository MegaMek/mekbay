// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import { ChangeDetectionStrategy, Component, computed, effect, inject } from '@angular/core';
import { DecimalPipe } from '@angular/common';
import { DialogRef } from '@angular/cdk/dialog';
import { type CdkDragDrop, DragDropModule } from '@angular/cdk/drag-drop';
import type { LobbyParticipant } from '../../models/lobby.model';
import { getFactionImg } from '../../models/factions.model';
import { DialogsService } from '../../services/dialogs.service';
import { ForceWorkspaceStateService } from '../../services/force-workspace-state.service';
import { LobbyService } from '../../services/lobby.service';
import { ToastService } from '../../services/toast.service';

interface LobbyDisplayForce {
    instanceId: string;
    name: string;
    points: number;
    metric: 'BV' | 'PV' | null;
    factionImgUrl: string | null;
    eraImgUrl: string | null;
    eraName: string | null;
    exists: boolean;
}

interface LobbyDisplayParticipant extends LobbyParticipant {
    label: string;
    forces: LobbyDisplayForce[];
}

interface LobbySideTotals {
    bv: number;
    pv: number;
}

@Component({
    selector: 'lobby-dialog',
    changeDetection: ChangeDetectionStrategy.OnPush,
    imports: [DecimalPipe, DragDropModule],
    host: { class: 'fullscreen-dialog-host glass' },
    templateUrl: './lobby-dialog.component.html',
    styleUrl: './lobby-dialog.component.scss',
})
export class LobbyDialogComponent {
    readonly lobbyService = inject(LobbyService);
    private readonly forceWorkspace = inject(ForceWorkspaceStateService);
    private readonly dialogsService = inject(DialogsService);
    private readonly toastService = inject(ToastService);
    private readonly dialogRef = inject(DialogRef<void>);

    readonly participants = computed<LobbyDisplayParticipant[]>(() => {
        const slotsById = new Map(
            this.forceWorkspace.loadedForces()
                .map(slot => [slot.force.instanceId(), slot.force] as const)
                .filter((entry): entry is [string, typeof entry[1]] => !!entry[0]),
        );
        return (this.lobbyService.state()?.participants ?? []).map(participant => ({
            ...participant,
            label: this.participantLabel(participant),
            forces: participant.instanceIds.map(instanceId => {
                const force = slotsById.get(instanceId);
                if (!force) return {
                    instanceId,
                    name: instanceId,
                    points: 0,
                    metric: null,
                    factionImgUrl: null,
                    eraImgUrl: null,
                    eraName: null,
                    exists: false,
                };
                const points = force.totalBv();
                const faction = force.faction();
                const era = force.era();
                return {
                    instanceId,
                    name: force.displayName(),
                    points,
                    metric: force.gameSystem === 'as' ? 'PV' : 'BV',
                    factionImgUrl: faction ? getFactionImg(faction) ?? null : null,
                    eraImgUrl: era?.img ?? era?.icon ?? null,
                    eraName: era?.name ?? null,
                    exists: true,
                };
            }),
        }));
    });

    readonly friendlyParticipants = computed(() => this.participants().filter(entry => entry.alignment === 'friendly'));
    readonly enemyParticipants = computed(() => this.participants().filter(entry => entry.alignment === 'enemy'));
    readonly friendlyTotals = computed(() => this.calculateTotals(this.friendlyParticipants()));
    readonly enemyTotals = computed(() => this.calculateTotals(this.enemyParticipants()));

    constructor() {
        effect(() => {
            if (!this.lobbyService.state()) this.dialogRef.close();
        });
    }

    onDrop(event: CdkDragDrop<LobbyDisplayParticipant[]>, alignment: 'friendly' | 'enemy'): void {
        const participant = event.item.data as LobbyDisplayParticipant;
        if (participant.self || participant.alignment === alignment) return;
        this.lobbyService.setAlignment(participant.publicId, alignment);
    }

    onLockChange(event: Event): void {
        this.lobbyService.setLocked((event.target as HTMLInputElement).checked);
    }

    async copyCode(): Promise<void> {
        const code = this.lobbyService.state()?.code;
        if (!code) return;
        try {
            await navigator.clipboard.writeText(code);
            this.toastService.showToast('Lobby code copied.', 'success');
        } catch {
            this.toastService.showToast('Could not copy the lobby code.', 'error');
        }
    }

    async kick(participant: LobbyDisplayParticipant): Promise<void> {
        const confirmed = await this.dialogsService.requestConfirmation(
            `Remove ${participant.label} from the lobby?`,
            'Kick Participant',
            'danger',
        );
        if (confirmed) this.lobbyService.kick(participant.publicId);
    }

    async leave(): Promise<void> {
        if (await this.lobbyService.confirmAndLeave()) this.dialogRef.close();
    }

    close(): void {
        this.dialogRef.close();
    }

    private participantLabel(participant: LobbyParticipant): string {
        if (participant.self) return participant.host
            ? `${participant.displayName} (You, Host)`
            : `${participant.displayName} (You)`;
        return participant.host ? `${participant.displayName} (Host)` : participant.displayName;
    }

    private calculateTotals(participants: LobbyDisplayParticipant[]): LobbySideTotals {
        let bv = 0;
        let pv = 0;
        for (const participant of participants) {
            for (const force of participant.forces) {
                if (force.metric === 'PV') pv += force.points;
                if (force.metric === 'BV') bv += force.points;
            }
        }
        return { bv, pv };
    }
}
