// Database Teacher — a SEPARATE specialist teacher agent (one file, one subject; user design:
// each course gets its own named teacher). Carries its own register (CMU 15-445 build-and-
// measure + Kimball measured trade-offs) and delegates lesson mechanics to the shared deep
// planner so gates/guarantees stay uniform. Its evidence engine: authoring/evidence/sql-evidence.js.

import { designPedagogy } from '../teacher.js';
import { REGISTER as OWN_REGISTER } from '../registers/data_db.js';

export const DOMAIN = 'data_db';

export const REGISTER = OWN_REGISTER; // the subject's prompt, owned by its own file

export async function designLesson({ sourcePack, minScenes, maxScenes }) {
  return designPedagogy({ sourcePack, minScenes, maxScenes, domain: DOMAIN, register: REGISTER });
}
