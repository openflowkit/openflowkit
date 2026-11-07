import type { RefObject } from 'react';
import { dslFrames } from '../../../dsl/frameScene';
import type { CanvasSelection } from '../../application/selection/selection';
import type { ScenePage } from '../../domain/document/types';
import type { useV2CodeWorkspace } from './useV2CodeWorkspace';
import type { useV2Panels } from './useV2Panels';

/**
 * Diagram as code on the rail and ⌥C: closes the panel, else opens the page's diagram as itself (the selected one, or the
 * only one), else a new diagram.
 */
export function codeToggle(input: {
  readonly panels: Pick<ReturnType<typeof useV2Panels>, 'workspace' | 'closeWorkspace'>;
  readonly page: ScenePage | null;
  readonly selectionRef: RefObject<CanvasSelection>;
  readonly code: Pick<ReturnType<typeof useV2CodeWorkspace>, 'openFrame' | 'openNew'>;
}): () => void {
  const { panels, page, selectionRef, code } = input;
  return () => {
    if (panels.workspace === 'code') { panels.closeWorkspace(); return; }
    const frames = page ? dslFrames(page) : [];
    const frame = frames.find((candidate) => selectionRef.current.nodeIds.includes(candidate.id)) ?? (frames.length === 1 ? frames[0] : undefined);
    if (frame) code.openFrame(frame.id); else code.openNew();
  };
}
