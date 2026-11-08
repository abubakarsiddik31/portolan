import { z } from "zod";

const siteSchema = z.enum(["store", "wizard", "portal", "library", "support"]);

export const successSchema = z
  .object({
    url_matches: z.string().min(1).optional(),
    dom: z.string().min(1).optional(),
    extracted: z.record(z.string(), z.string()).optional(),
    download: z
      .object({
        filename_matches: z.string().min(1).optional(),
        contains: z.string().min(1).optional(),
      })
      .optional(),
  })
  .refine(
    (value) =>
      Boolean(value.url_matches) ||
      Boolean(value.dom) ||
      (value.extracted !== undefined && Object.keys(value.extracted).length > 0) ||
      Boolean(value.download),
    { message: "success needs at least one clause" },
  );

export const templateSchema = z.object({
  id: z.string().min(1),
  goal: z.string().min(1),
  start: z.string().startsWith("/"),
  max_steps: z.number().int().positive(),
  params: z.array(z.record(z.string(), z.string())).length(5),
  success: successSchema,
});

export const taskFileSchema = z.object({
  site: siteSchema,
  templates: z.array(templateSchema).min(1),
});

export type TaskSite = z.infer<typeof siteSchema>;
export type TaskSuccess = z.infer<typeof successSchema>;
export type TaskTemplate = z.infer<typeof templateSchema> & { site: TaskSite };
export type TaskFile = z.infer<typeof taskFileSchema>;
