# AEM Assets Commerce

A standalone Adobe App Builder extension that lets AEM Assets users find Adobe
Commerce products and associate the current asset with product or variant SKUs.
The Assets Details panel uses native React Spectrum controls, compact product
rows, on-demand gallery-position editing, and collapsed image settings.

Extracted from the WKND Commerce demo. This repository has no dependency on that
backend, its database, catalog, storefront, credentials, or deployment.
The original demo deployment is not changed by installing this app.

## What it does

- Searches an actual Commerce catalog by SKU or product name, including
  non-visible simple products used as configurable variants.
- Validates selected SKUs against that same Commerce connection before saving.
- Writes and verifies only `commerce:isCommerce`, `commerce:skus`,
  `commerce:roles`, and `commerce:positions` in AEM.
- Preserves SKU case, editorial metadata, approval, and existing localized alt text.
- Lets admins choose a Commerce instance, store view, and DAM subtree in
  Extension Manager without rebuilding or redeploying the app.
- Accepts connection details directly from Extension Manager, with optional
  server-side profiles for installations that must keep tokens out of the browser.
- Uses the current Assets user's permissions for all AEM reads and writes;
  the app never uses a privileged AEM identity.

**Saving is not immediate Commerce synchronization.** This app does not upload
image copies, modify Commerce product galleries directly, or provide a custom
matcher. Install and configure Adobe's **AEM Assets Integration for Adobe Commerce**
with **Match by product SKU** (`commerce:skus`), Dynamic Media with OpenAPI, and
the required asset approval/publishing flow. That integration processes metadata
changes asynchronously. The UI explicitly reports that synchronization is pending.
Changing store view scopes catalog search/validation, not image assignments:
the native integration does not provide per-store-view image assignment.

## Supported environments

- AEM Assets as a Cloud Service with **Assets View extensibility enabled** and
  the required Assets Ultimate entitlement.
- Adobe Commerce on cloud infrastructure or on-premises (PaaS), exposing the
  standard Magento 2 REST API at `/rest/{storeCode}/V1/products`.
- A Commerce integration token scoped to **Catalog > Products**. This app makes
  only GET requests to Commerce. If your standard Commerce ACL grants product
  writes too, use a custom read-only role or GET-only gateway restriction when
  strict credential-level read-only access is required.
  Depending on your Commerce release, standalone integration bearer tokens must
  be enabled by the Commerce administrator. Do not use an expiring personal admin
  token as a permanent deployment credential.
- Node.js 22+ for development, Adobe I/O CLI, an App Builder project/workspace,
  and permission to deploy/register AEM UI extensions.

Adobe Commerce as a Cloud Service (SaaS) uses different REST URLs and IMS
authentication. It is **not supported by this PaaS adapter**. This app also does
not implement OAuth 1.0 signing for installations that disallow bearer
integration tokens. Do not point these environments at the PaaS connection URL.

## 1. Install and connect an App Builder workspace

```sh
npm ci
aio auth login
aio app use --no-input
cp .env.example .env
```

Select your own Developer Console project/workspace using `aio app use` if one is
not already selected. Never import another project's `.aio`, `.env`, or generated
frontend configuration. The repository intentionally contains none of those.
Use a new App Builder project for this standalone app; it deploys its own static
bundle and is not intended to share a workspace CDN with an unrelated app.

## 2. Choose a connection configuration mode

**Default: Extension Manager configuration.** Leave
`ASSETS_COMMERCE_CONNECTIONS='{}'` in [.env.example](.env.example). After the
one-time app deployment, set `commerceUrl` and `commerceToken` using Extension
Manager's **Configure > Add variable** mechanism (see step 4). You can add or
change the instance URL, token, store view, and DAM folder there without editing
`.env`, running a build, or deploying an action.

**Credential visibility:** Extension Manager variables are delivered to the
extension in the user's browser; they are **not a secret store**. Users who can
run the panel can inspect the Commerce token. Use a dedicated, least-privilege
catalog integration token and rotate it in Extension Manager when necessary.
Do not use a personal admin token, IMS token, or credential with write access.
If your Commerce ACL cannot provide a suitably restricted credential, use a
read-only gateway or the optional server-side mode below instead.

### Optional: server-side profiles

For tokens that must remain server-only, edit `ASSETS_COMMERCE_CONNECTIONS` in
`.env` using this map keyed by a public connection identifier:

```json
{
  "my-store": {
    "imsOrg": "YOUR_ORG@AdobeOrg",
    "aemAuthorUrl": "https://author-p123-e456.adobeaemcloud.com",
    "productsRoot": "/content/dam/products",
    "commerceUrl": "https://commerce.example.com",
    "storeCodes": ["default", "fr"],
    "commerceToken": "YOUR_CATALOG_INTEGRATION_TOKEN"
  }
}
```

The Commerce URL is the installation's base URL, **not** `/graphql`, `/admin`,
or `/rest`. Subdirectory installations are supported, for example
`https://commerce.example.com/shop`. The adapter appends
`/rest/{storeCode}/V1/products`.

