import { describe, expect, it } from 'vitest';
import { roundedConnectorCommands } from './routePaths';
import type { ConnectorPathCommand } from './types';

const bend = [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }];
const lines: ConnectorPathCommand[] = bend.map((point, index) => ({ kind: index ? 'line' : 'move', point }));

describe('roundedConnectorCommands', () => {
  it('rounds a bent line at its corner radius, as the canvas draws it', () => {
    const path = roundedConnectorCommands({ commands: lines, samples: bend, presentation: { cornerRadius: 10 } });
    expect(path.length).toBeGreaterThan(3);
    expect(path[0]).toEqual({ kind: 'move', point: { x: 0, y: 0 } });
    expect(path.at(-1)!.point).toEqual({ x: 100, y: 100 });
    expect(path.some(({ point }) => point.x === 100 && point.y === 0)).toBe(false);
  });

  it('leaves a straight line, a square-cornered one and a curve as they are', () => {
    expect(roundedConnectorCommands({ commands: lines, samples: bend, presentation: { cornerRadius: 0 } })).toBe(lines);
    const straight = lines.slice(0, 2);
    expect(roundedConnectorCommands({ commands: straight, samples: bend.slice(0, 2), presentation: { cornerRadius: 10 } })).toBe(straight);
    const curve: ConnectorPathCommand[] = [lines[0]!, { kind: 'cubic', control1: bend[1]!, control2: bend[1]!, point: bend[2]! }];
    expect(roundedConnectorCommands({ commands: curve, samples: bend, presentation: { cornerRadius: 10 } })).toBe(curve);
  });
});
