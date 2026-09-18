# Rasuko — Architecture

Rasuko is an Electron desktop app that feels as simple as Notepad on launch: a blank,
unlimited creation canvas built from responsive pages, not a spatial canvas.

## 1. Core principles

1. **Pages, not canvases.** The writing surface is a vertical, responsive document — it wraps
   and reflows to any window width. There is no pan/zoom coordinate space.
2. **Every page is a View.** A page renders a *View*: a deterministic component tree.
   The built-in `barebones` view is a plain rich-text document.
3. **Content is never Markdown.** Content lives in a structured, ID-addressed store.
   Markdown is only an *input affordance* (can be toggled) and an *export* format.
4. **Content survives redesign.** Content records are keyed by stable IDs. A View *binds* to
   records. Redesigning the View never rewrites content. If a binding disappears, the record
   is marked `orphaned` (never deleted) and can be re-attached later — self-correction.
5. **Views are deterministic compositions.** The AI never emits arbitrary HTML/CSS/JS.
   It emits *view ops* against a closed component registry with typed props.
6. **AI works on ordinary files.** The assistant uses `read` / `write` / `grep` (and `ls`)
   over the workspace directory. No MCP layer.
7. **Sleek by subtraction.** Iconify `mingcute` only. No redundant titles. No custom SVG icons.
   No app icon — the wordmark "Rasuko" is the identity.

## 2. Workspace on disk

Root: `~/.rasuko` (override with `RASUKO_HOME`).

```
~/.rasuko/
├── auth.json              # credentials, safeStorage-encrypted
├── rasuko.conf            # settings JSON (same envelope style as Mousse)
└── workspace/
    ├── workspace.json     # index: projects -> pages, view registry pointers, record index
    ├── projects/
    │   └── <projectId>/
    │       ├── project.json
    │       ├── pages/
    │       │   └── <pageId>.page.json     # { page meta, viewId, layout }
    │       ├── views/
    │       │   └── <viewId>.view.json     # deterministic Node tree (the UI)
    │       ├── records/
    │       │   └── <recordId>.rec.json    # the content (ID-bound, structured)
    │       └── chats/<pageId>/
    │           ├── index.json           # active conversation and history list
    │           └── <conversationId>.chat.json
    └── shared/
        └── views/<viewId>.view.json       # reusable Views across projects
```

The split is deliberate: **views** describe *presentation*, **records** describe *content*,
**pages** wire them together. This is what makes content redesign-proof, and it makes every
file greppable by the AI with ordinary file tools.

## 3. Content model (structured, not Markdown)

A **Record** is the atomic content unit. Every record has a stable ID (`rec_<ulid>`).

```ts
type RecordKind = 'richtext' | 'table' | 'list' | 'metric' | 'fields'

interface BaseRecord { id: string; kind: RecordKind; label?: string; createdAt: string; updatedAt: string; orphaned?: boolean; orphanedAt?: string; origin?: string }

interface RichTextRecord extends BaseRecord { kind: 'richtext'; doc: RichDoc }
```

### RichDoc — inline-run blocks with stable IDs

```ts
interface RichDoc { type: 'doc'; blocks: Block[] }

type Block =
  | { id: string; type: 'paragraph'; runs: Run[] }
  | { id: string; type: 'heading'; level: 1 | 2 | 3; runs: Run[] }
  | { id: string; type: 'bullet' | 'numbered' | 'todo'; checked?: boolean; runs: Run[]; indent?: number }
  | { id: string; type: 'quote'; runs: Run[] }
  | { id: string; type: 'code'; language?: string; text: string }
  | { id: string; type: 'callout'; tone?: 'info' | 'success' | 'warning' | 'danger'; runs: Run[] }
  | { id: string; type: 'divider' }
  | { id: string; type: 'image'; src: string; alt?: string }
  | { id: string; type: 'table'; header: boolean; rows: Run[][][] }

interface Run { text: string; marks?: Mark[] }
type Mark = 'bold' | 'italic' | 'strike' | 'code' | { link: string } | { color: string }
```

Rules:
- **Every block has a stable ID.** Blocks are the binding granularity for custom Views
  (`bind: { recordId, blockIds }`), so a dashboard can surface a single paragraph or heading.
- `table` records use `RecordKind: 'table'` with a typed column schema, not a richtext table,
  when they are meant as data entry.
