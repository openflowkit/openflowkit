import { describe, expect, it } from 'vitest';
import { createDefaultSceneLayer } from './defaults';
import { SCENE_DOCUMENT_FORMAT, SCENE_DOCUMENT_VERSION, type SceneDocumentV1 } from './types';
import { isIsoTimestamp, validateSceneDocumentV1 } from './validation';

function createDocument(): SceneDocumentV1 {
  return {
    format: SCENE_DOCUMENT_FORMAT,
    schemaVersion: SCENE_DOCUMENT_VERSION,
    id: 'document-1',
    name: 'Document',
    createdAt: '2026-08-07T00:00:00.000Z',
    updatedAt: '2026-08-07T00:00:00.000Z',
    pages: [
      {
        id: 'page-1',
        name: 'Page',
        diagramKind: 'flowchart',
        layers: [createDefaultSceneLayer()],
        nodes: [
          {
            id: 'node-1',
            kind: 'process',
            parentId: null,
            layerId: 'default',
            zIndex: 0,
            transform: {
              translation: { x: 10, y: 20 },
              rotationRadians: 0,
              scale: { x: 1, y: 1 },
            },
            size: { width: 160, height: 80 },
            content: { label: 'API' },
            appearance: {},
            ports: [
              {
                id: 'right',
                anchor: { kind: 'side', side: 'right', ratio: 0.5 },
                accepts: [],
                metadata: {},
              },
            ],
            metadata: {},
            extensions: {},
          },
          {
            id: 'node-2',
            kind: 'database',
            parentId: null,
            layerId: 'default',
            zIndex: 1,
            transform: {
              translation: { x: 300, y: 20 },
              rotationRadians: 0,
              scale: { x: 1, y: 1 },
            },
            size: { width: 160, height: 80 },
            content: { label: 'DB' },
            appearance: {},
            ports: [],
            metadata: {},
            extensions: {},
          },
        ],
        connectors: [
          {
            id: 'connector-1',
            source: { nodeId: 'node-1', portId: 'right', anchor: null, point: null },
            target: { nodeId: 'node-2', portId: null, anchor: { kind: 'center' }, point: null },
            route: { kind: 'orthogonal', ownership: 'automatic' },
            waypoints: [{ x: 230, y: 60 }],
            labels: [
              {
                id: 'label-1',
                text: 'writes',
                pathRatio: 0.5,
                offset: { x: 0, y: -8 },
                metadata: {},
              },
            ],
            appearance: {},
            semantics: { protocol: 'HTTPS' },
            metadata: {},
            extensions: {},
          },
        ],
        metadata: {},
        extensions: {},
      },
    ],
    metadata: {},
    extensions: {},
  };
}

describe('isIsoTimestamp', () => {
  it('takes a time as toISOString writes it, or with an offset', () => {
    expect(isIsoTimestamp('2026-10-26T12:00:00.000Z')).toBe(true);
    expect(isIsoTimestamp('2026-10-26T23:30:00+05:30')).toBe(true);
    expect(isIsoTimestamp('2028-02-29T00:00:00.000Z')).toBe(true);
  });

  // Date.parse rolls a day past the month's end over into the next month.
  it('refuses a day the month does not have, and anything not ISO', () => {
    expect(isIsoTimestamp('2026-02-30T00:00:00.000Z')).toBe(false);
    expect(isIsoTimestamp('2026-02-29T00:00:00.000Z')).toBe(false);
    expect(isIsoTimestamp('2026-04-31T00:00:00.000Z')).toBe(false);
    expect(isIsoTimestamp('2026-13-01T00:00:00.000Z')).toBe(false);
    expect(isIsoTimestamp('last week')).toBe(false);
    expect(isIsoTimestamp(1)).toBe(false);
  });
});

