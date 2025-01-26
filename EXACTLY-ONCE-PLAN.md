# Simple Exactly-Once Implementation Plan

## Overview
Use simple JSON files to track sent workflow IDs via a dedicated cache class, with separate files for dry run mode.

## Implementation

### 1. WorkflowCache Class
```typescript
// src/services/WorkflowCache.ts
export class WorkflowCache {
  private cacheFilePath: string;

  constructor(filename: string) {
    const cacheDir = join(process.cwd(), "cache");
    if (!existsSync(cacheDir)) {
      mkdirSync(cacheDir);
    }
    this.cacheFilePath = join(cacheDir, filename);
    this.ensureCacheExists();
  }

  private ensureCacheExists(): void {
    if (!existsSync(this.cacheFilePath)) {
      writeFileSync(this.cacheFilePath, JSON.stringify({ sent: [] }, null, 2));
    }
  }

  public hasBeenSent(workflowId: string): boolean {
    try {
      const data = JSON.parse(readFileSync(this.cacheFilePath, 'utf8'));
      return data.sent.includes(workflowId);
    } catch (error) {
      console.warn("Error reading cache file:", error);
      return false;
    }
  }

  public markAsSent(workflowIds: string[]): void {
    try {
      const data = JSON.parse(readFileSync(this.cacheFilePath, 'utf8'));
      const newSent = [...new Set([...data.sent, ...workflowIds])];
      writeFileSync(this.cacheFilePath, JSON.stringify({ sent: newSent }, null, 2));
    } catch (error) {
      console.error("Error updating cache file:", error);
      throw error;
    }
  }

  public filterNewWorkflows(workflowIds: string[]): string[] {
    return workflowIds.filter(id => !this.hasBeenSent(id));
  }
}
```

### 2. Enhanced DatadogService
```typescript
export class DatadogService {
  private metricsApi: v2.MetricsApi;
  private dryRun: boolean;
  private workflowCache: WorkflowCache;

  constructor(options?: { dryRun?: boolean }) {
    this.dryRun = options?.dryRun ?? false;

    // Just pass the filename, WorkflowCache handles the cache/ directory
    const filename = this.dryRun ? "sent-workflows-dry-run.json" : "sent-workflows.json";
    this.workflowCache = new WorkflowCache(filename);

    // ... existing configuration code ...
  }

  async submitMetrics(payload: MetricPayload, workflowIds: string[]): Promise<void> {
    const newWorkflows = this.workflowCache.filterNewWorkflows(workflowIds);

    if (newWorkflows.length === 0) {
      console.log("All workflows have already been processed, skipping");
      return;
    }

    // Log metrics (existing functionality)
    this.logMetricPayload(payload);

    if (this.dryRun) {
      console.log("✨ Dry run complete - metrics logged to file");
      console.log("Would have processed workflows:", newWorkflows);
      this.workflowCache.markAsSent(newWorkflows); // Save to dry run cache
      return;
    }

    try {
      const response = await this.metricsApi.submitMetrics({
        body: payload,
      });
      console.log("Metrics submitted successfully:", response);

      // Save workflow IDs to cache after successful submission
      this.workflowCache.markAsSent(newWorkflows);
    } catch (error) {
      // ... existing error handling ...
    }
  }
}
```

### 3. Testing

