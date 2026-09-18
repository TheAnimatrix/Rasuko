# Rasuko task backlog

Updated 18 September 2026 after shared interface implementation and acceptance. Checked tasks meet their scoped acceptance; unchecked tasks may have implemented foundations, detailed below. The original requirements and later milestones remain tracked.

The product target remains a blank, responsive, Notepad-simple page that can become a useful application through conversation. Content stays structured and ID-bound. Interfaces use deterministic components, bindings, and actions. Ordinary project files remain accessible through read/write/grep; no MCP service is required.

**Recommended order:** address content safety and the immediate Kanban schema/instruction defects first; build shared interactions next; use those foundations for reusable recipes and portable Views; add simultaneous collaboration and marketplace distribution later. Kanban is the first acceptance example for the broader interface system.

## Status already established

- [x] Electron shell, responsive document pages, collapsible panes, and project/page navigation exist.
- [x] Structured records, rich-text blocks, stable IDs, a component registry, and View bindings exist.
- [x] Rich text stays rendered with Markdown shortcuts disabled; live formatting and slash commands exist.
- [x] Per-page chat history supports new conversations and reopening saved conversations, with legacy transcript migration.
- [x] Chat refreshes current View context, restores tool receipts, scopes events to conversations, and retains active drafts across navigation.
- [x] Managed file writes are validated/ingested; affected pages refresh. Generated schema/value ID mapping and offline dashboard selection were fixed.
- [x] Bound text, headings, forms, tables, board titles/status, and metrics have direct editing paths. Partial rich-text saves preserve hidden blocks.
- [x] Pi model integration and useful Mousse UI/provider patterns are present. A real OpenCode Go / DeepSeek session created and edited a Kanban board.
- [x] Build, typecheck, regression scripts, and isolated Electron acceptance tests exist.

These are implemented capabilities, not blanket completion guarantees. The shared interface work now adds complete View/record validation, independent copied page graphs, typed card details, persisted actions and undo, option-backed lanes, local form drafts, View settings and recoverable file batches. Portable installation, whole-chat redesign rollback and multi-client conflict handling remain unfinished. Live OpenRouter acceptance has not yet been performed.

## Current implementation checkpoint

The Kanban is a generated user View over ordinary table records. These changes are Rasuko infrastructure reused by tables, forms, metrics and other Views; no application-specific Kanban dataset was added.

| Area | Implemented and verified | Still ahead |
|---|---|---|
| Content safety | Structural/semantic validation; typed records; record/View revisions; raw file guards; copied graphs; reference checks; field rename/reference migration | General migrations; project/page revisions; external-file watching; durable partial-content recovery |
| Publication and undo | Recoverable file batches and startup repair; single-batch View plans; persisted record-action undo that rejects newer edits | Whole online assistant-turn preview/apply/rollback and preference handling; undo of a complete redesign |
| User-created boards | Empty lanes; stable field IDs; complete card create/edit; drag/keyboard ordering; lane management; copy/archive/restore/delete/undo; search, one field contains filter and sorting | Advanced combined/date filters, per-lane limits and overdue summaries; broader accessibility/layout polish |
| Interface composition | Capabilities and inspection; shared typed fields/detail editors/actions/query helpers; View settings; stable field renaming; tracker/CRM/intake/dashboard recipes | Full declarative actions and derived dashboards; more recipes and a template library |
| Everyday editing | Blank first launch; field/title flush on navigation/close; save-error retry; separate local form drafts; bundled wordmark font | IME/editor stress tests, recursive hierarchy and project-wide chat search/archive |
| Acceptance | Typecheck/build/regressions, two isolated Electron suites, real configured-provider creation and follow-up | OpenRouter-specific, packaged-client, performance and second-client acceptance |

The fresh AI creation used the original uncoached six-card request. Direct interaction edited all fields, created a seventh card, reordered/dragged/archived/restored it and reloaded. AI follow-up preserved all row/column IDs and unrelated cells. All 28 criteria passed after auditing an embedded inspection receipt; raw results are retained. The model needed recoverable validation/revision retries. See [implementation and evidence](E:/avarnic/Rasuko/artifacts/shared-interface-implementation-2026-09-18.md).

## A. Protect content and make changes reliable

These are release-blocking foundations. Tasks F01, F03, F04 and F05 should precede broadening automatic interface mutations.

