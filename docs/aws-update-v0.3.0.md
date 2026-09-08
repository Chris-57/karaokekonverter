# Monitoring update: version 0.3.0

**Accepted on my existing AWS stack.** I completed the build and update, verified the monitoring commands, received the controlled ALARM/OK emails and observed populated dashboard metrics. See [validation](validation.md) and [the monitoring evidence summary](evidence/monitoring-acceptance.md).

This release added the dashboard, structured application/access logs, failure metrics, alarms, scheduled availability checks and an isolated notification test. SoundCloud and Spotify, the 20-song limit, provider dependencies, website assets, stored secrets, queues, table and the existing SNS subscription were retained.

## Operating the installed monitoring

From the project directory in an authorized CloudShell session:

```bash
python3 scripts/monitoring.py status
python3 scripts/monitoring.py verify-filters
python3 scripts/monitoring.py check
```

The dashboard is available through the stack's **MonitoringDashboardUrl** output or **CloudWatch → Dashboards → karaokekonverter-dev-operations**. `status` prints its link. The installed design has ten alarms, 11 filters and ten custom metrics. The scheduled availability probe runs every five minutes.

To deliberately exercise notification delivery again:

```bash
python3 scripts/monitoring.py test --report monitoring-test.json
```

This sends an isolated test ALARM followed by OK and verifies the corresponding SNS publish actions. Confirm inbox receipt separately. The report can include account resource identifiers and stays excluded from Git; publish a reviewed summary instead. Use the [monitoring runbook](monitoring.md) for interruption recovery and interpretation.

## Rebuild or apply elsewhere

Use the current [AWS deployment](aws-deployment.md) and [CloudShell build](cloudshell-build.md) instructions. The successful operating correction was to select **Node.js 24** and build dependencies under **/tmp**, avoiding CloudShell's small home-directory limit. Those instructions replace the original home-directory extraction/build commands.

The static website did not change in 0.3.0. Source-only repository preparation also does not require a frontend upload or deployment. Review [monitoring costs](monitoring.md#costs-and-retention) when recreating the footprint in another account.

## Recovery implications

A complete rollback to 0.2.4 removes the new monitoring resources. Preserve required evidence first and inspect the change set. A code-only rollback to handlers that do not emit the new fields will leave dashboards without conversion metrics. Recovery should use matching source, template and website revisions, followed by health and provider checks.
