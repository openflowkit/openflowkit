import type { SceneDocumentV1, ScenePage } from '../document/types';
import { validateSceneDocumentV1 } from '../document/validation';
import { withFreeThreadNumbers } from '../threads/threads';
import { areStructurallyEqual } from './equality';
import type {
  AppliedDocumentCommand,
  BatchDocumentCommand,
  DocumentCommand,
  InsertConnectorCommand,
  InsertLayerCommand,
  InsertPageCommand,
  InsertNodeCommand,
  RemoveConnectorCommand,
  RemoveLayerCommand,
  RemovePageCommand,
  RemoveNodeCommand,
  SetConnectorCommand,
  SetDocumentNameCommand,
  SetLayerCommand,
  SetPageCommand,
  SetNodeCommand,
} from './types';

class DocumentCommandError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DocumentCommandError';
  }
}

function updatePage(
  document: SceneDocumentV1,
  pageId: string,
  update: (page: ScenePage) => ScenePage
): SceneDocumentV1 {
  const pageIndex = document.pages.findIndex((page) => page.id === pageId);
  if (pageIndex < 0) throw new DocumentCommandError(`Page "${pageId}" was not found.`);
  const pages = [...document.pages];
  pages[pageIndex] = update(pages[pageIndex]);
  return { ...document, pages };
}

function applySetDocumentName(
  document: SceneDocumentV1,
  command: SetDocumentNameCommand
): AppliedDocumentCommand {
  if (document.name !== command.before) {
    throw new DocumentCommandError('Document name precondition failed.');
  }
  if (!command.after.trim() || command.before === command.after) {
    throw new DocumentCommandError('set-document-name command must provide a changed name.');
  }
  return {
    document: { ...document, name: command.after },
    inverse: { ...command, before: command.after, after: command.before },
  };
}

function requireIndex(index: number, length: number, allowEnd: boolean): void {
  const maximum = allowEnd ? length : length - 1;
  if (!Number.isInteger(index) || index < 0 || index > maximum) {
    throw new DocumentCommandError(`Collection index ${index} is out of range.`);
  }
}

function applySetNode(document: SceneDocumentV1, command: SetNodeCommand): AppliedDocumentCommand {
  if (command.before.id !== command.after.id) {
    throw new DocumentCommandError('set-node cannot change a node ID.');
  }
  if (areStructurallyEqual(command.before, command.after)) {
    throw new DocumentCommandError('set-node command must change the node.');
  }
  const next = updatePage(document, command.pageId, (page) => {
    const index = page.nodes.findIndex((node) => node.id === command.before.id);
    if (index < 0 || !areStructurallyEqual(page.nodes[index], command.before)) {
      throw new DocumentCommandError(`Node "${command.before.id}" precondition failed.`);
    }
    const nodes = [...page.nodes];
    nodes[index] = command.after;
    return { ...page, nodes };
  });
  return { document: next, inverse: { ...command, before: command.after, after: command.before } };
}

function applySetLayer(document: SceneDocumentV1, command: SetLayerCommand): AppliedDocumentCommand {
  if (command.before.id !== command.after.id) {
    throw new DocumentCommandError('set-layer cannot change a layer ID.');
  }
  if (areStructurallyEqual(command.before, command.after)) {
    throw new DocumentCommandError('set-layer command must change the layer.');
  }
  const next = updatePage(document, command.pageId, (page) => {
    const index = page.layers.findIndex((layer) => layer.id === command.before.id);
    if (index < 0 || !areStructurallyEqual(page.layers[index], command.before)) {
      throw new DocumentCommandError(`Layer "${command.before.id}" precondition failed.`);
    }
    const layers = [...page.layers];
    layers[index] = command.after;
    return { ...page, layers };
  });
  return { document: next, inverse: { ...command, before: command.after, after: command.before } };
}

function applyInsertLayer(
  document: SceneDocumentV1,
  command: InsertLayerCommand
): AppliedDocumentCommand {
  const next = updatePage(document, command.pageId, (page) => {
    requireIndex(command.index, page.layers.length, true);
    if (page.layers.some((layer) => layer.id === command.layer.id)) {
      throw new DocumentCommandError(`Layer "${command.layer.id}" already exists.`);
    }
    const layers = [...page.layers];
    layers.splice(command.index, 0, command.layer);
    return { ...page, layers };
  });
  return { document: next, inverse: { ...command, kind: 'remove-layer' } };
}

