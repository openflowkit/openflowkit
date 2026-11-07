import type { SceneDocumentV1 } from '../../domain/document/types';
import { validateSceneDocumentV1 } from '../../domain/document/validation';
import { withoutThreads } from '../../domain/threads/threads';

/**
 * The document as an export: JSON export, a share link, the agent `export` op. Comment threads carry names and
 * private conversation, so they stay out unless the caller asks for them (`includeThreads`). A diagram's own
 * file keeps them (see withoutThreads).
 */
export function serializeCanonicalJson(document: SceneDocumentV1, options: { readonly includeThreads?: boolean } = {}): string {
  const validation = validateSceneDocumentV1(document);
  if (validation.success === false) {
    throw new TypeError('Cannot serialize an invalid canonical document.');
  }
  const exported = options.includeThreads ? validation.document : withoutThreads(validation.document);
  return JSON.stringify(exported, null, 2) + '\n';
}
