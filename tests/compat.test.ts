import test from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { lastOf, newId } from "../src/compat.ts";

// Android 11 ships a web view as old as Chrome 83 and Safari 14 is still in
// use. A call to something newer is a TypeError at the moment it runs, and one
// in start-up code is a blank page. The type checker cannot see this (it is set
// to ES2022), so the first test reads every source file and refuses the calls
// that need a newer browser. Use src/compat.ts instead, or write it the old way.

// ---------------------------------------------------------------- the helpers

const V4 =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

// A crypto object that has lost what old web views lack.
const withoutRandomUuid = () => {
  const real = globalThis.crypto;
  return {
    getRandomValues: <T extends ArrayBufferView>(array: T) =>
      real.getRandomValues(array),
  };
};

test("newId makes a version 4 UUID with crypto.randomUUID when it exists", () => {
  const calls: string[] = [];
  const id = newId({
    randomUUID: () => {
      calls.push("randomUUID");
      return "11111111-2222-4333-8444-555555555555";
    },
    getRandomValues: () => {
      throw new Error("not needed");
    },
  });
  assert.equal(id, "11111111-2222-4333-8444-555555555555");
  assert.deepEqual(calls, ["randomUUID"]);
  assert.match(newId(), V4, "the real crypto of this runtime");
});

test("newId still works where crypto.randomUUID does not exist", () => {
  const source = withoutRandomUuid();
  assert.equal("randomUUID" in source, false);
  const ids = Array.from({ length: 2000 }, () => newId(source));
  for (const id of ids) assert.match(id, V4);
  assert.equal(new Set(ids).size, ids.length, "ids are unique");
  // Every id is something the project formats accept.
  for (const id of ids) assert.match(id, /^[a-zA-Z0-9_-]{1,128}$/);
});

test("newId has a last resort when there is no crypto at all", () => {
  for (const source of [undefined, null, {}, { randomUUID: "no" }] as const) {
    const ids = Array.from({ length: 2000 }, () =>
      newId(source as unknown as Parameters<typeof newId>[0]),
    );
    for (const id of ids) assert.match(id, V4);
    assert.equal(new Set(ids).size, ids.length);
  }
});

test("newId uses the random bytes it is given and sets the version and variant bits", () => {
  const fill = (byte: number) => ({
    getRandomValues: <T extends ArrayBufferView>(array: T) => {
      new Uint8Array(array.buffer, array.byteOffset, array.byteLength).fill(
        byte,
      );
      return array;
    },
  });
  assert.equal(newId(fill(0x00)), "00000000-0000-4000-8000-000000000000");
  assert.equal(newId(fill(0xff)), "ffffffff-ffff-4fff-bfff-ffffffffffff");
});

test("lastOf gives the final item, or nothing for an empty list", () => {
  assert.equal(lastOf([1, 2, 3]), 3);
  assert.equal(lastOf(["only"]), "only");
  assert.equal(lastOf([]), undefined);
  assert.equal(lastOf("abc" as unknown as ArrayLike<string>), "c");
});

// ---------------------------------------------------------------- the scan

