interface CloudflareEnv {
  APP_ENV: string;
  SPIKE_ENABLED?: string;
  SPIKE_KEY?: string;
  SPIKE_ORIGIN?: string;
  BETTER_AUTH_SECRET?: string;
  DB: D1Database;
  DRAFT_BUCKET: R2Bucket;
  SITES_BUCKET: R2Bucket;
  PUBLIC_ASSETS_BUCKET: R2Bucket;
  SITE: Fetcher;
  JOBS: Fetcher;
  CONTACT_QUEUE: Queue;
  GITHUB_QUEUE: Queue;
  PUBLISH_WORKFLOW: Workflow;
}
