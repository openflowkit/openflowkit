import { describe, expect, it } from 'vitest';
import type { ScenePage } from '../document/types';
import { resolveNodeStyle } from './nodeStyle';
import { createWidgetNode } from './widgetNode';
import { createPresetFrame } from './framePreset';
import {
  WIDGET_KINDS,
  WIDGETS,
  describeWidget,
  estimateTextWidth,
  resolveWidgetInks,
  resolveWidgetPresentation,
  widgetBackdrop,
  widgetItems,
  widgetLabelBox,
  wrapText,
  type WidgetPrimitive,
} from './widgetNodePresentation';

const page: ScenePage = {
  id: 'p', name: 'p', diagramKind: 'flowchart',
  layers: [{ id: 'default', name: 'Layer 1', visible: true, locked: false }],
  nodes: [], connectors: [], metadata: {}, extensions: {},
};

function bounds(primitive: WidgetPrimitive): { x0: number; y0: number; x1: number; y1: number } {
  if (primitive.kind === 'rect') return { x0: primitive.x, y0: primitive.y, x1: primitive.x + primitive.width, y1: primitive.y + primitive.height };
  if (primitive.kind === 'circle') return { x0: primitive.x - primitive.radius, y0: primitive.y - primitive.radius, x1: primitive.x + primitive.radius, y1: primitive.y + primitive.radius };
  if (primitive.kind === 'text') return { x0: primitive.x, y0: primitive.y, x1: primitive.x, y1: primitive.y };
  const xs = primitive.points.map((point) => point.x);
  const ys = primitive.points.map((point) => point.y);
  return { x0: Math.min(...xs), y0: Math.min(...ys), x1: Math.max(...xs), y1: Math.max(...ys) };
}