```typescript
describe("WorkflowCache", () => {
  const testFilename = "test-cache.json";
  let cache: WorkflowCache;

  beforeEach(() => {
    const testPath = join(process.cwd(), "cache", testFilename);
    if (existsSync(testPath)) {
      unlinkSync(testPath);
    }
    cache = new WorkflowCache(testFilename);
  });

  it("should persist sent workflow IDs", () => {
    const workflowId = "test-workflow-1";
    expect(cache.hasBeenSent(workflowId)).toBe(false);

    cache.markAsSent([workflowId]);
    expect(cache.hasBeenSent(workflowId)).toBe(true);

    // Create new instance to verify persistence
    const newCache = new WorkflowCache(testFilename);
    expect(newCache.hasBeenSent(workflowId)).toBe(true);
  });

  it("should filter new workflows", () => {
    const workflowIds = ["workflow-1", "workflow-2"];
    cache.markAsSent([workflowIds[0]]);

    const newWorkflows = cache.filterNewWorkflows(workflowIds);
    expect(newWorkflows).toEqual(["workflow-2"]);
  });
});

describe("DatadogService", () => {
  let mockSubmitMetrics: jest.Mock;

  beforeEach(() => {
    process.env.DD_API_KEY = "test-key";
    // Reset mock between tests
    mockSubmitMetrics = jest.fn();
    (v2.MetricsApi as jest.Mock).mockImplementation(() => ({
      submitMetrics: mockSubmitMetrics
    }));
  });

  afterEach(() => {
    // Clean up test cache files
    const cacheDir = join(process.cwd(), "cache");
    ["sent-workflows.json", "sent-workflows-dry-run.json"].forEach(file => {
      const path = join(cacheDir, file);
      if (existsSync(path)) {
        unlinkSync(path);
      }
    });
  });

  describe("exactly once behavior", () => {
    it("should register workflow in cache only after successful API call", async () => {
      const service = new DatadogService();
      const workflowId = "workflow-1";
      mockSubmitMetrics.mockResolvedValueOnce({ status: "ok" });

      await service.submitMetrics(mockPayload, [workflowId]);

      const cache = new WorkflowCache("sent-workflows.json");
      expect(cache.hasBeenSent(workflowId)).toBe(true);
      expect(mockSubmitMetrics).toHaveBeenCalledTimes(1);
    });

    it("should not register workflow in cache if API call fails", async () => {
      const service = new DatadogService();
      const workflowId = "workflow-1";
      mockSubmitMetrics.mockRejectedValueOnce(new Error("API Error"));

      await expect(service.submitMetrics(mockPayload, [workflowId])).rejects.toThrow();

      const cache = new WorkflowCache("sent-workflows.json");
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

      // First batch
      await service.submitMetrics(mockPayload, ["workflow-1", "workflow-2"]);
      expect(mockSubmitMetrics).toHaveBeenCalledTimes(1);

      // Second batch with one new and one already sent
      await service.submitMetrics(mockPayload, ["workflow-2", "workflow-3"]);

      const cache = new WorkflowCache("sent-workflows.json");
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

      const dryRunCache = new WorkflowCache("sent-workflows-dry-run.json");
      const normalCache = new WorkflowCache("sent-workflows.json");

      // Should be in dry run cache only
      expect(dryRunCache.hasBeenSent("workflow-1")).toBe(true);
      expect(normalCache.hasBeenSent("workflow-1")).toBe(false);

      // Normal mode should still make API call
      await normalService.submitMetrics(mockPayload, ["workflow-1"]);
      expect(mockSubmitMetrics).toHaveBeenCalledTimes(1);
    });
  });
});
```

## Changes from Previous Plan

1. Simplified responsibilities:
   - WorkflowCache handles the cache/ directory and file operations
   - DatadogService just decides the filename
2. WorkflowCache:
   - Takes just a filename parameter
   - Handles creating cache/ directory if needed
   - Creates files in cache/ directory
3. DatadogService:
   - Simply chooses filename based on mode
   - sent-workflows.json for normal mode
   - sent-workflows-dry-run.json for dry run mode
4. Both modes track workflows:
   - Normal mode saves after successful API call
   - Dry run mode saves what would have been sent
5. Kept all other functionality:
   - Cache files persist between runs
   - Only created if they don't exist
   - Simple file-based approach
   - No complex dependencies

The approach is now:
- WorkflowCache handles all file operations in cache/ directory
- DatadogService just picks the filename
- Cache files only created if they don't exist
- Separate tracking for dry run and normal mode
- No complex setup required, just works with the file system
