/**
 * A control name with data in it, as a template: `Active 1` is `Active {count}`
 * and `Delete a@x.com` is `Delete {email}`. A leading number (`30 days`) is a
 * label and stays, so the date-range pills remain distinct controls.
 */
export function templateName(name: string): string {
  return name
    .replace(/[^\s@]+@[^\s@]+\.[^\s@]+/g, "{email}")
    .replace(/\((\d+)\)/g, "({count})")
    .replace(/^(.*\S) \d+$/, "$1 {count}");
}

/** The regular expression source a template stands for, anchored at both ends. */
export function templateRegex(template: string): string {
  const body = template
    .replace(/[.*+?^$()|[\]\\]/g, "\\$&")
    .replace(/\{count\}/g, "\\d+")
    .replace(/\{email\}/g, "\\S+@\\S+\\.\\S+");
  return `^${body}$`;
}

/** True when a concrete name fits a template (or equals a plain name, ignoring case). */
export function nameFitsTemplate(template: string, name: string): boolean {
  if (!template.includes("{")) return template.toLowerCase() === name.toLowerCase();
  return new RegExp(templateRegex(template), "i").test(name);
}