// Calls through a member of this name need Chrome 92 to 110 or Safari 15.4 to
// 16.4, or are too new to trust. The reason is shown with a failure.
const MEMBERS: Record<string, string> = {
  at: "Array.prototype.at (Chrome 92): use lastOf() from compat.ts, or index the list",
  replaceAll:
    "String.prototype.replaceAll (Chrome 85): use replace with a /g regular expression",
  findLast: "Array.prototype.findLast (Chrome 97)",
  findLastIndex: "Array.prototype.findLastIndex (Chrome 97)",
  toSorted: "Array.prototype.toSorted (Chrome 110): copy, then sort",
  toReversed: "Array.prototype.toReversed (Chrome 110): copy, then reverse",
  toSpliced: "Array.prototype.toSpliced (Chrome 110)",
  hasOwn: "Object.hasOwn (Chrome 93): use Object.prototype.hasOwnProperty.call",
  structuredClone:
    "structuredClone (Chrome 98): the project is plain data, use JSON",
  groupBy: "Object.groupBy / Map.groupBy (Chrome 117)",
  fromAsync: "Array.fromAsync (Chrome 121)",
  withResolvers: "Promise.withResolvers (Chrome 119)",
  isWellFormed: "String.prototype.isWellFormed (Chrome 111)",
  toWellFormed: "String.prototype.toWellFormed (Chrome 111)",
  replaceChildren: "Element.replaceChildren (Chrome 86)",
  randomUUID:
    "crypto.randomUUID (Chrome 92, Safari 15.4, secure pages only): use newId() from compat.ts",
  requestVideoFrameCallback:
    "requestVideoFrameCallback (Chrome 83, Safari 15.4)",
  Segmenter: "Intl.Segmenter (Chrome 87, Safari 14.1)",
};
// Only a problem on these objects: `timeout` and `any` are ordinary names elsewhere.
const QUALIFIED: Record<string, string> = {
  "AbortSignal.timeout": "AbortSignal.timeout (Chrome 124, Safari 16)",
  "AbortSignal.any": "AbortSignal.any (Chrome 116)",
  "Promise.any": "Promise.any (Chrome 85)",
};
// Where the newer call is allowed because it is checked for first.
const ALLOWED: Record<string, string[]> = {
  "src/compat.ts": ["randomUUID"],
};
const NEW_SYNTAX = new Set<ts.SyntaxKind>([
  ts.SyntaxKind.QuestionQuestionEqualsToken, // ??= Chrome 85
  ts.SyntaxKind.BarBarEqualsToken, // ||= Chrome 85
  ts.SyntaxKind.AmpersandAmpersandEqualsToken, // &&= Chrome 85
  ts.SyntaxKind.PrivateIdentifier, // #name Chrome 84 for methods, Safari 14.1
  ts.SyntaxKind.ClassStaticBlockDeclaration, // Chrome 94, Safari 16.4
]);

function sourceFiles(directory = new URL("../src/", import.meta.url)): URL[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory()
      ? sourceFiles(new URL(`${entry.name}/`, directory))
      : /\.(ts|tsx)$/.test(entry.name)
        ? [new URL(entry.name, directory)]
        : [],
  );
}

