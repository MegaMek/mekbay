import { Injectable } from '@angular/core';

@Injectable()
export class PageViewerOptionReactionService {
    private previousAllowMultiple: boolean | undefined;
    private previousReadOnly: boolean | undefined;

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

        const shouldRedisplay = this.previousReadOnly && !isReadOnly && viewInitialized && !isSwiping;
        this.previousReadOnly = isReadOnly;
        return shouldRedisplay;
    }
}