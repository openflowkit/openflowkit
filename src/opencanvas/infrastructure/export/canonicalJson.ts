import type { SceneDocumentV1 } from '../../domain/document/types';
import { validateSceneDocumentV1 } from '../../domain/document/validation';
import { withoutThreads } from '../../domain/threads/threads';

/**
 * The document as a file. Comment threads carry names and private conversation, so they stay out unless
 * the caller asks for them (`includeThreads`); this is the one place that decides.
 */
export function serializeCanonicalJson(document: SceneDocumentV1, options: { readonly includeThreads?: boolean } = {}): string {
  const validation = validateSceneDocumentV1(document);
  if (validation.success === false) {
    throw new TypeError('Cannot serialize an invalid canonical document.');
  }
  const exported = options.includeThreads ? validation.document : withoutThreads(validation.document);
  return JSON.stringify(exported, null, 2) + '\n';
}