function applyRemoveLayer(
  document: SceneDocumentV1,
  command: RemoveLayerCommand
): AppliedDocumentCommand {
  const next = updatePage(document, command.pageId, (page) => {
    requireIndex(command.index, page.layers.length, false);
    if (!areStructurallyEqual(page.layers[command.index], command.layer)) {
      throw new DocumentCommandError(`Layer "${command.layer.id}" removal precondition failed.`);
    }
    const layers = [...page.layers];
    layers.splice(command.index, 1);
    return { ...page, layers };
  });
  return { document: next, inverse: { ...command, kind: 'insert-layer' } };
}

// Threads are not diagram content (see domain/threads): page preconditions ignore them, since threads
// change outside history and a stored page copy holds the threads of its time.
function samePageContent(a: ScenePage | undefined, b: ScenePage): boolean {
  if (!a) return false;
  const { threads: _a, ...left } = a;
  const { threads: _b, ...right } = b;
  return areStructurallyEqual(left, right);
}

function applySetPage(document: SceneDocumentV1, command: SetPageCommand): AppliedDocumentCommand {
  if (command.before.id !== command.after.id || command.pageId !== command.before.id) {
    throw new DocumentCommandError('set-page cannot change a page ID.');
  }
  if (areStructurallyEqual(command.before, command.after)) {
    throw new DocumentCommandError('set-page command must change the page.');
  }
  const index = document.pages.findIndex((page) => page.id === command.pageId);
  if (index < 0 || !samePageContent(document.pages[index], command.before)) {
    throw new DocumentCommandError(`Page "${command.pageId}" precondition failed.`);
  }
  const pages = [...document.pages];
  // The snapshot holds the threads of its time; the page keeps the ones it has now (numbers are unique across the document).
  const { threads: _snapshot, ...shape } = command.after;
  const current = document.pages[index]!;
  pages[index] = current.threads ? { ...shape, threads: current.threads } : shape;
  return {
    document: { ...document, pages },
    inverse: { ...command, before: command.after, after: command.before },
  };
}

function applyInsertPage(
  document: SceneDocumentV1,
  command: InsertPageCommand
): AppliedDocumentCommand {
  requireIndex(command.index, document.pages.length, true);
  if (document.pages.some((page) => page.id === command.page.id)) {
    throw new DocumentCommandError(`Page "${command.page.id}" already exists.`);
  }
  const pages = [...document.pages];
  // A page coming back (undo of its removal) may hold thread numbers given out again since it went.
  const page = withFreeThreadNumbers(document, command.page);
  pages.splice(command.index, 0, page);
  return {
    document: { ...document, pages },
    inverse: { ...command, kind: 'remove-page', page },
  };
}

function applyRemovePage(
  document: SceneDocumentV1,
  command: RemovePageCommand
): AppliedDocumentCommand {
  requireIndex(command.index, document.pages.length, false);
  const removed = document.pages[command.index];
  if (!samePageContent(removed, command.page)) {
    throw new DocumentCommandError(`Page "${command.page.id}" removal precondition failed.`);
  }
  const pages = [...document.pages];
  pages.splice(command.index, 1);
  // The inverse brings the page back with the threads it had when it went.
  return {
    document: { ...document, pages },
    inverse: { ...command, kind: 'insert-page', page: removed! },
  };
}

function applyInsertNode(
  document: SceneDocumentV1,
  command: InsertNodeCommand
): AppliedDocumentCommand {
  const next = updatePage(document, command.pageId, (page) => {
    requireIndex(command.index, page.nodes.length, true);
    if (page.nodes.some((node) => node.id === command.node.id)) {
      throw new DocumentCommandError(`Node "${command.node.id}" already exists.`);
    }
    const nodes = [...page.nodes];
    nodes.splice(command.index, 0, command.node);
    return { ...page, nodes };
  });
  return { document: next, inverse: { ...command, kind: 'remove-node' } };
}

function applyRemoveNode(
  document: SceneDocumentV1,
  command: RemoveNodeCommand
): AppliedDocumentCommand {
  const next = updatePage(document, command.pageId, (page) => {
    requireIndex(command.index, page.nodes.length, false);
    if (!areStructurallyEqual(page.nodes[command.index], command.node)) {
      throw new DocumentCommandError(`Node "${command.node.id}" removal precondition failed.`);
    }
    const nodes = [...page.nodes];
    nodes.splice(command.index, 1);
    return { ...page, nodes };
  });
  return { document: next, inverse: { ...command, kind: 'insert-node' } };
}

