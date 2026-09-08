# Deployment recovery

Use this runbook with [deployment automation](deployment-automation.md). I have not yet recorded a successful live restore; the controlled tests are separate evidence.

## Identify the failed stage

| Last completed stage | What to do |
| --- | --- |
| Tests/build or OIDC authentication | The deployment script has not changed the app. Fix the logged issue and rerun the current `main` workflow. |
| Snapshot or change-set validation | Execution has not been requested, so this run has not updated application resources or published website files. Private artifacts and stack service-role metadata may exist. Use the live app if its smoke tests pass; do not recreate the stack. |
| CloudFormation update | Check the app stack and its events. A runner timeout/disconnection does not cancel CloudFormation. Wait for a stable state before another deployment. |
| Website publication/health verification | Backend updates may already be live and website publication may be partial. The run is failed and has no new verified marker. Restore a saved verified release or healthy baseline snapshot. |

Check status from any CloudShell session:

```bash
aws cloudformation describe-stacks --stack-name karaokekonverter-dev --region us-east-2 --query 'Stacks[0].{Status:StackStatus,Reason:StackStatusReason,RoleArn:RoleARN}' --output json --no-cli-pager
```

Read recent events if needed:

```bash
aws cloudformation describe-stack-events --stack-name karaokekonverter-dev --region us-east-2 --max-items 15 --query 'StackEvents[].{Time:Timestamp,Resource:LogicalResourceId,Status:ResourceStatus,Reason:ResourceStatusReason}' --output json --no-cli-pager
```

`UPDATE_COMPLETE` and `UPDATE_ROLLBACK_COMPLETE` are stable states accepted by the workflow. `UPDATE_IN_PROGRESS` or rollback in progress means wait. `UPDATE_ROLLBACK_FAILED` needs operator investigation and a deliberate CloudFormation rollback recovery; this workflow does not skip failed resources automatically.

## Restore a verified release

1. Find the ID in the successful deployment run summary, for example `run-123456789-1`. A pre-update snapshot such as `snapshot-123456789-1` is also allowed if its baseline health/files passed verification. Do not use an unverified snapshot or a failed new release.
2. In GitHub, open **Actions → Deploy AWS → Run workflow** on **main**.
3. Choose **action = restore** and paste that exact **release_id**. `AWS_DEPLOY_ENABLED` must be `true` for this job to run; avoid merging other changes during recovery.
4. Watch the restore run. It loads the saved template and site files, verifies checksums, archive versions and account/stack identity, then inserts the saved Lambda code locations into the current deployed template. Handler, runtime and architecture must match. It captures the current deployment where possible and applies the same code-only change-set restrictions and post-deploy checks. It uses current trusted deployment code and does not rebuild the old application commit.
5. After it is green, check the website with one known working playlist from each source. Save the restore run URL and new release ID as evidence.

Restoration writes a new `run-...` release record with `restoredFrom`. Its public `commit` marker refers to the restored application commit; a baseline predating this workflow has `commit: null`. GitHub's run commit identifies the deployment-control code used for that operation.

The pipeline pins Lambda archives to S3 object versions. Initial legacy SAM archives are copied into the private release bucket so recovery does not depend on keeping a CloudShell directory. If those initial legacy S3 archives are already missing, the first snapshot fails before an app update; recover the missing deployment artifacts with the operator rather than deleting the working application.

Restoration keeps current runtime configuration, IAM roles, database and other resource definitions. It cannot undo a separately applied infrastructure migration, and compatible handler/runtime/architecture values alone do not guarantee that old code is compatible with a changed data model. Review that compatibility before restoring across a migration. Job records and secret values are never part of a release snapshot.

## Find records without GitHub's summary

In CloudFormation, open `karaokekonverter-dev-delivery` → **Outputs** → **ArtifactBucket**, then open that bucket in S3. Each `releases/<release-id>/` directory contains:

- `manifest.json`: application version, source commit when known, account/stack identity and object checksums.
- `template.json` and `site/`: the saved deployment template and exact frontend files.
- `verified.json`: exists only after deployed checks or successful baseline observation. Its checksum must match the manifest.
- `lambda/`: package archives where the release created/copied them. Other snapshots can reference already versioned archives from an earlier release in the same bucket.

A failed run may leave an incomplete prefix. Do not label it successful or create `verified.json` by hand. The restore command intentionally requires the recorded verification marker.

## Common setup failures

| Error | Correction |
| --- | --- |
| Deploy is skipped | Check `AWS_DEPLOY_ENABLED=true`, selected branch `main`, and that the triggering CI event was a successful push on this repository's current main. PR runs never deploy. |
| `s3api get-object` says `--bucket, --key` are required | Apply the [S3 deployment fix](evidence/deployment-s3-fix.md), push it to main and use the new deployment triggered after CI. The original helper incorrectly supplied these options through JSON. The first observed run stopped during its baseline download, before an app update; recreating resources or changing IAM does not correct the CLI syntax. |
| `AssumeRoleWithWebIdentity` denied | Check the role variable, provider audience and exact numeric-ID subject in the generated trust policy. Do not replace it with a wildcard. |
| Change-set action denied | Check the failing action/resource against the generated policy and the expected delivery role; keep the scope on this app. Supply the first error for review. |
| `ApiFunctionRole` rejected on the earlier SAM-based release path | Apply the [application release correction](apply-deployment-fix.md), which retains deployed infrastructure and stack tags. The observed run stopped before execution; its baseline snapshot passed. Keep the guard enabled. |
| Resource/IAM/query change rejected by the corrected code-only path | Read the proposed resource metadata and compare the deployed template. A genuine infrastructure migration needs a separate reviewed operator update. |
| Infrastructure source changed | Apply and verify the intended operator infrastructure update, then refresh the source contract; do not change the hash simply to bypass this check. |
| Stack has another service role | Resolve that ownership/delegation decision with the account operator; the workflow will not silently replace a different service role. |
| Asset hash/version mismatch | Allow the built-in propagation retries to finish, then inspect the current release/stack. A package version change must agree with the API health version. Restore if the release is broken. |
| Bootstrap interrupted | Check `karaokekonverter-dev-delivery` in CloudFormation first. A completed bootstrap can be inspected/rerun from CloudShell; do not create duplicate providers or roles. |

## Future infrastructure changes and retirement

Set `AWS_DEPLOY_ENABLED=false` and wait for any active deployment to finish before a manual infrastructure migration. Review the new template and narrow permission changes using the administrator session. The app stack retains its CloudFormation service role, so supplying only broader human IAM permissions does not expand the role CloudFormation uses. Update the reviewed execution policies or deliberately select an appropriate replacement service role. Refresh delivery resource discovery after any replaced resource IDs. After the infrastructure update is verified, refresh the LF-normalized SHA-256 of `infra/template.yaml` in `infra/application-release.json`, commit both files, and retest an application release. Keep a record of the operator update and its live checks. The template remains the source for infrastructure migrations even though routine code releases use the deployed Processed template.

Do not delete the delivery stack while its execution role or artifact bucket is referenced by the app. Both the artifact bucket and any newly created OIDC provider are retained if the delivery stack is removed, because release recovery or other repositories may depend on them. Retained S3 storage is still billable. An operator should inventory all active and rollback artifact references before deleting versions or setting an expiry policy.
