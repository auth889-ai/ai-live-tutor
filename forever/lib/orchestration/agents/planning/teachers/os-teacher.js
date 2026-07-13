// OS & Computer Architecture Teacher — a SEPARATE specialist teacher agent (one file, one subject; user design:
// each course gets its own named teacher, never one generic teacher for all). Carries its
// own register (how the best human teachers of this subject actually teach) and delegates
// lesson mechanics to the shared deep planner so gates/guarantees stay uniform.

import { designPedagogy } from '../teacher.js';
import { DOMAIN_TEACHING } from '../domain-teaching.js';



export const DOMAIN = 'os_arch';

export const REGISTER = DOMAIN_TEACHING['os_arch'];

export async function designLesson({ sourcePack, minScenes, maxScenes }) {
  return designPedagogy({ sourcePack, minScenes, maxScenes, domain: DOMAIN, register: REGISTER });
}
