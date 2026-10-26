import { t } from "../i18n/index.ts";
import { postJson } from "../api";
import { applyCapabilities, bindFloatingMenus, closeToolbarMenus, element } from "../dom";
import type { SelectionController } from "../selection-controller";
import type { SelectionSyntax, StructureSummary } from "../types";
import type {
  MolecularViewer,
  ViewerColor,
  ViewerMode,
  ViewerRepresentation,
  ViewerRepresentationAction,
  ViewerTarget,
} from "../viewers";
import { VIEWER_STORAGE_KEY } from "./persistence";

const FALLBACK_SAFE_PATINAE_COMMANDS = new Set([
  "show",
  "hide",
  "color",
  "zoom",
  "center",
  "orient",
  "enable",
  "disable",
  "toggle",
]);

const STUDIO_UNSAFE_PATINAE_COMMANDS = new Set([
  "alter", "bond", "create", "delete", "extract", "fuse", "load", "load_traj",
  "pseudoatom", "rotate", "transform_selection", "translate", "unbond",
]);

export interface ViewerToolbarControllerOptions {
  viewer: () => MolecularViewer;
  selection: SelectionController;
  getSessionId: () => string | null;
  getSummary: () => StructureSummary | null;
  requestedMode: () => ViewerMode | null;
  runViewerUpdate: (operation: () => Promise<void>) => Promise<void>;
  mutate: (path: string, body?: unknown) => Promise<void>;
  log: (message: string, level?: "info" | "error") => void;
}

export class ViewerToolbarController {
  private readonly viewerModeSelect = element<HTMLSelectElement>("viewer-mode");
  private readonly selectionSyntax = element<HTMLSelectElement>("selection-syntax");
  private readonly viewerCommand = element<HTMLInputElement>("viewer-command");
  private readonly viewerActionTarget = element<HTMLSelectElement>("viewer-action-target");

  constructor(private readonly options: ViewerToolbarControllerOptions) {}

  private positionOpenMenu(): void {
    const menu = document.querySelector<HTMLDetailsElement>(".viewer-menu[open]");
    if (!menu) return;
    const anchor = menu.querySelector("summary")!.getBoundingClientRect();
    const popover = menu.querySelector<HTMLElement>(".viewer-menu-popover")!;
    popover.style.setProperty("--menu-top", `${anchor.bottom + 5}px`);
    popover.style.left = `${Math.max(8, Math.min(anchor.left, window.innerWidth - popover.offsetWidth - 8))}px`;
  }

  bind(): void {
    bindFloatingMenus();
    for (const menu of document.querySelectorAll<HTMLDetailsElement>(".viewer-menu")) {
      menu.addEventListener("toggle", () => {
        if (menu.open) {
          this.positionOpenMenu();
        }
      });
    }
    window.addEventListener("resize", () => this.positionOpenMenu());
    for (const button of document.querySelectorAll<HTMLButtonElement>("[data-representation]")) {
      button.addEventListener("click", async () => {
        const action = (button.dataset.action ?? document.querySelector<HTMLInputElement>(
          'input[name="representation-action"]:checked',
        )!.value) as ViewerRepresentationAction;
        const representation = button.dataset.representation as ViewerRepresentation;
        const target = this.viewerActionTarget.value as ViewerTarget;
        try {
          await this.options.runViewerUpdate(() => this.options.viewer().setRepresentation(representation, target, action));
          this.options.log(`${action === "replace" ? t("Show only") : action === "hide" ? t("Hide") : t("Show")} ${representation} · ${target === "all" ? "all atoms" : "selection"}.`);
        } catch (error) {
          this.options.log(t("Display action failed: {0}", [String(error)]), "error");
        }
      });
    }
    for (const button of document.querySelectorAll<HTMLButtonElement>("[data-color]")) {
      button.addEventListener("click", () => {
        try {
          this.options.viewer().setColor(
            button.dataset.color as ViewerColor,
            this.viewerActionTarget.value as ViewerTarget,
          );
        } catch (error) {
          this.options.log(t("Color action failed: {0}", [String(error)]), "error");
        }
      });
    }
    element("command-search").addEventListener("input", () => this.renderCommandCatalog());
    this.selectionSyntax.addEventListener("change", () => this.updateCommandHint());
    this.updateCommandHint();
    element<HTMLFormElement>("viewer-command-form").addEventListener("submit", (event) => {
      event.preventDefault();
      const command = this.viewerCommand.value;
      void this.executeCommand(command)
        .then(() => {
          this.viewerCommand.value = "";
        })
        .catch((error) => this.options.log(t("Command failed: {0}", [String(error)]), "error"));
    });
    this.viewerModeSelect.addEventListener("change", () => {
      const selected = this.parseMode(this.viewerModeSelect.value);
      if (selected) void this.switchRenderer(selected);
    });
    for (const button of document.querySelectorAll<HTMLButtonElement>(".renderer-prompt-choice")) {
      button.addEventListener("click", () => {
        const selected = this.parseMode(button.dataset.renderer ?? null);
        if (!selected) return;
        this.viewerModeSelect.value = selected;
        element("renderer-prompt").hidden = true;
        void this.switchRenderer(selected);
      });
    }
  }

