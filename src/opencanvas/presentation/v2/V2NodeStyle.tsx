import { useEffect, useState } from 'react';
import {
  IconAlignCenter, IconAlignLeft, IconAlignRight, IconArrowBarToDown, IconArrowBarToUp,
  IconArrowsVertical, IconChevronDown, IconBold, IconItalic, IconMoodSmile,
  IconLayoutNavbar, IconLayoutSidebar, IconShadow, IconStrikethrough, IconUnderline,
} from '@tabler/icons-react';

import { loadProviderShapePreview } from '@/services/shapeLibrary/providerCatalog';
import type { SceneNode, ScenePage } from '../../domain/document/types';
import type { JsonObject } from '../../domain/document/json';
import type { DocumentCommand } from '../../domain/commands/types';
import { buildSetIconPlacementCommand } from '../../domain/commands/iconCommands';
import { buildStyleNodesCommand } from '../../domain/commands/styleNodes';
import type { IconChoice } from '../../domain/nodes/iconNode';
import { hasIcon } from '../../application/dsl/iconCommands';
import { buildSetInkCommand } from '../../domain/commands/inkCommands';
import { buildSetChartKindCommand } from '../../domain/commands/chartCommands';
import type { ChartKind } from '../../domain/nodes/chartNodePresentation';
import { CHART_OPTIONS, SHAPE_SECTIONS } from './v2ToolCatalog';
import { buildSetShapeCommand } from '../../domain/commands/sceneEdits';
import type { ShapeKind } from '../../domain/nodes/shapeNode';
import { resolveBasicNodePresentation } from '../../domain/nodes/basicNodePresentation';
import { buildSetWidgetStateCommand, type WidgetStatePatch } from '../../domain/commands/widgetCommands';
import { WIDGETS, WIDGET_SEVERITIES, resolveWidgetPresentation } from '../../domain/nodes/widgetNodePresentation';
import { buildSetHeaderCommand } from '../../domain/commands/groupNodes';
import { resolveArchitectureNodePresentation, type IconCardPlacement } from '../../domain/nodes/architectureNodePresentation';
import { V2IconPicker } from './V2IconPicker';
import { V2NodeEffects } from './V2NodeEffects';
import { resolveNodeStyle, STYLE_LIMITS, type NodeStyle } from '../../domain/nodes/nodeStyle';
import { isContainerNodeKind } from '../../domain/nodes/containerNodePresentation';
import { Icon, NumberField, Segmented } from '../design-system';
import { platformKeys } from './v2Shortcuts';
import {
  INK_PRESETS, PALETTE_KEYS, PALETTE_LABELS, paletteFillPatch, paletteKeyForFill, paletteSwatch, type PaletteMode,
} from '../../domain/nodes/nodePalette';
import { ChoiceRow, CustomColorSwatch, FontPicker, PanelRow, StyleButton, SwatchGrid, ToggleRow, useStyleDraft } from './V2StyleControls';

type NodeStyleCommon = { readonly [K in keyof NodeStyle]: NodeStyle[K] | null };

/** Per-key common value across the selection; null where they differ. */
function commonNodeStyle(nodes: readonly SceneNode[]): NodeStyleCommon {
  const styles = nodes.map((node) => resolveNodeStyle(node));
  const first = styles[0] ?? EMPTY_STYLE;
  const result: Record<string, unknown> = {};
  for (const key of Object.keys(first) as (keyof NodeStyle)[]) {
    const value = first[key];
    const same = styles.every((style) => typeof value === 'object' && value !== null
      ? JSON.stringify(style[key]) === JSON.stringify(value) : style[key] === value);
    result[key] = same ? value : null;
  }
  return result as NodeStyleCommon;
}

const EMPTY_STYLE = resolveNodeStyle({
  id: '', kind: 'process', parentId: null, layerId: '', zIndex: 0,
  transform: { translation: { x: 0, y: 0 }, rotationRadians: 0, scale: { x: 1, y: 1 } },
  size: { width: 0, height: 0 }, content: {}, appearance: {}, ports: [], metadata: {}, extensions: {},
});

