// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import { ChangeDetectionStrategy, Component, computed, inject, input } from '@angular/core';
import { LayoutService } from '../../services/layout.service';
import { WsService, type ConnectionStatusPhase } from '../../services/ws.service';

@Component({
    selector: 'connection-status-badge',
    changeDetection: ChangeDetectionStrategy.OnPush,
    templateUrl: './connection-status-badge.component.html',
    styleUrl: './connection-status-badge.component.scss',
})
export class ConnectionStatusBadgeComponent {
    private readonly layout = inject(LayoutService);
    private readonly wsService = inject(WsService);

    placement = input<'home' | 'sidebar'>('home');
    protected readonly phase = this.wsService.connectionStatusPhase;
    protected readonly displayLabel = computed(() => {
        if (this.placement() === 'sidebar' && !this.layout.isMenuOpen()) {
            return this.phase() === 'online' ? 'ONLINE' : 'OFFLINE'
        }
        return this.phase() === 'online' ? 'SYSTEM ONLINE' : 'OFFLINE MODE';
    });
    protected readonly showOfflineIcon = computed(() => this.phase() === 'offline');
    protected readonly isHidden = computed(() => this.phase() === 'hidden');

    protected isPlacement(placement: 'home' | 'sidebar'): boolean {
        return this.placement() === placement;
    }

    protected isPhase(phase: Exclude<ConnectionStatusPhase, 'hidden'>): boolean {
        return this.phase() === phase;
    }
}
