/**
 * Replace `{param}` placeholders in a template.
 *
 * Returns undefined when a placeholder has no value, so the caller can
 * return `invalid_params` instead of sending a literal `{param}` to a page.
 */
export function fillTemplate(
  template: string,
  params: Record<string, unknown>,
): string | undefined {
  let missing = false;

  const value = template.replace(/\{([a-zA-Z0-9_]+)\}/g, (_, key: string) => {
    const param = params[key];
    if (param === undefined) {
      missing = true;
      return "";
    }
    return String(param);
  });

  return missing ? undefined : value;
}

/** Same as fillTemplate, but each value is URL-encoded for a route. */
export function fillRoute(template: string, params: Record<string, unknown>): string | undefined {
  let missing = false;

  const value = template.replace(/\{([a-zA-Z0-9_]+)\}/g, (_, key: string) => {
    const param = params[key];
    if (param === undefined) {
      missing = true;
      return "";
    }
    return encodeURIComponent(String(param));
  });

  return missing ? undefined : value;
}
