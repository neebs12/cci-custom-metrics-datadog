import { client, v2 } from "@datadog/datadog-api-client";
import { DatadogService } from "../DatadogService";
import { MetricPayload } from "../../types/datadog";
import { join } from "path";
import { existsSync, unlinkSync } from "fs";
import { WorkflowCache } from "../WorkflowCache";

// Mock the Datadog API client
jest.mock("@datadog/datadog-api-client", () => ({
  client: {
    createConfiguration: jest.fn().mockReturnValue({}),
  },
  v2: {
    MetricsApi: jest.fn().mockImplementation(() => ({
      submitMetrics: jest.fn(),
    })),
  },
}));

describe("DatadogService", () => {
  const mockApiKey = "test-api-key";
  const standardTags = [
    "env:ci",
    "project_slug:gh/HnryNZ/hnry-rails",
    "branch:master",
    "workflow:build_test_deploy",
    "status:success",
  ];
  let service: DatadogService;
  let mockSubmitMetrics: jest.Mock;
  let mockPayload: MetricPayload;

  beforeEach(() => {
    mockPayload = {
      series: [
        {
          metric: "ci.workflow.duration",
          type: 3,
          points: [{ timestamp: 1706054675, value: 15.5 }],
          unit: "minutes",
          tags: standardTags,
        },
      ],
    };

    // Reset environment and mocks before each test
    process.env.DD_API_KEY = mockApiKey;
    mockSubmitMetrics = jest.fn();
    (v2.MetricsApi as jest.Mock).mockImplementation(() => ({
      submitMetrics: mockSubmitMetrics,
    }));
    service = new DatadogService();
  });

  afterEach(() => {
    jest.clearAllMocks();
    delete process.env.DD_API_KEY;

    // Clean up test cache files
    const cacheDir = join(process.cwd(), "cache");
    ["sent-workflows-test.json", "sent-workflows-dry-run-test.json"].forEach(file => {
      const path = join(cacheDir, file);
      if (existsSync(path)) {
        unlinkSync(path);
      }
    });
  });

  it("should initialize with API key", () => {
    expect(client.createConfiguration).toHaveBeenCalledWith({
      authMethods: {
        apiKeyAuth: mockApiKey,
      },
    });
    expect(v2.MetricsApi).toHaveBeenCalled();
  });

  it("should throw error if API key is missing", () => {
    delete process.env.DD_API_KEY;
    expect(() => new DatadogService()).toThrow("DD_API_KEY environment variable is required");
  });

  it("should throw error when series and workflow IDs length mismatch", async () => {
    await expect(service.submitMetrics(mockPayload, ["workflow-1", "workflow-2"]))
      .rejects
      .toThrow("Mismatch between series (1) and workflow IDs (2)");
  });

  it("should submit metrics successfully with proper pairing", async () => {
    mockSubmitMetrics.mockResolvedValueOnce({ status: "ok" });

    const multiPayload: MetricPayload = {
      series: [
        {
          metric: "ci.workflow.duration",
          type: 3,
          points: [{ timestamp: 1706054675, value: 15.5 }],
          unit: "minutes",
          tags: standardTags,
        },
        {
          metric: "ci.workflow.duration",
          type: 3,
          points: [{ timestamp: 1706054676, value: 16.5 }],
          unit: "minutes",
          tags: standardTags,
        }
      ]
    };

    await service.submitMetrics(multiPayload, ["workflow-1", "workflow-2"]);

    expect(mockSubmitMetrics).toHaveBeenCalledWith({
      body: multiPayload,
    });
  });

  it("should process and filter metrics in batches", async () => {
    const service = new DatadogService({ batchSize: 2 });
    mockSubmitMetrics.mockResolvedValue({ status: "ok" });

    // Pre-mark one workflow as sent
    const cache = new WorkflowCache("sent-workflows-test.json");
    cache.markAsSent(["workflow-2"]);

    // Create a payload with 3 metrics
    const batchTestPayload: MetricPayload = {
      series: [
        {
          metric: "ci.workflow.duration",
          type: 3,
          points: [{ timestamp: 1706054675, value: 15.5 }],
          unit: "minutes",
          tags: standardTags,
        },
        {
          metric: "ci.workflow.duration",
          type: 3,
          points: [{ timestamp: 1706054676, value: 16.5 }],
          unit: "minutes",
          tags: standardTags,
        },
        {
          metric: "ci.workflow.duration",
          type: 3,
          points: [{ timestamp: 1706054677, value: 17.5 }],
          unit: "minutes",
          tags: standardTags,
        }
      ]
    };

    await service.submitMetrics(batchTestPayload, ["workflow-1", "workflow-2", "workflow-3"]);

    // Should have been called twice: first batch with workflow-1, second batch with workflow-3
    // workflow-2 should be skipped as it's already marked as sent
    expect(mockSubmitMetrics).toHaveBeenCalledTimes(2);

    // First batch should contain workflow-1's metric
    expect(mockSubmitMetrics.mock.calls[0][0].body.series).toHaveLength(1);
    expect(mockSubmitMetrics.mock.calls[0][0].body.series[0].points[0].value).toBe(15.5);

    // Second batch should contain workflow-3's metric
    expect(mockSubmitMetrics.mock.calls[1][0].body.series).toHaveLength(1);
    expect(mockSubmitMetrics.mock.calls[1][0].body.series[0].points[0].value).toBe(17.5);
  });

  it("should handle API errors", async () => {
    const mockError = new Error("API Error");
    mockSubmitMetrics.mockRejectedValueOnce(mockError);

    await expect(service.submitMetrics(mockPayload, ["workflow-1"])).rejects.toThrow("API Error");
  });

  it("should handle unknown errors", async () => {
    mockSubmitMetrics.mockRejectedValueOnce("Unknown error");

    await expect(service.submitMetrics(mockPayload, ["workflow-1"])).rejects.toThrow("Unknown error submitting metrics");
  });

  describe("Dry Run Mode", () => {
    it("should not submit metrics to Datadog in dry run mode", async () => {
      const dryRunService = new DatadogService({ dryRun: true });
      const consoleSpy = jest.spyOn(console, 'log');

      await dryRunService.submitMetrics(mockPayload, ["workflow-1"]);

      expect(mockSubmitMetrics).not.toHaveBeenCalled();
      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining("Dry run"));

      consoleSpy.mockRestore();
    });
  });

  describe("batch processing", () => {
    it("should process metrics in configured batch size", async () => {
      const service = new DatadogService({ batchSize: 2 });
      mockSubmitMetrics.mockResolvedValue({ status: "ok" });

      // Create a payload with 3 metrics
      const batchTestPayload: MetricPayload = {
        series: [
          {
            metric: "ci.workflow.duration",
            type: 3,
            points: [{ timestamp: 1706054675, value: 15.5 }],
            unit: "minutes",
            tags: standardTags,
          },
          {
            metric: "ci.workflow.duration",
            type: 3,
            points: [{ timestamp: 1706054676, value: 16.5 }],
            unit: "minutes",
            tags: standardTags,
          },
          {
            metric: "ci.workflow.duration",
            type: 3,
            points: [{ timestamp: 1706054677, value: 17.5 }],
            unit: "minutes",
            tags: standardTags,
          },
        ],
      };

      await service.submitMetrics(batchTestPayload, ["workflow-1", "workflow-2", "workflow-3"]);

      // Should have been called twice: once for first two metrics, once for the last metric
      expect(mockSubmitMetrics).toHaveBeenCalledTimes(2);

      // Verify first batch
      expect(mockSubmitMetrics.mock.calls[0][0].body.series).toHaveLength(2);
      expect(mockSubmitMetrics.mock.calls[0][0].body.series[0].points[0].value).toBe(15.5);
      expect(mockSubmitMetrics.mock.calls[0][0].body.series[1].points[0].value).toBe(16.5);

      // Verify second batch
      expect(mockSubmitMetrics.mock.calls[1][0].body.series).toHaveLength(1);
      expect(mockSubmitMetrics.mock.calls[1][0].body.series[0].points[0].value).toBe(17.5);
    });
  });

  describe("exactly once behavior", () => {
    it("should register workflow in cache only after successful API call", async () => {
      const service = new DatadogService();
      const workflowId = "workflow-1";
      mockSubmitMetrics.mockResolvedValueOnce({ status: "ok" });

      await service.submitMetrics(mockPayload, [workflowId]);

      const cache = new WorkflowCache("sent-workflows-test.json");
      expect(cache.hasBeenSent(workflowId)).toBe(true);
      expect(mockSubmitMetrics).toHaveBeenCalledTimes(1);
    });

    it("should not register workflow in cache if API call fails", async () => {
      const service = new DatadogService();
      const workflowId = "workflow-1";
      mockSubmitMetrics.mockRejectedValueOnce(new Error("API Error"));

      await expect(service.submitMetrics(mockPayload, [workflowId])).rejects.toThrow();

      const cache = new WorkflowCache("sent-workflows-test.json");
      expect(cache.hasBeenSent(workflowId)).toBe(false);
      expect(mockSubmitMetrics).toHaveBeenCalledTimes(1);
    });

    it("should not make API call for already sent workflows", async () => {
      const service = new DatadogService();
      const workflowId = "workflow-1";
      mockSubmitMetrics.mockResolvedValueOnce({ status: "ok" });

      // First call should succeed and register workflow
      await service.submitMetrics(mockPayload, [workflowId]);
      expect(mockSubmitMetrics).toHaveBeenCalledTimes(1);

      // Reset mock to verify second call
      mockSubmitMetrics.mockClear();

      // Second call should skip API call
      await service.submitMetrics(mockPayload, [workflowId]);
      expect(mockSubmitMetrics).not.toHaveBeenCalled();
    });

    it("should handle mix of new and already sent workflows", async () => {
      const service = new DatadogService();
      mockSubmitMetrics.mockResolvedValue({ status: "ok" });

      // Create a payload with 3 metrics
      const batchTestPayload: MetricPayload = {
        series: [
          {
            metric: "ci.workflow.duration",
            type: 3,
            points: [{ timestamp: 1706054675, value: 15.5 }],
            unit: "minutes",
            tags: standardTags,
          },
          {
            metric: "ci.workflow.duration",
            type: 3,
            points: [{ timestamp: 1706054676, value: 16.5 }],
            unit: "minutes",
            tags: standardTags,
          },
          {
            metric: "ci.workflow.duration",
            type: 3,
            points: [{ timestamp: 1706054677, value: 17.5 }],
            unit: "minutes",
            tags: standardTags,
          },
        ],
      };

      const firstPayload = {series: batchTestPayload.series.slice(0, 2)};
      const secondPayload = {series: batchTestPayload.series.slice(1, 3)};

      // First batch
      await service.submitMetrics(firstPayload, ["workflow-1", "workflow-2"]);
      expect(mockSubmitMetrics).toHaveBeenCalledTimes(1);

      // Second batch with one new and one already sent
      await service.submitMetrics(secondPayload, ["workflow-2", "workflow-3"]);

      const cache = new WorkflowCache("sent-workflows-test.json");
      expect(cache.hasBeenSent("workflow-1")).toBe(true);
      expect(cache.hasBeenSent("workflow-2")).toBe(true);
      expect(cache.hasBeenSent("workflow-3")).toBe(true);

      // Should have made two API calls total
      expect(mockSubmitMetrics).toHaveBeenCalledTimes(2);
    });

    it("should maintain exactly-once even after service restart", async () => {
      mockSubmitMetrics.mockResolvedValue({ status: "ok" });

      // First service instance
      const service1 = new DatadogService();
      await service1.submitMetrics(mockPayload, ["workflow-1"]);
      expect(mockSubmitMetrics).toHaveBeenCalledTimes(1);

      // Reset mock for second service instance
      mockSubmitMetrics.mockClear();

      // New service instance should still recognize sent workflows
      const service2 = new DatadogService();
      await service2.submitMetrics(mockPayload, ["workflow-1"]);
      expect(mockSubmitMetrics).not.toHaveBeenCalled();
    });
  });

  describe("dry run behavior", () => {
    it("should use separate cache file and not make API calls", async () => {
      const dryRunService = new DatadogService({ dryRun: true });
      const normalService = new DatadogService();
      mockSubmitMetrics.mockResolvedValue({ status: "ok" });

      // Dry run should not call API but should cache
      await dryRunService.submitMetrics(mockPayload, ["workflow-1"]);
      expect(mockSubmitMetrics).not.toHaveBeenCalled();

      const dryRunCache = new WorkflowCache("sent-workflows-dry-run-test.json");
      const normalCache = new WorkflowCache("sent-workflows-test.json");

      // Should be in dry run cache only
      expect(dryRunCache.hasBeenSent("workflow-1")).toBe(true);
      expect(normalCache.hasBeenSent("workflow-1")).toBe(false);

      // Normal mode should still make API call
      await normalService.submitMetrics(mockPayload, ["workflow-1"]);
      expect(mockSubmitMetrics).toHaveBeenCalledTimes(1);
    });
  });
});
