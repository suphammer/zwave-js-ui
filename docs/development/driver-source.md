# Select the Z-Wave JS driver source

This branch can use the normal published Driver or a pinned Git checkout.
`driver-source.json` selects the source. The published `zwave-js` dependency and
`package-lock.json` remain the baseline for the application dependencies.

## Pinned Git source

The repository URL and full commit hash in `driver-source.json` identify the
Driver code. Prepare it before building or starting the application:

```sh
npm run driver-source:bootstrap
npm run build
npm start
```

The bootstrap command runs `npm ci`, clones the selected commit into the ignored
`.driver-source/` directory, installs its immutable Yarn dependencies, cleans and
builds the entire Driver workspace, and packs its packages with upstream
`monopack`. It installs the complete Driver package closure together without
saving changes to the application's dependency manifest or lockfile. Newly
introduced external fork dependencies use the fork's declared ranges; the Git
pin identifies Driver code, rather than a second npm lockfile.

A clean local checkout at the selected commit can seed the managed clone:

```sh
npm run driver-source:bootstrap -- --seed ../zwave-js
```

The seed is only copied as Git objects; it is never cleaned, built or modified.
Git and npm must be available. Bootstrap installs Corepack `0.34.0` inside its
own ignored cache and checks the exact Yarn version selected by the manifest.
CI can prepare an already installed
application with `npm run driver-source:bootstrap -- --skip-npm-ci`.

Startup, server development, and production build commands verify the selected
source. Every installed Driver workspace package must carry the selected Git
identity, retain its recorded contents, and resolve the same workspace package
instances. This also checks the server and log-transport peer dependencies.
Running `npm ci` later installs the published baseline again, so rerun bootstrap
before starting a Git-source server. Verification itself works offline.

## Published npm source

To return to the exact published version already pinned in `package.json`, set:

```json
{
	"schemaVersion": 1,
	"source": "npm"
}
```

Then run `npm run driver-source:bootstrap`. It installs the normal lockfile and
checks that a Git overlay is no longer installed. Application settings and
controller stores are separate from source selection and are not changed.

## Deployment scope

This preparation flow targets a source checkout. Published npm packages,
standalone binaries and Docker release workflows do not include the managed
source cache or installation provenance. Building those distribution artifacts
with a selected Git Driver requires a separate packaging integration; this
branch's source selection does not change the release workflows.

## Cache ownership

Generated source, tarballs, and installation metadata stay in `.driver-source/`;
none belong in Git. A bootstrap lock prevents concurrent npm mutations. If a
bootstrap process is interrupted, confirm it has exited before deleting its
leftover `.driver-source/bootstrap.lock` and rerunning the command.

## Native controller identity and firmware

The selected Driver can provide optional controller firmware metadata. The info
icon in the top toolbar shows its manufacturer, product, running firmware version,
minimum compatible version, and the firmware baseline recommended by that Driver
commit. Clicking the icon also copies these details. The baseline is not a claim
about the latest firmware available online; compatible newer versions remain
accepted. Missing metadata leaves the normal Serial API display unchanged.

For Suphacap, the version comes from the connected RCP firmware's live information
response. It is separate from the emulated Serial API node's version and Z-Wave
SDK version. The backend display names identify the local controller as
**Suphammer / Suphacap 2**. They do not allocate a Z-Wave Manufacturer ID:
`0xffff` remains an unassigned/reserved placeholder, with Product Type and Product
ID `0`. These numeric fields are not registered as Suphammer in the shared
manufacturer or device configuration database. Included devices continue to use
the normal Z-Wave JS configuration database and their actual reported identities.