describe('widget presentation', () => {
  it.each(WIDGET_KINDS)('%s draws finite marks inside its box at the default size', (widget) => {
    const node = createWidgetNode(page, { id: 'w', widget, at: { x: 0, y: 0 } });
    const presentation = resolveWidgetPresentation(node)!;
    expect(presentation.widget).toBe(widget);
    expect(presentation.primitives.length).toBeGreaterThan(0);
    for (const primitive of presentation.primitives) {
      const box = bounds(primitive);
      for (const value of Object.values(box)) expect(Number.isFinite(value)).toBe(true);
      // One unit of slack for stroke centres on the edge.
      expect(box.x0).toBeGreaterThanOrEqual(-1);
      expect(box.y0).toBeGreaterThanOrEqual(-1);
      expect(box.x1).toBeLessThanOrEqual(node.size.width + 1);
      expect(box.y1).toBeLessThanOrEqual(node.size.height + 1);
    }
  });

  it.each(WIDGET_KINDS)('%s survives a tiny box and an empty label', (widget) => {
    const node = createWidgetNode(page, { id: 'w', widget, at: { x: 0, y: 0 }, size: { width: 4, height: 4 }, label: '' });
    for (const primitive of resolveWidgetPresentation(node)!.primitives) {
      for (const value of Object.values(bounds(primitive))) expect(Number.isFinite(value)).toBe(true);
    }
  });

  it('ignores nodes that are not widgets, and unknown widget names', () => {
    expect(resolveWidgetPresentation({ ...createWidgetNode(page, { id: 'w', widget: 'button', at: { x: 0, y: 0 } }), kind: 'process' })).toBeNull();
    const node = createWidgetNode(page, { id: 'w', widget: 'button', at: { x: 0, y: 0 } });
    expect(resolveWidgetPresentation({ ...node, content: { ...node.content, widget: 'hologram' } })).toBeNull();
  });

  it('reads state and clamps it', () => {
    const toggle = createWidgetNode(page, { id: 'w', widget: 'toggle', at: { x: 0, y: 0 }, checked: false });
    expect(resolveWidgetPresentation(toggle)!.checked).toBe(false);
    const slider = createWidgetNode(page, { id: 'w', widget: 'slider', at: { x: 0, y: 0 }, value: 7 });
    expect(resolveWidgetPresentation(slider)!.value).toBe(1);
    const bogus = { ...slider, content: { ...slider.content, value: 'lots', variant: 'loud', active: 1.5 } };
    expect(resolveWidgetPresentation(bogus)).toMatchObject({ value: 0, variant: null, active: -1 });
  });

  it('draws the on and off toggle differently: the knob moves', () => {
    const knob = (checked: boolean) => resolveWidgetPresentation(createWidgetNode(page, { id: 'w', widget: 'toggle', at: { x: 0, y: 0 }, checked }))!
      .primitives.find((primitive) => primitive.kind === 'circle') as Extract<WidgetPrimitive, { kind: 'circle' }>;
    expect(knob(true).x).toBeGreaterThan(knob(false).x);
  });

  it('marks the active tab and the checked box', () => {
    const tabs = resolveWidgetPresentation(createWidgetNode(page, { id: 'w', widget: 'tabs', at: { x: 0, y: 0 }, active: 2 }))!;
    const bold = tabs.primitives.filter((primitive) => primitive.kind === 'text' && primitive.weight === 600);
    expect(bold).toEqual([expect.objectContaining({ text: 'Settings' })]);
    const checkbox = resolveWidgetPresentation(createWidgetNode(page, { id: 'w', widget: 'checkbox', at: { x: 0, y: 0 }, checked: true }))!;
    expect(checkbox.primitives.some((primitive) => primitive.kind === 'rect' && primitive.fill === 'accent')).toBe(true);
  });

  it('a primary button fills with the accent; a severity tints an alert', () => {
    const primary = resolveWidgetPresentation(createWidgetNode(page, { id: 'w', widget: 'button', at: { x: 0, y: 0 }, variant: 'primary' }))!;
    expect(primary.primitives[0]).toMatchObject({ kind: 'rect', fill: 'accent' });
    const error = resolveWidgetPresentation(createWidgetNode(page, { id: 'w', widget: 'alert', at: { x: 0, y: 0 }, variant: 'error' }))!;
    expect(error.primitives[1]).toMatchObject({ stroke: 'error' });
  });

  it('fills as many rating stars as the value says', () => {
    const rating = resolveWidgetPresentation(createWidgetNode(page, { id: 'w', widget: 'rating', at: { x: 0, y: 0 }, value: 0.6 }))!;
    expect(rating.primitives.filter((primitive) => primitive.kind === 'path' && primitive.fill === 'warning')).toHaveLength(3);
  });

  it('every widget has a spec with a name and a positive default size', () => {
    for (const widget of WIDGET_KINDS) {
      expect(WIDGETS[widget].name).toBeTruthy();
      expect(WIDGETS[widget].size.width).toBeGreaterThan(0);
      expect(WIDGETS[widget].size.height).toBeGreaterThan(0);
    }
  });

  it('names a widget for screen readers with its state', () => {
    const toggle = resolveWidgetPresentation(createWidgetNode(page, { id: 'w', widget: 'toggle', at: { x: 0, y: 0 }, label: 'Dark mode' }))!;
    expect(describeWidget(toggle)).toBe("Wireframe toggle 'Dark mode', on");
    const tabs = resolveWidgetPresentation(createWidgetNode(page, { id: 'w', widget: 'tabs', at: { x: 0, y: 0 }, active: 1 }))!;
    expect(describeWidget(tabs)).toBe("Wireframe tabs 'Overview | Reports | Settings', Reports selected");
  });
});

