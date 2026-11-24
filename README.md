# DocuVault

DocuVault is an Android and iOS document vault for organizations. The Expo app uses an Express API, PostgreSQL, and a private filesystem-backed storage adapter.

## Run locally

Use Node.js 24 LTS. Run these commands from the repository root.

```sh
npm ci
npm run db:generate -w server
npm run api
```

For an existing Neon database with applied migrations, keep the current `server/.env`. It holds `DATABASE_URL`, `JWT_SECRET`, and optionally `PORT` (default 4000) and `STORAGE_DIR`. You can check migration state with `npm exec -w server -- prisma migrate status`. Starting the API does not apply or reset migrations.

For a new local database only, start PostgreSQL with `docker compose up -d postgres`, copy `server/.env.example` to `server/.env` if it is missing, set a random `JWT_SECRET` (such as the output of `openssl rand -base64 48`), and run `npm run db:deploy -w server` before starting the API.

Check the running server with `curl http://127.0.0.1:4000/health`. If the API reports `EADDRINUSE`, use `lsof -nP -iTCP:4000 -sTCP:LISTEN` to identify the listener. Reuse a running DocuVault server, stop it in its own terminal, or change `PORT` and update the mobile URL to match.

### Connect Expo

Set `EXPO_PUBLIC_API_URL` in `mobile/.env`. This is the API origin; the app adds `/api`.

| Target | Example |
| --- | --- |
| Physical Android or iPhone | `http://192.168.1.10:4000` with your Mac’s actual Wi-Fi IP |
| Android Studio emulator | `http://10.0.2.2:4000` |
| iOS simulator on the API Mac | `http://127.0.0.1:4000` |

For a physical device, keep it and the Mac on the same Wi-Fi. Find the Mac’s IP in System Settings or run `ipconfig getifaddr en0` if Wi-Fi uses that interface. On the device, open the API URL followed by `/health` and confirm it returns `{"ok":true}`. Allow Local Network access if prompted on iOS. A firewall or Wi-Fi client isolation can block either port 4000 (API) or port 8081 (Metro).

In a separate terminal, run:

```sh
cd mobile
npx expo start --lan
```

Restart Expo and reload the app after changing `mobile/.env`. Use an Expo Go client that matches this project’s Expo SDK and permits local HTTP, or a matching development build. With the native tools installed, run `npx expo run:android` or `npx expo run:ios` from `mobile` to build locally. Use a trusted Wi-Fi network with local HTTP and use HTTPS for distributed builds. React Native API calls do not require browser CORS headers. Keep database credentials and JWT secrets only in the server environment.

### Register and log in

Choose **Register an organization**, enter your name, Employee ID, work email, and a password of at least 12 characters, then choose a unique organization code and finish setup. Sign in using that code, your email or Employee ID, and your password.

In **Profile**, create a department and a role, then register an employee and assign both. Give the employee the organization code, Employee ID, and initial password through a private channel. Employees can change passwords in **Settings**.

### Demo accounts

The demo seed uses the existing `server/.env` and the `docuvault-demo` organization. Provide `DEMO_ADMIN_PASSWORD`, `DEMO_MANAGER_PASSWORD`, and `DEMO_EMPLOYEE_PASSWORD` as shell environment variables, then run:

```sh
npm run demo:seed -w server
npm run demo:verify -w server
```

Run verification with the API already running. It signs in by email, checks the returned token against the protected profile endpoint, verifies the assigned role, and logs out. The seed creates missing demo records and leaves matching records untouched. It stops if it finds a conflicting organization, role, or account. Keep these demo passwords out of production accounts.

## Access policy

1. Each request requires a valid JWT, a live server-side session, and an active membership. Every document lookup is scoped to the member's organization.
2. For each action, the employee needs the corresponding role capability. The founding administrator has all capabilities. View, Download, Edit, Delete, and Manage Access are evaluated independently.
3. Any applicable explicit denial overrides all allows for that action, including the uploader's and administrator's implicit access. The administrator and uploader otherwise have access within their capabilities.
4. Other members need an applicable allow. Public and Internal support employee, role, and department allows. Confidential supports employee and role allows. Restricted requires an individual employee allow. Every classification remains organization-scoped.
5. Grants are live. Revoking a rule, changing a role permission, or deactivating a member takes effect on subsequent requests. Access managers can change rules only for actions they currently hold on the document. The access editor shows View and Download first and groups the remaining actions under advanced permissions. Grant edits use an optimistic comparison so an old form cannot silently overwrite newer rules.

View allows in-app previews and access to the document's details and version history. PDF, JPG, and PNG files are rendered in the app. Word files and spreadsheets can be opened separately after an authorized download. Download authorizes export of the original file. An employee can request view access using a document ID shared by a manager.

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
