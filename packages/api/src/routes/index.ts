import { Router } from "express";
import { authRouter } from "./auth.routes";
import { organizationsRouter } from "./organizations.routes";
import { projectsRouter, retryPoliciesRouter } from "./projects.routes";
import { queuesRouter } from "./queues.routes";
import { jobsRouter } from "./jobs.routes";
import { jobDefinitionsRouter } from "./job-definitions.routes";
import { dlqRouter } from "./dlq.routes";
import { workersRouter } from "./workers.routes";
import { metricsRouter } from "./metrics.routes";

export const apiRouter = Router();

apiRouter.use("/auth", authRouter);
apiRouter.use("/organizations", organizationsRouter);
apiRouter.use("/retry-policies", retryPoliciesRouter);
apiRouter.use("/projects", projectsRouter);
apiRouter.use(queuesRouter);
apiRouter.use(jobsRouter);
apiRouter.use(jobDefinitionsRouter);
apiRouter.use(dlqRouter);
apiRouter.use(workersRouter);
apiRouter.use(metricsRouter);
