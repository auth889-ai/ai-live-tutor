export const demoCourse = {
  title: "Nested Loops & Patterns in C++",
  subject: "Java Programming",
  episodeLabel: "Episode 3",
  lessonLabel: "Lesson 2: Square Pattern",
  currentEpisode: 3,
  totalEpisodes: 12,
  progressPercent: 25,
  episodes: [
    { number: 1, title: "What is Programming?", duration: "10:45", state: "done" },
    { number: 2, title: "Variables & Data Types", duration: "14:20", state: "done" },
    { number: 3, title: "Nested Loops & Patterns", duration: "18:35", state: "active" },
    { number: 4, title: "Functions", duration: "", state: "locked" },
    { number: 5, title: "Arrays", duration: "", state: "locked" },
    { number: 6, title: "Strings", duration: "", state: "locked" },
    { number: 7, title: "Recursion", duration: "", state: "locked" }
  ],
  timeline: [
    { number: 1, title: "Rules of Nested Loops", timeRange: "0:00 - 2:45", thumbnailType: "notebook", active: true },
    { number: 2, title: "Square Pattern Explanation", timeRange: "2:45 - 6:20", thumbnailType: "stars", active: false },
    { number: 3, title: "Code Implementation", timeRange: "6:20 - 10:35", thumbnailType: "code", active: false },
    { number: 4, title: "Dry Run (4x4 Pattern)", timeRange: "10:35 - 14:50", thumbnailType: "table", active: false },
    { number: 5, title: "More Pattern Examples", timeRange: "14:50 - 18:35", thumbnailType: "triangle", active: false }
  ]
};
