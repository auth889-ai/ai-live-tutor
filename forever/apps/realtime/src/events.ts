export type ForeverEventType =
  | "COURSE_PROGRESS"
  | "GRAPH_NODE_STARTED"
  | "GRAPH_NODE_COMPLETED"
  | "SCENE_READY"
  | "REVIEW_FAILED"
  | "GENERATION_FAILED";

export interface ForeverEvent {
  type: ForeverEventType;
  courseId: string;
  sessionId: string;
  payload: Record<string, unknown>;
}

