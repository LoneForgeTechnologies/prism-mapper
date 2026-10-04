import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import * as ResEdit from "resedit";
// The installer scripts intentionally run as plain Node ESM.
import {
  compilerCandidates,
  findCompiler,
  generatedHeaderComment,
  installerDefines,
  installerFileName,
  installerScript,
  withWindowsLineEndings,
  // @ts-expect-error Plain Node ESM helper.
} from "../scripts/build-windows-installer.mjs";
// @ts-expect-error Plain Node ESM helper.
import { packageRelease, releaseName } from "../scripts/package-release.mjs";

const root = path.resolve(import.meta.dirname, "..");
const read = (...parts: string[]) =>
  fs.readFileSync(path.join(root, ...parts), "utf8");
const template = read("scripts", "windows-installer.iss");
const version: string = JSON.parse(read("package.json")).version;

// The installer script is Inno Setup syntax: [Section] headers, then one entry
// per line (comments start with ";"). Preprocessor lines start with "#".
function sections(text: string) {
  const found: Record<string, string[]> = { "": [] };
  let current = "";
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith(";")) continue;
    const header = /^\[(\w+)\]$/.exec(line);
    if (header) {
      current = header[1];
      found[current] ??= [];
    } else found[current].push(line);
  }
  return found;
}
const parts = sections(template);
const directive = (name: string) => {
  const line = parts.Setup.find((entry) => entry.startsWith(`${name}=`));
  return line?.slice(name.length + 1);
};
const defined = (name: string) =>
  new RegExp(`^#define ${name} "([^"]*)"`, "m").exec(template)?.[1];
// "Name: value; Other: ""quoted"" value": a quoted value may hold semicolons and
// writes a quote as two.
const entryFields = (line: string) => {
  const fields: Record<string, string> = {};
  for (const match of line.matchAll(
    /(\w+):\s*("(?:[^"]|"")*"|[^;]*)(?:;|$)/g,
  )) {
    const value = match[2].trim();
    fields[match[1]] = value.startsWith('"')
      ? value.slice(1, -1).replaceAll('""', '"')
      : value;
  }
  return fields;
};

test("the installer has the name of the release it belongs to", () => {
  assert.equal(
    installerFileName(version),
    `${releaseName(version, "win32", "x64")}-Setup.exe`,
  );
  assert.equal(
    installerFileName("0.4.1"),
    "Prism-Mapper-v0.4.1-Windows-x64-Setup.exe",
  );
  assert.throws(() => installerFileName("../1.0.0"));
  // Setup writes the file under the name the build script, the workflow and the
  // release notes all expect.
  assert.equal(
    `${directive("OutputBaseFilename")?.replace("{#AppVersion}", version)}.exe`,
    installerFileName(version),
  );
});

