// Output for tests that run in CI. On GitHub Actions a line such as
// "::notice title=...::text" becomes an annotation on the run page, which is
// where a person looks first; anywhere else it is printed as ordinary text.

const escapeData = (text) =>
  String(text).replace(/%/g, "%25").replace(/\r/g, "%0D").replace(/\n/g, "%0A");
const escapeProperty = (text) =>
  escapeData(text).replace(/:/g, "%3A").replace(/,/g, "%2C");

// GitHub shows about 4000 characters of an annotation.
const LIMIT = 3800;

function annotate(level, title, message) {
  const text = String(message);
  const shown =
    text.length > LIMIT
      ? `${text.slice(0, LIMIT - 20)}\n[cut: ${text.length} characters]`
      : text;
  if (process.env.GITHUB_ACTIONS)
    console.log(
      `::${level} title=${escapeProperty(title)}::${escapeData(shown)}`,
    );
  else console.log(`${level.toUpperCase()} ${title}\n${shown}`);
}

module.exports = { annotate, escapeData, escapeProperty };
