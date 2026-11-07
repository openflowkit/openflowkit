import { IconHierarchy2, IconKeyboard, IconMoon, IconPlus, IconSparkles, IconSpeakerphone, IconSun, IconTemplate, IconUpload } from '@tabler/icons-react';
import type { RefObject } from 'react';
import { Icon } from '../design-system';
import type { Command } from '../design-system/CommandPalette';
import type { V2DocumentSummary } from '../../../services/storage/v2/v2Repository';
import { STARTER_TEMPLATES } from '../../../agent/starterTemplates';
import { CHIP_ICON } from './V2HomeCards';
import type { V2StartIntent } from './v2Document';
import { STARTS, VIEWS, viewLink } from './homeConfig';

interface HomeCommandContext {
  readonly documents: readonly V2DocumentSummary[] | null;
  readonly dark: boolean;
  readonly fileRef: RefObject<HTMLInputElement>;
  readonly create: (intent?: V2StartIntent) => void;
  readonly navigate: (to: string | { readonly search: string }) => void;
  readonly openDialog: (dialog: 'pro' | 'keys') => void;
  readonly setTheme: (theme: 'light' | 'dark') => void;
}

/** ⌘K: every way to create, go somewhere, or change a setting from Home. */
export function buildHomeCommands({ documents, dark, fileRef, create, navigate, openDialog, setTheme }: HomeCommandContext): Command[] {
  return [
  { id: 'new', group: 'Create', label: 'New diagram', shortcut: 'N', icon: <Icon icon={IconPlus} />, run: () => create() },
  ...STARTS.filter(({ intent }) => intent).map(({ kind, title, intent }) => ({
    id: `start-${kind}`, group: 'Create', label: title, icon: <Icon icon={CHIP_ICON[kind]} />, run: () => create(intent),
  })),
  { id: 'import', group: 'Create', label: 'Import a file…', icon: <Icon icon={IconUpload} />, keywords: ['open', 'json', 'excalidraw', 'mermaid', 'd2'], run: () => fileRef.current?.click() },
  ...VIEWS.map(({ view: target, title, icon }) => ({
    id: `view-${target}`, group: 'Go to', label: title, icon: <Icon icon={icon} />, run: () => navigate(viewLink(target)),
  })),
  ...(documents ?? []).map(({ id, name }) => ({
    id: `doc-${id}`, group: 'Diagrams', label: name, icon: <Icon icon={IconHierarchy2} />, run: () => navigate(`/d/${id}`),
  })),
  ...STARTER_TEMPLATES.map(({ name, title }) => ({
    id: `template-${name}`, group: 'Templates', label: title, keywords: ['template'], icon: <Icon icon={IconTemplate} />,
    run: () => create({ template: name }),
  })),
  { id: 'view-news', group: 'Go to', label: 'What’s new', icon: <Icon icon={IconSpeakerphone} />, run: () => navigate(viewLink('news')) },
  { id: 'pro', group: 'Go to', label: 'OpenFlowKit Pro: join the waitlist', keywords: ['pricing', 'team', 'upgrade'], icon: <Icon icon={IconSparkles} />,
    run: () => openDialog('pro') },
  { id: 'theme', group: 'Settings', label: dark ? 'Switch to light theme' : 'Switch to dark theme', icon: <Icon icon={dark ? IconSun : IconMoon} />,
    run: () => setTheme(dark ? 'light' : 'dark') },
  { id: 'keys', group: 'Help', label: 'Keyboard shortcuts', shortcut: '?', icon: <Icon icon={IconKeyboard} />, run: () => openDialog('keys') },
  ];
}
