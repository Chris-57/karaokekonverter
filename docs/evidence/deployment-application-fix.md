# Application release correction

Date: **2026-09-08**. Application version: **0.3.0**.

## Failure I observed

My [Deploy AWS run 34258887801](https://github.com/Chris-57/karaokekonverter/actions/runs/34258887801), using main commit `49d3c6b566e374b1918a875bc684d2b0df5f7a68`, passed the tests/build and obtained temporary AWS credentials. It saved `snapshot-34258887801-1` with website hashes and both-source configuration checked. It prepared `run-34258887801-1`, then stopped with:

```text
ApiFunctionRole: IAM, secret and saved-query changes need an operator update.
```

This is the release script's rejection of a proposed change, before `ExecuteChangeSet`. That run did not replace the application or publish website files. The prepared release was not marked verified. The snapshot observation is not a fresh Spotify or SoundCloud conversion test.

The previous script submitted the newly packaged SAM infrastructure source on every release and omitted existing stack tags from its change-set request. The failed run did not preserve the detailed IAM diff, so the evidence does not establish which property caused the proposed role change.

## Correction

- Use `GetTemplate` with `TemplateStage=Processed` as the release template's starting point.
- Replace only the versioned S3 `Code` values of `ApiFunction`, `WorkerFunction` and `AvailabilityFunction`.
- Preserve every other deployed resource property, including runtime roles, secrets, logs, queries, queues, database, website infrastructure and monitoring configuration.
- Preserve stack tags, previous parameter values, notification settings and rollback configuration when preparing the update.
- Keep the change-set guard; permit only in-place `Code` changes for the three functions. Print resource IDs/types/actions/scopes for diagnosis without printing secret values or property contents.
- Reject incompatible runtime/handler/architecture packages and infrastructure-source edits that have not been separately accepted in the release contract.
- For restoration, place the saved compatible code on the **current** infrastructure; do not reapply old IAM or database definitions.
- Explain failures according to whether preparation, CloudFormation execution or website publication had started.

CloudFormation exposes the expanded template through [GetTemplate](https://docs.aws.amazon.com/AWSCloudFormation/latest/APIReference/API_GetTemplate.html), and a [change set](https://docs.aws.amazon.com/AWSCloudFormation/latest/APIReference/API_CreateChangeSet.html) does not update resources until execution is requested.

## Validation of this correction

| Check | Result |
| --- | --- |
| Python suite | 52 tests ran successfully; the AWS CLI v2 integration class was skipped locally, with two cases required on GitHub |
| Deploy and restore orchestration | Controlled AWS responses confirm the submitted template keeps deployed infrastructure and tags and requests execution once |
| Protected resources | IAM changes still stop before execution; source changes, incompatible packages and non-code Lambda changes are rejected |
| Full application template | SAM expanded the actual source to 56 resources; all fields except the three code locations were preserved |
| Resulting processed template lint | Passed with SAM 1.166.1 / cfn-lint 1.53.3, using synthetic S3 locations and versions |
| Live corrected deploy and restore | Pending successful runs in my AWS account |

The runtime source, website assets, dependency locks and SAM infrastructure source are unchanged by this fix. Local tests made no AWS mutations and no music-provider requests. See [application steps](../apply-deployment-fix.md) and the [current acceptance record](deployment-acceptance.md).