describe('validateSceneDocumentV1', () => {
  it('accepts a complete renderer-independent document', () => {
    const document = createDocument();
    expect(validateSceneDocumentV1(document)).toEqual({ success: true, document });
  });

  it('accepts free endpoints without requiring node references', () => {
    const document = createDocument();
    const free = {
      ...document,
      pages: document.pages.map((page) => ({
        ...page,
        connectors: [
          {
            id: 'free',
            source: { nodeId: null, portId: null, anchor: null, point: { x: 4, y: 8 } },
            target: { nodeId: 'node-2', portId: null, anchor: null, point: null },
            route: { kind: 'direct', ownership: 'automatic' },
            waypoints: [],
            labels: [],
            appearance: {},
            semantics: {},
            metadata: {},
            extensions: {},
          },
        ],
      })),
    };
    expect(validateSceneDocumentV1(free).success).toBe(true);
  });

  it.each([
    ['free end with a port', { nodeId: null, portId: 'right', anchor: null, point: { x: 1, y: 1 } }],
    ['free end with an anchor', { nodeId: null, portId: null, anchor: { kind: 'center' }, point: { x: 1, y: 1 } }],
    ['free end without a point', { nodeId: null, portId: null, anchor: null, point: null }],
    ['bound end with a point', { nodeId: 'node-1', portId: null, anchor: null, point: { x: 1, y: 1 } }],
  ])('rejects a %s', (_label, endpoint) => {
    const document = createDocument();
    const broken = {
      ...document,
      pages: document.pages.map((page) => ({
        ...page,
        connectors: [{ ...page.connectors[0]!, source: endpoint }],
      })),
    };
    expect(validateSceneDocumentV1(broken).success).toBe(false);
  });

  it('validates optional canonical node content layout', () => {
    const document = createDocument();
    const node = document.pages[0].nodes[0];
    const valid = {
      ...document,
      pages: [
        {
          ...document.pages[0],
          nodes: [
            {
              ...node,
              content: {
                ...node.content,
                contentLayout: {
                  version: 1,
                  horizontal: 'center',
                  vertical: 'end',
                  iconPlacement: 'left',
                  labelAlignment: 'start',
                  padding: { top: 8, right: 8, bottom: 8, left: 8 },
                  gap: 6,
                  iconScale: 1,
                  freeIconPosition: { x: 0.5, y: 0.5 },
                },
              },
            },
            document.pages[0].nodes[1],
          ],
        },
      ],
    };
    expect(validateSceneDocumentV1(valid).success).toBe(true);

    const invalid = {
      ...valid,
      pages: [
        {
          ...valid.pages[0],
          nodes: [
            {
              ...valid.pages[0].nodes[0],
              content: { ...valid.pages[0].nodes[0].content, contentLayout: { version: 1 } },
            },
            valid.pages[0].nodes[1],
          ],
        },
      ],
    };
    expect(validateSceneDocumentV1(invalid).success).toBe(false);
  });

  it('rejects an unsupported version and non-JSON metadata', () => {
    const document = createDocument() as unknown as Record<string, unknown>;
    document.schemaVersion = 2;
    document.metadata = { invalid: Number.NaN };

    const result = validateSceneDocumentV1(document);
    expect(result.success).toBe(false);
    if (result.success === false) {
      expect(result.issues.map((issue) => issue.path)).toEqual(
        expect.arrayContaining(['$.schemaVersion', '$.metadata'])
      );
    }
  });

  it('rejects duplicate IDs within an owning collection', () => {
    const document = createDocument();
    const duplicateNode = { ...document.pages[0].nodes[0] };
    const invalid = {
      ...document,
      pages: [{ ...document.pages[0], nodes: [...document.pages[0].nodes, duplicateNode] }],
    };

    const result = validateSceneDocumentV1(invalid);
    expect(result.success).toBe(false);
    if (result.success === false) expect(result.issues[0].path).toBe('$.pages');
  });

  it('reports dangling layer, parent, and endpoint references', () => {
    const document = createDocument();
    const invalid = {
      ...document,
      pages: [
        {
          ...document.pages[0],
          nodes: [
            { ...document.pages[0].nodes[0], layerId: 'missing', parentId: 'missing' },
            document.pages[0].nodes[1],
          ],
          connectors: [
            {
              ...document.pages[0].connectors[0],
              source: { nodeId: 'missing', portId: null, anchor: null },
              target: { nodeId: 'also-missing', portId: null, anchor: null },
            },
          ],
        },
      ],
    };

    const result = validateSceneDocumentV1(invalid);
    expect(result.success).toBe(false);
    if (result.success === false) {
      expect(result.issues.map((issue) => issue.path)).toEqual([
        '$.pages[0].nodes[0].layerId',
        '$.pages[0].nodes[0].parentId',
        '$.pages[0].connectors[0].source.nodeId',
        '$.pages[0].connectors[0].target.nodeId',
      ]);
    }
  });

  it('rejects self-parenting and out-of-range anchor or label ratios', () => {
    const document = createDocument();
    const invalid = {
      ...document,
      pages: [
        {
          ...document.pages[0],
          nodes: [
            {
              ...document.pages[0].nodes[0],
              parentId: 'node-1',
              ports: [
                {
                  ...document.pages[0].nodes[0].ports[0],
                  anchor: { kind: 'side', side: 'right', ratio: 1.1 },
                },
              ],
            },
            document.pages[0].nodes[1],
          ],
          connectors: [
            {
              ...document.pages[0].connectors[0],
              labels: [{ ...document.pages[0].connectors[0].labels[0], pathRatio: -0.1 }],
            },
          ],
        },
      ],
    };

    expect(validateSceneDocumentV1(invalid).success).toBe(false);
  });

  it('rejects cyclic hierarchy and unresolved endpoint ports', () => {
    const document = createDocument();
    const invalid = {
      ...document,
      pages: [
        {
          ...document.pages[0],
          nodes: [
            { ...document.pages[0].nodes[0], parentId: 'node-2' },
            { ...document.pages[0].nodes[1], parentId: 'node-1' },
          ],
          connectors: [
            {
              ...document.pages[0].connectors[0],
              target: { nodeId: 'node-2', portId: 'missing', anchor: null },
            },
          ],
        },
      ],
    };

    const result = validateSceneDocumentV1(invalid);
    expect(result.success).toBe(false);
    if (result.success === false) {
      expect(result.issues.map((issue) => issue.path)).toEqual(
        expect.arrayContaining([
          '$.pages[0].nodes[0].parentId',
          '$.pages[0].nodes[1].parentId',
          '$.pages[0].connectors[0].target.portId',
        ])
      );
    }
  });

  it('rejects invalid canonical node sizing policies', () => {
    const document = createDocument();
    const invalid = {
      ...document,
      pages: [{
        ...document.pages[0],
        nodes: [{
          ...document.pages[0].nodes[0],
          content: {
            ...document.pages[0].nodes[0].content,
            sizingPolicy: {
              version: 1, mode: 'responsive',
              minSize: { width: 200, height: 100 },
              maxSize: { width: 100, height: 50 },
              overflow: 'wrap', clipContent: true, maxLines: 4,
            },
          },
        }, document.pages[0].nodes[1]],
      }],
    };
    expect(validateSceneDocumentV1(invalid).success).toBe(false);
  });
});
