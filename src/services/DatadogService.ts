import { client, v2 } from "@datadog/datadog-api-client";
import { MetricPayload } from "../types/datadog";
import { existsSync, mkdirSync, writeFileSync } from "fs";
import { join } from "path";

export class DatadogService {
  private metricsApi: v2.MetricsApi;
  private dryRun: boolean;

  constructor(options?: { dryRun?: boolean }) {
    this.dryRun = options?.dryRun ?? false;
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

  async submitMetrics(payload: MetricPayload): Promise<void> {
    this.logMetricPayload(payload);

    if (this.dryRun) {
      console.log("✨ Dry run complete - metrics logged to file");
      return;
    }

    try {
      const response = await this.metricsApi.submitMetrics({
        body: payload,
      });
      console.log("Metrics submitted successfully:", response);
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
