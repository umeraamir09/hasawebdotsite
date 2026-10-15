# Phase 08 requirements

Run architecture spikes S-8 and S-9 before building the production publish pipeline. Reuse the S-1 portfolio, case-study and resume workload envelopes, with bounded input records and at most 32 source objects per assembly. Persist large bodies in private R2 and return small references from durable steps. Test deterministic output, retries after side effects, failed preparation, and competing publication commits.

Asset withdrawal must delete only unreachable public objects, preserve the private source, and retry failed URL purges. Live CDN evidence requires a previously cached synthetic object, deletion at the origin, successful purge, and subsequent missing responses. Record observed edge locations rather than claiming worldwide verification.

Keep fixtures separate from production apps, owner data, DNS and existing routing. Do not modify Figma or implement UI. No paid-plan upgrade is authorized. Current provider documentation is authoritative; distinguish CPU per invocation from CPU per durable step and do not treat local wall time as production CPU evidence.
