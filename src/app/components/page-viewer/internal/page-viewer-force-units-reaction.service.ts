import { Injectable } from '@angular/core';

export interface PageViewerForceUnitsReactionResult {
    shouldHandleChange: boolean;
    previousUnitCount: number;
}

@Injectable()
export class PageViewerForceUnitsReactionService {
    private previousUnitIds: string[] = [];
    private previousUnitCount = 0;

    evaluate(options: {
        currentUnitIds: readonly string[];
        viewInitialized: boolean;
    }): PageViewerForceUnitsReactionResult {
        const { currentUnitIds, viewInitialized } = options;
        const currentUnitCount = currentUnitIds.length;
        const result: PageViewerForceUnitsReactionResult = {
            shouldHandleChange: false,
            previousUnitCount: this.previousUnitCount
        };

        if (viewInitialized) {
            result.shouldHandleChange =
                currentUnitIds.length !== this.previousUnitIds.length ||
                currentUnitIds.some((id, index) => id !== this.previousUnitIds[index]);
        }

        this.previousUnitIds = [...currentUnitIds];
        this.previousUnitCount = currentUnitCount;

        return result;
    }
}