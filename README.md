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

# Run tests
npm test              # Run tests once
npm run test:watch    # Run tests in watch mode
npm run test:coverage # Run tests with coverage report
```

## Testing

The project includes comprehensive test coverage:

### Transformer Tests
- Validation of branch name processing rules
- Handling of null values
- Status filtering (success/failure)
- Tag formatting
- Multiple record processing
- Timestamp and duration parsing

### Datadog Service Tests
- API integration testing with mocked responses
- Error handling scenarios
- Environment configuration validation

## Implementation Details

### Data Processing
- Processes all JSON files in the data/ directory
- Skips records with null values (except branch field)
- Transforms branch names:
  * master/staging/uat → kept as-is
  * null → "branch:null"
  * others → "branch:feature"
- Only processes success/failure statuses
- Parses and validates timestamps and durations
- Validates required tags:
  * All metrics must include these tags:
    - env:ci
    - project_slug:<value>
    - branch:<value>
    - workflow:<value>
    - status:<value>
  * Records missing any required tags are skipped

### Datadog Integration
- Submits metrics as gauge type
- Includes required tags:
  * env:ci (always included)
  * project_slug
  * branch
  * workflow
  * status
- Handles API errors with proper logging
- Supports batch processing of multiple records

## Notes

- Metrics are submitted as gauge type
- Historical metrics ingestion must be enabled in Datadog
- Billing is based on cardinality (metric name + tag permutations)
- Only explicitly successful/failed workflow data is processed initially
- Records with null values in any fields (except branch) are skipped

## Error Handling

- Validates environment variables
- Skips invalid records without failing the entire process
- Proper error logging for API failures
- Type-safe implementation with TypeScript
