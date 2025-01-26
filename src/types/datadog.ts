import { v2 } from "@datadog/datadog-api-client";

export type MetricPoint = v2.MetricPoint;
export type MetricSeries = v2.MetricSeries;
export type MetricPayload = v2.MetricPayload;

export type BranchType = "master" | "staging" | "uat" | "feature" | "null";
export type StatusType = "success" | "failed";

export interface ProcessedTags {
  branch: BranchType;
  project_slug: string;
  workflow: string;
  status: StatusType;
}
