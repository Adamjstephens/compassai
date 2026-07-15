#!/usr/bin/env node
import crypto from "node:crypto";

const authSecret = crypto.randomBytes(32).toString("base64url");
const apiJwtSecret = crypto.randomBytes(32).toString("base64url");

console.log("AUTH_SECRET=" + authSecret);
console.log("COMPASSAI_JWT_SECRET=" + apiJwtSecret);
console.log("");
console.log("Set AUTH_SECRET in Vercel only.");
console.log("Set the same COMPASSAI_JWT_SECRET in both Vercel and Render.");