- Markdown is *rendered* from this model on demand (`richDocToMarkdown`) and *parsed* into it
  (`markdownToRichDoc`). Neither is the storage format.

### Serialization / ordering

- Blocks are ordered arrays (order is inherent).
- Splitting/merging blocks during editing mints new IDs only for genuinely new blocks; a split
  keeps the original ID on the left half and mints for the right. This keeps bindings stable.

## 4. View model (deterministic component architecture)

```ts
interface ViewDoc {
  id: string;               // vw_<ulid>
  name: string;
  kind: 'barebones' | 'custom';
  version: 1;
  root: Node;
  tags?: string[];
  author?: string;
  description?: string;
}

interface Node {
  id: string;               // nd_<ulid> — stable, referenced by chat actions
  type: ComponentType;      // closed registry
  props?: Record<string, unknown>;
  bind?: Binding;           // optional content binding
  children?: Node[];
  // layout hints (deterministic, no free CSS)
  span?: 1 | 2 | 3 | 4 | 6 | 8 | 12;
  when?: string;            // optional simple expression for conditional visibility
}

interface Binding {
  recordId: string;
  blockIds?: string[];      // partial binding to specific blocks
  field?: string;           // for non-richtext records
  mode?: 'value' | 'editor' | 'list';
}
```

### Closed component registry

Defined in `src/shared/viewSchema.ts` with typed prop schemas. Two families:

**Layout** — `page`, `stack`, `row`, `grid`, `columns`, `section`, `tabs`, `divider`, `spacer`.

**Content / purpose-built** — `heading`, `text`, `rich`, `field`, `fields`, `metric`,
`metrics`, `table`, `kanban`, `list`, `checklist`, `progress`, `chart.bar`, `chart.line`,
`chart.donut`, `calendar`, `timeline`, `callout`, `image`, `badge`, `button`, `keyvalue`,
`code`, `quote`, `gallery`, `embed`.

Each registry entry declares:
```ts
interface ComponentSpec {
  type: ComponentType;
  label: string;                    // UI picker label
  icon: string;                     // mingcute icon name
  category: 'layout' | 'content' | 'data' | 'media';
  accepts: ComponentType[] | 'any' | null;  // children constraint
  bindable: false | RecordKind[] | 'block';
  props: Record<string, PropSpec>;  // typed props only
  example?: Partial<Node>;
}
```

`PropSpec` supports: `string`, `number`, `boolean`, `enum`, `color`, `icon`, `node[]`,
`string[]`. Anything not declared is rejected by `validateView()`.

### View ops — how the AI edits a View

The AI never rewrites HTML. It emits an ordered array of ops, applied by `applyViewOps`:

```ts
type ViewOp =
  | { op: 'setRoot'; node: Node }
  | { op: 'insert'; parent: string; index?: number; node: Node }
  | { op: 'replace'; target: string; node: Node }
  | { op: 'remove'; target: string }
  | { op: 'move'; target: string; parent: string; index?: number }
  | { op: 'setProps'; target: string; props: Record<string, unknown> }
  | { op: 'setSpan'; target: string; span: number }
  | { op: 'setBind'; target: string; bind: Binding | null }
  | { op: 'setName'; name: string }
  | { op: 'setKind'; kind: 'barebones' | 'custom' }
```

`applyViewOps` is total: unknown target IDs are skipped and reported, so a stale plan degrades
gracefully instead of corrupting a View. Every op result is reported back to the chat as a
receipt (`{ applied, skipped, orphaned }`).

### Graceful fallback + self-correction

- When a View op removes or replaces a node that had `bind`, the binding's record is **not**
  deleted. `reconcileBindings()` marks unreferenced records `orphaned: true` with `orphanedAt`.
- Orphaned records appear in the Assistant as **Unplaced content** with actions:
  **Reattach**, **Move into…**, **Keep as note**. Reattaching writes a `setBind` op.
- **Contextual chat actions on a single element**: each node exposes a small `⋯` menu →
  *Ask AI about this*, *Reassign content*, *Extract to new page*. These produce a targeted
  prompt carrying the node id + binding, so the AI edits narrowly instead of redesigning.
- `barebones` → `custom` migrations and back are lossless because content lives in records.

## 5. AI architecture

### Provider layer (ported from Mousse, simplified)

- `@earendil-works/pi-ai` for the model catalog + streaming (`builtinModels`, `builtinProviders`,
  `models.streamSimple`).
