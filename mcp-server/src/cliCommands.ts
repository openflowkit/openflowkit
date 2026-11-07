// The op registry as commands. `op <name>` runs any agent op against a
// .openflow.json file, so every MCP op is a CLI command too and a new op needs
// no CLI code. render / convert / validate are friendly verbs over the same
// ops. Output is plain text or `--json`, never colour, so agents can pipe it.
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { parseArgs, type ParseArgsConfig } from 'node:util';
import {
  AGENT_OPS, CAPABILITY_MANIFEST, createAgentDocument, deterministicLayout, findAgentOp, lintDsl, opInputShape, runAgentOp,
  type AgentOp, type DslLintReport, type SceneDocumentV1,
} from './lib/agent.js';
import { DocumentStore } from './lib/documentStore.js';
import { loadFileCapabilities } from './lib/fileCapabilities.js';
import { exportSvg, svgBeside, tryWriteSvgBeside } from './lib/svgBeside.js';
import type { CliIo } from './cli.js';

export const OP_USAGE = `  openflowkit op <name> [--doc file.openflow.json] [--args '{…}' | --args -] [--page <id>] [--svg]
  openflowkit op <name> --help
  openflowkit ops [--json]
  openflowkit render <file|-> [-o out.svg] [--theme light|dark] [--strict] [--json]
  openflowkit convert <file|-> [-o out.openflow.json] [--svg] [--strict] [--json]
  openflowkit validate <file|-> [--strict] [--json]`;

export const OP_COMMANDS = `  op        run one agent op (the same ops as the MCP server) on a document file
  ops       list the ops
  render    Mermaid, D2, Structurizr or OpenFlow DSL → SVG
  convert   the same → an editable .openflow.json
  validate  per-line diagnostics; exit 1 on an error or a dropped line`;

/** Thrown for a usage mistake: exit 2 and the usage text, not exit 1. */
class UsageError extends Error {}

function parse(args: readonly string[], options: NonNullable<ParseArgsConfig['options']>) {
  try {
    return parseArgs({ args: [...args], options, allowPositionals: true });
  } catch (error) {
    throw new UsageError(error instanceof Error ? error.message : String(error));
  }
}

/**
 * The document with its id (and the page ids built on it) taken from the source text, for pictures only:
 * the id lands in the SVG, so a committed SVG must not churn between runs. Documents that get saved or opened
 * keep their random UUID, because the MCP store keys by id.
 */
export function stableForPicture(document: SceneDocumentV1, source: string): SceneDocumentV1 {
  const id = createHash('sha256').update(source).digest('hex').slice(0, 32);
  return JSON.parse(JSON.stringify(document).split(document.id).join(id)) as SceneDocumentV1;
}

/** The document a DSL source compiles to (id stable per source, see `stableForPicture`), or null when it doesn't compile (the caller's file is already written). */
export async function documentOfDsl(source: string, name: string): Promise<SceneDocumentV1 | null> {
  const checked = await check(source, name);
  return failed(checked, false) ? null : stableForPicture(checked.document!, source);
}

/** A file path, or `-` for stdin. Never stdin implicitly: an open, silent pipe would wait forever. */
async function readInput(input: string | undefined, io: CliIo): Promise<string> {
  if (!input) throw new UsageError('missing input: pass a file, or - to read piped text');
  if (input !== '-') return readFile(input, 'utf8');
  if (!io.stdin) throw new UsageError('- reads piped text, and nothing is piped');
  return io.stdin();
}

/** A zod error lists every bad field with its path, so a model can fix its own input. */
function describeError(error: unknown): string {
  const issues = (error as { issues?: readonly { path: readonly (string | number)[]; message: string }[] }).issues;
  if (issues?.length) return issues.map((issue) => `${issue.path.join('.') || 'input'}: ${issue.message}`).join('; ');
  return error instanceof Error ? error.message : String(error);
}

function opHelp(op: AgentOp): string {
  const fields = Object.entries(opInputShape(op)).map(([name, field]) =>
    `  ${name}${field.isOptional() ? ' (optional)' : ''}${field.description ? ` — ${field.description}` : ''}`);
  return [`${op.name} — ${op.title}`, op.description, '', 'Arguments (--args JSON):', ...(fields.length ? fields : ['  none'])].join('\n');
}

const opList = () => AGENT_OPS.map((op) => op.name).join(', ');

