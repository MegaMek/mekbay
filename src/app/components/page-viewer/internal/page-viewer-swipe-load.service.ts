import { Injectable } from '@angular/core';

@Injectable()
export class PageViewerSwipeLoadService {
    private queuedUnitIndices = new Set<number>();
    private loadingUnitIndices = new Set<number>();
    private sessionId = 0;

    startSession(): void {
        this.queuedUnitIndices.clear();
        this.loadingUnitIndices.clear();
        this.sessionId++;
    }

    clear(): void {
        this.queuedUnitIndices.clear();
        this.loadingUnitIndices.clear();
    }

    canQueueLoad(unitIndex: number, hasUnit: boolean): boolean {
        return hasUnit
            && !this.queuedUnitIndices.has(unitIndex)
            && !this.loadingUnitIndices.has(unitIndex);
    }

    markQueued(unitIndex: number): number {
        this.queuedUnitIndices.add(unitIndex);
        this.loadingUnitIndices.add(unitIndex);

        return this.sessionId;
    }

    resolveLoadCompletion(options: {
        unitIndex: number;
        sessionId: number;
        isSwiping: boolean;
        hasActiveAnimation: boolean;
        isUnitAssigned: boolean;
    }): boolean {
        const { unitIndex, sessionId, isSwiping, hasActiveAnimation, isUnitAssigned } = options;

        this.loadingUnitIndices.delete(unitIndex);

        return sessionId === this.sessionId
            && isSwiping
            && !hasActiveAnimation
            && isUnitAssigned;
    }

    markLoadFailure(unitIndex: number): void {
        this.loadingUnitIndices.delete(unitIndex);
        this.queuedUnitIndices.delete(unitIndex);
    }
}