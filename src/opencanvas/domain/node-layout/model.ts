import { createBounds2d } from '../geometry/bounds';
import { isJsonObject } from '../document/json';
import type {
  ContentAlignment,
  ContentInsets,
  IconPlacement,
  LabelAlignment,
  NodeContentGeometry,
  NodeContentLayoutV1,
  NodeContentMetrics,
} from './types';
import { NODE_CONTENT_LAYOUT_VERSION } from './types';

const ALIGNMENTS = new Set<ContentAlignment>(['start', 'center', 'end']);
const ICON_PLACEMENTS = new Set<IconPlacement>(['top', 'right', 'bottom', 'left', 'free']);
const MAX_ICON_SCALE = 4;

export const DEFAULT_NODE_CONTENT_LAYOUT: NodeContentLayoutV1 = {
  version: NODE_CONTENT_LAYOUT_VERSION,
  horizontal: 'center',
  vertical: 'center',
  iconPlacement: 'top',
  labelAlignment: 'center',
  padding: { top: 16, right: 16, bottom: 16, left: 16 },
  gap: 8,
  iconScale: 1,
  freeIconPosition: { x: 0.5, y: 0.5 },
};

interface NodeContentLayoutValidationResult {
  readonly success: boolean;
  readonly value: NodeContentLayoutV1;
  readonly issues: readonly string[];
}

function finiteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function nonNegative(value: unknown): value is number {
  return finiteNumber(value) && value >= 0;
}

function normalized(value: unknown): value is number {
  return finiteNumber(value) && value >= 0 && value <= 1;
}

function isNormalizedPoint(value: unknown): value is { readonly x: number; readonly y: number } {
  return isJsonObject(value) && normalized(value.x) && normalized(value.y);
}

function readInsets(value: unknown, issues: string[]): ContentInsets {
  if (!isJsonObject(value)) {
    issues.push('padding must be an object.');
    return DEFAULT_NODE_CONTENT_LAYOUT.padding;
  }
  const sides = ['top', 'right', 'bottom', 'left'] as const;
  const result = { ...DEFAULT_NODE_CONTENT_LAYOUT.padding };
  for (const side of sides) {
    if (!nonNegative(value[side])) issues.push(`padding.${side} must be non-negative.`);
    else result[side] = value[side];
  }
  return result;
}

export function validateNodeContentLayout(value: unknown): NodeContentLayoutValidationResult {
  if (value === undefined) {
    return { success: true, value: DEFAULT_NODE_CONTENT_LAYOUT, issues: [] };
  }
  if (!isJsonObject(value)) {
    return {
      success: false,
      value: DEFAULT_NODE_CONTENT_LAYOUT,
      issues: ['contentLayout must be an object.'],
    };
  }

  const issues: string[] = [];
  if (value.version !== NODE_CONTENT_LAYOUT_VERSION) issues.push('version must be 1.');
  const horizontal = ALIGNMENTS.has(value.horizontal as ContentAlignment)
    ? (value.horizontal as ContentAlignment)
    : DEFAULT_NODE_CONTENT_LAYOUT.horizontal;
  if (horizontal !== value.horizontal) issues.push('horizontal must be start, center, or end.');
  const vertical = ALIGNMENTS.has(value.vertical as ContentAlignment)
    ? (value.vertical as ContentAlignment)
    : DEFAULT_NODE_CONTENT_LAYOUT.vertical;
  if (vertical !== value.vertical) issues.push('vertical must be start, center, or end.');
  const iconPlacement = ICON_PLACEMENTS.has(value.iconPlacement as IconPlacement)
    ? (value.iconPlacement as IconPlacement)
    : DEFAULT_NODE_CONTENT_LAYOUT.iconPlacement;
  if (iconPlacement !== value.iconPlacement) issues.push('iconPlacement is unsupported.');
  const labelAlignment = ALIGNMENTS.has(value.labelAlignment as LabelAlignment)
    ? (value.labelAlignment as LabelAlignment)
    : DEFAULT_NODE_CONTENT_LAYOUT.labelAlignment;
  if (labelAlignment !== value.labelAlignment) issues.push('labelAlignment is unsupported.');
  if (!nonNegative(value.gap)) issues.push('gap must be non-negative.');
  if (!finiteNumber(value.iconScale) || value.iconScale <= 0 || value.iconScale > MAX_ICON_SCALE) {
    issues.push(`iconScale must be greater than 0 and at most ${MAX_ICON_SCALE}.`);
  }
  const position = value.freeIconPosition;
  const validFreePosition = isNormalizedPoint(position);
  const freeIconPosition = validFreePosition
    ? { x: position.x, y: position.y }
    : DEFAULT_NODE_CONTENT_LAYOUT.freeIconPosition;
  if (!validFreePosition) {
    issues.push('freeIconPosition must use normalized x/y values from 0 to 1.');
  }
  const padding = readInsets(value.padding, issues);

  return {
    success: issues.length === 0,
    value: {
      version: NODE_CONTENT_LAYOUT_VERSION,
      horizontal,
      vertical,
      iconPlacement,
      labelAlignment,
      padding,
      gap: nonNegative(value.gap) ? value.gap : DEFAULT_NODE_CONTENT_LAYOUT.gap,
      iconScale:
        finiteNumber(value.iconScale) && value.iconScale > 0 && value.iconScale <= MAX_ICON_SCALE
          ? value.iconScale
          : DEFAULT_NODE_CONTENT_LAYOUT.iconScale,
      freeIconPosition,
    },
    issues,
  };
}

