"""Shared by the multi-account commands: the config file, who does the work, and a clean
environment for running Claude as one account.

The config (~/.claude-accounts/config.json):
  primary    the account the Claude desktop app is signed in to
  secondary  the account that does all the work; null means "off": the primary does everything
  accounts   tag -> {"email", "configDir", "permissionMode", "label"?}
  projects   name -> {"folders": [...]}, only for nicer names in the live view
"""
import json
import os
import re
import subprocess
from pathlib import Path

ROOT = Path.home() / ".claude-accounts"
CONFIG = ROOT / "config.json"
STATUS = ROOT / "status"
# Sign-in and session details of whichever Claude started a command; another account must never see them.
INHERITED = ("CLAUDE", "ANTHROPIC", "USE_LOCAL_OAUTH", "USE_STAGING_OAUTH")


def expand(path):
    return os.path.normpath(os.path.expanduser(path))


def load():
    config = json.loads(CONFIG.read_text()) if CONFIG.exists() else {}
    return upgrade(config)


def upgrade(config):
    """Reads a config written by version 1.0 (`active`, `desktopApp`) as primary and secondary."""
    accounts = config.setdefault("accounts", {})
    config.setdefault("projects", {})
    if "primary" not in config:
        flagged = [tag for tag, account in accounts.items() if account.get("desktopApp")]
        config["primary"] = flagged[0] if flagged else next(iter(accounts), None)
    if "secondary" not in config:
        active = config.get("active")
        config["secondary"] = active if active and active != config["primary"] else None
    config.pop("active", None)
    for account in accounts.values():
        if not account.get("email"):
            found = re.search(r"[\w.+-]+@[\w-]+(\.[\w-]+)+", account.get("label", ""))
            account["email"] = found.group(0) if found else ""
        for old in ("desktopApp", "desktopConfigDir", "worker"):
            account.pop(old, None)
    return config


def save(config):
    ROOT.mkdir(parents=True, exist_ok=True)
    ordered = {key: config.get(key) for key in ("primary", "secondary", "accounts", "projects")}
    CONFIG.write_text(json.dumps(ordered, indent=2) + "\n")


def in_desktop_chat():
    return os.environ.get("CLAUDE_CODE_ENTRYPOINT") == "claude-desktop"


def app_email():
    """The account the desktop app is signed in to, as the app tells the commands a chat runs."""
    return (os.environ.get("CLAUDE_CODE_USER_EMAIL") or "").strip().lower() if in_desktop_chat() else ""


def email_of(config, tag):
    return (config["accounts"].get(tag, {}).get("email") or "").strip().lower()


def is_app_account(config, tag):
    """True when `tag` is the account this desktop chat already runs on, so handing work to it would spend it twice."""
    email = app_email()
    return bool(email) and email_of(config, tag) == email


def worker(config):
    """The account that does the work, or None when a desktop chat should do it itself.

    The secondary does the work, unless it is off, missing, or the same account the desktop app is
    signed in to. Without one, a desktop chat works itself and a terminal command uses the primary.
    """
    primary, secondary = config.get("primary"), config.get("secondary")
    if secondary and secondary != primary and secondary in config["accounts"] and not is_app_account(config, secondary):
        return secondary
    if in_desktop_chat():
        return None
    return primary if primary in config["accounts"] else None


def clean_env(account):
    env = {key: value for key, value in os.environ.items() if not key.startswith(INHERITED)}
    env["CLAUDE_CONFIG_DIR"] = expand(account["configDir"])
    return env


def signed_in(account):
    run = subprocess.run(["claude", "auth", "status"], env=clean_env(account), stdout=subprocess.PIPE, stderr=subprocess.DEVNULL)
    try:
        return bool(json.loads(run.stdout).get("loggedIn"))
    except ValueError:
        return False


def latest_limits():
    """The freshest 5-hour and weekly reading per account, from what the account-status add-on wrote."""
    best = {}
    for path in STATUS.glob("*.json"):
        try:
            status = json.loads(path.read_text())
        except (OSError, ValueError):
            continue
        tag = status.get("account")
        if status.get("rateLimits") and (tag not in best or status["updatedAt"] > best[tag]["updatedAt"]):
            best[tag] = status
    return {tag: {limit["kind"]: limit["percentUsed"] for limit in status["rateLimits"]} for tag, status in best.items()}


def role(config, tag):
    primary, secondary = config.get("primary"), config.get("secondary")
    if tag == primary:
        return "primary · desktop app" + ("" if secondary and secondary != primary else " · does the work")
    if tag == secondary:
        return "secondary · does the work"
    return "spare"
