// AI assistant panel for the v2 editor: a conversation. Replies stream in with
// their reasoning and the agent's steps; a reply that changes diagrams carries
// its review card. Users attach images, edit and resend their turns, retry,
// copy and report replies, pick the scope (selection or page), toggle thinking
// and reopen past chats. Composes design-system parts over useV2Assistant and
// useV2Proposal; owns no document state.
import { useEffect, useEffectEvent, useRef, useState, type ReactNode } from 'react';
import {
  IconArrowUp, IconBulb, IconCheck, IconFlag, IconHistory, IconMessagePlus, IconPhoto, IconPlayerStop,
  IconRefresh, IconSearch, IconSparkles, IconStack2, IconRoute, IconTarget, IconX,
} from '@tabler/icons-react';
import { AI_PROVIDERS, sendsThinking } from '../../../services/ai/providers';
import { parseAssistantReply } from '../../application/ai/assistantPrompt';
import { assistantIssueUrl } from '../../application/ai/assistantReport';
import {
  AgentPanel, Button, Icon, IconButton, Kbd, ProposalBar, ProposalReview, type AgentMessage,
} from '../design-system';
import { MAX_IMAGES, prepareImage } from './assistantImages';
import { V2AiProviderDialog } from './V2AiProviderDialog';
import type { AssistantScope, ChatImage, ChatMessage, useV2Assistant } from './useV2Assistant';
import { activeConnection, type useV2AiSettings } from './useV2AiSettings';
import type { useV2Proposal } from './useV2Proposal';
import { Activity, ChatHistory, imageUrl, Markdown, Steps, Thinking, UserTurn, CopyButton } from './V2AgentParts';

export { CopyButton };

interface V2AgentPanelProps {
  readonly assistant: ReturnType<typeof useV2Assistant>;
  readonly proposal: ReturnType<typeof useV2Proposal>;
  readonly aiSettings: ReturnType<typeof useV2AiSettings>;
  readonly readOnly: boolean;
  /** Diagrams on the page, and how many hold the selection. */
  readonly diagramCount: number;
  readonly selectedDiagramCount: number;
  readonly onClose: () => void;
}

const BAR_LABELS = {
  working: 'Building…', ready: 'Proposal ready', stale: 'Document changed. Retry for a fresh proposal.',
  applied: 'Applied', accept: 'Apply', discard: 'Dismiss', cancel: 'Cancel', undo: 'Undo',
  failed: 'Could not apply. Nothing changed.',
};

const CREATE_STARTERS = [
  { icon: IconRoute, prompt: 'Map a user onboarding flow' },
  { icon: IconStack2, prompt: 'Sketch a three-tier web architecture' },
  { icon: IconSparkles, prompt: 'What kinds of diagrams can you make?' },
] as const;
const PAGE_STARTERS = [
  { icon: IconSearch, prompt: 'Explain this diagram in plain words' },
  { icon: IconBulb, prompt: 'Review this diagram: what is missing or unclear?' },
  { icon: IconRoute, prompt: 'Add error handling and retries' },
] as const;


