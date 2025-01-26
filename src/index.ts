import { config } from "dotenv";
import { readFileSync, readdirSync } from "fs";
import { join } from "path";
import { DatadogService } from "./services/DatadogService";
import { BigQueryWorkflowData } from "./types/bigquery";
import { transformToDatadogMetric } from "./utils/transformers";

// Load environment variables
config();

async function processFile(filePath: string, datadogService: DatadogService): Promise<void> {
  try {
    console.log(`Processing file: ${filePath}`);
    const rawData = readFileSync(filePath, "utf-8");
    const workflowData: BigQueryWorkflowData[] = JSON.parse(rawData);

    // Transform data to Datadog metrics format
    const metricPayload = transformToDatadogMetric(workflowData);

    // Submit metrics to Datadog
    await datadogService.submitMetrics(metricPayload);
    console.log(`Successfully processed and submitted metrics from ${filePath}`);
  } catch (error) {
    console.error(`Error processing file ${filePath}:`, error);
    // Continue processing other files even if one fails
  }
}

async function main() {
  try {
    // Initialize Datadog service with dry run option
    const isDryRun = process.env.DRY_RUN === "true";
    const datadogService = new DatadogService({ dryRun: isDryRun });

    if (isDryRun) {
      console.log("🔧 Running in DRY RUN mode - no metrics will be submitted to Datadog");
    }

    // Get all JSON files from the data directory
    const dataDir = join(__dirname, "..", "data");
    const files = readdirSync(dataDir)
      .filter(file => file.endsWith(".json"))
      .map(file => join(dataDir, file));

    if (files.length === 0) {
      console.log("No JSON files found in the data directory");
      return;
    }

    // Process each file
    console.log(`Found ${files.length} JSON file(s) to process`);
    for (const file of files) {
      await processFile(file, datadogService);
    }

    console.log("Completed processing all files");
  } catch (error) {
    console.error("Fatal error:", error);
    process.exit(1);
  }
}

main();