- [x] **F01 — Validate the complete resulting View and its bindings.** Check legal parent/child relationships, one valid root, unique IDs, no cycles, compatible record kinds, existing field/block targets, and supported actions before persistence. **Done when:** illegal move/replace/setBind operations leave the previous View intact and return an actionable error; nothing disappears silently on reload.
- [ ] **F02 — Version durable schemas and use typed record patches.** Add explicit migrations for records, pages, Views, packages and chat indexes; preserve legacy input and back it up before migration. Replace unrestricted record patches with kind-specific validation. **Done when:** legacy fixtures migrate deterministically and a second migration changes nothing.
- [ ] **F03 — Apply redesigns as recoverable transactions.** Stage record creation, record edits, View operations, adoption and reconciliation together; publish one final state and receipt. Add recovery for interruption between file writes. Respect the existing automatic-apply preference. **Done when:** a failed or interrupted redesign can restore the prior consistent state without abandoned partial changes. Depends on F01–F02.
- [ ] **F04 — Detect conflicting edits.** Attach revisions to reads/writes and reject or rebase stale changes from AI, multiple projections, file tools and additional app windows. **Done when:** a delayed edit cannot silently overwrite a newer edit. Depends on F02–F03.
- [x] **F05 — Define record ownership and make deletion reference-aware.** Distinguish shared content from independent template instances; remap IDs when copying and preserve references when intentionally sharing. **Done when:** duplicating a page and deleting either instance never removes the other's content; cross-project copies load their records.
- [ ] **F06 — Make recovery durable at record, block and field level.** Persist Keep/Reattach/Convert decisions, expose partially unplaced content, and prevent repeated conversion from duplicating it. Wire recovery navigation and compatible target suggestions. **Done when:** hidden content remains discoverable and recovery choices survive restart. Depends on F01, F05.
- [ ] **F07 — Add undo and restore for AI changes.** Keep before/after revisions and offer a clear change summary and undo action for a committed turn, including record edits. **Done when:** users can undo a redesign without destroying unrelated later work; conflicts are surfaced. Depends on F03–F04.
- [ ] **F08 — Finish save, close and failure handling.** Extend the current flush barrier across all editing controls, app close and workspace changes; show save failures and support retry. Preserve unsubmitted form drafts separately from submitted data. **Done when:** rapid typing followed by navigation/close neither loses nor misroutes the edit, including when disk writes fail.
- [ ] **F09 — Reconcile external file edits and rebuild indexes.** Detect changes made outside Rasuko's own file tools, validate them, refresh affected data and provide a recoverable reindex command. **Done when:** valid external edits appear without stale metadata, while invalid files retain recoverable originals. Depends on F01–F04.

## B. Fix the Kanban result and complete its interactions

The live test proved creation, title editing, adding cards, status changes, persistence and AI awareness of manual edits. It also exposed incomplete schema guidance and a false claim that due dates were editable on cards.

- [x] **K01 — Make lane definitions explicit and stable.** Use a select Status field with ordered options; bind grouping/title by stable field IDs. Update AI guidance, creation defaults and the offline tracker. Provide a safe conversion for existing text-status boards. **Done when:** empty lanes stay visible, moving the first card does not reorder columns, and renaming a field does not break the board. Uses I01 and F02.
- [x] **K02 — Add a complete card editor.** Open a detail panel for title, description, owner, priority, due date and additional schema fields; reuse shared typed inputs. **Done when:** users can edit every supported card field without asking AI or opening a raw table. Depends on I02.
- [x] **K03 — Finish card creation, archive and deletion.** Make Add card collect meaningful input and an explicit destination lane; add archive/restore and delete with undo. **Done when:** creation does not leave unexplained blank rows, and removal is reversible. Depends on I03, F05, F07.
- [x] **K04 — Add drag-and-drop and persistent ordering.** Support moves between lanes and ordering within a lane, with keyboard alternatives. **Done when:** drag and keyboard actions update only the intended card/status/order and survive reload and concurrent-edit checks. Depends on F04, I03.
- [x] **K05 — Add direct lane management.** Create, rename, reorder and remove lanes; removing a populated lane requires a destination for its cards. **Done when:** these actions preserve card identity and cannot strand data. Depends on K01, I03.
- [x] **K06 — Add board search, filters and sorting.** Filter by owner, priority, due date and text; make active filters visible and easy to clear. **Done when:** filtering changes the projection without deleting or copying records, and new cards use the intended lane. Depends on I04–I05.
- [ ] **K07 — Improve board layout and accessibility.** Use available pane width, sensible card sizes, clear empty states and deliberate horizontal scrolling; support long titles and visible keyboard focus. **Done when:** narrow, wide and assistant-open layouts remain usable without clipped controls. Depends on I06.
- [ ] **K08 — Add WIP limits and live board summaries.** Configure lane limits and derive counts/overdue summaries from the actual rows. **Done when:** summaries update after every move and limits give accurate feedback. Depends on I04, K01. Schedule after core board interactions.

