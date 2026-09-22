import { register } from "node:module";
import { pathToFileURL } from "node:url";

register("./cli-resolve.mjs", pathToFileURL("./scripts/").href);
