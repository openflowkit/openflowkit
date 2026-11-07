---
title: Home and templates
description: Home lists your diagrams, imports files and offers twelve starter templates — real diagrams you open and change, no API key needed.
---

Home is where your diagrams are listed. Open it from the canvas menu (☰) → **Back to home**, or
go to `app.openflowkit.com/#/home`. Opening the app's address without a path takes you back to
the last document you had open, or starts a new one.

## Ways in

On a first visit, Home offers four starts:

| Card | What it opens |
| --- | --- |
| **Blank canvas** | An empty document, to draw by hand |
| **Describe it to AI** | A new document with the [AI assistant](/ai-generation/) open |
| **Paste code or Mermaid** | A new document with the [code panel](/openflow-dsl/) open; OpenFlow DSL, Mermaid, D2 and Structurizr all work |
| **Connect your agent** | A new document with the [Connect agent](/connect-your-agent/) panel open |

Below them, **Or start from a template** shows the templates. **Import** (or dropping files
anywhere on Home) brings in `.json` documents, Excalidraw drawings and diagram text files; see
[Local-first diagramming](/local-first-diagramming/#opening-and-importing-files).

## Templates

Each template is a finished diagram written in OpenFlow DSL. Picking one opens a new document
with it generated, so you can change the text or the canvas straight away. The originals never
change.

| Template | Family | What it shows |
| --- | --- | --- |
| **Shop architecture** | architecture | One C4 model drawn as a system map, an overview and its services, with a checkout flow you can play back |
| **Three-tier web app on AWS** | architecture | Route 53 and CloudFront at the edge, Fargate services behind a load balancer, RDS, ElastiCache and S3 |
| **RAG chatbot** | architecture | A chat UI and RAG API answering from a pgvector store with Claude, fed by a nightly ingest |
| **Microservices on Kubernetes** | architecture | NGINX ingress, Go, Node and Python services, Kafka events, Postgres, Redis and Stripe |
| **Event pipeline** | architecture | App events and Postgres CDC into Kafka, enriched by Flink into Snowflake, ClickHouse and S3, with a dead-letter queue |
| **CI/CD pipeline** | flowchart | Pull request to production: checks, staging, end-to-end tests, a health gate and automatic rollback |
| **Sign in with Google** | sequence | The OAuth 2.0 authorization-code flow with PKCE |
| **Request lifecycle** | sequence | An API request through the gateway, token check and order service, with an `alt` fragment |
| **SaaS data model** | erd | Organizations, users and memberships, projects, and Stripe subscriptions with invoices |
| **Order state machine** | state | Cart to delivery, with declined payments, cancellations and refunds |
| **User authentication** | flowchart | SSO or password, a lockout after failed tries, and an optional two-factor step |
| **Purchase approval** | flowchart | A request routed to a manager or finance by amount, with a revise loop |

This is the source of **Purchase approval**:

```openflow
%% ofk 1
flowchart right
title: Purchase approval

Request [rounded, emerald, label: "Request submitted"]
Budget [diamond, amber, label: "Over $5,000?"]
Manager [label: "Manager reviews"]
Finance [label: "Finance reviews"]
Decision [diamond, amber, label: "Approved?"]
Order [rounded, emerald, label: "Purchase order sent"]
Revise [label: "Requester revises"]

Request -> Budget
Budget -> Manager : no
Budget -> Finance : yes
Manager -> Decision
Finance -> Decision
Decision -> Order : yes
Decision -> Revise : no
Revise -> Budget
```

Agents get the same twelve: the MCP tools `list_starter_templates` and `get_starter_template`
return them by name, so an agent can start from one without writing DSL from scratch.

## Your diagrams

The sidebar has **Recents**, **Starred**, **Templates**, **Archive** and **What's new**.

| Key | On Home |
| --- | --- |
| `N` | New diagram |
| `/` | Filter the list by name |
| `⌘K` | Find any diagram, template or action |
| `S` | Star or unstar the focused diagram |
| `F2` | Rename the focused diagram |
| `⌘A` | Select every diagram in the list |
| `Delete` | Archive the selection; in **Archive**, delete it for good (after a confirmation) |
| `Esc` | Clear the selection |
| `?` | The list of keys |

Archiving takes a diagram off your list without deleting it; restore it from **Archive**.

## What it does not do

- **No folders or tags for diagrams.** Star the ones you use, and archive the rest.
- **No custom templates.** To reuse a diagram, duplicate it or keep its DSL somewhere and paste
  it into the code panel.
- **No sync.** Home lists the documents in this browser only.

## Where to go next

- [Quick start](/quick-start/): draw, write and export in five minutes.
- [OpenFlow DSL](/openflow-dsl/): the language every template is written in.
- [Architecture (C4)](/architecture-c4/): the model behind **Shop architecture**.
