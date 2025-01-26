import { client, v2 } from "@datadog/datadog-api-client";
import { MetricPayload } from "../types/datadog";

export class DatadogService {
  private metricsApi: v2.MetricsApi;

  constructor() {
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

  async submitMetrics(payload: MetricPayload): Promise<void> {
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
