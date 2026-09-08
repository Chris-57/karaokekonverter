"""Validate GitHub event identity and refuse to deploy an obsolete main commit."""
import json
import os
import re
import subprocess
import sys

from scripts.delivery_common import DeliveryError, load_config, release_id, summary


def selected_commit(event_name, event, environment, config):
    if (environment.get("GITHUB_REPOSITORY") != config["repository"]
            or environment.get("GITHUB_REPOSITORY_ID") != config["repositoryId"]
            or environment.get("GITHUB_REPOSITORY_OWNER_ID") != config["ownerId"]
            or environment.get("GITHUB_REF") != "refs/heads/" + config["branch"]):
        raise DeliveryError("Only the configured repository's main branch may deploy.")
    if event_name == "workflow_run":
        run = event.get("workflow_run", {})
        if (run.get("name") != "CI" or run.get("path") != ".github/workflows/ci.yml"
                or run.get("conclusion") != "success" or run.get("event") != "push"
                or run.get("head_branch") != config["branch"]
                or str(run.get("head_repository", {}).get("id")) != config["repositoryId"]):
            raise DeliveryError("Automatic deployment needs a successful main push through CI.")
        commit, mode, restore = run.get("head_sha", ""), "deploy", ""
    elif event_name == "workflow_dispatch":
        commit = environment.get("GITHUB_SHA", "")
        mode = event.get("inputs", {}).get("action", "deploy")
        restore = event.get("inputs", {}).get("release_id", "")
        if mode not in {"deploy", "restore"}:
            raise DeliveryError("Unsupported deployment action.")
        if mode == "restore":
            release_id(restore)
        elif restore:
            raise DeliveryError("Leave release_id empty when action is deploy.")
    else:
        raise DeliveryError("This event cannot deploy.")
    if not re.fullmatch(r"[0-9a-f]{40}", commit):
        raise DeliveryError("Expected a full Git commit SHA.")
    return commit, mode, restore


def current_main(config):
    result = subprocess.run(["git", "ls-remote", "--exit-code",
        "https://github.com/" + config["repository"] + ".git", "refs/heads/" + config["branch"]],
        capture_output=True, text=True, timeout=30, check=True)
    lines = result.stdout.strip().splitlines()
    if len(lines) != 1 or not re.fullmatch(r"[0-9a-f]{40}\trefs/heads/main", lines[0]):
        raise DeliveryError("Could not resolve the current main commit.")
    return lines[0].split("\t")[0]


def validate_context():
    config = load_config()
    event = json.loads(open(os.environ["GITHUB_EVENT_PATH"], encoding="utf-8").read())
    commit, mode, restore = selected_commit(os.environ["GITHUB_EVENT_NAME"], event, os.environ, config)
    checkout = subprocess.run(["git", "rev-parse", "HEAD"], text=True, capture_output=True, check=True).stdout.strip()
    if checkout != commit:
        raise DeliveryError("Checkout does not match the selected CI/main commit.")
    return config, commit, mode, restore


def main():
    config, commit, mode, _ = validate_context()
    ready = current_main(config) == commit
    if not ready:
        summary("Skipped an obsolete main commit. Use the CI/deployment run for the latest main commit.")
    with open(os.environ["GITHUB_OUTPUT"], "a", encoding="utf-8") as handle:
        handle.write(f"ready={'true' if ready else 'false'}\nmode={mode}\n")


if __name__ == "__main__":
    try:
        main()
    except (DeliveryError, OSError, ValueError, KeyError, subprocess.SubprocessError) as error:
        print(f"Deployment event rejected: {error}", file=sys.stderr)
        sys.exit(1)