**Kanban acceptance gate:** an uncoached natural-language request creates a usable board with permanent empty lanes. A user adds and edits a complete card, moves/reorders it, archives/restores it, changes lanes and reloads. AI then makes a narrow follow-up change while preserving all unrelated cards and IDs. Claims about supported interactions must match what can actually be done.

## C. Make richer interfaces easy to build

Build common capabilities that improve every View. A board, calendar, table, form and dashboard should compose the same data and operations rather than each owning a separate behavior implementation.

- [ ] **I01 — Make the registry a complete capability contract.** Declare required data shape, accepted bindings, supported edits/actions, empty-state behavior, limitations and working examples for each component. Generate model instructions, inspector controls and validation from it. **Done when:** the AI discovers select-option lanes and knows which card fields are editable; declared capabilities have runtime coverage tests. Extends F01.
- [ ] **I02 — Build shared typed fields and record-detail editors.** Provide text, rich text, numeric, date, select, checkbox and URL controls with defaults, validation, errors and consistent save behavior. **Done when:** forms, card details, table cells and focused fields use the same controls without overwriting sibling values. Depends on F02, F08.
- [ ] **I03 — Add a deterministic action system.** Define explicit create/update/move/archive/delete/submit/navigate/prompt actions with stable data targets, typed parameters and receipts. Replace ambiguous component-specific actions such as choosing whichever table happens to be present. **Done when:** generated buttons perform a verified action with transaction and undo support. Depends on F01–F05.
- [ ] **I04 — Add shared queries and derived values.** Support typed filters, sorting, grouping, counts, sums and simple declarative calculations; keep charts and metrics derived from source records where appropriate. **Done when:** editing a row updates the table, board, relevant calendar and dashboard consistently, without duplicate content. Depends on F02, F04; avoid arbitrary code evaluation.
- [ ] **I05 — Define View interaction state.** Give filters, selected records, tabs, detail panels and form drafts explicit state and clear persistence rules, separate from content and View definitions. **Done when:** navigation and reopening a View behave predictably without changing the underlying dataset.
- [ ] **I06 — Make layouts responsive to their actual container.** Standardize page width, grids, rows, detail panels, overflow and density around available pane space and existing design tokens. **Done when:** every supported recipe works with the sidebar/assistant open or closed and at the minimum supported window size.
- [ ] **I07 — Make the AI validate and inspect its result.** Have it resolve data/action requirements, validate a proposed change, apply it, and inspect the resulting bindings and usable controls before reporting success. Keep diagnostics available through ordinary files/tools. **Done when:** unsupported requests produce grounded explanations, repairable errors lead to correction, and the assistant does not claim nonexistent interactions. Depends on F03, I01–I04.
- [ ] **I08 — Ship tested interface recipes with sensible defaults.** Start with Kanban/tracker, intake, CRM pipeline, content calendar, research notes and a dashboard. Recipes specify schemas, binding slots, actions and layout, with optional sample data. **Done when:** a short request creates a complete working interface on an empty or populated page without exposing JSON or requiring component terminology. Depends on R01, I01–I07; add recipes incrementally.
- [ ] **I09 — Add a lightweight schema and binding inspector.** Let users configure fields, labels, options, display settings, actions and bindings directly, including repair of incompatible targets. Schema changes preserve IDs or perform explicit migrations. **Done when:** small corrections do not require AI, and renaming a field updates all projections safely. Depends on F02, I01–I03.
- [ ] **I10 — Complete contextual partial moves and reassignment.** Give chat precise selection/node/record scope and implement copy, extract and move across records/pages as distinct operations. Preserve IDs for moves and remap them for copies. **Done when:** moving part of a paragraph or a group of records updates source, destination and bindings together, with undo and recovery. Depends on F03–F07.

## D. Complete reusable Views and project sharing

