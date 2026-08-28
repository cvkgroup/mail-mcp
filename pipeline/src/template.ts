/**
 * Placeholder substitution for prompts, paths and commands.
 *
 * `{name}` is replaced. `{{` and `}}` are literal braces, so a prompt may contain JSON.
 *
 * An unknown placeholder is an ERROR, never an empty string. A pass file once carried `{token}`
 * and `{notes}` from an earlier tool; nothing supplied either, and had substitution been lenient
 * every worker would have been handed a prompt with two silent holes in it and the run would have
 * looked normal. `checkTemplate` applies the same rule before any worker starts.
 */

export type Vars = Record<string, string | number>;

const TOKEN = /\{\{|\}\}|\{([^{}]*)\}/g;

function unknown(name: string, allowed: readonly string[], where: string): Error {
  const known = [...allowed].sort().map((k) => `{${k}}`).join(" ");
  return new Error(
    `${where} uses the placeholder {${name}}, which nothing supplies here.\n` +
      `  available: ${known}`,
  );
}

/** Substitute, or throw naming the offending placeholder and what was available. */
export function fill(template: string, vars: Vars, where: string): string {
  return template.replace(TOKEN, (match, name?: string) => {
    if (match === "{{") return "{";
    if (match === "}}") return "}";
    const key = String(name).trim();
    if (!(key in vars)) throw unknown(key, Object.keys(vars), where);
    return String(vars[key]);
  });
}

/**
 * Check a template against the names that will be available, without substituting.
 * Called at load time so a bad placeholder stops the run before it starts a worker.
 */
export function checkTemplate(template: string, allowed: readonly string[], where: string): void {
  for (const match of template.matchAll(TOKEN)) {
    if (match[0] === "{{" || match[0] === "}}") continue;
    const key = String(match[1]).trim();
    if (!allowed.includes(key)) throw unknown(key, allowed, where);
  }
}