export function V2AgentPanel({
  assistant, proposal, aiSettings, readOnly, diagramCount, selectedDiagramCount, onClose,
}: V2AgentPanelProps) {
  const [draft, setDraft] = useState('');
  const [providerOpen, setProviderOpen] = useState(false);
  // A send without a provider opens the dialog; connecting then sends what was typed.
  const sendOnConnect = useRef(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  // null follows the canvas: the selection when it holds a diagram, else the page.
  const [scopePick, setScopePick] = useState<AssistantScope | null>(null);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [images, setImages] = useState<readonly ChatImage[]>([]);
  const [attachError, setAttachError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const input = useRef<HTMLTextAreaElement>(null);
  const files = useRef<HTMLInputElement>(null);
  const { configured, settings } = aiSettings;
  const { messages, busy, activity } = assistant;
  const modelLabel = activeConnection(settings).model || AI_PROVIDERS.find(({ id }) => id === settings.provider)!.defaultModel;
  const scope: AssistantScope = selectedDiagramCount === 0 ? 'page' : scopePick ?? 'selection';
  const scopeText = scope === 'selection'
    ? `${selectedDiagramCount} selected ${selectedDiagramCount === 1 ? 'diagram' : 'diagrams'}`
    : diagramCount ? `This page · ${diagramCount} ${diagramCount === 1 ? 'diagram' : 'diagrams'}` : 'This page';
  const live = proposal.proposal?.id;

  const send = (): void => {
    const prompt = draft.trim();
    if ((!prompt && !images.length) || busy || readOnly) return;
    if (!configured) { sendOnConnect.current = true; setProviderOpen(true); return; }
    setDraft('');
    setImages([]);
    setAttachError(null);
    setHistoryOpen(false);
    assistant.send(prompt, scope, images);
  };
  // Opening the assistant is for typing; the panel's own focus lands on its close button first.
  useEffect(() => { input.current?.focus({ preventScroll: true }); }, []);
  const sendNow = useEffectEvent(send);
  useEffect(() => {
    if (providerOpen || !sendOnConnect.current) return;
    sendOnConnect.current = false;
    // Cancelled without a key: the prompt stays typed, unsent.
    if (configured) sendNow();
  }, [configured, providerOpen]);
  const attach = async (list: readonly File[]): Promise<void> => {
    const picked = list.filter((file) => file.type.startsWith('image/'));
    const room = MAX_IMAGES - images.length;
    setAttachError(picked.length < list.length ? 'Only images can be attached.'
      : picked.length > room ? `Up to ${MAX_IMAGES} images per message.` : null);
    const ready: ChatImage[] = [];
    for (const file of picked.slice(0, Math.max(0, room))) {
      try { ready.push(await prepareImage(file)); } catch (caught) { setAttachError(caught instanceof Error ? caught.message : String(caught)); }
    }
    if (ready.length) setImages((current) => [...current, ...ready].slice(0, MAX_IMAGES));
    input.current?.focus();
  };
  const openHistory = (open: boolean): void => {
    setHistoryOpen(open);
    if (!open) requestAnimationFrame(() => input.current?.focus());
  };
  const report = (message: ChatMessage): void => {
    const index = messages.findIndex(({ id }) => id === message.id);
    const prompt = [...messages.slice(0, index)].reverse().find(({ role }) => role === 'user')?.text ?? '';
    const steps = message.steps?.length ? `\n\nSteps:\n${message.steps.map(({ label, detail, status }) => `- ${label}${detail ? ` (${detail})` : ''}${status === 'error' ? ' [error]' : ''}`).join('\n')}` : '';
    window.open(assistantIssueUrl({
      prompt, reply: message.text + steps, provider: message.provider ?? settings.provider,
      model: message.model ?? modelLabel, ...(message.error ? { error: message.error } : {}),
    }), '_blank', 'noopener,noreferrer');
  };

  const review = (message: ChatMessage): ReactNode => {
    if (!message.proposalId) return null;
    const isLive = message.proposalId === live;
    if (isLive && (proposal.phase === 'ready' || proposal.phase === 'stale') && proposal.proposal) {
      const current = proposal.proposal;
      const label = current.scope.kind === 'selection' ? 'Scope: selected diagram' : 'Scope: this page';
      return <ProposalReview
        id={current.id} baseRevision={current.baseRevision}
        // useV2Proposal says when it is stale (the diagram changed since, not a comment); the review only compares the two.
        currentRevision={proposal.stale || proposal.phase === 'stale' ? current.baseRevision + 1 : current.baseRevision}
        scopeLabel={readOnly ? `${label} · read-only` : label}
        changes={proposal.changes} decisions={proposal.decisions}
        onDecide={proposal.decide}
        onApply={readOnly ? async () => undefined : async () => { await assistant.apply(); }}
        onDiscard={assistant.discard} onHighlight={proposal.highlight}
        labels={readOnly ? { apply: 'Read-only' } : undefined} />;
    }
    if (isLive && proposal.undoable && message.outcome !== 'undone') {
      return <ProposalBar view={{ phase: 'applied', summary: proposal.appliedSummary }} labels={BAR_LABELS}
        onAccept={async () => undefined} onDismiss={proposal.discard} onUndo={assistant.undo} />;
    }
    if (isLive && proposal.phase === 'failed') {
      return <p className="ofk-v2-outcome" data-tone="danger">{proposal.error ?? BAR_LABELS.failed}</p>;
    }
    const outcome = message.outcome === 'applied' ? 'Applied to the canvas'
      : message.outcome === 'undone' ? 'Applied, then undone'
        : message.outcome === 'discarded' ? 'Discarded' : 'Proposal expired — Retry for a fresh one';
    return <p className="ofk-v2-outcome" data-outcome={message.outcome ?? 'expired'}>
      {message.outcome === 'applied' ? <Icon icon={IconCheck} /> : null}{outcome}
    </p>;
  };

  const lastUser = [...messages].reverse().find(({ role }) => role === 'user');
  const thread: AgentMessage[] = messages.map((message) => {
    if (message.role === 'user') {
      return {
        id: message.id, role: 'user',
        content: <UserTurn message={message} busy={busy} editing={editingId === message.id}
          onEdit={() => setEditingId(message.id)} onCancel={() => setEditingId(null)}
          onResend={(text) => { setEditingId(null); if (configured) assistant.edit(message.id, text); else setProviderOpen(true); }} />,
      };
    }
    const streaming = message.status === 'streaming';
    const reply = parseAssistantReply(message.text);
    const stepRunning = message.steps?.some(({ status }) => status === 'running');
    const phase = !streaming || stepRunning ? null
      : activity === 'waiting' && message.thinking && !message.steps?.length ? null
        : activity !== 'streaming' && activity !== 'idle' ? activity
          : reply.drafting ? 'drafting' : null;
    const done = !streaming;
    return {
      id: message.id, role: 'agent',
      content: <div className="ofk-v2-reply" data-streaming={streaming || undefined}>
        <Thinking message={message} live={streaming} />
        <Steps steps={message.steps} live={streaming} />
        {reply.prose ? <Markdown text={reply.prose} /> : null}
        {phase ? <Activity phase={phase} reading={diagramCount > 0 && !message.steps?.length} /> : null}
        {!streaming && !reply.prose && !reply.blocks.length && !message.error && !message.proposalId
          ? <p className="ofk-v2-outcome">{message.status === 'stopped' ? 'Stopped.' : 'No reply.'}</p> : null}
        {message.status === 'stopped' && reply.prose ? <p className="ofk-v2-outcome">Stopped.</p> : null}
        {message.note ? <p className="ofk-v2-outcome">{message.note}</p> : null}
        {message.error ? <div className="ofk-v2-reply-error" role="alert">
          <p>{message.error}</p>
          <div className="ofk-v2-assistant-actions">
            <Button onClick={() => assistant.retry(message.id)} disabled={busy}><Icon icon={IconRefresh} />Retry</Button>
            <Button variant="quiet" onClick={() => setProviderOpen(true)}>Check provider</Button>
          </div>
        </div> : null}
      </div>,
      attachment: <>
        {review(message)}
        {done ? <div className="ofk-v2-message-actions" data-role="agent">
          <CopyButton text={reply.prose || message.text} label="Copy reply" />
          <IconButton variant="quiet" label="Retry" disabled={busy} icon={<Icon icon={IconRefresh} />} onClick={() => assistant.retry(message.id)} />
          <IconButton variant="quiet" label="Report on GitHub" icon={<Icon icon={IconFlag} />} onClick={() => report(message)} />
          {message.model ? <span className="ofk-v2-message-meta">{message.model}</span> : null}
        </div> : null}
      </>,
    };
  });

  const starters = diagramCount ? PAGE_STARTERS : CREATE_STARTERS;
  const closeProvider = (): void => {
    setProviderOpen(false);
    // The dialog unmounts rather than close()s, so the platform cannot return focus; hand it to the composer.
    requestAnimationFrame(() => input.current?.focus());
  };

  return (
    <>
      <AgentPanel
        title="AI assistant"
        onClose={onClose}
        className="ofk-v2-assistant-panel"
        data-status={busy ? 'connecting' : configured ? 'connected' : 'off'}
        tools={<>
          {assistant.chats.length ? <IconButton variant="quiet" label="Chat history" aria-pressed={historyOpen}
            icon={<Icon icon={IconHistory} />} onClick={() => openHistory(!historyOpen)} /> : null}
          {messages.length ? <IconButton variant="quiet" label="New chat" icon={<Icon icon={IconMessagePlus} />}
            onClick={() => { assistant.newChat(); setEditingId(null); setHistoryOpen(false); input.current?.focus(); }} /> : null}
          <button type="button" className="ofk-connection-badge ofk-v2-provider-badge"
            aria-label={configured ? `AI provider: ${modelLabel}. Change` : 'Connect an AI provider'}
            title={configured ? modelLabel : undefined} onClick={() => setProviderOpen(true)}>
            <span className="ofk-connection-dot" /><span className="ofk-v2-provider-model">{configured ? modelLabel : 'No provider'}</span>
          </button>
        </>}
        messages={historyOpen ? [] : thread}
        empty={historyOpen ? <ChatHistory chats={assistant.chats} activeId={assistant.activeChatId}
          onOpen={(chatId) => { assistant.openChat(chatId); setEditingId(null); openHistory(false); }}
          // The last chat gone leaves nothing to list, and no History button to leave by.
          onDelete={(chatId) => { assistant.deleteChat(chatId); if (assistant.chats.length <= 1) openHistory(false); }}
          onClose={() => openHistory(false)} /> : <div className="ofk-v2-assistant-welcome">
          <div className="ofk-v2-assistant-hero" aria-hidden="true">
            <span className="ofk-v2-assistant-hero-prompt">Map onboarding</span>
            <span className="ofk-connection-hero-link"><i /><i /><i /></span>
            <span className="ofk-v2-assistant-hero-diagram">
              <span className="ofk-v2-assistant-mark"><Icon icon={IconSparkles} /></span>
              <i /><i /><i />
            </span>
          </div>
          <h3>{diagramCount ? 'Ask about this page, or change it.' : 'From a thought to a clear picture.'}</h3>
          <p className="ofk-connection-lede">
            {configured
              ? 'Talk it through, ask for a review, or describe a change. Edits arrive as proposals you approve.'
              : 'Bring your own key — Gemini, Claude, OpenAI, Ollama and six more — and describe the diagram you need.'}
          </p>
          {!configured ? <>
            <Button variant="primary" onClick={() => setProviderOpen(true)}><Icon icon={IconSparkles} />Connect a provider</Button>
            <span className="ofk-model-welcome-note">Your key stays on this machine.</span>
          </> : null}
          <h4 className="ofk-connection-heading">Try</h4>
          <ul className="ofk-v2-assistant-starters">
            {starters.map(({ icon, prompt }) =>
              <li key={prompt}><Button variant="quiet" onClick={() => { setDraft(prompt); input.current?.focus(); }}>
                <Icon icon={icon} />{prompt}
              </Button></li>)}
          </ul>
        </div>}
        composer={
          <div className="ofk-v2-prompt-box" data-busy={busy || undefined} data-dragging={dragging || undefined}
            onDragOver={(event) => {
              if (readOnly || !event.dataTransfer.types.includes('Files')) return;
              event.preventDefault();
              setDragging(true);
            }}
            onDragLeave={(event) => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDragging(false); }}
            onDrop={(event) => {
              if (!event.dataTransfer.files.length) return;
              event.preventDefault();
              setDragging(false);
              void attach([...event.dataTransfer.files]);
            }}>
            {images.length ? <ul className="ofk-v2-attachments" aria-label="Attached images">
              {images.map((image, index) => (
                <li key={index}>
                  <img src={imageUrl(image)} alt={image.name || 'Attached image'} />
                  <IconButton variant="quiet" label={`Remove ${image.name || 'image'}`} icon={<Icon icon={IconX} />}
                    onClick={() => { setImages((current) => current.filter((_, at) => at !== index)); input.current?.focus(); }} />
                </li>
              ))}
            </ul> : null}
            {attachError ? <p className="ofk-v2-attach-error" role="alert">{attachError}</p> : null}
            <textarea ref={input} aria-label="Ask AI assistant" rows={2}
              placeholder={readOnly ? 'Read-only document' : messages.length ? 'Reply, or ask for a change…' : 'Ask, review, or describe a diagram…'}
              value={draft} disabled={readOnly}
              onChange={(event) => setDraft(event.target.value)}
              onPaste={(event) => {
                const pasted = [...event.clipboardData.files].filter((file) => file.type.startsWith('image/'));
                if (!pasted.length) return;
                event.preventDefault();
                void attach(pasted);
              }}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
                  event.preventDefault();
                  send();
                } else if (event.key === 'Escape' && busy) {
                  event.stopPropagation();
                  assistant.stop();
                } else if (event.key === 'ArrowUp' && !draft && !images.length && lastUser && !busy && !historyOpen) {
                  event.preventDefault();
                  setEditingId(lastUser.id);
                }
              }} />
            <div>
              <input ref={files} type="file" accept="image/png,image/jpeg,image/webp,image/gif" multiple hidden
                aria-label="Attach images" data-testid="assistant-attach-input"
                onChange={(event) => { void attach([...(event.target.files ?? [])]); event.target.value = ''; }} />
              <IconButton variant="quiet" label="Attach images" disabled={readOnly || images.length >= MAX_IMAGES}
                icon={<Icon icon={IconPhoto} />} onClick={() => files.current?.click()} />
              <button type="button" className="ofk-v2-chip" data-active={scope === 'selection' || undefined}
                disabled={selectedDiagramCount === 0}
                aria-label={`Scope: ${scopeText}. ${selectedDiagramCount ? 'Switch scope' : 'Select a diagram to narrow the scope'}`}
                title={selectedDiagramCount ? 'Switch between the selection and the whole page' : 'Select a diagram to work on just that one'}
                onClick={() => setScopePick(scope === 'selection' ? 'page' : 'selection')}>
                <Icon icon={scope === 'selection' ? IconTarget : IconStack2} /><span>{scopeText}</span>
              </button>
              {sendsThinking(settings.provider) ? <button type="button" className="ofk-v2-chip" aria-pressed={assistant.think}
                data-active={assistant.think || undefined}
                title="Let the model reason before it answers. Slower, better on hard asks."
                onClick={() => assistant.setThink(!assistant.think)}>
                <Icon icon={IconBulb} />Think
              </button> : null}
              <span className="ofk-v2-prompt-spacer" />
              {!busy && (draft.trim() || images.length) ? <span className="ofk-v2-prompt-hint"><Kbd keys="Enter" /></span> : null}
              {busy
                ? <IconButton variant="secondary" label="Stop" icon={<Icon icon={IconPlayerStop} />} onClick={assistant.stop} />
                : <IconButton variant="primary" label="Send prompt" disabled={readOnly || (!draft.trim() && !images.length)}
                  icon={<Icon icon={IconArrowUp} />} onClick={send} />}
            </div>
          </div>
        }
      />
      {providerOpen ? <V2AiProviderDialog open settings={settings}
        onSave={(next) => { aiSettings.save(next); }}
        onClose={closeProvider} /> : null}
    </>
  );
}