- [ ] **R01 — Define portable template slots and instantiation.** Separate a reusable View's schema/binding slots from a page instance's live record IDs; map compatible existing data or create independent records. **Done when:** instantiating the same template twice has predictable ownership and never leaks or omits source data. Depends on F02, F05, I01.
- [ ] **R02 — Add a real View library and picker.** Save a working View as a template, preview it, duplicate it and select it for a page. Keep an always-available minimal writing View. **Done when:** users can find and reuse their own Views without files or chat instructions. Depends on R01.
- [ ] **R03 — Complete View package export/import/install/update.** Include required schemas, actions, assets, compatibility metadata and migrations; define optional sample data separately from personal content. **Done when:** a package installs into a fresh workspace and works, and updating it preserves user data. Depends on F02–F05, R01.
- [ ] **R04 — Add portable project export/import.** Package project hierarchy, Views and records with ID preservation/remapping and validation. **Done when:** a second client opens the project with the same content, bindings and interfaces. Do not describe file serialization alone as completed sharing. Depends on R03, U02.
- [ ] **R05 — Add multi-client synchronization and conflict resolution.** First define the supported ownership/concurrency model; then add change transport, offline changes, conflict presentation and recovery. **Done when:** two clients can change a shared project without silent lost updates. Depends on F03–F04, R04. Later milestone; portable sharing comes first.
- [ ] **R06 — Define the future marketplace lifecycle.** Extend packages with authorship, previews, dependencies, supported capability versions and install/update/remove behavior. Define how new component implementations are registered and reviewed. **Done when:** packages have a stable compatibility contract and removing a presentation package does not delete content. Depends on R03. Marketplace browsing/distribution follows; commerce is outside the current plan.

## E. Finish the original everyday product experience

- [x] **U01 — Make first launch genuinely blank.** Open a minimal writing View with unobtrusive chat; offer samples separately. **Done when:** typing is the first obvious action and demo content does not occupy the user's first note.
- [ ] **U02 — Add recursive project/page/note hierarchy.** Model notes as minimal Views, support nesting, reordering and moving with clear breadcrumbs and search. **Done when:** deep hierarchies survive restart/export, and moving a page preserves its content and conversations. Depends on F05.
- [ ] **U03 — Finish rich-editor interaction quality.** Verify selection formatting, slash commands, paste, IME composition, keyboard navigation, editor undo and page-level Markdown shortcut preferences. **Done when:** formatting, blank lines and stable block identity survive representative editing and restart flows. Build on the existing editor; do not reintroduce a separate preview mode.
- [ ] **U04 — Make conversation history easier to navigate.** Add conversation rename/search, clear active-chat identity and archive/restore; allow finding a conversation across a project's Views. **Done when:** users can return to a prior discussion and its page without losing current work. Existing new/reopen/persistence behavior remains the baseline.
- [ ] **U05 — Finish model connection and runtime settings.** Validate a real OpenRouter creation/edit/resume flow, register discovered custom endpoint models with the resolver, and make unavailable models/retries/cancellation/settings accurate. Document the existing Pi model layer and custom tool loop; evaluate a fuller runtime only for a demonstrated gap. **Done when:** choosing a connected model reliably uses that model, and exposed settings have observable effects.
- [ ] **U06 — Finish the compact visual treatment and offline wordmark.** Bundle the Mousse-matching Outfit font, retain compact shared primitives, and refine density, focus and empty/error states. **Done when:** the intended wordmark renders offline and the minimal page remains visually quiet. Reuse existing Mousse-derived work.

## F. Make the result reproducible and releasable

- [ ] **Q01 — Establish source control and continuous checks.** Capture a repository baseline and run existing typecheck/build/regression commands in CI. **Done when:** a clean checkout produces a traceable build and catches the known regressions.
- [ ] **Q02 — Add capability, recipe and live-AI acceptance coverage.** Test every declared component/action; add malformed mutation, conflicting edit, restart, keyboard and multi-projection scenarios. Run opt-in live AI scenarios on configured providers and record prompts, receipts and outputs. **Done when:** an uncoached user request is assessed by actual behavior, not the assistant's prose. Live paid requests remain outside default unit tests.
- [ ] **Q03 — Set and verify performance targets.** Measure startup, typing, resize, query updates and scrolling with representative large documents/datasets. Add pagination or virtualization where evidence requires it. **Done when:** agreed targets pass without content truncation or lost edits. Depends on I04–I06.
- [ ] **Q04 — Verify packaged desktop operation and update recovery.** Test install, launch, credential restoration, offline use, close/reopen, backup/migration and package/project import in the distributed app. Correct architecture documentation that still describes planned behavior as implemented. **Done when:** packaged acceptance matches development acceptance and failed upgrades have a recovery path.
- [ ] **Q05 — Ship a small gallery of working sample applications.** Demonstrate notes, a complete Kanban, intake plus dashboard, CRM pipeline and content calendar using reusable recipes. **Done when:** each sample supports real entry/editing, subsequent AI changes, save/restart and installation in a second workspace. Depends on I08, R02–R04.

