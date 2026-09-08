# Monitoring acceptance evidence

Application: **KaraokeKonverter 0.3.0**, stack `karaokekonverter-dev`, region `us-east-2`.

I recorded these observations from my CloudShell output, dashboard screenshots and received emails during the September 2026 acceptance session. These are manual observations. The screenshots show a three-hour UTC window with new job samples around 06:15; this record does not establish the exact calendar date of those chart samples. I keep the original account screenshots and email messages outside the public repository.

| Evidence | Observation | What it establishes |
| --- | --- | --- |
| My deployment check | 76 JavaScript tests passed, SAM build succeeded and update completed | Live build/deployment acceptance for 0.3.0 |
| My application check | Both Spotify and SoundCloud links worked | Sample live acceptance for both source paths |
| My alert check | Controlled ALARM and OK emails both received | Notification and recovery messages reached the inbox for that test |
| Alarm widget | All ten alarms displayed OK | Current alarm states at the screenshot time |
| Track matching widget | 14 source tracks, 13 matches, about 92.9% in the displayed bucket | Live conversion log-to-metric reporting; at least one track was not added |
| Outcomes widget | Partial-job sample at 1, failed-job sample at 0; coincident series may overlap | A partial result was recorded; exact per-source counts require the saved log query |
| Job duration | About 14 seconds average, 17.2 seconds maximum | Duration reporting for that displayed sample |
| Queue wait | About 0.86 seconds average, 1.7 seconds maximum | Submission-to-claim timing for that displayed sample |
| Queue depth | In-flight briefly 1, then 0; visible/dead-letter samples at 0 | Work was observed in flight and the queue samples drained |
| Infrastructure | No visible Lambda errors/throttles or DynamoDB throttle events | No corresponding failure samples in the displayed period |
| Availability and operational failures | New samples at 0 | Successful website/configuration checks and no reported operational-failure samples there |
| Monitoring test | Metric moved from 1 to 0 | Deliberate test/reset signal is visible in the dashboard |
| Log-group inventory | Four current project groups have 14-day retention | Deployed log retention matches the template |

The dashboard aggregates both sources. It does not establish exact per-source outcomes from the screenshot alone. A 13/14 match sample is not a benchmark, and a partial result's cause should be read from the job. The small HTTP 4xx spike was not attributed to a particular request. No sustained load test, measured SLO, full provider-outage injection or live 20/21-track boundary exercise is claimed.

I also listed ten legacy Lambda log groups with 137,873 stored bytes combined. Their storage is separate from CloudShell's home directory. They were left for a later retirement review; the active project log groups were kept.

Subsequent CI and deployment progress is tracked separately. [Validation](../validation.md) records current checks and remaining work; [monitoring](../monitoring.md) gives the procedures to reproduce the controlled alert test.
