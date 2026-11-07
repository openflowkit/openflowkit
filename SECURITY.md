# Security Policy

## Supported Versions

Security fixes land on the latest `main` and the hosted app at app.openflowkit.com. Older commits, forks
and self-hosted copies that have not pulled the fix are not patched separately.

The MCP server and CLI (`openflowkit` on npm) are versioned on their own; fixes ship in its latest npm release.

## Reporting a Vulnerability

Please do **not** open a public GitHub issue for a security vulnerability.

Instead, report it here:

- https://docs.google.com/forms/d/e/1FAIpQLSd0hE_WTHEM8frJyZ_WlDQI8jrkGNpFu3RGCiJCmC-xp-Wm6g/viewform

When possible, include:

- a short description of the issue
- impact and affected surface
- reproduction steps
- browser/environment details
- proof-of-concept material if safe to share

## Scope Notes

OpenFlowKit is a browser-first, local-first application. Relevant security areas include:

- persisted local application data
- imported files (`.json`, Excalidraw, Mermaid, D2, Structurizr), pasted clipboard data, and exports
- AI provider API key handling
- the local agent bridge between the editor and the MCP server
- encrypted share links and the share Worker (`worker/`)
- reading public GitHub repositories in the browser (repo → diagram, repo maps)
- rendering of third-party icon artwork

## Data Storage Model

Documents and keys stay in your browser. The only OpenFlowKit server is the share service: it holds the
ciphertext of a diagram you chose to share (below), basic usage stats (turn them off in Settings), and feedback
you send. No key and no readable diagram is sent to the
project. A hosted remote MCP endpoint is planned; it is not running today.

### Diagram data

Documents live in this browser's **IndexedDB** (`openflowkit-persistence`), with the last good copy kept for
crash recovery. They leave the browser only when you export them, make a share link, send a diagram to an AI
provider, or connect an agent (below).

### Share links

**Copy share link** encrypts the whole document in your browser (AES-GCM, a fresh 256-bit key per link) and uploads
only the ciphertext to `share.openflowkit.com`. The key sits in the link's `#` fragment, which browsers never send
to a server, so the store cannot read the diagram. The human check is Cloudflare Turnstile: its script loads from
`challenges.cloudflare.com` only when you make a link, never on page load. Opening a link downloads the ciphertext
and decrypts it locally. Details: [share links](docs-site/src/content/docs/share-links.md).

### AI provider API keys (bring your own key)

- Keys are entered in the AI assistant's provider dialog and stored in this browser's **localStorage**
  (`openflowkit-v2-ai`).
- Requests go **directly from your browser to the provider you chose** (Anthropic, OpenAI, Google Gemini, Groq,
  NVIDIA, Cerebras, Mistral, OpenRouter, Ollama or any OpenAI-compatible endpoint), and only to that one.
  Nothing is proxied.
- Keys are never logged and never written into exports or documents.

### Agent bridge (MCP)

When you press **Connect** in the Connect agent panel, the editor long-polls the MCP server on
`127.0.0.1` (default port 43119). The server checks the request origin and, when
`OPENFLOWKIT_BRIDGE_TOKEN` is set, a token. Agent edits apply as ordinary undoable commands.

### Other network requests

- Icon artwork (AWS, Azure, GCP, CNCF, developer icons) ships with the app; no icon request leaves the site.
- Home asks GitHub's public API (`api.github.com`) for the repository's star count at most once a day, without
  credentials.
- Repo → diagram (`#/from/github/…`) and repo maps (`#/map/github/…`) read a public repository from
  `api.github.com` (the file list) and `raw.githubusercontent.com` (the files). An optional GitHub token you paste
  is kept in this tab's sessionStorage and sent to `api.github.com` only, never to raw file downloads.
- An image you insert by URL is loaded from that URL.

## Response Policy

The maintainers will review reports and aim to:

1. confirm the issue
2. assess severity and impacted surfaces
3. prepare a fix or mitigation
4. ship the patch on the latest supported code line

Response and remediation timing is best effort and depends on issue severity and maintainer availability.

