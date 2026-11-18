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
  Extension Manager without rebuilding the frontend.
- Keeps Commerce tokens server-side. The current Assets user's permissions
  control all AEM reads and writes; the app never uses a privileged AEM identity.

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

## 2. Add trusted server-side connections

Edit `ASSETS_COMMERCE_CONNECTIONS` in `.env` using the JSON structure in
[.env.example](.env.example). It is a map keyed by a public connection identifier:

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

This server allowlist is intentional: Extension Manager parameters are
browser-visible and are not a safe place for secrets or arbitrary destinations
that receive server credentials. Onboarding a **new destination or rotating a
token** requires updating the server profile and redeploying its action. After
onboarding, switching between trusted profiles/store views/folder subtrees in
Extension Manager requires **no code change, build or deployment**.

Only configure public HTTPS destinations you control. Do not configure internal
services, metadata endpoints or shared untrusted DNS names. Redirects are rejected
on both Commerce and AEM requests.

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
for **every request**, so reopening the panel picks up configuration changes.
Use plain text values, not JSON-encoded strings.

| Key | Required | Example | Behavior |
| --- | --- | --- | --- |
| `connectionId` | Yes | `my-store` | Selects the server-side profile and its bound credentials. |
| `commerceUrl` | No | `https://commerce.example.com` | Optional explicit instance URL; must match the selected profile. Omit to use that profile's URL. |
| `storeCode` | No | `fr` | Selects an allowed Commerce store view; defaults to the profile's first code. |
| `productsRoot` | No | `/content/dam/products/shoes` | Narrows the allowed DAM subtree. Cannot broaden the profile's root. |

[extension-manager.example.json](extension-manager.example.json) is a reference,
not an Extension Manager import payload. **Do not add `commerceToken`, IMS
tokens, API secrets, or the server JSON to Extension Manager.**
The panel displays an actionable setup error if `connectionId` is missing.

### Point the extension at another instance

1. An App Builder administrator adds the instance and its credential as a
   server connection, e.g. `another-store`, and deploys the action.
2. In Extension Manager set `connectionId=another-store`, optionally change
   `commerceUrl`, and select an allowed `storeCode`.
3. Reopen the panel, search a known SKU, and verify that it comes from the new
   instance before saving a mapping.

The new connection must match the current AEM author and user organization.
Changing `commerceUrl` alone cannot redirect a profile's token to a different
server. Authorization errors are displayed instead.

## 5. Prepare AEM metadata and synchronization

Install Adobe's Commerce metadata namespace/schema resources as part of the
AEM Assets Integration onboarding. In **Assets View > Settings > Metadata
Forms**, preserve existing editorial tabs and add/assign a Commerce tab to the
profile's product folder.

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

Tests cover Extension Manager settings, trusted-profile selection, REST query
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
- Test unlinking, insufficient AEM permissions, and a mismatched connection URL.
- Test narrow panel widths, keyboard navigation, and light/dark themes.

### Operational details

The Runtime gateway validates Adobe authentication (`require-adobe-auth`).
The action also checks the configured IMS organization and uses the caller's
token to read the selected asset **before any Commerce request**; a caller-supplied
organization header alone is not authorization. Any user who can read the allowed
AEM asset can search the profile's read-only Commerce catalog. Saving additionally
requires AEM write permission. Restrict the DAM root accordingly.
Manifest `final: true` prevents callers from replacing injected server inputs.

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
