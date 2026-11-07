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

  // It signs comments, which keep at most 40 characters: the cut never leaves half an emoji in the document.
  it('cuts a long name between characters', () => {
    expect(agentName(`${'a'.repeat(39)}🙂 bot`)).toBe('a'.repeat(39));
  });
});
