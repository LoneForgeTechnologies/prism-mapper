# Signing release downloads

Signing is prepared in the build scripts, but an Apple Developer membership and a Windows signing account have not been configured for this project. A permanent Android release key and its repository secrets have been configured. Existing v0.5.0 downloads keep their original development signatures. Changing the source does not sign an already published download.

The owner must complete account enrollment, identity verification, paid subscriptions and credential setup. No build script creates or purchases an account. Keep private keys and passwords out of Git, release assets, issue reports and chat messages.

## What signing changes

| Platform    | Prepared release path                                                                                              | Installation limits                                                                                                                                              |
| ----------- | ------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Mac         | Developer ID signing, hardened runtime, Apple notarization and a stapled ticket                                    | macOS can still show its normal confirmation for a downloaded app.                                                                                               |
| Windows     | Azure Artifact Signing, trusted Authenticode signatures and RFC3161 timestamps on app files, Setup and uninstaller | SmartScreen reputation still builds; even a valid OV/EV signature does not guarantee an immediate warning-free download.                                         |
| Android     | Permanent maintainer release key                                                                                   | Android still asks permission to install from the download source; Play Protect can still warn about a non-Play app.                                             |
| iPhone/iPad | Optional signed App Store/TestFlight build                                                                         | The GitHub `-iOS-unsigned.ipa` is a development sideload artifact, including when desktop and Android downloads are signed. It is not a normal public installer. |

