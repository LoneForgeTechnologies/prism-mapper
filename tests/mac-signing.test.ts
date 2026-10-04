import { test } from "node:test";
import assert from "node:assert/strict";
import { macSigningConfig, signMacApplication } from "../scripts/sign-mac.mjs";

const identity = "Developer ID Application: Example Company (AB12CD34EF)";
const ready = {
  PRISM_MAC_SIGNING_IDENTITY: identity,
  PRISM_MAC_NOTARY_PROFILE: "prism-notary",
};
const metadata =
  "Authority=Developer ID Application: Example Company (AB12CD34EF)\nTeamIdentifier=AB12CD34EF\nCodeDirectory v=20500 flags=0x10000(runtime)\nTimestamp=Oct 4, 2026";

test("unsigned development is explicit; production cannot fall back", () => {
  assert.equal(macSigningConfig({}), null);
  assert.throws(
    () => macSigningConfig({ PRISM_REQUIRE_SIGNED_RELEASE: "true" }),
    /requires a Developer ID/,
  );
  for (const config of [
    { PRISM_MAC_NOTARY_PROFILE: "profile" },
    { PRISM_MAC_SIGNING_IDENTITY: "Apple Distribution: Example" },
    { PRISM_MAC_SIGNING_IDENTITY: identity },
    { ...ready, PRISM_MAC_TEAM_ID: "WRONGTEAM1" },
    { ...ready, PRISM_MAC_NOTARY_KEY_ID: "PARTIALKEY" },
  ])
    assert.throws(() => macSigningConfig(config));
});

test("partial credentials fail before signing or upload", async () => {
  let touched = false;
  await assert.rejects(
    signMacApplication("/tmp/Test.app", {
      platform: "darwin",
      env: { PRISM_MAC_SIGNING_IDENTITY: identity },
      run: () => {
        touched = true;
      },
      sign: async () => {
        touched = true;
      },
      submit: async () => {
        touched = true;
      },
    }),
  );
  assert.equal(touched, false);
});

test("Apple acceptance is followed by staple and Gatekeeper validation", async () => {
  const events: string[] = [];
  const result = await signMacApplication("/tmp/Test.app", {
    platform: "darwin",
    env: ready,
    sign: async (options: any) => {
      events.push("sign");
      assert.equal(options.identityValidation, true);
      assert.equal(options.optionsForFile("test").hardenedRuntime, true);
    },
    submit: async (options: any) => {
      events.push("submit");
      assert.equal(options.keychainProfile, "prism-notary");
    },
    run: (file: string, args: string[]) => {
      events.push(`${file}:${args[0]}`);
      return metadata;
    },
  });
  assert.deepEqual(result, {
    signed: true,
    notarized: true,
    team: "AB12CD34EF",
  });
  assert(events.indexOf("submit") > events.indexOf("sign"));
  assert(events.indexOf("/usr/bin/xcrun:stapler") > events.indexOf("submit"));
  assert.equal(events.at(-1), "/usr/sbin/spctl:--assess");
});

test("bad signatures and rejected notarizations never report a signed release", async () => {
  let uploaded = false;
  await assert.rejects(
    signMacApplication("/tmp/Test.app", {
      platform: "darwin",
      env: ready,
      sign: async () => {},
      run: () => "Signature=adhoc",
      submit: async () => {
        uploaded = true;
      },
    }),
    /missing its expected/,
  );
  assert.equal(uploaded, false);
  await assert.rejects(
    signMacApplication("/tmp/Test.app", {
      platform: "darwin",
      env: ready,
      sign: async () => {},
      run: () => metadata,
      submit: async () => {
        throw new Error("Apple rejected");
      },
    }),
    /Apple rejected/,
  );
});
