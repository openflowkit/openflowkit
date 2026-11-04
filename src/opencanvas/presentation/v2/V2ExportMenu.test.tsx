import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { compile } from '../../../dsl/compile';
import { createTestDocument } from '../../testing/builders/documentBuilder';
import { addThread } from '../../domain/threads/threads';
import { V2ExportMenu } from './V2ExportMenu';

// jsdom has no ResizeObserver; the popover places itself with one.
vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });

const toMermaid = vi.hoisted(() => ({ fail: null as Error | null }));
vi.mock('../../../dsl/mermaid/toMermaid', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../dsl/mermaid/toMermaid')>();
  return { ...actual, diagramToMermaid: (...args: Parameters<typeof actual.diagramToMermaid>) => {
    if (toMermaid.fail) throw toMermaid.fail;
    return actual.diagramToMermaid(...args);
  } };
});

const exporter = vi.hoisted(() => ({ download: vi.fn() }));
vi.mock('./v2Export', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./v2Export')>();
  // JSON is built for real (its text is what the option changes); the image formats need a canvas jsdom has not got.
  return { ...actual, downloadV2Export: exporter.download,
    buildV2Export: async (request: Parameters<typeof actual.buildV2Export>[0]) => request.format === 'json'
      ? actual.buildV2Export(request)
      : [{ filename: 'diagram-page-1.svg', mime: 'image/svg+xml', text: '<svg/>' }] };
});
const share = vi.hoisted(() => ({ fail: null as Error | null }));
vi.mock('../../../services/share/shareClient', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../services/share/shareClient')>();
  return { ...actual, createShareLink: async () => { throw share.fail; } };
});
vi.mock('../../../services/share/turnstile', () => ({ getTurnstileToken: async () => 't' }));

async function copyMermaid(clipboard: () => Promise<void>) {
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: vi.fn(clipboard) } });
  const compiled = await compile('flowchart right\nClient -> API : login\nAPI -> Database');
  const document = createTestDocument({ nodes: [compiled.frame, ...compiled.groups, ...compiled.nodes], connectors: compiled.connectors });
  const onToast = vi.fn();
  render(<V2ExportMenu open anchorRef={{ current: window.document.body }} document={document} pageId={document.pages[0]!.id}
    selectedNodeIds={[]} onClose={vi.fn()} onToast={onToast} onOpenAnimation={vi.fn()} />);
  fireEvent.click(screen.getByRole('button', { name: 'Copy as Mermaid' }));
  await waitFor(() => expect(onToast).toHaveBeenCalled());
  return onToast.mock.calls[0]!;
}

describe('Copy as Mermaid', () => {
  it('blames the clipboard only when the clipboard refused', async () => {
    toMermaid.fail = null;
    expect(await copyMermaid(() => Promise.reject(new DOMException('denied', 'NotAllowedError'))))
      .toEqual(['Couldn’t copy', 'danger', { description: 'This browser blocked the clipboard.' }]);
  });

  it('says what went wrong when the diagram could not be written as Mermaid', async () => {
    toMermaid.fail = new Error('A node has no label.');
    expect(await copyMermaid(() => Promise.resolve())).toEqual(['A node has no label.', 'danger']);
  });
});

