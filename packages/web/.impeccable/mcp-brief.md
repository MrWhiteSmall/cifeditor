# /mcp management extension

Mode: Operate. Code-first, existing editor visual system fixed.

Purpose: inspect this editor's MCP adapter, discover exact tools and their schemas, find shared documents, copy a client configuration. This is a focused extension of the existing Agent / MCP menu.

First viewport: compact editor identity/preferences header; management title with refresh action; actual API/adapter status; tool/session/connection navigation; searchable tool index with selected tool parameters beside it. No decorative metrics or invented runtime history.

Interaction: selecting a tool reveals its canonical schema and read/write status. Session links open the same editor document; listing does not prolong TTL. Connection form produces copyable stdio configuration, distinguishing executable/SSH transport from the web page.

Incumbent authority: src/style.css surface, border, typography and accent tokens; preferences.ts and i18n/index.ts. Reuse these unchanged and scope new layout to the management page. Mobile stacks tool index and detail, with no page overflow. Preserve read/write semantics, visible loading/error/empty states and keyboard focus.
