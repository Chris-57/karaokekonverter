# Publish Chris-57/karaokekonverter

This package is prepared for a new public repository named **karaokekonverter** under **Chris-57**. It contains the working 0.3.0 application, technical documents and a CI workflow. Publishing it does not update the existing AWS application. The repository has not been created or pushed by this preparation step.

## Recommended Windows route: GitHub Desktop

Use [GitHub Desktop](https://desktop.github.com/download/) so authentication happens through GitHub's sign-in flow; no token needs to be pasted into PowerShell.

1. Sign into GitHub Desktop as **Chris-57**. Choose **File → New repository**. Use `karaokekonverter` as the name and a local folder outside Dropbox, such as a `GitHub` folder under your user profile. Leave README initialization unchecked, Git ignore set to **None**, and license set to **None**; the project already supplies its own files. Create the local repository and confirm its default branch is `main`.
2. Extract `karaokekonverter-github-ready.zip`. Open its inner `karaokekonverter` folder and copy **all its contents** into the folder GitHub Desktop just created. `README.md`, `package.json`, `src`, `docs` and `.github` must be at the repository root, not inside another nested folder. Show hidden items in Explorer if needed so `.github`, `.env.example` and the supplied Git configuration files are copied.
3. Open PowerShell in that repository folder and run `npm.cmd run check:public`. It requires Node.js 24, but does not require `npm ci`, any API key or AWS credentials. If it reports a problem, resolve it before publishing.
4. Review the file list in GitHub Desktop. It should contain source, documentation, configuration examples and the CI workflow, with no real settings, downloaded dependency folders, ZIP files or raw alert reports. Enter a commit summary such as **Add working AWS application, documentation and CI** and commit the files to `main`.
5. Select **Publish repository**. Confirm name `karaokekonverter`, personal account **Chris-57**, and uncheck **Keep this code private**. Publish.
6. Open the repository on GitHub and check **Actions → CI → Validate and build**. Send the repository URL and the first completed run's result to continue with AWS deployment automation.

Suggested description: **SoundCloud and Spotify playlists to YouTube karaoke, with an asynchronous AWS backend, CloudWatch monitoring and automated build checks.**

Suggested repository website: [the hosted demo](https://d2j5ofy3dzbrbx.cloudfront.net). Suggested topics: `aws`, `serverless`, `lambda`, `cloudwatch`, `sqs`, `dynamodb`, `youtube-api`, `puppeteer`, `github-actions`.

If a repository with that name already exists in your account, inspect it before pushing; do not overwrite its history or force-push this package.

## If you create the public repository on GitHub.com first

Create it under **Chris-57** with that same name, then clone it using GitHub Desktop. Copy the extracted project contents into the clone, run the public check, review and commit the changes, then **Push origin**. This avoids terminal authentication and preserves any initial commit GitHub created. Keep the supplied project README and ignore rules when prompted about duplicate files. Choose this route or the route above; creating a second repository is unnecessary.

## Finish the repository settings

After the first successful CI run, require its **Validate and build** status for pull requests into `main`. Use feature branches for changes. CODEOWNERS names Chris-57; it does not itself enforce review. A second mandatory reviewer is unnecessary for this solo project.

Enable secret scanning/push protection and private vulnerability reporting. Public Actions logs are visible, so keep access codes, key values and personal screenshots out of commands, issues and workflow outputs. Dependabot will propose updates; no automatic merge or AWS deployment is enabled.

No additional open-source license has been selected for this portfolio publication. A license can be chosen separately if the owner wants to grant reuse rights. [GitHub licensing guidance](https://docs.github.com/articles/licensing-a-repository).

## What to share with a reviewer

Share the repository URL and the AWS demo URL. Supply the existing application access code privately. The reviewer can inspect documentation and CI results without AWS console access. The YouTube key stays in Secrets Manager. Reviewers running their own local copy need their own YouTube key; the hosted demo does not ask for one.

References: [Create a repository with Desktop](https://docs.github.com/en/desktop/overview/creating-your-first-repository-using-github-desktop), [publish an existing project](https://docs.github.com/en/desktop/adding-and-cloning-repositories/adding-an-existing-project-to-github-using-github-desktop), [clone with Desktop](https://docs.github.com/en/desktop/adding-and-cloning-repositories/cloning-a-repository-from-github-to-github-desktop).
