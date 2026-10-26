export function element<T extends HTMLElement>(id: string): T {
  const value = document.getElementById(id);
  if (!value) throw new Error(`Missing element #${id}`);
  return value as T;
}

export function escapeHtml(value: string): string {
  return value.replace(
    /[&<>"']/g,
    (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" })[character]!,
  );
}

export function closeToolbarMenus(except?: HTMLDetailsElement): void {
  for (const menu of document.querySelectorAll<HTMLDetailsElement>(".viewer-menu, .load-options")) {
    if (menu !== except) {
      menu.open = false;
    }
  }
}

/** Floating menus dismiss without intercepting the user's next action. */
export function bindFloatingMenus(): void {
  const menus = [...document.querySelectorAll<HTMLDetailsElement>(".viewer-menu, .load-options")];
  for (const menu of menus) {
    menu.addEventListener("toggle", () => {
      if (menu.open) closeToolbarMenus(menu);
    });
  }
  document.addEventListener("pointerdown", (event) => {
    const path = event.composedPath();
    for (const menu of menus) {
      if (menu.open && !path.includes(menu)) menu.open = false;
    }
  }, { capture: true });
  document.addEventListener("keydown", (event) => {
    if (event.key !== "Escape") return;
    const openMenu = menus.find(menu => menu.open);
    if (openMenu) {
      closeToolbarMenus();
      openMenu.querySelector("summary")?.focus();
    }
  });
}

export function applyCapabilities(capabilities: object): void {
  const available = capabilities as Record<string, boolean>;
  for (const control of document.querySelectorAll<HTMLElement>("[data-capability]")) {
    const required = (control.dataset.capability ?? "").split(/\s+/).filter(Boolean);
    control.hidden = required.some((name) => !available[name]);
  }
}