- Credentials in `~/.rasuko/auth.json`, encrypted via Electron `safeStorage` when available,
  written atomically with mode `0600`, corrupt files quarantined rather than destroyed.
- Supported auth: API key, OAuth (where pi-ai exposes it), ambient env keys, and
  OpenAI-compatible custom base URLs with dynamic `/models` discovery.

### Chat runtime (main process)

`ChatService` owns multiple saved conversations per page, streams assistant text + thinking +
tool calls to the renderer over IPC, and runs a tool loop. The Assistant's History menu starts
new conversations and resumes previous ones. Legacy `<pageId>.chat.json` transcripts are
imported without deleting the original file. Events carry page, conversation, and turn IDs;
the renderer retains active drafts while navigating between pages.

Persisted tool arguments and results are reconstructed into paired model messages. The
current page context is refreshed before each tool round, and pending editor writes are
awaited before sending a prompt. Model-facing tool history is bounded; disk transcripts
retain the full audit receipts. Tools available to the model:

| Tool | Purpose |
|---|---|
| `read` | read any workspace file (views, records, pages) |
| `write` | write a workspace file |
| `grep` | ripgrep-style content search over the workspace |
| `ls` | list workspace entries |
| `view_get` | return a page's current ViewDoc + bindings + orphaned records |
| `view_inspect` | resolve bindings, action targets, fields and supported interactions |
| `view_applyOps` | apply deterministic ViewOps (validated against the registry) |
| `record_create` / `record_update` | create/update structured content records |
| `record_action` | typed record actions or undo, with revisions and fresh inspection |
| `record_list` | list content records (including orphaned) |
| `page_info` | list projects and pages |

Tool ids are OpenAI-safe (`[a-zA-Z0-9_-]+`): dotted names are rejected by
OpenAI-compatible providers, so the underscored form is the canonical one the
model is told about and the transcript records.

Managed JSON writes validate and ingest files through `WorkspaceStore`, updating cached
metadata and bindings before broadcasting the new state. The closed registry constrains
the UI structure. Complete resulting Views, typed records and semantic action/field targets
are validated before publication. Records and Views carry revisions; stale guarded writes
are rejected. Page instantiation clones bound data and remaps IDs. Field renaming migrates
name-based references to stable IDs across the project in the same publication.

Related workspace writes use durable before/after file checkpoints, conflict checks and
startup recovery. `applyViewPlan` publishes records, View operations, adoption and
reconciliation in one recoverable batch; the offline planner uses it. This is not OS-level
multi-file atomicity. An online assistant turn can still contain separately committed tool
calls. Whole-turn preview/rollback, automatic-apply preference handling and full multi-client
concurrency remain unfinished.

### View Architect flow

1. User asks in the Assistant: *"make this a project tracker with a status board"*.
2. `ChatService` builds context: current `ViewDoc`, the component registry (compact form),
   the page's record index (ids, kinds, labels, block ids).
3. The model reads current data and uses file tools, `record_action` and `view_applyOps`.
   New node IDs can be omitted and assigned by the runtime.
4. Changes are validated and return receipts plus resolved inspection. The renderer updates
   its shared records. The model is instructed to inspect before claiming success.
5. Any newly orphaned records are surfaced for reattachment.

Without a configured provider the app still works: `ViewArchitect.localPlan()` provides a
deterministic heuristic planner so the sample app demonstrates the full loop offline.

## 6. Renderer architecture

- **Svelte 5 (runes) + Tailwind v4 + sv-router** with shadcn-svelte-style primitives (bits-ui).
- `sv-router` in **hash mode** (required inside Electron `file://`).
- Three panes, all collapsible and resizable:
  `Sidebar (projects → pages) | Page surface | Assistant`.
- Icons: `@iconify/svelte` with `@iconify-json/mingcute` only. The one exception is
  provider brand marks in the model selector (`lib/components/ProviderIcon.svelte`),
  which port Mousse's vendor logos and fall back to a monogram.
- Theme: `data-theme` on `<html>`, OKLCH design tokens, light/dark/system.
- The wordmark uses **Outfit 600** with `letter-spacing: -0.02em` — identical treatment to
  Mousse. The font is bundled locally; its license ships in `out/renderer/licenses/`.
