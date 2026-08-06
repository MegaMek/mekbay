// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake


export interface PrintAllOptions {
    clean: boolean;
    printPilotData: boolean;
    printRosterSummary: boolean;
    recordSheetCenterPanelContent: 'fluffImage' | 'clusterTable';
    ASPrintPageBreakOnGroups: boolean;
    printMargin: 'none' | 'browserDefined';
}