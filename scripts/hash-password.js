#!/usr/bin/env node
/**
 * 生成密码的 SHA-256 哈希,粘到 src/lib/auth.ts 的 PASSWORD_HASH 常量。
 *
 * 用法:
 *   node scripts/hash-password.js <你的新密码>
 *
 * 例如:
 *   node scripts/hash-password.js 123456
 *   → 8d969eef6ecad3c29a3a629280e686cf0c3f5d5a86aff3ca12020c923adc6c92
 */

import { createHash } from "node:crypto";

const password = process.argv[2];
if (!password) {
  console.error("用法: node scripts/hash-password.js <你的新密码>");
  console.error("示例: node scripts/hash-password.js 123456");
  process.exit(1);
}

const hash = createHash("sha256").update(password, "utf8").digest("hex");
console.log("");
console.log(`密码: ${password}`);
console.log(`SHA-256: ${hash}`);
console.log("");
console.log("把上面这串哈希粘到 src/lib/auth.ts 的 PASSWORD_HASH 常量,然后提交。");
