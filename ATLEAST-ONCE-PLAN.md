# At-Least-Once Delivery Implementation Plan

## Overview
This document outlines the implementation plan for ensuring at-least-once delivery of metrics to Datadog, with support for dry run mode and comprehensive testing.

## Core Components

### 1. SQLite Metrics Store
- Uses `better-sqlite3` for efficient SQLite operations
- Stores workflow IDs that have been successfully sent
- Simple schema with just workflow_id as primary key
- Schema:
  ```sql
  CREATE TABLE sent_metrics (
    workflow_id TEXT PRIMARY KEY
  )
  ```

### 2. Enhanced DatadogService
- Integrates with SQLite store for tracking sent metrics
- Supports dry run mode
- Writes detailed logs to timestamped files
- Ensures atomic operations (mark as sent only after successful submission)

### 3. Logging System
- Writes to `log/YYYY-MM-DDTHH-mm-ss-sssZ.log`
- Includes dry run indicators
- Shows skipped vs new metrics
- Provides detailed metric payload information

## Implementation Steps

1. Dependencies
```bash
npm install better-sqlite3
npm install --save-dev @types/better-sqlite3
```

2. File Structure
```
src/
  ├── services/
  │   ├── MetricsStore.ts       # SQLite integration
  │   ├── DatadogService.ts     # Enhanced service
  │   └── __tests__/           # Test files
  └── types/
      └── datadog.ts           # Existing types
```

3. Configuration
- SQLite database in `cache/metrics.db`
- Log files in `log/` directory
- Both directories git-ignored

## Detailed Implementation

### MetricsStore Class
```typescript
import Database from 'better-sqlite3';
import { join } from 'path';

export class MetricsStore {
  private db: Database.Database;

  constructor(dbPath?: string) {
    const path = dbPath || join(process.cwd(), 'cache', 'metrics.db');
    this.db = new Database(path);
    this.initialize();
  }

  private initialize(): void {
    // Check if table exists
    const tableExists = this.db.prepare(`
      SELECT name
      FROM sqlite_master
      WHERE type='table' AND name='sent_metrics'
    `).get();

    if (!tableExists) {
      this.db.exec(`
        CREATE TABLE sent_metrics (
          workflow_id TEXT PRIMARY KEY
        )
      `);
    }
  }

  public hasBeenSent(workflowId: string): boolean {
    const stmt = this.db.prepare('SELECT 1 FROM sent_metrics WHERE workflow_id = ?');
    return stmt.get(workflowId) !== undefined;
  }

  public markAsSent(workflowId: string): void {
    const stmt = this.db.prepare('INSERT OR IGNORE INTO sent_metrics (workflow_id) VALUES (?)');
    stmt.run(workflowId);
  }

  public filterSentWorkflows(workflowIds: string[]): {
    sent: string[];
    unsent: string[];
  } {
    const placeholders = workflowIds.map(() => '?').join(',');
    const stmt = this.db.prepare(`
      SELECT workflow_id
      FROM sent_metrics
      WHERE workflow_id IN (${placeholders})
    `);

    const sentIds = new Set(
      stmt.all(workflowIds).map((row: any) => row.workflow_id)
    );

    return {
      sent: workflowIds.filter(id => sentIds.has(id)),
      unsent: workflowIds.filter(id => !sentIds.has(id))
    };
  }

  public close(): void {
    this.db.close();
  }
}
```

