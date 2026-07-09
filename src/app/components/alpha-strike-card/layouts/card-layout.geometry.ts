export const CARD_VIEWBOX_WIDTH = 1120;
export const CARD_VIEWBOX_HEIGHT = 800;

/** Distance from card content, including headers and frames, to the card edge. */
export const CARD_BODY_INSET = 32;

/** Shared horizontal and vertical spacing between adjacent card frames. */
export const CARD_FRAME_GAP = 10;

/** Fixed footer area excluded from the frame/header body. */
const CARD_FOOTER_RESERVED_HEIGHT = 69;

export const CARD_LAYOUT_GEOMETRY = {
    viewBoxWidth: CARD_VIEWBOX_WIDTH,
    viewBoxHeight: CARD_VIEWBOX_HEIGHT,
    bodyInset: CARD_BODY_INSET,
    bodyRight: CARD_VIEWBOX_WIDTH - CARD_BODY_INSET,
    bodyWidth: CARD_VIEWBOX_WIDTH - CARD_BODY_INSET * 2,
    bodyBottom: CARD_VIEWBOX_HEIGHT - CARD_FOOTER_RESERVED_HEIGHT - CARD_BODY_INSET,
    frameGap: CARD_FRAME_GAP,
} as const;