> Supporting research, not the active build contract. Start with [the project README](../../README.md).

# Bubbles.MD: editor feasibility review

Reviewed October 15, 2026. Preparation only: official documentation inspected; no editor installed, application created, prototype executed, or AI request made. Product choices remain in [10_PRODUCT_SPECIFICATION.md](<../../specs/001-bubbles-md/spec.md>).

## Recommendation and limits

**Selected baseline: Tiptap for formatted writing and CodeMirror 6 for editable Markdown.** The later [stack and model decisions](<stack-and-models.md>) supersede the earlier unselected-candidate status and document source-code checks and alternatives. This is a documentation-based selection, not evidence that Bubbles.MD's complete workflow has passed. Source/structured position correspondence and combined document/review history remain custom integration work.

| Requirement | Documentation finding | Remaining application work |
| --- | --- | --- |
| Formatted writing with Markdown underneath | Tiptap documents Markdown parsing/serialization. Milkdown exposes Markdown/ProseMirror transformation. | Define supported syntax and check representative round trips. |
| Colored source bubbles and insertion + | ProseMirror supplies inline decorations for ranges and widget decorations for positions. Tiptap and Milkdown expose ProseMirror extension hooks. | Accessible hit targets, wrapping, hover pairing, diff alignment, and bubble geometry. |
| Reviews remain attached during edits | ProseMirror supplies position mappings through document transformations. | Range boundary rules, detection of deleted targets, stale proposals, and overlapping-review invalidation. Mapping does not prove a candidate is still valid. |
| Accept and document Undo/Redo | Tiptap has document history support. | Coordinate review/reflection restoration with the corresponding history event and isolate acceptance from adjacent typing. |
| Editable Markdown mode preserves reviews | Parsing/serialization exists in both candidates. Eduardo now requires editable source mode (decision 23). | Source-edit range correspondence, intermediate syntax, and cross-view history are not established by this review. |

## Primary-source evidence

- [Tiptap Markdown introduction](https://tiptap.dev/docs/editor/markdown): bidirectional conversion between Markdown and the editor's JSON document. The extension is explicitly beta. Its documented limitations include unsupported comments and restricted table-cell structure. Do not assume arbitrary content survives conversion unchanged.
- [Tiptap extension API](https://tiptap.dev/docs/editor/extensions/custom-extensions/create-new/extension): custom ProseMirror plugins and view-only decorations provide extension points for our source markings. These are building blocks; they do not supply Bubbles.MD's bubble layout or review lifecycle.
- [Tiptap ProseMirror integration](https://tiptap.dev/docs/editor/core-concepts/prosemirror): exposes the underlying editing packages through `@tiptap/pm` and advises using its compatible versions.
- [ProseMirror guide: mapping and decorations](https://prosemirror.net/docs/guide/): transformations map positions forward; boundary attachment needs a deliberate bias. Decorations can style source ranges or place widgets without inserting review metadata into the document's content. These mechanisms support an anchoring design but cannot resolve competing intentions or guarantee stale acceptance is safe.
- [Tiptap Undo/Redo](https://tiptap.dev/docs/editor/extensions/functionality/undo-redo): provides document undo/redo and history-group timing. The documentation does not establish automatic restoration of external review/reflection state. That requires our own integration and validation.
- [Milkdown transformer](https://milkdown.dev/docs/api/transformer): converts between Markdown AST and ProseMirror document structures. [Listener](https://milkdown.dev/docs/api/plugin-listener) exposes content and selection events; [utilities](https://milkdown.dev/docs/api/utils) expose ProseMirror plugin wrappers. It remains a plausible alternative, with the same application-specific anchoring/history requirements.

## Proposed design boundary

Use one structured document and separately identified review records. A review owns its source scope, base revision, reflections, candidate, and individual keep-original decisions. Render review outlines and insertion markers as temporary view decorations; exporting Markdown must not write bubble controls into the user's document.

Maintain anchors through actual editor changes, then independently decide whether a candidate is outdated. A position surviving an edit does not establish that its old suggested wording remains applicable. Completely deleted targets follow the selected pop behavior; ambiguous surviving anchors must not be guessed.

Formatted/Markdown switching is local presentation work. Do not assume that replacing the whole editor content with reparsed Markdown preserves anchors, document history, or external review records. Editing Markdown source needs an explicit mapping strategy. View switching alone must not invalidate a proposal or spend tokens.

Acceptance must combine the document replacement and review dismissal into a coherent undoable action. Merely keeping a separate list of accepted bubbles or invoking the editor's default undo is not proof of this behavior.

## Small validation gate for when implementation is authorized

Use fixed local candidates, without model requests:

1. Capture a word, a formatted sentence, and a cross-paragraph selection; focusing a reflection must preserve each target.
2. Show alteration/deletion outlines and an insertion +. Type before, inside, and across the target; inspect anchoring, invalidation, and complete-deletion behavior.
3. Accept one proposal between ordinary typing operations. Undo/Redo must restore/reapply the correct document and review together, preserving another pending review.
4. Switch both ways through Markdown using headings, lists, links, emphasis, and fenced code. Edit in both modes, including incomplete source syntax, then Undo/Redo across the switch. Preserve valid review scope and markings; distinguish real source edits from a display-only switch.

If these fail, isolate whether the missing piece is our integration or a library limitation before changing editors. No further library survey or product styling is needed to answer that question.

## Decision status

Documentation supports the overall direction. Markdown range correspondence and combined history remain the main unproven integration points. This note does not authorize starting the application or the validation prototype.
