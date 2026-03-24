import { cpSync } from "fs";
import { join } from "path";

cpSync(join("src", "commands", "serve-ui.html"), join("dist", "commands", "serve-ui.html"));
cpSync(join("src", "share-card"), join("dist", "share-card"), { recursive: true });
