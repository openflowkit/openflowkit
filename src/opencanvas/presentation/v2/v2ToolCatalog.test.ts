import { describe, expect, it } from 'vitest';
import {
  CHART_OPTIONS, CONNECTOR_OPTIONS, CONNECTOR_ROUTE, DRAW_OPTIONS, INSERT_SECTIONS, POINTER_OPTIONS, SHAPE_OPTIONS,
  SHAPE_SECTIONS,
} from './v2ToolCatalog';
import { LIBRARY_SHAPES } from '../../domain/nodes/shapeNode';
import { FRAME_PRESETS } from '../../domain/nodes/framePreset';
import { WIDGET_KINDS } from '../../domain/nodes/widgetNodePresentation';

describe('v2 tool catalog', () => {
  it('offers the 19 diagram shapes once, all from the library, nothing the R/O tools already draw', () => {
    const ids = SHAPE_OPTIONS.map((option) => option.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toHaveLength(19);
    expect(ids.every((id) => (LIBRARY_SHAPES as readonly string[]).includes(id))).toBe(true);
    expect(ids).not.toContain('rectangle');
    expect(ids).not.toContain('ellipse');
    // Cut from the picker on 2026-10-06 (owner): 3D, icon-like and bracket shapes still draw, just aren't offered.
    for (const gone of ['cube', 'prism', 'layer-stack', 'heart', 'pin', 'actor', 'brace', 'arrow-up']) expect(ids).not.toContain(gone);
  });

  it('Basic lists Square first, then Rectangle (R) and Ellipse (O); Square has no key', () => {
    const basic = SHAPE_SECTIONS[0]!.options;
    expect(basic.map((option) => [option.id, option.label, option.shortcut])).toEqual([
      ['tool:square', 'Square', undefined], ['tool:rectangle', 'Rectangle', 'R'], ['tool:ellipse', 'Ellipse', 'O'],
    ]);
  });

  it('maps connector picks onto routes', () => {
    expect(CONNECTOR_OPTIONS.map((option) => option.id)).toEqual(['arrow', 'elbow', 'curve']);
    expect(CONNECTOR_ROUTE.arrow).toBe('direct');
    expect(CONNECTOR_ROUTE.elbow).toBe('orthogonal');
    expect(CONNECTOR_ROUTE.curve).toBe('bezier');
  });

  it('Insert offers the common frames, widgets and charts, the sticky note and an upload, each once', () => {
    const ids = INSERT_SECTIONS.flatMap((section) => section.options.map((option) => option.id));
    expect(new Set(ids).size).toBe(ids.length);
    const of = (group: string) => ids.filter((id) => id.startsWith(`${group}:`)).map((id) => id.slice(group.length + 1));
    expect(of('frame').every((id) => (FRAME_PRESETS as readonly string[]).includes(id))).toBe(true);
    expect(of('widget').every((id) => (WIDGET_KINDS as readonly string[]).includes(id))).toBe(true);
    expect(of('chart').every((id) => CHART_OPTIONS.some((option) => option.id === id))).toBe(true);
    // Cut from Insert on 2026-10-06 (owner): they still draw from code and old files.
    for (const gone of ['frame:window', 'chart:radar', 'chart:heatmap', 'chart:area', 'chart:scatter', 'chart:donut',
      'widget:stepper', 'widget:rating', 'widget:datepicker', 'widget:statusbar', 'widget:fab', 'widget:slider', 'widget:badge']) expect(ids).not.toContain(gone);
    // The chart style bar still switches between every kind.
    expect(CHART_OPTIONS).toHaveLength(10);
    expect(of('insert')).toEqual(['image', 'sticky']);
    // A cell's name is how people and tests find it: no two cells share one.
    const names = INSERT_SECTIONS.flatMap((section) => section.options.map((option) => option.label));
    expect(new Set(names).size).toBe(names.length);
  });

  it('keeps every tool the old 12-button rail had, behind the 7 new ones', () => {
    const tools = [...POINTER_OPTIONS, ...DRAW_OPTIONS].map((option) => option.id);
    expect(tools.sort()).toEqual(['comment', 'eraser', 'hand', 'highlighter', 'laser', 'pen', 'select']);
    const shapes = SHAPE_SECTIONS.flatMap((section) => section.options.map((option) => option.id));
    expect(shapes).toEqual(['tool:square', 'tool:rectangle', 'tool:ellipse', ...SHAPE_OPTIONS.map((option) => option.id)]);
  });
});
