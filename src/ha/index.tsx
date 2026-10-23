// The Home Assistant build: one module that defines the editor panel (<home-designer-panel>,
// the sidebar's Floor plan page) and the dashboard card (custom:home-designer-card). The
// home_designer integration serves it and loads it on every page.
import { createRoot, type Root } from "react-dom/client";
import App from "../App";
import { ART_STYLE, DARK } from "../render";
import appCss from "../styles.css?inline";
import { CARD_STYLE, PlanCard, type CardConfig, type HassSource } from "./Card";
import { HassHost, type Hass } from "./hass";

// The app's stylesheet is written for a page of its own; in a shadow root its :root rules
// belong on the wrapper, which carries Home Assistant's light or dark mode as data-theme.
const PANEL_STYLE = appCss.replaceAll(":root", ".hd-root").replaceAll("html, body, #root", ":host, .hd-root") + `
/* A custom panel gets the whole window beside the sidebar, but its container has no set height. */
:host { display: block; height: 100vh; height: 100dvh; }
.hd-root { height: 100%; overflow: hidden; background: var(--ui-bg); color: var(--ui-ink); }
.hd-root[data-theme="dark"] .hd-art { ${DARK} }
.app:focus { outline: none; }
.app.loading { display: grid; place-items: center; color: var(--ui-muted); }
.save-state { color: var(--ui-muted); font-size: 13px; white-space: nowrap; }
.save-state.dirty { color: var(--ui-accent); font-weight: 600; }
button.icon { padding: 4px; display: grid; place-items: center; }
button.icon svg { width: 20px; height: 20px; fill: none; stroke: currentColor; stroke-width: 2; stroke-linecap: round; }
`;

const sheet = (css: string) => { const s = document.createElement("style"); s.textContent = css; return s; };

class HomeDesignerPanel extends HTMLElement {
  private _hass?: Hass;
  private _narrow = false;
  private root?: Root;
  private wrap?: HTMLDivElement;
  private host = new HassHost(() => this._hass!, this);

  set hass(h: Hass) {
    this._hass = h;
    if (this.wrap) this.wrap.dataset.theme = h.themes?.darkMode ? "dark" : "light";
    if (!this.root) this.mount();
    this.host.changed();
  }

  set narrow(n: boolean) {
    if (n === this._narrow) return;
    this._narrow = n;
    this.host.narrow = n;
    this.render();
  }

  private mount() {
    const shadow = this.shadowRoot ?? this.attachShadow({ mode: "open" });
    shadow.append(sheet(PANEL_STYLE));
    this.wrap = document.createElement("div");
    this.wrap.className = "hd-root";
    this.wrap.dataset.theme = this._hass?.themes?.darkMode ? "dark" : "light";
    shadow.append(this.wrap);
    this.root = createRoot(this.wrap);
    this.render();
  }

  private render() { this.root?.render(<App host={this.host} />); }

  disconnectedCallback() { this.root?.unmount(); this.root = undefined; this.shadowRoot?.replaceChildren(); this.wrap = undefined; }
  connectedCallback() { if (this._hass && !this.root) this.mount(); }
}

class HomeDesignerCard extends HTMLElement {
  private _hass?: Hass;
  private config: CardConfig = { type: "custom:home-designer-card" };
  private root?: Root;
  private wrap?: HTMLDivElement;
  private listeners = new Set<() => void>();
  private src: HassSource = {
    hass: () => this._hass!,
    subscribe: (cb) => { this.listeners.add(cb); return () => { this.listeners.delete(cb); }; },
  };

  static getStubConfig() { return {}; }

  setConfig(config: CardConfig) {
    this.config = { ...config };
    this.render();
  }

  set hass(h: Hass) {
    this._hass = h;
    if (this.wrap) this.wrap.dataset.theme = h.themes?.darkMode ? "dark" : "light";
    if (!this.root) this.mount();
    for (const f of this.listeners) f();
  }

  getCardSize() { return 8; }
  getGridOptions() { return { columns: "full", min_columns: 6, min_rows: 4 }; }

  private mount() {
    const shadow = this.shadowRoot ?? this.attachShadow({ mode: "open" });
    shadow.append(sheet(ART_STYLE + CARD_STYLE + `.hd-root[data-theme="dark"] .hd-art{${DARK}}`));
    this.wrap = document.createElement("div");
    this.wrap.className = "hd-root";
    this.wrap.dataset.theme = this._hass?.themes?.darkMode ? "dark" : "light";
    shadow.append(this.wrap);
    this.root = createRoot(this.wrap);
    this.render();
    loadBadges();
  }

  private render() {
    if (this._hass) this.root?.render(<PlanCard config={this.config} src={this.src} />);
  }

  disconnectedCallback() { this.root?.unmount(); this.root = undefined; this.shadowRoot?.replaceChildren(); this.wrap = undefined; }
  connectedCallback() { if (this._hass && !this.root) this.mount(); }
}

// <state-badge> is part of Home Assistant's frontend but only loaded with the cards that use
// it; building an entities card through the card helpers loads it.
let badgesLoading = false;
function loadBadges() {
  if (badgesLoading || customElements.get("state-badge")) return;
  badgesLoading = true;
  const w = window as Window & { loadCardHelpers?: () => Promise<{ createCardElement: (c: unknown) => HTMLElement }> };
  w.loadCardHelpers?.().then((h) => h.createCardElement({ type: "entities", entities: [] })).catch(() => {});
}

if (!customElements.get("home-designer-panel")) customElements.define("home-designer-panel", HomeDesignerPanel);
if (!customElements.get("home-designer-card")) {
  customElements.define("home-designer-card", HomeDesignerCard);
  const w = window as Window & { customCards?: unknown[] };
  (w.customCards ??= []).push({
    type: "home-designer-card", name: "Floor plan",
    description: "Your Home Designer floor plan, with live lights and sensors where you placed them.", preview: false,
  });
}