### Enhanced DatadogService
```typescript
export class DatadogService {
  private metricsApi: v2.MetricsApi;
  private dryRun: boolean;
  private metricsStore: MetricsStore;

  constructor(options?: { dryRun?: boolean }) {
    this.dryRun = options?.dryRun ?? false;
    this.metricsStore = new MetricsStore();

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

  async submitMetrics(payload: MetricPayload, workflowIds: string[]): Promise<void> {
    const { sent: alreadySentIds, unsent: newWorkflowIds } =
      this.metricsStore.filterSentWorkflows(workflowIds);

    // Prepare log content
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    const logDir = join(process.cwd(), "log");
    const logFile = join(logDir, `${timestamp}.log`);

    if (!existsSync(logDir)) {
      mkdirSync(logDir);
    }

    const logLines = ["=== Metric Submission Details ==="];

    if (this.dryRun) {
      logLines.push("🔧 DRY RUN - No actual API call will be made");

      if (alreadySentIds.length > 0) {
        logLines.push("\n🔄 The following workflow IDs would be SKIPPED (already sent):");
        alreadySentIds.forEach(id => logLines.push(`  ${id}`));
      }

      if (newWorkflowIds.length > 0) {
        logLines.push("\n✨ The following workflow IDs would be SENT:");
        newWorkflowIds.forEach(id => logLines.push(`  ${id}`));
      } else {
        logLines.push("\n⏹️  All metrics have already been sent");
      }
    }

    // Add metric details
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

    if (this.dryRun) {
      return;
    }

    if (newWorkflowIds.length === 0) {
      return;
    }

    try {
      const response = await this.metricsApi.submitMetrics({ body: payload });
      newWorkflowIds.forEach(id => this.metricsStore.markAsSent(id));
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

  public close(): void {
    this.metricsStore.close();
  }
}
```

## Testing Strategy

### 1. MetricsStore Tests
```typescript
describe('MetricsStore', () => {
  let store: MetricsStore;
  const testDbPath = join(process.cwd(), 'cache', 'test-metrics.db');

  beforeEach(() => {
    if (existsSync(testDbPath)) {
      unlinkSync(testDbPath);
    }
    store = new MetricsStore(testDbPath);
  });

  afterEach(() => {
    store.close();
    if (existsSync(testDbPath)) {
      unlinkSync(testDbPath);
    }
  });

  it('should correctly mark and check sent workflows', () => {
    const workflowId = 'test-workflow-1';
    expect(store.hasBeenSent(workflowId)).toBe(false);

    store.markAsSent(workflowId);
    expect(store.hasBeenSent(workflowId)).toBe(true);
  });

  it('should efficiently handle batch operations', () => {
    const workflowIds = ['workflow-1', 'workflow-2', 'workflow-3'];
    store.markAsSent(workflowIds[0]);

    const { sent, unsent } = store.filterSentWorkflows(workflowIds);
    expect(sent).toEqual(['workflow-1']);
    expect(unsent).toEqual(['workflow-2', 'workflow-3']);
  });

  it('should create table only if it does not exist', () => {
    // Create a new database with our table
    const store1 = new MetricsStore(testDbPath);
    store1.markAsSent('test-1');

    // Drop and recreate table to simulate missing table in existing db
    store1.db.exec('DROP TABLE sent_metrics');

    // New instance should recreate the table
    const store2 = new MetricsStore(testDbPath);
    store2.markAsSent('test-2');
    expect(store2.hasBeenSent('test-2')).toBe(true);

    store1.close();
    store2.close();
  });
});
```

### 2. DatadogService Tests
```typescript
describe('DatadogService', () => {
  describe('Normal Mode', () => {
    it('should mark workflows as sent after successful submission', async () => {
      const service = new DatadogService();
      const mockPayload = { /* ... */ };
      const mockWorkflowIds = ['workflow-1', 'workflow-2'];

      await service.submitMetrics(mockPayload, mockWorkflowIds);

      mockWorkflowIds.forEach(id => {
        expect(service['metricsStore'].hasBeenSent(id)).toBe(true);
      });
    });

    it('should not mark workflows as sent if submission fails', async () => {
      // Test implementation
    });
  });

  describe('Dry Run Mode', () => {
    it('should not submit metrics or mark workflows as sent', async () => {
      const service = new DatadogService({ dryRun: true });
      const mockPayload = { /* ... */ };
      const mockWorkflowIds = ['workflow-1'];

      await service.submitMetrics(mockPayload, mockWorkflowIds);

      expect(service['metricsStore'].hasBeenSent(mockWorkflowIds[0])).toBe(false);
    });

    it('should write to log file with dry run indicators', async () => {
      // Test implementation
    });
  });
});
```

## Migration Plan

1. Initial Setup
- Add new dependencies
- Create database schema
- Update .gitignore

2. Code Changes
- Implement MetricsStore
- Enhance DatadogService
- Add tests

3. Verification
- Run test suite
- Perform dry run
- Monitor initial deployment
