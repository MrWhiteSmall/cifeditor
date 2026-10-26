import "../style.css";
import "./style.css";
import { api } from "../api.ts";
import { currentLanguage, t } from "../i18n/index.ts";
import { initializePreferences } from "../preferences.ts";
import { connectionConfig, filterTools, type McpTool } from "./model.ts";

interface Catalog { available: boolean; transport: string; tools: McpTool[] }
interface Session { session_id: string; name: string; revision: number; last_accessed: number }
interface Sessions { sessions: Session[]; ttl_seconds: number; capacity: number }
interface Health { status: string; version: string; revision: string; session_store: string }

const $ = <T extends HTMLElement = HTMLElement>(id: string): T => document.getElementById(id) as T;
const summaries: Record<string, string> = {
  editor_schema: "Inspect editor capabilities", open_structure: "Import a new structure",
  inspect_session: "Inspect a shared document", query_selection: "Preview an atom selection",
  set_condition: "Apply or remove a condition", rename_chain: "Assign a chain identifier",
  set_charge: "Change formal charges", edit_bond: "Add or remove a bond", delete_atoms: "Delete selected atoms",
  edit_group: "Edit condition groups", undo: "Undo the last shared edit", validate_structure: "Validate a structure",
  export_cif: "Export annotated CIF",
};
const summary = (name: string): string => t(summaries[name] ?? name);
let tools: McpTool[] = [];
let selectedName = "";
let refreshing = false;
let catalogLoaded = false;

function element<K extends keyof HTMLElementTagNameMap>(tag: K, text?: string, className?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (text !== undefined) node.textContent = text;
  if (className) node.className = className;
  return node;
}
function note(text: string): HTMLParagraphElement { return element("p", text, "mcp-placeholder"); }
function showError(id: string, message: string): void {
  $(id).textContent = message;
  $(id).hidden = !message;
}
function editorUrl(session?: string): string {
  const url = new URL("/", location.origin);
  url.searchParams.set("lang", currentLanguage());
  if (session) url.searchParams.set("session", session);
  return url.href;
}
function showSection(): void {
  const target = location.hash.slice(1);
  const section = ["tools", "sessions", "connection"].includes(target) ? target : "tools";
  for (const link of document.querySelectorAll<HTMLAnchorElement>("[data-section]")) {
    const active = link.dataset.section === section;
    if (active) link.setAttribute("aria-current", "page");
    else link.removeAttribute("aria-current");
    $(`section-${link.dataset.section}`).hidden = !active;
  }
}

async function copy(text: string): Promise<void> {
  try {
    if (navigator.clipboard && window.isSecureContext) await navigator.clipboard.writeText(text);
    else {
      // LAN deployments commonly use HTTP, where the Clipboard API is absent.
      const previous = document.activeElement as HTMLElement | null;
      const field = element("textarea");
      field.value = text;
      field.className = "sr-only";
      document.body.append(field);
      field.select();
      const copied = document.execCommand("copy");
      field.remove();
      previous?.focus();
      if (!copied) throw new Error("Clipboard unavailable");
    }
    $("copy-status").textContent = t("Copied to clipboard.");
  } catch {
    $("copy-status").textContent = t("Copy failed. Select the text and press Ctrl/Cmd+C.");
  }
}

function renderTool(tool: McpTool): void {
  const detail = $("tool-detail");
  const readonly = tool.annotations?.readOnlyHint === true;
  const badge = element("span", t(readonly ? "Read only" : "Creates or edits documents"), "mcp-tag");
  const heading = element("h2", tool.name);
  detail.replaceChildren(badge, heading, element("p", summary(tool.name)));
  if (!readonly) detail.append(element("p", t(tool.name === "open_structure"
    ? "Creates a new document. Existing sessions are unchanged."
    : "Edits require a session ID and the latest expected_revision. Conflicts are rejected."), "mcp-note"));
  detail.append(element("h3", t("Input parameters")));
  const properties = Object.entries(tool.inputSchema.properties ?? {});
  if (!properties.length) detail.append(note(t("This tool takes no parameters.")));
  else {
    const table = element("table");
    const thead = element("thead");
    const header = element("tr");
    for (const label of ["Parameter", "Type / allowed values", "Description / default"]) header.append(element("th", t(label)));
    thead.append(header);
    const tbody = element("tbody");
    for (const [name, property] of properties) {
      const row = element("tr");
      const key = element("td", undefined, "mcp-param-name");
      key.append(element("code", name), element("small", t(tool.inputSchema.required?.includes(name) ? "Required" : "Optional")));
      const kind = element("td");
      const variants = property.anyOf as Record<string, unknown>[] | undefined;
      let type = String(property.type ?? variants?.map(item => item.type ?? "object").join(" | ") ?? "object");
      if (property.type === "array") type += `<${(property.items as Record<string, unknown> | undefined)?.type ?? "object"}>`;
      kind.append(element("code", type));
      if (property.enum) kind.append(element("div", (property.enum as unknown[]).map(value => JSON.stringify(value)).join(" · ")));
      const description = element("td", String(property.description ?? ""));
      if (Object.hasOwn(property, "default")) description.append(element("div", `${t("Default")}: ${JSON.stringify(property.default)}`));
      row.append(key, kind, description);
      tbody.append(row);
    }
    table.append(thead, tbody);
    const wrap = element("div", undefined, "mcp-table-wrap");
    wrap.tabIndex = 0;
    wrap.setAttribute("aria-label", t("Scrollable parameter table"));
    wrap.append(table);
    detail.append(wrap);
  }
  const description = element("details");
  description.append(element("summary", t("SDK tool description")), element("p", tool.description ?? "", "mcp-tool-description"));
  const schema = element("details");
  const schemaText = JSON.stringify(tool.inputSchema, null, 2);
  const copySchema = element("button", t("Copy input schema"));
  copySchema.addEventListener("click", () => void copy(schemaText));
  schema.append(element("summary", t("Input JSON Schema")), element("pre", schemaText), copySchema);
  detail.append(description, schema);
}

