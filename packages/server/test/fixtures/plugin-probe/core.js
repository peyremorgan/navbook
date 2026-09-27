/** The server probe's format half: one directory and one frontmatter key. */

export function activate(host) {
  host.register({
    treeLocations: [
      {
        dir: "srvprobe",
        build: (_files, paths) => ({ model: { paths: [...paths] }, problems: [] }),
      },
    ],
    frontmatterKeys: [{ key: "srvprobe-tag", kinds: ["issue", "pr"], shape: "string-or-list" }],
  });
}