  refreshCapabilities(): void {
    const capabilities = this.options.viewer().capabilities;
    applyCapabilities(capabilities);
    element("style-menu").hidden = !capabilities.representations && !capabilities.colors;
    element<HTMLSelectElement>("pick-scope").disabled = !capabilities.picking;
    const commandsOption = this.selectionSyntax.querySelector('option[value="patinae"]');
    if (capabilities.commands) {
      if (!commandsOption) this.selectionSyntax.add(new Option(t("PyMOL commands"), "patinae"), 0);
    } else {
      commandsOption?.remove();
      this.selectionSyntax.value = "expression";
    }
    this.updateCommandHint();
    this.renderCommandCatalog();
  }

  private updateCommandHint(): void {
    const syntax = this.selectionSyntax.value;
    const hint = syntax === "patinae"
      ? t("PyMOL command, e.g. select sele, name CA")
      : t("AtomWorks query, e.g. atom_name == 'CA'");
    this.viewerCommand.placeholder = hint;
    this.viewerCommand.setAttribute("aria-label", hint);
    this.viewerCommand.title = syntax === "patinae"
      ? t("PyMOL-style selection and display commands; remove edits the document with Undo. See Backend for commands.")
      : t("AtomWorks expressions or selection paths: sel('A/*/[10-20]/CA').");
    element("run-viewer-command").textContent = syntax === "patinae" ? t("Run") : t("Select");
  }

  renderDrawers(): void {
    const viewer = this.options.viewer();
    const objects = element("object-list");
    const viewerObjects = viewer.getObjectList();
    objects.replaceChildren();
    if (viewerObjects.length) {
      for (const object of viewerObjects) {
        const button = document.createElement("button");
        button.type = "button";
        button.className = "drawer-object";
        button.textContent = `${object.enabled === false ? "○" : "●"} ${object.name} · ${object.type ?? "object"}`
          + (object.atomCount === undefined ? "" : t(" · {0} atoms", [object.atomCount.toLocaleString()]));
        button.title = object.enabled === false ? "Show object" : "Hide object";
        button.addEventListener("click", () => {
          viewer.setObjectEnabled(object.name, object.enabled === false);
          this.renderDrawers();
        });
        objects.append(button);
      }
    } else {
      const summary = this.options.getSummary();
      objects.textContent = summary
        ? t("{0} · {1} atoms · chains {2}", [summary.name, summary.atom_count.toLocaleString(), summary.chain_ids.join(", ") || "—"])
        : t("Open a structure to list objects.");
    }
    const selectionList = element("selection-list");
    const selections = viewer.getSelectionList();
    selectionList.replaceChildren();
    if (selections.length) {
      for (const selection of selections) {
        const button = document.createElement("button");
        button.type = "button";
        button.className = "drawer-object";
        button.textContent = `${selection.name}${selection.expression ? ` · ${selection.expression}` : ""}`;
        button.addEventListener("click", () => {
          try {
            this.options.selection.replace(viewer.evaluateSelection(selection.name), true);
          } catch (error) {
            this.options.log(t("Named selection failed: {0}", [String(error)]), "error");
          }
        });
        selectionList.append(button);
      }
    }
    const measurements = viewer.listMeasurements();
    element("measurement-list").textContent = measurements.length
      ? measurements.map((item) =>
        `${item.label ?? item.kind ?? t("Measurement")}${item.value === undefined ? "" : ` · ${item.value}${item.unit ?? ""}`}`
      ).join("\n")
      : t("No measurements.");
  }

