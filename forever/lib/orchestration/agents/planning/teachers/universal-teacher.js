// Universal Teacher — the specialist for subjects OUTSIDE the 14 courses (user rule: NO
// lesser tier — same full society, same gates; the register comes from the general
// evidence-based blueprint until the course-time register-designer ships).

import { designPedagogy } from '../teacher.js';

export const DOMAIN = 'general';

export async function designLesson({ sourcePack, minScenes, maxScenes }) {
  return designPedagogy({ sourcePack, minScenes, maxScenes, domain: 'general' });
}
