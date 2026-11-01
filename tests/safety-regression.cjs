// Offline regression checks: no API calls, charges, database writes, or secrets.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const server = fs.readFileSync("server.js", "utf8");
const site = fs.readFileSync("index.html", "utf8");
const pkg = JSON.parse(fs.readFileSync("package.json", "utf8"));

function check(label, ok) { assert.ok(ok, label); console.log("PASS", label); }
check("All three approved prices", /photo:\s*\{[^}]*priceRub:\s*99/.test(server) && /edit:\s*\{[^}]*priceRub:\s*149/.test(server) && /video:\s*\{[^}]*priceRub:\s*299/.test(server));
check("Payments and public generation advertised as disabled", /paymentsEnabled:false,\s*generationEnabled:false/.test(server));
check("Paid photo generation requires login", /app\.post\("\/api\/orders\/:id\/generate-photo",\s*authenticate/.test(server));
check("Generation claims paid order atomically", /UPDATE orders SET status='processing'[\s\S]*?service='photo' AND status='paid'/.test(server));
check("Test payment uses Robokassa sandbox", /IsTest:"1"/.test(server));
check("Test callback cannot mark order paid", /if \(isTest\) \{[\s\S]*?return res\.type\("text\/plain"\)\.send\("OK" \+ InvId\);/.test(server));
check("Admin Ranvik test requires authentication", /app\.post\("\/api\/admin\/ranvik-test",\s*authenticate/.test(server));
check("Admin test requires explicit confirmation", /req\.body\?\.confirmed !== true/.test(server));
check("UI asks for confirmation before admin test", /window\.confirm\("Запустить платный тест Ranvik/.test(site));
check("No public paid-generation button enabled", /id="generate"[^>]*disabled/.test(site));
check("No free credits for new users", /credits INTEGER NOT NULL DEFAULT 0/.test(server));
check("Node entry point unchanged", pkg.main === "server.js");
console.log("Offline checks complete; no paid Ranvik requests made.");
