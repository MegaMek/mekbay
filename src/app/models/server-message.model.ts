// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

export interface ServerMessage<T = unknown> {
    action: 'serverMessage';
    messageType: string;
    payload: T;
}

export interface ServerDialogMessagePayload {
    dialogType: string;
    data?: unknown;
}