## Execution sequence and dependencies

| Delivery | Work | Completion gate |
|---|---|---|
| 1. Trustworthy baseline and immediate Kanban correction | F01–F05, F08; I01 and K01 can begin alongside the foundations; U01/U06 and Q01 are independent | Invalid changes cannot silently hide/overwrite content; AI creates stable Kanban lanes without coaching |
| 2. Useful daily Kanban | I02–I03, K02–K05, F06–F07 | Complete card editing, move/order, lane management and reversible removal work through direct interaction |
| 3. General interface building | I04–I10, R01, K06–K08; finish F09 | Short prompts produce working data-entry/visualization workflows with verified controls and live derived data |
| 4. Reuse and complete desktop product | R02–R04, U02–U05, Q02–Q05 | Users can find/reuse Views, move projects between clients, and rely on the packaged application |
| 5. Collaboration and ecosystem | R05–R06 | Conflict-safe shared projects and versioned third-party packages |

This is a dependency order, not a calendar estimate. Some tasks span multiple deliveries. Scope and effort estimates should follow the relevant design spike, especially transactions, template ownership and synchronization.

Use Sol agents at medium reasoning for bounded exploration, implementation and review, with the lead integrating changes and performing final acceptance. Prefer independent tasks or explicit file ownership when agents share a checkout.

## Coverage of the original 25 requirements

| Original # | Requirement | Current position and remaining tasks |
|---|---|---|
| 1 | Electron, initially Notepad-simple | Shell present; U01, U03, Q04 |
| 2 | Blank unlimited responsive pages | Page model present; U01, I06, Q03 |
| 3 | Collapsible hierarchy | Project/page level present; U02 |
| 4 | Every page a reusable View | Page/View split present; F05, R01–R02 |
| 5 | Truly minimal barebones View | Present; U01, U06 |
| 6 | Live rich text, slash commands, optional Markdown | Core implemented and toggle fixed; U03 |
| 7 | Expandable per-View AI chat | Present; history/state fixes implemented; U04 |
| 8 | OpenRouter | Integration present; actual OpenRouter acceptance remains U05/Q02 |
| 9 | Natural-language UI adaptation | Live creation/edit proven; I01, I07–I08 |
| 10 | Purpose-built input and visualization | Shared typed entry, usable boards and tables verified; finish K07–K08, I02–I06 |
| 11 | Deterministic structured components | Registry present; F01, I01, I03–I04, I07 |
| 12 | Saveable, reusable, reproducible across clients | Persistence/export foundations; R01–R05 |
| 13 | Future marketplace possible | Metadata foundation; R03, R06 |
| 14 | Markdown not core data architecture | Structured storage implemented; preserve this throughout F02/I02/U03 |
| 15 | Stable IDs, rich formatting, UI bindings | Present; F01–F05, I09 |
| 16 | Content survives redesign | Common flows verified; full guarantee needs F01–F07 |
| 17 | Graceful fallback and self-correction | Record fallback present; F06, I07, I09 |
| 18 | Contextual reassignment and partial moves | Targeting and partial editing present; I10 |
| 19 | AI uses ordinary project files | Tools and managed ingestion present; F09; retain file access in I07 |
| 20 | Pi runtime foundation | Pi model integration present; U05; no automatic rewrite requirement |
| 21 | Reuse Mousse | Useful patterns already reused; retain/reuse through I02, U06 |
| 22 | Compact shadcn/ChatGPT-like aesthetic | Foundation present; I06, U06 |
| 23 | Mousse-style Rasuko wordmark | Outfit bundled and verified offline; remaining visual polish U06 |
| 24 | Sample application | Existing samples; complete and broaden through I08, Q05 |
| 25 | Sol agents, lead orchestration/review | Followed in review/fixes; retain as execution policy |

## Evidence

- [Original codebase review](E:/avarnic/Rasuko/artifacts/codebase-review-2026-09-17.md)
- [Implemented follow-up fixes](E:/avarnic/Rasuko/artifacts/implementation-2026-09-18.md)
- [Live AI Kanban assessment](E:/avarnic/Rasuko/artifacts/kanban-live-test/assessment.md)
- [Component registry](E:/avarnic/Rasuko/src/shared/viewSchema.ts)
- [Current structured data model](E:/avarnic/Rasuko/src/shared/types.ts)
