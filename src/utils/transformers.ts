import { BigQueryWorkflowData } from "../types/bigquery";
import { BranchType, MetricPayload, ProcessedTags, StatusType, MetricSeries } from "../types/datadog";
import { v2 } from "@datadog/datadog-api-client";

const METRIC_NAME = "ci.workflow.duration";
const ENV_TAG = "env:ci";

const processBranch = (branch: string | null): BranchType => {
  if (branch === null) return "null";
  if (["master", "staging", "uat"].includes(branch)) {
    return branch as BranchType;
  }
  return "feature";
};

const processStatus = (status: string): StatusType | null => {
  if (status === "success" || status === "failure") {
    return status as StatusType;
  }
  return null;
};

const isValidRecord = (record: BigQueryWorkflowData): boolean => {
  // Skip records with null values in any field except branch
  return (
    record.minutes != null &&
    record.created_at != null &&
    record.workflow_name != null &&
    record.status != null &&
    record.project_slug != null &&
    record.workflow_id != null
  );
};

const processTags = (data: BigQueryWorkflowData): ProcessedTags | null => {
  if (!isValidRecord(data)) return null;

  const status = processStatus(data.status);
  if (!status) return null;

  return {
    branch: processBranch(data.branch),
    project_slug: data.project_slug,
    workflow: data.workflow_name,
    status,
  };
};

const formatTags = (tags: ProcessedTags): string[] => {
  return [
    ENV_TAG,
    `project_slug:${tags.project_slug}`,
    `branch:${tags.branch}`,
    `workflow:${tags.workflow}`,
    `status:${tags.status}`,
  ];
};

const parseTimestamp = (dateStr: string): number => {
  return Math.floor(new Date(dateStr).getTime() / 1000);
};

export const transformToDatadogMetric = (
  data: BigQueryWorkflowData[]
): MetricPayload => {
  const series = data
    .map((record) => {
      const tags = processTags(record);
      if (!tags) return null;

      const series: MetricSeries = {
        metric: METRIC_NAME,
        type: 3, // MetricIntakeType.GAUGE
        points: [
          {
            timestamp: parseTimestamp(record.created_at),
            value: parseFloat(record.minutes),
          },
        ],
        unit: "minutes",
        tags: formatTags(tags),
      };
      return series;
    })
    .filter((series): series is NonNullable<typeof series> => series !== null);

  return { series };
};