describe('Download', () => {
  it('keeps the panel open, so the next variant is one click', async () => {
    const document = createTestDocument({ nodes: [(await compile('flowchart right\nA -> B')).frame] });
    const onClose = vi.fn();
    const onToast = vi.fn();
    render(<V2ExportMenu open anchorRef={{ current: window.document.body }} document={document} pageId={document.pages[0]!.id}
      selectedNodeIds={[]} onClose={onClose} onToast={onToast} onOpenAnimation={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Download' }));
    await waitFor(() => expect(onToast).toHaveBeenCalledWith('diagram-page-1.svg downloaded', 'success'));
    expect(exporter.download).toHaveBeenCalledTimes(1);
    expect(onClose).not.toHaveBeenCalled();
  });
});

describe('Include comments', () => {
  const exportJson = async (tick: boolean): Promise<string> => {
    exporter.download.mockClear();
    const base = createTestDocument({ nodes: [(await compile('flowchart right\nA -> B')).frame] });
    const document = addThread(base, {
      pageId: base.pages[0]!.id, threadId: 't1', nodeId: null, point: { x: 0, y: 0 },
      comment: { id: 'm1', author: { kind: 'human', name: 'Ada' }, body: 'private note', createdAt: '2026-10-26T12:00:00.000Z' },
    });
    const view = render(<V2ExportMenu open anchorRef={{ current: window.document.body }} document={document} pageId={document.pages[0]!.id}
      selectedNodeIds={[]} onClose={vi.fn()} onToast={vi.fn()} onOpenAnimation={vi.fn()} />);
    // The box belongs to JSON only.
    expect(screen.queryByRole('checkbox', { name: 'Include comments' })).toBeNull();
    fireEvent.click(screen.getByRole('radio', { name: 'JSON' }));
    const box = screen.getByRole('checkbox', { name: 'Include comments' }) as HTMLInputElement;
    expect(box.checked).toBe(false);
    if (tick) fireEvent.click(box);
    fireEvent.click(screen.getByRole('button', { name: 'Download' }));
    await waitFor(() => expect(exporter.download).toHaveBeenCalledTimes(1));
    view.unmount();
    return (exporter.download.mock.calls[0]![0] as { text: string }[])[0]!.text;
  };

  it('keeps comments out of a JSON file unless the box is ticked', async () => {
    expect(await exportJson(false)).not.toContain('private note');
    expect(await exportJson(true)).toContain('private note');
  });
});

describe('Share', () => {
  const renderShare = (document: ReturnType<typeof createTestDocument>, extra: { canShare?: boolean } = {}) => {
    const onToast = vi.fn();
    render(<V2ExportMenu open section="share" anchorRef={{ current: window.document.body }} document={document} pageId={document.pages[0]!.id}
      {...extra} selectedNodeIds={[]} onClose={vi.fn()} onToast={onToast} onOpenAnimation={vi.fn()} />);
    return onToast;
  };

  const codeDocument = async (source: string) => {
    const compiled = await compile(source);
    return createTestDocument({ nodes: [compiled.frame, ...compiled.groups, ...compiled.nodes], connectors: compiled.connectors });
  };

  it('offers both kinds of link and nothing from Export', async () => {
    renderShare(await codeDocument('flowchart\nA -> B\n'), { canShare: true });
    expect(screen.getAllByRole('radio').map((radio) => radio.closest('label')!.textContent))
      .toEqual([expect.stringMatching(/^View-only link/), expect.stringMatching(/^Editable copy/)]);
    expect(screen.getByRole('button', { name: 'Copy view-only link' })).toBeTruthy();
    expect(screen.getByText(/never change yours/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Download' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Delete link' })).toBeNull();
  });

  it('says why a link is unavailable instead of hiding it, and picks the one that works', async () => {
    renderShare(await codeDocument('flowchart\nA -> B\n'));
    const [viewOnly, editable] = screen.getAllByRole('radio') as HTMLInputElement[];
    expect(viewOnly!.disabled).toBe(true);
    // A visitor reads plain words, not "share server" (V13).
    expect(viewOnly!.closest('label')!.textContent).toMatch(/Not set up on this site/);
    expect(editable!.checked).toBe(true);
    expect(screen.getByRole('button', { name: 'Copy editable link' })).toBeTruthy();
  });

  it('with neither a share service nor code, it hands over the file', () => {
    renderShare(createTestDocument({ nodes: [] }));
    expect(screen.getAllByRole('radio').every((radio) => (radio as HTMLInputElement).disabled)).toBe(true);
    expect(screen.getAllByRole('radio')[1]!.closest('label')!.textContent).toMatch(/Needs a diagram made from code/);
    expect(screen.getByRole('button', { name: 'Download file' })).toBeTruthy();
  });

  it('copies an editable link that carries the diagram’s code, uploading nothing', async () => {
    const writeText = vi.fn((_text: string) => Promise.resolve());
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
    const source = 'flowchart right\nClient -> API : login\n';
    const onToast = renderShare(await codeDocument(source), { canShare: true });
    fireEvent.click(screen.getAllByRole('radio')[1]!);
    fireEvent.click(screen.getByRole('button', { name: 'Copy editable link' }));
    await waitFor(() => expect(onToast).toHaveBeenCalled());
    expect(onToast.mock.calls[0]!.slice(0, 2)).toEqual(['Editable link copied', 'success']);
    const url = new URL(writeText.mock.calls[0]![0]);
    const payload = new URLSearchParams(url.hash.split('?')[1]).get('d');
    expect(url.hash.startsWith('#/from/dsl?d=')).toBe(true);
    const { decodeDslPayload } = await import('../../../services/discovery/dslLink');
    expect(await decodeDslPayload(payload)).toBe(source);
  });

  it('a share service that is down is not blamed on the connection, and the file is offered', async () => {
    const { ShareError } = await import('../../../services/share/shareClient');
    share.fail = new ShareError('unreachable', 'The share service isn’t reachable right now.');
    const onToast = renderShare(createTestDocument({ nodes: [] }), { canShare: true });
    fireEvent.click(screen.getByRole('button', { name: 'Copy view-only link' }));
    await waitFor(() => expect(onToast).toHaveBeenCalled());
    const [title, tone, extra] = onToast.mock.calls[0]!;
    expect([title, tone]).toEqual(['The share service isn’t reachable right now.', 'danger']);
    expect(extra.action.label).toBe('Download file');
    expect(extra.description).not.toMatch(/connection/);
  });
});

describe('Export', () => {
  it('has no share links: sharing is its own panel', () => {
    const document = createTestDocument({ nodes: [] });
    render(<V2ExportMenu open anchorRef={{ current: window.document.body }} document={document} pageId={document.pages[0]!.id} canShare
      selectedNodeIds={[]} onClose={vi.fn()} onToast={vi.fn()} onOpenAnimation={vi.fn()} />);
    expect(screen.queryByRole('button', { name: /link/i })).toBeNull();
  });

  it('an empty page turns Animate off with Download and Copy, so the panel never offers what cannot work', async () => {
    const empty = createTestDocument({ nodes: [] });
    const { unmount } = render(<V2ExportMenu open anchorRef={{ current: window.document.body }} document={empty} pageId={empty.pages[0]!.id}
      selectedNodeIds={[]} onClose={vi.fn()} onToast={vi.fn()} onOpenAnimation={vi.fn()} />);
    expect((screen.getByRole('button', { name: 'Download' }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole('button', { name: 'Animate this page…' }) as HTMLButtonElement).disabled).toBe(true);
    unmount();
    const drawn = createTestDocument({ nodes: [(await compile('flowchart right\nA -> B')).frame] });
    render(<V2ExportMenu open anchorRef={{ current: window.document.body }} document={drawn} pageId={drawn.pages[0]!.id}
      selectedNodeIds={[]} onClose={vi.fn()} onToast={vi.fn()} onOpenAnimation={vi.fn()} />);
    expect((screen.getByRole('button', { name: 'Animate this page…' }) as HTMLButtonElement).disabled).toBe(false);
  });
});
