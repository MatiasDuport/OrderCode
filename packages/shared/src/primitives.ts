import { z } from "zod";

export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };

export const jsonValueSchema: z.ZodType<JsonValue> = z.lazy(() =>
  z.union([
    z.string(),
    z.number().finite(),
    z.boolean(),
    z.null(),
    z.array(jsonValueSchema),
    z.record(z.string(), jsonValueSchema),
  ]),
);

export const nonEmptyStringSchema = z.string().trim().min(1);
export const idSchema = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/);
export const uuidSchema = z.uuid();
export const timestampSchema = z.string().datetime({ offset: true });
export const positiveIntSchema = z.number().int().positive();
export const nonNegativeIntSchema = z.number().int().nonnegative();
export const nonNegativeNumberSchema = z.number().finite().nonnegative();
export const percentageSchema = z.number().finite().min(0).max(1);
export const pathSchema = nonEmptyStringSchema.max(16_384);

export const metadataSchema = z.record(z.string().max(128), jsonValueSchema);

export const sortDirectionSchema = z.enum(["ASC", "DESC"]);
export const healthStatusSchema = z.enum(["HEALTHY", "DEGRADED", "UNAVAILABLE"]);

export type Json = z.infer<typeof jsonValueSchema>;
export type Metadata = z.infer<typeof metadataSchema>;
