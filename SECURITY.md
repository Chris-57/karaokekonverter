# Security and credential handling

## Hosted demonstration

The AWS API validates a shared application access code. The code and YouTube API key are stored in Secrets Manager; the frontend never receives the provider key. Runtime roles read the application configuration they need. The generated health response exposes configuration status, not credential values.

The shared app code is a demonstration access control, not individual user identity. Visitors with that code can read a job when they have its ID; the app does not provide per-user job ownership. Jobs expire after 24 hours. Conditional claims, URL allowlists, bounded browser work and a 20-track limit constrain processing. Budget alerts do not stop spending.

The local server binds to loopback, checks Host/Origin and uses a local session. Its visible key setup saves plaintext settings in the user's configuration directory, outside the repository. It is not a remotely hosted settings page. Do not expose the local server through a public tunnel.

## Repository and CI

Commit empty examples rather than real settings. Exclude `.env`, application `config.json`, private keys, AWS credentials, generated packages and raw monitoring reports. The public-repository check flags common credential patterns, private filenames, account-specific ARNs, staged secrets and broken relative documentation links. It does not detect every secret or inspect the entire Git history. Images and PDFs require visual review.

CI has `contents: read`, does not persist checkout credentials, uses pinned action commits and has no AWS role or OIDC permission. Public pull requests run fixture checks without production credentials. AWS deployment trust will be added in a separate reviewed change after the repository exists.

Enable GitHub secret scanning/push protection and private vulnerability reporting in the repository's settings. A workflow passing after a push does not undo a credential exposure in that push. If a real credential is ever committed, revoke/rotate it first and then remove it from history and affected artifacts. `.gitignore` does not remove files already tracked by Git.

## Reporting a problem

Report vulnerabilities privately through the repository's **Security → Report a vulnerability** when the owner has enabled it. Otherwise contact the owner through the channel that provided demo access. Use public issues for ordinary bugs only. Include a minimal reproduction and sanitized error codes; omit keys, app access codes, tokens, personal data and raw request headers.

## Provider boundary

The current Spotify source uses public-page browser extraction and is not an approved Spotify Web API integration. It does not bypass a login or verification challenge. The [architecture](docs/architecture.md) records provider limitations and the remaining supported-access decision.

References: [GitHub workflow security](https://docs.github.com/en/actions/reference/security/secure-use), [removing sensitive repository data](https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/removing-sensitive-data-from-a-repository), [AWS Secrets Manager](https://docs.aws.amazon.com/secretsmanager/latest/userguide/intro.html).
