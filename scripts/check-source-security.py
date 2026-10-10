"""Read-only checks for common accidentally committed credentials.

Only tracked files in the current checkout are scanned. No network, real secrets,
package installation, or repository writes. This is not a full security audit or
GitHub branch protection. Findings print locations and rule names, never values.
"""
from pathlib import Path, PurePosixPath
import re
import subprocess
import sys

PATTERNS = (
    ('github-token', re.compile(r'\bgh[pousr]_[A-Za-z0-9]{36,}\b')),
    ('github-fine-grained-token', re.compile(r'\bgithub_pat_[A-Za-z0-9_]{40,}\b')),
    ('aws-access-key-id', re.compile(r'\b(?:AKIA|ASIA)[A-Z0-9]{16}\b')),
    ('private-key', re.compile(r'-----BEGIN (?:[A-Z0-9]+ )?PRIVATE KEY-----')),
    ('google-api-key', re.compile(r'\bAIza[0-9A-Za-z_-]{35}\b')),
    ('openai-style-key', re.compile(r'\bsk-(?:proj-|svcacct-)?[A-Za-z0-9_-]{28,}\b')),
    ('slack-token', re.compile(r'\bxox[baprs]-[0-9A-Za-z-]{20,}\b')),
    ('credential-in-url', re.compile(r'https?://[^\s/:<>\"\']+:[^\s/@<>\"\']{8,}@')),
)
# Match literal credentials, not os.environ lookups or GitHub expression references.
LITERAL = re.compile(
    r'''(?im)(?:["']?(?:CDSAPI_KEY|GH_TOKEN|GITHUB_TOKEN|OPENAI_API_KEY|_authToken)["']?)\s*[:=]\s*["']([^"'\r\n]{8,})["']'''
)
UNQUOTED = re.compile(r'(?im)^\s*(?:CDSAPI_KEY|GH_TOKEN|GITHUB_TOKEN|OPENAI_API_KEY|[^\s]*:_authToken)\s*[:=]\s*([^\s#\r\n]+)')
PLACEHOLDER = re.compile(r'(?i)^(?:test(?:[-_:].*)?|example(?:[-_:].*)?|dummy(?:[-_:].*)?|placeholder|changeme|not[-_ ]a[-_ ]real[-_ ].*|your[-_ ].*|<[^>]+>)$')
FORBIDDEN_NAMES = {'.cdsapirc', '.netrc', '.git-credentials', 'id_rsa', 'id_dsa', 'id_ecdsa', 'id_ed25519'}
FORBIDDEN_SUFFIXES = {'.p12', '.pfx', '.key', '.pem'}
WORKFLOW_RULES = (
    ('privileged-pr-trigger-needs-review', re.compile(r'^\s*pull_request_target\s*:', re.M)),
    ('write-all-permissions', re.compile(r'^\s*permissions\s*:\s*write-all\b', re.M)),
    ('unsafe-pr-checkout', re.compile(r'^\s*allow-unsafe-pr-checkout\s*:\s*true\b', re.M)),
)


def allowed_reference(value):
    value = value.strip().strip('"\'')
    return (value.startswith(('$', 'os.environ', 'process.env', 'environ.', 'getenv('))
            or bool(PLACEHOLDER.fullmatch(value)))


def inspect_file(name, data):
    """Return (line number, rule) tuples. No source text leaves this function."""
    path = PurePosixPath(name)
    findings = set()
    env = path.name == '.env' or path.name.startswith('.env.')
    template = path.name.endswith(('.example', '.sample', '.template'))
    if ((env and not template) or path.name in FORBIDDEN_NAMES
            or path.suffix.lower() in FORBIDDEN_SUFFIXES):
        findings.add((1, 'credential-file-must-not-be-tracked'))
    if b'\x00' in data:
        return sorted(findings)
    text = data.decode('utf-8', errors='replace')
    for rule, pattern in PATTERNS:
        for match in pattern.finditer(text):
            findings.add((text.count('\n', 0, match.start()) + 1, rule))
    for pattern in (LITERAL, UNQUOTED):
        for match in pattern.finditer(text):
            value = match.group(1).strip().strip('"\'').rstrip(',;')
            if len(value) >= 8 and not allowed_reference(value):
                findings.add((text.count('\n', 0, match.start()) + 1, 'literal-service-credential'))
    if name.startswith('.github/workflows/') and path.suffix in ('.yml', '.yaml'):
        # Comments cannot enable a workflow trigger or change token permissions.
        workflow = '\n'.join(line.split('#', 1)[0] for line in text.splitlines())
        for rule, pattern in WORKFLOW_RULES:
            for match in pattern.finditer(workflow):
                findings.add((workflow.count('\n', 0, match.start()) + 1, rule))
        for match in re.finditer(r'^\s*-?\s*uses:\s*[\"\']?([^\s\"\']+)', workflow, re.M):
            target = match.group(1)
            if target.startswith('./'):
                continue
            if not re.fullmatch(r'[^@\s]+@[0-9a-fA-F]{40}', target):
                findings.add((workflow.count('\n', 0, match.start()) + 1, 'action-must-be-commit-pinned'))
    return sorted(findings)


def main():
    root = Path(subprocess.check_output(['git', 'rev-parse', '--show-toplevel'], text=True).strip()).resolve()
    names = subprocess.check_output(['git', 'ls-files', '-z'], cwd=root).decode().split('\0')
    checked = binary = problems = 0
    for name in filter(None, names):
        file = root / name
        if file.is_symlink():
            print(f'{name}:1: symlink requires review; content not followed')
            problems += 1
            continue
        if not file.is_file():
            print(f'{name}:1: tracked file is unavailable')
            problems += 1
            continue
        data = file.read_bytes()
        checked += 1
        binary += b'\x00' in data
        for line, rule in inspect_file(name, data):
            print(f'{name}:{line}: {rule} (value withheld)')
            problems += 1
    print(f'Source security check: {checked} tracked files; {binary} binary contents skipped; {problems} findings.')
    print('Scope: current checkout only; not historical commits, account settings, external data branches or logs.')
    return 1 if problems else 0


if __name__ == '__main__':
    sys.exit(main())
