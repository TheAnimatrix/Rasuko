<p align="center">
  <img src="src/renderer/assets/rasuko-logo-3d.png" alt="Rasuko logo" width="240">
</p>

<h1 align="center">Rasuko</h1>

<p align="center">
  A blank writing space that can grow into the interface you need.
</p>

<p align="center">
  <a href="https://github.com/TheAnimatrix/Rasuko/releases/latest">Download for Windows</a>
  ·
  <a href="ROADMAP.md">Roadmap</a>
  ·
  <a href="ARCHITECTURE.md">Architecture</a>
</p>

**Rasuko** (రాసుకో, Telugu for “write it down”) is an experimental desktop workspace that begins like a simple notes app. Each page can stay a quiet rich-text document or become a purpose-built interface—a board, table, form, dashboard, timeline, or another structured view—through direct editing and conversation with an AI assistant.

The central idea is simple: **your content and its presentation are separate**. Notes and data live in structured records with stable IDs, while a *View* decides how those records appear. Changing a page from notes into a Kanban board, or redesigning a dashboard, does not require rewriting or throwing away the underlying content.

> Rasuko is early-stage software. The core workspace, editing, generated Views, and Windows packaging work today, but some portability, recovery, collaboration, and polish work remains. See the [roadmap](ROADMAP.md) for the honest project status.

## What you can do

- **Start with a blank page.** Write immediately in a responsive, document-style canvas—no spatial canvas, pan, or zoom.
- **Create richer interfaces with AI.** Ask the page assistant to turn information into structured layouts such as Kanban boards, tables, forms, metrics, charts, calendars, timelines, and galleries.
- **Edit the result directly.** Work with rich text, fields, tables, board cards, lanes, filters, and other generated controls without returning to the prompt for every change.
- **Keep content through redesigns.** Views bind to stable records instead of owning the data. Removed bindings become recoverable orphaned content rather than silent deletion.
- **Use a model you connect.** Rasuko includes provider settings, model selection, saved per-page conversations, cancellation, and resumable chat history.
- **Own ordinary local files.** Projects, pages, Views, records, and conversations are stored as inspectable JSON files in the local workspace.

## How Rasuko works

```text
Page
 ├─ View       presentation: layout, components, and bindings
 └─ Records    content: rich text, tables, lists, metrics, and fields
```

Every page renders a deterministic component tree from a closed, typed registry. The assistant changes that tree through validated View operations rather than generating arbitrary application code. The same record can be projected into an editor, table, board, metric, or another compatible component.

This architecture is designed to make AI-assisted interface creation useful without making user content disposable. More detail is available in [ARCHITECTURE.md](ARCHITECTURE.md).

## Current capabilities

Rasuko currently includes:

- Electron desktop shell with project and page navigation
- rich-text editing, formatting, Markdown shortcuts, and slash commands
- structured rich-text, table, list, metric, and field records
- reusable deterministic Views with validated bindings
- per-page AI conversations and model/provider settings
- direct editing for generated forms, tables, metrics, and Kanban boards
- Kanban card creation, details, drag-and-drop ordering, lanes, archive/restore, search, filtering, and sorting
- file-backed persistence, guarded writes, revision checks, and recovery foundations
- light and dark themes with a compact desktop interface

## Install

Download the latest Windows x64 installer from [GitHub Releases](https://github.com/TheAnimatrix/Rasuko/releases/latest).

The installer is currently unsigned, so Windows may show a SmartScreen warning. Review the repository and release details before choosing to run it.

## Run from source

### Requirements

- Node.js 22.19 or newer
- npm

```bash
git clone https://github.com/TheAnimatrix/Rasuko.git
cd Rasuko
npm ci
npm run dev
```

Rasuko stores its local workspace under `~/.rasuko` by default. Set `RASUKO_HOME` to use a different location.

## Build

Create the production application bundle:

```bash
npm run build
```

Create the Windows installer:

```bash
npm run dist:win
```

Compiled application files are written to `out/`; packaged releases are written to `release/`.

## Test

```bash
npm run typecheck
npm test
```

Additional UI and configured-provider acceptance scripts are available through `npm run test:ui` and `npm run test:live`.

## Contributing

Pull requests are welcome, especially for focused roadmap items, reliability improvements, accessibility, tests, and documentation.

1. Fork the repository and branch from `main`.
2. Keep the change focused and preserve the separation between Views and records.
3. Add or update tests for behavior changes.
4. Run `npm run typecheck` and `npm test`.
5. Open a pull request explaining the problem, approach, and verification.

For substantial architectural changes, open an issue first so the data-safety and compatibility implications can be discussed before implementation.

## License

Rasuko is available under the [MIT License](LICENSE).