async function runOp(args: readonly string[], io: CliIo): Promise<number> {
  const { values, positionals } = parse(args, {
    doc: { type: 'string' }, args: { type: 'string' }, page: { type: 'string' }, json: { type: 'boolean' }, svg: { type: 'boolean' }, help: { type: 'boolean', short: 'h' },
  });
  const name = positionals[0];
  if (!name && values.help) { io.out(`${OP_USAGE}\n\nOps: ${opList()}`); return 0; }
  if (!name) throw new UsageError(`missing op name. Ops: ${opList()}`);
  const op = findAgentOp(name);
  if (!op) throw new UsageError(`unknown op "${name}". Ops: ${opList()}`);
  if (values.help) { io.out(opHelp(op)); return 0; }
  if (values.svg && !values.doc) throw new UsageError('--svg writes beside the --doc file, so it needs --doc');

  const rawArgs = values.args === '-' ? await readInput('-', io) : (values.args as string | undefined) ?? '{}';
  let input: unknown;
  try {
    input = JSON.parse(rawArgs);
  } catch {
    throw new UsageError(`--args must be a JSON object, got: ${rawArgs.slice(0, 80)}`);
  }
  const docPath = values.doc as string | undefined;
  const exists = Boolean(docPath && existsSync(docPath));
  // A read of a file that isn't there is a typo, not an empty diagram; a write may start one.
  if (docPath && !exists && !CAPABILITY_MANIFEST.find((row) => row.action === op.name)?.writes) throw new Error(`no such file: ${docPath}`);
  const store = new DocumentStore();
  const document = exists ? await store.open(docPath!) : store.create(docPath ? path.basename(docPath).replace(/\.openflow\.json$|\.json$/, '') : 'Untitled diagram');
  const pageId = (values.page as string | undefined) ?? document.pages[0]!.id;
  let result;
  try {
    result = await runAgentOp(op, input, { document, pageId, capabilities: await loadFileCapabilities() });
  } catch (error) {
    if (!(error as { diagnostics?: unknown }).diagnostics) throw error;
    io.err(`openflowkit op ${name}: ${(error as Error).message.replace(/\n/g, '; ')}; nothing saved`);
    return 1;
  }
  const errors = ((result.output as { diagnostics?: readonly Diagnostic[] } | null)?.diagnostics ?? []).filter(({ severity }) => severity === 'error');
  if (errors.length) {
    io.out(JSON.stringify({ changed: false, output: result.output }, null, 2));
    io.err(`openflowkit op ${name}: ${errors.map((issue) => `line ${issue.line}: ${issue.message}`).join('; ')}; nothing saved`);
    return 1;
  }
  let picture: Awaited<ReturnType<typeof tryWriteSvgBeside>> | undefined;
  if (result.changed && docPath) {
    store.set(result.document);
    await mkdir(path.dirname(path.resolve(docPath)), { recursive: true });
    await store.save(result.document.id, docPath);
    if (values.svg) picture = await tryWriteSvgBeside(docPath, result.document, pageId);
  } else if (result.changed) {
    io.err(`openflowkit op ${name}: no --doc, so the change was not saved`);
  } else if (values.svg) {
    io.err(`openflowkit op ${name}: no SVG written, nothing was saved`);
  }
  if (picture && 'svgError' in picture) io.err(`openflowkit op ${name}: saved ${docPath}; svg failed: ${picture.svgError}`);
  io.out(JSON.stringify({ changed: result.changed, ...(result.changed && docPath ? { saved: docPath } : {}), ...picture, output: result.output }, null, 2));
  return picture && 'svgError' in picture ? 1 : 0;
}

function runOps(args: readonly string[], io: CliIo): number {
  const { values } = parse(args, { json: { type: 'boolean' } });
  if (values.json) {
    io.out(JSON.stringify(AGENT_OPS.map((op) => ({ name: op.name, title: op.title, description: op.description })), null, 2));
  } else {
    const width = Math.max(...AGENT_OPS.map((op) => op.name.length));
    io.out(AGENT_OPS.map((op) => `${op.name.padEnd(width)}  ${op.title}`).join('\n'));
  }
  return 0;
}

type Diagnostic = DslLintReport['diagnostics'][number];

export interface Checked {
  readonly lint: DslLintReport;
  /** Parse and compile warnings and errors, once each; info notes ("version 1 assumed") are left out. */
  readonly issues: readonly Diagnostic[];
  readonly document?: SceneDocumentV1;
  readonly views: number;
}

/**
 * Parse, then compile through `create_diagram`: compiling finds what parsing can't
 * (`Shop -> Ghost` names no element), so --strict and validate see both.
 */
