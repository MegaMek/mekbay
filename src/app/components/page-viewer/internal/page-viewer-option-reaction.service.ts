// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import { Injectable } from '@angular/core';
import type { RecordSheetSourceMode } from '../../../services/record-sheet-source.service';

@Injectable()
export class PageViewerOptionReactionService {
    private previousAllowMultiple: boolean | undefined;
    private previousReadOnly: boolean | undefined;
    private previousSheetSource: RecordSheetSourceMode | undefined;

    shouldRedisplayForAllowMultipleChange(options: {
        allowMultiple: boolean;
        viewInitialized: boolean;
        isSwiping: boolean;
    }): boolean {
        const { allowMultiple, viewInitialized, isSwiping } = options;

        if (this.previousAllowMultiple === undefined) {
            this.previousAllowMultiple = allowMultiple;
            return false;
        }

        if (allowMultiple === this.previousAllowMultiple) {
            return false;
        }

        this.previousAllowMultiple = allowMultiple;
        return viewInitialized && !isSwiping;
    }

    shouldRedisplayForReadOnlyChange(options: {
        isReadOnly: boolean;
        viewInitialized: boolean;
        isSwiping: boolean;
    }): boolean {
        const { isReadOnly, viewInitialized, isSwiping } = options;

        if (this.previousReadOnly === undefined) {
            this.previousReadOnly = isReadOnly;
            return false;
        }

        const shouldRedisplay = this.previousReadOnly !== isReadOnly && viewInitialized && !isSwiping;
        this.previousReadOnly = isReadOnly;
        return shouldRedisplay;
    }

    shouldRedisplayForSheetSourceChange(options: {
        source: RecordSheetSourceMode;
        viewInitialized: boolean;
        isSwiping: boolean;
    }): boolean {
        const { source, viewInitialized, isSwiping } = options;
        if (this.previousSheetSource === undefined) {
            this.previousSheetSource = source;
            return false;
        }
        if (source === this.previousSheetSource) return false;
        this.previousSheetSource = source;
        return viewInitialized && !isSwiping;
    }
}
