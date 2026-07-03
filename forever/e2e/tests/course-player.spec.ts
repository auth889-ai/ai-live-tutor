import { expect, test } from "@playwright/test";
import { CoursePlayerPage } from "../pages/course-player.page";

test("renders course lecture player shell", async ({ page }) => {
  const course = new CoursePlayerPage(page);

  await course.goto();

  await expect(course.courseTitle).toBeVisible();
  await expect(page.getByText("Java Programming")).toBeVisible();
  await expect(page.getByText("Rules of Nested Loops")).toBeVisible();
  await expect(course.playButton).toBeVisible();
});

