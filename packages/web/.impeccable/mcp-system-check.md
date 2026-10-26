# MCP extension system check

Scope: ordinary `/mcp_manage` management extension of the incumbent editor. The existing visual system remains authoritative; this check does not establish a new identity or design system. The connection form now configures only Streamable HTTP at `/mcp`, following the user's explicit transport choice.

## Evidence checked

- Product and surface intent: `PRODUCT.md` and `.impeccable/mcp-brief.md`.
- Incumbent tokens and controls: `src/style.css`, including system/mono fonts, 13px base type, 4px controls, shared focus treatment, semantic surfaces, dark/light appearance, and blue/teal/violet accents.
- Shared preference behavior: `src/preferences.ts`; static and dynamic translations: `src/i18n/index.ts`, `src/i18n/zh-CN.ts`, and their use in `src/mcp/main.ts`.
- Extension composition and states: `mcp_manage/index.html` and `src/mcp/style.css`; entry-point stylesheet imports and preference initialization in `src/mcp/main.ts`.
- Incumbent diff: the editor adds its management link under Agent / MCP. `src/style.css`, `src/preferences.ts`, and `src/i18n/index.ts` have no changes in the current diff.

## Continuity

The management entry imports the incumbent stylesheet before its own layout stylesheet. It reuses actual `--surface-*`, `--border*`, `--text*`, `--accent*`, `--success`, `--danger`, and font tokens rather than duplicating a palette. Native inputs, selects, buttons, focus rings, and disabled states inherit existing controls. The same `initializePreferences` function uses the same stored language, appearance, and accent choices; management controls expose Chinese/English, dark/light/system, and blue/teal/violet.

Page-specific additions are scoped to `.mcp-page`, `.mcp-*`, or management-only IDs. They supply a scrolling document, management heading, service strip, section navigation, tool index/detail layout, session table, and connection form. The 760px breakpoint stacks the tool and connection columns; wide tables scroll within their wrappers. Loading, empty, error, selected, status, and copy feedback are represented explicitly. Service status also uses text rather than color alone.

## Drift and limits

No palette, font-family, shared preference, or editor-system drift was found in the inspected source. The management page intentionally uses a larger page heading (24px; 20px on small screens) and a page-scoped selection treatment with `--accent-soft`; these are local hierarchy/state choices, not new global tokens. It adds no shadow or font dependency.

This is a source comparison, not rendered visual approval. Browser appearance, actual overflow, contrast across every preference combination, and runtime accessibility remain subject to the implementation's separate UI verification. Canonical SDK descriptions and JSON schemas remain technical source text; translated page labels and summaries use the shared i18n mechanism.

Existing system files were preserved. No `DESIGN.md` or design sidecar was created or replaced.
