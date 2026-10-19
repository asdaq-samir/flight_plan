import base from "../playwright.config";
const state = "e2e/.auth/developer-localhost.json";
export default {
  ...base, testDir: ".",
  projects: base.projects!.map(p => ({
    ...p,
    ...(p.testDir ? { testDir: p.testDir.replace("./e2e/", "./") } : {}),
    use: { ...p.use, ...(p.use?.storageState ? { storageState: state } : {}) },
  })),
};
