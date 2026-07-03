import { demoManifest } from "./data/demoManifest.js";
import { createTutorPlayer } from "./components/TutorPlayer.js";

const app = document.querySelector("#app");
app.append(createTutorPlayer(demoManifest));

