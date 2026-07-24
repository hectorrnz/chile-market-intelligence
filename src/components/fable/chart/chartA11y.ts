// Pure helper shared by the four SVG chart components to build their
// accessible text summaries (design_principles §20 — every chart needs a real
// accessible alternative, not just an SVG <title>). No React, no data
// fetching — callers supply already-resolved, already-translated values.

/** Replaces `{key}` placeholders in a translated template with real values. */
export function formatTemplate(template: string, vars: Record<string, string>): string {
  return template.replace(/\{(\w+)\}/g, (_, key: string) => vars[key] ?? '')
}
