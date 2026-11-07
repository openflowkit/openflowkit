#!/usr/bin/env node
// Shows how diagrams changed in a PR: one upserted comment, before/after SVGs as artifacts.
// Plain Node + git + the `gh` CLI + the openflowkit CLI (env OFK_CLI). No server.
// Usage: node pr-diagrams.mjs [--dry-run]   (dry run prints the comment, never calls gh, never commits)
import { spawnSync } from 'node:child_process';
import { appendFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  MARKER, buildComment, hunksOnly, isRegularFile, isSameRepo, parseNameStatus, pathMatcher, summarizeDrift, svgBeside, truncateDiff,
} from './prDiagrams.lib.mjs';

const dryRun = process.argv.includes('--dry-run');
const env = process.env;
const cli = env.OFK_CLI || 'npx -y openflowkit@0.2.5';
const commentAuthor = env.OFK_COMMENT_AUTHOR || 'github-actions[bot]';
const refreshSvg = env.OFK_REFRESH_SVG === 'true';
const token = env.GITHUB_TOKEN || env.GH_TOKEN || '';
const BIG = 256 * 1024 * 1024;

const redact = (text) => (token ? String(text).split(token).join('***') : String(text));
function run(cmd, args, { input, cwd, allow = [0] } = {}) {
  const r = spawnSync(cmd, args, { input, cwd, encoding: 'utf8', maxBuffer: BIG });
  if (r.error) throw new Error(`${cmd}: ${r.error.message}`);
  if (!allow.includes(r.status)) throw new Error(`${cmd} ${args.slice(0, 3).join(' ')} failed (${r.status}): ${redact(r.stderr || r.stdout).trim()}`);
  return r;
}
const git = (args, opts) => run('git', args, opts).stdout;
/** The CLI is a shell command line (`npx -y openflowkit@latest`), so run it through sh with real argv. */
// The CLI never sees a token: every *TOKEN* variable is dropped from its environment.
const ofkEnv = () => Object.fromEntries(Object.entries(process.env).filter(([key]) => !/token/i.test(key)));
const ofk = (args) => spawnSync('sh', ['-c', `${cli} "$@"`, 'sh', ...args], { encoding: 'utf8', maxBuffer: BIG, env: ofkEnv() });
const firstLine = (r) => (r.stderr || r.stdout || `exit ${r.status}`).trim().split('\n').find((l) => l.trim()) ?? `exit ${r.status}`;
const gitShow = (ref, file) => {
  const r = spawnSync('git', ['show', `${ref}:${file}`], { encoding: 'buffer', maxBuffer: BIG });
  return r.status === 0 ? r.stdout : null;
};

const eventPath = env.GITHUB_EVENT_PATH;
if (!eventPath || !existsSync(eventPath)) throw new Error('GITHUB_EVENT_PATH is not set; this runs on pull_request events');
const event = JSON.parse(readFileSync(eventPath, 'utf8'));
const pr = event.pull_request;
if (!pr) throw new Error('not a pull_request event');
const repo = env.GITHUB_REPOSITORY || pr.base.repo.full_name;
const headSha = pr.head.sha;
const root = git(['rev-parse', '--show-toplevel']).trim();
process.chdir(root);
// Three-dot semantics: the base side is where the PR branched, not the moved base tip.
const mergeBase = run('git', ['merge-base', pr.base.sha, headSha], { allow: [0, 1] }).stdout.trim();
if (!mergeBase) throw new Error('no merge base: check out with fetch-depth: 0');

const matches = pathMatcher(env.OFK_PATHS || '.openflow.json,.ofk');
const changed = parseNameStatus(git(['diff', '--name-status', '-z', '-M', mergeBase, headSha]))
  .filter((c) => matches(c.path) || (c.oldPath && matches(c.oldPath)));
if (changed.length === 0) { console.error('pr-diagrams: no matching diagram changed; nothing to post'); process.exit(0); }

const work = mkdtempSync(path.join(env.RUNNER_TEMP || tmpdir(), 'pr-diagrams-'));
const artifactDir = path.join(work, 'svgs');
const isDocument = (file) => /\.json$/i.test(file);

