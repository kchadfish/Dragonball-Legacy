import { canonicalHash } from "./canonical.js";
import type { SimulationInterval, SimulationRateSummary } from "./statistics.js";

export interface SimulationExperimentManifest {
  readonly schemaVersion: "simulation-experiment-manifest:v1";
  readonly experimentId: string;
  readonly dimensions: Readonly<Record<string, string>>;
  readonly manifestHash: string;
}

export const createSimulationExperimentManifest = (
  experimentId: string,
  dimensions: Readonly<Record<string, string>>,
): SimulationExperimentManifest => ({
  schemaVersion: "simulation-experiment-manifest:v1",
  experimentId,
  dimensions: Object.fromEntries(
    Object.entries(dimensions).sort(([left], [right]) => left.localeCompare(right)),
  ),
  manifestHash: canonicalHash({ experimentId, dimensions }),
});

export interface SimulationComparisonCompatibility {
  readonly compatible: boolean;
  readonly undeclaredDifferences: readonly string[];
}

export const compareSimulationManifestCompatibility = (
  baseline: SimulationExperimentManifest,
  variant: SimulationExperimentManifest,
  declaredDimensions: readonly string[],
): SimulationComparisonCompatibility => {
  const declared = new Set(declaredDimensions);
  const keys = new Set([...Object.keys(baseline.dimensions), ...Object.keys(variant.dimensions)]);
  const undeclaredDifferences = [...keys]
    .filter((key) => baseline.dimensions[key] !== variant.dimensions[key] && !declared.has(key))
    .sort((left, right) => left.localeCompare(right));
  return { compatible: undeclaredDifferences.length === 0, undeclaredDifferences };
};

export const assertCompatibleSimulationManifests = (
  baseline: SimulationExperimentManifest,
  variant: SimulationExperimentManifest,
  declaredDimensions: readonly string[],
): void => {
  const compatibility = compareSimulationManifestCompatibility(
    baseline,
    variant,
    declaredDimensions,
  );
  if (!compatibility.compatible)
    throw new RangeError(
      `Simulation manifests differ on undeclared dimensions: ${compatibility.undeclaredDifferences.join(", ")}.`,
    );
};

export interface SimulationRateDifference extends SimulationInterval {
  readonly baseline: SimulationRateSummary;
  readonly variant: SimulationRateSummary;
  readonly difference: number;
}

export const compareSimulationRates = (
  baseline: SimulationRateSummary,
  variant: SimulationRateSummary,
): SimulationRateDifference => {
  const difference = variant.rate - baseline.rate;
  const interval = {
    lower: variant.lower - baseline.upper,
    upper: variant.upper - baseline.lower,
    confidence: Math.min(variant.confidence, baseline.confidence),
  };
  return { ...interval, baseline, variant, difference };
};
