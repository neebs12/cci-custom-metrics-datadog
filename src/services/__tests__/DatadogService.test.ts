import { client, v2 } from "@datadog/datadog-api-client";
import { DatadogService } from "../DatadogService";
import { MetricPayload } from "../../types/datadog";

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
  let service: DatadogService;
  let mockSubmitMetrics: jest.Mock;

  beforeEach(() => {
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

  it("should submit metrics successfully", async () => {
    const mockPayload: MetricPayload = {
      series: [
        {
          metric: "ci.workflow.duration",
          type: 3,
          points: [{ timestamp: 1706054675, value: 15.5 }],
          unit: "minutes",
          tags: ["env:ci", "branch:master"],
        },
      ],
    };

    mockSubmitMetrics.mockResolvedValueOnce({ status: "ok" });

    await service.submitMetrics(mockPayload);

    expect(mockSubmitMetrics).toHaveBeenCalledWith({
      body: mockPayload,
    });
  });

  it("should handle API errors", async () => {
    const mockError = new Error("API Error");
    mockSubmitMetrics.mockRejectedValueOnce(mockError);

    const mockPayload: MetricPayload = {
      series: [
        {
          metric: "ci.workflow.duration",
          type: 3,
          points: [{ timestamp: 1706054675, value: 15.5 }],
          unit: "minutes",
          tags: ["env:ci", "branch:master"],
        },
      ],
    };

    await expect(service.submitMetrics(mockPayload)).rejects.toThrow("API Error");
  });

  it("should handle unknown errors", async () => {
    mockSubmitMetrics.mockRejectedValueOnce("Unknown error");

    const mockPayload: MetricPayload = {
      series: [
        {
          metric: "ci.workflow.duration",
          type: 3,
          points: [{ timestamp: 1706054675, value: 15.5 }],
          unit: "minutes",
          tags: ["env:ci", "branch:master"],
        },
      ],
    };

    await expect(service.submitMetrics(mockPayload)).rejects.toThrow("Unknown error submitting metrics");
  });
});
