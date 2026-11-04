import { describe, expect, it } from 'vitest';
import { agentName } from './agentName';

describe('agentName', () => {
  it('names known agents, shows unknown ones as sent, and falls back to "Your agent"', () => {
    expect(agentName('claude-code')).toBe('Claude Code');
    expect(agentName('claude-ai')).toBe('Claude Desktop');
    expect(agentName('cursor-vscode')).toBe('Cursor');
    expect(agentName('codex-mcp-client')).toBe('Codex');
    expect(agentName('zed')).toBe('zed');
    expect(agentName(undefined)).toBe('Your agent');
    expect(agentName('  ')).toBe('Your agent');
  });
});
