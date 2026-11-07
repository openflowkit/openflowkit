import { cloneJsonValue, isJsonObject, type JsonObject } from './json';
import { SCENE_DOCUMENT_VERSION, type SceneDocumentV1 } from './types';
import { validateSceneDocumentV1, withoutInvalidThreads, type DocumentValidationIssue } from './validation';

type DocumentMigrationResult =
  | { readonly success: true; readonly document: SceneDocumentV1; readonly migrated: false }
  | {
      readonly success: false;
      readonly reason: 'invalid';
      readonly issues: readonly DocumentValidationIssue[];
    }
  | {
      readonly success: false;
      readonly reason: 'newer-schema';
      readonly schemaVersion: number;
      /** Byte-preserved input for read-only display. Never edit or re-save as V1. */
      readonly preserved: JsonObject;
      readonly issues: readonly DocumentValidationIssue[];
    };

export function migrateSceneDocument(value: unknown): DocumentMigrationResult {
  if (!isJsonObject(value)) {
    return {
      success: false,
      reason: 'invalid',
      issues: [{ path: '$', message: 'Document must contain JSON values only.' }],
    };
  }
  if (typeof value.schemaVersion === 'number' && value.schemaVersion > SCENE_DOCUMENT_VERSION) {
    const issue = {
      path: '$.schemaVersion',
      message: 'Document uses a newer unsupported schema version.',
    };
    return {
      success: false,
      reason: 'newer-schema',
      schemaVersion: value.schemaVersion,
      preserved: cloneJsonValue(value),
      issues: [issue],
    };
  }

  const cloned = cloneJsonValue(value);
  const validation = validateSceneDocumentV1(withoutInvalidThreads(cloned));
  if (validation.success === false) {
    return { success: false, reason: 'invalid', issues: validation.issues };
  }
  return { success: true, document: validation.document, migrated: false };
}
