import { WorkflowCache } from "../WorkflowCache";
import { join } from "path";
import { existsSync, unlinkSync, readFileSync } from "fs";

describe("WorkflowCache", () => {
  const testFilename = "workflow-cache-test.json";
  let cache: WorkflowCache;

  beforeEach(() => {
    const testPath = join(process.cwd(), "cache", testFilename);
    if (existsSync(testPath)) {
      unlinkSync(testPath);
    }
    cache = new WorkflowCache(testFilename);
  });

  afterEach(() => {
    const testPath = join(process.cwd(), "cache", testFilename);
    if (existsSync(testPath)) {
      unlinkSync(testPath);
    }
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

  it("should handle empty workflow lists", () => {
    expect(cache.filterNewWorkflows([])).toEqual([]);
    cache.markAsSent([]);
    expect(cache.hasBeenSent("any-id")).toBe(false);
  });

  it("should deduplicate workflow IDs when marking as sent", () => {
    const workflowId = "test-workflow-1";
    cache.markAsSent([workflowId, workflowId]);
    const newCache = new WorkflowCache(testFilename);
    const data = JSON.parse(readFileSync(newCache.cacheFilePath, 'utf8'));
    expect(data.sent.filter((id: string) => id === workflowId).length).toBe(1);
  });
});
