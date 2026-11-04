import { useRef, useState } from 'react';
import {
  IconArrowUpRight,
  IconMoodSmile,
  IconPencil,
  IconPlus,
  IconPointer,
  IconSquare,
  IconTypography,
} from '@tabler/icons-react';
import type { IconChoice } from '../../domain/nodes/iconNode';
import { FloatingRegion, Icon, IconButton, Popover, Toolbar, Tooltip } from '../design-system';
import { V2IconPicker } from './V2IconPicker';
import { FlyoutButton } from './V2Flyout';
import {
  CONNECTOR_OPTIONS, DRAW_OPTIONS, INSERT_SECTIONS, POINTER_OPTIONS, SHAPE_SECTIONS,
  type V2ConnectorTool, type V2MoreItem, type V2Tool, type V2ToolConfig,
} from './v2ToolCatalog';
import type { ShapeKind } from '../../domain/nodes/shapeNode';
import type { V2ShapeKind } from '../../domain/commands/sceneEdits';

type V2FlyoutId = 'pointer' | 'shapes' | 'connector' | 'draw';

/**
 * Up/Down on the rail go tool to tool: a tool's "… options" corner is a pointer target (ArrowRight or a long press opens
 * the same grid from the keyboard), so the roving order skips it. Home/End and the rest stay with Toolbar.
 */
function skipCorners(event: React.KeyboardEvent<HTMLDivElement>): void {
  if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
  if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey || !(event.target instanceof HTMLButtonElement)) return;
  const tools = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>('button:not(:disabled)'))
    .filter((button) => !button.classList.contains('ofk-v2-flyout-corner') && button.closest('[role="toolbar"]') === event.currentTarget);
  const from = event.target.classList.contains('ofk-v2-flyout-corner')
    ? event.target.parentElement?.querySelector<HTMLButtonElement>('button:not(.ofk-v2-flyout-corner)') ?? null : event.target;
  const index = from ? tools.indexOf(from) : -1;
  if (index < 0) return;
  event.preventDefault();
  tools[(index + (event.key === 'ArrowDown' ? 1 : tools.length - 1)) % tools.length]?.focus();
}

export type { V2Tool, V2ToolConfig, V2ConnectorTool };

const POINTER_TOOLS = new Set<V2Tool>(['select', 'hand', 'comment']);
const DRAW_TOOLS = new Set<V2Tool>(['pen', 'highlighter', 'eraser', 'laser']);