  async switchRenderer(mode: ViewerMode): Promise<void> {
    closeToolbarMenus();
    await this.options.runViewerUpdate(async () => {
      const viewer = this.options.viewer();
      const notice = element("renderer-notice");
      notice.hidden = true;
      const hadRenderer = viewer.initialized;
      const previousMode = (viewer.initialized ? viewer.backend : this.options.requestedMode()) ?? "molstar";
      try {
        await viewer.switchBackend(mode);
        localStorage.setItem(VIEWER_STORAGE_KEY, mode);
        const url = new URL(window.location.href);
        url.searchParams.set("viewer", mode);
        history.replaceState(null, "", url);
        this.refreshCapabilities();
        this.renderDrawers();
        this.options.log(t("Switched renderer to {0} without reloading.", [mode === "patinae" ? "Patinae" : "Mol*"]));
      } catch (error) {
        if (hadRenderer) {
          try {
            await viewer.switchBackend(previousMode);
            this.refreshCapabilities();
            this.renderDrawers();
          } catch (restoreError) {
            this.options.log(t("Could not restore the previous renderer: {0}", [String(restoreError)]), "error");
          }
        }
        this.viewerModeSelect.value = viewer.initialized ? viewer.backend : "";
        notice.textContent = mode === "patinae" && !("gpu" in navigator)
          ? t("Patinae needs WebGPU in this browser. Mol* is still available.")
          : t("Could not start {0}. See the Activity log for details.", [mode === "patinae" ? "Patinae" : "Mol*"]);
        notice.hidden = false;
        this.options.log(t("Renderer switch failed: {0}", [String(error)]), "error");
      }
    });
  }

  private parseMode(value: string | null): ViewerMode | null {
    return value === "patinae" || value === "molstar" ? value : null;
  }

