# CircleCI Custom Metrics for Datadog

This project processes CircleCI workflow data from BigQuery and sends it to Datadog as custom metrics for monitoring and analysis.

## Project Structure

```
src/
  ├── types/                    # Type definitions
  │   ├── bigquery.ts          # BigQuery data types
  │   └── datadog.ts           # Datadog types
  ├── services/
  │   └── DatadogService.ts    # Datadog API integration
  ├── utils/
  │   └── transformers.ts      # Data transformation utilities
  └── index.ts                 # Main application entry
```

## Implementation Details

### 1. Types (src/types/)

#### BigQuery Types
- Define interfaces for workflow data structure:
  - minutes (duration)
  - created_at (timestamp)
  - branch
  - workflow_name
  - status
  - project_slug
  - workflow_id

#### Datadog Types
- Define interfaces for metric submission:
  - Metric name: "ci.workflow.duration"
  - Type: gauge
  - Unit: minutes
  - Tags structure

### 2. DatadogService (src/services/)

Core service for interacting with Datadog API:
- Initialize client with API key
- Submit metrics with error handling
- Configure metric type and unit
- Handle batch processing if needed

### 3. Data Transformers (src/utils/)

Transform BigQuery data to Datadog format with special tag processing rules:

#### Data Validation
- Skip any records where any key-value pairs are null (except for the branch field which has special handling)

#### Tag Rules
- Environment tag:
  * Always include "env:ci"

- Branch tag:
  * null → "branch:null"
  * master/staging/uat → use as-is
  * others → "branch:feature"

- Project and Workflow tags:
  * project_slug → as-is
  * workflow_name → as-is

- Status tag:
  * Only process success/failure statuses
  * Skip other statuses

### 4. Main Application (src/index.ts)

Entry point functionality:
- Load environment configuration
- Read BigQuery JSON data
- Transform data using utility functions
- Submit metrics to Datadog
- Handle errors and provide logging

## Environment Configuration

Required environment variables:
- DD_SITE="datadoghq.com"
- DD_API_KEY="<your-api-key>"

## Datadog Metric Format

```json
{
  "series": [{
    "metric": "ci.workflow.duration",
    "type": 3,
    "points": [{
      "timestamp": <unix_timestamp>,
      "value": <duration_in_minutes>
    }],
    "unit": "minutes",
    "tags": [
      "env:ci",
      "project_slug:<value>",
      "branch:<value>",
      "workflow:<value>",
      "status:<value>"
    ]
  }]
}
```

## Development

```bash
# Install dependencies
npm install

# Run in development mode
npm run start:dev

# Build
npm run build

# Run built version
npm start
```

## Notes

- Metrics are submitted as gauge type
- Historical metrics ingestion must be enabled in Datadog
- Billing is based on cardinality (metric name + tag permutations)
- Only successful workflow data is processed initially
- Records with null values in any fields (except branch) are skipped