describe('widget label box', () => {
  it.each(WIDGET_KINDS.filter((widget) => !WIDGETS[widget].items && WIDGETS[widget].label))(
    '%s opens its editor where it draws its label', (widget) => {
      const node = createWidgetNode(page, { id: 'w', widget, at: { x: 0, y: 0 } });
      const box = widgetLabelBox(node)!;
      const x = box.align === 'center' ? box.x + box.width / 2 : box.x;
      const drawn = resolveWidgetPresentation(node)!.primitives.filter((primitive) => primitive.kind === 'text');
      expect(drawn.some((primitive) => Math.abs(primitive.x - x) < 1 && primitive.y >= box.y && primitive.y <= box.y + box.height)).toBe(true);
      expect(box.x + box.width).toBeLessThanOrEqual(node.size.width + 1);
      expect(box.y + box.height).toBeLessThanOrEqual(node.size.height + 1);
    });

  it('is null for widgets that draw no label, so the editor stays shut', () => {
    for (const widget of ['image', 'avatar', 'divider', 'progress', 'rating', 'fab'] as const) {
      expect(widgetLabelBox(createWidgetNode(page, { id: 'w', widget, at: { x: 0, y: 0 } }))).toBeNull();
    }
    expect(widgetLabelBox(createWidgetNode(page, { id: 'w', widget: 'tabs', at: { x: 0, y: 0 } }))).toMatchObject({ x: 0, y: 0, align: 'center' });
  });
});

describe('widget text helpers', () => {
  it('splits items on pipes and drops blanks', () => {
    expect(widgetItems(' Home | | About|Contact ')).toEqual(['Home', 'About', 'Contact']);
    expect(widgetItems('')).toEqual([]);
  });

  it('wraps words and ellipsises what does not fit', () => {
    expect(wrapText('one two three', 1000, 13, 3)).toEqual(['one two three']);
    const lines = wrapText('alpha beta gamma delta epsilon zeta', 60, 13, 2);
    expect(lines).toHaveLength(2);
    expect(lines[1]!.endsWith('…')).toBe(true);
    expect(wrapText('', 60, 13, 2)).toEqual([]);
  });
});

describe('widget inks', () => {
  it('canvas text follows the canvas; text in the fill follows the fill', () => {
    const node = createWidgetNode(page, { id: 'w', widget: 'input', at: { x: 0, y: 0 } });
    const dark = resolveWidgetInks(node, resolveNodeStyle(node, '#111111'), '#111111');
    expect(dark.ink.color).toBe('#ffffff');
    expect(dark.text.color).not.toBe('#ffffff');
    const light = resolveWidgetInks(node, resolveNodeStyle(node, '#f7f7f5'), '#f7f7f5');
    expect(light.ink.color).not.toBe('#ffffff');
  });
});

describe('widget backdrop', () => {
  it('is the nearest opaque frame, so text in a white phone stays dark on a dark canvas', () => {
    const phone = createPresetFrame(page, { id: 'phone', preset: 'phone', at: { x: 0, y: 0 } });
    const heading = createWidgetNode(page, { id: 'h', widget: 'heading', at: { x: 0, y: 0 }, parentId: 'phone' });
    const lookup = (id: string) => (id === 'phone' ? phone : undefined);
    expect(widgetBackdrop(heading, lookup, '#111111')).toBe('#ffffff');
    const inks = resolveWidgetInks(heading, resolveNodeStyle(heading, '#111111'), widgetBackdrop(heading, lookup, '#111111'));
    expect(inks.ink.color).not.toBe('#ffffff');
    // Loose on the canvas, or in a see-through frame: the canvas.
    expect(widgetBackdrop({ ...heading, parentId: null }, lookup, '#111111')).toBe('#111111');
    const clear = { ...phone, appearance: { ...phone.appearance, fill: 'transparent' } };
    expect(widgetBackdrop(heading, () => clear, '#111111')).toBe('#111111');
    // A frame coloured with the custom picker (#rrggbbff) is still the opaque backdrop.
    const picked = { ...phone, appearance: { ...phone.appearance, fill: '#ffffffff' } };
    expect(widgetBackdrop(heading, () => picked, '#111111')).toBe('#ffffffff');
  });
});

describe('text width estimate', () => {
  it('ranks narrow, average and wide text in the right order', () => {
    expect(estimateTextWidth('iiii', 13)).toBeLessThan(estimateTextWidth('aaaa', 13));
    expect(estimateTextWidth('aaaa', 13)).toBeLessThan(estimateTextWidth('MMMM', 13));
    expect(estimateTextWidth('', 13)).toBe(0);
  });
});

