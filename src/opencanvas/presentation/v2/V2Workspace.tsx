import {
  IconArrowUpRight,
  IconCode,
  IconKeyboard,
  IconMessageCircle,
  IconPlugConnected,
  IconSitemap,
  IconSparkles,
} from '@tabler/icons-react';
import { useLayoutEffect, useRef, type ReactNode } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  Button,
  FloatingRegion,
  Icon,
  IconButton,
  Kbd,
  Panel,
  Toolbar,
  Tooltip,
} from '../design-system';
import { shortcutFor, shortcutGroups } from './v2Shortcuts';
import { DOCS_URL } from './homeStars';
import { mapRepoPath, MapRepoForm } from './map/V2MapStart';

export type V2WorkspaceMode = 'assistant' | 'code' | 'model' | 'agent' | 'inspect' | 'threads';
const MODES = [
  { id: 'assistant', label: 'AI assistant', icon: IconSparkles },
  { id: 'threads', label: 'Threads', icon: IconMessageCircle },
  { id: 'model', label: 'Architecture model', icon: IconSitemap },
  { id: 'code', label: 'Diagram as code', icon: IconCode },
  { id: 'agent', label: 'Connect agent', icon: IconPlugConnected },
] as const;
const modeById = (id: V2WorkspaceMode) => MODES.find((mode) => mode.id === id)!;

/** The document bar's pair at the right edge: the same top line, the workspace rail hangs below it. */
export function V2ShareBar({ canShare, shareOpen, exportOpen, onShare, onExport }: {
  canShare: boolean;
  shareOpen: boolean;
  exportOpen: boolean;
  onShare: (anchor: HTMLElement) => void;
  onExport: (anchor: HTMLElement) => void;
}) {
  return (
    <FloatingRegion slot="top-end" className="ofk-v2-share-bar">
      <Toolbar label="Share and export">
        {canShare ? (
          <Button variant="quiet" aria-haspopup="dialog" aria-expanded={shareOpen}
            onClick={(event) => onShare(event.currentTarget)}>
            Share
          </Button>
        ) : null}
        <Button variant="primary" aria-haspopup="dialog" aria-expanded={exportOpen}
          onClick={(event) => onExport(event.currentTarget)}>
          Export
        </Button>
      </Toolbar>
    </FloatingRegion>
  );
}

export function V2WorkspaceRail({
  mode,
  onChange,
  onShortcuts,
  agentConnected,
  openThreads,
}: {
  mode: V2WorkspaceMode | null;
  onChange: (mode: V2WorkspaceMode) => void;
  onShortcuts: () => void;
  agentConnected: boolean;
  /** Unresolved threads in the document: shown on the Threads button. */
  openThreads: number;
}) {
  return (
    <>
      <FloatingRegion slot="top-end" className="ofk-v2-workspace-rail">
        <Toolbar label="Workspace" orientation="vertical">
          {MODES.map(({ id, label, icon }) => (
            <Tooltip key={id} content={label} shortcut={shortcutFor(label)}>
              <IconButton
                variant="quiet"
                label={id === 'threads' && openThreads > 0 ? `${label}, ${openThreads} open` : label}
                data-count={id === 'threads' && openThreads > 0 ? (openThreads > 99 ? '99+' : openThreads) : undefined}
                icon={<Icon icon={icon} />}
                selected={mode === id}
                aria-expanded={mode === id}
                data-mode={id}
                data-live={(id === 'agent' && agentConnected) || undefined}
                data-bridge-status={id === 'agent' ? agentConnected ? 'connected' : 'disconnected' : undefined}
                onClick={() => onChange(id)}
              />
            </Tooltip>
          ))}
        </Toolbar>
      </FloatingRegion>
      <FloatingRegion slot="bottom-end" className="ofk-v2-help">
        <Toolbar label="Help">
          <Tooltip content="Keyboard shortcuts" shortcut="?">
            <IconButton
              variant="quiet"
              label="Keyboard shortcuts"
              icon={<Icon icon={IconKeyboard} />}
              onClick={onShortcuts}
            />
          </Tooltip>
        </Toolbar>
      </FloatingRegion>
    </>
  );
}

