# Security policy

Prism Mapper runs on your own device. It has no accounts and no server, normal playback uses no network, and the Android app does not even have the internet permission. The places where something can still go wrong are the reading of project and media files, the connection between the desktop app's windows, and the way the downloads are built.

## Reporting a problem

If you think you found a security problem, please do not post the details in a public issue.

- If the **Security** tab of the [repository](https://github.com/LoneForgeTechnologies/prism-mapper) offers **Report a vulnerability**, use that. It is private.
- Otherwise open an [issue](https://github.com/LoneForgeTechnologies/prism-mapper/issues/new/choose) that only says you have a security report, with no technical details, and the maintainers will arrange a private way to receive them.

This is a volunteer project. There is no bounty and no promised response time, but reports are read and taken seriously.

## Which versions get fixes

Only the latest release. Prism Mapper is a half vibe-coded, half-tested project (see the [README](README.md#how-well-is-it-tested)), so please do not rely on it for anything where a failure would be dangerous.

## About the downloads

- The release files are built on GitHub's machines from the tagged source by the workflows in [`.github/workflows`](.github/workflows). Every file has a SHA-256 checksum on the release page.
- The Windows, Mac and Android builds are **not code-signed with a publisher certificate**, and the Mac app is not notarized. Windows, macOS and Android warn about that the first time. Only run a download if you got it from the release page of this repository and its checksum matches.
- Android builds made by the project carry a temporary signature, so Android does not treat a newer build as an update of an older one.
- The iPhone and iPad web app is served from GitHub Pages and cached for offline use by a service worker. It stores your drafts and imported media in the browser's own storage on your device.
