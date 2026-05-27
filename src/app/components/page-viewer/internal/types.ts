import type { ViewportTransform } from '../../../models/force-serialization';
import type { CBTForceUnit } from '../../../models/cbt-force-unit.model';

export type PageViewerNavigationSource = 'keyboard' | 'shadow' | 'swipe';
export type PageViewerDirection = 'left' | 'right';
export type PageViewerPageRole = 'active' | 'shadow';
export type PageViewerOverlayMode = 'fixed' | 'page';
export type PageViewerTransitionPhase = 'idle' | 'animating' | 'reversing' | 'settling';

export interface PageViewerNavigationRequest {
    direction: PageViewerDirection;
    source: PageViewerNavigationSource;
    requestedAt: number;
}

export interface PageViewerTransitionState {
    phase: PageViewerTransitionPhase;
    request: PageViewerNavigationRequest | null;
    pagesToMove: number;
    targetUnitId: string | null;
}

export interface PageViewerPageDescriptor {
    key: string;
    unit: CBTForceUnit;
    unitId: string;
    unitIndex: number;
    slotIndex: number;
    role: PageViewerPageRole;
    overlayMode: PageViewerOverlayMode;
    originalLeft: number;
    scaledLeft: number;
    isSelected: boolean;
    isActive: boolean;
    isDimmed: boolean;
}

export interface PageViewerShadowDescriptor {
    key: string;
    unit: CBTForceUnit;
    unitId: string;
    unitIndex: number;
    direction: PageViewerDirection;
    originalLeft: number;
    scaledLeft: number;
    isDimmed: boolean;
}

export interface PageViewerViewStateRecord {
    unitId: string;
    viewState: ViewportTransform;
    updatedAt: number;
}

export interface PageViewerDisplayWindow {
    startIndex: number;
    units: CBTForceUnit[];
}

export interface PageViewerForceChangePlan {
    nextViewStartIndex: number;
    needsRedisplay: boolean;
    preserveSelectedSlot: boolean;
    targetDisplayCount: number;
    modeChanged: boolean;
}

export interface PageViewerInPlaceSlotPlan {
    slotIndex: number;
    unit: CBTForceUnit;
    preserveExisting: boolean;
}

export interface PageViewerInPlaceUpdatePlan {
    canPatchInPlace: boolean;
    slots: PageViewerInPlaceSlotPlan[];
}