  private async executeCommand(
    command: string,
    syntax = this.selectionSyntax.value as SelectionSyntax,
  ): Promise<void> {
    const trimmed = command.trim();
    if (!trimmed) return;
    if (/[\n\r;]/.test(trimmed)) {
      throw new Error(t("Run one command at a time; command separators are not allowed."));
    }
    const sessionId = this.options.getSessionId();
    const atomworksMatch = /^(awselect|awselect-path)\s+(.+)$/i.exec(trimmed);
    if (syntax !== "patinae" || atomworksMatch) {
      if (!sessionId) throw new Error(t("Open a CIF before selecting atoms."));
      const querySyntax = atomworksMatch
        ? atomworksMatch[1].toLowerCase() === "awselect-path" ? "path" : "expression"
        : syntax;
      const applied = await this.options.selection.applyResolved("replace", async () => {
        const response = await postJson<{ atom_indices: number[] }>(
          `/api/sessions/${sessionId}/selections/query`,
          { expression: atomworksMatch?.[2] ?? trimmed, syntax: querySyntax },
        );
        return response.atom_indices;
      });
      if (applied !== null) this.options.log(t("AtomWorks {0} query applied.", [querySyntax]));
      return;
    }
    const viewer = this.options.viewer();
    const verb = trimmed.split(/\s+/, 1)[0].toLowerCase();
    if (verb === "remove") {
      if (!sessionId) throw new Error(t("Open a CIF before removing atoms."));
      const expression = trimmed.slice(verb.length).trim();
      if (!expression) throw new Error("Usage: remove <selection>, for example remove solvent");
      const indices = viewer.evaluateSelection(expression);
      if (!indices.length) throw new Error(t("No atoms match that selection."));
      await this.options.mutate("/delete", {
        atom_indices: indices,
        close_residue_gaps: element<HTMLInputElement>("close-residue-gaps").checked,
      });
      return;
    }
    const catalog = viewer.getCommandCatalog();
    const metadata = catalog.find((entry) =>
      entry.name.toLowerCase() === verb
      || entry.aliases?.some((alias) => alias.toLowerCase() === verb)
    );
    const allowed = catalog.length
      ? metadata?.webSafe !== false && metadata !== undefined && !STUDIO_UNSAFE_PATINAE_COMMANDS.has(metadata.name)
      : FALLBACK_SAFE_PATINAE_COMMANDS.has(verb);
    if (!allowed) {
      throw new Error(
        STUDIO_UNSAFE_PATINAE_COMMANDS.has(metadata?.name ?? verb)
          ? t("Command '{0}' would desynchronize the annotated CIF. Use AtomWorks Studio editing controls instead.", [verb])
          : metadata?.unavailableReason
          ? t("Command '{0}' is unavailable in the browser: {1}", [verb, metadata.unavailableReason])
          : t("Unsupported viewer command '{0}'. Browse available commands under Backend.", [verb]),
      );
    }
    const result = await viewer.executeCommand(trimmed) as {
      messages?: Array<{ level: string; text: string }>;
    };
    const errors = result?.messages?.filter((message) => message.level === "error") ?? [];
    if (errors.length) throw new Error(errors.map((message) => message.text.trim()).join("\n"));
    const name = metadata?.name ?? verb;
    if (name === "select") {
      const selectionName = trimmed.includes(",")
        ? trimmed.slice(trimmed.search(/\s/) + 1).split(",", 1)[0].trim()
        : "sele";
      // Patinae removes empty named selections; evaluating a missing name stops its viewer.
      const exists = viewer.getSelectionList().some((selection) => selection.name === selectionName);
      this.options.selection.replace(exists ? viewer.evaluateSelection(selectionName) : [], true);
    } else if (name === "deselect") {
      this.options.selection.clear();
    }
    const messages = result?.messages?.map((message) => message.text.trim()).filter(Boolean) ?? [];
    this.options.log(messages.join("\n") || `Patinae: ${trimmed}`);
  }

  private renderCommandCatalog(): void {
    const viewer = this.options.viewer();
    const container = element("command-catalog");
    container.replaceChildren();
    if (!viewer.initialized || !viewer.capabilities.commandCatalog) return;
    const query = element<HTMLInputElement>("command-search").value.trim().toLowerCase();
    const commands = viewer.getCommandCatalog().filter((command) =>
      !query
      || command.name.toLowerCase().includes(query)
      || command.description?.toLowerCase().includes(query)
    );
    if (!commands.length) {
      container.textContent = t("No matching commands.");
      return;
    }
    for (const command of commands) {
      const button = document.createElement("button");
      button.type = "button";
      const studioUnsafe = STUDIO_UNSAFE_PATINAE_COMMANDS.has(command.name);
      button.disabled = (command.webSafe === false && command.name !== "remove") || studioUnsafe;
      const name = document.createElement("strong");
      name.textContent = command.name;
      const description = document.createElement("small");
      description.textContent = command.name === "remove"
        ? "remove <selection> · delete from the document; Undo restores it."
        : studioUnsafe
        ? "Use AtomWorks Studio so the annotated CIF remains canonical."
        : command.webSafe === false
        ? command.unavailableReason ?? "Desktop only"
        : command.usage ?? command.description ?? "";
      button.append(name, description);
      button.addEventListener("click", () => {
        this.selectionSyntax.value = "patinae";
        this.updateCommandHint();
        this.viewerCommand.value = `${command.name} `;
        this.viewerCommand.focus();
        closeToolbarMenus();
      });
      container.append(button);
    }
  }
}