function applySetConnector(
  document: SceneDocumentV1,
  command: SetConnectorCommand
): AppliedDocumentCommand {
  if (command.before.id !== command.after.id) {
    throw new DocumentCommandError('set-connector cannot change a connector ID.');
  }
  if (areStructurallyEqual(command.before, command.after)) {
    throw new DocumentCommandError('set-connector command must change the connector.');
  }
  const next = updatePage(document, command.pageId, (page) => {
    const index = page.connectors.findIndex((connector) => connector.id === command.before.id);
    if (index < 0 || !areStructurallyEqual(page.connectors[index], command.before)) {
      throw new DocumentCommandError(`Connector "${command.before.id}" precondition failed.`);
    }
    const connectors = [...page.connectors];
    connectors[index] = command.after;
    return { ...page, connectors };
  });
  return { document: next, inverse: { ...command, before: command.after, after: command.before } };
}

function applyInsertConnector(
  document: SceneDocumentV1,
  command: InsertConnectorCommand
): AppliedDocumentCommand {
  const next = updatePage(document, command.pageId, (page) => {
    requireIndex(command.index, page.connectors.length, true);
    if (page.connectors.some((connector) => connector.id === command.connector.id)) {
      throw new DocumentCommandError(`Connector "${command.connector.id}" already exists.`);
    }
    const connectors = [...page.connectors];
    connectors.splice(command.index, 0, command.connector);
    return { ...page, connectors };
  });
  return { document: next, inverse: { ...command, kind: 'remove-connector' } };
}

function applyRemoveConnector(
  document: SceneDocumentV1,
  command: RemoveConnectorCommand
): AppliedDocumentCommand {
  const next = updatePage(document, command.pageId, (page) => {
    requireIndex(command.index, page.connectors.length, false);
    if (!areStructurallyEqual(page.connectors[command.index], command.connector)) {
      throw new DocumentCommandError(
        `Connector "${command.connector.id}" removal precondition failed.`
      );
    }
    const connectors = [...page.connectors];
    connectors.splice(command.index, 1);
    return { ...page, connectors };
  });
  return { document: next, inverse: { ...command, kind: 'insert-connector' } };
}

function applyBatch(
  document: SceneDocumentV1,
  command: BatchDocumentCommand
): AppliedDocumentCommand {
  if (command.commands.length === 0) {
    throw new DocumentCommandError('Batch command must contain at least one command.');
  }
  let current = document;
  const inverses: DocumentCommand[] = [];
  for (const child of command.commands) {
    if (child.kind === 'batch') {
      throw new DocumentCommandError('Nested batch commands are not supported.');
    }
    const applied = applyUnchecked(current, child);
    current = applied.document;
    inverses.unshift(applied.inverse);
  }
  return {
    document: current,
    inverse: {
      kind: 'batch',
      id: `${command.id}:inverse`,
      label: command.label,
      commands: inverses,
      ...(command.attribution ? { attribution: command.attribution } : {}),
    },
  };
}

function applyUnchecked(
  document: SceneDocumentV1,
  command: DocumentCommand
): AppliedDocumentCommand {
  switch (command.kind) {
    case 'set-document-name':
      return applySetDocumentName(document, command);
    case 'set-node':
      return applySetNode(document, command);
    case 'set-layer':
      return applySetLayer(document, command);
    case 'insert-layer':
      return applyInsertLayer(document, command);
    case 'remove-layer':
      return applyRemoveLayer(document, command);
    case 'set-page':
      return applySetPage(document, command);
    case 'insert-page':
      return applyInsertPage(document, command);
    case 'remove-page':
      return applyRemovePage(document, command);
    case 'insert-node':
      return applyInsertNode(document, command);
    case 'remove-node':
      return applyRemoveNode(document, command);
    case 'set-connector':
      return applySetConnector(document, command);
    case 'insert-connector':
      return applyInsertConnector(document, command);
    case 'remove-connector':
      return applyRemoveConnector(document, command);
    case 'batch':
      return applyBatch(document, command);
  }
}

// ponytail: only the result is checked — every document in play is a loaded (validated) one or an
// earlier result, and a second full pass cost half of each edit at 5k nodes. Check the input
// too if a path ever hands in a document that skipped load.
function requireValidDocument(document: SceneDocumentV1): void {
  const result = validateSceneDocumentV1(document);
  if (result.success === false) {
    throw new DocumentCommandError(
      `Result document is invalid: ${result.issues[0].path} ${result.issues[0].message}`
    );
  }
}

export function applyDocumentCommand(
  document: SceneDocumentV1,
  command: DocumentCommand
): AppliedDocumentCommand {
  const applied = applyUnchecked(document, command);
  requireValidDocument(applied.document);
  return applied;
}