export async function check(source: string, name: string, layout: 'elk' | 'none' = 'elk'): Promise<Checked> {
  const lint = lintDsl(source);
  const notable = (list: readonly Diagnostic[]) => list.filter(({ severity }) => severity !== 'info');
  if (!lint.ok) return { lint, issues: notable(lint.diagnostics), views: 0 };
  const document = createAgentDocument(name);
  const elk = await loadFileCapabilities();
  // validate keeps no picture, so a grid layout does: any size checks fast.
  const capabilities = layout === 'elk' ? elk : {
    ...elk, compileWorkspace: (text: string, options?: unknown) => elk.compileWorkspace(text, { ...(options as object), layout: deterministicLayout }),
  };
  const seen = new Set<string>();
  const once = (list: readonly Diagnostic[]) => notable(list).filter((issue) => {
    const key = `${issue.code}:${issue.line}:${issue.col}`;
    return !seen.has(key) && Boolean(seen.add(key));
  });
  let result;
  try {
    result = await runAgentOp(findAgentOp('create_diagram')!, { dsl: source }, { document, pageId: document.pages[0]!.id, capabilities });
  } catch (error) {
    // Nothing drawable: the op names the lines it dropped; the check fails with them.
    const dropped = (error as { diagnostics?: readonly Diagnostic[] }).diagnostics;
    if (!dropped) throw error;
    const nothing: Diagnostic = { code: 'E001', severity: 'error', line: 1, col: 1, message: 'Nothing to draw' };
    return { lint, issues: [...once([...lint.diagnostics, ...dropped]), nothing], views: 0 };
  }
  const output = result.output as { views?: readonly unknown[]; diagnostics?: readonly Diagnostic[] };
  return { lint, issues: once([...lint.diagnostics, ...(output.diagnostics ?? [])]), document: result.document, views: output.views?.length ?? 0 };
}

/**
 * Codes for a statement the parser could not read, so the diagram is drawn without it: W101 (unparsable,
 * unclosed, unnamed, an unexpected close, an architecture line kept verbatim), W111 (not an arrow in this
 * family), W112 (a chain or fan this family does not read), W150 (an unknown target; the statement is ignored).
 * Generating draws the rest; validating fails on them. W190 (an animate step) and W160 (a view or flow clause)
 * leave the drawing whole and stay warnings.
 */
const DROPPED_CODES = new Set(['W101', 'W111', 'W112', 'W150']);
/**
 * W102 and W122 also name guesses (an unknown palette word, a flow step kept without its relation); only their
 * dropping form counts. ponytail: worded until the parser gives an unterminated quote and a dropped relation their
 * own codes — then this joins DROPPED_CODES.
 */
const DROPPED_IN_PART = new Set(['W102', 'W122']);
const isDropped = ({ code, severity, message }: Diagnostic): boolean => severity === 'warning'
  && (DROPPED_CODES.has(code) || (DROPPED_IN_PART.has(code) && /\bdropped\b/.test(message)));
const droppedHint = (form: string) => `Rewrite the line (${form} shows the form) or delete it; until then it is left out of the diagram.`;

/**
 * `check` for a validator (`openflowkit validate`, validate_openflow_dsl): every dropped line is an error with
 * a fix, so a draft that silently loses an edge does not pass. Unknown words and other guesses stay warnings.
 */
export async function checkForValidation(source: string, terminal = false): Promise<Checked> {
  const checked = await check(source, 'validate', 'none');
  const hint = droppedHint(terminal ? '`openflowkit op get_syntax`' : 'get_syntax');
  return {
    ...checked,
    issues: checked.issues.map((issue) => (isDropped(issue) ? { ...issue, severity: 'error', hint: issue.hint ?? hint } : issue)),
  };
}

function report(checked: Checked, io: CliIo, command: string): void {
  const { converted } = checked.lint;
  for (const loss of converted?.losses ?? []) io.err(`${command}: ${converted!.from} line ${loss.line}: not converted — ${loss.message}`);
  for (const issue of checked.issues) io.err(`${command}: line ${issue.line}:${issue.col} ${issue.severity} ${issue.code} ${issue.message}${issue.hint ? ` — ${issue.hint}` : ''}`);
}

/** Losses and warnings are fine by default; `--strict` turns them into exit 1. */
export function failed(checked: Checked, strict: boolean): boolean {
  if (!checked.document || checked.issues.some(({ severity }) => severity === 'error')) return true;
  return strict && ((checked.lint.converted?.losses.length ?? 0) > 0 || checked.issues.length > 0);
}

/** The --json shape every check-based command prints, pass or fail. */
const summary = (checked: Checked, ok: boolean) => ({
  ok, family: checked.lint.family, views: Math.max(checked.views, 1),
  losses: checked.lint.converted?.losses ?? [], diagnostics: checked.issues,
});