test("the build script supplies every value the installer script asks for", () => {
  const asked = [...template.matchAll(/^#ifndef (\w+)/gm)].map(
    (match) => match[1],
  );
  const defines = installerDefines({
    version: "0.5.0-rc.1",
    copyright: 'Copyright (c) 2026 The "Prism" contributors',
    repository: "C:\\work\\prism mapper",
    stage: "C:\\work\\prism mapper\\release\\Stage",
    license: "C:\\work\\License.txt",
    output: "C:\\work\\out",
  });
  assert.deepEqual(
    defines.map(([name]: [string]) => name).sort(),
    [...asked].sort(),
  );
  const script = installerScript("[Setup]\nAppName=x\n", defines);
  assert.ok(script.startsWith(generatedHeaderComment));
  assert.match(script, /^#define AppVersion "0\.5\.0-rc\.1"\r$/m);
  assert.match(script, /^#define AppNumericVersion "0\.5\.0\.0"\r$/m);
  assert.match(
    script,
    /^#define AppCopyright "Copyright \(c\) 2026 The ""Prism"" contributors"\r$/m,
  );
  assert.match(
    script,
    /^#define StageDir "C:\\work\\prism mapper\\release\\Stage"\r$/m,
  );
  assert.ok(script.endsWith("[Setup]\r\nAppName=x\r\n"));
  assert.doesNotMatch(script, /[^\r]\n/, "line endings are all CRLF");
  assert.equal(withWindowsLineEndings("a\nb\r\nc"), "a\r\nb\r\nc");
  // Without the values the script refuses to compile.
  for (const name of asked)
    assert.match(
      template,
      new RegExp(`#ifndef ${name}\\s+#error ${name} is not defined`),
    );
});

test("the installer shares its identifiers with the application", () => {
  const main = read("electron", "main.cjs");
  assert.equal(
    defined("AppUserModelId"),
    /const APP_ID = "([^"]+)"/.exec(main)?.[1],
    "taskbar grouping needs the same id in electron/main.cjs and the shortcuts",
  );
  assert.equal(defined("AppExe"), "Prism Mapper.exe");
  assert.match(read("scripts", "package-release.mjs"), /"Prism Mapper\.exe"/);
  assert.equal(defined("AppName"), "Prism Mapper");
  // The id Windows and later versions of this installer know the program by.
  // Changing it would install an update beside the old copy.
  assert.equal(
    parts.Setup.find((line) => line.startsWith("AppId="))?.toLowerCase(),
    "appid={{b6f0a8d2-3c41-4e7b-9a5d-1f2e6c8d4b73}",
  );
});

test("the installer installs for the current user without administrator rights", () => {
  assert.equal(directive("PrivilegesRequired"), "lowest");
  assert.equal(directive("PrivilegesRequiredOverridesAllowed"), "dialog");
  assert.equal(directive("DefaultDirName"), "{autopf}\\{#AppName}");
  assert.equal(directive("WizardStyle"), "modern");
  assert.equal(directive("ArchitecturesAllowed"), "x64compatible");
  assert.equal(directive("ArchitecturesInstallIn64BitMode"), "x64compatible");
  assert.equal(directive("MinVersion"), "10.0");
  // A running copy is closed for the update, also in silent mode.
  assert.equal(directive("CloseApplications"), "yes");
  assert.equal(directive("ChangesAssociations"), "yes");
  // The license is the first page.
  assert.equal(directive("LicenseFile"), "{#LicenseFile}");
  assert.equal(directive("DisableWelcomePage"), "yes");
  assert.equal(directive("SetupIconFile"), "{#RepoDir}\\build\\icon.ico");
  assert.equal(directive("UninstallDisplayIcon"), "{app}\\{#AppExe}");
  assert.equal(directive("VersionInfoVersion"), "{#AppNumericVersion}");
  assert.equal(directive("VersionInfoProductVersion"), "{#AppNumericVersion}");
  assert.equal(directive("AppVersion"), "{#AppVersion}");
  assert.equal(directive("AppCopyright"), "{#AppCopyright}");
  // Nothing in the script pins the installer to administrator mode.
  assert.ok(
    !parts.Setup.some((line) => /^PrivilegesRequired=admin/.test(line)),
  );
  assert.ok(fs.statSync(path.join(root, "build", "icon.ico")).isFile());
});

test("the shortcuts, the optional desktop icon and the launch after setup", () => {
  const icons = parts.Icons.map(entryFields);
  const menu = icons.find((icon) => icon.Name === "{autoprograms}\\{#AppName}");
  assert.equal(menu?.Filename, "{app}\\{#AppExe}");
  assert.equal(menu?.AppUserModelID, "{#AppUserModelId}");
  const desktop = icons.find((icon) => icon.Name.startsWith("{autodesktop}"));
  assert.equal(desktop?.Tasks, "desktopicon");
  assert.equal(desktop?.AppUserModelID, "{#AppUserModelId}");
  const task = parts.Tasks.map(entryFields).find(
    (entry) => entry.Name === "desktopicon",
  );
  assert.match(
    task?.Flags ?? "",
    /\bunchecked\b/,
    "no desktop icon unless asked",
  );
  const [launch] = parts.Run.map(entryFields);
  assert.match(launch.Flags, /\bpostinstall\b/);
  assert.match(launch.Flags, /\bskipifsilent\b/);
  assert.equal(launch.Filename, "{app}\\{#AppExe}");
});

// The [Code] section closes a running copy of the program before an update or
// an uninstall, by giving PowerShell a command as text. The command is built
// from Pascal string literals, which is evaluated here for a sample folder.
const code = template.slice(template.indexOf("\n[Code]"));
function pascalFunction(name: string) {
  const found = new RegExp(`^function ${name}\\b[\\s\\S]*?^end;`, "m").exec(
    code,
  );
  assert.ok(found, `function ${name} is missing from [Code]`);
  return found[0];
}
function pascalText(source: string, folder: string) {
  const tokens = /'((?:[^']|'')*)'|IntToStr\(CopiesExitBase\)|\bFolder\b/g;
  let text = "";
  for (const match of source
    .replaceAll("{#AppName}", "Prism Mapper")
    .matchAll(tokens))
    text +=
      match[1] !== undefined
        ? match[1].replaceAll("''", "'")
        : match[0].startsWith("IntToStr")
          ? "100"
          : folder;
  return text;
}
const closeCommands = (folder: string) => {
  const body = pascalFunction("CloseCommand");
  const assigned = body.slice(body.indexOf("Result :="));
  const [common, rest] = assigned.split("if OnlyCount then");
  const [count, close] = rest.split("\n  else\n");
  return {
    count: pascalText(common + count, folder),
    close: pascalText(common + close, folder),
  };
};