// Seven buttons, grouped by intent. Every flyout is one level: a pick places or
// arms, and nothing opens inside it. The tool letters skip the flyouts entirely.
export function V2CreationToolbar(props: {
  readonly tool: V2Tool;
  readonly toolConfig: V2ToolConfig;
  readonly onToolChange: (tool: V2Tool) => void;
  readonly onPickShape: (shape: ShapeKind) => void;
  /** A keyboard pick in Shapes places the shape at the view centre: the keyboard has no canvas to click. */
  readonly onPlaceShape: (shape: V2ShapeKind, square?: boolean) => void;
  readonly onPickConnector: (kind: V2ConnectorTool) => void;
  /** Icon library pick: the page inserts the icon node and opens its label. */
  readonly onInsertIcon: (icon: IconChoice) => void;
  readonly iconsOpen: boolean;
  readonly onIconsOpenChange: (open: boolean) => void;
  /** Emoji live in the same library, on their own tab. */
  readonly onPickEmoji: (glyph: string) => void;
  readonly recentEmoji: readonly string[];
  /** Which tab the library opens on: E asks for emoji, I for icons. */
  readonly librarySection: 'icons' | 'emoji';
  /** Image picks a file; the page stores the bytes and inserts the node. */
  readonly onInsertImage: () => void;
  /** Insert: media, charts, frames and widgets. Open state lives on the page so ⇧S reaches it. */
  readonly moreOpen: boolean;
  readonly onMoreOpenChange: (open: boolean) => void;
  readonly onPickMore: (item: V2MoreItem) => void;
}): React.JSX.Element {
  // Each picker anchors to its own trigger: the popover opens at the button's
  // height and, more importantly, focus returns to a real button when it closes.
  const toolsRef = useRef<HTMLDivElement>(null);
  const iconsRef = useRef<HTMLButtonElement>(null);
  // One flyout at a time: a rail with two open grids reads as two selections.
  const [flyout, setFlyout] = useState<V2FlyoutId | null>(null);
  const setFlyoutOpen = (id: V2FlyoutId) => (open: boolean) => {
    if (open) props.onMoreOpenChange(false);
    setFlyout(open ? id : null);
  };
  const { tool } = props;
  // The grid opens on the last shape picked, as S re-arms it; R and O mark their own cells while armed.
  const shapePick = tool === 'square' ? 'tool:square' : tool === 'rectangle' ? 'tool:rectangle' : tool === 'ellipse' ? 'tool:ellipse' : props.toolConfig.shape;
  const shapeArmed = tool === 'square' || tool === 'rectangle' || tool === 'ellipse' || tool === 'shape';
  // A rail click re-arms the group's last-used tool, as its letter does, and the button shows that tool (Figma):
  // a click never arms something the rail does not show. The grid is one corner away.
  const [lastUsed, setLastUsed] = useState<{ pointer: V2Tool; shapes: V2Tool; draw: V2Tool }>({ pointer: 'select', shapes: 'square', draw: 'pen' });
  const group = POINTER_TOOLS.has(tool) ? 'pointer' : shapeArmed ? 'shapes' : DRAW_TOOLS.has(tool) ? 'draw' : null;
  if (group && lastUsed[group] !== tool) setLastUsed({ ...lastUsed, [group]: tool });
  const shapeVariant = lastUsed.shapes === 'square' ? 'tool:square' : lastUsed.shapes === 'rectangle' ? 'tool:rectangle' : lastUsed.shapes === 'ellipse' ? 'tool:ellipse' : props.toolConfig.shape;
  const variants = {
    pointer: POINTER_OPTIONS.find((option) => option.id === lastUsed.pointer),
    shapes: SHAPE_SECTIONS.flatMap((section) => section.options).find((option) => option.id === shapeVariant),
    connector: CONNECTOR_OPTIONS.find((option) => option.id === props.toolConfig.connector),
    draw: DRAW_OPTIONS.find((option) => option.id === lastUsed.draw),
  };

  return (
    <FloatingRegion ref={toolsRef} slot="top-start" className="ofk-v2-tools">
      <Toolbar label="Create" orientation="vertical" onKeyDown={skipCorners}>
        <FlyoutButton label="Select" shortcut="V / H" icon={<Icon icon={IconPointer} />}
          selected={POINTER_TOOLS.has(tool)} open={flyout === 'pointer'}
          onActivate={() => props.onToolChange(lastUsed.pointer)} variant={variants.pointer}
          onOpenChange={setFlyoutOpen('pointer')} options={POINTER_OPTIONS} columns={2}
          selectedId={POINTER_TOOLS.has(tool) ? tool : null} onPick={props.onToolChange} />
        <span className="ofk-v2-tools-separator" aria-hidden="true" />
        <FlyoutButton label="Shapes" icon={<Icon icon={IconSquare} />}
          selected={shapeArmed} open={flyout === 'shapes'}
          onActivate={() => props.onToolChange(lastUsed.shapes)} variant={variants.shapes}
          onOpenChange={setFlyoutOpen('shapes')} options={SHAPE_SECTIONS} columns={6}
          selectedId={shapePick}
          onPick={(id, keyboard) => {
            if (id === 'tool:square') props.onToolChange('square');
            else if (id === 'tool:rectangle') props.onToolChange('rectangle');
            else if (id === 'tool:ellipse') props.onToolChange('ellipse');
            else props.onPickShape(id);
            if (keyboard) props.onPlaceShape(id === 'tool:square' || id === 'tool:rectangle' ? 'rectangle' : id === 'tool:ellipse' ? 'ellipse' : id, id === 'tool:square');
          }} />
        <FlyoutButton label="Connector" shortcut="A" icon={<Icon icon={IconArrowUpRight} />}
          selected={tool === 'connector'} open={flyout === 'connector'}
          onActivate={() => props.onToolChange('connector')} variant={variants.connector}
          onOpenChange={setFlyoutOpen('connector')} options={CONNECTOR_OPTIONS} columns={3}
          selectedId={props.toolConfig.connector} onPick={props.onPickConnector} />
        <Tooltip content="Text" shortcut="T">
          <IconButton variant="quiet" label="Text" icon={<Icon icon={IconTypography} />}
            selected={tool === 'text'} onClick={() => props.onToolChange('text')} />
        </Tooltip>
        <span className="ofk-v2-tools-separator" aria-hidden="true" />
        <FlyoutButton label="Draw" shortcut="P" icon={<Icon icon={IconPencil} />}
          selected={DRAW_TOOLS.has(tool)} open={flyout === 'draw'}
          onActivate={() => props.onToolChange(lastUsed.draw)} variant={variants.draw}
          onOpenChange={setFlyoutOpen('draw')} options={DRAW_OPTIONS} columns={4}
          selectedId={DRAW_TOOLS.has(tool) ? tool : null} onPick={props.onToolChange} />
        <Tooltip content="Icons and emoji" shortcut="I / E">
          <IconButton ref={iconsRef} variant="quiet" label="Icons and emoji" icon={<Icon icon={IconMoodSmile} />}
            selected={props.iconsOpen} aria-haspopup="dialog" aria-expanded={props.iconsOpen}
            onClick={() => props.onIconsOpenChange(!props.iconsOpen)} />
        </Tooltip>
        <FlyoutButton label="Insert" shortcut="⇧S" icon={<Icon icon={IconPlus} />}
          selected={false} open={props.moreOpen}
          onOpenChange={(open) => { if (open) setFlyout(null); props.onMoreOpenChange(open); }}
          options={INSERT_SECTIONS} columns={5} selectedId={null}
          onPick={(id) => { if (id === 'insert:image') props.onInsertImage(); else props.onPickMore(id); }} />
      </Toolbar>
      <Popover role="dialog" aria-label="Icon library" open={props.iconsOpen} anchorRef={iconsRef}
        onClose={() => props.onIconsOpenChange(false)} placement="right-start" gap={12}
        className="ofk-style-panel ofk-style-panel--icons" onPointerDown={(event) => event.stopPropagation()}>
        <V2IconPicker key={props.librarySection} initialPack={props.librarySection === 'emoji' ? 'emoji' : 'all'}
          recentEmoji={props.recentEmoji} onPickEmoji={props.onPickEmoji}
          onClose={() => props.onIconsOpenChange(false)}
          onPick={(icon) => { props.onInsertIcon(icon); props.onIconsOpenChange(false); }} />
      </Popover>
    </FloatingRegion>
  );
}
