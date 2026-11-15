import 'fake-indexeddb/auto';
import { describe, expect, it, vi } from 'vitest';
import { importFiles } from './backup';
import { createV2Repository } from './v2Repository';

// The draw.io importer carries draw.io's own shape code; loading it for a JSON file slowed every open.
vi.mock('../../dsl/drawio', () => { throw new Error('the draw.io importer was loaded'); });

const fileOf = (text: string, name: string) => Object.assign(new File([text], name), { text: async () => text });

describe('opening a file that cannot be draw.io', () => {
  it('opens a JSON diagram without loading the draw.io importer', async () => {
    const json = JSON.stringify({ name: 'Flow', nodes: [{ id: 'n0', type: 'process', position: { x: 0, y: 0 }, data: { label: 'A' } }], edges: [] });
    const report = await importFiles([fileOf(json, 'flow.json')], createV2Repository(indexedDB), () => 'new-1');
    expect(report).toMatchObject({ count: 1, problems: [] });
  });
});
