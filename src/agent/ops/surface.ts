// How the ops are advertised, shared by every transport that advertises them (the MCP server, WebMCP), so the
// lists cannot drift apart. Behaviour lives in the ops; this only says which fields and limits a client sees.

/** Ops that read no document: no documentId, and an agent may call them before it has one. */
export const LOOKUP_OPS: ReadonlySet<string> = new Set(['get_syntax', 'search_icons', 'find_icons_for']);

/** Ops that read no page, or only the one on screen (fit_view moves the editor's camera): they take no pageId. */
export const PAGELESS_OPS: ReadonlySet<string> = new Set([...LOOKUP_OPS, 'list_diagrams', 'list_pages', 'fit_view']);

/** The largest image a tool result carries inline: past it, most clients' output cap cuts it off. */
export const MAX_IMAGE_KB = 1024;

/** Decoded size of a base64 body, in KB. */
export const base64Kb = (base64: string): number => Math.round(base64.length * 0.75 / 1024);

/** Ops that write threads: refused on a read-only document, allowed on a locked (repo map) page, never an undo step. */
export const THREAD_WRITE_OPS: ReadonlySet<string> = new Set(['start_thread', 'reply_to_thread', 'resolve_thread']);
