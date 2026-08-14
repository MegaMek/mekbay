// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import type { ForceAlignment } from './force-slot.model';

export interface LobbyParticipant {
    publicId: string;
    displayName: string;
    self: boolean;
    host: boolean;
    connected: boolean;
    alignment: ForceAlignment;
    instanceIds: string[];
}

export interface LobbyState {
    code: string;
    locked: boolean;
    isHost: boolean;
    participants: LobbyParticipant[];
}