function renderTools(): void {
  const visible = filterTools(tools, $<HTMLInputElement>("tool-search").value, $<HTMLSelectElement>("tool-filter").value, summary);
  const list = $("tool-list");
  list.replaceChildren();
  if (!visible.length) {
    list.append(note(t(tools.length ? "No matching tools. Change or clear your search." : "No tools available. Check the adapter installation and refresh.")));
    $("tool-detail").replaceChildren(note(t("Select a tool to inspect its parameters.")));
    return;
  }
  if (!visible.some(tool => tool.name === selectedName)) selectedName = visible[0].name;
  for (const tool of visible) {
    const button = element("button", undefined, "mcp-tool-button");
    button.setAttribute("aria-pressed", String(tool.name === selectedName));
    button.append(element("code", tool.name), element("span", summary(tool.name)));
    button.addEventListener("click", () => {
      selectedName = tool.name;
      // Preserve keyboard focus in the index while replacing only the detail.
      for (const item of list.querySelectorAll("button")) item.setAttribute("aria-pressed", String(item === button));
      renderTool(tool);
    });
    list.append(button);
  }
  renderTool(visible.find(tool => tool.name === selectedName)!);
}

function renderSessions(data: Sessions): void {
  $("sessions-count").textContent = String(data.sessions.length);
  $("session-policy").textContent = t("Sessions expire after {0} hours of inactivity; capacity {1}. Browsing this list does not extend expiry.", [data.ttl_seconds / 3600, data.capacity]);
  const list = $("session-list");
  const scrollLeft = list.querySelector(".mcp-table-wrap")?.scrollLeft ?? 0;
  const focused = document.activeElement instanceof HTMLElement && list.contains(document.activeElement)
    ? { session: document.activeElement.dataset.session, action: document.activeElement.dataset.action }
    : null;
  const restoreFocus = (): void => {
    if (!focused?.session) return;
    const target = Array.from(list.querySelectorAll<HTMLElement>("[data-session]")).find(node =>
      node.dataset.session === focused.session && node.dataset.action === focused.action);
    if (target) target.focus({ preventScroll: true });
    else {
      $("sessions-heading").tabIndex = -1;
      $("sessions-heading").focus({ preventScroll: true });
    }
  };
  list.replaceChildren();
  if (!data.sessions.length) {
    list.append(note(t("No shared documents yet. Open a PDB/CIF in the editor or ask your Agent to call open_structure.")));
    restoreFocus();
    return;
  }
  const table = element("table");
  const header = element("tr");
  for (const label of ["Document / session ID", "Revision", "Last accessed", "Actions"]) header.append(element("th", t(label)));
  const thead = element("thead");
  thead.append(header);
  const tbody = element("tbody");
  for (const session of data.sessions) {
    const row = element("tr");
    const name = element("td");
    name.append(element("span", session.name, "mcp-session-name"), element("code", session.session_id, "mcp-session-id"));
    const time = element("time", new Date(session.last_accessed * 1000).toLocaleString(currentLanguage(), { dateStyle: "short", timeStyle: "short" }));
    time.dateTime = new Date(session.last_accessed * 1000).toISOString();
    const accessed = element("td");
    accessed.append(time);
    const actions = element("td");
    const wrap = element("div", undefined, "mcp-session-actions");
    const link = element("a", t("Open document"));
    link.href = editorUrl(session.session_id);
    link.target = "_blank";
    link.rel = "noopener";
    link.setAttribute("aria-label", `${t("Open document")}: ${session.name}`);
    link.dataset.session = session.session_id;
    link.dataset.action = "open";
    const button = element("button", t("Copy session ID"));
    button.setAttribute("aria-label", `${t("Copy session ID")}: ${session.name}`);
    button.dataset.session = session.session_id;
    button.dataset.action = "copy";
    button.addEventListener("click", () => void copy(session.session_id));
    wrap.append(link, button);
    actions.append(wrap);
    row.append(name, element("td", String(session.revision)), accessed, actions);
    tbody.append(row);
  }
  table.append(thead, tbody);
  const wrap = element("div", undefined, "mcp-table-wrap");
  wrap.tabIndex = 0;
  wrap.setAttribute("aria-label", t("Scrollable session table"));
  wrap.append(table);
  list.append(wrap);
  wrap.scrollLeft = scrollLeft;
  restoreFocus();
}