Add a second entry such as `another-store` for another Commerce instance, with
its own token, IMS organization, AEM author, and allowed store codes. Only
authorized users of the configured AEM subtree can use that profile.

In this optional mode, `connectionId` selects a profile. Its token cannot be
overridden or redirected using browser configuration. Adding a server-only
profile or rotating its token requires updating the server profile and
redeploying its action. This restriction does **not** apply to the default
Extension Manager mode.

Only configure public HTTPS destinations you control. Direct-mode Commerce
requests reject private/reserved IP addresses during DNS resolution, pin the
validated addresses at socket connection time, and limit responses to 2 MiB.
Redirects are rejected on both Commerce and AEM requests.

## 3. Build, deploy, and register

```sh
npm run lint
npm test
npm run build
npm run deploy
```

The extension point is **`aem/assets/assetsview/1`**. The registration page is
`https://<your-runtime-namespace>.adobeio-static.net/index.html`; it must be opened
by the Assets host, not used as a standalone application.

In [Extension Manager](https://experience.adobe.com/aem/extension-manager):

1. If your deployed extension is not listed, use **Bring Your Own Extension**.
2. Name it **AEM Assets Commerce** and use your `/index.html` URL.
3. Select **AEM Assets View** as the supported service.
4. Select the target AEM program/environment.
5. Configure the variables below, preview, then enable the extension.

Production environment enablement requires a system administrator. A developer
can enable it on non-production environments.

App Builder code deployment, Exchange publication/approval, BYO registration, and
environment enablement are separate steps. Re-approving an existing Exchange
app does not add a missing extension point. Adobe rejects endpoint updates while
an app is Published; use BYO registration rather than retracting an unrelated
published app or overwriting its extension points with `--force-publish`.

## 4. Configure in Extension Manager

Open the extension's **gear / Configure** action, choose **Add variable**, and
enter these key/value pairs. They are read from `guestConnection.configuration`
for **every request**. Save the Extension Manager configuration and reopen the
panel to ensure the host supplies the updated values.
Use plain text values, not JSON-encoded strings.

### Direct configuration (default, no server profile)

| Key | Required | Example | Behavior |
| --- | --- | --- | --- |
| `commerceUrl` | Yes | `https://commerce.example.com` | Commerce installation base URL, optionally including its subdirectory. |
| `commerceToken` | Yes | Your restricted catalog integration token | Browser-visible bearer credential, sent only to that Commerce instance over HTTPS. |
| `storeCode` | No | `fr` | Commerce store view; defaults to `default`. |
| `productsRoot` | No | `/content/dam/products/shoes` | DAM subtree for asset linking; defaults to `/content/dam/products`. AEM user permissions still apply. |

Omit/remove `connectionId` to use this mode. The AEM author URL and Adobe user
identity come from the Assets host automatically. Direct mode only accepts AEM
Cloud Service author hosts (`author-p<program>-e<environment>.adobeaemcloud.com`);
you do not need to configure an IMS organization or AEM URL.

[extension-manager.example.json](extension-manager.example.json) is a reference,
not an Extension Manager import payload. Never commit a populated token to Git.
The panel displays an actionable setup error if the URL or token is missing.

### Optional server-profile configuration

| Key | Required | Example | Behavior |
| --- | --- | --- | --- |
| `connectionId` | Yes | `my-store` | Selects the server profile and its bound credentials. |
| `commerceUrl` | No | `https://commerce.example.com` | Must match the selected profile; omit to use its URL. |
| `storeCode` | No | `fr` | Must be allowed by the profile; defaults to its first code. |
| `productsRoot` | No | `/content/dam/products/shoes` | May narrow but never broaden the profile's root. |

Do not set `commerceToken` in this mode; the frontend does not forward it.
An invalid `connectionId` displays an error rather than falling back to direct
mode. Remove `connectionId` explicitly to switch modes.

### Point the extension at another instance

1. In Extension Manager, remove `connectionId` if set.
2. Set `commerceUrl` and `commerceToken` for the new instance; set its `storeCode`
   and `productsRoot` as needed, then save the configuration.
3. Reopen the panel, search a known SKU, and verify it comes from the new
   instance before saving a mapping.

No build, action redeployment, catalog import, or `.env` update is required.
Rotate a direct-mode token by updating `commerceToken` in the same way.
If using server profiles instead, onboard the instance on the server first,
then select its `connectionId`.

## 5. Prepare AEM metadata and synchronization

Install Adobe's Commerce metadata namespace/schema resources as part of the
AEM Assets Integration onboarding. In **Assets View > Settings > Metadata
Forms**, preserve existing editorial tabs and add/assign a Commerce tab to the
configured product folder.

[aem-config/commerce-metadata-form.spec.json](aem-config/commerce-metadata-form.spec.json)
is a **manual blueprint**, not an Adobe package/import payload. Use bare property
names in Assets View:

| Label | Property | Type |
| --- | --- | --- |
| Use in commerce | `commerce:isCommerce` | Read-only yes/no dropdown |
| Product SKUs | `commerce:skus` | Read-only multi-value text |
| Image roles | `commerce:roles` | Read-only multi-value text |
| Gallery positions | `commerce:positions` | Read-only multi-value text |
| Commerce approval | `dam:status` | Read-only text |
| Title | `dc:title` | Text |
| Description | `dc:description` | Multi-line text |

Positions are strings aligned by SKU index. Roles apply to all selected SKUs.
Arrays remain multi-valued even for one value. The panel never changes
`dam:status` or `dam:assetStatus`. Approve/publish using your existing AEM workflow.
Role defaults for an empty selection depend on your configured integration;
choose explicit image roles if your matcher requires them. Custom roles require
a compatible AEM Assets Integration release (1.4.6+).

Use one intended Commerce integration per asset subtree. These standard metadata
fields do not isolate multiple Commerce tenants: changing the panel connection
does not migrate metadata or reconfigure the native sync service.

### Author workflow

1. Open a product asset in Assets View > Details > **Commerce**.
2. Search by name or SKU and press Enter; add a result.
3. Use a row's Edit action for gallery position or pending unlink.
4. Expand Image settings for roles or eligibility.
5. Save, or Cancel to discard pending changes.

The first added product enables commerce use and, if no roles exist, selects
main/list/thumbnail roles. Unlinking the final product turns commerce use off.
Turning eligibility off preserves the selected SKU metadata but excludes
the asset from Commerce matching. Reload is disabled while edits are pending.

## Validation

```sh
npm ci
npm run lint
npm test
npm run test:coverage
npm run build
```

Tests cover direct Extension Manager connections and token rotation without
server configuration, optional trusted-profile selection, public DNS enforcement,
REST query
encoding, hidden variants, SKU case, credential separation, org/author/path
boundaries, AEM permission checks before catalog access, typed metadata writes,
read-back failure, conflict handling, simplified UI and cancellation.
Tests mock network and AEM host APIs; they do not prove a customer's live
Commerce integration is configured.

Before enabling in production, preview in your environment and verify:

- A known product and a hidden variant are searchable in the selected store.
- Save a test asset with two SKUs/positions, reopen it, and verify metadata types.
- Confirm title, description, approval and localized alt text are unchanged.
- Wait for native synchronization and check the Commerce product gallery.
- Test unlinking, insufficient AEM permissions, and invalid connection details.
- Change the Commerce URL/token in Extension Manager without redeploying, then
  confirm search uses the new instance.
- Test narrow panel widths, keyboard navigation, and light/dark themes.

### Operational details

The Runtime gateway validates Adobe authentication (`require-adobe-auth`).
The action uses the caller's token to read the selected asset **before any
Commerce request**; a caller-supplied
organization header alone is not authorization. Any user who can read the allowed
AEM asset and has the configured token can search the Commerce catalog. Saving additionally
requires AEM write permission. Restrict the DAM root accordingly.
Optional server profiles additionally bind the organization, AEM author, store
views, folder and Commerce destination. Direct-mode folder configuration is not
an access-control boundary: AEM ACLs enforce actual access.
Manifest `final: true` prevents callers from replacing injected server inputs.
Direct-mode Commerce tokens travel in authenticated HTTPS request bodies to the
action and are not returned or logged by app code. They remain visible in browser
configuration/network tools; apply your Runtime activation-retention policy too.

AEM metadata uses Sling POST and read-back verification on the selected asset,
matching the original extension's working transport. The user token/client ID
must be accepted by your AEM API allowlist, and the user's account must have
appropriate DAM permissions. Environments that block this endpoint need their
AEM administrator to authorize it; no privileged fallback is attempted.

Revisions detect edits to the four Commerce properties since load, but the
read-before-write check is **not atomic compare-and-swap**. Avoid concurrent edits
to the same asset. A timeout/read-back failure can occur after a successful write:
reload before retrying. Failed requests are never retried automatically.
All network calls have timeouts and reject redirects.

To roll back, disable the standalone BYO extension for that environment. Disabling
the panel does not remove metadata or stop the native Commerce sync service.
No database, S2S AEM credentials, custom Commerce schema, or catalog import is needed.

## Adobe references

- [Extension Manager parameters and BYO registration](https://developer.adobe.com/uix/docs/extension-manager/feature-highlights/)
- [Commerce metadata in AEM Assets](https://experienceleague.adobe.com/en/docs/commerce/aem-assets-integration/metadata)
- [Default SKU matching](https://experienceleague.adobe.com/en/docs/commerce/aem-assets-integration/synchronize/default-match)
- [AEM Assets Integration setup](https://experienceleague.adobe.com/en/docs/commerce/aem-assets-integration/get-started/setup-synchronization)
- [Commerce REST search criteria](https://developer.adobe.com/commerce/webapi/rest/use-rest/performing-searches/)
