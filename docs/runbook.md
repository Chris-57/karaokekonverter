# Operations runbook

Applies to `karaokekonverter-dev` with the 0.3.0 monitoring update. The owner reports both SoundCloud and Spotify working on AWS, populated dashboard metrics and controlled ALARM/OK email receipt. Follow [the update guide](aws-update-v0.3.0.md), [monitoring runbook](monitoring.md) and [live acceptance checklist](aws-acceptance.md) to record operational evidence. For the combined local app, use [local-runbook.md](local-runbook.md). The automatic local session endpoint is not part of the AWS deployment.

## Find the application

Use CloudFormation's stack Resources and Outputs tabs. `WebsiteUrl` is the user entry point, `WorkerLogGroup` contains conversion logs, `JobsTableName` identifies the status table, and `ConfigurationSecretArn` identifies configuration. Resources use CloudFormation-generated names and project tags where specified. Old similarly named resources are not part of this stack.

Local startup is `npm start`; local jobs disappear on restart. AWS jobs use DynamoDB and survive individual function restarts.

## First response to a failed conversion

1. Record the job ID, source playlist size, approximate time, and displayed error code. Do not paste keys or tokens into a ticket.
2. Find that job in the new DynamoDB table and search the worker log group for its job ID. Inspect `conversion_finished`, `conversion_failed`, or `worker_infrastructure_failed` events.
3. Determine whether this is a source/matching issue or an AWS delivery/runtime issue. A terminal application failure does not necessarily increment Lambda's `Errors` metric.
4. Apply the relevant action below. Retry a small playlist after correcting the cause; avoid repeatedly spending search quota on an unchanged failure.

| Symptom | Likely investigation | Recovery |
| --- | --- | --- |
| Website says awaiting setup | Check required values in the generated secret; check `/api/health` | Correct the secret, preserve its access code, allow a minute for refresh |
| `BROWSER_START_FAILED` | Read `source_browser_failed` with stage `launch`, then the Lambda `REPORT` line | Check Chromium packaging and browser-launch compatibility; 0.2.3 resolves Puppeteer's async launch arguments |
| `SOURCE_TIMEOUT` | Read the logged stage and elapsed time | Check page navigation or browser responsiveness; distinguish provider waiting from the function's overall limit |
| `SOURCE_UNAVAILABLE` | Read the logged stage and error type | Investigate the browser failure; 0.2.2 misleadingly called all these errors timeouts |
| `UNAUTHORIZED` | Wrong shared demo access code | Enter the value from this stack's secret; do not use a legacy password |
| `INVALID_URL` | Invalid public playlist URL or mismatched source | Select the matching source and use the full SoundCloud set or open.spotify.com playlist URL |
| `SOURCE_BLOCKED` | A provider requests human verification | Stop automated attempts; record the source and stage. Use supported access where available. |
| `SOURCE_LOGIN_REQUIRED` | Spotify requires access to the page | Try a public playlist visible while signed out; the reader does not automate login |
| `SOURCE_INCONSISTENT` | Spotify count, order or metadata changed during collection | Retry once with a stable public playlist; inspect the declared and collected counts |
| `SOURCE_UNREADABLE` | Spotify exposes no usable playlist rows | Check public visibility and the current page layout before changing selectors |
| `PLAYLIST_TOO_LARGE` | More than 20 tracks | Use a playlist within the documented limit; no truncation is performed |
| `SOURCE_LAYOUT_CHANGED` or `SOURCE_INCOMPLETE` | Page selectors or lazy loading differ from the recovered approach | Inspect an accessible public playlist, repair extraction, and repeat the live completeness check |
| `UPSTREAM_AUTH` | Disabled API, invalid credentials, key restrictions, or expired API access | Verify project/API configuration; rotate compromised credentials |
| `YOUTUBE_QUOTA_EXCEEDED` | Project search allowance exhausted | Check the actual Google Cloud quota/reset; wait or request an appropriate increase |
| `PARTIAL` | Some titles have no suitable match or the provider became unavailable | Review matched videos and per-track reasons; improve metadata/matching before retrying |
| Job stays `QUEUED` | Queue send, event mapping, concurrency, or a write/send interruption | Inspect the queue and mapping; a stranded job can be resubmitted once delivery is healthy |
| Job stays `RUNNING` | Worker timeout/crash or persistence failure | Inspect logs and SQS; let its lease and visibility timeout permit retry before manual intervention |
| Worker runtime/import error | Browser/runtime/dependency mismatch | Rebuild from the lockfile, check x86_64/Node.js settings, and redeploy |
| Combined YouTube link fails | Temporary URL behavior changed | Use individual review links; prioritize the saved-playlist OAuth feature |

## Alarms and retries

Version 0.3.0 defines ten alarms, including handled operational failures, API/worker errors, throttles, backlog age, dead letters, database throttles and failed/missing availability checks. The owner has confirmed the existing SNS email subscription. See [monitoring.md](monitoring.md) for thresholds, dashboard use, notification testing, costs and recovery. A confirmed subscription alone does not prove alarm delivery; run the isolated test and record inbox receipt.

SQS retries infrastructure failures and sends repeatedly failing messages to the DLQ. Before redriving, fix the cause and inspect the job state. A job already terminal or expired will not be processed by the claim operation. For a demo, submit a new small job after the fix. Preserve the failed job/logs as evidence rather than editing its state blindly. Add a supported retry endpoint before making operator state changes routine.

Watch queue depth/age, function duration/throttles/errors, terminal job counts, partial-match frequency, and YouTube quota. This account initially reports a concurrency quota of 10; the SQS mapping is capped at two workers, with no function reserved concurrency. Other functions can consume the shared pool. Inspect account concurrency when worker or API throttling occurs; do not add a reserved-concurrency setting without rechecking the quota. There is no measured throughput or availability objective yet; establish one after live tests. The concurrency and API throttle values are controls, not a spending guarantee.

## Update dependencies or credentials

1. Make changes in the source project, retain the old commit, and record why the update is needed.
2. For browser upgrades, update Puppeteer and Chromium as a compatible pair. Run `npm install` for the intended versions and commit the resulting lockfile.
3. Run `npm test`, `npm run check`, `npm run check:public`, and `sam validate --lint --template-file infra/template.yaml --region us-east-2`.
4. Run a small live playlist acceptance test in the development stack after deployment. Fixture tests cannot validate external DOM changes.
5. For a code rollback, build and deploy the previously verified commit. Lambda aliases and automated rollback are not implemented in this baseline.

Rotate API keys in their issuing console, update the new stack's secret, and verify with one small job. This application only needs YouTube search access until OAuth playlist creation is implemented. SoundCloud API tokens are cached/refreshed within a warm process; cold starts obtain a new token. A durable shared token manager is future work if token-rate limits become relevant.

## Retirement and legacy cleanup

The new stack does not delete old resources. Inventory legacy resources by tags, stack ownership, recent usage, and backups before removing them. IAM roles or alarms alone do not prove that a workload still runs.

When deliberately retiring this new stack, export any evidence needed first. The jobs table and versioned website bucket have retain policies and will remain after stack deletion. Review and remove those retained resources separately when their data is no longer needed. SAM deployment artifacts may also remain. Confirm the resulting bill rather than assuming stack deletion removes every charge.
