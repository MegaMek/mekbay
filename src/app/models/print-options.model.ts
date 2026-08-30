// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

export const PRINT_OPTION_VALUES = {
    paperSize: ['letter', 'a4'],
    recordSheetCenterPanelContent: ['fluffImage', 'clusterTable'],
    ASPrintCardSize: ['standard', 'enlarged'],
    printMargin: ['none', 'browserDefined'],
} as const;

export interface PrintAllOptions {
    clean: boolean;
    printPilotData: boolean;
    paperSize: typeof PRINT_OPTION_VALUES.paperSize[number];
    recordSheetCenterPanelContent: typeof PRINT_OPTION_VALUES.recordSheetCenterPanelContent[number];
    ASPrintPageBreakOnGroups: boolean;
    ASPrintCardSize: typeof PRINT_OPTION_VALUES.ASPrintCardSize[number];
    printMargin: typeof PRINT_OPTION_VALUES.printMargin[number];
}
