import type { SceneNode } from '../document/types';
import { optionalPresentationString, presentationString } from './nodePresentationValues';
import { framePresetOf, type FramePreset } from './framePreset';

export const CONTAINER_NODE_KINDS = ['group', 'section', 'swimlane', 'frame'] as const;

type ContainerNodeKind = (typeof CONTAINER_NODE_KINDS)[number];

export interface ContainerNodePresentation {
  readonly kind: ContainerNodeKind;
  readonly label: string;
  readonly subLabel?: string;
  readonly colorKey: string;
  readonly colorMode: 'subtle' | 'filled';
  readonly customColor?: string;
  /** Title band/chip drawn; sections can hide it, frames show it only with a title. */
  readonly header: boolean;
  /** A frame from the More flyout: named above its edge, device chrome inside. */
  readonly preset: FramePreset | null;
  readonly locked: boolean;
  readonly hidden: boolean;
  readonly collapsed: boolean;
}

const CONTAINER_KIND_SET = new Set<string>(CONTAINER_NODE_KINDS);
const SWIMLANE_COLOR_KEYS = ['blue', 'emerald', 'yellow', 'pink', 'violet'] as const;

export function isContainerNodeKind(kind: string): kind is ContainerNodeKind {
  return CONTAINER_KIND_SET.has(kind);
}

/** The canvas's bottom layer, painted under the connectors: containers and a sequence's fragment bands. */
export function isBackdropNode(node: SceneNode): boolean {
  // `underLines`: a shape lines are drawn over (one an imported draw.io line crossed after it was drawn).
  return isContainerNodeKind(node.kind) || typeof node.content.seqFragmentId === 'string' || node.content.underLines === true;
}

function fallbackColorKey(node: SceneNode, kind: ContainerNodeKind): string {
  if (kind === 'group') return 'violet';
  if (kind === 'frame') return 'slate';
  if (kind === 'section') return 'blue';
  const numericId = Number.parseInt(node.id.replace(/\D/g, ''), 10);
  const index = Number.isFinite(numericId) ? numericId : 0;
  return SWIMLANE_COLOR_KEYS[index % SWIMLANE_COLOR_KEYS.length];
}

function fallbackLabel(kind: ContainerNodeKind): string {
  if (kind === 'group') return 'Group';
  if (kind === 'frame') return 'Diagram';
  if (kind === 'section') return 'Section';
  return 'Swimlane';
}

export function resolveContainerNodePresentation(
  node: SceneNode
): ContainerNodePresentation | null {
  if (!isContainerNodeKind(node.kind)) return null;
  const kind = node.kind;
  const subLabel = optionalPresentationString(node.content.subLabel);
  const customColor = optionalPresentationString(node.content.customColor);
  const label = presentationString(node.content.label, fallbackLabel(kind));
  return {
    kind,
    label,
    header: node.content.showHeader !== false && (kind !== 'frame' || Boolean(node.content.label)),
    preset: framePresetOf(node),
    ...(subLabel ? { subLabel } : {}),
    colorKey: presentationString(node.content.color, fallbackColorKey(node, kind)),
    colorMode: node.content.colorMode === 'filled' ? 'filled' : 'subtle',
    ...(customColor ? { customColor } : {}),
    locked: node.content.sectionLocked === true,
    hidden: node.content.sectionHidden === true,
    collapsed: node.content.sectionCollapsed === true,
  };
}