- The Markdown toggle controls syntax recognition for the current page. The editor always
  renders structured rich text; disabling shortcuts never switches to a source textarea or
  reparses saved content through Markdown.

### Assistant transcript (21st.dev Agent Elements, ported)

The assistant transcript is a Svelte port of the **21st.dev Agent Elements** chat surface
that Mousse vendors in `../mousse/src/renderer/chat/components/agent-elements`, mounted the
same way: the agent library owns turn grouping and tool-card dispatch, while the app keeps
its own composer. See `src/renderer/lib/chat/agent-elements/`.

- `MessageList.svelte` — turn grouping, streaming follow, jump-to-latest, and the
  scrollbar prompt dots. Prompt markers recompute in an isolated overlay so layout
  reads never re-render the list.
- `ToolRow.svelte` dispatches each tool call to a specialised card: `SearchRow`
  (read / grep / ls, console panel), `EditRow` (write, file card), `PlanRow`
  (`view.applyOps`, op list + receipt), `ThinkingRow` (reasoning), and
  `GenericToolRow` for the record/page tools.
- `ToolRowBase`, `ToolCallsGroup`, `TextShimmer`, `CopyButton` are the shared
  primitives; `agent-ui.css` re-expresses the upstream `--an-*` tokens and the
  shimmer/markdown rhythm on top of Rasuko's OKLCH tokens, so the assistant looks
  like the app rather than a bolted-on widget.
- `AssistantMarkdown.svelte` renders assistant prose from `markdown.ts`, a small
  dependency-free parser (headings, lists, fenced code, quotes, inline marks).
  No Markdown library and no `{@html}`.

### Editor

- Block-based: editable blocks use `contenteditable` with structured inline runs.
  This makes stable IDs, partial bindings, and diffing natural.
- Live formatting: typing `**bold**`, `*italic*`, `` `code` ``, `# heading`, `- list`,
  `1. `, `> quote`, `---` renders in place on the confirming keystroke (Markdown mode ON).
- Slash commands: `/` opens a mingcute-iconed command menu (blocks, headings, tables,
  callouts, toggles, view redesign prompts).
- Inline selection bubble: bold / italic / strike / code / link / ask AI / reattach.
- Bound headings, text and partial rich-document projections are editable in place. Saves
  merge by block ID against a fresh record and serialize per record, preserving hidden blocks.
- Forms, tables, board cards and metrics expose direct inputs. Generated custom layouts put
  residual prose in a Notes section that starts collapsed.

### Shared interface interactions

- `recordActions.ts` defines serializable field/row/list/metric operations. The main process
  reads the latest record, applies the targeted action and validates it.
- `RecordActionService` keeps a bounded persistent action journal. Undo restores stable IDs,
  survives restart and refuses to overwrite intervening edits. It is record-action undo,
  not whole-redesign undo.
- `TypedField`, creation/detail editors and a persistent renderer action queue are reused by
  forms, tables, boards and metrics. Failed edits remain visible and retryable.
- `tableQuery.ts` provides typed filters, sorting, grouping with empty options and numeric
  aggregates without arbitrary code evaluation. Boards and tables share their source rows.
- Kanban is one registry component over a table, with no separate application data model.
  It exposes typed card editing, creation, duplicate/archive/restore/delete/undo, drag and
  keyboard ordering, lane management, search, one field filter, sorting and counts/WIP.
- The flush barrier covers chat, navigation and native close. Form drafts live separately
  in local storage under project/View/record/projection keys. Filters, open details and sort
  selection remain transient per component.
- View settings expose registry properties, compatible record/block bindings and field
  labels. Field IDs remain stable when labels change.

## 7. Reuse and marketplace foundations

- `ViewDoc` carries a registry version and authorship metadata and is deterministic JSON.
- Page copies instantiate independent bound records with remapped IDs, including across
  projects. This is working instance copying, not a portable binding-slot package format.
- The existing `.rasukoview` export contains the View definition; it is not a complete
  package of schemas, assets and installation logic. Portable install/update, a library
  picker, project import/export, synchronization and distribution remain future work.
- The registry is closed: generated Views compose approved components, not executable
  HTML/CSS/JavaScript.

## 8. Non-goals (sample scope)

- No app icon, no custom SVG identity marks.
- No collaborative sync server yet. Deterministic files are a foundation; reproducibility
  across clients still needs tested packaging/import and synchronization semantics.
- No MCP.