interface NodeStylePanelsProps {
  readonly page: ScenePage;
  readonly nodeIds: readonly string[];
  readonly commit: (command: DocumentCommand) => void;
  readonly onPreview: (patch: JsonObject | null) => void;
  /** Sticky defaults: every committed patch is reported so new shapes inherit it. */
  readonly onCommitted: (patch: JsonObject) => void;
  /** Takes icons off the selection (model elements included). */
  readonly onRemoveIcons: () => void;
  readonly onSetIcon: (icon: IconChoice) => void;
}

type Panel = 'shape' | 'icon' | 'fill' | 'effects' | 'outline' | 'text' | 'ink' | 'chart' | 'widget';

/** Change shape offers what the Shapes picker draws: Rectangle, Ellipse, then the library. */
const CHANGE_SHAPES = SHAPE_SECTIONS.flatMap((section) => section.options)
  .map((option) => ({ ...option, id: option.id.replace('tool:', '') as ShapeKind }));

const FONT_SIZE_PRESETS = [{ value: 12, label: 'XS' }, { value: 14, label: 'S' }, { value: 18, label: 'M' }, { value: 24, label: 'L' }];
const PADDING_PRESETS = [{ value: 8, label: 'S' }, { value: 16, label: 'M' }, { value: 24, label: 'L' }];
const LINE_HEIGHT_PRESETS = [1, 1.25, 1.5, 2].map((value) => ({ value, label: String(value) }));
const LETTER_SPACING_PRESETS = [{ value: 0, label: '–', title: 'None' }, { value: 0.02, label: 'S' }, { value: 0.05, label: 'M' }, { value: 0.1, label: 'L' }];
const WIDTH_PRESETS = [1, 2, 3, 4].map((value) => ({
  value, label: <span className="ofk-width-glyph" style={{ height: value }} />, title: `${value}px`,
}));

function inkOptions(): { id: string; label: string; color: string }[] {
  return INK_PRESETS.map(({ key, hex }) => ({ id: hex, label: PALETTE_LABELS[key], color: hex }));
}

