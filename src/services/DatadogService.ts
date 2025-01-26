import { client, v2 } from "@datadog/datadog-api-client";
import { MetricPayload } from "../types/datadog";
import { existsSync, mkdirSync, writeFileSync } from "fs";
import { join } from "path";
import { WorkflowCache } from "./WorkflowCache";

export class DatadogService {
  private metricsApi: v2.MetricsApi;
  private dryRun: boolean;
  private workflowCache: WorkflowCache;
  private batchSize: number;

  constructor(options?: { dryRun?: boolean; batchSize?: number }) {
    this.dryRun = options?.dryRun ?? false;
    this.batchSize = options?.batchSize ?? 10;

    // Initialize workflow cache with appropriate filename
    let filename = this.dryRun ? "sent-workflows-dry-run.json" : "sent-workflows.json";
    if (process.env.NODE_ENV === "test") {
      filename = this.dryRun ? "sent-workflows-dry-run-test.json" : "sent-workflows-test.json";
    }
    this.workflowCache = new WorkflowCache(filename);
    if (!process.env.DD_API_KEY) {
      throw new Error("DD_API_KEY environment variable is required");
    }

    const configuration = client.createConfiguration({
      authMethods: {
        apiKeyAuth: process.env.DD_API_KEY,
      },
    });

    this.metricsApi = new v2.MetricsApi(configuration);
  }

  private logMetricPayload(payload: MetricPayload): void {
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    const logDir = join(process.cwd(), "log");
    const logFile = join(logDir, `${timestamp}.log`);

    // Create log directory if it doesn't exist
    if (!existsSync(logDir)) {
      mkdirSync(logDir);
    }

    const logLines = ["=== Metric Submission Details ==="];
    if (this.dryRun) logLines.push("🔧 DRY RUN - No actual API call will be made");

    payload.series.forEach(series => {
      logLines.push(`\nMetric: ${series.metric}`);
      logLines.push(`Type: ${series.type}`);
      logLines.push(`Unit: ${series.unit}`);

      series.points.forEach(point => {
        if (point.timestamp !== undefined && point.value !== undefined) {
          logLines.push(`\nTimestamp: ${point.timestamp} (${new Date(point.timestamp * 1000).toISOString()})`);
          logLines.push(`Value: ${point.value} ${series.unit}`);
        }
      });

      logLines.push("\nTags:");
      series.tags?.forEach(tag => logLines.push(`  ${tag}`));
    });

    logLines.push("\nEndpoint: /api/v2/series");
    logLines.push("=" .repeat(30));

    writeFileSync(logFile, logLines.join("\n"));
    console.log(`Log written to: ${logFile}`);
  }

  async submitMetrics(payload: MetricPayload, workflowIds: string[]): Promise<void> {
    const newWorkflows = this.workflowCache.filterNewWorkflows(workflowIds);

    if (newWorkflows.length === 0) {
      console.log("All workflows have already been processed, skipping");
      return;
    }

    // Process in configured batch size
    for (let i = 0; i < newWorkflows.length; i += this.batchSize) {
      const batchWorkflows = newWorkflows.slice(i, i + this.batchSize);

      // Create a batch payload with corresponding series
      const batchPayload: MetricPayload = {
        series: payload.series.slice(i, i + this.batchSize)
      };

      this.logMetricPayload(batchPayload);

      try {
        if (!this.dryRun) {
          const response = await this.metricsApi.submitMetrics({
            body: batchPayload,
          });
          console.log(`Batch ${i/this.batchSize + 1} metrics submitted successfully:`, response);
        } else {
          console.log("✨ Dry run complete - metrics logged to file");
          console.log("Would have processed workflows:", batchWorkflows);
        }

        // Mark workflows as sent for this batch, regardless of dry run
        this.workflowCache.markAsSent(batchWorkflows);
      } catch (error) {
        if (error instanceof Error) {
          console.error("Error submitting metrics:", error.message);
          throw error;
        }
        console.error("Unknown error submitting metrics:", error);
        throw new Error("Unknown error submitting metrics");
      }
    }
  }
}
