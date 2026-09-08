# S3 deployment transport correction

Prepared on 2026-09-08 for the first automated deployment from main commit `1103abc`.

## Observed failure

The owner supplied the log and screenshots for [Deploy AWS run 34252993376](https://github.com/Chris-57/karaokekonverter/actions/runs/34252993376). Tests, infrastructure validation, the Lambda build and temporary AWS authentication passed. Packaging uploaded the Lambda archives. The deployment then reported that `s3api get-object` required `--bucket` and `--key`.

The helper passed those inputs through `--cli-input-json`. Unlike ordinary modeled AWS CLI commands, this streaming-output command requires explicit options plus a positional output filename. The correction follows the [AWS get-object command reference](https://docs.aws.amazon.com/cli/latest/reference/s3api/get-object.html). `put-object` supports JSON inputs and does not need the same change; its existing binary upload, encryption and conditional-write behavior remains in place. [AWS put-object reference](https://docs.aws.amazon.com/cli/latest/reference/s3api/put-object.html).

In this run, the failing read was the first website download in `capture_baseline`, which precedes `save_release`, `update_stack` and website publication. The run wrote package artifacts to private release storage but did not reach an application update. It did not produce a verified release or a usable verified snapshot.

The summary's statement about an empty CloudFormation change set came from a unit test, not from this deployment. The issue was reproduced by running that test with a temporary `GITHUB_STEP_SUMMARY` destination. The test now mocks the summary output while still checking the message and change-set behavior.

## Validation

| Check | Result |
| --- | --- |
| Python suite | 39 tests passed: five monitoring and 34 delivery tests |
| Original download regression | The new download test fails against the original implementation and passes with the explicit options |
| Binary bytes, literal object keys and cleanup | Passed; temporary files are removed after success and CLI failure, and the original CLI error is retained |
| Actions summary isolation | Full local suite preserves an existing external summary file byte for byte |
| Actual AWS CLI v2 | Two additional tests in `tests/test_delivery_cli.py`; class skipped locally because CLI v2 is unavailable; required rather than skipped when `GITHUB_ACTIONS=true` |
| Loopback HTTP fixture | Checked with the installed AWS SDK for unsigned binary downloads, literal keys and the missing-object error; this does not substitute for the CLI test |
| Live AWS retry | Pending the owner's new CI/deployment run |

The CLI tests invoke the repository helper and the real `aws` executable against `127.0.0.1`, with signing disabled, isolated configuration files and short network timeouts. They do not use AWS credentials or contact AWS. Both existing workflows discover the tests before the deployment credentials step. A missing CLI v2 fails the tests on GitHub.

The local preparation did not run a new SAM build or contact AWS or music providers. The owner-supplied first run already passed its clean build; the corrected commit will go through the complete workflows again.

## Apply and retry

1. Copy the fix's repository files into the existing checkout and run `npm.cmd run check:public` on Windows (`npm run check:public` elsewhere).
2. Commit and push the correction to `main`. Keep `AWS_DEPLOY_ENABLED=true`.
3. Open GitHub Actions and check the new CI run for that commit. When it succeeds, the configured workflow automatically starts a new Deploy AWS run.
4. Follow that new run. If a manual run is needed, choose **Deploy AWS → Run workflow → main**, set **action = deploy** and leave **release_id** empty. Re-running the old failed run would use its old source commit.
5. After the new run reports a verified release, open the application and try one known working Spotify playlist and one SoundCloud playlist. Record the successful run URL and release ID in the acceptance record.

The CLI syntax fix requires no bootstrap rerun, new IAM role, access key or application-stack recreation. The workflow checks the stack status and current main again before proposing an update. Existing failed run entries can remain as history.
