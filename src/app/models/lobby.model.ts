// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import type { CBTRuleset } from './cbt-ruleset.model';
import type { ForceAlignment } from './force-slot.model';
import type { InitiativeOrderMode, InitiativeRecord } from './rules/initiative-rules';

/** The rules everyone in a lobby plays by; the host sets them, and they take precedence over local options. */
export interface LobbyGameSettings {
    ruleset: CBTRuleset;
    initiativeOrder: InitiativeOrderMode;
    initiativeDie: boolean;
}

export interface LobbyParticipant {
    publicId: string;
    displayName: string;
    self: boolean;
    host: boolean;
    connected: boolean;
    alignment: ForceAlignment;
    /** Set by the host: this player's forces no longer hold the shared turn. */
    away: boolean;
    instanceIds: string[];
}

export interface LobbyState {
    code: string;
    locked: boolean;
    settings: LobbyGameSettings;
    /** The current turn's Initiative, decided by the host. */
    initiative: InitiativeRecord | null;
    isHost: boolean;
    participants: LobbyParticipant[];
}


