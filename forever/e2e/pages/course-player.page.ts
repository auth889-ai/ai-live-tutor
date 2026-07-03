import type { Page } from "@playwright/test";

export class CoursePlayerPage {
  constructor(readonly page: Page) {}

  async goto() {
    await this.page.goto("/");
  }

  get courseTitle() {
    return this.page.getByRole("heading", { name: /Nested Loops & Patterns/i });
  }

  get generateButton() {
    return this.page.getByRole("button", { name: /Generate Tutor Scene/i });
  }

  get playButton() {
    return this.page.getByRole("button", { name: "Play" });
  }
}