/** `render` and `convert`: one parse, one compile, one export through the registry. */
async function runCompile(command: 'render' | 'convert', args: readonly string[], io: CliIo): Promise<number> {
  const { values, positionals } = parse(args, {
    out: { type: 'string', short: 'o' }, theme: { type: 'string' }, strict: { type: 'boolean' }, json: { type: 'boolean' }, svg: { type: 'boolean' },
  });
  if (values.svg && command === 'render') throw new UsageError('render already writes SVG; --svg is for convert and op');
  const out = values.out as string | undefined;
  if (values.svg && !out) throw new UsageError('--svg writes beside the file, so it needs -o');
  if (values.svg && out && positionals[0] && positionals[0] !== '-' && path.resolve(svgBeside(out)) === path.resolve(positionals[0])) {
    throw new UsageError(`--svg would overwrite the input ${positionals[0]}; pick another -o name`);
  }
  const extensions = command === 'render' ? ['.svg'] : ['.json'];
  if (out && !extensions.includes(path.extname(out).toLowerCase())) {
    throw new UsageError(command === 'render'
      ? `render writes SVG (.svg), not "${path.extname(out) || out}". For an editable file use convert -o x.openflow.json; PNG needs the app.`
      : `convert writes .openflow.json, not "${path.extname(out) || out}". For a picture use render -o x.svg.`);
  }
  const theme = (values.theme as string | undefined) ?? 'light';
  if (!['light', 'dark'].includes(theme)) throw new UsageError(`--theme is light or dark, not "${theme}"`);

  const source = await readInput(positionals[0], io);
  const name = positionals[0] && positionals[0] !== '-' ? path.basename(positionals[0]).replace(/\.[^.]+$/, '') : 'diagram';
  const checked = await check(source, name);
  if (!values.json) report(checked, io, command);
  if (failed(checked, Boolean(values.strict))) {
    if (values.json) io.out(JSON.stringify(summary(checked, false), null, 2));
    return 1;
  }
  const { document, views } = checked as Checked & { document: SceneDocumentV1 };
  let text: string;
  if (command === 'render') {
    const still = stableForPicture(document, source);
    text = await exportSvg(still, still.pages[0]!.id, theme);
    // ponytail: one page per render; a workspace's other views stay in `convert`'s file.
    if (views > 1 && !values.json) io.err(`render: ${views} views; drew the first. convert keeps them all.`);
  } else {
    text = `${JSON.stringify(document, null, 2)}\n`;
  }
  let picture: Awaited<ReturnType<typeof tryWriteSvgBeside>> | undefined;
  if (out) {
    await mkdir(path.dirname(path.resolve(out)), { recursive: true });
    await writeFile(out, text, 'utf8');
    if (values.svg) picture = await tryWriteSvgBeside(out, stableForPicture(document, source), undefined, theme);
  }
  const svgError = picture && 'svgError' in picture ? picture.svgError : undefined;
  if (values.json) {
    const result = out ? { saved: out, ...picture } : command === 'render' ? { svg: text } : { document };
    io.out(JSON.stringify({ ...summary(checked, true), ...result }, null, 2));
  } else if (!out) {
    io.out(text.trimEnd());
  } else {
    io.err(`${command}: wrote ${out}`);
  }
  if (svgError) io.err(`${command}: saved ${out}; svg failed: ${svgError}`);
  return svgError ? 1 : 0;
}

async function runValidate(args: readonly string[], io: CliIo): Promise<number> {
  const { values, positionals } = parse(args, { strict: { type: 'boolean' }, json: { type: 'boolean' } });
  const checked = await checkForValidation(await readInput(positionals[0], io), true);
  const bad = failed(checked, Boolean(values.strict));
  const { lint } = checked;
  if (values.json) io.out(JSON.stringify(summary(checked, !bad), null, 2));
  else {
    report(checked, io, 'validate');
    io.out(bad ? 'invalid' : `ok — ${lint.family}, ${lint.statements} statement(s)${lint.converted ? `, converted from ${lint.converted.from}` : ''}`);
  }
  return bad ? 1 : 0;
}

const COMMANDS = new Map<string, (args: readonly string[], io: CliIo) => number | Promise<number>>([
  ['op', runOp], ['ops', runOps], ['validate', runValidate],
  ['render', (args, io) => runCompile('render', args, io)], ['convert', (args, io) => runCompile('convert', args, io)],
]);

/** Runs one of the registry commands, or returns null when `command` isn't one. */
export async function runRegistryCommand(command: string, args: readonly string[], io: CliIo, usage: string): Promise<number | null> {
  const run = COMMANDS.get(command);
  if (!run) return null;
  try {
    return await run(args, io);
  } catch (error) {
    const usageError = error instanceof UsageError;
    // --json callers get one JSON document on stdout whatever happened.
    if (args.includes('--json')) io.out(JSON.stringify({ ok: false, error: usageError ? (error as Error).message : describeError(error) }, null, 2));
    if (usageError) { io.err(`openflowkit ${command}: ${(error as Error).message}\n\n${usage}`); return 2; }
    io.err(`openflowkit ${command}: ${describeError(error)}`);
    return 1;
  }
}
