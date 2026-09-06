/* =========================================================
   set-admin-password.js — set or reset the admin login

   Run:  node set-admin-password.js

   Use this for the first setup, or if you forget the password.
   There is no recovery by design — resetting is the recovery.
   ========================================================= */
const readline = require("readline");
const auth = require("./admin-auth.js");

function ask(question, { hidden = false } = {}) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });

    if (!hidden) {
      rl.question(question, (a) => { rl.close(); resolve(a); });
      return;
    }

    // Hidden input: echo nothing while the password is typed
    let value = "";
    const onData = (chunk) => {
      const s = chunk.toString("utf8");
      for (const ch of s) {
        if (ch === "\n" || ch === "\r" || ch === "") {
          process.stdin.removeListener("data", onData);
          if (process.stdin.isTTY) process.stdin.setRawMode(false);
          process.stdin.pause();
          rl.close();
          process.stdout.write("\n");
          return resolve(value);
        }
        if (ch === "") { process.stdout.write("\n"); process.exit(130); }      // Ctrl+C
        if (ch === "" || ch === "\b") { value = value.slice(0, -1); continue; } // Backspace
        value += ch;
      }
    };

    process.stdout.write(question);
    if (process.stdin.isTTY) process.stdin.setRawMode(true);
    process.stdin.resume();
    process.stdin.on("data", onData);
  });
}

(async () => {
  console.log("\nSHEGLAM PK — admin login setup\n");

  if (auth.exists()) {
    const rec = auth.load();
    console.log(`An admin login already exists (username: ${rec.username}).`);
    const yes = await ask("Replace it? [y/N] ");
    if (!/^y(es)?$/i.test(yes.trim())) { console.log("\nCancelled — nothing changed.\n"); process.exit(0); }
    console.log("");
  }

  let username = (await ask("Username [admin]: ")).trim() || "admin";

  let password;
  for (;;) {
    password = await ask("Password: ", { hidden: true });
    const problems = auth.checkStrength(password);
    if (problems.length) {
      console.log("\n  That password " + problems.join(", and ") + ".\n");
      continue;
    }
    const again = await ask("Confirm password: ", { hidden: true });
    if (again !== password) { console.log("\n  Those did not match. Try again.\n"); continue; }
    break;
  }

  auth.save(username, password);

  console.log(`\n✓ Admin login saved for "${username}".`);
  console.log(`  Stored as a salted scrypt hash in data/admin-auth.json — the password itself is not kept.`);
  console.log(`\n  Never commit or deploy that file.`);
  console.log(`\n  Start the portal:  node admin-server.js`);
  console.log(`  Then open:         http://localhost:5600\n`);
  process.exit(0);
})();
