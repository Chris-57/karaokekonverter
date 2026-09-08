# Contributing

Use a short feature branch and explain the problem, resulting behavior and completed validation in a pull request. Keep the 20-track limit and both source contracts unless a change explicitly addresses those decisions.

Use Node.js 24 and Python 3.12. From the repository root:

```sh
npm ci
npm test
npm run check
npm run check:public
python -m unittest discover -s tests -p 'test_*.py'
```

For infrastructure/build changes, install `requirements-ci.txt` in a development environment, then run `sam validate --lint --template-file infra/template.yaml --region us-east-2`, `sam build --template-file infra/template.yaml` and `node scripts/check-build.mjs`. Windows PowerShell users can use `npm.cmd`.

Tests use provider fixtures. Keep live provider calls and application credentials out of the test suite. Add a focused regression for an actual changed behavior; record live verification separately when external DOMs or browser dependencies change.

Puppeteer and Chromium versions must be evaluated together. Update the lockfile deliberately and review dependency proposals; Dependabot does not merge or deploy changes automatically. Prefer a small public playlist for a post-deployment browser check.

Update the appropriate document when behavior, permissions, cost controls or an operational procedure changes. Follow [SECURITY.md](SECURITY.md) when reporting credential or access problems.