/** Every use of something newer than Chrome 83 and Safari 14 in a piece of source. */
function problems(name: string, text: string): string[] {
  const file = ts.createSourceFile(
    name,
    text,
    ts.ScriptTarget.Latest,
    true,
    name.endsWith("x") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
  const found: string[] = [];
  const report = (node: ts.Node, what: string) => {
    const { line } = file.getLineAndCharacterOfPosition(node.getStart(file));
    found.push(`${name}:${line + 1}: ${what}`);
  };
  const allowed = ALLOWED[name] ?? [];
  const visit = (node: ts.Node) => {
    if (NEW_SYNTAX.has(node.kind)) report(node, ts.SyntaxKind[node.kind]);
    if (ts.isPropertyAccessExpression(node)) {
      const member = node.name.text;
      const owner = node.expression.getText(file);
      if (MEMBERS[member] && !allowed.includes(member))
        report(node, MEMBERS[member]);
      if (QUALIFIED[`${owner}.${member}`])
        report(node, QUALIFIED[`${owner}.${member}`]);
    } else if (ts.isElementAccessExpression(node)) {
      const argument = node.argumentExpression;
      if (ts.isStringLiteral(argument) && MEMBERS[argument.text])
        report(node, MEMBERS[argument.text]);
    } else if (ts.isIdentifier(node) && node.text === "structuredClone") {
      report(node, MEMBERS.structuredClone);
    } else if (ts.isRegularExpressionLiteral(node)) {
      if (/\(\?<[=!]/.test(node.text))
        report(node, "regular expression look-behind (Safari 16.4)");
      const flags = node.text.slice(node.text.lastIndexOf("/") + 1);
      if (/[dv]/.test(flags))
        report(
          node,
          `regular expression flag in /${flags} (Chrome 90, Safari 15)`,
        );
    } else if (
      ts.isAwaitExpression(node) &&
      ts.isSourceFile(node.parent.parent ?? node.parent)
    ) {
      report(node, "top-level await (Chrome 89, Safari 15)");
    }
    ts.forEachChild(node, visit);
  };
  visit(file);
  return found;
}

test("the app does not call anything newer than Chrome 83 and Safari 14", () => {
  const found = sourceFiles().flatMap((url) =>
    problems(
      url.pathname.slice(url.pathname.indexOf("/src/") + 1),
      readFileSync(url, "utf8"),
    ),
  );
  assert.deepEqual(found, []);
});

test("the app type-checks against the ES2020 library, which is what Chrome 83 and Safari 14 have", () => {
  // A newer method of a built-in object (a later addition to Array, String,
  // Object or Promise) is a type error here, whatever its name. The regular
  // type check uses ES2022. Browser APIs are not covered: they are in the scan.
  const configFile = fileURLToPath(
    new URL("../tsconfig.json", import.meta.url),
  );
  const config = ts.readConfigFile(configFile, ts.sys.readFile);
  const parsed = ts.parseJsonConfigFileContent(
    config.config,
    ts.sys,
    path.dirname(configFile),
  );
  const program = ts.createProgram(parsed.fileNames, {
    ...parsed.options,
    target: ts.ScriptTarget.ES2020,
    lib: ["lib.es2020.d.ts", "lib.dom.d.ts", "lib.dom.iterable.d.ts"],
  });
  const messages = ts.getPreEmitDiagnostics(program).map((diagnostic) => {
    const text = ts.flattenDiagnosticMessageText(diagnostic.messageText, "\n");
    if (!diagnostic.file || diagnostic.start === undefined) return text;
    const { line } = diagnostic.file.getLineAndCharacterOfPosition(
      diagnostic.start,
    );
    return `${path.relative(path.dirname(configFile), diagnostic.file.fileName)}:${line + 1}: ${text}`;
  });
  assert.deepEqual(messages, []);
});

// The same goes for style sheets: a property an old engine does not know is
// dropped, and a selector it does not know drops the whole rule. 100dvh is not
// in this list because height: 100vh comes before it as the fallback.
const CSS_NEWER: Record<string, RegExp> = {
  "the inset shorthand (Chrome 87): write top, right, bottom and left":
    /(^|[;{\s])inset\s*:/,
  "aspect-ratio (Chrome 88)": /(^|[;{\s])aspect-ratio\s*:/,
  ":is(), :where() and :has() (Chrome 88 and 105)": /:(is|where|has)\(/,
  "@container (Chrome 105)": /@container/,
  "@layer (Chrome 99)": /@layer/,
  "color-mix() (Chrome 111)": /color-mix\(/,
};

test("the style sheets do not rely on CSS that Chrome 83 and Safari 14 lack", () => {
  const directory = new URL("../src/", import.meta.url);
  const found = readdirSync(directory)
    .filter((name) => name.endsWith(".css"))
    .flatMap((name) => {
      const css = readFileSync(new URL(name, directory), "utf8").replace(
        /\/\*[\s\S]*?\*\//g,
        "",
      );
      return Object.entries(CSS_NEWER)
        .filter(([, pattern]) => pattern.test(css))
        .map(([what]) => `src/${name}: ${what}`);
    });
  assert.deepEqual(found, []);
  assert.ok(CSS_NEWER["aspect-ratio (Chrome 88)"].test("a{aspect-ratio: 1}"));
  assert.ok(
    !CSS_NEWER["aspect-ratio (Chrome 88)"].test("a{--aspect-ratio: 1}"),
  );
  const inset = Object.values(CSS_NEWER)[0];
  assert.ok(inset.test(".a {\n  position: fixed;\n  inset: 0;\n}"));
  assert.ok(!inset.test("padding: env(safe-area-inset-top); --inset-top: 0;"));
});

test("the scan itself recognises what it is there to catch", () => {
  const sample = `
    const a = list.at(-1);
    const b = id.replaceAll("a", "b");
    const c = Object.hasOwn(x, "y");
    const d = structuredClone(x);
    const e = crypto.randomUUID();
    const f = list.findLast((x) => x);
    const g = list.toSorted();
    const h = AbortSignal.timeout(10);
    const i = /(?<=a)b/;
    x ??= 1;
    class K { #secret = 1; }
    const fine = list[list.length - 1];
  `;
  const found = problems("sample.ts", sample);
  assert.equal(found.length, 11, found.join("\n"));
  assert.ok(
    found.every((line) => !line.includes(":13:")),
    "plain code passes",
  );
  assert.deepEqual(
    problems("src/compat.ts", "const a = crypto.randomUUID();"),
    [],
    "compat.ts may look for randomUUID",
  );
});
