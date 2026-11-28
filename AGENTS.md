# Public Project Content

- README, documentation, audit evidence, commit messages, release notes and release attachments describe product behavior, reproducible public fixtures, build results and compatibility limits only.
- Do not publish personal filesystem paths, account or device identifiers, certificate details, personal library statistics, device settings, private source details, or conversation and troubleshooting history.
- Keep detailed device evidence, backups, credentials and private fixtures outside the repository. Use generic platform names in public validation summaries.
- Before publishing documentation or release attachments, inspect the actual content and preserve the distinction between automated tests, builds and platform acceptance.
- Update release document attachments as well as the main-branch documentation when correcting public descriptions.

# Product And Data Migration

- Develop the new application's behavior and data model on their own terms. Upstream is a reference for requested features and appearance, not a requirement for legacy storage or backup-format equivalence.
- When an existing library must be carried over, convert that data to the new model in a dedicated migration step. Do not add legacy format export, bidirectional restore, or field-for-field compatibility solely to match the original application.
- Validate the new application's own persistence, backup/restore, and user data integrity. Legacy format byte equality is not an acceptance gate.
- Existing compatibility code and historical evidence do not create new parity work. Remove or change existing implementations only as required by an actual product task.