export function resolveNodeContentLayout(
  content: { readonly contentLayout?: unknown }
): NodeContentLayoutV1 {
  return validateNodeContentLayout(content.contentLayout).value;
}

// Content wider or taller than its space keeps its aligned side (the SVG exporter's text-anchor does the same):
// end-aligned words that don't fit grow leftward out of the box, centred ones both ways.
function alignedOffset(space: number, size: number, alignment: ContentAlignment): number {
  if (alignment === 'end') return space - size;
  if (alignment === 'center') return (space - size) / 2;
  return 0;
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(Math.max(value, minimum), Math.max(minimum, maximum));
}

export function layoutNodeContent(
  layout: NodeContentLayoutV1,
  metrics: NodeContentMetrics
): NodeContentGeometry {
  const { nodeSize, labelSize, subLabelSize } = metrics;
  const contentBounds = createBounds2d(
    layout.padding.left,
    layout.padding.top,
    Math.max(0, nodeSize.width - layout.padding.left - layout.padding.right),
    Math.max(0, nodeSize.height - layout.padding.top - layout.padding.bottom)
  );
  const textGap = subLabelSize ? Math.min(4, layout.gap) : 0;
  const textWidth = Math.max(labelSize.width, subLabelSize?.width ?? 0);
  const textHeight = labelSize.height + textGap + (subLabelSize?.height ?? 0);
  const requestedIcon = metrics.iconSize
    ? {
        width: metrics.iconSize.width * layout.iconScale,
        height: metrics.iconSize.height * layout.iconScale,
      }
    : null;
  // An icon that cannot fit inside the node at all (a v1 state-diagram dot, a node shrunk
  // below the icon) is dropped rather than painted outside it.
  const scaledIcon = requestedIcon && requestedIcon.width <= nodeSize.width && requestedIcon.height <= nodeSize.height
    ? requestedIcon
    : null;

  let groupWidth = textWidth;
  let groupHeight = textHeight;
  if (scaledIcon && layout.iconPlacement !== 'free') {
    const horizontal = layout.iconPlacement === 'left' || layout.iconPlacement === 'right';
    groupWidth = horizontal
      ? scaledIcon.width + layout.gap + textWidth
      : Math.max(scaledIcon.width, textWidth);
    groupHeight = horizontal
      ? Math.max(scaledIcon.height, textHeight)
      : scaledIcon.height + layout.gap + textHeight;
  }
  const groupX =
    contentBounds.x + alignedOffset(contentBounds.width, groupWidth, layout.horizontal);
  const groupY =
    contentBounds.y + alignedOffset(contentBounds.height, groupHeight, layout.vertical);

  let textX = groupX;
  let textY = groupY;
  let iconBounds = null;
  if (scaledIcon && layout.iconPlacement === 'free') {
    textX = contentBounds.x + alignedOffset(contentBounds.width, textWidth, layout.horizontal);
    textY = contentBounds.y + alignedOffset(contentBounds.height, textHeight, layout.vertical);
    const desiredX = contentBounds.x + layout.freeIconPosition.x * contentBounds.width;
    const desiredY = contentBounds.y + layout.freeIconPosition.y * contentBounds.height;
    const x = clamp(
      desiredX - scaledIcon.width / 2,
      contentBounds.x,
      contentBounds.x + contentBounds.width - scaledIcon.width
    );
    const y = clamp(
      desiredY - scaledIcon.height / 2,
      contentBounds.y,
      contentBounds.y + contentBounds.height - scaledIcon.height
    );
    iconBounds = createBounds2d(x, y, scaledIcon.width, scaledIcon.height);
  } else if (scaledIcon) {
    if (layout.iconPlacement === 'left' || layout.iconPlacement === 'right') {
      const iconX = layout.iconPlacement === 'left' ? groupX : groupX + textWidth + layout.gap;
      textX = layout.iconPlacement === 'left' ? groupX + scaledIcon.width + layout.gap : groupX;
      const iconY = groupY + (groupHeight - scaledIcon.height) / 2;
      textY = groupY + (groupHeight - textHeight) / 2;
      iconBounds = createBounds2d(iconX, iconY, scaledIcon.width, scaledIcon.height);
    } else {
      const iconY = layout.iconPlacement === 'top' ? groupY : groupY + textHeight + layout.gap;
      textY = layout.iconPlacement === 'top' ? groupY + scaledIcon.height + layout.gap : groupY;
      const iconX = groupX + (groupWidth - scaledIcon.width) / 2;
      textX = groupX + (groupWidth - textWidth) / 2;
      iconBounds = createBounds2d(iconX, iconY, scaledIcon.width, scaledIcon.height);
    }
  }

  return {
    contentBounds,
    iconBounds,
    labelBounds: createBounds2d(textX, textY, textWidth, labelSize.height),
    subLabelBounds: subLabelSize
      ? createBounds2d(textX, textY + labelSize.height + textGap, textWidth, subLabelSize.height)
      : null,
    labelAlignment: layout.labelAlignment,
  };
}
