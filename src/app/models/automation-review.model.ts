// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

export interface AutomationReviewEvent {
    id: string;
    subject: string;
    event: string;
    description: string;
    delta?: number;
    breakdown?: readonly AutomationReviewBreakdownItem[];
    effects?: readonly string[];
}

export interface AutomationReviewBreakdownItem {
    readonly id: string;
    readonly label: string;
    readonly value: number;
}

export interface AutomationReviewDialogData {
    title: string;
    message: string;
    events: readonly AutomationReviewEvent[];
    allowCancel: boolean;
}

export interface AutomationReviewResult {
    acceptedEventIds: string[];
}
