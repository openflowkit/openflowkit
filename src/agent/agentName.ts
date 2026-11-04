// How an MCP client names itself to people. Shared by the editor (who is drawing) and the comment ops (who is writing).

/** MCP clientInfo.name → what people call it. Unknown names show as sent. */
const AGENT_NAMES: Record<string, string> = {
  'claude-code': 'Claude Code', 'claude-ai': 'Claude Desktop', 'cursor-vscode': 'Cursor', cursor: 'Cursor',
  'Visual Studio Code': 'VS Code', 'Visual Studio Code - Insiders': 'VS Code', 'codex-mcp-client': 'Codex', codex: 'Codex',
};

export function agentName(client: string | undefined): string {
  const raw = client?.trim().slice(0, 40);
  return raw ? AGENT_NAMES[raw] ?? raw : 'Your agent';
}
