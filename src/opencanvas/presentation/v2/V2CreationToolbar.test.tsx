import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { V2CreationToolbar } from './V2CreationToolbar';
import { DEFAULT_TOOL_CONFIG } from './v2ToolCatalog';

// jsdom has no ResizeObserver; the flyout popover places itself with one.
vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });

const toolbar = (onPlaceShape = vi.fn(), onToolChange = vi.fn()) => {
  render(<V2CreationToolbar tool="select" toolConfig={DEFAULT_TOOL_CONFIG} onToolChange={onToolChange} onPickShape={vi.fn()}
    onPlaceShape={onPlaceShape} onPickConnector={vi.fn()} onInsertIcon={vi.fn()} iconsOpen={false} onIconsOpenChange={vi.fn()}
    onPickEmoji={vi.fn()} recentEmoji={[]} librarySection="icons" onInsertImage={vi.fn()} moreOpen={false}
    onMoreOpenChange={vi.fn()} onPickMore={vi.fn()} />);
  fireEvent.click(screen.getByRole('button', { name: 'Shapes options' }));
  return { onPlaceShape, onToolChange };
};

describe('V2CreationToolbar Shapes', () => {
  it('Enter on a cell places that shape (the keyboard has no canvas to click)', () => {
    const { onPlaceShape, onToolChange } = toolbar();
    fireEvent.click(screen.getByRole('option', { name: 'Rectangle' }), { detail: 0 });
    expect(onToolChange).toHaveBeenCalledWith('rectangle');
    expect(onPlaceShape).toHaveBeenCalledWith('rectangle', false);
  });

  it('Enter on Square arms Square and places a 1:1 rectangle', () => {
    const { onPlaceShape, onToolChange } = toolbar();
    fireEvent.click(screen.getByRole('option', { name: 'Square' }), { detail: 0 });
    expect(onToolChange).toHaveBeenCalledWith('square');
    expect(onPlaceShape).toHaveBeenCalledWith('rectangle', true);
  });

  it('a pointer click only arms the tool', () => {
    const { onPlaceShape } = toolbar();
    fireEvent.click(screen.getByRole('option', { name: 'Ellipse' }), { detail: 1 });
    expect(onPlaceShape).not.toHaveBeenCalled();
  });

  it('one click on a tool button arms its last-used variant; the corner opens the grid (U1-05)', () => {
    const onToolChange = vi.fn();
    const bar = (tool: 'select' | 'ellipse') => <V2CreationToolbar tool={tool} toolConfig={DEFAULT_TOOL_CONFIG} onToolChange={onToolChange} onPickShape={vi.fn()}
      onPlaceShape={vi.fn()} onPickConnector={vi.fn()} onInsertIcon={vi.fn()} iconsOpen={false} onIconsOpenChange={vi.fn()}
      onPickEmoji={vi.fn()} recentEmoji={[]} librarySection="icons" onInsertImage={vi.fn()} moreOpen={false}
      onMoreOpenChange={vi.fn()} onPickMore={vi.fn()} />;
    const { rerender } = render(bar('select'));
    const shapes = screen.getByRole('button', { name: 'Shapes', exact: true } as never);
    expect(shapes).not.toHaveAttribute('aria-haspopup');
    fireEvent.click(shapes);
    // Square is the rail's first pick until another shape is used.
    expect(onToolChange).toHaveBeenLastCalledWith('square');
    expect(screen.queryByRole('option')).toBeNull();
    rerender(bar('ellipse'));
    rerender(bar('select'));
    fireEvent.click(shapes);
    expect(onToolChange).toHaveBeenLastCalledWith('ellipse');
    fireEvent.click(screen.getByRole('button', { name: 'Connector' }));
    expect(onToolChange).toHaveBeenLastCalledWith('connector');
    expect(screen.getByRole('button', { name: 'Connector options' })).toHaveAttribute('aria-expanded', 'false');
    fireEvent.click(screen.getByRole('button', { name: 'Connector options' }));
    expect(screen.getByRole('option', { name: 'Curve' })).toBeTruthy();
  });

  // Review 2026-10-11: after H, the arrow-icon Pointer button re-armed Hand: a click armed something the rail never showed.
  it('each tool button shows the variant a click will arm', () => {
    const bar = (tool: 'select' | 'hand' | 'eraser') => <V2CreationToolbar tool={tool} toolConfig={{ ...DEFAULT_TOOL_CONFIG, connector: 'curve' }} onToolChange={vi.fn()} onPickShape={vi.fn()}
      onPlaceShape={vi.fn()} onPickConnector={vi.fn()} onInsertIcon={vi.fn()} iconsOpen={false} onIconsOpenChange={vi.fn()}
      onPickEmoji={vi.fn()} recentEmoji={[]} librarySection="icons" onInsertImage={vi.fn()} moreOpen={false}
      onMoreOpenChange={vi.fn()} onPickMore={vi.fn()} />;
    const { rerender } = render(bar('select'));
    const icon = (name: string) => screen.getByRole('button', { name, exact: true } as never).querySelector('svg')!.getAttribute('class');
    expect(icon('Select')).toContain('tabler-icon-pointer');
    rerender(bar('hand'));
    expect(icon('Select')).toContain('tabler-icon-hand-stop');
    rerender(bar('eraser'));
    expect(icon('Draw')).toContain('tabler-icon-eraser');
    expect(icon('Connector')).toContain('tabler-icon-arrow-curve-left');
  });

  // Review 2026-10-11: ArrowDown on the rail stopped on four invisible "… options" strips between the tools.
  it('arrow keys move tool to tool, past the corner buttons, which are no tab stop', () => {
    render(<V2CreationToolbar tool="select" toolConfig={DEFAULT_TOOL_CONFIG} onToolChange={vi.fn()} onPickShape={vi.fn()}
      onPlaceShape={vi.fn()} onPickConnector={vi.fn()} onInsertIcon={vi.fn()} iconsOpen={false} onIconsOpenChange={vi.fn()}
      onPickEmoji={vi.fn()} recentEmoji={[]} librarySection="icons" onInsertImage={vi.fn()} moreOpen={false}
      onMoreOpenChange={vi.fn()} onPickMore={vi.fn()} />);
    const named = (name: string) => screen.getByRole('button', { name, exact: true } as never);
    named('Select').focus();
    fireEvent.keyDown(named('Select'), { key: 'ArrowDown' });
    expect(named('Shapes')).toHaveFocus();
    fireEvent.keyDown(named('Shapes'), { key: 'ArrowDown' });
    expect(named('Connector')).toHaveFocus();
    fireEvent.keyDown(named('Connector'), { key: 'ArrowUp' });
    expect(named('Shapes')).toHaveFocus();
    expect(named('Shapes options')).toHaveAttribute('tabindex', '-1');
  });
});

describe('V2CreationToolbar Select', () => {
  it('lays Select, Hand and Comment out in one row', () => {
    const bar = (tool: 'select' | 'comment') => <V2CreationToolbar tool={tool} toolConfig={DEFAULT_TOOL_CONFIG} onToolChange={vi.fn()} onPickShape={vi.fn()}
      onPlaceShape={vi.fn()} onPickConnector={vi.fn()} onInsertIcon={vi.fn()} iconsOpen={false} onIconsOpenChange={vi.fn()}
      onPickEmoji={vi.fn()} recentEmoji={[]} librarySection="icons" onInsertImage={vi.fn()} moreOpen={false}
      onMoreOpenChange={vi.fn()} onPickMore={vi.fn()} />;
    render(bar('comment'));
    fireEvent.click(screen.getByRole('button', { name: 'Select options' }));
    const cells = screen.getAllByRole('option');
    expect(cells.map((cell) => cell.getAttribute('aria-label'))).toEqual(['Select', 'Hand', 'Comment']);
    expect(cells[0]!.closest('.ofk-v2-flyout-grid')!.getAttribute('style')).toContain('repeat(3, 1fr)');
  });
});
