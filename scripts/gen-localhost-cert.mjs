import { execFileSync } from "child_process";
import { existsSync, mkdirSync, writeFileSync } from "fs";
import path from "path";

const dir = path.resolve("data/certs");
mkdirSync(dir, { recursive: true });

const cnfPath = path.join(dir, "openssl.cnf");
writeFileSync(
  cnfPath,
  `[req]
distinguished_name = req_distinguished_name
x509_extensions = v3_req
prompt = no
[req_distinguished_name]
CN = localhost
[v3_req]
keyUsage = digitalSignature, keyEncipherment
extendedKeyUsage = serverAuth
subjectAltName = @alt_names
[alt_names]
DNS.1 = localhost
IP.1 = 127.0.0.1
`,
);

const keyPath = path.join(dir, "localhost-key.pem");
const certPath = path.join(dir, "localhost-cert.pem");

const candidates = [
  process.env.OPENSSL_PATH,
  "openssl",
  "D:\\2026OSPanel\\modules\\PHP-8.3\\openssl.exe",
].filter(Boolean);

let openssl = null;
for (const c of candidates) {
  try {
    execFileSync(c, ["version"], { stdio: "ignore", env: { ...process.env, OPENSSL_CONF: cnfPath } });
    openssl = c;
    break;
  } catch {
    /* try next */
  }
}

if (!openssl) {
  console.error("openssl not found");
  process.exit(1);
}

execFileSync(
  openssl,
  [
    "req",
    "-x509",
    "-newkey",
    "rsa:2048",
    "-keyout",
    keyPath,
    "-out",
    certPath,
    "-days",
    "825",
    "-nodes",
    "-config",
    cnfPath,
    "-extensions",
    "v3_req",
  ],
  { stdio: "inherit", env: { ...process.env, OPENSSL_CONF: cnfPath } },
);

console.log(existsSync(certPath) && existsSync(keyPath) ? "CERT_OK" : "CERT_FAIL");
console.log(certPath);
console.log(keyPath);
