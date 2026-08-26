// electron-builder `win.sign` hook: Authenticode-sign every Windows binary
// through Azure Artifact Signing (cloud HSM; the certificate never exists as
// a file, so the usual WIN_CSC_LINK/.pfx route cannot be used).
//
// signtool needs the Artifact Signing dlib and a metadata JSON naming the
// signing account and certificate profile; the dlib authenticates with the
// AZURE_TENANT_ID / AZURE_CLIENT_ID / AZURE_CLIENT_SECRET service principal.
// All of that comes from one KEY=VALUE file OUTSIDE the repo
// (LSE_SIGNING_ENV, default %USERPROFILE%\.lse-signing\signing.env) so no
// secret can be committed by accident.
//
// The certificates issued by the service are valid for three days, so the
// RFC 3161 timestamp is what keeps a signed installer valid afterwards;
// a build without a timestamp is a broken build, never retry without it.
//
// When the env file is absent (Mac, a dev tree, a machine without the
// service principal) the hook logs and returns: the build still produces an
// unsigned installer instead of failing, matching the pre-signing behaviour.
"use strict";
const fs = require("fs");
const os = require("os");
const path = require("path");
const { execFileSync } = require("child_process");

function loadEnvFile(file) {
  const out = {};
  for (const raw of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const i = line.indexOf("=");
    if (i < 0) continue;
    out[line.slice(0, i).trim()] = line.slice(i + 1).trim();
  }
  return out;
}

// Newest Windows 10/11 SDK signtool on the machine; the service refuses
// the 20348-era one, so pick by version, not by first hit.
function findSignTool() {
  if (process.env.SIGNTOOL && fs.existsSync(process.env.SIGNTOOL)) return process.env.SIGNTOOL;
  const kits = path.join(process.env["ProgramFiles(x86)"] || "C:\\Program Files (x86)", "Windows Kits", "10", "bin");
  if (!fs.existsSync(kits)) return null;
  const versions = fs.readdirSync(kits).filter((d) => /^10\.0\.\d+\.\d+$/.test(d)).sort((a, b) => {
    const pa = a.split(".").map(Number), pb = b.split(".").map(Number);
    for (let i = 0; i < 4; i++) if (pa[i] !== pb[i]) return pb[i] - pa[i];
    return 0;
  });
  for (const v of versions) {
    const p = path.join(kits, v, "x64", "signtool.exe");
    if (fs.existsSync(p)) return p;
  }
  return null;
}

function findDlib() {
  if (process.env.LSE_SIGN_DLIB && fs.existsSync(process.env.LSE_SIGN_DLIB)) return process.env.LSE_SIGN_DLIB;
  const base = path.join(process.env.LOCALAPPDATA || "", "Microsoft", "MicrosoftArtifactSigningClientTools");
  for (const p of [path.join(base, "x64", "Azure.CodeSigning.Dlib.dll"), path.join(base, "Azure.CodeSigning.Dlib.dll")]) {
    if (fs.existsSync(p)) return p;
  }
  return null;
}

module.exports = async function sign(configuration) {
  const envFile = process.env.LSE_SIGNING_ENV || path.join(os.homedir(), ".lse-signing", "signing.env");
  if (process.platform !== "win32" || !fs.existsSync(envFile)) {
    console.log(`  • sign-windows: no signing env at ${envFile}; leaving ${path.basename(configuration.path)} unsigned`);
    return;
  }
  const env = loadEnvFile(envFile);
  // LSE_SIGN=off in the env file ships an unsigned build on purpose (the
  // signing profile is not issued yet); the build must not half-sign or
  // fail, and the choice is recorded in the build log.
  if (String(env.LSE_SIGN || "").toLowerCase() === "off") {
    console.log(`  • sign-windows: LSE_SIGN=off in ${envFile}; leaving ${path.basename(configuration.path)} unsigned`);
    return;
  }
  for (const k of ["AZURE_TENANT_ID", "AZURE_CLIENT_ID", "AZURE_CLIENT_SECRET", "LSE_SIGN_ENDPOINT", "LSE_SIGN_ACCOUNT", "LSE_SIGN_PROFILE"]) {
    if (!env[k]) throw new Error(`sign-windows: ${k} missing from ${envFile}`);
  }
  const signtool = findSignTool();
  const dlib = findDlib();
  if (!signtool) throw new Error("sign-windows: signtool.exe not found (install the Windows 10/11 SDK build tools)");
  if (!dlib) throw new Error("sign-windows: Azure.CodeSigning.Dlib.dll not found (winget install Microsoft.Azure.ArtifactSigningClientTools)");

  // Metadata file is regenerated per build in the temp dir so the repo never
  // carries account names; ExcludeCredentials pins the dlib to the service
  // principal in the env, otherwise it walks every cached Azure login first.
  const metadata = path.join(os.tmpdir(), `lse-sign-${process.pid}.json`);
  fs.writeFileSync(metadata, JSON.stringify({
    Endpoint: env.LSE_SIGN_ENDPOINT,
    CodeSigningAccountName: env.LSE_SIGN_ACCOUNT,
    CertificateProfileName: env.LSE_SIGN_PROFILE,
    CorrelationId: `lse-terminal-${configuration.hash}`,
    ExcludeCredentials: [
      "ManagedIdentityCredential", "WorkloadIdentityCredential", "SharedTokenCacheCredential",
      "VisualStudioCredential", "VisualStudioCodeCredential", "AzureCliCredential",
      "AzurePowerShellCredential", "AzureDeveloperCliCredential", "InteractiveBrowserCredential",
    ],
  }));
  const args = [
    "sign", "/v", "/fd", "SHA256",
    "/tr", "http://timestamp.acs.microsoft.com", "/td", "SHA256",
    "/dlib", dlib, "/dmdf", metadata,
    configuration.path,
  ];
  console.log(`  • sign-windows: signing ${path.basename(configuration.path)} via Artifact Signing (${env.LSE_SIGN_PROFILE})`);
  try {
    execFileSync(signtool, args, {
      stdio: "inherit",
      env: { ...process.env, AZURE_TENANT_ID: env.AZURE_TENANT_ID, AZURE_CLIENT_ID: env.AZURE_CLIENT_ID, AZURE_CLIENT_SECRET: env.AZURE_CLIENT_SECRET },
    });
  } finally {
    try { fs.unlinkSync(metadata); } catch (_) { /* temp file */ }
  }
};
