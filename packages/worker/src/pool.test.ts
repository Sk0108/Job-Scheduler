import { describe, expect, it } from "vitest";
import { Semaphore } from "./pool";

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

describe("Semaphore", () => {
  it("reports available capacity decreasing as tasks run and increasing as they finish", async () => {
    const sem = new Semaphore(2);
    expect(sem.available()).toBe(2);

    sem.run(() => sleep(30));
    expect(sem.available()).toBe(1);
    expect(sem.activeCount()).toBe(1);

    sem.run(() => sleep(30));
    expect(sem.available()).toBe(0);

    await sleep(60);
    expect(sem.available()).toBe(2);
    expect(sem.activeCount()).toBe(0);
  });

  it("never lets more than `capacity` tasks run concurrently", async () => {
    const sem = new Semaphore(3);
    let concurrent = 0;
    let maxConcurrent = 0;

    const runTracked = () =>
      sem.run(async () => {
        concurrent++;
        maxConcurrent = Math.max(maxConcurrent, concurrent);
        await sleep(20);
        concurrent--;
      });

    for (let i = 0; i < 10; i++) {
      while (sem.available() <= 0) {
        await sleep(5);
      }
      runTracked();
    }

    await sem.drain(1000);
    expect(maxConcurrent).toBeLessThanOrEqual(3);
  });

  it("drain() resolves once all in-flight tasks settle", async () => {
    const sem = new Semaphore(5);
    let completed = 0;
    for (let i = 0; i < 5; i++) {
      sem.run(async () => {
        await sleep(10);
        completed++;
      });
    }
    await sem.drain(1000);
    expect(completed).toBe(5);
  });

  it("drain() returns at the timeout even if a task is still running", async () => {
    const sem = new Semaphore(1);
    sem.run(() => sleep(500));
    const start = Date.now();
    await sem.drain(50);
    expect(Date.now() - start).toBeLessThan(200);
  });
});
