export const type = "grokcli" as const;
export const label = "Grok CLI";

export const models = [
  { id: "grok-composer-2.5-fast", label: "Grok Composer 2.5 Fast (default)" },
  { id: "grok-build", label: "Grok Build" },
  { id: "composer-2.5-fast", label: "Composer 2.5 Fast" },
  { id: "grok-3", label: "Grok 3" },
  { id: "grok-3-mini", label: "Grok 3 Mini" },
];

export const DEFAULT_GROK_MODEL = "grok-composer-2.5-fast";
export const DEFAULT_GROK_COMMAND = "grok";
export const DEFAULT_MAX_TURNS_PER_RUN = 50;