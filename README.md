# DocuVault

DocuVault is an Android and iOS document vault for organizations. The Expo app uses an Express API, PostgreSQL, and a private filesystem-backed storage adapter.

## Run locally

Use Node.js 24 LTS, npm, and either Docker Compose or an existing PostgreSQL instance.

```sh
npm ci
docker compose up -d postgres
cp server/.env.example server/.env
```

Set `JWT_SECRET` in `server/.env` to a random secret, for example the output of `openssl rand -hex 32`. Update `DATABASE_URL` if you are using an existing database.

```sh
npm run db:generate -w server
npm run db:deploy -w server
npm run api
```

In a separate terminal, start the app.

```sh
npm run mobile
```

Use a development build whose Expo SDK matches `mobile/package.json`. With the native toolchains installed, generate and run one using `npx expo run:ios` or `npx expo run:android` from `mobile`. The API defaults to `localhost:4000` in the iOS simulator and `10.0.2.2:4000` in the Android emulator. For a physical device, set `EXPO_PUBLIC_API_URL` in `mobile/.env` to a reachable API origin. Use an HTTPS origin for distributed builds.

Register your organization and save its code. In **Profile**, create a department and a role, then register an employee and assign both. Give the employee the organization code, Employee ID, and initial password through a private channel. The employee can change their password in **Settings**. Upload a file, select roles, departments, or employees in **Manage access**, and review and save the rules.

## Access policy

1. Each request requires a valid JWT, a live server-side session, and an active membership. Every document lookup is scoped to the member's organization.
2. For each action, the employee needs the corresponding role capability. The founding administrator has all capabilities. View, Download, Edit, Delete, and Manage Access are evaluated independently.
3. Any applicable explicit denial overrides all allows for that action, including the uploader's and administrator's implicit access. The administrator and uploader otherwise have access within their capabilities.
4. Other members need an applicable allow. Public and Internal support employee, role, and department allows. Confidential supports employee and role allows. Restricted requires an individual employee allow. Every classification remains organization-scoped.
5. Grants are live. Revoking a rule, changing a role permission, or deactivating a member takes effect on subsequent requests. Grant edits use an optimistic comparison so an old form cannot silently overwrite newer rules.

View allows in-app previews and access to the document's details and version history. PDFs and images are rendered as page images. Word files and spreadsheets have a paginated text preview that omits original layout and formatting. Download authorizes export of the original file. An employee can request view access using a document ID shared by a manager.

## Storage and audit

Files are stored under opaque keys in the private `STORAGE_DIR`. Back up that volume together with PostgreSQL. File bytes are checked against their recorded SHA-256 fingerprints before previews and downloads. Deletion removes access to the document and retains versions in private storage. An object-storage adapter can implement the same save, read, and remove operations.

Access changes and document activity are written to an organization-specific hash chain. PostgreSQL serializes chain writes and a trigger rejects updates, deletes, and truncation. A privileged database owner can bypass database controls. Retain verified chain heads outside the database if you need to detect administrator-level rewriting or tail removal.

For deployment, terminate TLS at the API ingress, restrict database and file-volume access, and use a separate migration identity from the API runtime identity. The runtime needs read/write access to application tables and only SELECT and INSERT on the audit table. Limit request bodies and concurrent uploads at ingress. Run the database and file-store backups together and restrict access to both.

## Verify

```sh
npm run check
DOCUVAULT_TEST_URL=http://127.0.0.1:4000 npm run check -w server
```

Point the integration test at an isolated instance because it creates organizations, accounts, files, and audit records. The test exercises tenant isolation, grants and denials, classification, previews, downloads, approvals, versioning, revocation, logout, and audit verification.
