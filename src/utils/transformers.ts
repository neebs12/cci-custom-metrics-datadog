import { BigQueryWorkflowData } from "../types/bigquery";
import { BranchType, MetricPayload, ProcessedTags, StatusType, MetricSeries } from "../types/datadog";

const METRIC_NAME = "ci.workflow.duration";
const ENV_TAG = "env:ci";
const REQUIRED_TAGS = ["env:ci", "project_slug", "branch", "workflow", "status"] as const;

const processBranch = (branch: string | null): BranchType => {
  if (branch === null) return "null";
  if (["master", "staging", "uat"].includes(branch)) {
    return branch as BranchType;
  }
  return "feature";
};

const processStatus = (status: string): StatusType | null => {
  if (status === "success" || status === "failed") {
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

const formatTags = (tags: ProcessedTags): string[] | null => {
  const formattedTags = [
    ENV_TAG,
    `project_slug:${tags.project_slug}`,
    `branch:${tags.branch}`,
    `workflow:${tags.workflow}`,
    `status:${tags.status}`,
  ];

  // Verify all required tags are present and have values
  // Iterate through REQUIRED_TAGS and see if they are present in `formattedTags`
  const missingTags = REQUIRED_TAGS.filter(tag => {
    let fullTag = "";
    if (tag === ENV_TAG) {
      fullTag = ENV_TAG
    } else {
      fullTag = `${tag}:${tags[tag.split(":")[0] as keyof ProcessedTags]}`
    }
    return !formattedTags.includes(fullTag);
  });

  if (missingTags.length > 0) {
    console.error(`Missing required tags: ${missingTags.join(", ")}`);
    return null;
  }

  // Verify that the tag values are not empty, otherwise return null
  const foundMissingValues = formattedTags.some(tag => {
    const parts = tag.split(":");
    return parts[1] === undefined || parts[1].trim().length === 0;
  });

  if (foundMissingValues) {
    return null;
  }

  return formattedTags;
};

const parseTimestamp = (dateStr: string): number => {
  return Math.floor(new Date(dateStr).getTime() / 1000);
};

export const transformToDatadogMetric = (
  data: BigQueryWorkflowData[]
): [MetricPayload, string[]] => {

  const seriesWithNulls = data
  .map((record) => {
    const tags = processTags(record);
    if (!tags) return null;

    const formattedTags = formatTags(tags);
    if (!formattedTags) return null;

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
      tags: formattedTags,
    };
    return series;
  })

  const series = seriesWithNulls.filter((sNull): sNull is NonNullable<typeof sNull> => sNull !== null);
  // return only workflow ids which are NOT nulled
  const workflowIds = data.map(d => d.workflow_id).filter((_, ind) => {
    return seriesWithNulls[ind] !== null
  })


  return [{ series }, workflowIds];
};