test("a running copy is closed by the installer and the uninstaller before files are replaced", () => {
  // Windows (Restart Manager) is kept as the fallback.
  assert.equal(directive("CloseApplications"), "yes");
  assert.match(
    code,
    /^function PrepareToInstall\(var NeedsRestart: Boolean\): String;/m,
  );
  assert.match(code, /^function InitializeUninstall: Boolean;/m);
  // Nothing is asked in a silent run, and an update of a missing install does nothing.
  assert.match(pascalFunction("PrepareToInstall"), /if not WizardSilent then/);
  assert.match(pascalFunction("PrepareToInstall"), /if not FileExists\(/);
  assert.match(
    pascalFunction("InitializeUninstall"),
    /if not UninstallSilent then/,
  );
  // A person is asked before the program is closed, and can say no.
  for (const name of ["PrepareToInstall", "InitializeUninstall"]) {
    assert.match(
      pascalFunction(name),
      /SuppressibleMsgBox\([\s\S]*MB_YESNO, IDYES\)/,
    );
    assert.match(pascalFunction(name), /CopiesRunning\(True\)/);
    assert.match(pascalFunction(name), /CopiesRunning\(False\)/);
  }
  // PowerShell failing in any way leaves the decision to Windows.
  const running = pascalFunction("CopiesRunning");
  assert.match(running, /Result := -1;/);
  assert.match(running, /\bexcept\b/);
  assert.match(
    running,
    /ExitCode >= CopiesExitBase\) and \(ExitCode < CopiesExitBase \+ 100/,
  );
  assert.match(code, /CopiesExitBase = 100;/);
  assert.match(code, /\{sys\}\\WindowsPowerShell\\v1\.0\\powershell\.exe/);
});

test("the PowerShell commands look for this program in the install folder only and close it politely first", () => {
  const folder = "C:\\Users\\Me\\AppData\\Local\\Programs\\Prism Mapper\\";
  const { count, close } = closeCommands(folder);
  for (const [name, command] of Object.entries({ count, close })) {
    // One quoted argument: no double quotes, quotes and brackets balance.
    assert.doesNotMatch(command, /"/, name);
    assert.equal(command.split("'").length % 2, 1, `${name}: single quotes`);
    for (const [open, shut] of ["{}", "()", "[]"])
      assert.equal(
        command.split(open).length,
        command.split(shut).length,
        `${name}: ${open}${shut}`,
      );
    assert.ok(command.startsWith(`$prefix = '${folder}'; `), name);
    assert.match(
      command,
      /Get-Process -Name 'Prism Mapper' -ErrorAction SilentlyContinue/,
    );
    // Only a process whose file is inside the folder, compared without case.
    assert.match(
      command,
      /\$_\.Path\.StartsWith\(\$prefix, 'OrdinalIgnoreCase'\)/,
    );
    assert.match(
      command,
      /catch \{ \$false \}/,
      "a process that cannot be inspected is not ours",
    );
    assert.ok(command.endsWith("exit (100 + @(& $find).Count)"), name);
    assert.doesNotMatch(command, /[–—]/);
  }
  // Counting changes nothing.
  assert.doesNotMatch(count, /CloseMainWindow|Kill|Stop-Process/);
  // Closing: the window first, then the wait, and only then the program itself.
  const order = [
    "CloseMainWindow()",
    "AddSeconds(20)",
    ".Kill()",
    "AddSeconds(10)",
  ].map((part) => close.indexOf(part));
  assert.ok(
    order.every((at) => at >= 0),
    JSON.stringify(order),
  );
  assert.deepEqual(
    [...order].sort((a, b) => a - b),
    order,
  );
  // The program's name in PowerShell is its file name without the extension.
  assert.equal(`${defined("AppName")}.exe`, defined("AppExe"));
  // A quote in a folder name cannot end the PowerShell string early.
  assert.match(
    pascalFunction("CloseCommand"),
    /StringChangeEx\(Folder, '''', '''''', True\);/,
  );
  assert.equal(
    pascalText("'$prefix = ''' + Folder + '''; '", "C:\\O''Brien\\"),
    "$prefix = 'C:\\O''Brien\\'; ",
  );
});

test("project files are offered to the person but no default program is replaced", () => {
  const entries = parts.Registry.map(entryFields);
  assert.ok(entries.length >= 8);
  for (const entry of entries) {
    assert.equal(
      entry.Root,
      "HKA",
      "per-user or all-users follows the install",
    );
    assert.equal(
      entry.Tasks,
      "openwith",
      "only when the person leaves the task on",
    );
    assert.match(
      entry.Subkey,
      /^Software\\Classes\\/,
      "only the Classes branch is touched",
    );
  }
  const subkeys = entries.map((entry) => entry.Subkey);
  // Windows opens files by their last extension. These are the only two
  // registrations for .json: an entry in its "Open with" list and a command
  // that applies to *.prism.json.
  const json = entries.filter((entry) => /\\\.json(?:\\|$)/.test(entry.Subkey));
  for (const entry of json) {
    if (entry.Subkey === "Software\\Classes\\.json")
      assert.equal(entry.ValueType, undefined, "the .json key gets no value");
    if (entry.Subkey === "Software\\Classes\\.json\\OpenWithProgids") {
      assert.equal(entry.ValueName, "{#ProjectProgId}");
      assert.equal(entry.ValueData, "");
    }
    assert.ok(
      entry.ValueName !== "" ||
        !/^Software\\Classes\\\.json$/.test(entry.Subkey),
      "the default program of .json is never set",
    );
  }
  assert.ok(subkeys.includes("Software\\Classes\\.json\\OpenWithProgids"));
  const verb =
    "Software\\Classes\\SystemFileAssociations\\.json\\shell\\{#OpenVerb}";
  assert.ok(subkeys.includes(verb));
  const applies = entries.find((entry) => entry.ValueName === "AppliesTo");
  assert.equal(applies?.Subkey, verb);
  assert.equal(applies?.ValueData, 'System.FileName:"*.prism.json"');
  // The command line passes the file path, in quotes, to the installed program.
  const commands = entries.filter((entry) =>
    entry.Subkey.endsWith("\\command"),
  );
  assert.equal(commands.length, 2);
  for (const entry of commands)
    assert.equal(entry.ValueData, '"{app}\\{#AppExe}" "%1"');
  // The uninstaller removes what it wrote and nothing the person owns: whole
  // keys only where they are ours, values and empty parents elsewhere.
  for (const entry of entries) {
    const deletesTree = /\buninsdeletekey\b/.test(entry.Flags ?? "");
    if (deletesTree)
      assert.ok(
        entry.Subkey === "Software\\Classes\\{#ProjectProgId}" ||
          entry.Subkey === verb,
        `${entry.Subkey} may hold the person's own settings`,
      );
  }
  for (const parent of [
    "Software\\Classes\\.json",
    "Software\\Classes\\SystemFileAssociations",
    "Software\\Classes\\SystemFileAssociations\\.json",
    "Software\\Classes\\SystemFileAssociations\\.json\\shell",
  ])
    assert.match(
      entries.find((entry) => entry.Subkey === parent)?.Flags ?? "",
      /\buninsdeletekeyifempty\b/,
      parent,
    );
  assert.match(
    entries.find((entry) => entry.Subkey.endsWith("\\.json\\OpenWithProgids"))
      ?.Flags ?? "",
    /\buninsdeletevalue\b/,
  );
});

test("the installer test looks for what the installer script registers", () => {
  const source = read("tests", "packaged-installer.cjs");
  const guid = /^AppId=\{\{([0-9A-F-]+)\}/im.exec(template)?.[1];
  assert.ok(guid);
  assert.equal(
    /const APP_GUID = "([^"]+)"/.exec(source)?.[1]?.toLowerCase(),
    `{${guid}}`.toLowerCase(),
  );
  assert.equal(
    /const PROG_ID = "([^"]+)"/.exec(source)?.[1],
    defined("ProjectProgId"),
  );
  assert.equal(/const VERB = "([^"]+)"/.exec(source)?.[1], defined("OpenVerb"));
});

test("nothing the installer shows uses dash punctuation", () => {
  assert.doesNotMatch(template, /[–—]/);
  assert.doesNotMatch(read("scripts", "build-windows-installer.mjs"), /[–—]/);
});

test("everything in the staged build is installed or deliberately left out", async () => {
  const directory = fs.mkdtempSync(
    path.join(os.tmpdir(), "prism-installer-test-"),
  );
  try {
    const runtime = path.join(directory, "runtime");
    fs.mkdirSync(path.join(runtime, "resources"), { recursive: true });
    fs.mkdirSync(path.join(runtime, "locales"));
    fs.writeFileSync(
      path.join(runtime, "electron.exe"),
      Buffer.from(ResEdit.NtExecutable.createEmpty(false, false).generate()),
    );
    fs.writeFileSync(path.join(runtime, "locales", "en-US.pak"), "pak");
    fs.writeFileSync(path.join(runtime, "LICENSE"), "Electron license");
    fs.writeFileSync(path.join(runtime, "LICENSES.chromium.html"), "<html>");
    const build = path.join(directory, "dist");
    fs.mkdirSync(build);
    fs.writeFileSync(path.join(build, "index.html"), "<html>");
    const staged = await packageRelease({
      platform: "win32",
      arch: "x64",
      runtime,
      build,
      output: path.join(directory, "out"),
    });
    const stageRoot = "{#StageDir}\\";
    const sources = parts.Files.map(entryFields).map((entry) => {
      assert.ok(entry.Source.startsWith(stageRoot), entry.Source);
      return entry.Source.slice(stageRoot.length);
    });
    assert.ok(sources.length >= 5);
    for (const relative of sources) {
      // Inno Setup paths use backslashes; the staged build here is a real path.
      const wildcard = relative.endsWith("\\*");
      const target = path.join(
        staged.contents,
        ...relative.replace(/\\\*$/, "").split("\\"),
      );
      const found = fs.existsSync(target) ? fs.statSync(target) : null;
      assert.ok(found, `${relative} is not in the staged build`);
      if (wildcard) {
        assert.ok(found.isDirectory(), relative);
        assert.ok(fs.readdirSync(target).length > 0, `${relative} is empty`);
      } else assert.ok(found.isFile(), relative);
    }
    // A file added to the portable build must be a decision here too.
    const installed = new Set(
      sources.map((relative) => relative.split("\\")[0]),
    );
    const leftOut = new Set([
      // Explains the ZIP (extract it, where to find the program); Setup does that itself.
      "START HERE.txt",
      // Also inside the Prism Mapper folder, which is installed whole.
      "LICENSES.chromium.html",
    ]);
    for (const entry of fs.readdirSync(staged.contents))
      assert.ok(
        installed.has(entry) || leftOut.has(entry),
        `${entry} is in the portable build but neither installed nor left out on purpose`,
      );
    for (const name of leftOut) assert.ok(!installed.has(name), name);
    assert.ok(
      fs.existsSync(path.join(staged.application, "LICENSES.chromium.html")),
    );
    // The program is the file the shortcuts and the file command start.
    assert.ok(fs.existsSync(path.join(staged.application, "Prism Mapper.exe")));
    // Old application code is removed before an update installs the new one.
    assert.ok(
      parts.InstallDelete.map(entryFields).some(
        (entry) => entry.Name === "{app}\\resources\\app",
      ),
    );
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test("Inno Setup is found where it installs, or through ISCC_PATH, or on the path", () => {
  const env = {
    ProgramFiles: "C:\\Program Files",
    "ProgramFiles(x86)": "C:\\Program Files (x86)",
    LOCALAPPDATA: "C:\\Users\\me\\AppData\\Local",
  };
  assert.deepEqual(compilerCandidates(env), [
    "C:\\Program Files (x86)\\Inno Setup 6\\ISCC.exe",
    "C:\\Program Files\\Inno Setup 6\\ISCC.exe",
    "C:\\Users\\me\\AppData\\Local\\Programs\\Inno Setup 6\\ISCC.exe",
  ]);
  assert.equal(
    compilerCandidates({ ISCC_PATH: "D:\\tools\\ISCC.exe" })[0],
    "D:\\tools\\ISCC.exe",
  );
  const present = new Set(["C:\\Program Files\\Inno Setup 6\\ISCC.exe"]);
  assert.equal(
    findCompiler(env, {
      exists: (file: string) => present.has(file),
      which: () => null,
    }),
    "C:\\Program Files\\Inno Setup 6\\ISCC.exe",
  );
  assert.equal(
    findCompiler(env, {
      exists: () => false,
      which: (name: string) => `C:\\bin\\${name}`,
    }),
    "C:\\bin\\ISCC.exe",
  );
  assert.equal(
    findCompiler({}, { exists: () => false, which: () => null }),
    null,
  );
});
