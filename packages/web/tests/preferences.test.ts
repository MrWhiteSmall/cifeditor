import assert from "node:assert/strict";
import test from "node:test";
import { readLanguage, setLanguage, t } from "../src/i18n/index.ts";
import { languageReloadUrl, resolvedAppearance } from "../src/preferences.ts";

test("saved language wins, invalid or unavailable storage falls back to browser", () => {
  assert.equal(readLanguage({ getItem: () => "en" }, "zh-CN"), "en");
  assert.equal(readLanguage({ getItem: () => "invalid" }, "zh-TW"), "zh-CN");
  assert.equal(readLanguage({ getItem: () => { throw new Error("blocked"); } }, "en-US"), "en");
});

test("translations preserve scientific identifiers and interpolated user data", () => {
  setLanguage("zh-CN");
  assert.equal(t("Open structure"), "打开结构");
  assert.equal(t("_atom_site.label_atom_id"), "_atom_site.label_atom_id");
  assert.equal(t("constructor"), "constructor");
  assert.equal(t("Loaded {0}.", ["my_chain_中文.cif"]), "已加载 my_chain_中文.cif。");
  setLanguage("en");
  assert.equal(t("Open structure"), "Open structure");
  assert.equal(t("Loaded {0}.", ["sample.cif"]), "Loaded sample.cif.");
});

test("system theme follows OS while explicit choices remain stable", () => {
  assert.equal(resolvedAppearance("system", true), "light");
  assert.equal(resolvedAppearance("system", false), "dark");
  assert.equal(resolvedAppearance("dark", true), "dark");
  assert.equal(resolvedAppearance("light", false), "light");
});

test("language changes restore the edited session even from an example deep link", () => {
  const url = new URL(languageReloadUrl("http://localhost:7864/?example=inverse_folding&embed=1&session=old", "en", "edited"));
  assert.equal(url.searchParams.get("session"), "edited");
  assert.equal(url.searchParams.get("lang"), "en");
  assert.equal(url.searchParams.get("embed"), "1");
  assert.equal(url.searchParams.has("example"), false);
});
