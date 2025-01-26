export interface BigQueryWorkflowData {
  minutes: string;
  created_at: string;
  branch: string | null;
  workflow_name: string;
  status: string;
  project_slug: string;
  workflow_id: string;
}
