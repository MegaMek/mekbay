// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

export interface AutomationReviewBreakdownItem {
    readonly id: string;
    readonly label: string;
    readonly value: number;
}

export interface AutomationReviewEvent {
    readonly id: string;
    readonly subject: string;
    readonly event: string;
    readonly description: string;
    readonly delta?: number;
    readonly breakdown?: readonly AutomationReviewBreakdownItem[];
    readonly effects?: readonly string[];
}

export interface AutomationReviewDialogData {
    readonly title: string;
    readonly message: string;
    readonly events: readonly AutomationReviewEvent[];
    readonly allowCancel: boolean;
}

export interface AutomationReviewResult {
    readonly acceptedEventIds: string[];
}