function renderConfig(): void {
  const ssh = $<HTMLSelectElement>("connection-mode").value === "ssh";
  $("ssh-fields").hidden = !ssh;
  try {
    const config = connectionConfig({ mode: ssh ? "ssh" : "local", url: $<HTMLInputElement>("connection-url").value,
      executable: $<HTMLInputElement>("connection-executable").value, host: $<HTMLInputElement>("connection-host").value });
    $<HTMLTextAreaElement>("connection-json").value = JSON.stringify(config, null, 2);
    $<HTMLButtonElement>("copy-config").disabled = false;
    showError("config-error", "");
  } catch (error) {
    $<HTMLTextAreaElement>("connection-json").value = "";
    $<HTMLButtonElement>("copy-config").disabled = true;
    showError("config-error", t(error instanceof Error ? error.message : "Invalid connection configuration."));
  }
}

async function refresh(includeCatalog = false): Promise<void> {
  if (refreshing) return;
  refreshing = true;
  $<HTMLButtonElement>("refresh").disabled = true;
  const [health, sessions, catalog] = await Promise.allSettled([
    api<Health>("/api/health", { timeoutMs: 10000 }),
    api<Sessions>("/api/sessions", { timeoutMs: 10000 }),
    includeCatalog || !catalogLoaded ? api<Catalog>("/api/mcp", { timeoutMs: 10000 }) : Promise.resolve(null),
  ]);
  if (health.status === "fulfilled") {
    $("api-status").textContent = t(health.value.status === "ok" ? "Editor API healthy" : "Editor API unavailable");
    $("api-status").dataset.state = health.value.status === "ok" ? "ok" : "error";
    $("storage-status").textContent = t(health.value.session_store === "persistent" ? "Persistent" : "In memory");
    $("build-status").textContent = health.value.revision === "unknown" ? health.value.version : health.value.revision.slice(0, 8);
    $("build-status").title = `${health.value.version} · ${health.value.revision}`;
    showError("service-error", "");
  } else {
    $("api-status").textContent = t("Editor API unavailable");
    $("api-status").dataset.state = "error";
    showError("service-error", `${t("Service check failed. Check the server and refresh.")} ${String(health.reason)}`);
  }
  if (sessions.status === "fulfilled") {
    renderSessions(sessions.value);
    showError("sessions-error", "");
  } else {
    $("sessions-count").textContent = "—";
    $("session-list").replaceChildren();
    showError("sessions-error", `${t("Could not load sessions. Refresh to retry.")} ${String(sessions.reason)}`);
  }
  if (catalog.status === "fulfilled" && catalog.value) {
    catalogLoaded = true;
    tools = catalog.value.tools;
    $("adapter-status").textContent = t(catalog.value.available ? "Installed" : "Not installed (mcp extra)");
    $("tools-count").textContent = String(tools.length);
    renderTools();
  } else if (catalog.status === "rejected") {
    catalogLoaded = false;
    tools = [];
    $("tools-count").textContent = "—";
    $("adapter-status").textContent = t("Check failed");
    $("tool-list").replaceChildren(note(t("Could not load tools. Refresh to retry.")));
    $("tool-detail").replaceChildren();
  }
  $("last-updated").textContent = `${t("Last checked")}: ${new Date().toLocaleTimeString(currentLanguage())}`;
  refreshing = false;
  $<HTMLButtonElement>("refresh").disabled = false;
}

initializePreferences(() => null, () => {});
$("api-origin").textContent = location.origin;
$<HTMLAnchorElement>("editor-home").href = editorUrl();
$<HTMLAnchorElement>("new-document").href = editorUrl();
$<HTMLInputElement>("connection-url").value = location.origin;
$("tool-search").addEventListener("input", renderTools);
$("tool-filter").addEventListener("change", renderTools);
$("refresh").addEventListener("click", () => void refresh(true));
$("connection-form").addEventListener("submit", event => event.preventDefault());
$("connection-form").addEventListener("input", renderConfig);
$("connection-mode").addEventListener("change", () => {
  const executable = $<HTMLInputElement>("connection-executable");
  const remote = "/mnt/slurm-data/lusj/cifeditor/shared/venv/bin/atomworks-studio-mcp";
  if ($<HTMLSelectElement>("connection-mode").value === "ssh" && executable.value === "atomworks-studio-mcp") executable.value = remote;
  else if (executable.value === remote) executable.value = "atomworks-studio-mcp";
  renderConfig();
});
$("copy-config").addEventListener("click", () => void copy($<HTMLTextAreaElement>("connection-json").value));
window.addEventListener("hashchange", showSection);
document.addEventListener("visibilitychange", () => { if (!document.hidden) void refresh(); });
setInterval(() => { if (!document.hidden) void refresh(); }, 15000);
showSection();
renderConfig();
void refresh(true);