/** One version of one file -> { svg, dsl, counts, errors, notes } through the CLI. */
function inspect(side, file, content) {
  try { return inspectUnsafe(side, file, content); } catch (error) {
    return { src: null, svg: null, dsl: null, counts: null, errors: [`${side === 'base' ? 'before' : 'after'}: unexpected CLI output: ${error instanceof Error ? error.message : error}`], notes: [] };
  }
}
function inspectUnsafe(side, file, content) {
  const label = side === 'base' ? 'before' : 'after';
  const src = path.join(work, side, file);
  mkdirSync(path.dirname(src), { recursive: true });
  writeFileSync(src, content);
  const svgOut = path.join(artifactDir, label, svgBeside(file));
  mkdirSync(path.dirname(svgOut), { recursive: true });
  const result = { src, svg: null, dsl: null, counts: null, errors: [], notes: [] };
  const fail = (what, r) => result.errors.push(`${label}: ${what} failed: ${firstLine(r)}`);
  let docFile = src;
  if (isDocument(file)) {
    const exp = ofk(['op', 'export', '--doc', src, '--args', JSON.stringify({ format: 'svg', scope: 'page' })]);
    if (exp.status !== 0) { fail('render', exp); return result; }
    result.svg = JSON.parse(exp.stdout).output.files[0].text;
    const dsl = ofk(['op', 'get_diagram', '--doc', src]);
    if (dsl.status === 0) result.dsl = JSON.parse(dsl.stdout).output.dsl ?? null;
    if (result.dsl === null) result.notes.push(`${label}: no DSL source to diff; compare the SVGs`);
  } else {
    const render = ofk(['render', src, '-o', svgOut]);
    if (render.status !== 0) { fail('render', render); return result; }
    result.svg = readFileSync(svgOut, 'utf8');
    result.dsl = content.toString('utf8'); // already DSL: the source is the canonical text
    docFile = `${src}.converted.openflow.json`;
    if (ofk(['convert', src, '-o', docFile]).status !== 0) docFile = null;
  }
  writeFileSync(svgOut, result.svg);
  if (docFile) {
    const doc = ofk(['op', 'get_document', '--doc', docFile]);
    if (doc.status === 0) {
      const out = JSON.parse(doc.stdout).output;
      result.counts = { nodes: out.nodes.filter((n) => n.kind !== 'frame').length, connectors: out.connectors.length };
    }
  }
  return result;
}

function dslDiff(file, before, after) {
  const a = path.join(work, 'dsl-before', `${file}.dsl`), b = path.join(work, 'dsl-after', `${file}.dsl`);
  for (const [p, text] of [[a, before ?? ''], [b, after ?? '']]) {
    mkdirSync(path.dirname(p), { recursive: true });
    writeFileSync(p, !text || text.endsWith('\n') ? text : `${text}\n`);
  }
  const r = run('git', ['diff', '--no-index', '--no-color', '-U3', a, b], { allow: [0, 1] });
  const hunks = hunksOnly(r.stdout);
  return hunks ? truncateDiff(hunks) : null;
}

function driftOf(modelFile) {
  const r = ofk(['drift', root, '--model', modelFile, '--json']);
  if (r.status === 2 && /no C4 model/.test(r.stderr)) return {};
  if (r.status !== 0 && r.status !== 1) return { error: `drift failed: ${firstLine(r)}` };
  try { return { summary: summarizeDrift(JSON.parse(r.stdout)) }; } catch { return { error: 'drift printed no JSON' }; }
}

const entries = [], stale = [];
for (const c of changed) {
  const entry = { path: c.path, oldPath: c.oldPath, status: c.status, errors: [], notes: [] };
  entries.push(entry);
  const baseContent = c.status === 'added' ? null : gitShow(mergeBase, c.oldPath ?? c.path);
  const headContent = c.status === 'deleted' ? null : gitShow(headSha, c.path);
  if (c.status !== 'added' && baseContent === null) entry.errors.push('could not read the base version');
  if (c.status !== 'deleted' && headContent === null) entry.errors.push('could not read the head version');
  const before = baseContent === null ? null : inspect('base', c.oldPath ?? c.path, baseContent);
  const after = headContent === null ? null : inspect('head', c.path, headContent);
  for (const side of [before, after]) if (side) { entry.errors.push(...side.errors); entry.notes.push(...side.notes); }
  entry.before = before?.counts; entry.after = after?.counts;
  // Diff only when each existing side produced DSL: a failed side already has its error line.
  if ((!before || before.dsl != null) && (!after || after.dsl != null)) entry.diff = dslDiff(c.path, before?.dsl, after?.dsl);
  // ponytail: drift only for .ofk (the C4 model lives there); a .openflow.json's model is not read — upgrade: drift over its DSL frame.
  if (after?.svg != null && /\.ofk$/i.test(c.path)) {
    const d = driftOf(after.src);
    if (d.error) entry.errors.push(d.error); else if (d.summary) entry.drift = d.summary;
  }
  if (after?.svg != null) {
    const svgPath = svgBeside(c.path);
    const tree = git(['ls-tree', headSha, '--', svgPath]).trim();
    const committed = tree && isRegularFile(tree) ? gitShow(headSha, svgPath) : null;
    if (tree && !isRegularFile(tree)) entry.notes.push(`${svgPath} is not a regular file (symlink, submodule or directory); skipped`);
    if (committed !== null && committed.toString('utf8') !== after.svg) stale.push({ svg: svgBeside(c.path), fresh: after.svg });
  }
}

