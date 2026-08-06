// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import { GameSystem } from './common.model';

export interface RemoteLoadForceUnit {
    unit: string;
    alias?: string;
    skill?: number;
    g?: number; // gunnery
    p?: number; // piloting
    commander?: boolean;
    state?: { destroyed?: boolean };
}

export interface RemoteLoadForceGroup {
    name?: string;
    formationId?: string;
    units: RemoteLoadForceUnit[];
}

export interface RemoteLoadForceEntry {
    instanceId: string;
    timestamp: string;
    type?: GameSystem;
    owned?: boolean;
    name: string;
    note?: string;
    tags?: string[];
    factionId?: number;
    eraId?: number;
    bv?: number;
    pv?: number;
    groups?: RemoteLoadForceGroup[];
}