# Stratoscope security and recovery

## Scope and operating constraints

The public site and its forecast delivery are unchanged by these safeguards.
Do not change repository visibility, paid services, API credentials, forecast
schedules, or data-branch publication permissions without the owner's approval.
The source repository is still public. Neither this policy, CODEOWNERS, nor a
security-check workflow hides the source or prevents someone copying it.

## Current safeguards

- `.github/CODEOWNERS` names the repository owner for review requests. It is not
  an enforced approval requirement without separate GitHub branch protection.
- `Source security checks` runs on main-branch changes and pull requests. It is
  read-only, has no API secrets, installs no packages, publishes no data, and
  never changes or automatically merges code. Findings omit credential values.
- The checker looks for common literal token/key patterns, sensitive credential
  filenames and a few unsafe workflow changes. It scans the current tracked
  checkout, not historical commits, other branches, Actions logs, account
  settings, dependency vulnerabilities, or every possible secret format. It is
  an additional warning check, not a comprehensive security audit or push block.
- Sensitive local credential files are ignored by Git. An ignore rule cannot
  remove something already committed or prevent a deliberate forced addition.
- The original material's rights and third-party exceptions are explained in
  `RIGHTS.md`; third-party licences and data attribution remain in effect.

## Source and website recovery point

Before these safeguards, a recovery branch was created:

`recovery/site-20261010-before-safeguards`

It points to `8fde7b165aace79ca8a33cec43308a8f10029583`, the then-current main
source and built `docs/` website, including the mobile globe-saving repair.

This is a same-repository rollback reference, NOT a separate off-account backup.
It does not snapshot separate live `forecast-data-*` branches, secret values,
GitHub settings, or later updates. Repository/account deletion could remove it.
An independently stored full mirror and data backup is still recommended.

To recover, inspect the differences, take a fresh backup, then restore the
required files with a new reviewed commit and rebuild/test the website. Do not
blindly reset or force-push `main`, and do not overwrite newer forecast data.

## Account-level safeguards still requiring owner configuration

The current connector can edit project files but does not expose administrative
writes for branch protection, rulesets, security feature switches, collaborators,
or account authentication. These controls are NOT claimed to be enabled here.

The owner should review two-factor/passkey security and recovery access. A
main-only rule that blocks deletion and non-fast-forward pushes is a sensible
next step. Required reviews/checks need to accommodate the solo maintainer and
existing release process. Do not apply blanket force-push restrictions to live
data branches: some publishers intentionally use force-with-lease there.

## Handling suspected exposure

Do not put API keys, recovery codes, sensitive logs or exploitable details in
public issues or pull requests. Use GitHub private reporting if it has been
enabled; otherwise arrange a private channel with the repository owner before
sending details. If an actual credential is exposed, revoke/rotate it at its
provider and check historical files and logs. Deleting a file alone is not a
credential rotation.

## Verification

```sh
python3 -m unittest discover -s tests -p test_source_security.py -v
python3 scripts/check-source-security.py
```

Official guidance:
- https://docs.github.com/en/actions/reference/security/secure-use
- https://docs.github.com/en/repositories/managing-your-repositorys-settings-and-features/customizing-your-repository/about-code-owners
- https://docs.github.com/en/repositories/archiving-a-github-repository/backing-up-a-repository
- https://docs.github.com/en/repositories/managing-your-repositorys-settings-and-features/customizing-your-repository/licensing-a-repository