Microsoft documents [current SmartScreen behavior](https://learn.microsoft.com/en-us/windows/apps/package-and-deploy/smartscreen-reputation): a consistent publisher signature helps reputation carry across releases, but no OV/EV certificate provides an instant bypass. A Microsoft Store installation is the route that avoids SmartScreen warnings reliably. Direct GitHub distribution remains supported.

Signing services are used while building releases. Installed Prism Mapper continues to run locally with saved projects and media; it does not contact these services during a show.

## Mac enrollment and credentials

[Apple Developer Program enrollment](https://developer.apple.com/programs/enroll/) costs 99 USD per membership year, with regional pricing and eligible fee waivers. Individual enrollment uses the owner's legal name. To show an organization's name as the App Store seller, enroll its legal entity with the required D-U-N-S number, binding authority, organization-domain contact information and public company website. A project name alone does not establish an organization identity.

After enrollment, create a **Developer ID Application** certificate with its private key, install it in a Mac Keychain, and configure notarization using either a local notary Keychain profile or an App Store Connect API key. This Mac certificate is separate from the **Apple Distribution** certificate used for iOS.

Local release settings:

| Environment variable         | Value                                                                      |
| ---------------------------- | -------------------------------------------------------------------------- |
| `PRISM_MAC_SIGNING_IDENTITY` | Full certificate name, `Developer ID Application: Legal Name (TEAMID1234)` |
| `PRISM_MAC_SIGNING_KEYCHAIN` | Optional path to the Keychain containing the identity                      |
| `PRISM_MAC_TEAM_ID`          | Optional expected 10-character team ID                                     |
| `PRISM_MAC_NOTARY_PROFILE`   | Local Keychain profile already configured for Apple's notary service       |
| `PRISM_MAC_NOTARY_KEY_ID`    | API key ID, when using the API-key route instead of a profile              |
| `PRISM_MAC_NOTARY_ISSUER_ID` | API issuer ID                                                              |
| `PRISM_MAC_NOTARY_KEY_PATH`  | Path to the private `.p8` file outside the repository                      |

Choose the profile route or all three API-key settings. A partial setup fails; it does not silently produce a development build. With no signing settings, local packaging uses an explicitly described ad-hoc signature. With `PRISM_REQUIRE_SIGNED_RELEASE=true`, packaging requires Developer ID signing and successful notarization.

In the GitHub `release-signing` environment, configure these secrets:

| Secret                       | Value                                                                                                             |
| ---------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| `MAC_CERTIFICATE_P12_BASE64` | Developer ID Application certificate and private key exported as a password-protected `.p12`, then base64 encoded |
| `MAC_CERTIFICATE_PASSWORD`   | Export password                                                                                                   |
| `MAC_API_KEY_P8_BASE64`      | Notary API private key, base64 encoded                                                                            |
| `MAC_API_KEY_ID`             | API key ID                                                                                                        |
| `MAC_API_ISSUER_ID`          | API issuer ID                                                                                                     |

Set the environment variable `PRISM_MAC_TEAM_ID` before publishing; this expected identity is required for actual releases. The workflow imports the identity into a temporary Keychain, validates the full Developer ID identity, signs nested Electron code, waits for notarization, staples the ticket and verifies Gatekeeper assessment before creating each ZIP. It verifies the Developer ID, team, runtime, timestamp and stapled ticket again after unpacking the ZIP. An `always()` cleanup removes the temporary `.p12`, `.p8` and Keychain even when a build fails.

## Windows account and GitHub OIDC

Follow Microsoft's [Artifact Signing setup](https://learn.microsoft.com/en-us/azure/artifact-signing/quickstart) to create an Azure subscription, signing account, validated public identity and **Public Trust** certificate profile. Eligibility depends on country and whether the identity is an organization or individual. Identity validation and subscription purchase require the owner; the workflow cannot complete them.

Create a Microsoft Entra application or managed identity with a federated credential restricted to this repository's `release-signing` environment. For this repository, its GitHub subject is `repo:LoneForgeTechnologies/prism-mapper:environment:release-signing`, with audience `api://AzureADTokenExchange`. Assign the **Artifact Signing Certificate Profile Signer** role scoped to the intended signing profile. Protect the GitHub environment with appropriate release access controls before configuring that trust.

Use [the official Azure action's OIDC instructions](https://github.com/Azure/artifact-signing-action). Configure these GitHub environment variables; they are public configuration identifiers, not private certificate data:

| Variable                            | Value                                                                                                                                             |
| ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| `AZURE_CLIENT_ID`                   | Federated application's client ID                                                                                                                 |
| `AZURE_TENANT_ID`                   | Entra tenant ID                                                                                                                                   |
| `AZURE_SUBSCRIPTION_ID`             | Azure subscription ID                                                                                                                             |
| `PRISM_WINDOWS_SIGNING_ENDPOINT`    | Signing account region endpoint, such as `https://eus.codesigning.azure.net/`                                                                     |
| `PRISM_WINDOWS_SIGNING_ACCOUNT`     | Artifact Signing account name                                                                                                                     |
| `PRISM_WINDOWS_CERTIFICATE_PROFILE` | Public Trust profile name                                                                                                                         |
| `PRISM_WINDOWS_EXPECTED_PUBLISHER`  | Exact certificate Subject string, required before publishing; obtain it from the validated profile and confirm it during the first signed dry run |

No Azure client secret or downloadable Windows private certificate is needed. `azure/login` authenticates with a temporary GitHub OIDC credential. The official `azure/artifact-signing-action` signs staged `.exe`, `.dll` and `.node` files with SHA256 and an RFC3161 timestamp. The account's endpoint must match its region.

The Windows build sequence is deliberately separate:

1. `node scripts/package-release.mjs --stage-only` copies the runtime, brands the executable and copies application files. It produces no ZIP.
2. The Azure action signs the staged executable files.
3. `node scripts/package-release.mjs --finalize` checks every Authenticode signature and timestamp, then writes the portable ZIP and its checksum.
4. `node scripts/build-windows-installer.mjs` verifies the staged app and uses a fixed Inno Setup signing callback to sign Setup and the embedded uninstaller. Setup verification happens before its checksum is written.
5. CI installs the app, verifies the installed uninstaller and runs the packaged behavior checks.

The callback uses `scripts/sign-windows.ps1` and the ArtifactSigning PowerShell module installed by the official action. It runs the same Azure CLI authentication and timestamp configuration as app signing. Local use requires Windows, PowerShell 7, that module, Azure authentication and the three signing-account settings. `PRISM_WINDOWS_SIGNING_ENABLED=true` enables signature verification and installer signing. Do not modify branded binaries after signing or rerun staging over signed files; finalize the existing stage instead.

## Android permanent key

The Android build already accepts a permanent release keystore. Create it once, keep a protected backup outside the repository, and configure the four existing GitHub secrets:

- `ANDROID_KEYSTORE_BASE64`
- `ANDROID_KEYSTORE_PASSWORD`
- `ANDROID_KEY_ALIAS`
- `ANDROID_KEY_PASSWORD`

Set the repository variable `PRISM_ANDROID_SIGNER_SHA256` to the release certificate's public SHA256 fingerprint. The workflow compares the final APK's actual certificate against it before artifact upload, including signed dry runs; actual publishing requires that fingerprint. The private keystore and owner-only credential backup belong outside the repository. Only the public fingerprint is a release verification setting.

See [building-mobile.md](building-mobile.md#signing-and-publishing) for the Gradle settings and local commands. [Android recommends a signing-key validity of at least 25 years](https://developer.android.com/studio/publish/app-signing). Android updates require the corresponding signing identity. Earlier development APKs used temporary debug keys, so users must export projects before uninstalling those installations to move to the permanent-key release.

Actual publishing calls set `require_android_signing=true`; missing secrets stop the build instead of silently publishing another temporary-key APK. Ordinary mobile checks and explicit release dry runs can still exercise development builds. If adding Google Play distribution later, plan its app-signing key together with the GitHub APK key; an upload key can differ from the key Google uses for installed apps.

## iPhone and iPad

The existing mobile workflow supports an Apple Distribution `.p12`, matching App Store provisioning profile and `org.prismmapper.mobile` app record. Its secrets are `APPLE_TEAM_ID`, `APPLE_CERTIFICATE_P12_BASE64`, `APPLE_CERTIFICATE_PASSWORD` and `APPLE_PROVISIONING_PROFILE_BASE64`. Optional `APPLE_API_KEY_ID`, `APPLE_API_ISSUER_ID` and `APPLE_API_KEY_P8_BASE64` enable a separately requested TestFlight upload.

Signed store output remains a CI artifact; this preparation does not submit or publish an App Store app. A paid membership alone does not make a GitHub IPA installable on arbitrary devices. An [ad-hoc distribution profile requires registered devices](https://developer.apple.com/help/account/provisioning-profiles/create-an-ad-hoc-provisioning-profile/). For general public installation, complete App Store distribution. [TestFlight builds expire after 90 days](https://developer.apple.com/help/app-store-connect/test-a-beta-version/testflight-overview/), so they are a testing option rather than a permanent offline installation.

## Testing before accounts are ready

Run the Release workflow with **dry run** enabled. The explicitly described development signatures allow packaging and functional checks while account setup is incomplete. A tag publication or a non-dry run requires real Mac, Windows and Android signing configuration and fails with a setup error until it is available. It never claims an unsigned development build is a signed release.

After credentials are configured, first run a signed dry run and inspect the verified publisher, Mac notarization, installer/uninstaller and checksums. Signing controls identity and file integrity; physical projector, audio and show playback testing remain separate release checks. Publish a new version after that review; do not replace v0.5.0's existing assets.
