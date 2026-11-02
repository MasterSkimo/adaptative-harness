import { start, stop, doctor, register } from "./lifecycle.js";
const [command, ...args] = process.argv.slice(2);
try {
  if (command === "start") console.log(JSON.stringify(await start()));
  else if (command === "stop") console.log(JSON.stringify(await stop()));
  else if (command === "doctor") console.log(JSON.stringify(await doctor()));
  else if (command === "register" && args.length === 2) { await register(args[0], args[1]); console.log("registered"); }
  else { console.error("Usage: daemon start|stop|doctor|register <sourceInstanceId> <projectId>"); process.exitCode = 2; }
} catch { console.error("Daemon command failed"); process.exitCode = 1; }
