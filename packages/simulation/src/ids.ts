import { z } from "zod";

const stableIdSchema = (namespace: string) =>
  z.string().regex(new RegExp(`^${namespace}:[a-z0-9]+(?:-[a-z0-9]+)*$`), {
    message: `ID must use the ${namespace}:lowercase-hyphenated form.`,
  });

export const simulationTemplateIdSchema = stableIdSchema("simulation-template");
export const simulationScenarioIdSchema = stableIdSchema("simulation-scenario");
export const simulationSeriesIdSchema = stableIdSchema("simulation-series");
export const simulationVariantIdSchema = stableIdSchema("simulation-variant");
export const simulationRunIdSchema = stableIdSchema("simulation-run");
export const simulationReportIdSchema = stableIdSchema("simulation-report");
export const customMoveDraftIdSchema = stableIdSchema("custom-move-draft");

export type SimulationTemplateId = z.infer<typeof simulationTemplateIdSchema>;
export type SimulationScenarioId = z.infer<typeof simulationScenarioIdSchema>;
export type SimulationSeriesId = z.infer<typeof simulationSeriesIdSchema>;
export type SimulationVariantId = z.infer<typeof simulationVariantIdSchema>;
export type SimulationRunId = z.infer<typeof simulationRunIdSchema>;
export type SimulationReportId = z.infer<typeof simulationReportIdSchema>;
export type CustomMoveDraftId = z.infer<typeof customMoveDraftIdSchema>;

export const parseSimulationId = <TSchema extends z.ZodType<string>>(
  schema: TSchema,
  value: unknown,
): z.output<TSchema> => schema.parse(value);