export function V2NodeStylePanels({ page, nodeIds, commit, onPreview, onCommitted, onRemoveIcons, onSetIcon }: NodeStylePanelsProps): React.JSX.Element | null {
  const [open, setOpen] = useState<Panel | null>(null);
  const nodes = page.nodes.filter((node) => nodeIds.includes(node.id));
  const { draft, preview, apply, clear } = useStyleDraft<JsonObject>(onPreview, (patch) => {
    const command = buildStyleNodesCommand(page, nodeIds, patch);
    if (command) commit(command);
    onCommitted(patch);
  });
  const common = commonNodeStyle(nodes);
  const [mode, setMode] = useState<PaletteMode>(() => paletteKeyForFill(common.fill)?.mode ?? 'pastel');
  // ⌘G groups are invisible: nothing to paint.
  if (!nodes.length || nodes.every((node) => node.kind === 'group')) return null;
  const view = (key: keyof NodeStyle) => (draft && key in draft ? draft[key] : common[key]);
  const isText = nodes.every((node) => node.kind === 'text');
  // Freeform strokes carry their ink in content, not appearance.
  const isStroke = nodes.every((node) => node.kind === 'pen' || node.kind === 'highlighter'
    || node.kind === 'line' || node.kind === 'arrow');
  const inkColor = typeof nodes[0]?.content.strokeColor === 'string'
    ? nodes[0].content.strokeColor : '#334155';
  const inkWidth = typeof nodes[0]?.content.strokeWidth === 'number'
    ? nodes[0].content.strokeWidth : 3;
  const isChart = nodes.every((node) => node.kind === 'chart');
  const chartKind = typeof nodes[0]?.content.chart === 'string'
    ? nodes[0]!.content.chart as ChartKind : 'bar';
  const chartOption = CHART_OPTIONS.find((option) => option.id === chartKind) ?? CHART_OPTIONS[0]!;
  const commitChart = (kind: ChartKind) => {
    const command = buildSetChartKindCommand(page, nodeIds, kind);
    if (command) commit(command);
  };
  const commitInk = (patch: { strokeColor?: string; strokeWidth?: number }) => {
    const command = buildSetInkCommand(page, nodeIds, patch);
    if (command) commit(command);
    onCommitted(patch);
  };
  // Containers carry a title band: vertical alignment and shadow do not apply.
  const isContainer = nodes.every((node) => isContainerNodeKind(node.kind));
  // Widgets draw fixed type and corners; only colour, font, width and opacity reach them.
  const isWidget = nodes.every((node) => node.kind === 'widget');
  // Picking an icon turns the node into an icon node, so only shapes offer it:
  // text, containers, ink, images and charts would lose what they are.
  const isImage = nodes.every((node) => node.kind === 'image');
  // One kind of widget selected: its state (on/off, value, selected item, variant).
  const widget = nodes.length > 0 && nodes.every((node) => node.kind === 'widget' && node.content.widget === nodes[0]!.content.widget)
    ? resolveWidgetPresentation(nodes[0]!) : null;
  const widgetState = widget ? WIDGETS[widget.widget].state : undefined;
  const commitWidget = (patch: WidgetStatePatch) => {
    const command = buildSetWidgetStateCommand(page, nodeIds, patch);
    if (command) commit(command);
  };
  // Change shape: every selected node is a basic shape (decisions and steps included; text, icons, frames are not).
  const shapes = nodes.map((node) => resolveBasicNodePresentation(node)?.shape);
  const canChangeShape = shapes.every((shape) => shape !== undefined);
  const shape = shapes.every((value) => value === shapes[0]) ? CHANGE_SHAPES.find((option) => option.id === shapes[0]) : undefined;
  const commitShape = (next: ShapeKind) => {
    const command = buildSetShapeCommand(page, nodeIds, next);
    if (command) commit(command);
    close();
  };
  const canPickIcon = !isText && !isContainer && !isStroke && !isChart && !isImage && !nodes.some((node) => node.kind === 'widget');
  const currentIcon = nodes.length === 1 ? resolveArchitectureNodePresentation(nodes[0])?.icon : undefined;
  const selectedIcon = currentIcon?.kind === 'provider' ? currentIcon : null;
  // Icon cards choose where the icon sits; a mixed selection has no single answer, so no option is checked.
  const cards = nodes.map((node) => resolveArchitectureNodePresentation(node)).filter((card) => card?.display === 'provider-icon');
  const iconCards = cards.length === nodes.length;
  const placement = iconCards && cards.every((card) => card!.iconPlacement === cards[0]!.iconPlacement) ? cards[0]!.iconPlacement : null;
  const commitPlacement = (next: IconCardPlacement) => {
    const command = buildSetIconPlacementCommand(page, nodeIds, next);
    if (command) commit(command);
  };
  const textColorIsAuto = nodes.every((node) => node.appearance.textColor === undefined || node.appearance.textColor === 'auto');
  const toggle = (panel: Panel) => { clear(); setOpen((current) => (current === panel ? null : panel)); };
  const close = () => { clear(); setOpen(null); };
  const opacity = view('opacity') as number | null;

  const fill = view('fill') as string | null;
  const stroke = view('stroke') as string | null;
  const textColor = view('textColor') as string | null;
  const paletteHit = paletteKeyForFill(fill);
  const fillOptions = [
    { id: 'transparent', label: 'No fill', color: 'transparent' },
    ...PALETTE_KEYS.map((key) => {
      const swatch = paletteSwatch(key, mode);
      return { id: key, label: PALETTE_LABELS[key], color: swatch.fill, border: swatch.stroke };
    }),
  ];
  const fontWeight = view('fontWeight') as number | null;
  const fontStyle = view('fontStyle') as string | null;
  const decoration = view('textDecoration') as string | null;

  return (
    <>
      {canChangeShape ? (
        <StyleButton label="Shape" open={open === 'shape'} onToggle={() => toggle('shape')} onClose={close}
          preview={<Icon icon={(shape ?? CHANGE_SHAPES[0]!).icon} />}>
          <ChoiceRow<ShapeKind> label="Shape" value={shape?.id ?? null} onChange={commitShape} layout="grid"
            options={CHANGE_SHAPES.map((option) => ({ value: option.id, title: option.label, label: <Icon icon={option.icon} /> }))} />
        </StyleButton>
      ) : null}
      {canPickIcon ? (
        <StyleButton label="Icon" open={open === 'icon'} onToggle={() => toggle('icon')} onClose={close} panelClassName="ofk-style-panel--icons"
          preview={selectedIcon ? <IconSwatch packId={selectedIcon.packId} shapeId={selectedIcon.shapeId} /> : <Icon icon={IconMoodSmile} />}>
          {iconCards ? (
            <div className="ofk-icon-layout">
              <ChoiceRow<IconCardPlacement> label="Layout" value={placement} onChange={commitPlacement}
                options={[
                  { value: 'top', title: 'Icon above', label: <><Icon icon={IconLayoutNavbar} /><span>Icon above</span></> },
                  { value: 'left', title: 'Icon left', label: <><Icon icon={IconLayoutSidebar} /><span>Icon left</span></> },
                ]} />
            </div>
          ) : null}
          <V2IconPicker selected={selectedIcon} onClose={close}
            {...(nodes.some(hasIcon) ? { onRemove: () => { onRemoveIcons(); close(); } } : {})}
            onPick={(icon) => { onSetIcon(icon); close(); }} />
        </StyleButton>
      ) : null}
      {isChart ? (
        <StyleButton label="Chart" panelTitle="Chart type" open={open === 'chart'} onToggle={() => toggle('chart')} onClose={close}
          preview={<Icon icon={chartOption.icon} />}>
          <ChoiceRow<ChartKind> label="Chart type" value={chartKind} onChange={commitChart} layout="grid"
            options={CHART_OPTIONS.map((option) => ({
              value: option.id,
              title: option.label,
              label: <><Icon icon={option.icon} /><span>{option.label.replace(/ (chart|plot)$/, '')}</span></>,
            }))} />
        </StyleButton>
      ) : null}
      {widget && widgetState ? (
        <StyleButton label="State" panelTitle={WIDGETS[widget.widget].name} open={open === 'widget'}
          onToggle={() => toggle('widget')} onClose={close} preview={<span className="ofk-style-state">{widgetStateSummary(widget)}</span>}>
          {widgetState === 'checked' ? (
            <PanelRow label="State">
              <Segmented<'on' | 'off'> label="State" value={widget.checked ? 'on' : 'off'}
                onChange={(value) => commitWidget({ checked: value === 'on' })}
                options={[{ value: 'off', label: 'Off' }, { value: 'on', label: 'On' }]} />
            </PanelRow>
          ) : null}
          {widgetState === 'value' ? (
            <PanelRow label="Value">
              <NumberField stepper="stacked" label="Value" hideLabel value={Math.round(widget.value * 100)}
                min={0} max={100} step={10} unit="%" onChange={ignoreDraft} onCommit={(value) => commitWidget({ value: value / 100 })} />
            </PanelRow>
          ) : null}
          {widgetState === 'active' && widget.widget === 'datepicker' ? (
            <PanelRow label="Day">
              <NumberField stepper="stacked" label="Selected day" hideLabel value={widget.active > 0 ? widget.active : null}
                min={0} max={30} step={1} onChange={ignoreDraft} onCommit={(value) => commitWidget({ active: value > 0 ? value : -1 })} />
            </PanelRow>
          ) : null}
          {widgetState === 'active' && widget.widget !== 'datepicker' ? (
            <PanelRow label="Selected">
              <ChoiceRow<number> label="Selected item" value={widget.active} layout="grid" onChange={(index) => commitWidget({ active: index })}
                options={[
                  { value: -1, label: 'None' },
                  ...widget.items.map((item, index) => ({ value: index, label: item })),
                ]} />
            </PanelRow>
          ) : null}
          {widgetState === 'variant' ? (
            <PanelRow label="Style">
              <ChoiceRow<string> label="Widget style" value={widget.variant ?? 'none'} layout="grid"
                onChange={(value) => commitWidget({ variant: value === 'none' ? null : value as WidgetStatePatch['variant'] })}
                options={widget.widget === 'button'
                  ? [{ value: 'none', label: 'Default' }, { value: 'primary', label: 'Primary' }]
                  : WIDGET_SEVERITIES.map((severity) => ({ value: severity, label: severity[0]!.toUpperCase() + severity.slice(1) }))} />
            </PanelRow>
          ) : null}
        </StyleButton>
      ) : null}
      {isStroke ? (
        <StyleButton label="Ink" open={open === 'ink'} onToggle={() => toggle('ink')} onClose={close}
          preview={<span className="ofk-style-line" style={{ borderTopColor: inkColor, borderTopWidth: Math.min(4, inkWidth) }} />}>
          <PanelRow label="Colour">
            <SwatchGrid label="Ink colour" options={inkOptions()} selected={inkColor}
              onPick={(id) => commitInk({ strokeColor: id })} />
          </PanelRow>
          <PanelRow label="Width">
            <ChoiceRow label="Ink width" value={inkWidth}
              options={[1, 2, 3, 4, 6, 8, 12, 16].map((value) => ({
                value, label: <span className="ofk-width-glyph" style={{ height: Math.min(6, value) }} />,
                title: `${value}px`,
              }))}
              onChange={(value) => commitInk({ strokeWidth: value })} />
          </PanelRow>
        </StyleButton>
      ) : null}
      {isStroke || isChart ? null : (
      <StyleButton label={isText ? 'Background' : 'Fill'} open={open === 'fill'} onToggle={() => toggle('fill')} onClose={close}
        preview={<span className="ofk-style-swatch" data-mixed={fill === null || undefined} data-transparent={fill === 'transparent' || undefined}
          style={fill && fill !== 'transparent' ? { background: fill, borderColor: stroke ?? fill } : undefined} />}>
        <PanelRow label="Style">
          <Segmented<PaletteMode> label="Palette mode" value={mode} onChange={setMode}
            options={[{ value: 'pastel', label: 'Pastel' }, { value: 'solid', label: 'Solid' }]} />
        </PanelRow>
        <PanelRow label="Color">
          <SwatchGrid label="Fill colour" options={fillOptions}
            selected={fill === 'transparent' ? 'transparent' : paletteHit?.mode === mode ? paletteHit.key : null}
            onPick={(id) => apply(paletteFillPatch(id as Parameters<typeof paletteFillPatch>[0], mode))}
            trailing={<CustomColorSwatch value={fill} onChange={(hex) => preview({ fill: hex })} onCommit={(hex) => apply({ fill: hex })} />} />
        </PanelRow>
        {isWidget ? null : (
          <PanelRow label="Corners">
            <NumberField stepper="stacked" label="Corner radius" hideLabel value={view('cornerRadius') as number | null}
              min={STYLE_LIMITS.cornerRadius.min} max={STYLE_LIMITS.cornerRadius.max} step={2} unit="px"
              onChange={(value) => preview({ cornerRadius: value })} onCommit={(value) => apply({ cornerRadius: value })} />
          </PanelRow>
        )}
        <PanelRow label="Opacity">
          <NumberField stepper="stacked" label="Opacity" hideLabel value={opacity === null ? null : Math.round(opacity * 100)}
            min={0} max={100} step={10} unit="%"
            onChange={(value) => preview({ opacity: value / 100 })} onCommit={(value) => apply({ opacity: value / 100 })} />
        </PanelRow>
      </StyleButton>
      )}
      {isStroke || isChart || isContainer || isWidget ? null : (
      <StyleButton label="Effects" open={open === 'effects'} onToggle={() => toggle('effects')} onClose={close}
        preview={<Icon icon={IconShadow} />}>
        <V2NodeEffects nodes={nodes} draft={draft} preview={preview} apply={apply} />
      </StyleButton>
      )}

      {isStroke || isChart ? null : (
      <StyleButton label="Outline" open={open === 'outline'} onToggle={() => toggle('outline')} onClose={close}
        preview={<span className="ofk-style-swatch ofk-style-swatch--ring" data-mixed={stroke === null || undefined}
          data-transparent={(stroke === 'transparent' || view('strokeWidth') === 0) || undefined}
          style={stroke && stroke !== 'transparent' ? { borderColor: stroke } : undefined} />}>
        <PanelRow label="Color">
          <SwatchGrid label="Outline colour"
            options={[{ id: 'transparent', label: 'No outline', color: 'transparent' },
              { id: '#ffffff', label: 'White', color: '#ffffff', border: '#cbd5e1' }, ...inkOptions()]}
            selected={stroke} onPick={(id) => apply({ stroke: id })}
            trailing={<CustomColorSwatch value={stroke} onChange={(hex) => preview({ stroke: hex })} onCommit={(hex) => apply({ stroke: hex })} />} />
        </PanelRow>
        <PanelRow label="Width">
          <ChoiceRow label="Width preset" value={view('strokeWidth') as number | null} options={WIDTH_PRESETS}
            onChange={(value) => apply({ strokeWidth: value })} />
          <NumberField stepper="stacked" label="Outline width" hideLabel value={view('strokeWidth') as number | null}
            min={STYLE_LIMITS.strokeWidth.min} max={STYLE_LIMITS.strokeWidth.max} step={0.5} unit="px"
            onChange={(value) => preview({ strokeWidth: value })} onCommit={(value) => apply({ strokeWidth: value })} />
        </PanelRow>
        {isWidget ? null : (
          <PanelRow label="Style">
            <Segmented<'solid' | 'dashed' | 'dotted' | ''> label="Outline style" value={(view('strokeStyle') as 'solid' | 'dashed' | 'dotted' | null) ?? ''}
              onChange={(value) => { if (value) apply({ strokeStyle: value }); }}
              options={[{ value: 'solid', label: '—' }, { value: 'dashed', label: '- -' }, { value: 'dotted', label: '···' }]} />
          </PanelRow>
        )}
      </StyleButton>
      )}

      {isStroke || isChart ? null : (
      <StyleButton label="Text" open={open === 'text'} onToggle={() => toggle('text')} onClose={close} panelClassName="ofk-style-panel--wide"
        preview={<span className="ofk-style-glyph" style={{ textDecorationColor: textColor ?? undefined }}>A</span>}>
        {isContainer ? (
          <PanelRow label="Header">
            <Segmented<'shown' | 'hidden'> label="Header" value={nodes.every((node) => node.content.showHeader !== false) ? 'shown' : 'hidden'}
              onChange={(value) => { const command = buildSetHeaderCommand(page, nodeIds, value === 'shown'); if (command) commit(command); }}
              options={[{ value: 'shown', label: 'Shown' }, { value: 'hidden', label: 'Hidden' }]} />
          </PanelRow>
        ) : null}
        <PanelRow label="Color">
          <SwatchGrid label="Text colour" options={[{ id: 'auto', label: 'Auto', color: 'currentColor' },
            { id: '#ffffff', label: 'White', color: '#ffffff', border: '#cbd5e1' },
            { id: '#64748b', label: 'Mid gray', color: '#64748b' }, ...inkOptions()]}
            selected={textColorIsAuto ? 'auto' : textColor} onPick={(id) => apply({ textColor: id })}
            trailing={<CustomColorSwatch value={textColor} onChange={(hex) => preview({ textColor: hex })} onCommit={(hex) => apply({ textColor: hex })} />} />
        </PanelRow>
        <PanelRow label="Font">
          <FontPicker value={view('fontFamily') as NodeStyle['fontFamily'] | null}
            onChange={(fontFamily) => apply({ fontFamily })} />
        </PanelRow>
        {isWidget ? null : (<>
          <PanelRow label="Size">
            <ChoiceRow label="Size preset" value={view('fontSize') as number | null} options={FONT_SIZE_PRESETS}
              onChange={(value) => apply({ fontSize: value })} />
            <NumberField stepper="stacked" label="Font size" hideLabel value={view('fontSize') as number | null}
              min={STYLE_LIMITS.fontSize.min} max={STYLE_LIMITS.fontSize.max} step={1} unit="px"
              onChange={(value) => preview({ fontSize: value })} onCommit={(value) => apply({ fontSize: value })} />
          </PanelRow>
          <PanelRow label="Style">
            <ToggleRow label="Text style" onToggle={(id) => {
              if (id === 'bold') apply({ fontWeight: fontWeight === 700 ? 400 : 700 });
              else if (id === 'italic') apply({ fontStyle: fontStyle === 'italic' ? 'normal' : 'italic' });
              else if (id === 'underline') apply({ textDecoration: decoration === 'underline' ? 'none' : 'underline' });
              else apply({ textDecoration: decoration === 'line-through' ? 'none' : 'line-through' });
            }} options={[
              { id: 'bold', label: 'Bold', icon: <Icon icon={IconBold} />, on: fontWeight === 700, shortcut: platformKeys('⌘B') },
              { id: 'italic', label: 'Italic', icon: <Icon icon={IconItalic} />, on: fontStyle === 'italic', shortcut: platformKeys('⌘I') },
              { id: 'underline', label: 'Underline', icon: <Icon icon={IconUnderline} />, on: decoration === 'underline', shortcut: platformKeys('⌘U') },
              { id: 'strike', label: 'Strikethrough', icon: <Icon icon={IconStrikethrough} />, on: decoration === 'line-through' },
            ]} />
          </PanelRow>
          <PanelRow label="Align">
            <ChoiceRow<NodeStyle['textAlign']> label="Horizontal align" value={view('textAlign') as NodeStyle['textAlign'] | null}
              onChange={(value) => apply({ textAlign: value })} options={[
                { value: 'start', label: <Icon icon={IconAlignLeft} />, title: 'Left' },
                { value: 'center', label: <Icon icon={IconAlignCenter} />, title: 'Centre' },
                { value: 'end', label: <Icon icon={IconAlignRight} />, title: 'Right' },
              ]} />
            {isContainer ? null : (
              <ChoiceRow<NodeStyle['textVerticalAlign']> label="Vertical align" value={view('textVerticalAlign') as NodeStyle['textVerticalAlign'] | null}
                onChange={(value) => apply({ textVerticalAlign: value })} options={[
                  { value: 'top', label: <Icon icon={IconArrowBarToUp} />, title: 'Top' },
                  { value: 'middle', label: <Icon icon={IconArrowsVertical} />, title: 'Middle' },
                  { value: 'bottom', label: <Icon icon={IconArrowBarToDown} />, title: 'Bottom' },
                ]} />
            )}
          </PanelRow>
          <details className="ofk-style-more">
            <summary className="ofk-caption">Spacing<Icon icon={IconChevronDown} /></summary>
            <PanelRow label="Padding">
              <ChoiceRow label="Padding" value={view('textPadding') as number | null} options={PADDING_PRESETS}
                onChange={(value) => apply({ textPadding: value })} />
            </PanelRow>
            <PanelRow label="Line height">
              <ChoiceRow label="Line height" value={view('lineHeight') as number | null} options={LINE_HEIGHT_PRESETS}
                onChange={(value) => apply({ lineHeight: value })} />
            </PanelRow>
            <PanelRow label="Letter spacing">
              <ChoiceRow label="Letter spacing" value={view('letterSpacing') as number | null} options={LETTER_SPACING_PRESETS}
                onChange={(value) => apply({ letterSpacing: value })} />
            </PanelRow>
          </details>
        </>)}
      </StyleButton>
      )}
    </>
  );
}

