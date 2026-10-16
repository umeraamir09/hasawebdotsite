interface CloudflareEnv {
  APP_ENV: string;
  APP_ORIGIN?: string;
  GITHUB_CLIENT_ID?: string;
  GITHUB_CLIENT_SECRET?: string;
  GOOGLE_CLIENT_ID?: string;
  GOOGLE_CLIENT_SECRET?: string;
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
  OWNER_API: Fetcher;
  CONTACT_QUEUE: Queue;
  GITHUB_QUEUE: Queue;
  PUBLISH_WORKFLOW: Workflow;
}