/** The centred welcome Canvas and Map share, so switching between them changes only the words and buttons: logo, title, one line, a row of actions, and the arrows pointing at the chrome. `below` hangs under the actions without moving them. */
export function V2Welcome({ testId, title, body, actions, below }: {
  testId: string;
  title: string;
  body: string;
  actions: ReactNode;
  below?: ReactNode;
}) {
  const root = useRef<HTMLDivElement>(null);
  // An arrow whose label would run into the centre (a short window, an open side panel) steps aside.
  useLayoutEffect(() => {
    const welcome = root.current;
    const centre = welcome?.querySelector('.ofk-v2-welcome-center');
    if (!welcome || !centre) return;
    const place = () => {
      const middle = centre.getBoundingClientRect();
      for (const guide of welcome.querySelectorAll<HTMLElement>('.ofk-v2-guide')) {
        const box = guide.getBoundingClientRect();
        const clash = box.width > 0 && box.left < middle.right + 12 && box.right > middle.left - 12
          && box.top < middle.bottom + 12 && box.bottom > middle.top - 12;
        guide.toggleAttribute('data-clash', clash);
      }
    };
    const observer = new ResizeObserver(place);
    observer.observe(welcome);
    observer.observe(centre);
    return () => observer.disconnect();
  }, []);
  return (
    <div className="ofk-v2-welcome" data-testid={testId} ref={root}>
      <div className="ofk-v2-guide ofk-v2-guide-tools" aria-hidden="true">
        <svg viewBox="0 0 110 70"><path d="M103 9 C76 11 47 29 9 59 M11 44 Q7 54 9 60 Q20 60 29 55" /></svg><span>Start with a shape</span>
      </div>
      <div className="ofk-v2-guide ofk-v2-guide-workspace" aria-hidden="true">
        <span>Another way to create</span><svg viewBox="0 0 120 80"><path d="M8 72 C30 43 67 13 111 13 M99 5 Q108 8 112 13 Q108 20 100 23" /></svg>
      </div>
      <div className="ofk-v2-welcome-center">
        <img src="/Logo_openflowkit.svg" alt="OpenFlowKit" width="48" height="48" />
        <h1>{title}</h1>
        <p>{body}</p>
        {/* One column: the button row sets its width, everything below matches it edge to edge. */}
        <div className="ofk-v2-welcome-stack">
          <div className="ofk-v2-welcome-actions">{actions}</div>
          {below}
        </div>
      </div>
      <div className="ofk-v2-guide ofk-v2-guide-view" aria-hidden="true">
        <svg viewBox="0 0 110 100"><path d="M102 9 C58 12 25 43 17 89 M8 74 Q12 86 17 91 Q25 85 31 76" /></svg>
        <span>Canvas, layers &amp; view</span>
      </div>
      <div className="ofk-v2-guide ofk-v2-guide-help" aria-hidden="true"><span>Keyboard shortcuts</span><svg viewBox="0 0 110 100"><path d="M8 9 C53 8 84 42 94 89 M82 78 Q90 87 95 91 Q101 82 102 73" /></svg></div>
    </div>
  );
}

/** A phone or tablet: no hover, a finger for a pointer. Read once; nobody swaps input mid-welcome. */
const coarsePointer = (): boolean =>
  typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia('(hover: none) and (pointer: coarse)').matches;

// Diagram as code goes first: it needs no key and no setup, opens on a starter diagram, and Generate draws it.
// The assistant needs a provider key and the agent an MCP client, so both are a second step for a first visit.
const WELCOME_ACTIONS = [modeById('code'), modeById('assistant'), modeById('agent')];

/** `blankDocument`: no page holds anything, so the document is no stop worth going Back to once a repo map opens from here. */
export function V2CanvasWelcome({ onOpen, blankDocument = false }: { onOpen: (mode: V2WorkspaceMode) => void; blankDocument?: boolean }) {
  const navigate = useNavigate();
  return (
    <V2Welcome
      testId="v2-welcome"
      title="Draw it, write it, or hand it to your agent."
      body={coarsePointer() ? 'Pick a shape from the tools to start, or one of these.' : 'Double-click anywhere to add text, or start with a shape.'}
      actions={WELCOME_ACTIONS.map(({ id, label, icon }) => (
        <Button key={id} variant="secondary" data-mode={id} onClick={() => onOpen(id)}>
          <Icon icon={icon} />
          {label}
        </Button>
      ))}
      // A repo is one more way to start: its map opens as its own document (the same field Map's start screen has).
      below={<>
        <Link className="ofk-v2-welcome-templates" to={{ pathname: '/home', search: '?view=templates' }}>or start from a template →</Link>
        <p className="ofk-v2-welcome-or" aria-hidden="true">or</p>
        {/* A blank document is not a stop on the way: Back from the map goes to where the reader came from. */}
        <MapRepoForm onMapRepo={(repo) => navigate(mapRepoPath(repo), { replace: blankDocument })} />
      </>}
    />
  );
}

export const INITIAL_CODE =
  '%% ofk 1\narchitecture\ntitle: My first diagram\n\nClient\nAPI\nDatabase [cylinder]\n\nClient -> API : request\nAPI -> Database : query';

export function V2Shortcuts({ onClose }: { onClose: () => void }) {
  return (
    <Panel title="Keyboard shortcuts" onClose={onClose} className="ofk-v2-workspace-panel" modal>
      <p className="ofk-v2-muted">Less reaching. More creating.</p>
      {shortcutGroups().map(({ title, rows }) => (
        <section className="ofk-v2-shortcut-group" key={title}>
          <h3>{title}</h3>
          {rows.map(({ label, keys }) => (
            <div key={label}>
              <span>{label}</span>
              <Kbd keys={keys} />
            </div>
          ))}
        </section>
      ))}
      <p className="ofk-v2-shortcut-footer">
        <a href={DOCS_URL} target="_blank" rel="noreferrer">Docs <Icon icon={IconArrowUpRight} /></a>
      </p>
    </Panel>
  );
}