/** The selected node's icon, drawn in the bar button. */
function IconSwatch({ packId, shapeId }: { readonly packId: string; readonly shapeId: string }): React.JSX.Element {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    void loadProviderShapePreview(packId, shapeId).then((preview) => { if (alive) setUrl(preview?.previewUrl ?? null); });
    return () => { alive = false; };
  }, [packId, shapeId]);
  return url ? <img className="ofk-style-icon-swatch" src={url} alt="" /> : <Icon icon={IconMoodSmile} />;
}

/** Widget state is content, not a style draft: it commits once, on Enter or blur. */
const ignoreDraft = (): void => undefined;

/** The State button's face: what the widget is set to, in one word. */
function widgetStateSummary(widget: NonNullable<ReturnType<typeof resolveWidgetPresentation>>): string {
  const state = WIDGETS[widget.widget].state;
  if (state === 'checked') return widget.checked ? 'On' : 'Off';
  if (state === 'value') return `${Math.round(widget.value * 100)}%`;
  if (state === 'variant') return widget.variant ? widget.variant[0]!.toUpperCase() + widget.variant.slice(1) : 'Default';
  if (widget.widget === 'datepicker') return widget.active > 0 ? String(widget.active) : '–';
  return widget.items[widget.active] ?? 'None';
}