let refreshedNote = null;
if (stale.length && refreshSvg && isSameRepo(event) && !dryRun) {
  const wt = path.join(work, 'worktree');
  git(['worktree', 'add', '--detach', wt, headSha]);
  try {
    const url = `${env.GITHUB_SERVER_URL || 'https://github.com'}/${repo}.git`.replace('://', `://x-access-token:${token}@`);
    const identity = ['-c', 'user.name=github-actions[bot]', '-c', 'user.email=41898282+github-actions[bot]@users.noreply.github.com'];
    for (const s of stale) {
      writeFileSync(path.join(wt, s.svg), s.fresh);
      git(['add', '--', s.svg], { cwd: wt });
      git([...identity, 'commit', '-m', `chore(diagrams): refresh ${path.basename(s.svg)}`, '--', s.svg], { cwd: wt });
    }
    // A rejected push (branch moved, protected) is not fatal: the SVGs fall back to the stale list.
    const push = spawnSync('git', ['push', url, `HEAD:refs/heads/${pr.head.ref}`], { cwd: wt, encoding: 'utf8' });
    if (push.status === 0) {
      for (const s of stale) s.refreshed = true;
      refreshedNote = 'Refreshed SVGs were pushed to this branch; checks will not re-run for that push.';
    } else console.error(`pr-diagrams: push failed, listing as stale: ${redact(push.stderr).trim()}`);
  } finally { run('git', ['worktree', 'remove', '--force', wt], { allow: [0, 128] }); }
}

const artifactUrl = env.GITHUB_RUN_ID ? `${env.GITHUB_SERVER_URL || 'https://github.com'}/${repo}/actions/runs/${env.GITHUB_RUN_ID}` : null;
const body = redact(buildComment({ entries, stale: stale.map((s) => ({ svg: s.svg, refreshed: Boolean(s.refreshed) })), artifactUrl, refreshedNote }));

if (env.GITHUB_OUTPUT && existsSync(artifactDir)) appendFileSync(env.GITHUB_OUTPUT, `artifact-dir=${artifactDir}\n`);
// Fork and Dependabot PRs get a read-only token: the job summary is the only place to put the body.
const toSummary = () => {
  if (env.GITHUB_STEP_SUMMARY) appendFileSync(env.GITHUB_STEP_SUMMARY, `${body}\n`); else process.stdout.write(`${body}\n`);
  console.error('pr-diagrams: wrote the diagram changes to the job summary');
  process.exit(0);
};
if (!isSameRepo(event)) toSummary();
if (dryRun) { process.stdout.write(`${body}\n`); process.exit(0); }

process.env.GH_TOKEN = token;
const gh = (args, input) => run('gh', args, { input }).stdout;
const forbidden = (error) => /\b403\b|Resource not accessible/i.test(String(error.message));
const n = pr.number;
try {
  const found = gh(['api', '--paginate', `repos/${repo}/issues/${n}/comments`, '--jq', `.[] | select(.user.login == ${JSON.stringify(commentAuthor)} and (.body | contains(${JSON.stringify(MARKER)}))) | .id`]).split('\n').find(Boolean);
  const payload = JSON.stringify({ body });
  if (found) gh(['api', '-X', 'PATCH', `repos/${repo}/issues/comments/${found}`, '--input', '-'], payload);
  else gh(['api', '-X', 'POST', `repos/${repo}/issues/${n}/comments`, '--input', '-'], payload);
  console.error(`pr-diagrams: ${found ? 'updated' : 'posted'} the comment`);
} catch (error) {
  if (!forbidden(error)) throw error;
  toSummary();
}
