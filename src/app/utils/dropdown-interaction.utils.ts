export interface DropdownPointerHoverEvent {
    clientX: number;
    clientY: number;
}

interface PointerPosition {
    x: number;
    y: number;
}

export class DropdownPointerActivationGuard {
    private static readonly POINTER_ACTIVATION_MOVE_THRESHOLD_PX = 2;
    private pointerHoverSuppressed = false;
    private pointerHoverSuppressionOrigin: PointerPosition | null = null;
    private lastPointerPosition: PointerPosition | null = null;

    suppress(): void {
        this.pointerHoverSuppressed = true;
        this.pointerHoverSuppressionOrigin = this.lastPointerPosition;
    }

    shouldIgnore(event: DropdownPointerHoverEvent): boolean {
        const pointerPosition = { x: event.clientX, y: event.clientY };
        const suppressionOrigin = this.pointerHoverSuppressionOrigin;
        this.lastPointerPosition = pointerPosition;

        if (!this.pointerHoverSuppressed) return false;

        if (!suppressionOrigin) {
            this.pointerHoverSuppressionOrigin = pointerPosition;
            return true;
        }

        const dx = pointerPosition.x - suppressionOrigin.x;
        const dy = pointerPosition.y - suppressionOrigin.y;
        const threshold = DropdownPointerActivationGuard.POINTER_ACTIVATION_MOVE_THRESHOLD_PX;
        if ((dx * dx) + (dy * dy) <= threshold * threshold) return true;

        this.pointerHoverSuppressed = false;
        this.pointerHoverSuppressionOrigin = null;
        return false;
    }
}

export function scrollActiveOptionIntoView(panelHost: HTMLElement, scrollContainerSelector: string, activeOptionSelector: string): void {
    const scrollContainer = panelHost.querySelector(scrollContainerSelector) as HTMLElement | null;
    const activeOption = panelHost.querySelector(activeOptionSelector) as HTMLElement | null;
    if (!scrollContainer || !activeOption) return;

    scrollElementIntoView(scrollContainer, activeOption);
}

export function scrollElementIntoView(scrollContainer: HTMLElement, targetElement: HTMLElement): void {
    const visibleTop = scrollContainer.scrollTop;
    const visibleBottom = visibleTop + scrollContainer.clientHeight;
    const containerRect = scrollContainer.getBoundingClientRect();
    const targetRect = targetElement.getBoundingClientRect();
    const optionTop = targetRect.top - containerRect.top + visibleTop;
    const optionHeight = targetRect.height || targetElement.offsetHeight;
    const optionBottom = optionTop + optionHeight;
    const maxScrollTop = Math.max(0, scrollContainer.scrollHeight - scrollContainer.clientHeight);

    if (optionTop < visibleTop) {
        scrollContainer.scrollTop = Math.max(0, optionTop);
    } else if (optionBottom > visibleBottom) {
        scrollContainer.scrollTop = Math.min(maxScrollTop, optionBottom - scrollContainer.clientHeight);
    }
}