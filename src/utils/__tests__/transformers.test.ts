import { BigQueryWorkflowData } from "../../types/bigquery";
import { transformToDatadogMetric } from "../transformers";

describe("transformToDatadogMetric", () => {
  const mockTimestamp = 1706054675; // Fixed timestamp for testing
  const workflowId = "d744b9ea-7e3c-4e1a-9df8-721e4f6ea67f";
  const baseWorkflowData: BigQueryWorkflowData = {
    minutes: "15.5",
    created_at: "2025-01-24 14:04:35.000000 UTC",
    branch: "master",
    workflow_name: "build_test_deploy",
    status: "success",
    project_slug: "gh/HnryNZ/hnry-rails",
    workflow_id: workflowId,
  };

  beforeAll(() => {
    // Mock Date.now() to return a fixed timestamp
    jest.useFakeTimers();
    jest.setSystemTime(new Date(mockTimestamp * 1000));
  });

  afterAll(() => {
    jest.useRealTimers();
  });

  it ("should return the correct workflow id", () => {
    const result = transformToDatadogMetric([baseWorkflowData]);

    expect(result[1][0]).toEqual(workflowId);
  })

  it("should transform valid workflow data correctly", () => {
    const result = transformToDatadogMetric([baseWorkflowData]);

    expect(result[0].series).toHaveLength(1);
    expect(result[0].series[0]).toMatchObject({
      metric: "ci.workflow.duration",
      type: 3,
      points: [
        {
          timestamp: expect.any(Number),
          value: 15.5,
        },
      ],
      unit: "minutes",
      tags: [
        "env:ci",
        "project_slug:gh/HnryNZ/hnry-rails",
        "branch:master",
        "workflow:build_test_deploy",
        "status:success",
      ],
    });
  });

  it("should handle null branch correctly", () => {
    const data = {
      ...baseWorkflowData,
      branch: null,
    };

    const result = transformToDatadogMetric([data]);

    expect(result[0].series[0].tags).toContain("branch:null");
  });

  it("should convert non-master/staging/uat branches to feature", () => {
    const data = {
      ...baseWorkflowData,
      branch: "chore/update-dependencies",
    };

    const result = transformToDatadogMetric([data]);

    expect(result[0].series[0].tags).toContain("branch:feature");
  });

  it("should keep master/staging/uat branches as-is", () => {
    const branches = ["master", "staging", "uat"];

    branches.forEach((branch) => {
      const data = {
        ...baseWorkflowData,
        branch,
      };

      const result = transformToDatadogMetric([data]);
      expect(result[0].series[0].tags).toContain(`branch:${branch}`);
    });
  });

  it("should skip records with non-success/failure status", () => {
    const data = {
      ...baseWorkflowData,
      status: "cancelled",
    };

    const result = transformToDatadogMetric([data]);

    expect(result[0].series).toHaveLength(0);
  });

  it("should skip records with null values (except branch)", () => {
    const nullTests = Object.keys(baseWorkflowData).map((key) => {
      const data = { ...baseWorkflowData };
      if (key === "branch") {
        data.branch = null; // branch can be null
      } else {
        // @ts-ignore - intentionally setting null for testing
        data[key as keyof BigQueryWorkflowData] = null;
      }
      return data;
    });

    nullTests.forEach((testData) => {
      const result = transformToDatadogMetric([testData as BigQueryWorkflowData]);
      if (testData?.branch === null) {
        // Only branch can be null
        expect(result[0].series).toHaveLength(1);
      } else {
        expect(result[0].series).toHaveLength(0);
      }
    });
  });

  it("should handle multiple records correctly", () => {
    const data = [
      baseWorkflowData,
      {
        ...baseWorkflowData,
        branch: "staging",
        minutes: "20.5",
      },
      {
        ...baseWorkflowData,
        status: "cancelled", // should be filtered out
      },
    ];

    const result = transformToDatadogMetric(data);

    expect(result[0].series).toHaveLength(2);
    expect(result[0].series[0].tags).toContain("branch:master");
    expect(result[0].series[1].tags).toContain("branch:staging");
  });

  it("should parse minutes to float correctly", () => {
    const data = {
      ...baseWorkflowData,
      minutes: "15.116666666666667",
    };

    const result = transformToDatadogMetric([data]);

    expect(result[0].series[0].points[0].value).toBe(15.116666666666667);
  });

  it("should always include env:ci tag", () => {
    const result = transformToDatadogMetric([baseWorkflowData]);

    expect(result[0].series[0].tags).toContain("env:ci");
  });

  it("should skip records with missing required tags", () => {
    const testCases = [
      { ...baseWorkflowData, project_slug: "" },
      { ...baseWorkflowData, workflow_name: "" },
      { ...baseWorkflowData, status: "" },
    ];

    testCases.forEach(testCase => {
      const result = transformToDatadogMetric([testCase]);
      expect(result[0].series).toHaveLength(0);
    });
  });

  it("should require all mandatory tags to be present", () => {
    const result = transformToDatadogMetric([baseWorkflowData]);

    expect(result[0].series).toHaveLength(1);
    const series = result[0].series[0];
    expect(series).toBeDefined();
    expect(series.tags).toBeDefined();
    const requiredTags = ["env:ci", "project_slug:", "branch:", "workflow:", "status:"];
    requiredTags.forEach(tag => {
      // @ts-ignore - intentionally setting null for testing
      expect(series.tags.some(t => t.startsWith(tag))).toBe(true);
    });
  });
});
